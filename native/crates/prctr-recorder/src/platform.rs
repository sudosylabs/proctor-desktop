//! This platform's capture and encoder for the recorder.

use std::time::{Duration, SystemTime, UNIX_EPOCH};

use crate::media::{Encoder, Frame, FrameSource, Rect};

/// Recording frames per second.
pub const FPS: u32 = 5;
/// Frames are scaled down to at most this width.
pub const MAX_WIDTH: u32 = 1_920;
/// Average H.264 bit rate.
pub const BIT_RATE: u32 = 1_000_000;

#[cfg_attr(not(any(target_os = "macos", target_os = "windows")), allow(dead_code))]
fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |elapsed| {
            u64::try_from(elapsed.as_millis()).unwrap_or(u64::MAX)
        })
}

/// Starts capturing the display and opens an H.264 encoder, or `None` where this platform cannot
/// record (no permission, no capture API, or Linux).
#[must_use]
pub fn backend() -> Option<(Box<dyn FrameSource>, Box<dyn Encoder>)> {
    imp::backend()
}

/// Bytes available on the volume holding `path`.
#[must_use]
pub fn free_space(path: &std::path::Path) -> Option<u64> {
    prctr_os::free_space(path)
}

/// A captured image before it becomes a [`Frame`]: width, height, stride, pixels, display.
#[cfg_attr(not(any(target_os = "macos", target_os = "windows")), allow(dead_code))]
type Received = Option<(u32, u32, u32, Vec<u8>, Rect)>;

/// Turns change-driven capture into a steady frame rate: when the screen is still, the last frame
/// is repeated, so segments keep closing and future saves keep completing.
#[cfg_attr(not(any(target_os = "macos", target_os = "windows")), allow(dead_code))]
struct Steady<F> {
    receive: F,
    last: Option<Frame>,
}

impl<F> Steady<F>
where
    F: FnMut(Duration) -> Result<Received, String>,
{
    #[cfg_attr(not(any(target_os = "macos", target_os = "windows")), allow(dead_code))]
    fn next(&mut self, timeout: Duration) -> Result<Option<Frame>, String> {
        let interval = Duration::from_millis(1_000 / u64::from(FPS));
        match (self.receive)(interval.min(timeout))? {
            Some((width, height, stride, bgra, display)) => {
                let frame = Frame {
                    width,
                    height,
                    stride,
                    bgra,
                    captured_ms: now_ms(),
                    display,
                };
                self.last = Some(frame.clone());
                Ok(Some(frame))
            }
            None => Ok(self.last.as_ref().map(|last| Frame {
                captured_ms: now_ms(),
                ..last.clone()
            })),
        }
    }
}

#[cfg(target_os = "macos")]
mod imp {
    use std::sync::mpsc::RecvTimeoutError;
    use std::time::Duration;

    use prctr_os::macos::{H264Encoder, ScreenStream};

    use super::{BIT_RATE, FPS, MAX_WIDTH, Steady};
    use crate::media::{EncodedSample, Encoder, Frame, FrameSource, Rect, StreamFormat};

    struct Capture {
        stream: ScreenStream,
        last: Option<Frame>,
    }

    impl FrameSource for Capture {
        fn next_frame(&mut self, timeout: Duration) -> Result<Option<Frame>, String> {
            let display = Rect {
                x: self.stream.display.x,
                y: self.stream.display.y,
                width: self.stream.display.width,
                height: self.stream.display.height,
            };
            let frames = &self.stream.frames;
            let last = self.last.take();
            let mut steady = Steady {
                receive: |wait: Duration| match frames.recv_timeout(wait) {
                    Ok(frame) => Ok(Some((
                        frame.width,
                        frame.height,
                        frame.stride,
                        frame.bgra,
                        display,
                    ))),
                    Err(RecvTimeoutError::Timeout) => Ok(None),
                    Err(RecvTimeoutError::Disconnected) => Err("screen capture stopped".to_owned()),
                },
                last,
            };
            let result = steady.next(timeout);
            self.last = steady.last;
            result
        }
    }

    struct VideoToolbox {
        encoder: Option<H264Encoder>,
        size: (u16, u16),
    }

    impl Encoder for VideoToolbox {
        fn encode(&mut self, frame: &Frame, keyframe: bool) -> Result<Vec<EncodedSample>, String> {
            if self.encoder.is_none() {
                self.encoder = H264Encoder::new(frame.width, frame.height, FPS, BIT_RATE);
                self.size = (
                    u16::try_from(frame.width).unwrap_or(u16::MAX),
                    u16::try_from(frame.height).unwrap_or(u16::MAX),
                );
            }
            let samples = self
                .encoder
                .as_mut()
                .ok_or("the H.264 encoder did not open")?
                .encode(&frame.bgra, frame.stride, keyframe)
                .ok_or("the H.264 encoder failed")?;
            Ok(samples
                .into_iter()
                .map(|sample| EncodedSample {
                    data: sample.data,
                    keyframe: sample.keyframe,
                })
                .collect())
        }

        fn format(&self) -> Option<StreamFormat> {
            let (sps, pps) = self.encoder.as_ref()?.parameter_sets()?;
            Some(StreamFormat {
                width: self.size.0,
                height: self.size.1,
                sps,
                pps,
            })
        }
    }

    pub fn backend() -> Option<(Box<dyn FrameSource>, Box<dyn Encoder>)> {
        let stream = ScreenStream::start(FPS, MAX_WIDTH)?;
        Some((
            Box::new(Capture { stream, last: None }),
            Box::new(VideoToolbox {
                encoder: None,
                size: (0, 0),
            }),
        ))
    }
}

#[cfg(target_os = "windows")]
mod imp {
    use std::time::Duration;

    use prctr_os::windows::{H264Mft, ScreenCapture};

    use super::{BIT_RATE, FPS, MAX_WIDTH, Steady};
    use crate::convert::{annex_b_to_avcc, bgra_to_nv12, downscale_bgra};
    use crate::media::{EncodedSample, Encoder, Frame, FrameSource, Rect, StreamFormat};

    struct Capture {
        capture: ScreenCapture,
        last: Option<Frame>,
    }

    impl FrameSource for Capture {
        fn next_frame(&mut self, timeout: Duration) -> Result<Option<Frame>, String> {
            let display = Rect {
                x: self.capture.display.x,
                y: self.capture.display.y,
                width: self.capture.display.width,
                height: self.capture.display.height,
            };
            let capture = &mut self.capture;
            let mut steady = Steady {
                receive: |wait: Duration| {
                    Ok(capture.next(wait)?.map(|frame| {
                        let (width, height, stride, bgra) = downscale_bgra(
                            frame.width,
                            frame.height,
                            frame.stride,
                            &frame.bgra,
                            MAX_WIDTH,
                        );
                        (width, height, stride, bgra, display)
                    }))
                },
                last: self.last.take(),
            };
            let result = steady.next(timeout);
            self.last = steady.last;
            result
        }
    }

    struct MediaFoundation {
        encoder: Option<H264Mft>,
        size: (u16, u16),
        parameters: Option<(Vec<u8>, Vec<u8>)>,
    }

    impl Encoder for MediaFoundation {
        fn encode(&mut self, frame: &Frame, keyframe: bool) -> Result<Vec<EncodedSample>, String> {
            let (width, height, nv12) =
                bgra_to_nv12(frame.width, frame.height, frame.stride, &frame.bgra);
            if self.encoder.is_none() {
                self.encoder = H264Mft::new(width, height, FPS, BIT_RATE);
                self.size = (
                    u16::try_from(width).unwrap_or(u16::MAX),
                    u16::try_from(height).unwrap_or(u16::MAX),
                );
            }
            let units = self
                .encoder
                .as_mut()
                .ok_or("the H.264 encoder did not open")?
                .encode(&nv12, keyframe)
                .ok_or("the H.264 encoder failed")?;
            Ok(units
                .iter()
                .map(|unit| {
                    let unit = annex_b_to_avcc(unit);
                    if let (Some(sps), Some(pps)) = (&unit.sps, &unit.pps) {
                        self.parameters = Some((sps.clone(), pps.clone()));
                    }
                    EncodedSample {
                        data: unit.avcc,
                        keyframe: unit.keyframe,
                    }
                })
                .collect())
        }

        fn format(&self) -> Option<StreamFormat> {
            let (sps, pps) = self.parameters.clone()?;
            Some(StreamFormat {
                width: self.size.0,
                height: self.size.1,
                sps,
                pps,
            })
        }
    }

    pub fn backend() -> Option<(Box<dyn FrameSource>, Box<dyn Encoder>)> {
        let capture = ScreenCapture::start()?;
        Some((
            Box::new(Capture {
                capture,
                last: None,
            }),
            Box::new(MediaFoundation {
                encoder: None,
                size: (0, 0),
                parameters: None,
            }),
        ))
    }
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
mod imp {
    use crate::media::{Encoder, FrameSource};

    pub fn backend() -> Option<(Box<dyn FrameSource>, Box<dyn Encoder>)> {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_still_screen_repeats_the_last_frame_with_a_fresh_time() {
        let display = Rect {
            x: 0.0,
            y: 0.0,
            width: 1.0,
            height: 1.0,
        };
        let mut first = Some((1_u32, 1_u32, 4_u32, vec![9_u8; 4], display));
        let mut steady = Steady {
            receive: move |_wait: Duration| Ok(first.take()),
            last: None,
        };
        let fresh = steady
            .next(Duration::from_millis(1))
            .expect("ok")
            .expect("a frame");
        let repeated = steady
            .next(Duration::from_millis(1))
            .expect("ok")
            .expect("repeated");
        assert_eq!(repeated.bgra, fresh.bgra);
        assert!(repeated.captured_ms >= fresh.captured_ms);
    }

    #[test]
    fn nothing_is_repeated_before_the_first_frame() {
        let mut steady = Steady {
            receive: |_wait: Duration| Ok(None),
            last: None,
        };
        assert_eq!(steady.next(Duration::from_millis(1)), Ok(None));
    }
}

/// Real OS, opt-in: records this machine's screen for about 6 seconds into a temporary
/// directory, cuts a clip, checks it, and deletes everything. Needs the Screen Recording
/// permission for the process running the tests, and `PRCTR_ALLOW_SCREEN_CAPTURE=1`.
#[cfg(all(test, any(target_os = "macos", target_os = "windows")))]
mod real_os {
    use std::sync::Arc;
    use std::sync::mpsc;

    use super::*;
    use crate::clip::{self, CHUNK_BYTES, ClipRange};
    use crate::mp4::walker;
    use crate::recorder::{Disposition, Recorder, RecorderConfig, RecorderEvent};

    #[test]
    fn this_machine_records_a_clip_with_keyframe_segments_and_the_placeholder() {
        if std::env::var_os("PRCTR_ALLOW_SCREEN_CAPTURE").is_none() {
            return;
        }
        assert!(
            prctr_os::screen_capture_allowed(),
            "grant Screen Recording to the test runner"
        );
        let (source, encoder) = backend().expect("capture and the encoder start");
        let dir = std::env::temp_dir().join(format!("prctr-real-recording-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let (sender, events) = mpsc::channel();
        let sender = std::sync::Mutex::new(sender);
        let recorder = Recorder::start(
            RecorderConfig {
                dir: dir.clone(),
                recording_id: "real-recording".to_owned(),
                key: [5; 32],
                fps: FPS,
                segment_ms: 2_000,
                reserve_bytes: 0,
                chunk_bytes: CHUNK_BYTES,
                placeholder: Arc::new(|| {
                    Some(Rect {
                        x: 0.0,
                        y: 0.0,
                        width: 200.0,
                        height: 200.0,
                    })
                }),
                free_space: Arc::new(free_space),
                now_ms: Arc::new(now_ms),
            },
            source,
            encoder,
            move |event| {
                let _ = sender.lock().map(|sender| sender.send(event));
            },
        )
        .expect("records");
        let end = now_ms() + 6_000;
        recorder
            .save(
                "real",
                ClipRange {
                    from_session_start: true,
                    start_ms: None,
                    end_ms: end,
                },
            )
            .expect("accepted");
        let manifest = loop {
            if let RecorderEvent::Clip { result, .. } = events
                .recv_timeout(Duration::from_secs(20))
                .expect("an event")
            {
                break result.expect("a clip");
            }
        };
        let mp4 = clip::open(&manifest, CHUNK_BYTES).expect("opens");
        let boxes = walker::boxes(&mp4);
        let fragments = boxes.iter().filter(|found| &found.kind == b"moof").count();
        assert!(fragments >= 2, "segments of 2 s: {fragments}");
        let avcc = walker::find(
            &mp4,
            &[
                b"moov", b"trak", b"mdia", b"minf", b"stbl", b"stsd", b"avc3", b"avcC",
            ],
        );
        assert_eq!(
            avcc[0], 1,
            "an H.264 configuration record from VideoToolbox"
        );
        if let Ok(probe) = std::process::Command::new("ffprobe")
            .args([
                "-v",
                "error",
                "-show_entries",
                "stream=codec_name,width",
                "-of",
                "csv=p=0",
                "-",
            ])
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .spawn()
        {
            use std::io::Write as _;
            let mut probe = probe;
            if let Some(mut input) = probe.stdin.take() {
                let _ = input.write_all(&mp4);
            }
            let output = probe.wait_with_output().expect("ffprobe runs");
            assert!(
                String::from_utf8_lossy(&output.stdout).starts_with("h264"),
                "ffprobe reads it"
            );
        }
        recorder.stop(Disposition::Delete);
        assert!(!dir.exists());
    }
}
