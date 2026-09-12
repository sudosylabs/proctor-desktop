//! Bounded, OS-independent WTS notification admission and minimized projections.
use prctr_native_protocol::{
    InteractiveConsoleOwnership, InteractiveLockState, InteractiveRemoteAttachment,
    InteractiveSessionCertainty, InteractiveSessionCoverage, InteractiveSessionEvent,
    InteractiveSessionEventKind, InteractiveSessionState,
};
use prctr_native_source_runtime::{DeadlineThread, PassiveStateSourceError};
use std::collections::VecDeque;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex, mpsc};
use std::time::Instant;

/// Native-only candidate context. The service obtains it from its authenticated
/// peer token; it must never be deserialized from a helper request.
#[derive(Clone, Copy, Eq, PartialEq)]
pub struct WindowsCandidateSession {
    pub(super) session_id: u32,
    pub(super) authentication_id: u64,
}
impl WindowsCandidateSession {
    #[must_use]
    pub const fn from_verified_peer(session_id: u32, authentication_id: u64) -> Option<Self> {
        if session_id == 0 || session_id == u32::MAX || authentication_id == 0 {
            None
        } else {
            Some(Self {
                session_id,
                authentication_id,
            })
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(super) struct WindowsSessionNotification {
    pub(super) event_type: u32,
    pub(super) session_id: u32,
    pub(super) observed_at: Instant,
}

pub(super) struct IngressState {
    pub(super) accepting: bool,
    pub(super) sequence: u64,
    pub(super) retained: usize,
    pub(super) queue: VecDeque<WindowsSessionNotification>,
}

pub(super) struct Ingress {
    pub(super) state: Mutex<IngressState>,
    pub(super) failed: AtomicBool,
    pub(super) capacity: usize,
}

impl Ingress {
    pub(super) fn record(&self, notification: WindowsSessionNotification) {
        // OS callbacks never wait for a consumer or allocate an unbounded tail.
        let Ok(mut state) = self.state.try_lock() else {
            self.failed.store(true, Ordering::Release);
            return;
        };
        if !state.accepting || self.failed.load(Ordering::Acquire) {
            return;
        }
        let Some(sequence) = state.sequence.checked_add(1) else {
            self.failed.store(true, Ordering::Release);
            return;
        };
        if state.queue.len().saturating_add(state.retained) >= self.capacity {
            self.failed.store(true, Ordering::Release);
            return;
        }
        state.sequence = sequence;
        state.queue.push_back(notification);
    }

    pub(super) fn take(
        &self,
        stop: bool,
    ) -> Result<(Vec<WindowsSessionNotification>, bool), PassiveStateSourceError> {
        let mut state = self
            .state
            .lock()
            .map_err(|_| backend("WTS ingress poisoned"))?;
        let failed = self.failed.load(Ordering::Acquire);
        if stop || failed {
            state.accepting = false;
        }
        // Close under the same mutex used by callbacks before exposing failure.
        state.retained += state.queue.len();
        Ok((state.queue.drain(..).collect(), failed))
    }

    pub(super) fn finish_batch(&self) {
        if let Ok(mut state) = self.state.lock() {
            state.retained = 0;
        }
    }
}

/// Capture time belongs to the native callback, before any later WTS query.
pub struct WindowsWtsSessionEvent {
    pub event: InteractiveSessionEvent,
    pub observed_at: Instant,
}

pub struct WindowsWtsSessionSnapshot {
    pub state: InteractiveSessionState,
    pub capture_started_at: Instant,
    pub observed_at: Instant,
}

pub(super) struct PendingQuery {
    pub(super) worker: DeadlineThread,
    pub(super) result: mpsc::Receiver<Result<WindowsWtsSessionSnapshot, PassiveStateSourceError>>,
    pub(super) sequence: u64,
    pub(super) deadline: Instant,
    pub(super) attempts: usize,
}

impl PendingQuery {
    pub(super) fn start<F>(
        deadline: Instant,
        sequence: u64,
        attempts: usize,
        query: F,
    ) -> Result<Self, PassiveStateSourceError>
    where
        F: FnOnce() -> Result<WindowsWtsSessionSnapshot, PassiveStateSourceError> + Send + 'static,
    {
        if Instant::now() >= deadline {
            return Err(backend("WTS query deadline exceeded"));
        }
        let (sender, result) = mpsc::sync_channel(1);
        let worker = DeadlineThread::spawn("prctr-wts-query", move || {
            let _ = sender.send(query());
        })
        .map_err(|_| backend("WTS query worker cannot start"))?;
        Ok(Self {
            worker,
            result,
            sequence,
            deadline,
            attempts,
        })
    }
}

pub(super) fn minimize(
    candidate: WindowsCandidateSession,
    notifications: Vec<WindowsSessionNotification>,
) -> Vec<WindowsWtsSessionEvent> {
    notifications
        .into_iter()
        .filter(|event| event.session_id != 0)
        .map(|event| {
            let candidate = event.session_id == candidate.session_id;
            let state = InteractiveSessionState {
                coverage: InteractiveSessionCoverage::FullLifecycle,
                certainty: InteractiveSessionCertainty::Partial,
                console_ownership: match (candidate, event.event_type) {
                    (true, 2 | 6 | 11) => InteractiveConsoleOwnership::None,
                    _ => InteractiveConsoleOwnership::Unknown,
                },
                lock_state: match (candidate, event.event_type) {
                    (true, 7) => InteractiveLockState::Locked,
                    (true, 8) => InteractiveLockState::Unlocked,
                    _ => InteractiveLockState::Unknown,
                },
                remote_attachment: if event.event_type == 3 {
                    InteractiveRemoteAttachment::Present
                } else {
                    InteractiveRemoteAttachment::Unknown
                },
                other_human_session_count: 0,
            };
            WindowsWtsSessionEvent {
                event: InteractiveSessionEvent {
                    kind: InteractiveSessionEventKind::Changed,
                    state,
                },
                observed_at: event.observed_at,
            }
        })
        .collect()
}

fn backend(reason: &str) -> PassiveStateSourceError {
    PassiveStateSourceError::Backend(reason.to_owned())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;

    fn ingress(capacity: usize) -> Ingress {
        Ingress {
            state: Mutex::new(IngressState {
                accepting: true,
                sequence: 0,
                retained: 0,
                queue: VecDeque::with_capacity(capacity),
            }),
            failed: AtomicBool::new(false),
            capacity,
        }
    }

    fn event(session_id: u32, event_type: u32, observed_at: Instant) -> WindowsSessionNotification {
        WindowsSessionNotification {
            event_type,
            session_id,
            observed_at,
        }
    }

    #[test]
    fn rapid_lock_unlock_preserves_both_capture_times_and_order() {
        let candidate = WindowsCandidateSession::from_verified_peer(2, 123).expect("candidate");
        let now = Instant::now();
        let later = now + Duration::from_millis(1);
        let events = minimize(candidate, vec![event(2, 7, now), event(2, 8, later)]);
        assert_eq!(events.len(), 2);
        assert_eq!(
            events[0].event.state.lock_state,
            InteractiveLockState::Locked
        );
        assert_eq!(
            events[1].event.state.lock_state,
            InteractiveLockState::Unlocked
        );
        assert_eq!(events[0].observed_at, now);
        assert_eq!(events[1].observed_at, later);
        assert!(
            events
                .iter()
                .all(|event| event.event.state.certainty == InteractiveSessionCertainty::Partial)
        );
    }

    #[test]
    fn other_session_lock_is_not_reported_as_candidate_lock() {
        let candidate = WindowsCandidateSession::from_verified_peer(2, 123).expect("candidate");
        let events = minimize(candidate, vec![event(3, 7, Instant::now())]);
        assert_eq!(
            events[0].event.state.lock_state,
            InteractiveLockState::Unknown
        );
        assert_eq!(
            events[0].event.state.console_ownership,
            InteractiveConsoleOwnership::Unknown
        );
    }

    #[test]
    fn service_session_does_not_count_and_remote_connect_stays_visible() {
        let candidate = WindowsCandidateSession::from_verified_peer(2, 123).expect("candidate");
        let events = minimize(
            candidate,
            vec![event(0, 5, Instant::now()), event(3, 3, Instant::now())],
        );
        assert_eq!(events.len(), 1);
        assert_eq!(
            events[0].event.state.remote_attachment,
            InteractiveRemoteAttachment::Present
        );
    }

    #[test]
    fn overflow_returns_accepted_tail_before_fencing_later_callbacks() {
        let ingress = ingress(2);
        let first = event(2, 7, Instant::now());
        let second = event(2, 8, Instant::now());
        ingress.record(first);
        ingress.record(second);
        ingress.record(event(2, 7, Instant::now()));
        let (tail, failed) = ingress.take(false).expect("drain");
        assert!(failed);
        assert_eq!(tail, [first, second]);
        ingress.record(event(2, 8, Instant::now()));
        assert!(ingress.take(false).expect("closed drain").0.is_empty());
    }

    #[test]
    fn callback_contention_fails_without_waiting_for_the_consumer() {
        let ingress = ingress(2);
        let held = ingress.state.lock().expect("consumer owns state");
        ingress.record(event(2, 7, Instant::now()));
        assert!(ingress.failed.load(Ordering::Acquire));
        drop(held);
        let (tail, failed) = ingress.take(false).expect("terminal drain");
        assert!(tail.is_empty());
        assert!(failed);
    }

    #[test]
    fn normal_stop_drains_once_and_rejects_post_stop_input() {
        let ingress = ingress(2);
        ingress.record(event(2, 7, Instant::now()));
        let (tail, failed) = ingress.take(true).expect("stop");
        assert_eq!(tail.len(), 1);
        assert!(!failed);
        ingress.record(event(2, 8, Instant::now()));
        assert!(ingress.take(true).expect("stopped").0.is_empty());
    }

    #[test]
    fn candidate_binding_requires_a_nonservice_session_and_logon_generation() {
        assert!(WindowsCandidateSession::from_verified_peer(0, 123).is_none());
        assert!(WindowsCandidateSession::from_verified_peer(u32::MAX, 123).is_none());
        assert!(WindowsCandidateSession::from_verified_peer(2, 0).is_none());
        let first = WindowsCandidateSession::from_verified_peer(2, 123).expect("first logon");
        let replacement =
            WindowsCandidateSession::from_verified_peer(2, 124).expect("reused session ID");
        assert_ne!(first.authentication_id, replacement.authentication_id);
    }
    #[test]
    fn console_connect_and_desktop_ready_do_not_claim_active_ownership() {
        let candidate = WindowsCandidateSession::from_verified_peer(2, 123).expect("candidate");
        for kind in [1, 0xF] {
            let events = minimize(candidate, vec![event(2, kind, Instant::now())]);
            assert_eq!(events.len(), 1);
            assert_eq!(
                events[0].event.state.console_ownership,
                InteractiveConsoleOwnership::Unknown
            );
        }
    }
    #[test]
    fn blocked_reconciliation_does_not_block_native_wakeup_delivery() {
        let deadline = Instant::now() + Duration::from_secs(2);
        let (release, wait) = mpsc::sync_channel(1);
        let mut query = PendingQuery::start(deadline, 0, 1, move || {
            wait.recv().expect("query release");
            Err(backend("fixture query finished"))
        })
        .expect("query worker");
        let ingress = ingress(1);
        ingress.record(event(2, 7, Instant::now()));
        let (tail, failed) = ingress.take(false).expect("wakeup independent from query");
        assert!(!failed);
        assert_eq!(tail.len(), 1);
        assert!(!query.worker.is_finished());
        assert_eq!(query.deadline, deadline);
        release.send(()).expect("release");
        query
            .worker
            .finish(Duration::from_secs(1))
            .expect("query joined");
        assert!(query.result.try_recv().expect("query result").is_err());
    }

    #[test]
    fn expired_reconciliation_does_not_start_a_worker() {
        let result = PendingQuery::start(Instant::now(), 0, 1, || {
            panic!("expired query must not execute")
        });
        assert!(result.is_err());
    }
    #[test]
    fn extracted_tail_keeps_its_capacity_until_the_operation_returns() {
        let ingress = ingress(2);
        ingress.record(event(2, 7, Instant::now()));
        let (first, failed) = ingress.take(false).expect("first phase");
        assert!(!failed);
        ingress.record(event(2, 8, Instant::now()));
        ingress.record(event(2, 7, Instant::now()));
        let (tail, failed) = ingress.take(true).expect("close tail");
        assert!(failed);
        assert_eq!(first.len() + tail.len(), 2);
        ingress.finish_batch();
        assert!(
            ingress
                .take(true)
                .expect("terminal tail consumed")
                .0
                .is_empty()
        );
    }

    #[test]
    fn next_operation_reuses_capacity_only_after_batch_return() {
        let ingress = ingress(1);
        ingress.record(event(2, 7, Instant::now()));
        assert_eq!(ingress.take(false).expect("first drain").0.len(), 1);
        ingress.finish_batch();
        ingress.record(event(2, 8, Instant::now()));
        let (tail, failed) = ingress.take(false).expect("next drain");
        assert!(!failed);
        assert_eq!(tail.len(), 1);
    }
}
