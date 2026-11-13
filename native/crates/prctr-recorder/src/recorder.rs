//! The recorder thread: frames in, sealed segments out, clips cut on request. One thread owns the
//! store; the agent talks to it through commands and hears back through events.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::sync::mpsc::{self, Receiver, RecvTimeoutError, Sender};
use std::thread::{self, JoinHandle};
use std::time::Duration;

use crate::clip::{self, ClipError, ClipManifest, ClipRange};
use crate::media::{EncodedSample, Encoder, FrameSource, Rect};
use crate::mp4;
use crate::store::{Gap, GapReason, Store};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum RecorderState {
    Recording,
    /// Stopped on request.
    Stopped,
    /// Capture, encoding or the disk failed; what was recorded can still be cut.
    Failed,
}

/// Why a clip could not be cut.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ClipFailure {
    /// Nothing was recorded in the range.
    Empty,
    TooLarge,
    Failed,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum RecorderEvent {
    State {
        state: RecorderState,
        gaps: Vec<Gap>,
    },
    Clip {
        request_id: String,
        result: Result<ClipManifest, ClipFailure>,
    },
}

/// Why a save request was refused at once.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SaveRefusal {
    InvalidRange,
    /// The recorder thread has ended.
    Stopped,
}

/// What happens to the recording when the recorder stops.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Disposition {
    /// Submission or expiry: the recording is deleted.
    Delete,
    /// Suspension: the recording is kept for re-entry with the same key.
    Seal,
}

type Clock = Arc<dyn Fn() -> u64 + Send + Sync>;
type Placeholder = Arc<dyn Fn() -> Option<Rect> + Send + Sync>;
type FreeSpace = Arc<dyn Fn(&Path) -> Option<u64> + Send + Sync>;

pub struct RecorderConfig {
    pub dir: PathBuf,
    pub recording_id: String,
    pub key: [u8; 32],
    pub fps: u32,
    pub segment_ms: u64,
    /// Below this much free space the recorder stops with a failure gap.
    pub reserve_bytes: u64,
    pub chunk_bytes: usize,
    /// Proctor's own window, in global points, to blank in every frame.
    pub placeholder: Placeholder,
    pub free_space: FreeSpace,
    /// Wall-clock now, unix ms.
    pub now_ms: Clock,
}

enum Command {
    Save {
        request_id: String,
        range: ClipRange,
    },
    Release {
        request_id: String,
    },
    Interrupted,
    Stop {
        disposition: Disposition,
        done: Sender<()>,
    },
}

/// A running recorder.
pub struct Recorder {
    commands: Sender<Command>,
    thread: Option<JoinHandle<()>>,
}

struct Current {
    start_ms: u64,
    last_ms: u64,
    samples: Vec<EncodedSample>,
}

struct Worker {
    config: RecorderConfig,
    store: Store,
    source: Box<dyn FrameSource>,
    encoder: Box<dyn Encoder>,
    report: Box<dyn Fn(RecorderEvent) + Send>,
    state: RecorderState,
    current: Option<Current>,
    has_init: bool,
    pending: Vec<(String, ClipRange)>,
    clips: BTreeMap<String, PathBuf>,
}

impl Recorder {
    /// Opens (or resumes) the recording and starts recording.
    ///
    /// # Errors
    /// When the recording cannot be opened, for example with the wrong key.
    pub fn start(
        config: RecorderConfig,
        source: Box<dyn FrameSource>,
        encoder: Box<dyn Encoder>,
        report: impl Fn(RecorderEvent) + Send + 'static,
    ) -> Result<Self, crate::store::StoreError> {
        let (store, _) = Store::open(
            &config.dir,
            &config.recording_id,
            &config.key,
            (config.now_ms)(),
        )?;
        std::fs::create_dir_all(config.dir.join("clips"))?;
        let (commands, receiver) = mpsc::channel();
        let mut worker = Worker {
            config,
            store,
            source,
            encoder,
            report: Box::new(report),
            state: RecorderState::Recording,
            current: None,
            has_init: false,
            pending: Vec::new(),
            clips: BTreeMap::new(),
        };
        worker.has_init = worker.store.init().is_ok();
        let thread = thread::Builder::new()
            .name("prctr-recorder".to_owned())
            .spawn(move || worker.run(&receiver))
            .map_err(crate::store::StoreError::Io)?;
        Ok(Self {
            commands,
            thread: Some(thread),
        })
    }

    /// Queues a save; the clip arrives as an event once the range has been recorded. A repeated
    /// request ID is accepted and ignored.
    ///
    /// # Errors
    /// When the range is malformed or the recorder has ended.
    pub fn save(&self, request_id: &str, range: ClipRange) -> Result<(), SaveRefusal> {
        let valid = (range.from_session_start
            || range.start_ms.is_some_and(|start| start < range.end_ms))
            && !request_id.is_empty();
        if !valid {
            return Err(SaveRefusal::InvalidRange);
        }
        self.commands
            .send(Command::Save {
                request_id: request_id.to_owned(),
                range,
            })
            .map_err(|_| SaveRefusal::Stopped)
    }

    /// Deletes an uploaded clip.
    pub fn release(&self, request_id: &str) {
        let _ = self.commands.send(Command::Release {
            request_id: request_id.to_owned(),
        });
    }

    /// The machine slept or the session was interrupted: closes the open segment, and the time
    /// until the next frame is a gap.
    pub fn interrupted(&self) {
        let _ = self.commands.send(Command::Interrupted);
    }

    /// Stops recording, fails saves not yet cut, then deletes or keeps the recording.
    pub fn stop(mut self, disposition: Disposition) {
        let (done, wait) = mpsc::channel();
        if self
            .commands
            .send(Command::Stop { disposition, done })
            .is_ok()
        {
            let _ = wait.recv();
        }
        if let Some(thread) = self.thread.take() {
            let _ = thread.join();
        }
    }
}

impl Worker {
    fn frame_interval(&self) -> Duration {
        Duration::from_millis(1_000 / u64::from(self.config.fps.max(1)))
    }

    fn run(&mut self, commands: &Receiver<Command>) {
        self.emit_state();
        loop {
            loop {
                match commands.try_recv() {
                    Ok(Command::Stop { disposition, done }) => {
                        self.finish(disposition);
                        let _ = done.send(());
                        return;
                    }
                    Ok(command) => self.command(command),
                    Err(mpsc::TryRecvError::Empty) => break,
                    Err(mpsc::TryRecvError::Disconnected) => {
                        self.finish(Disposition::Seal);
                        return;
                    }
                }
            }
            if self.state == RecorderState::Recording {
                self.capture();
            } else {
                match commands.recv_timeout(self.frame_interval()) {
                    Ok(Command::Stop { disposition, done }) => {
                        self.finish(disposition);
                        let _ = done.send(());
                        return;
                    }
                    Ok(command) => self.command(command),
                    Err(RecvTimeoutError::Timeout) => {}
                    Err(RecvTimeoutError::Disconnected) => {
                        self.finish(Disposition::Seal);
                        return;
                    }
                }
            }
            self.complete_due();
        }
    }

    fn command(&mut self, command: Command) {
        match command {
            Command::Save { request_id, range } => {
                let known = self.pending.iter().any(|(id, _)| *id == request_id)
                    || self.clips.contains_key(&request_id);
                if !known {
                    self.pending.push((request_id, range));
                }
            }
            Command::Release { request_id } => {
                if let Some(path) = self.clips.remove(&request_id) {
                    let _ = std::fs::remove_file(path);
                }
            }
            Command::Interrupted => {
                let now = (self.config.now_ms)();
                let since = self.current.as_ref().map(|current| current.last_ms);
                self.close_segment(now);
                if let Some(since) = since {
                    let _ = self.store.add_gap(Gap {
                        start_ms: since,
                        end_ms: now,
                        reason: GapReason::Interruption,
                    });
                }
            }
            Command::Stop { .. } => {}
        }
    }

    fn capture(&mut self) {
        let frame = match self.source.next_frame(self.frame_interval() * 2) {
            Ok(Some(frame)) => frame,
            Ok(None) => return,
            Err(_) => return self.fail(),
        };
        let mut frame = frame;
        if let Some(area) = (self.config.placeholder)() {
            frame.fill_placeholder(area);
        }
        // A segment is due after `segment_ms`: the encoder is asked for a keyframe, and the segment
        // closes when the keyframe arrives (an encoder may deliver it a frame late).
        let due = self.current.as_ref().is_none_or(|current| {
            frame.captured_ms.saturating_sub(current.start_ms) >= self.config.segment_ms
        });
        let Ok(samples) = self.encoder.encode(&frame, due) else {
            return self.fail();
        };
        if !self.has_init
            && let Some(format) = self.encoder.format()
        {
            if self.store.set_init(&mp4::init_segment(&format)).is_err() {
                return self.fail();
            }
            self.has_init = true;
        }
        for sample in samples {
            if sample.keyframe && self.current.is_some() {
                self.close_segment(frame.captured_ms);
            }
            match self.current.as_mut() {
                Some(current) => {
                    current.samples.push(sample);
                    current.last_ms = frame.captured_ms;
                }
                // A segment always starts with a keyframe; anything before the first is dropped.
                None if sample.keyframe => {
                    self.current = Some(Current {
                        start_ms: frame.captured_ms,
                        last_ms: frame.captured_ms,
                        samples: vec![sample],
                    });
                }
                None => {}
            }
        }
    }

    fn close_segment(&mut self, end_ms: u64) {
        let Some(current) = self.current.take() else {
            return;
        };
        if current.samples.is_empty() {
            return;
        }
        let interval = u64::try_from(self.frame_interval().as_millis()).unwrap_or(200);
        let end_ms = end_ms
            .max(current.last_ms + interval)
            .min(current.last_ms + interval * 2);
        let count = u64::try_from(current.samples.len()).unwrap_or(1).max(1);
        let duration = u32::try_from((end_ms - current.start_ms) / count)
            .unwrap_or(u32::MAX)
            .max(1);
        let decode_ms = self.store.decode_ms(current.start_ms);
        let sequence = u32::try_from(self.store.segments().len() + 1).unwrap_or(u32::MAX);
        let fragment = mp4::fragment(sequence, decode_ms, duration, &current.samples);
        if self
            .store
            .append(current.start_ms, end_ms, decode_ms, &fragment)
            .is_err()
        {
            return self.fail();
        }
        let free = (self.config.free_space)(self.store.dir());
        if free.is_some_and(|free| free < self.config.reserve_bytes) {
            self.fail();
        }
    }

    fn fail(&mut self) {
        if self.state != RecorderState::Recording {
            return;
        }
        let now = (self.config.now_ms)();
        let since = self
            .current
            .as_ref()
            .map(|current| current.last_ms)
            .or_else(|| self.store.segments().last().map(|segment| segment.end_ms))
            .unwrap_or(now);
        self.current = None;
        let _ = self.store.add_gap(Gap {
            start_ms: since,
            end_ms: now.max(since + 1),
            reason: GapReason::Failure,
        });
        self.state = RecorderState::Failed;
        self.emit_state();
    }

    fn emit_state(&self) {
        (self.report)(RecorderEvent::State {
            state: self.state,
            gaps: self.store.gaps().to_vec(),
        });
    }

    /// Cuts every save whose range has been recorded, or can no longer grow.
    fn complete_due(&mut self) {
        let recorded = self
            .store
            .segments()
            .last()
            .map_or(0, |segment| segment.end_ms);
        let now = (self.config.now_ms)();
        let grace = self.config.segment_ms * 2;
        let growing = self.state == RecorderState::Recording;
        let due: Vec<_> = self
            .pending
            .iter()
            .filter(|(_, range)| !growing || range.end_ms <= recorded || now > range.end_ms + grace)
            .cloned()
            .collect();
        self.pending.retain(|pending| !due.contains(pending));
        for (request_id, range) in due {
            self.cut(request_id, &range);
        }
    }

    fn cut(&mut self, request_id: String, range: &ClipRange) {
        let path = self
            .config
            .dir
            .join("clips")
            .join(format!("{}.clip", clip::hex(request_id.as_bytes())));
        let result =
            clip::cut(&self.store, range, &path, self.config.chunk_bytes).map_err(|error| {
                match error {
                    ClipError::Empty | ClipError::InvalidRange => ClipFailure::Empty,
                    ClipError::TooLarge => ClipFailure::TooLarge,
                    ClipError::Random | ClipError::Store(_) => ClipFailure::Failed,
                }
            });
        if result.is_ok() {
            self.clips.insert(request_id.clone(), path);
        }
        (self.report)(RecorderEvent::Clip { request_id, result });
    }

    fn finish(&mut self, disposition: Disposition) {
        let now = (self.config.now_ms)();
        self.close_segment(now);
        if self.state == RecorderState::Recording {
            self.state = RecorderState::Stopped;
        }
        // Stopping must be quick: a save not yet cut fails rather than holding up the close. At
        // deletion it would be removed anyway; on re-entry the server delivers it again.
        for (request_id, _) in std::mem::take(&mut self.pending) {
            (self.report)(RecorderEvent::Clip {
                request_id,
                result: Err(ClipFailure::Failed),
            });
        }
        self.emit_state();
        if disposition == Disposition::Delete {
            let dir = self.store.dir().to_path_buf();
            let _ = std::fs::remove_dir_all(dir);
        }
    }
}

#[cfg(test)]
#[path = "recorder_tests.rs"]
mod tests;
