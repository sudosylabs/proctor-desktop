//! Screen recording messages: starting the recording, clip saves and their outcomes.

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

use crate::scalars::{Count, Digest, LocalPath, OpaqueId, Secret};

/// Starts (or resumes) the recording when the policy enables it. Electron main keeps the key
/// sealed in the OS keystore and passes the same key on re-entry; the agent never stores it.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct RecordingStart {
    pub recording_id: OpaqueId,
    pub key: Secret,
    /// Where the encrypted recording lives; created if missing.
    pub directory: LocalPath,
}

/// The range a save asks for, unix ms. `from_session_start` replaces `start_ms`.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct ClipRange {
    pub from_session_start: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub start_ms: Option<Count>,
    pub end_ms: Count,
}

/// What happens to the recording at `close`.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum CloseDisposition {
    /// Submission, expiry or departure: the recording is deleted after pending saves.
    Delete,
    /// Suspension: kept for re-entry with the same key.
    Seal,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum RecorderState {
    Recording,
    Stopped,
    /// Capture, encoding or the disk failed; what was recorded can still be cut.
    Failed,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum RecordingGapReason {
    Interruption,
    Restart,
    Failure,
}

/// A span of the recording with no video, unix ms.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct RecordingGap {
    pub start_ms: Count,
    pub end_ms: Count,
    pub reason: RecordingGapReason,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize, JsonSchema)]
pub enum MediaType {
    #[serde(rename = "video/mp4")]
    Mp4,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum ClipFailureCode {
    /// Nothing was recorded in the range.
    Empty,
    /// Beyond the server's 3 GiB or 384-chunk bound.
    TooLarge,
    Failed,
}

/// A clip ready to upload. The file holds one ChaCha20-Poly1305 record per upload chunk under
/// `key`, nonce = four zero bytes then the chunk index big-endian, associated data
/// `proctor-screen-clip-v1`; each record is its chunk plus a 16-byte tag.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct ClipReady {
    pub path: LocalPath,
    pub key: Secret,
    pub media_type: MediaType,
    pub size_bytes: Count,
    pub chunk_bytes: Count,
    pub chunk_sha256: Vec<Digest>,
    pub content_digest: Digest,
    /// The range covered, rounded out to segment boundaries.
    pub start_ms: Count,
    pub end_ms: Count,
    pub gaps: Vec<RecordingGap>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum ClipOutcome {
    Ready(ClipReady),
    Failed { code: ClipFailureCode },
}
