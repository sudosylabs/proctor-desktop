//! Opens, drains, restarts, and stops the native observation sources that run
//! inside the exam-security utility process.
//!
//! Sources are opened in a fixed manifest order and as an all-or-nothing set.
//! A failed source gets one bounded restart; anything the supervisor cannot
//! clean up safely marks the whole process as needing replacement.

#![forbid(unsafe_code)]

mod config;
mod erased;
mod factories;
mod helper_sources;
mod open;
mod restart;
mod source;
mod supervisor;

pub use config::{RestartPolicy, SupervisorConfig, SupervisorConfigError};
pub use factories::{
    BaselineSourceFactories, CandidateWindowFactory, CaptureSessionFactory, DisplayTopologyFactory,
    PassiveStateFactory, ProcessApplicationFactory, SupervisedPassiveStateWire,
    candidate_window_factory, capture_session_factory, display_topology_factory,
    passive_state_factory, process_application_factory,
};
pub use helper_sources::HelperSourceConnection;
pub use source::{NATIVE_SOURCE_KINDS, NativeSourceBatch, NativeSourceKind, NativeSourceSnapshot};
pub use supervisor::{
    BaselineSourceSnapshots, NativeSourceSupervisor, OpenedSupervisor, SourceLifecycleTransition,
    SupervisorOpenError, SupervisorPoll, SupervisorState, SupervisorStop,
};

#[cfg(test)]
mod tests;
