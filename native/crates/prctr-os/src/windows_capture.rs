//! Windows screen capture (Windows.Graphics.Capture) and H.264 encoding (the Media Foundation
//! encoder) for the recorder. Only the primary monitor's pixels: no audio, no window lists.

use std::mem::ManuallyDrop;
use std::time::{Duration, Instant};

use windows::Graphics::Capture::{
    Direct3D11CaptureFramePool, GraphicsCaptureItem, GraphicsCaptureSession,
};
use windows::Graphics::DirectX::Direct3D11::IDirect3DDevice;
use windows::Graphics::DirectX::DirectXPixelFormat;
use windows::Win32::Foundation::{HMODULE, POINT};
use windows::Win32::Graphics::Direct3D::D3D_DRIVER_TYPE_HARDWARE;
use windows::Win32::Graphics::Direct3D11::{
    D3D11_CPU_ACCESS_READ, D3D11_CREATE_DEVICE_BGRA_SUPPORT, D3D11_MAP_READ,
    D3D11_MAPPED_SUBRESOURCE, D3D11_SDK_VERSION, D3D11_TEXTURE2D_DESC, D3D11_USAGE_STAGING,
    D3D11CreateDevice, ID3D11Device, ID3D11DeviceContext, ID3D11Texture2D,
};
use windows::Win32::Graphics::Dxgi::IDXGIDevice;
use windows::Win32::Graphics::Gdi::{
    GetMonitorInfoW, MONITOR_DEFAULTTOPRIMARY, MONITORINFO, MonitorFromPoint,
};
use windows::Win32::Media::MediaFoundation::{
    CODECAPI_AVEncMPVDefaultBPictureCount, CODECAPI_AVEncVideoForceKeyFrame,
    CODECAPI_AVLowLatencyMode, ICodecAPI, IMFActivate, IMFMediaType, IMFSample, IMFTransform,
    MF_E_TRANSFORM_NEED_MORE_INPUT, MF_E_TRANSFORM_STREAM_CHANGE, MF_MT_AVG_BITRATE,
    MF_MT_FRAME_RATE, MF_MT_FRAME_SIZE, MF_MT_INTERLACE_MODE, MF_MT_MAJOR_TYPE,
    MF_MT_MPEG2_PROFILE, MF_MT_PIXEL_ASPECT_RATIO, MF_MT_SUBTYPE, MF_VERSION, MFCreateMediaType,
    MFCreateMemoryBuffer, MFCreateSample, MFMediaType_Video, MFSTARTUP_FULL, MFStartup,
    MFT_CATEGORY_VIDEO_ENCODER, MFT_ENUM_FLAG_SORTANDFILTER, MFT_ENUM_FLAG_SYNCMFT,
    MFT_MESSAGE_NOTIFY_BEGIN_STREAMING, MFT_MESSAGE_NOTIFY_START_OF_STREAM, MFT_OUTPUT_DATA_BUFFER,
    MFT_OUTPUT_STREAM_PROVIDES_SAMPLES, MFT_REGISTER_TYPE_INFO, MFTEnumEx, MFVideoFormat_H264,
    MFVideoFormat_NV12, MFVideoInterlace_Progressive, eAVEncH264VProfile_Main,
};
use windows::Win32::System::Com::CoTaskMemFree;
use windows::Win32::System::Variant::VARIANT;
use windows::Win32::System::WinRT::Direct3D11::{
    CreateDirect3D11DeviceFromDXGIDevice, IDirect3DDxgiInterfaceAccess,
};
use windows::Win32::System::WinRT::Graphics::Capture::IGraphicsCaptureItemInterop;
use windows::Win32::System::WinRT::{RO_INIT_MULTITHREADED, RoInitialize};
use windows::Win32::UI::HiDpi::{
    DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2, SetProcessDpiAwarenessContext,
};
use windows::core::Interface;

use crate::Rect;

/// One captured frame, BGRA, rows packed (`stride == width * 4`).
pub struct RawFrame {
    pub width: u32,
    pub height: u32,
    pub stride: u32,
    pub bgra: Vec<u8>,
}

/// A running capture of the primary monitor.
pub struct ScreenCapture {
    pool: Direct3D11CaptureFramePool,
    session: GraphicsCaptureSession,
    device: ID3D11Device,
    context: ID3D11DeviceContext,
    staging: Option<(ID3D11Texture2D, u32, u32)>,
    /// The monitor in physical pixels (the agent is per-monitor DPI aware while capturing).
    pub display: Rect,
}

// SAFETY: the capture objects are agile WinRT objects and the D3D11 device is created without
// the single-threaded flag; the recorder thread that owns this value is the only user.
unsafe impl Send for ScreenCapture {}

impl ScreenCapture {
    /// Captures the primary monitor with the cursor and, where the OS allows, without the yellow
    /// capture border. `None` when capture is unavailable.
    #[must_use]
    pub fn start() -> Option<Self> {
        // SAFETY: both calls only change this process's apartment and DPI mode; failures (already
        // set) are harmless.
        let _ = unsafe { RoInitialize(RO_INIT_MULTITHREADED) };
        // SAFETY: as above.
        let _ =
            unsafe { SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2) };
        let mut device = None;
        let mut context = None;
        // SAFETY: the out-parameters are valid; a hardware device with BGRA support is requested.
        unsafe {
            D3D11CreateDevice(
                None,
                D3D_DRIVER_TYPE_HARDWARE,
                HMODULE::default(),
                D3D11_CREATE_DEVICE_BGRA_SUPPORT,
                None,
                D3D11_SDK_VERSION,
                Some(&raw mut device),
                None,
                Some(&raw mut context),
            )
        }
        .ok()?;
        let (device, context): (ID3D11Device, ID3D11DeviceContext) = (device?, context?);
        let dxgi: IDXGIDevice = device.cast().ok()?;
        // SAFETY: `dxgi` is the live DXGI device of `device`.
        let direct3d: IDirect3DDevice = unsafe { CreateDirect3D11DeviceFromDXGIDevice(&dxgi) }
            .ok()?
            .cast()
            .ok()?;
        // SAFETY: the origin always lies on a monitor; the primary is the fallback.
        let monitor = unsafe { MonitorFromPoint(POINT { x: 0, y: 0 }, MONITOR_DEFAULTTOPRIMARY) };
        let interop =
            windows::core::factory::<GraphicsCaptureItem, IGraphicsCaptureItemInterop>().ok()?;
        // SAFETY: `monitor` is a valid monitor handle.
        let item: GraphicsCaptureItem = unsafe { interop.CreateForMonitor(monitor) }.ok()?;
        let size = item.Size().ok()?;
        let pool = Direct3D11CaptureFramePool::CreateFreeThreaded(
            &direct3d,
            DirectXPixelFormat::B8G8R8A8UIntNormalized,
            2,
            size,
        )
        .ok()?;
        let session = pool.CreateCaptureSession(&item).ok()?;
        let _ = session.SetIsCursorCaptureEnabled(true);
        let _ = session.SetIsBorderRequired(false);
        session.StartCapture().ok()?;
        let mut info = MONITORINFO {
            cbSize: u32::try_from(size_of::<MONITORINFO>()).unwrap_or(0),
            ..MONITORINFO::default()
        };
        // SAFETY: `info` is sized for the call.
        let _ = unsafe { GetMonitorInfoW(monitor, &raw mut info) };
        let bounds = info.rcMonitor;
        Some(Self {
            pool,
            session,
            device,
            context,
            staging: None,
            display: Rect {
                x: f64::from(bounds.left),
                y: f64::from(bounds.top),
                width: f64::from(bounds.right - bounds.left),
                height: f64::from(bounds.bottom - bounds.top),
            },
        })
    }

    fn staging(
        &mut self,
        width: u32,
        height: u32,
        format: windows::Win32::Graphics::Dxgi::Common::DXGI_FORMAT,
    ) -> Option<ID3D11Texture2D> {
        if let Some((texture, w, h)) = &self.staging
            && (*w, *h) == (width, height)
        {
            return Some(texture.clone());
        }
        let description = D3D11_TEXTURE2D_DESC {
            Width: width,
            Height: height,
            MipLevels: 1,
            ArraySize: 1,
            Format: format,
            SampleDesc: windows::Win32::Graphics::Dxgi::Common::DXGI_SAMPLE_DESC {
                Count: 1,
                Quality: 0,
            },
            Usage: D3D11_USAGE_STAGING,
            BindFlags: 0,
            CPUAccessFlags: u32::try_from(D3D11_CPU_ACCESS_READ.0).unwrap_or(0),
            MiscFlags: 0,
        };
        let mut texture = None;
        // SAFETY: `description` describes a CPU-readable staging texture; `texture` is a valid
        // out-parameter.
        unsafe {
            self.device
                .CreateTexture2D(&raw const description, None, Some(&raw mut texture))
        }
        .ok()?;
        let texture = texture?;
        self.staging = Some((texture.clone(), width, height));
        Some(texture)
    }

    /// The next frame, waiting at most `timeout`; `Ok(None)` when the screen did not change.
    ///
    /// # Errors
    /// When a frame arrived but could not be read back.
    pub fn next(&mut self, timeout: Duration) -> Result<Option<RawFrame>, String> {
        let deadline = Instant::now() + timeout;
        let frame = loop {
            if let Ok(frame) = self.pool.TryGetNextFrame() {
                break frame;
            }
            if Instant::now() >= deadline {
                return Ok(None);
            }
            std::thread::sleep(Duration::from_millis(10));
        };
        let failed = |_| "a captured frame could not be read".to_owned();
        let access: IDirect3DDxgiInterfaceAccess =
            frame.Surface().map_err(failed)?.cast().map_err(failed)?;
        // SAFETY: the surface of a captured frame is a D3D11 texture.
        let texture: ID3D11Texture2D = unsafe { access.GetInterface() }.map_err(failed)?;
        let mut description = D3D11_TEXTURE2D_DESC::default();
        // SAFETY: `description` is a valid out-parameter.
        unsafe { texture.GetDesc(&raw mut description) };
        let staging = self
            .staging(description.Width, description.Height, description.Format)
            .ok_or("no staging texture")?;
        // SAFETY: both textures belong to this device and have the same size and format.
        unsafe { self.context.CopyResource(&staging, &texture) };
        let mut mapped = D3D11_MAPPED_SUBRESOURCE::default();
        // SAFETY: the staging texture is CPU-readable; it is unmapped below.
        unsafe {
            self.context
                .Map(&staging, 0, D3D11_MAP_READ, 0, Some(&raw mut mapped))
        }
        .map_err(failed)?;
        let (width, height) = (description.Width, description.Height);
        let row = usize::try_from(width).unwrap_or(0) * 4;
        let pitch = usize::try_from(mapped.RowPitch).unwrap_or(0);
        let mut bgra = vec![0_u8; row * usize::try_from(height).unwrap_or(0)];
        if !mapped.pData.is_null() && pitch >= row {
            for (line, target) in bgra.chunks_exact_mut(row).enumerate() {
                let source = mapped.pData.cast::<u8>().wrapping_add(line * pitch);
                // SAFETY: while mapped, each row of `pitch` bytes is readable and `row <= pitch`.
                unsafe { std::ptr::copy_nonoverlapping(source, target.as_mut_ptr(), row) };
            }
        }
        // SAFETY: balances the map above.
        unsafe { self.context.Unmap(&staging, 0) };
        let _ = frame.Close();
        Ok(Some(RawFrame {
            width,
            height,
            stride: width * 4,
            bgra,
        }))
    }
}

impl Drop for ScreenCapture {
    fn drop(&mut self) {
        let _ = self.session.Close();
        let _ = self.pool.Close();
    }
}

/// The Media Foundation H.264 encoder, used synchronously: NV12 in, Annex-B access units out.
pub struct H264Mft {
    transform: IMFTransform,
    codec: Option<ICodecAPI>,
    fps: u32,
    frame: u64,
}

// SAFETY: the synchronous transform is used only from the recorder thread that owns it.
unsafe impl Send for H264Mft {}

fn media_type(
    subtype: windows::core::GUID,
    width: u32,
    height: u32,
    fps: u32,
) -> windows::core::Result<IMFMediaType> {
    // SAFETY: a new media type has no preconditions; every setter takes plain values.
    let kind = unsafe { MFCreateMediaType() }?;
    // SAFETY: as above, for each attribute below.
    unsafe { kind.SetGUID(&MF_MT_MAJOR_TYPE, &MFMediaType_Video) }?;
    // SAFETY: as above.
    unsafe { kind.SetGUID(&MF_MT_SUBTYPE, &raw const subtype) }?;
    // SAFETY: as above.
    unsafe {
        kind.SetUINT64(
            &MF_MT_FRAME_SIZE,
            (u64::from(width) << 32) | u64::from(height),
        )
    }?;
    // SAFETY: as above.
    unsafe { kind.SetUINT64(&MF_MT_FRAME_RATE, (u64::from(fps) << 32) | 1) }?;
    // SAFETY: as above.
    unsafe { kind.SetUINT64(&MF_MT_PIXEL_ASPECT_RATIO, (1 << 32) | 1) }?;
    // SAFETY: as above.
    unsafe {
        kind.SetUINT32(
            &MF_MT_INTERLACE_MODE,
            u32::try_from(MFVideoInterlace_Progressive.0).unwrap_or(2),
        )
    }?;
    Ok(kind)
}

impl H264Mft {
    /// An encoder for `width` × `height` NV12 frames (even sizes) at `fps`, about `bit_rate`
    /// bits per second.
    #[must_use]
    pub fn new(width: u32, height: u32, fps: u32, bit_rate: u32) -> Option<Self> {
        // SAFETY: starting Media Foundation is reference-counted and idempotent per process.
        unsafe { MFStartup(MF_VERSION, MFSTARTUP_FULL) }.ok()?;
        let output = MFT_REGISTER_TYPE_INFO {
            guidMajorType: MFMediaType_Video,
            guidSubtype: MFVideoFormat_H264,
        };
        let mut activates: *mut Option<IMFActivate> = std::ptr::null_mut();
        let mut count = 0_u32;
        // SAFETY: the out-parameters are valid; the array is freed below.
        unsafe {
            MFTEnumEx(
                MFT_CATEGORY_VIDEO_ENCODER,
                MFT_ENUM_FLAG_SYNCMFT | MFT_ENUM_FLAG_SORTANDFILTER,
                None,
                Some(&raw const output),
                &raw mut activates,
                &raw mut count,
            )
        }
        .ok()?;
        let mut transform = None;
        for index in 0..usize::try_from(count).unwrap_or(0) {
            let entry = activates.wrapping_add(index);
            // SAFETY: `activates` holds `count` entries and `index` is below it; taking each
            // releases it when dropped.
            let slot = unsafe { entry.replace(None) };
            if transform.is_none() {
                // SAFETY: `slot` is a live activation object for an encoder transform.
                transform = slot
                    .and_then(|activate| unsafe { activate.ActivateObject::<IMFTransform>() }.ok());
            }
        }
        if !activates.is_null() {
            // SAFETY: the array was allocated with the COM allocator and its entries were released.
            unsafe { CoTaskMemFree(Some(activates.cast())) };
        }
        let transform = transform?;
        let output_type = media_type(MFVideoFormat_H264, width, height, fps).ok()?;
        // SAFETY: plain attribute setters on the new type.
        unsafe { output_type.SetUINT32(&MF_MT_AVG_BITRATE, bit_rate) }.ok()?;
        // SAFETY: as above.
        unsafe {
            output_type.SetUINT32(
                &MF_MT_MPEG2_PROFILE,
                u32::try_from(eAVEncH264VProfile_Main.0).unwrap_or(77),
            )
        }
        .ok()?;
        // SAFETY: the output type must be set before the input type for encoders.
        unsafe { transform.SetOutputType(0, &output_type, 0) }.ok()?;
        let input_type = media_type(MFVideoFormat_NV12, width, height, fps).ok()?;
        // SAFETY: as above.
        unsafe { transform.SetInputType(0, &input_type, 0) }.ok()?;
        let codec: Option<ICodecAPI> = transform.cast().ok();
        if let Some(codec) = &codec {
            let (low_latency, no_b_frames) = (VARIANT::from(true), VARIANT::from(0_u32));
            // SAFETY: the values are plain variants for documented codec properties; an encoder
            // that ignores one still works.
            let _ = unsafe { codec.SetValue(&CODECAPI_AVLowLatencyMode, &raw const low_latency) };
            // SAFETY: as above.
            let _ = unsafe {
                codec.SetValue(
                    &CODECAPI_AVEncMPVDefaultBPictureCount,
                    &raw const no_b_frames,
                )
            };
        }
        // SAFETY: streaming messages take no data.
        unsafe { transform.ProcessMessage(MFT_MESSAGE_NOTIFY_BEGIN_STREAMING, 0) }.ok()?;
        // SAFETY: as above.
        unsafe { transform.ProcessMessage(MFT_MESSAGE_NOTIFY_START_OF_STREAM, 0) }.ok()?;
        Some(Self {
            transform,
            codec,
            fps: fps.max(1),
            frame: 0,
        })
    }

    fn sample(bytes: &[u8]) -> windows::core::Result<IMFSample> {
        let length = u32::try_from(bytes.len()).unwrap_or(u32::MAX);
        // SAFETY: a new buffer and sample have no preconditions.
        let buffer = unsafe { MFCreateMemoryBuffer(length) }?;
        let mut data = std::ptr::null_mut();
        // SAFETY: locking yields `length` writable bytes until unlocked below.
        unsafe { buffer.Lock(&raw mut data, None, None) }?;
        if !data.is_null() {
            // SAFETY: `data` holds at least `length` bytes and `bytes` is a separate allocation.
            unsafe { std::ptr::copy_nonoverlapping(bytes.as_ptr(), data, bytes.len()) };
        }
        // SAFETY: balances the lock above.
        unsafe { buffer.Unlock() }?;
        // SAFETY: the length is within the buffer.
        unsafe { buffer.SetCurrentLength(length) }?;
        // SAFETY: as above.
        let sample = unsafe { MFCreateSample() }?;
        // SAFETY: `buffer` is live.
        unsafe { sample.AddBuffer(&buffer) }?;
        Ok(sample)
    }

    fn read(sample: &IMFSample) -> Option<Vec<u8>> {
        // SAFETY: `sample` is the encoder's live output sample.
        let buffer = unsafe { sample.ConvertToContiguousBuffer() }.ok()?;
        let mut data = std::ptr::null_mut();
        let mut length = 0_u32;
        // SAFETY: locking yields `length` readable bytes until unlocked below.
        unsafe { buffer.Lock(&raw mut data, None, Some(&raw mut length)) }.ok()?;
        let bytes = (!data.is_null()).then(|| {
            // SAFETY: `data` holds `length` readable bytes while locked.
            unsafe { std::slice::from_raw_parts(data, usize::try_from(length).unwrap_or(0)) }
                .to_vec()
        });
        // SAFETY: balances the lock above.
        let _ = unsafe { buffer.Unlock() };
        bytes
    }

    /// Encodes one NV12 frame; `keyframe` forces an IDR frame. Returns the Annex-B access units
    /// ready now.
    pub fn encode(&mut self, nv12: &[u8], keyframe: bool) -> Option<Vec<Vec<u8>>> {
        if keyframe && let Some(codec) = &self.codec {
            let force = VARIANT::from(1_u32);
            // SAFETY: a plain variant for a documented codec property.
            let _ = unsafe { codec.SetValue(&CODECAPI_AVEncVideoForceKeyFrame, &raw const force) };
        }
        let sample = Self::sample(nv12).ok()?;
        let tick = 10_000_000 / u64::from(self.fps);
        // SAFETY: plain timing values on the new sample.
        unsafe { sample.SetSampleTime(i64::try_from(self.frame * tick).unwrap_or(i64::MAX)) }
            .ok()?;
        // SAFETY: as above.
        unsafe { sample.SetSampleDuration(i64::try_from(tick).unwrap_or(0)) }.ok()?;
        self.frame += 1;
        // SAFETY: the stream accepts input after the streaming messages.
        unsafe { self.transform.ProcessInput(0, &sample, 0) }.ok()?;
        let mut units = Vec::new();
        for _ in 0..16 {
            // SAFETY: stream 0 exists.
            let info = unsafe { self.transform.GetOutputStreamInfo(0) }.ok()?;
            let provides = info.dwFlags
                & u32::try_from(MFT_OUTPUT_STREAM_PROVIDES_SAMPLES.0).unwrap_or(0)
                != 0;
            let own = if provides {
                None
            } else {
                Some(
                    Self::sample(&vec![
                        0;
                        usize::try_from(info.cbSize.max(1 << 20))
                            .unwrap_or(1 << 20)
                    ])
                    .ok()?,
                )
            };
            let mut buffers = [MFT_OUTPUT_DATA_BUFFER {
                dwStreamID: 0,
                pSample: ManuallyDrop::new(own),
                dwStatus: 0,
                pEvents: ManuallyDrop::new(None),
            }];
            let mut status = 0_u32;
            // SAFETY: `buffers` is a valid output array for stream 0.
            let result = unsafe {
                self.transform
                    .ProcessOutput(0, &mut buffers, &raw mut status)
            };
            let [buffer] = &mut buffers;
            // SAFETY: each field is taken exactly once, so nothing leaks or is released twice.
            let produced = unsafe { ManuallyDrop::take(&mut buffer.pSample) };
            // SAFETY: as above.
            drop(unsafe { ManuallyDrop::take(&mut buffer.pEvents) });
            match result {
                Ok(()) => {
                    if let Some(bytes) = produced.as_ref().and_then(Self::read) {
                        units.push(bytes);
                    }
                }
                Err(error) if error.code() == MF_E_TRANSFORM_NEED_MORE_INPUT => break,
                Err(error) if error.code() == MF_E_TRANSFORM_STREAM_CHANGE => {
                    // SAFETY: the encoder offers its new output type at index 0.
                    let offered = unsafe { self.transform.GetOutputAvailableType(0, 0) }.ok()?;
                    // SAFETY: re-applying the encoder's own offered type.
                    unsafe { self.transform.SetOutputType(0, &offered, 0) }.ok()?;
                }
                Err(_) => return None,
            }
        }
        Some(units)
    }
}
