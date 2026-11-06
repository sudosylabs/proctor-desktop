#![deny(unsafe_code)]

mod platform;
use native_protocol::{
    SourceHealth, VirtualizationCertainty, VirtualizationClassification, VirtualizationCoverage,
    VirtualizationDrain, VirtualizationEvent, VirtualizationEventKind, VirtualizationObservation,
    VirtualizationSourceSnapshot, VirtualizationState,
};
use native_source_runtime::PassiveStateWire;
pub use native_source_runtime::{
    OpenedPassiveStateBackend as OpenedVirtualizationBackend,
    PassiveStateBackend as VirtualizationBackend, PassiveStateEmitter as VirtualizationEmitter,
    PassiveStateSource as VirtualizationSource, PassiveStateSourceError as VirtualizationError,
    PassiveStateSubscription as VirtualizationSubscription,
    UnavailablePassiveStateSubscription as UnavailableVirtualizationSubscription,
};
pub use platform::PlatformVirtualizationBackend;

pub struct VirtualizationWire;
impl PassiveStateWire for VirtualizationWire {
    type State = VirtualizationState;
    type Event = VirtualizationEvent;
    type Snapshot = VirtualizationSourceSnapshot;
    type Observation = VirtualizationObservation;
    type Drain = VirtualizationDrain;
    const SOURCE_VERSION: &'static str = env!("CARGO_PKG_VERSION");
    const STOP_THREAD_NAME: &'static str = "virtualization-stop";
    fn health(state: &Self::State) -> SourceHealth {
        if matches!(state.coverage, VirtualizationCoverage::Classification)
            && matches!(state.certainty, VirtualizationCertainty::Complete)
        {
            SourceHealth::Healthy
        } else {
            SourceHealth::Degraded
        }
    }
    fn unavailable_state() -> Self::State {
        VirtualizationState {
            coverage: VirtualizationCoverage::Unavailable,
            certainty: VirtualizationCertainty::Unknown,
            classification: VirtualizationClassification::Unknown,
        }
    }
    native_source_runtime::passive_state_constructors! {
        event: VirtualizationEvent,
        event_kind: VirtualizationEventKind,
        snapshot: VirtualizationSourceSnapshot,
        observation: VirtualizationObservation,
        drain: VirtualizationDrain,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use native_protocol::SourceOpenRequest;

    #[test]
    fn platform_boundary_reports_truthful_coverage() {
        let request = SourceOpenRequest {
            collection_session_id: "virtualization-session-0001".to_owned(),
            queue_capacity: 8,
        };
        let mut source = VirtualizationSource::<VirtualizationWire, _>::open(
            &request,
            PlatformVirtualizationBackend,
        )
        .expect("source opens");
        #[cfg(target_os = "macos")]
        {
            assert_eq!(source.snapshot().health, SourceHealth::Degraded);
            assert_eq!(
                source.snapshot().state,
                VirtualizationWire::unavailable_state()
            );
        }
        #[cfg(any(target_os = "linux", target_os = "windows"))]
        assert_eq!(
            source.snapshot().state.coverage,
            VirtualizationCoverage::Classification
        );
        assert_eq!(source.stop().health, SourceHealth::Stopped);
    }
}
