#![deny(unsafe_code)]

mod platform;

use native_protocol::{
    INTERACTIVE_SESSION_SCHEMA_VERSION, InteractiveConsoleOwnership, InteractiveLockState,
    InteractiveRemoteAttachment, InteractiveSessionCertainty, InteractiveSessionCoverage,
    InteractiveSessionDrain, InteractiveSessionEvent, InteractiveSessionEventKind,
    InteractiveSessionObservation, InteractiveSessionSourceSnapshot, InteractiveSessionState,
    PermissionState, PlatformFamily, SourceFailureCode, SourceHealth, SourceReset,
};
use native_source_runtime::{
    PassiveStateEventKind, PassiveStateWire, SequencedObservation, SourceSessionMetadata,
};

pub use native_source_runtime::{
    OpenedPassiveStateBackend as OpenedInteractiveSessionBackend,
    PassiveStateBackend as InteractiveSessionBackend,
    PassiveStateEmitter as InteractiveSessionEmitter,
    PassiveStateSource as InteractiveSessionSource,
    PassiveStateSourceError as InteractiveSessionError,
    PassiveStateSubscription as InteractiveSessionSubscription,
    UnavailablePassiveStateSubscription as UnavailableInteractiveSessionSubscription,
};
pub use platform::PlatformInteractiveSessionBackend;

pub struct InteractiveSessionWire;

impl PassiveStateWire for InteractiveSessionWire {
    type State = InteractiveSessionState;
    type Event = InteractiveSessionEvent;
    type Snapshot = InteractiveSessionSourceSnapshot;
    type Observation = InteractiveSessionObservation;
    type Drain = InteractiveSessionDrain;

    const SCHEMA_VERSION: u16 = INTERACTIVE_SESSION_SCHEMA_VERSION;
    const SOURCE_VERSION: &'static str = env!("CARGO_PKG_VERSION");
    const STOP_THREAD_NAME: &'static str = "interactive-session-stop";

    fn health(state: &Self::State) -> SourceHealth {
        if matches!(state.coverage, InteractiveSessionCoverage::FullLifecycle)
            && matches!(state.certainty, InteractiveSessionCertainty::Complete)
        {
            SourceHealth::Healthy
        } else {
            SourceHealth::Degraded
        }
    }

    fn unavailable_state() -> Self::State {
        InteractiveSessionState {
            coverage: InteractiveSessionCoverage::Unavailable,
            certainty: InteractiveSessionCertainty::Unknown,
            console_ownership: InteractiveConsoleOwnership::Unknown,
            lock_state: InteractiveLockState::Unknown,
            remote_attachment: InteractiveRemoteAttachment::Unknown,
            other_human_session_count: 0,
        }
    }

    fn event(kind: PassiveStateEventKind, state: Self::State) -> Self::Event {
        InteractiveSessionEvent {
            kind: match kind {
                PassiveStateEventKind::Changed => InteractiveSessionEventKind::Changed,
                PassiveStateEventKind::Reconciled => InteractiveSessionEventKind::Reconciled,
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
        InteractiveSessionSourceSnapshot {
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
        InteractiveSessionObservation {
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
        InteractiveSessionDrain {
            source_instance_id,
            health,
            observations,
            resets,
            terminal_error,
        }
    }
}

#[cfg(target_os = "windows")]
pub use platform::{
    WindowsCandidateSession, WindowsWtsServiceDispatcher, WindowsWtsSessionDrain,
    WindowsWtsSessionEvent, WindowsWtsSessionSnapshot, WindowsWtsSessionSource,
};

#[cfg(target_os = "macos")]
pub use platform::{
    MacOsGraphicalSessionId, MacOsSessionEventFeed, MacOsSessionFeedClose, MacOsSessionFeedDrain,
    MacOsSessionFeedFailure, MacOsSessionNotification, MacOsSessionNotificationKind,
};

#[cfg(test)]
mod tests {
    use super::*;
    use native_protocol::SourceOpenRequest;

    #[test]
    fn platform_boundary_reports_truthful_snapshot_or_unavailable_coverage() {
        let request = SourceOpenRequest {
            collection_session_id: "interactive-session-0001".to_owned(),
            queue_capacity: 8,
        };
        let mut source = InteractiveSessionSource::<InteractiveSessionWire, _>::open(
            &request,
            PlatformInteractiveSessionBackend,
        )
        .expect("source opens");
        assert_eq!(source.snapshot().health, SourceHealth::Degraded);
        assert!(matches!(
            source.snapshot().state.coverage,
            InteractiveSessionCoverage::SnapshotOnly | InteractiveSessionCoverage::Unavailable
        ));
        assert_eq!(source.stop().health, SourceHealth::Stopped);
    }
}
