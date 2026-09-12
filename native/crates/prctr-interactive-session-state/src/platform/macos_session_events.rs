//! Minimized ES session notifications, with no human-session census claim.
//!
//! Graphical session identity is opaque and is NOT an audit session identity.
//! A notification is a reconciliation wakeup, never proof that an initial
//! session was absent, that SSH was interactive, or that a candidate unlocked.

use std::collections::VecDeque;
use std::sync::Mutex;
use std::sync::atomic::{AtomicBool, AtomicU8, AtomicU64, Ordering};
use std::time::Instant;

/// Explicit feed failure; none of these is a candidate-policy conclusion.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
#[repr(u8)]
pub enum MacOsSessionFeedFailure {
    Permission = 1,
    Backend = 2,
    Protocol = 3,
    QueueOverflow = 4,
    Cleanup = 5,
}

/// Fixed producer event classes. No usernames, addresses or authentication text.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum MacOsSessionNotificationKind {
    LoginWindowLogin,
    LoginWindowLogout,
    LoginWindowLock,
    LoginWindowUnlock,
    ScreenSharingAttach,
    ScreenSharingDetach,
    OpenSshLogin,
    OpenSshLogout,
    LoginLogin,
    LoginLogout,
}

/// Adapter-local equality only. Never serialize this value or equate it to ASID.
#[derive(Clone, Copy, Eq, PartialEq)]
pub struct MacOsGraphicalSessionId(u32);

/// A received producer fact. No complete state or candidate attribution implied.
pub struct MacOsSessionNotification {
    pub kind: MacOsSessionNotificationKind,
    pub graphical_session: Option<MacOsGraphicalSessionId>,
    /// Login or attach outcome, not an assertion of an interactive SSH session.
    pub succeeded: bool,
    /// Exact source callback receipt; SDK generation clock is retained separately.
    pub captured_at: Instant,
    pub native_mach_time: u64,
}
impl Drop for MacOsSessionNotification {
    fn drop(&mut self) {
        self.graphical_session = None;
        self.native_mach_time = 0;
    }
}

/// One bounded accepted prefix. A failure follows all events in this drain.
pub struct MacOsSessionFeedDrain {
    pub events: Vec<MacOsSessionNotification>,
    pub failure: Option<MacOsSessionFeedFailure>,
    /// Known missing inputs after the accepted prefix, including a received
    /// gap-triggering fact deliberately discarded when this feed is fenced.
    /// Absence does not establish an initial census.
    pub lost_event_count: Option<u64>,
}

#[repr(C)]
pub(super) struct RawSessionFact {
    pub global_sequence: u64,
    pub type_sequence: u64,
    pub mach_time: u64,
    pub graphical_session_id: u32,
    pub kind: u32,
    pub succeeded: u32,
    pub reserved: u32,
}

struct State {
    events: VecDeque<MacOsSessionNotification>,
    global: Option<u64>,
    per_type: [Option<u64>; 10],
    mach_time: Option<u64>,
}

pub(super) struct SessionIngress {
    capacity: usize,
    state: Mutex<State>,
    accepting: AtomicBool,
    failure: AtomicU8,
    lost: AtomicU64,
}
impl SessionIngress {
    pub fn new(capacity: usize) -> Result<Self, MacOsSessionFeedFailure> {
        if !(1..=1024).contains(&capacity) {
            return Err(MacOsSessionFeedFailure::Protocol);
        }
        Ok(Self {
            capacity,
            state: Mutex::new(State {
                events: VecDeque::with_capacity(capacity),
                global: None,
                per_type: [None; 10],
                mach_time: None,
            }),
            accepting: AtomicBool::new(true),
            failure: AtomicU8::new(0),
            lost: AtomicU64::new(0),
        })
    }
    pub fn fence(&self) {
        self.accepting.store(false, Ordering::Release);
    }
    pub fn fail(&self, failure: MacOsSessionFeedFailure, lost: u64) {
        self.fence();
        if failure == MacOsSessionFeedFailure::Cleanup {
            self.failure.store(failure as u8, Ordering::Release);
        } else {
            let _ = self.failure.compare_exchange(
                0,
                failure as u8,
                Ordering::AcqRel,
                Ordering::Acquire,
            );
        }
        if lost != 0 {
            self.lost.fetch_max(lost, Ordering::AcqRel);
        }
    }
    pub fn receive(&self, raw: &RawSessionFact, captured_at: Instant) {
        if !self.accepting.load(Ordering::Acquire) {
            return;
        }
        // Callback contention is an explicit loss, never a blocking OS callback.
        let Ok(mut state) = self.state.try_lock() else {
            self.fail(MacOsSessionFeedFailure::QueueOverflow, 1);
            return;
        };
        if !self.accepting.load(Ordering::Acquire) {
            return;
        }
        let Some((kind, index, graphical)) = decode(raw) else {
            self.fail(MacOsSessionFeedFailure::Protocol, 0);
            return;
        };
        if let Some(previous) = state.global {
            if raw.global_sequence <= previous {
                self.fail(MacOsSessionFeedFailure::Protocol, 0);
                return;
            }
            if raw.global_sequence - previous != 1 {
                self.fail(
                    MacOsSessionFeedFailure::QueueOverflow,
                    // The gap-triggering fact is received but not admitted to
                    // the contiguous prefix, so count its deliberate loss too.
                    raw.global_sequence - previous,
                );
                return;
            }
        }
        if state.per_type[index]
            .is_some_and(|previous| previous.checked_add(1) != Some(raw.type_sequence))
            || state
                .mach_time
                .is_some_and(|previous| raw.mach_time < previous)
        {
            self.fail(MacOsSessionFeedFailure::Protocol, 0);
            return;
        }
        if state.events.len() == self.capacity {
            self.fail(MacOsSessionFeedFailure::QueueOverflow, 1);
            return;
        }
        state.global = Some(raw.global_sequence);
        state.per_type[index] = Some(raw.type_sequence);
        state.mach_time = Some(raw.mach_time);
        state.events.push_back(MacOsSessionNotification {
            kind,
            graphical_session: graphical
                .then_some(MacOsGraphicalSessionId(raw.graphical_session_id)),
            succeeded: raw.succeeded == 1,
            captured_at,
            native_mach_time: raw.mach_time,
        });
    }
    pub fn has_pending_input(&self) -> bool {
        self.failure.load(Ordering::Acquire) != 0
            || self
                .state
                .try_lock()
                .map_or(true, |state| !state.events.is_empty())
    }
    pub fn drain(&self) -> MacOsSessionFeedDrain {
        // Do not publish a terminal before an already accepted callback finishes.
        let mut state = match self.state.try_lock() {
            Ok(state) => state,
            Err(std::sync::TryLockError::WouldBlock) => return empty(),
            Err(std::sync::TryLockError::Poisoned(poisoned)) => {
                self.fail(MacOsSessionFeedFailure::Protocol, 0);
                poisoned.into_inner()
            }
        };
        let failure = match self.failure.load(Ordering::Acquire) {
            0 => None,
            1 => Some(MacOsSessionFeedFailure::Permission),
            2 => Some(MacOsSessionFeedFailure::Backend),
            3 => Some(MacOsSessionFeedFailure::Protocol),
            4 => Some(MacOsSessionFeedFailure::QueueOverflow),
            _ => Some(MacOsSessionFeedFailure::Cleanup),
        };
        let lost = self.lost.load(Ordering::Acquire);
        MacOsSessionFeedDrain {
            events: state.events.drain(..).collect(),
            failure,
            lost_event_count: (lost != 0).then_some(lost),
        }
    }
}
fn empty() -> MacOsSessionFeedDrain {
    MacOsSessionFeedDrain {
        events: Vec::new(),
        failure: None,
        lost_event_count: None,
    }
}
fn decode(raw: &RawSessionFact) -> Option<(MacOsSessionNotificationKind, usize, bool)> {
    use MacOsSessionNotificationKind as Kind;
    if raw.reserved != 0 || raw.succeeded > 1 || raw.mach_time == 0 {
        return None;
    }
    let (kind, graphical) = match raw.kind {
        1 => (Kind::LoginWindowLogin, true),
        2 => (Kind::LoginWindowLogout, true),
        3 => (Kind::LoginWindowLock, true),
        4 => (Kind::LoginWindowUnlock, true),
        5 => (Kind::ScreenSharingAttach, true),
        6 => (Kind::ScreenSharingDetach, true),
        7 => (Kind::OpenSshLogin, false),
        8 => (Kind::OpenSshLogout, false),
        9 => (Kind::LoginLogin, false),
        10 => (Kind::LoginLogout, false),
        _ => return None,
    };
    if !graphical && raw.graphical_session_id != 0 {
        return None;
    }
    if !matches!(raw.kind, 5 | 7 | 9) && raw.succeeded != 1 {
        return None;
    }
    Some((kind, usize::try_from(raw.kind - 1).ok()?, graphical))
}

#[cfg(test)]
mod tests {
    use super::*;
    fn fact(kind: u32, global: u64, per_type: u64) -> RawSessionFact {
        RawSessionFact {
            global_sequence: global,
            type_sequence: per_type,
            mach_time: global + 1,
            graphical_session_id: if kind <= 6 { 42 } else { 0 },
            kind,
            succeeded: 1,
            reserved: 0,
        }
    }
    #[test]
    fn preserves_all_producer_kinds_without_candidate_attribution() {
        let ingress = SessionIngress::new(10).unwrap();
        for kind in 1..=10 {
            ingress.receive(&fact(kind, u64::from(kind), 0), Instant::now());
        }
        let drain = ingress.drain();
        assert_eq!(drain.events.len(), 10);
        assert_eq!(drain.failure, None);
        assert_eq!(
            drain.events[6].kind,
            MacOsSessionNotificationKind::OpenSshLogin
        );
        assert!(drain.events[6].graphical_session.is_none());
        assert!(drain.events[0].graphical_session == drain.events[3].graphical_session);
    }
    #[test]
    fn first_counter_is_a_baseline_and_does_not_claim_a_prefix() {
        let ingress = SessionIngress::new(2).unwrap();
        ingress.receive(&fact(1, 800, 400), Instant::now());
        ingress.receive(&fact(1, 801, 401), Instant::now());
        assert_eq!(ingress.drain().failure, None);
    }
    #[test]
    fn exact_global_loss_follows_accepted_tail_and_fences_later_callbacks() {
        let ingress = SessionIngress::new(2).unwrap();
        ingress.receive(&fact(1, 1, 1), Instant::now());
        ingress.receive(&fact(2, 5, 1), Instant::now());
        ingress.receive(&fact(3, 6, 1), Instant::now());
        let drain = ingress.drain();
        assert_eq!(drain.events.len(), 1);
        assert_eq!(drain.failure, Some(MacOsSessionFeedFailure::QueueOverflow));
        assert_eq!(drain.lost_event_count, Some(4));
        assert!(ingress.drain().events.is_empty());
    }
    #[test]
    fn retained_queue_overflow_never_discards_accepted_prefix() {
        let ingress = SessionIngress::new(1).unwrap();
        ingress.receive(&fact(3, 1, 1), Instant::now());
        ingress.receive(&fact(4, 2, 1), Instant::now());
        let drain = ingress.drain();
        assert_eq!(
            drain.events[0].kind,
            MacOsSessionNotificationKind::LoginWindowLock
        );
        assert_eq!(drain.lost_event_count, Some(1));
    }
    #[test]
    fn callback_contention_fails_without_waiting_or_publishing_ahead_of_tail() {
        let ingress = SessionIngress::new(2).unwrap();
        ingress.receive(&fact(1, 1, 1), Instant::now());
        let held = ingress.state.lock().unwrap();
        ingress.receive(&fact(2, 2, 1), Instant::now());
        assert!(ingress.drain().failure.is_none());
        drop(held);
        let drain = ingress.drain();
        assert_eq!(drain.events.len(), 1);
        assert_eq!(drain.failure, Some(MacOsSessionFeedFailure::QueueOverflow));
    }
    #[test]
    fn malformed_order_and_shape_remain_protocol_failures() {
        for mut second in [fact(1, 1, 2), fact(1, 2, 4), fact(0, 2, 2), fact(7, 2, 1)] {
            if second.kind == 7 {
                second.graphical_session_id = 42;
            }
            let ingress = SessionIngress::new(2).unwrap();
            ingress.receive(&fact(1, 1, 1), Instant::now());
            ingress.receive(&second, Instant::now());
            assert_eq!(
                ingress.drain().failure,
                Some(MacOsSessionFeedFailure::Protocol)
            );
        }
    }
    #[test]
    fn cleanup_failure_takes_precedence_and_fence_rejects_late_input() {
        let ingress = SessionIngress::new(2).unwrap();
        ingress.fence();
        ingress.receive(&fact(1, 1, 1), Instant::now());
        ingress.fail(MacOsSessionFeedFailure::Backend, 0);
        ingress.fail(MacOsSessionFeedFailure::Cleanup, 0);
        let drain = ingress.drain();
        assert!(drain.events.is_empty());
        assert_eq!(drain.failure, Some(MacOsSessionFeedFailure::Cleanup));
    }
}
