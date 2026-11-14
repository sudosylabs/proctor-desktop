//! macOS screen capture (`ScreenCaptureKit`) and H.264 encoding (`VideoToolbox`) for the recorder.
//! Nothing here opens a camera, a microphone or audio: only the display's pixels.

use std::ptr::NonNull;
use std::sync::mpsc::{self, Receiver, SyncSender};
use std::sync::{Arc, Mutex, PoisonError};
use std::time::Duration;

use block2::RcBlock;
use dispatch2::{DispatchQueue, DispatchRetained};
use objc2::rc::Retained;
use objc2::runtime::{NSObject, NSObjectProtocol, ProtocolObject};
use objc2::{AllocAnyThread, DefinedClass, define_class, msg_send};
use objc2_core_foundation::{CFBoolean, CFDictionary, CFNumber, CFRetained, CFString, CFType};
use objc2_core_graphics::{CGDisplayBounds, CGMainDisplayID};
use objc2_core_media::{
    CMBlockBuffer, CMFormatDescription, CMSampleBuffer, CMTime,
    CMVideoFormatDescriptionGetH264ParameterSetAtIndex, kCMSampleAttachmentKey_NotSync,
    kCMTimeInvalid, kCMVideoCodecType_H264,
};
use objc2_core_video::{
    CVPixelBuffer, CVPixelBufferCreate, CVPixelBufferGetBaseAddress, CVPixelBufferGetBytesPerRow,
    CVPixelBufferGetHeight, CVPixelBufferGetWidth, CVPixelBufferLockBaseAddress,
    CVPixelBufferLockFlags, CVPixelBufferUnlockBaseAddress, kCVPixelFormatType_32BGRA,
};
use objc2_foundation::{NSArray, NSError};
use objc2_screen_capture_kit::{
    SCContentFilter, SCShareableContent, SCStream, SCStreamConfiguration, SCStreamOutput,
    SCStreamOutputType,
};
use objc2_video_toolbox::{
    VTCompressionSession, VTEncodeInfoFlags, VTSessionSetProperty,
    kVTCompressionPropertyKey_AllowFrameReordering, kVTCompressionPropertyKey_AverageBitRate,
    kVTCompressionPropertyKey_ProfileLevel, kVTCompressionPropertyKey_RealTime,
    kVTEncodeFrameOptionKey_ForceKeyFrame, kVTProfileLevel_H264_Main_AutoLevel,
};

use crate::Rect;

const START_TIMEOUT: Duration = Duration::from_secs(5);
/// Frames waiting for the recorder; older ones are dropped, never queued without bound.
const FRAME_QUEUE: usize = 2;

/// One captured frame, BGRA.
pub struct RawFrame {
    pub width: u32,
    pub height: u32,
    pub stride: u32,
    pub bgra: Vec<u8>,
}

/// Copies a locked BGRA pixel buffer.
fn copy_pixels(buffer: &CVPixelBuffer) -> Option<RawFrame> {
    let flags = CVPixelBufferLockFlags::ReadOnly;
    // SAFETY: `buffer` is a live pixel buffer; it is unlocked below with the same flags.
    if unsafe { CVPixelBufferLockBaseAddress(buffer, flags) } != 0 {
        return None;
    }
    let width = CVPixelBufferGetWidth(buffer);
    let height = CVPixelBufferGetHeight(buffer);
    let stride = CVPixelBufferGetBytesPerRow(buffer);
    let base = CVPixelBufferGetBaseAddress(buffer);
    let frame = (!base.is_null()).then(|| {
        // SAFETY: while locked, the base address holds `stride * height` readable bytes.
        let pixels = unsafe { std::slice::from_raw_parts(base.cast::<u8>(), stride * height) };
        RawFrame {
            width: u32::try_from(width).unwrap_or(0),
            height: u32::try_from(height).unwrap_or(0),
            stride: u32::try_from(stride).unwrap_or(0),
            bgra: pixels.to_vec(),
        }
    });
    // SAFETY: balances the lock above.
    unsafe { CVPixelBufferUnlockBaseAddress(buffer, flags) };
    frame
}

/// A media time of `value / timescale` seconds.
fn media_time(value: i64, timescale: i32) -> CMTime {
    // SAFETY: building a time value has no preconditions.
    unsafe { CMTime::new(value, timescale) }
}

struct OutputIvars {
    frames: SyncSender<RawFrame>,
}

define_class!(
    // SAFETY: NSObject has no subclassing requirements and the class adds no `Drop`.
    #[unsafe(super(NSObject))]
    #[name = "PrctrScreenStreamOutput"]
    #[ivars = OutputIvars]
    struct StreamOutput;

    unsafe impl NSObjectProtocol for StreamOutput {}

    unsafe impl SCStreamOutput for StreamOutput {
        #[unsafe(method(stream:didOutputSampleBuffer:ofType:))]
        fn did_output(
            &self,
            _stream: &SCStream,
            sample: &CMSampleBuffer,
            kind: SCStreamOutputType,
        ) {
            if kind != SCStreamOutputType::Screen {
                return;
            }
            // SAFETY: `sample` is the live sample buffer ScreenCaptureKit handed over. An idle
            // frame (nothing changed) has no image buffer and is skipped.
            let Some(image) = (unsafe { sample.image_buffer() }) else {
                return;
            };
            if let Some(frame) = copy_pixels(&image) {
                let _ = self.ivars().frames.try_send(frame);
            }
        }
    }
);

impl StreamOutput {
    fn new(frames: SyncSender<RawFrame>) -> Retained<Self> {
        let this = Self::alloc().set_ivars(OutputIvars { frames });
        // SAFETY: `init` on NSObject is always valid.
        unsafe { msg_send![super(this), init] }
    }
}

/// Moves an Objective-C object between threads when only one thread uses it at a time.
struct Handoff<T>(T);
// SAFETY: each handoff value is used by exactly one thread after the move.
unsafe impl<T> Send for Handoff<T> {}

/// A running capture of the main display.
pub struct ScreenStream {
    stream: Retained<SCStream>,
    _output: Retained<StreamOutput>,
    _queue: DispatchRetained<DispatchQueue>,
    pub frames: Receiver<RawFrame>,
    /// The display in global points.
    pub display: Rect,
}

// SAFETY: the stream and output are only touched again in `Drop`; frames arrive on the
// dispatch queue and cross threads through the channel.
unsafe impl Send for ScreenStream {}

fn shareable_content() -> Option<Retained<SCShareableContent>> {
    let (sender, receiver) = mpsc::sync_channel(1);
    let block = RcBlock::new(
        move |content: *mut SCShareableContent, _error: *mut NSError| {
            // SAFETY: a non-null content pointer is a valid object; retaining it keeps it alive.
            let content = unsafe { Retained::retain(content) };
            let _ = sender.try_send(Handoff(content));
        },
    );
    // SAFETY: the block lives until ScreenCaptureKit releases it.
    unsafe { SCShareableContent::getShareableContentWithCompletionHandler(&block) };
    receiver.recv_timeout(START_TIMEOUT).ok()?.0
}

impl ScreenStream {
    /// Captures the main display at `fps`, scaled to at most `max_width` pixels wide. `None`
    /// without the Screen Recording permission or when capture cannot start.
    #[must_use]
    pub fn start(fps: u32, max_width: u32) -> Option<Self> {
        if !crate::screen_capture_allowed() {
            return None;
        }
        let main = CGMainDisplayID();
        let content = shareable_content()?;
        // SAFETY: `content` is a live shareable-content object; these are read-only accessors.
        let display = unsafe { content.displays() }
            .iter()
            .find(|display| unsafe { display.displayID() } == main)?;
        let bounds = CGDisplayBounds(main);
        let points_width = bounds.size.width.max(1.0);
        let scale = (f64::from(max_width) / (points_width * 2.0)).min(1.0);
        let even = |value: f64| {
            // Within u32 by construction: display sizes in pixels.
            #[allow(clippy::cast_possible_truncation, clippy::cast_sign_loss)]
            let value = value.round().max(2.0) as usize;
            value & !1
        };
        let width = even(points_width * 2.0 * scale);
        let height = even(bounds.size.height * 2.0 * scale);
        let excluded = NSArray::new();
        // SAFETY: `display` is a live display from the shareable content; no window is excluded.
        let filter = unsafe {
            SCContentFilter::initWithDisplay_excludingWindows(
                SCContentFilter::alloc(),
                &display,
                &excluded,
            )
        };
        // SAFETY: a new configuration has no preconditions.
        let configuration = unsafe { SCStreamConfiguration::new() };
        let interval = media_time(1, i32::try_from(fps.max(1)).unwrap_or(5));
        // SAFETY: the configuration is new and used only on this thread before capture starts;
        // the same holds for each setter below.
        unsafe { configuration.setWidth(width) };
        // SAFETY: as above.
        unsafe { configuration.setHeight(height) };
        // SAFETY: as above.
        unsafe { configuration.setMinimumFrameInterval(interval) };
        // SAFETY: as above.
        unsafe { configuration.setPixelFormat(kCVPixelFormatType_32BGRA) };
        // SAFETY: as above.
        unsafe { configuration.setShowsCursor(true) };
        // SAFETY: as above.
        unsafe { configuration.setQueueDepth(3) };
        // SAFETY: the filter and configuration are live; no delegate is needed.
        let stream = unsafe {
            SCStream::initWithFilter_configuration_delegate(
                SCStream::alloc(),
                &filter,
                &configuration,
                None,
            )
        };
        let (frames_in, frames) = mpsc::sync_channel(FRAME_QUEUE);
        let output = StreamOutput::new(frames_in);
        let queue = DispatchQueue::new("prctr.screen-recorder", None);
        // SAFETY: `output` implements the protocol and stays alive with the stream.
        unsafe {
            stream.addStreamOutput_type_sampleHandlerQueue_error(
                ProtocolObject::from_ref(&*output),
                SCStreamOutputType::Screen,
                Some(&queue),
            )
        }
        .ok()?;
        let (started_in, started) = mpsc::sync_channel(1);
        let block = RcBlock::new(move |error: *mut NSError| {
            let _ = started_in.try_send(error.is_null());
        });
        // SAFETY: the block lives until ScreenCaptureKit releases it.
        unsafe { stream.startCaptureWithCompletionHandler(Some(&block)) };
        if !started.recv_timeout(START_TIMEOUT).unwrap_or(false) {
            return None;
        }
        Some(Self {
            stream,
            _output: output,
            _queue: queue,
            frames,
            display: Rect {
                x: bounds.origin.x,
                y: bounds.origin.y,
                width: bounds.size.width,
                height: bounds.size.height,
            },
        })
    }
}

impl Drop for ScreenStream {
    fn drop(&mut self) {
        // SAFETY: stopping a started stream; no completion is needed.
        unsafe { self.stream.stopCaptureWithCompletionHandler(None) };
    }
}

/// One encoded H.264 sample: AVCC (4-byte lengths); a keyframe starts with its SPS and PPS.
pub struct EncodedFrame {
    pub data: Vec<u8>,
    pub keyframe: bool,
}

type Collected = Arc<Mutex<Vec<EncodedFrame>>>;
type ParameterSets = Arc<Mutex<Option<(Vec<u8>, Vec<u8>)>>>;

/// A `VideoToolbox` H.264 encoder that returns each frame's output synchronously.
pub struct H264Encoder {
    session: CFRetained<VTCompressionSession>,
    width: usize,
    height: usize,
    fps: i32,
    frame: i64,
    output: Collected,
    parameters: ParameterSets,
}

// SAFETY: the session is used only from the recorder thread that owns the encoder.
unsafe impl Send for H264Encoder {}

fn parameter_set(format: &CMFormatDescription, index: usize) -> Option<Vec<u8>> {
    let mut pointer: *const u8 = std::ptr::null();
    let mut size = 0_usize;
    // SAFETY: the out-parameters are valid; the returned bytes belong to `format`, which is alive.
    let status = unsafe {
        CMVideoFormatDescriptionGetH264ParameterSetAtIndex(
            format,
            index,
            &raw mut pointer,
            &raw mut size,
            std::ptr::null_mut(),
            std::ptr::null_mut(),
        )
    };
    if status != 0 || pointer.is_null() {
        return None;
    }
    // SAFETY: `pointer` holds `size` bytes while `format` lives.
    Some(unsafe { std::slice::from_raw_parts(pointer, size) }.to_vec())
}

fn is_keyframe(sample: &CMSampleBuffer) -> bool {
    // SAFETY: `sample` is live; the attachments array is read only.
    let Some(attachments) = (unsafe { sample.sample_attachments_array(false) }) else {
        return true;
    };
    if attachments.count() == 0 {
        return true;
    }
    // SAFETY: index 0 is within the array; each element is a dictionary.
    let first = unsafe { attachments.value_at_index(0) };
    if first.is_null() {
        return true;
    }
    // SAFETY: sample attachments are CoreFoundation dictionaries.
    let dictionary = unsafe { &*first.cast::<CFDictionary>() };
    // SAFETY: the key is an immutable framework constant.
    let key: &CFString = unsafe { kCMSampleAttachmentKey_NotSync };
    !super::window::value(dictionary, key)
        .and_then(|value| value.downcast_ref::<CFBoolean>())
        .is_some_and(CFBoolean::as_bool)
}

fn sample_bytes(sample: &CMSampleBuffer) -> Option<Vec<u8>> {
    // SAFETY: `sample` is live.
    let block: CFRetained<CMBlockBuffer> = unsafe { sample.data_buffer() }?;
    // SAFETY: `block` is live.
    let length = unsafe { block.data_length() };
    let mut bytes = vec![0_u8; length];
    // SAFETY: `bytes` is writable for `length` bytes.
    let status =
        unsafe { block.copy_data_bytes(0, length, NonNull::new(bytes.as_mut_ptr().cast())?) };
    (status == 0).then_some(bytes)
}

fn with_length(nal: &[u8]) -> Vec<u8> {
    let mut out = u32::try_from(nal.len()).unwrap_or(0).to_be_bytes().to_vec();
    out.extend_from_slice(nal);
    out
}

fn set(session: &VTCompressionSession, key: &CFString, value: &CFType) -> bool {
    // SAFETY: `session` is live and the key and value are valid CoreFoundation objects.
    unsafe { VTSessionSetProperty(session.as_ref(), key, Some(value)) == 0 }
}

impl H264Encoder {
    /// An encoder for `width` × `height` BGRA frames at `fps`, about `bit_rate` bits per second.
    #[must_use]
    pub fn new(width: u32, height: u32, fps: u32, bit_rate: u32) -> Option<Self> {
        let mut session: *mut VTCompressionSession = std::ptr::null_mut();
        // SAFETY: no callback is set (frames use output handlers) and `session` is a valid
        // out-parameter.
        let status = unsafe {
            VTCompressionSession::create(
                None,
                i32::try_from(width).ok()?,
                i32::try_from(height).ok()?,
                kCMVideoCodecType_H264,
                None,
                None,
                None,
                None,
                std::ptr::null_mut(),
                NonNull::from(&mut session),
            )
        };
        let session = NonNull::new(session).filter(|_| status == 0)?;
        // SAFETY: the create call returned a +1 reference that this wrapper now owns.
        let session = unsafe { CFRetained::from_raw(session) };
        let yes = CFBoolean::new(true);
        let no = CFBoolean::new(false);
        let rate = CFNumber::new_i32(i32::try_from(bit_rate).unwrap_or(i32::MAX));
        // SAFETY: the property keys are immutable framework constants.
        let configured = unsafe {
            set(&session, kVTCompressionPropertyKey_RealTime, yes.as_ref())
                && set(
                    &session,
                    kVTCompressionPropertyKey_AllowFrameReordering,
                    no.as_ref(),
                )
                && set(
                    &session,
                    kVTCompressionPropertyKey_AverageBitRate,
                    rate.as_ref(),
                )
                && set(
                    &session,
                    kVTCompressionPropertyKey_ProfileLevel,
                    kVTProfileLevel_H264_Main_AutoLevel.as_ref(),
                )
        };
        if !configured {
            return None;
        }
        Some(Self {
            session,
            width: usize::try_from(width).ok()?,
            height: usize::try_from(height).ok()?,
            fps: i32::try_from(fps.max(1)).unwrap_or(5),
            frame: 0,
            output: Arc::new(Mutex::new(Vec::new())),
            parameters: Arc::new(Mutex::new(None)),
        })
    }

    /// The stream's SPS and PPS, once the first keyframe has been encoded.
    #[must_use]
    pub fn parameter_sets(&self) -> Option<(Vec<u8>, Vec<u8>)> {
        self.parameters
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .clone()
    }

    fn pixel_buffer(&self, bgra: &[u8], stride: usize) -> Option<CFRetained<CVPixelBuffer>> {
        let mut buffer: *mut CVPixelBuffer = std::ptr::null_mut();
        // SAFETY: `buffer` is a valid out-parameter for a new BGRA buffer of the session's size.
        let status = unsafe {
            CVPixelBufferCreate(
                None,
                self.width,
                self.height,
                kCVPixelFormatType_32BGRA,
                None,
                NonNull::from(&mut buffer),
            )
        };
        let buffer = NonNull::new(buffer).filter(|_| status == 0)?;
        // SAFETY: the create call returned a +1 reference that this wrapper now owns.
        let buffer = unsafe { CFRetained::from_raw(buffer) };
        // SAFETY: the new buffer is locked for writing and unlocked below.
        if unsafe { CVPixelBufferLockBaseAddress(&buffer, CVPixelBufferLockFlags(0)) } != 0 {
            return None;
        }
        let base = CVPixelBufferGetBaseAddress(&buffer).cast::<u8>();
        let target_stride = CVPixelBufferGetBytesPerRow(&buffer);
        let row = (self.width * 4).min(stride).min(target_stride);
        if !base.is_null() {
            for line in 0..self.height {
                let Some(source) = bgra.get(line * stride..line * stride + row) else {
                    break;
                };
                let target = base.wrapping_add(line * target_stride);
                // SAFETY: the locked buffer has `target_stride` writable bytes per row and `row`
                // is no wider than a row; `source` is a separate allocation.
                unsafe { std::ptr::copy_nonoverlapping(source.as_ptr(), target, row) };
            }
        }
        // SAFETY: balances the lock above.
        unsafe { CVPixelBufferUnlockBaseAddress(&buffer, CVPixelBufferLockFlags(0)) };
        Some(buffer)
    }

    /// Encodes one frame and returns its output; `keyframe` forces an IDR frame.
    pub fn encode(
        &mut self,
        bgra: &[u8],
        stride: u32,
        keyframe: bool,
    ) -> Option<Vec<EncodedFrame>> {
        let buffer = self.pixel_buffer(bgra, usize::try_from(stride).ok()?)?;
        let output = Arc::clone(&self.output);
        let parameters = Arc::clone(&self.parameters);
        let handler = RcBlock::new(
            move |status: i32, _flags: VTEncodeInfoFlags, sample: *mut CMSampleBuffer| {
                if status != 0 || sample.is_null() {
                    return;
                }
                // SAFETY: a non-null sample is valid for the duration of the handler.
                let sample = unsafe { &*sample };
                let Some(mut data) = sample_bytes(sample) else {
                    return;
                };
                let key = is_keyframe(sample);
                if key {
                    // SAFETY: `sample` is live.
                    let format = unsafe { sample.format_description() };
                    if let Some(format) = format
                        && let (Some(sps), Some(pps)) =
                            (parameter_set(&format, 0), parameter_set(&format, 1))
                    {
                        let mut prefixed = with_length(&sps);
                        prefixed.extend_from_slice(&with_length(&pps));
                        prefixed.extend_from_slice(&data);
                        data = prefixed;
                        *parameters.lock().unwrap_or_else(PoisonError::into_inner) =
                            Some((sps, pps));
                    }
                }
                output
                    .lock()
                    .unwrap_or_else(PoisonError::into_inner)
                    .push(EncodedFrame {
                        data,
                        keyframe: key,
                    });
            },
        );
        let force = CFDictionary::<CFString, CFType>::from_slices(
            // SAFETY: the option key is an immutable framework constant.
            &[unsafe { kVTEncodeFrameOptionKey_ForceKeyFrame }],
            &[CFBoolean::new(true).as_ref()],
        );
        let time = media_time(self.frame, self.fps);
        self.frame += 1;
        // SAFETY: the session and buffer are live, the handler block outlives the call (frames
        // are completed below before it is dropped), and no info flags are requested.
        let status = unsafe {
            self.session.encode_frame_with_output_handler(
                &buffer,
                time,
                media_time(1, self.fps),
                keyframe.then_some(force.as_opaque()),
                std::ptr::null_mut(),
                RcBlock::as_ptr(&handler),
            )
        };
        if status != 0 {
            return None;
        }
        // SAFETY: completing every pending frame makes the output synchronous.
        if unsafe { self.session.complete_frames(kCMTimeInvalid) } != 0 {
            return None;
        }
        Some(std::mem::take(
            &mut *self.output.lock().unwrap_or_else(PoisonError::into_inner),
        ))
    }
}

impl Drop for H264Encoder {
    fn drop(&mut self) {
        // SAFETY: the session is live and invalidated once.
        unsafe { self.session.invalidate() };
    }
}
