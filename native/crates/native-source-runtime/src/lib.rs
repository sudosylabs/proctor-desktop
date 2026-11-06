#![forbid(unsafe_code)]

//! Shared runtime for native observation sources: bounded file reads, ordered
//! observation queues, deadline-bounded workers, source sessions, and the
//! passive full-state source family.

mod bounded_read;
mod deadline;
mod passive_backends;
mod passive_state;
mod queue;
mod session;

pub use bounded_read::{BoundedFileReadError, read_bounded_file, read_bounded_utf8_file};
pub use deadline::{
    BoundedTaskError, DeadlineThread, NativeSourceProcessPoisoned, SOURCE_CLEANUP_DEADLINE,
    ThreadFinishError, ensure_native_source_process_usable, poison_native_source_process,
    prefer_boundary_error, run_bounded_source_stop, run_bounded_task,
};
pub use passive_backends::{
    InitialFallbackPollingSubscription, PollingPassiveStateBackend,
    PollingPassiveStateSubscription, StaticPassiveStateBackend, StaticPassiveStateSubscription,
    UnavailablePassiveStateBackend, UnavailablePassiveStateSubscription,
};
pub use passive_state::{
    OpenedPassiveStateBackend, PassiveStateBackend, PassiveStateEmitter, PassiveStateEventKind,
    PassiveStateSource, PassiveStateSourceError, PassiveStateSubscription, PassiveStateWire,
};
pub use queue::{BoundedObservationQueue, QueueError, QueuePushOutcome, SequencedObservation};
pub use session::{
    SourceClock, SourceModel, SourceResetPlan, SourceSession, SourceSessionDrain,
    SourceSessionFact, SourceSessionMetadata, SourceStateChange, fresh_source_instance_id,
};

#[cfg(test)]
mod tests;
