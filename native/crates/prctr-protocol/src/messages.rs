//! Messages between Electron main and the native agent. Every message is a closed union: an
//! unknown kind or field is a fatal protocol error, never ignored.

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

use crate::facts::{Fact, Gap, InterruptionKind, Permission};
use crate::recording::{
    ClipOutcome, ClipRange, CloseDisposition, RecorderState, RecordingGap, RecordingStart,
};
use crate::rules::{Policy, RuleStatus};
use crate::scalars::{BuildIdentity, Count, Digest, Identifier, OpaqueId, Secret};

/// What Electron main sends.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum MainMessage {
    /// The first message, exactly once.
    Hello {
        secret: Secret,
        build_identity: BuildIdentity,
        protocol_digest: Digest,
    },
    Request {
        request_id: Count,
        request: Request,
    },
    /// A fact only Electron main can see, for a capability that accepts host events.
    HostEvent {
        capability: Identifier,
        event: serde_json::Value,
    },
    /// Electron main lost this many host events before sending them.
    HostEventsLost {
        capability: Identifier,
        count: Count,
    },
    /// Every notification up to and including this message number was received.
    Acknowledge {
        up_to: Count,
    },
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum Request {
    /// The current state of a non-sensitive capability, outside any session.
    Query { capability: Identifier },
    /// Start the readiness session for one sitting's compiled policy.
    OpenReadiness {
        collection_session_id: OpaqueId,
        policy: Policy,
    },
    /// The binding check at Start: fresh complete states and readiness rule statuses.
    BeginParticipation,
    /// The server admitted the candidate: the session continues without a gap, and the recording
    /// starts when the policy enables it.
    ConfirmParticipation {
        #[serde(default, skip_serializing_if = "Option::is_none")]
        recording: Option<RecordingStart>,
    },
    /// Admission was refused or timed out: back to readiness.
    AbandonParticipation,
    /// Show the OS permission prompt, after explicit candidate action on the overview.
    RequestPermission { capability: Identifier },
    /// The server asked for a clip; it arrives as a `clip` notification once recorded.
    RecorderSave {
        clip_request_id: OpaqueId,
        range: ClipRange,
    },
    /// The server acknowledged an uploaded clip: delete the clip file.
    RecorderRelease { clip_request_id: OpaqueId },
    /// End the session in reverse order and return the final states.
    Close { disposition: CloseDisposition },
}

/// What the native agent sends.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum AgentMessage {
    /// The answer to `hello`, exactly once.
    HelloAck {
        secret: Secret,
        build_identity: BuildIdentity,
        protocol_digest: Digest,
    },
    Response {
        request_id: Count,
        response: Response,
    },
    Notification {
        message_number: Count,
        notification: Notification,
    },
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum Response {
    Queried {
        fact: Fact,
    },
    ReadinessOpened {
        facts: Vec<Fact>,
        rules: Vec<RuleStatus>,
    },
    ParticipationBegun {
        facts: Vec<Fact>,
        rules: Vec<RuleStatus>,
    },
    ParticipationConfirmed {
        rules: Vec<RuleStatus>,
    },
    ParticipationAbandoned {
        rules: Vec<RuleStatus>,
    },
    PermissionRequested {
        capability: Identifier,
        permission: Permission,
    },
    RecorderSaveAccepted {
        clip_request_id: OpaqueId,
    },
    RecorderReleased {
        clip_request_id: OpaqueId,
    },
    Closed {
        facts: Vec<Fact>,
        rules: Vec<RuleStatus>,
    },
    Refused {
        code: RefusalCode,
    },
}

/// Why a request was refused. The session and connection stay usable.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum RefusalCode {
    /// The request is not valid in the current session phase.
    WrongPhase,
    /// The policy names an unregistered capability, field, value or reason, or exceeds a bound.
    InvalidPolicy,
    /// The capability is not registered, or is sensitive and cannot be queried outside a session.
    UnknownCapability,
    /// A capability has not delivered a fresh complete state yet.
    NotReady,
    /// The capability needs no permission, or the OS has no prompt for it.
    NoPermissionPrompt,
    /// No recording is running for this session.
    RecorderOff,
    /// The clip range is malformed.
    InvalidRange,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum Notification {
    Fact {
        fact: Fact,
    },
    Rules {
        statuses: Vec<RuleStatus>,
    },
    Gap {
        gap: Gap,
    },
    Interruption {
        interruption: InterruptionKind,
    },
    Heartbeat {
        monotonic_ms: Count,
    },
    /// The recorder's state changed; `gaps` is every gap so far.
    Recorder {
        state: RecorderState,
        gaps: Vec<RecordingGap>,
    },
    /// A requested clip is ready or has failed.
    Clip {
        clip_request_id: OpaqueId,
        outcome: ClipOutcome,
    },
    /// The agent failed and is about to exit.
    Fatal {
        code: FatalCode,
    },
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum FatalCode {
    Protocol,
    CapabilityFailed,
    Internal,
}
