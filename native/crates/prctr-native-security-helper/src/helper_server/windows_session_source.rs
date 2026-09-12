use std::sync::Arc;
use std::time::Instant;

use prctr_interactive_session_state::{
    InteractiveSessionError, WindowsCandidateSession, WindowsWtsServiceDispatcher,
    WindowsWtsSessionDrain, WindowsWtsSessionSource,
};
use prctr_native_helper_protocol::HelperFailureCode;

use super::interactive_session_source::{
    SessionDrain, SessionEvent, SessionOpener, SessionSnapshot, SessionSource,
};

/// The service owner supplies authenticated token context; the helper wire
/// cannot select another OS session or create a service dispatcher.
pub(super) struct WindowsSessionOpener {
    dispatcher: Arc<WindowsWtsServiceDispatcher>,
    candidate: WindowsCandidateSession,
}
impl WindowsSessionOpener {
    pub(super) fn new(
        dispatcher: Arc<WindowsWtsServiceDispatcher>,
        candidate: WindowsCandidateSession,
    ) -> Self {
        Self {
            dispatcher,
            candidate,
        }
    }
}
impl SessionOpener for WindowsSessionOpener {
    type Source = WindowsSessionSource;
    fn open(
        &mut self,
        capacity: usize,
        deadline: Instant,
    ) -> Result<(SessionSnapshot, Self::Source), HelperFailureCode> {
        self.dispatcher
            .open_source(self.candidate, capacity, deadline)
            .map(|(snapshot, source)| {
                (
                    SessionSnapshot {
                        state: snapshot.state,
                        capture_started_at: snapshot.capture_started_at,
                        observed_at: snapshot.observed_at,
                    },
                    WindowsSessionSource(source),
                )
            })
            .map_err(|error| failure_code(&error))
    }
}
pub(super) struct WindowsSessionSource(WindowsWtsSessionSource);
impl SessionSource for WindowsSessionSource {
    fn has_pending_input(&self) -> bool {
        self.0.has_pending_input()
    }
    fn drain(&mut self, deadline: Instant) -> SessionDrain {
        translate(self.0.drain(deadline))
    }
    fn close(&mut self, deadline: Instant) -> SessionDrain {
        translate(self.0.close(deadline))
    }
}
fn translate(drain: WindowsWtsSessionDrain) -> SessionDrain {
    SessionDrain {
        events: drain
            .events
            .into_iter()
            .map(|event| SessionEvent {
                event: event.event,
                observed_at: event.observed_at,
            })
            .collect(),
        snapshot: drain.state.map(|snapshot| SessionSnapshot {
            state: snapshot.state,
            capture_started_at: snapshot.capture_started_at,
            observed_at: snapshot.observed_at,
        }),
        failure: drain.failure.as_ref().map(failure_code),
    }
}
fn failure_code(error: &InteractiveSessionError) -> HelperFailureCode {
    match error {
        InteractiveSessionError::Backend(_) => HelperFailureCode::Backend,
        InteractiveSessionError::Cleanup(_) => HelperFailureCode::Cleanup,
        InteractiveSessionError::InventoryOverflow(_) => HelperFailureCode::InventoryOverflow,
        InteractiveSessionError::QueueOverflow => HelperFailureCode::QueueOverflow,
        InteractiveSessionError::Protocol(_) | InteractiveSessionError::Queue(_) => {
            HelperFailureCode::Protocol
        }
    }
}
