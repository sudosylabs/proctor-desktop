#![deny(unsafe_code)]

mod platform;

use native_protocol::{
    InteractiveConsoleOwnership, InteractiveLockState, InteractiveRemoteAttachment,
    InteractiveSessionCertainty, InteractiveSessionCoverage, InteractiveSessionDrain,
    InteractiveSessionEvent, InteractiveSessionEventKind, InteractiveSessionObservation,
    InteractiveSessionSourceSnapshot, InteractiveSessionState, SourceHealth,
};
use native_source_runtime::PassiveStateWire;

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

    native_source_runtime::passive_state_constructors! {
        event: InteractiveSessionEvent,
        event_kind: InteractiveSessionEventKind,
        snapshot: InteractiveSessionSourceSnapshot,
        observation: InteractiveSessionObservation,
        drain: InteractiveSessionDrain,
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
