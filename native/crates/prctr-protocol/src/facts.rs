//! The envelope every capability shares, and the fact records built on it.
//!
//! The envelope never names a capability's own fields: a fact carries the capability's state as
//! JSON, validated against that capability's published schema, so adding a capability never
//! changes these types.

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

use crate::scalars::{Count, Identifier, OpaqueId};

/// The OS permission a capability needs. Capabilities that need none report `granted`.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum Permission {
    NotDetermined,
    Granted,
    Denied,
    Restricted,
    Unavailable,
}

/// Whether the capability is running. `degraded` still runs; its certainty says how far it can be
/// trusted. `unsupported`, `failed` and `stopped` mean no usable facts.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum Health {
    Unsupported,
    Healthy,
    Degraded,
    Failed,
    Stopped,
}

impl Health {
    /// `true` when the capability produces usable facts (`healthy` or `degraded`).
    #[must_use]
    pub const fn is_running(self) -> bool {
        matches!(self, Self::Healthy | Self::Degraded)
    }
}

/// How completely the state reflects the machine.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum Certainty {
    Complete,
    Partial,
    Unknown,
}

/// The fields every fact carries, whatever the capability.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct Envelope {
    pub permission: Permission,
    pub health: Health,
    pub certainty: Certainty,
}

/// One capability's complete state at a sequence number.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct Fact {
    pub capability: Identifier,
    pub source_instance_id: OpaqueId,
    pub sequence: Count,
    /// Monotonic milliseconds of the agent's clock when the state was captured.
    pub captured_at_ms: Count,
    pub envelope: Envelope,
    /// The capability's state, valid against its published schema.
    pub state: serde_json::Value,
    /// Fields derived only from `state`, valid against the capability's summary schema.
    pub summary: serde_json::Value,
    /// The kinds of change since the previous fact; empty for an activation or fresh state.
    pub changes: Vec<Identifier>,
}

/// Points at the fact that caused a rule status.
#[derive(Clone, Debug, PartialEq, Eq, Hash, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct FactRef {
    pub capability: Identifier,
    pub source_instance_id: OpaqueId,
    pub sequence: Count,
}

/// Why sequence numbers are missing.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum GapReason {
    /// The adapter lost events.
    SourceLoss,
    /// Electron main fell behind and older states were dropped in favour of the newest.
    FlowControl,
}

/// A range of sequence numbers whose facts were never delivered.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct Gap {
    pub capability: Identifier,
    pub source_instance_id: OpaqueId,
    pub first_sequence: Count,
    pub last_sequence: Count,
    pub reason: GapReason,
}

/// An OS event that ends every capability's stream until a fresh complete state arrives.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum InterruptionKind {
    Sleep,
    ScreenLock,
    UserSwitch,
}
