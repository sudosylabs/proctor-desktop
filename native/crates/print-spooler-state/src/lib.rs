#![deny(unsafe_code)]

mod platform;
use native_protocol::{
    PrintSpoolerCertainty, PrintSpoolerCoverage, PrintSpoolerDrain, PrintSpoolerEvent,
    PrintSpoolerEventKind, PrintSpoolerObservation, PrintSpoolerSourceSnapshot, PrintSpoolerState,
    SourceHealth,
};
use native_source_runtime::PassiveStateWire;
pub use native_source_runtime::{
    OpenedPassiveStateBackend as OpenedPrintSpoolerBackend,
    PassiveStateBackend as PrintSpoolerBackend, PassiveStateEmitter as PrintSpoolerEmitter,
    PassiveStateSource as PrintSpoolerSource, PassiveStateSourceError as PrintSpoolerError,
    PassiveStateSubscription as PrintSpoolerSubscription,
    UnavailablePassiveStateSubscription as UnavailablePrintSpoolerSubscription,
};
pub use platform::PlatformPrintSpoolerBackend;

pub struct PrintSpoolerWire;
impl PassiveStateWire for PrintSpoolerWire {
    type State = PrintSpoolerState;
    type Event = PrintSpoolerEvent;
    type Snapshot = PrintSpoolerSourceSnapshot;
    type Observation = PrintSpoolerObservation;
    type Drain = PrintSpoolerDrain;
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
    native_source_runtime::passive_state_constructors! {
        event: PrintSpoolerEvent,
        event_kind: PrintSpoolerEventKind,
        snapshot: PrintSpoolerSourceSnapshot,
        observation: PrintSpoolerObservation,
        drain: PrintSpoolerDrain,
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
