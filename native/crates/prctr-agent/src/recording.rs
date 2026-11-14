//! Wires the screen recorder into the agent: starting it at confirmation, and turning its events
//! into protocol notifications.

use std::path::PathBuf;
use std::sync::Arc;
use std::sync::mpsc::Sender;
use std::time::{SystemTime, UNIX_EPOCH};

use prctr_protocol::messages::Notification;
use prctr_protocol::recording::{
    ClipFailureCode, ClipOutcome, ClipReady, MediaType, RecorderState, RecordingGap,
    RecordingGapReason, RecordingStart,
};
use prctr_protocol::scalars::{Count, Digest, LocalPath, OpaqueId, Secret};
use prctr_recorder::clip::{self, CHUNK_BYTES};
use prctr_recorder::{
    ClipFailure, Encoder, FrameSource, Gap, GapReason, Recorder, RecorderConfig, RecorderEvent,
    Rect,
};

use crate::agent::Event;

/// Bytes kept free on the recording's volume; below it the recorder stops with a failure gap.
pub const RESERVE_BYTES: u64 = 512 * 1024 * 1024;

pub type Backend = Box<dyn Fn() -> Option<(Box<dyn FrameSource>, Box<dyn Encoder>)> + Send>;
pub type Placeholder = Arc<dyn Fn() -> Option<Rect> + Send + Sync>;

/// How this build records: the platform backend, or a scripted one in test builds.
pub struct RecorderSetup {
    pub backend: Backend,
    pub placeholder: Placeholder,
}

pub fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |elapsed| {
            u64::try_from(elapsed.as_millis()).unwrap_or(u64::MAX)
        })
}

/// Starts or resumes the recording; `None` when this platform cannot record or the recording
/// does not open with the key.
pub fn start(
    setup: &RecorderSetup,
    start: &RecordingStart,
    events: Sender<Event>,
) -> Option<Recorder> {
    let (source, encoder) = (setup.backend)()?;
    let config = RecorderConfig {
        dir: PathBuf::from(start.directory.as_str()),
        recording_id: start.recording_id.as_str().to_owned(),
        key: start.key.bytes(),
        fps: prctr_recorder::platform::FPS,
        segment_ms: 2_000,
        reserve_bytes: RESERVE_BYTES,
        chunk_bytes: CHUNK_BYTES,
        placeholder: Arc::clone(&setup.placeholder),
        free_space: Arc::new(prctr_recorder::platform::free_space),
        now_ms: Arc::new(now_ms),
    };
    Recorder::start(config, source, encoder, move |event| {
        let _ = events.send(Event::Recorder(event));
    })
    .ok()
}

fn count(value: u64) -> Count {
    Count::new(value).unwrap_or(Count::ZERO)
}

/// A SHA-256 hash in hex is always 64 lowercase hex digits.
fn digest(hash: &[u8; 32]) -> Digest {
    Digest::new(clip::hex(hash)).expect("a SHA-256 hash is a digest")
}

fn gap(gap: &Gap) -> RecordingGap {
    RecordingGap {
        start_ms: count(gap.start_ms),
        end_ms: count(gap.end_ms),
        reason: match gap.reason {
            GapReason::Interruption => RecordingGapReason::Interruption,
            GapReason::Restart => RecordingGapReason::Restart,
            GapReason::Failure => RecordingGapReason::Failure,
        },
    }
}

/// The notification for one recorder event.
pub fn notification(event: RecorderEvent) -> Notification {
    match event {
        RecorderEvent::State { state, gaps } => Notification::Recorder {
            state: match state {
                prctr_recorder::RecorderState::Recording => RecorderState::Recording,
                prctr_recorder::RecorderState::Stopped => RecorderState::Stopped,
                prctr_recorder::RecorderState::Failed => RecorderState::Failed,
            },
            gaps: gaps.iter().map(gap).collect(),
        },
        RecorderEvent::Clip { request_id, result } => {
            // The recorder echoes the id the agent took from a validated request.
            let clip_request_id = OpaqueId::new(request_id).expect("a clip request id round-trips");
            let failed = |code| ClipOutcome::Failed { code };
            let outcome = match result {
                Ok(manifest) => ready(&manifest)
                    .map_or_else(|| failed(ClipFailureCode::Failed), ClipOutcome::Ready),
                Err(ClipFailure::Empty) => failed(ClipFailureCode::Empty),
                Err(ClipFailure::TooLarge) => failed(ClipFailureCode::TooLarge),
                Err(ClipFailure::Failed) => failed(ClipFailureCode::Failed),
            };
            Notification::Clip {
                clip_request_id,
                outcome,
            }
        }
    }
}

fn ready(manifest: &prctr_recorder::ClipManifest) -> Option<ClipReady> {
    Some(ClipReady {
        path: LocalPath::new(manifest.path.to_str()?).ok()?,
        key: Secret::from_bytes(&manifest.key),
        media_type: MediaType::Mp4,
        // A clip is at most MAX_CLIP_BYTES (3 GiB), far below a count's limit.
        size_bytes: count(manifest.size_bytes),
        chunk_bytes: count(CHUNK_BYTES as u64),
        chunk_sha256: manifest.chunk_sha256.iter().map(digest).collect(),
        content_digest: digest(&manifest.content_digest),
        start_ms: count(manifest.start_ms),
        end_ms: count(manifest.end_ms),
        gaps: manifest.gaps.iter().map(gap).collect(),
    })
}
