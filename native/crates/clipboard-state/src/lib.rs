#![deny(unsafe_code)]

mod platform;

use native_protocol::{
    CLIPBOARD_SCHEMA_VERSION, ClipboardCertainty, ClipboardCoverage, ClipboardDrain,
    ClipboardEvent, ClipboardEventKind, ClipboardObservation, ClipboardSourceSnapshot,
    ClipboardState, PermissionState, PlatformFamily, SourceFailureCode, SourceHealth, SourceReset,
};
use native_source_runtime::{
    PassiveStateEventKind, PassiveStateWire, SequencedObservation, SourceSessionMetadata,
};

pub use native_source_runtime::{
    OpenedPassiveStateBackend as OpenedClipboardBackend, PassiveStateBackend as ClipboardBackend,
    PassiveStateEmitter as ClipboardEmitter, PassiveStateSource as ClipboardSource,
    PassiveStateSourceError as ClipboardError, PassiveStateSubscription as ClipboardSubscription,
    UnavailablePassiveStateSubscription as UnavailableClipboardSubscription,
};
pub use platform::PlatformClipboardBackend;

pub struct ClipboardWire;

impl PassiveStateWire for ClipboardWire {
    type State = ClipboardState;
    type Event = ClipboardEvent;
    type Snapshot = ClipboardSourceSnapshot;
    type Observation = ClipboardObservation;
    type Drain = ClipboardDrain;
    const SCHEMA_VERSION: u16 = CLIPBOARD_SCHEMA_VERSION;
    const SOURCE_VERSION: &'static str = env!("CARGO_PKG_VERSION");
    const STOP_THREAD_NAME: &'static str = "prctr-clipboard-stop";

    fn health(state: &Self::State) -> SourceHealth {
        if matches!(state.coverage, ClipboardCoverage::ChangeNotifications)
            && matches!(state.certainty, ClipboardCertainty::Complete)
        {
            SourceHealth::Healthy
        } else {
            SourceHealth::Degraded
        }
    }

    fn unavailable_state() -> Self::State {
        ClipboardState {
            coverage: ClipboardCoverage::Unavailable,
            certainty: ClipboardCertainty::Unknown,
            change_generation: 0,
        }
    }

    fn event(kind: PassiveStateEventKind, state: Self::State) -> Self::Event {
        ClipboardEvent {
            kind: match kind {
                PassiveStateEventKind::Changed => ClipboardEventKind::Changed,
                PassiveStateEventKind::Reconciled => ClipboardEventKind::Reconciled,
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
        ClipboardSourceSnapshot {
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
        ClipboardObservation {
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
        ClipboardDrain {
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

    struct TestSubscription {
        final_state: ClipboardState,
    }

    impl ClipboardSubscription<ClipboardWire> for TestSubscription {
        fn stop(self) -> Result<ClipboardState, ClipboardError> {
            Ok(self.final_state)
        }
    }

    struct TestBackend;

    impl ClipboardBackend<ClipboardWire> for TestBackend {
        type Subscription = TestSubscription;

        fn open(
            self,
            emitter: ClipboardEmitter<ClipboardWire>,
        ) -> Result<OpenedClipboardBackend<ClipboardWire, Self::Subscription>, ClipboardError>
        {
            let initial_state = available_state(0);
            let final_state = available_state(1);
            emitter.observe(final_state.clone());
            Ok(OpenedClipboardBackend {
                platform: PlatformFamily::Macos,
                permission: PermissionState::Granted,
                adapter_version: "test-clipboard-v1",
                initial_state,
                subscription: TestSubscription { final_state },
            })
        }
    }

    #[test]
    fn platform_boundary_reports_truthful_coverage() {
        let request = SourceOpenRequest {
            collection_session_id: "clipboard-session-0001".to_owned(),
            requested_schema_version: CLIPBOARD_SCHEMA_VERSION,
            queue_capacity: 8,
        };
        let mut source =
            ClipboardSource::<ClipboardWire, _>::open(&request, PlatformClipboardBackend)
                .expect("source opens");
        assert_eq!(source.snapshot().health, SourceHealth::Degraded);
        #[cfg(any(target_os = "linux", target_os = "macos"))]
        if source.snapshot().state.coverage == ClipboardCoverage::Unavailable {
            assert_eq!(source.snapshot().state, ClipboardWire::unavailable_state());
        }
        #[cfg(target_os = "linux")]
        assert_eq!(source.snapshot().state, ClipboardWire::unavailable_state());
        #[cfg(target_os = "macos")]
        if source.snapshot().state.coverage == ClipboardCoverage::SnapshotCounter {
            assert_eq!(
                source.snapshot().state.certainty,
                ClipboardCertainty::Partial
            );
        }
        #[cfg(target_os = "windows")]
        {
            assert_eq!(
                source.snapshot().state.coverage,
                ClipboardCoverage::SnapshotCounter
            );
            assert_eq!(
                source.snapshot().state.certainty,
                ClipboardCertainty::Partial
            );
        }
        assert_eq!(source.stop().health, SourceHealth::Stopped);
    }

    #[test]
    fn callback_registered_before_snapshot_is_delivered_after_sequence_zero() {
        let request = SourceOpenRequest {
            collection_session_id: "clipboard-session-0002".to_owned(),
            requested_schema_version: CLIPBOARD_SCHEMA_VERSION,
            queue_capacity: 8,
        };
        let mut source =
            ClipboardSource::<ClipboardWire, _>::open(&request, TestBackend).expect("source opens");

        assert_eq!(source.snapshot().state, available_state(0));
        let drain = source.drain();
        assert_eq!(drain.health, SourceHealth::Healthy);
        assert_eq!(drain.observations.len(), 1);
        assert_eq!(drain.observations[0].sequence, 1);
        assert_eq!(drain.observations[0].event.state, available_state(1));
        assert_eq!(source.stop().health, SourceHealth::Stopped);
    }

    fn available_state(change_generation: u64) -> ClipboardState {
        ClipboardState {
            coverage: ClipboardCoverage::ChangeNotifications,
            certainty: ClipboardCertainty::Complete,
            change_generation,
        }
    }
}
