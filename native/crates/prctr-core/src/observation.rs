//! What a capability module hands the core for one complete state.

use std::collections::BTreeMap;

use prctr_protocol::facts::Envelope;
use prctr_protocol::scalars::Identifier;

/// The value of one registered rule field. A field missing from [`Observation::fields`] is
/// unavailable.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum FieldValue {
    Number(u64),
    Symbol(Identifier),
}

/// Application rule matches, computed on the device for the process capability.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct AppMatches {
    /// New processes whose identity is still being verified.
    pub checking: u64,
    /// For each rule with an application condition: `true` when the condition is violated.
    pub violated: BTreeMap<Identifier, bool>,
}

/// One complete state of a capability: its envelope, its state and summary as they go on the
/// wire, the rule fields derived from them, and the change kinds since the previous state.
#[derive(Clone, Debug, PartialEq)]
pub struct Observation {
    pub envelope: Envelope,
    pub state: serde_json::Value,
    pub summary: serde_json::Value,
    pub fields: BTreeMap<Identifier, FieldValue>,
    pub apps: Option<AppMatches>,
    pub changes: Vec<Identifier>,
}

impl Observation {
    /// Whether `other` reports the same machine state. Change kinds are not part of the state.
    #[must_use]
    pub fn same_state(&self, other: &Self) -> bool {
        self.envelope == other.envelope && self.state == other.state && self.apps == other.apps
    }
}
