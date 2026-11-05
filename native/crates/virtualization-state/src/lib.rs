#![deny(unsafe_code)]

mod platform;
use native_protocol::{
    PermissionState, PlatformFamily, SourceFailureCode, SourceHealth, SourceReset,
    VIRTUALIZATION_SCHEMA_VERSION, VirtualizationCertainty, VirtualizationClassification,
    VirtualizationCoverage, VirtualizationDrain, VirtualizationEvent, VirtualizationEventKind,
    VirtualizationObservation, VirtualizationSourceSnapshot, VirtualizationState,
};
pub use native_source_runtime::{
    OpenedPassiveStateBackend as OpenedVirtualizationBackend,
    PassiveStateBackend as VirtualizationBackend, PassiveStateEmitter as VirtualizationEmitter,
    PassiveStateSource as VirtualizationSource, PassiveStateSourceError as VirtualizationError,
    PassiveStateSubscription as VirtualizationSubscription,
    UnavailablePassiveStateSubscription as UnavailableVirtualizationSubscription,
};
use native_source_runtime::{
    PassiveStateEventKind, PassiveStateWire, SequencedObservation, SourceSessionMetadata,
};
pub use platform::PlatformVirtualizationBackend;

pub struct VirtualizationWire;
impl PassiveStateWire for VirtualizationWire {
    type State = VirtualizationState;
    type Event = VirtualizationEvent;
    type Snapshot = VirtualizationSourceSnapshot;
    type Observation = VirtualizationObservation;
    type Drain = VirtualizationDrain;
    const SCHEMA_VERSION: u16 = VIRTUALIZATION_SCHEMA_VERSION;
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
    fn event(kind: PassiveStateEventKind, state: Self::State) -> Self::Event {
        VirtualizationEvent {
            kind: match kind {
                PassiveStateEventKind::Changed => VirtualizationEventKind::Changed,
                PassiveStateEventKind::Reconciled => VirtualizationEventKind::Reconciled,
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
        VirtualizationSourceSnapshot {
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
        VirtualizationObservation {
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
        VirtualizationDrain {
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
            collection_session_id: "virtualization-session-0001".to_owned(),
            requested_schema_version: VIRTUALIZATION_SCHEMA_VERSION,
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
