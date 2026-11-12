//! The contract between the agent and one capability. A source observes the OS and answers "the
//! full state now"; everything generic (sequencing, gaps, rules) stays in the engine.

use std::fmt;

use prctr_protocol::facts::Permission;

use prctr_protocol::scalars::Identifier;

use crate::observation::Observation;
use crate::registry::CapabilityDescriptor;

/// What a running source reports between queries. Implementations must not block: the sink only
/// enqueues.
#[derive(Clone, Debug)]
pub enum SourceEvent {
    /// Something changed; the agent will call [`Source::current`] and feed the result to the engine.
    Changed,
    /// The source lost this many OS events.
    Lost(u64),
}

/// Receives a source's events. Cheap to clone; safe to call from any thread.
pub type Sink = std::sync::Arc<dyn Fn(SourceEvent) + Send + Sync>;

/// Why a source could not do what it was asked. The agent reports the capability as failed.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SourceError {
    pub reason: &'static str,
}

impl fmt::Display for SourceError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(self.reason)
    }
}

impl std::error::Error for SourceError {}

/// One capability on one platform.
pub trait Source: Send {
    fn descriptor(&self) -> CapabilityDescriptor;

    /// Starts observing the activation's selected `categories` (empty for capabilities without
    /// sub-categories; an unselected category is never queried), then returns the first complete state. Observation is registered before the
    /// state is read, so no change can fall between them.
    ///
    /// # Errors
    /// When the OS observation cannot be set up.
    fn start(&mut self, categories: &[Identifier], sink: Sink) -> Result<Observation, SourceError>;

    /// The complete state now. Valid whether or not the source is started.
    fn current(&mut self) -> Observation;

    /// Stops observing; idempotent.
    fn stop(&mut self);

    /// A fact only Electron main can see (for example the candidate window's focus).
    ///
    /// # Errors
    /// When this capability accepts no host events, or the event is not valid for it.
    fn host_event(&mut self, _event: &serde_json::Value) -> Result<(), SourceError> {
        Err(SourceError {
            reason: "no host events",
        })
    }

    /// Shows the OS permission prompt, after explicit candidate action.
    ///
    /// # Errors
    /// When this capability has no prompt.
    fn request_permission(&mut self) -> Result<Permission, SourceError> {
        Err(SourceError {
            reason: "no prompt",
        })
    }
}
