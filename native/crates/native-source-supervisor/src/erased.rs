//! The type-erased source and factory interfaces the supervisor drives, plus
//! the small values passed across them.

use native_protocol::{SourceFailureCode, SourceHealth, SourceOpenRequest};
use native_source_runtime::ensure_native_source_process_usable;

use crate::config::SupervisorConfig;
use crate::source::{NativeSourceBatch, NativeSourceKind, NativeSourceSnapshot};

/// The per-collection values every source is opened with.
#[derive(Clone)]
pub(crate) struct SourceParameters {
    pub(crate) collection_session_id: String,
    pub(crate) queue_capacity: u16,
}

impl From<&SupervisorConfig> for SourceParameters {
    fn from(config: &SupervisorConfig) -> Self {
        Self {
            collection_session_id: config.collection_session_id.clone(),
            queue_capacity: config.queue_capacity,
        }
    }
}

impl SourceParameters {
    pub(crate) fn request(&self) -> SourceOpenRequest {
        SourceOpenRequest {
            collection_session_id: self.collection_session_id.clone(),
            queue_capacity: self.queue_capacity,
        }
    }
}

/// The sequence gap a restarted source reports so consumers can see that
/// observations may have been missed while it was down.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) struct RestartBoundary {
    pub(crate) missing_count: u64,
    pub(crate) reason: &'static str,
}

/// Why a source could not be opened, and whether the failure left the process
/// unsafe to keep using.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) struct SourceStartFailure {
    pub(crate) code: SourceFailureCode,
    pub(crate) process_replacement_required: bool,
}

/// Records an open failure, checking whether it also poisoned the process.
pub(crate) fn source_start_failure(code: SourceFailureCode) -> SourceStartFailure {
    SourceStartFailure {
        code,
        process_replacement_required: ensure_native_source_process_usable().is_err(),
    }
}

/// Opens one source, either fresh or after a restart boundary. Factories are
/// reused across restarts, so `open` may be called more than once.
pub(crate) trait ErasedFactory: Send {
    fn open(
        &mut self,
        parameters: &SourceParameters,
        restart: Option<RestartBoundary>,
    ) -> Result<Box<dyn ErasedSource>, SourceStartFailure>;
}

/// A running source of any capability, as seen by the supervisor.
pub(crate) trait ErasedSource: Send {
    fn kind(&self) -> NativeSourceKind;
    fn snapshot(&self) -> NativeSourceSnapshot;
    fn health(&self) -> SourceHealth;
    fn drain(&mut self) -> NativeSourceBatch;
    fn stop(&mut self) -> SourceStopOutcome;
}

/// Everything a stopped source handed back, and whether its input boundary
/// was closed cleanly.
pub(crate) struct SourceStopOutcome {
    pub(crate) preceding_batches: Vec<NativeSourceBatch>,
    pub(crate) final_snapshot: Option<NativeSourceSnapshot>,
    pub(crate) batch: NativeSourceBatch,
    pub(crate) closed_input_boundary: bool,
}

impl SourceStopOutcome {
    /// Outcome for a source that runs inside this process: it has no tail or
    /// final snapshot beyond its last batch, and its input is closed only if
    /// the process is still usable after the stop.
    pub(crate) fn in_process(batch: NativeSourceBatch) -> Self {
        Self {
            preceding_batches: Vec::new(),
            final_snapshot: None,
            batch,
            closed_input_boundary: ensure_native_source_process_usable().is_ok(),
        }
    }
}
