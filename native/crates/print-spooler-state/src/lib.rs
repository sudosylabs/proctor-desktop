#![deny(unsafe_code)]

mod platform;
use native_protocol::{
    PRINT_SPOOLER_SCHEMA_VERSION, PermissionState, PlatformFamily, PrintSpoolerCertainty,
    PrintSpoolerCoverage, PrintSpoolerDrain, PrintSpoolerEvent, PrintSpoolerEventKind,
    PrintSpoolerObservation, PrintSpoolerSourceSnapshot, PrintSpoolerState, SourceFailureCode,
    SourceHealth, SourceReset,
};
pub use native_source_runtime::{
    OpenedPassiveStateBackend as OpenedPrintSpoolerBackend,
    PassiveStateBackend as PrintSpoolerBackend, PassiveStateEmitter as PrintSpoolerEmitter,
    PassiveStateSource as PrintSpoolerSource, PassiveStateSourceError as PrintSpoolerError,
    PassiveStateSubscription as PrintSpoolerSubscription,
    UnavailablePassiveStateSubscription as UnavailablePrintSpoolerSubscription,
};
use native_source_runtime::{
    PassiveStateEventKind, PassiveStateWire, SequencedObservation, SourceSessionMetadata,
};
pub use platform::PlatformPrintSpoolerBackend;

pub struct PrintSpoolerWire;
impl PassiveStateWire for PrintSpoolerWire {
    type State = PrintSpoolerState;
    type Event = PrintSpoolerEvent;
    type Snapshot = PrintSpoolerSourceSnapshot;
    type Observation = PrintSpoolerObservation;
    type Drain = PrintSpoolerDrain;
    const SCHEMA_VERSION: u16 = PRINT_SPOOLER_SCHEMA_VERSION;
    const SOURCE_VERSION: &'static str = env!("CARGO_PKG_VERSION");
    const STOP_THREAD_NAME: &'static str = "print-spooler-stop";
    fn health(state: &Self::State) -> SourceHealth {
        if matches!(state.coverage, PrintSpoolerCoverage::MonitoredScheduler)
            && matches!(state.certainty, PrintSpoolerCertainty::Complete)
        {
            SourceHealth::Healthy
        } else {
            SourceHealth::Degraded
        }
    }
    fn unavailable_state() -> Self::State {
        PrintSpoolerState {
            coverage: PrintSpoolerCoverage::Unavailable,
            certainty: PrintSpoolerCertainty::Unknown,
            candidate_job_count: 0,
            other_job_count: 0,
            unknown_job_count: 0,
        }
    }
    fn event(kind: PassiveStateEventKind, state: Self::State) -> Self::Event {
        PrintSpoolerEvent {
            kind: match kind {
                PassiveStateEventKind::Changed => PrintSpoolerEventKind::Changed,
                PassiveStateEventKind::Reconciled => PrintSpoolerEventKind::Reconciled,
            },
            state,
        }
    }
    fn snapshot(
        metadata: SourceSessionMetadata,
        platform: PlatformFamily,
        permission: PermissionState,
        adapter_version: &str,
        state: Self::State,
    ) -> Self::Snapshot {
        PrintSpoolerSourceSnapshot {
            source_instance_id: metadata.source_instance_id,
            source_version: Self::SOURCE_VERSION.to_owned(),
            adapter_version: adapter_version.to_owned(),
            schema_version: Self::SCHEMA_VERSION,
            platform,
            permission,
            health: metadata.health,
            sequence: 0,
            observed_at: metadata.observed_at,
            state,
        }
    }
    fn observation(
        source_instance_id: String,
        fact: SequencedObservation<Self::Event>,
    ) -> Self::Observation {
        PrintSpoolerObservation {
            source_instance_id,
            sequence: fact.sequence,
            observed_at: fact.observed_at,
            gap: fact.gap,
            event: fact.payload,
        }
    }
    fn drain(
        source_instance_id: String,
        health: SourceHealth,
        observations: Vec<Self::Observation>,
        resets: Vec<SourceReset>,
        terminal_error: Option<SourceFailureCode>,
    ) -> Self::Drain {
        PrintSpoolerDrain {
            source_instance_id,
            health,
            observations,
            resets,
            terminal_error,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use native_protocol::SourceOpenRequest;

    #[test]
    fn platform_boundary_reports_truthful_coverage() {
        let request = SourceOpenRequest {
            collection_session_id: "print-spooler-session-0001".to_owned(),
            requested_schema_version: PRINT_SPOOLER_SCHEMA_VERSION,
            queue_capacity: 8,
        };
        let mut source =
            PrintSpoolerSource::<PrintSpoolerWire, _>::open(&request, PlatformPrintSpoolerBackend)
                .expect("source opens");
        assert_eq!(source.snapshot().health, SourceHealth::Degraded);
        match source.snapshot().state.coverage {
            PrintSpoolerCoverage::Unavailable => assert_eq!(
                source.snapshot().state,
                PrintSpoolerWire::unavailable_state()
            ),
            PrintSpoolerCoverage::SnapshotOnly => assert_eq!(
                source.snapshot().state.certainty,
                PrintSpoolerCertainty::Partial
            ),
            PrintSpoolerCoverage::MonitoredScheduler => {
                panic!("polling adapter cannot claim notification coverage")
            }
        }
        assert_eq!(source.stop().health, SourceHealth::Stopped);
    }
}
