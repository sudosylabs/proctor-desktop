//! Protocol bridge for privileged, authenticated interactive-session sources.
//! OS ownership stays in the concrete opener; this module owns wire sequencing.
use std::time::{Duration, Instant};

use native_helper_protocol::{
    HelperFailureCode, HelperObservation, HelperSourceFailure, HelperSourceKind, HelperSourceOpen,
    HelperSourceSnapshot,
};
use native_protocol::{
    INTERACTIVE_SESSION_SCHEMA_VERSION, InteractiveSessionEvent, InteractiveSessionEventKind,
    InteractiveSessionState, MAX_PROTOCOL_SAFE_INTEGER, ProtocolValidatable,
};

use super::{
    HelperSource, HelperSourceCloseOutput, HelperSourceEvent, HelperSourceOpenOutcome,
    HelperTransportError, OpenedHelperSource, unavailable_snapshot,
};

const OPERATION_BUDGET: Duration = Duration::from_secs(3);
const POLL_INTERVAL: Duration = Duration::from_millis(250);
const IDLE_HEALTH_INTERVAL: Duration = Duration::from_secs(5);

pub(super) struct SessionSnapshot {
    pub state: InteractiveSessionState,
    pub capture_started_at: Instant,
    pub observed_at: Instant,
}

pub(super) struct SessionEvent {
    pub event: InteractiveSessionEvent,
    pub observed_at: Instant,
}

pub(super) struct SessionDrain {
    pub events: Vec<SessionEvent>,
    pub snapshot: Option<SessionSnapshot>,
    pub failure: Option<HelperFailureCode>,
}

pub(super) trait SessionSource {
    fn has_pending_input(&self) -> bool;
    fn drain(&mut self, deadline: Instant) -> SessionDrain;
    fn close(&mut self, deadline: Instant) -> SessionDrain;
}

pub(super) trait SessionOpener {
    type Source: SessionSource + 'static;
    fn open(
        &mut self,
        capacity: usize,
        deadline: Instant,
    ) -> Result<(SessionSnapshot, Self::Source), HelperFailureCode>;
}

pub(super) fn open_session_source<O: SessionOpener>(
    request: &HelperSourceOpen,
    monotonic_time_ns: u64,
    opener: &mut O,
) -> HelperSourceOpenOutcome {
    let origin = Instant::now();
    let deadline = origin + OPERATION_BUDGET;
    let mut clock = SessionClock {
        origin,
        origin_ns: monotonic_time_ns,
        last_ns: monotonic_time_ns,
    };
    if request.source_kind != HelperSourceKind::InteractiveSession
        || request.validate_protocol().is_err()
    {
        return HelperSourceOpenOutcome::Failed(failure(
            request,
            0,
            monotonic_time_ns,
            HelperFailureCode::Protocol,
        ));
    }
    // Reserve one observation slot for the authoritative reconciliation.
    match opener.open(usize::from(request.queue_capacity) - 1, deadline) {
        Ok((initial, mut source)) => {
            let valid = initial.state.validate_protocol().is_ok()
                && initial.capture_started_at >= origin
                && initial.observed_at >= initial.capture_started_at
                && initial.observed_at <= Instant::now();
            if !valid || Instant::now() >= deadline {
                let closed = source.close(deadline);
                let code = if closed.failure == Some(HelperFailureCode::Cleanup)
                    || Instant::now() >= deadline
                {
                    HelperFailureCode::Cleanup
                } else if valid {
                    HelperFailureCode::Backend
                } else {
                    HelperFailureCode::Protocol
                };
                return HelperSourceOpenOutcome::Failed(failure(
                    request,
                    0,
                    clock.at(Instant::now()),
                    code,
                ));
            }
            let initial_time = clock.at(initial.observed_at);
            let last_state = initial.state.clone();
            HelperSourceOpenOutcome::Opened(OpenedHelperSource {
                initial_snapshot: snapshot(request, 0, initial_time, initial.state),
                source: Box::new(SessionHelperSource {
                    request: request.clone(),
                    source,
                    clock,
                    sequence: 0,
                    terminal: false,
                    next_poll: Instant::now() + POLL_INTERVAL,
                    next_health_check: Instant::now() + IDLE_HEALTH_INTERVAL,
                    last_state,
                    awaiting_reconciliation: false,
                }),
            })
        }
        Err(code) => {
            HelperSourceOpenOutcome::Failed(failure(request, 0, clock.at(Instant::now()), code))
        }
    }
}

struct SessionHelperSource<S: SessionSource> {
    request: HelperSourceOpen,
    source: S,
    clock: SessionClock,
    sequence: u64,
    terminal: bool,
    next_poll: Instant,
    next_health_check: Instant,
    last_state: InteractiveSessionState,
    awaiting_reconciliation: bool,
}

impl<S: SessionSource> HelperSource for SessionHelperSource<S> {
    fn source_kind(&self) -> HelperSourceKind {
        HelperSourceKind::InteractiveSession
    }
    fn schema_version(&self) -> u16 {
        INTERACTIVE_SESSION_SCHEMA_VERSION
    }
    fn drain(&mut self) -> Result<Vec<HelperSourceEvent>, HelperTransportError> {
        if self.terminal || Instant::now() < self.next_poll {
            return Ok(Vec::new());
        }
        if !self.source.has_pending_input() && Instant::now() < self.next_health_check {
            return Ok(Vec::new());
        }
        let deadline = Instant::now() + OPERATION_BUDGET;
        let mut drain = self.source.drain(deadline);
        self.next_poll = Instant::now() + POLL_INTERVAL;
        self.next_health_check = Instant::now() + IDLE_HEALTH_INTERVAL;
        if Instant::now() >= deadline {
            drain.snapshot = None;
            drain.failure.get_or_insert(HelperFailureCode::Backend);
        }
        self.translate(drain, false).map(|(events, _)| events)
    }
    fn close(
        &mut self,
        monotonic_time_ns: u64,
    ) -> Result<HelperSourceCloseOutput, HelperTransportError> {
        let deadline = Instant::now() + OPERATION_BUDGET;
        let mut drain = self.source.close(deadline);
        if Instant::now() >= deadline {
            drain.snapshot = None;
            drain.failure = Some(HelperFailureCode::Cleanup);
        }
        let (events, final_state) = self.translate(drain, true)?;
        self.clock.last_ns = self.clock.last_ns.max(monotonic_time_ns);
        let time = self.clock.at(Instant::now());
        let final_snapshot = final_state.map_or_else(
            || {
                let mut unavailable = unavailable_snapshot(&self.request, time);
                unavailable.last_sequence = self.sequence;
                unavailable
            },
            |state| snapshot(&self.request, self.sequence, time, state),
        );
        Ok(HelperSourceCloseOutput {
            events,
            final_snapshot,
        })
    }
}

impl<S: SessionSource> SessionHelperSource<S> {
    fn validate_drain(
        &self,
        drain: &SessionDrain,
        now: Instant,
    ) -> Result<(), HelperTransportError> {
        let mut previous = self.clock.last_ns;
        for event in &drain.events {
            let time = self.clock.value(event.observed_at);
            if event.event.validate_protocol().is_err()
                || event.observed_at < self.clock.origin
                || event.observed_at > now
                || time < previous
            {
                return Err(native_helper_protocol::HelperProtocolError::Sequence.into());
            }
            previous = time;
        }
        if let Some(state) = &drain.snapshot
            && (state.state.validate_protocol().is_err()
                || state.capture_started_at < self.clock.origin
                || state.observed_at < state.capture_started_at
                || state.observed_at > now
                || self.clock.value(state.observed_at) < previous)
        {
            return Err(native_helper_protocol::HelperProtocolError::Sequence.into());
        }
        if self.terminal && (!drain.events.is_empty() || drain.snapshot.is_some()) {
            return Err(native_helper_protocol::HelperProtocolError::Lifecycle.into());
        }
        Ok(())
    }

    fn translate(
        &mut self,
        mut drain: SessionDrain,
        closing: bool,
    ) -> Result<(Vec<HelperSourceEvent>, Option<InteractiveSessionState>), HelperTransportError>
    {
        // Validate the complete native batch before changing the wire cursor.
        let now = Instant::now();
        self.validate_drain(&drain, now)?;
        if closing && !self.terminal && drain.snapshot.is_none() && drain.failure.is_none() {
            drain.failure = Some(HelperFailureCode::Backend);
        }
        let final_state = if drain.failure.is_none() && !self.terminal {
            drain.snapshot.as_ref().map(|value| value.state.clone())
        } else {
            None
        };
        // A reconciliation is itself an observation; notifications keep their
        // callback timestamps and precede the authoritative query result.
        let has_notifications = !drain.events.is_empty();
        let needs_reconciliation = self.awaiting_reconciliation
            || has_notifications
            || final_state
                .as_ref()
                .is_some_and(|state| state != &self.last_state);
        if let Some(state) = drain
            .snapshot
            .filter(|_| drain.failure.is_none() && !closing && needs_reconciliation)
        {
            drain.events.push(SessionEvent {
                event: InteractiveSessionEvent {
                    kind: InteractiveSessionEventKind::Reconciled,
                    state: state.state,
                },
                observed_at: state.observed_at,
            });
        }
        let count = u64::try_from(drain.events.len())
            .map_err(|_| native_helper_protocol::HelperProtocolError::Sequence)?;
        if count > u64::from(self.request.queue_capacity) {
            return Err(native_helper_protocol::HelperProtocolError::Sequence.into());
        }
        if self
            .sequence
            .checked_add(count)
            .is_none_or(|end| end > MAX_PROTOCOL_SAFE_INTEGER)
        {
            return Err(native_helper_protocol::HelperProtocolError::Sequence.into());
        }
        let mut events =
            Vec::with_capacity(drain.events.len() + usize::from(drain.failure.is_some()));
        for event in drain.events {
            self.sequence += 1;
            events.push(HelperSourceEvent::Observation(Box::new(
                HelperObservation {
                    channel_nonce: self.request.channel_nonce.clone(),
                    helper_source_instance_id: self.request.helper_source_instance_id.clone(),
                    source_kind: HelperSourceKind::InteractiveSession,
                    sequence: self.sequence,
                    monotonic_time_ns: self.clock.at(event.observed_at),
                    process_event: None,
                    interactive_session_event: Some(event.event),
                },
            )));
        }
        if let Some(code) = drain.failure {
            if !self.terminal
                || matches!(
                    code,
                    HelperFailureCode::Cleanup | HelperFailureCode::Protocol
                )
            {
                events.push(HelperSourceEvent::Failure(failure(
                    &self.request,
                    self.sequence,
                    self.clock.at(now),
                    code,
                )));
            }
            self.terminal = true;
        }
        if let Some(state) = &final_state {
            self.last_state = state.clone();
        }
        if has_notifications {
            self.awaiting_reconciliation = true;
        }
        if final_state.as_ref().is_some_and(|state| {
            state.certainty == native_protocol::InteractiveSessionCertainty::Complete
        }) {
            self.awaiting_reconciliation = false;
        }
        Ok((events, final_state))
    }
}

struct SessionClock {
    origin: Instant,
    origin_ns: u64,
    last_ns: u64,
}
impl SessionClock {
    fn value(&self, at: Instant) -> u64 {
        self.origin_ns
            .saturating_add(
                u64::try_from(at.saturating_duration_since(self.origin).as_nanos())
                    .unwrap_or(u64::MAX),
            )
            .min(MAX_PROTOCOL_SAFE_INTEGER)
    }
    fn at(&mut self, at: Instant) -> u64 {
        self.last_ns = self.last_ns.max(self.value(at));
        self.last_ns
    }
}
fn snapshot(
    request: &HelperSourceOpen,
    sequence: u64,
    time: u64,
    state: InteractiveSessionState,
) -> HelperSourceSnapshot {
    HelperSourceSnapshot {
        channel_nonce: request.channel_nonce.clone(),
        helper_source_instance_id: request.helper_source_instance_id.clone(),
        source_kind: HelperSourceKind::InteractiveSession,
        schema_version: INTERACTIVE_SESSION_SCHEMA_VERSION,
        last_sequence: sequence,
        monotonic_time_ns: time,
        process_state: None,
        interactive_session_state: Some(state),
    }
}
fn failure(
    request: &HelperSourceOpen,
    sequence: u64,
    time: u64,
    code: HelperFailureCode,
) -> HelperSourceFailure {
    HelperSourceFailure {
        channel_nonce: request.channel_nonce.clone(),
        helper_source_instance_id: request.helper_source_instance_id.clone(),
        source_kind: HelperSourceKind::InteractiveSession,
        failure_code: code,
        last_sequence: sequence,
        monotonic_time_ns: time,
        lost_event_count: (code == HelperFailureCode::QueueOverflow).then_some(1),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use native_helper_protocol::HelperEventClass;
    use native_protocol::{
        InteractiveConsoleOwnership, InteractiveLockState, InteractiveRemoteAttachment,
        InteractiveSessionCertainty, InteractiveSessionCoverage,
    };
    struct EmptySource;
    impl SessionSource for EmptySource {
        fn has_pending_input(&self) -> bool {
            false
        }
        fn drain(&mut self, _: Instant) -> SessionDrain {
            empty()
        }
        fn close(&mut self, _: Instant) -> SessionDrain {
            empty()
        }
    }
    fn empty() -> SessionDrain {
        SessionDrain {
            events: Vec::new(),
            snapshot: None,
            failure: None,
        }
    }
    fn state() -> InteractiveSessionState {
        InteractiveSessionState {
            coverage: InteractiveSessionCoverage::FullLifecycle,
            certainty: InteractiveSessionCertainty::Complete,
            console_ownership: InteractiveConsoleOwnership::Candidate,
            lock_state: InteractiveLockState::Unlocked,
            remote_attachment: InteractiveRemoteAttachment::Absent,
            other_human_session_count: 0,
        }
    }
    fn request() -> HelperSourceOpen {
        HelperSourceOpen {
            channel_nonce: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
                .to_owned(),
            helper_source_instance_id: "session-source-0001".to_owned(),
            source_kind: HelperSourceKind::InteractiveSession,
            schema_version: INTERACTIVE_SESSION_SCHEMA_VERSION,
            queue_capacity: 8,
            event_classes: vec![HelperEventClass::InteractiveSessionLifecycle],
        }
    }
    fn bridge() -> SessionHelperSource<EmptySource> {
        let origin = Instant::now()
            .checked_sub(Duration::from_secs(1))
            .expect("past origin");
        SessionHelperSource {
            request: request(),
            source: EmptySource,
            clock: SessionClock {
                origin,
                origin_ns: 10,
                last_ns: 10,
            },
            sequence: 0,
            terminal: false,
            next_poll: origin,
            next_health_check: origin,
            last_state: state(),
            awaiting_reconciliation: false,
        }
    }
    fn event(at: Instant) -> SessionEvent {
        SessionEvent {
            event: InteractiveSessionEvent {
                kind: InteractiveSessionEventKind::Changed,
                state: state(),
            },
            observed_at: at,
        }
    }
    #[test]
    fn notifications_keep_capture_time_before_reconciliation() {
        let mut source = bridge();
        let captured = source.clock.origin + Duration::from_millis(1);
        let reconciled = captured + Duration::from_millis(1);
        let (events, _) = source
            .translate(
                SessionDrain {
                    events: vec![event(captured)],
                    snapshot: Some(SessionSnapshot {
                        state: state(),
                        capture_started_at: captured,
                        observed_at: reconciled,
                    }),
                    failure: None,
                },
                false,
            )
            .expect("translate");
        assert_eq!(events.len(), 2);
        let HelperSourceEvent::Observation(first) = &events[0] else {
            panic!("event")
        };
        let HelperSourceEvent::Observation(second) = &events[1] else {
            panic!("reconciliation")
        };
        assert_eq!(first.monotonic_time_ns, 1_000_010);
        assert_eq!(second.monotonic_time_ns, 2_000_010);
        assert_eq!(second.sequence, 2);
        assert_eq!(
            second
                .interactive_session_event
                .as_ref()
                .expect("state")
                .kind,
            InteractiveSessionEventKind::Reconciled
        );
    }
    #[test]
    fn accepted_tail_precedes_terminal_and_cannot_restore_final_state() {
        let mut source = bridge();
        let captured = source.clock.origin + Duration::from_millis(1);
        let (events, final_state) = source
            .translate(
                SessionDrain {
                    events: vec![event(captured)],
                    snapshot: Some(SessionSnapshot {
                        state: state(),
                        capture_started_at: captured,
                        observed_at: captured,
                    }),
                    failure: Some(HelperFailureCode::QueueOverflow),
                },
                true,
            )
            .expect("translate");
        assert!(matches!(
            &events[..],
            [
                HelperSourceEvent::Observation(_),
                HelperSourceEvent::Failure(_)
            ]
        ));
        assert!(final_state.is_none());
        assert!(source.terminal);
        let HelperSourceEvent::Failure(failed) = &events[1] else {
            panic!("failure")
        };
        assert_eq!(failed.last_sequence, 1);
        assert_eq!(failed.lost_event_count, Some(1));
    }
    #[test]
    fn rejects_out_of_order_batch_without_advancing_cursor() {
        let mut source = bridge();
        let first = source.clock.origin + Duration::from_millis(2);
        let earlier = source.clock.origin + Duration::from_millis(1);
        assert!(
            source
                .translate(
                    SessionDrain {
                        events: vec![event(first), event(earlier)],
                        ..empty()
                    },
                    false
                )
                .is_err()
        );
        assert_eq!(source.sequence, 0);
        assert_eq!(source.clock.last_ns, 10);
    }
    #[test]
    fn missing_final_snapshot_is_failure_and_unavailable() {
        let mut source = bridge();
        let closed = source.close(20).expect("close output");
        assert!(matches!(
            &closed.events[..],
            [HelperSourceEvent::Failure(_)]
        ));
        assert_eq!(
            closed
                .final_snapshot
                .interactive_session_state
                .expect("state")
                .coverage,
            InteractiveSessionCoverage::Unavailable
        );
    }
    #[test]
    fn cleanup_failure_after_prior_terminal_is_still_forwarded() {
        let mut source = bridge();
        source.terminal = true;
        let (events, _) = source
            .translate(
                SessionDrain {
                    failure: Some(HelperFailureCode::Cleanup),
                    ..empty()
                },
                true,
            )
            .expect("cleanup");
        assert!(matches!(
            &events[..],
            [HelperSourceEvent::Failure(HelperSourceFailure {
                failure_code: HelperFailureCode::Cleanup,
                ..
            })]
        ));
    }
    #[test]
    fn polling_is_throttled_between_reconciliations() {
        let mut source = bridge();
        source.next_poll = Instant::now() + POLL_INTERVAL;
        assert!(source.drain().expect("idle").is_empty());
    }

    #[test]
    fn unchanged_normal_state_does_not_emit_recurring_inventory() {
        let mut source = bridge();
        let captured = source.clock.origin + Duration::from_millis(1);
        let (events, _) = source
            .translate(
                SessionDrain {
                    snapshot: Some(SessionSnapshot {
                        state: state(),
                        capture_started_at: captured,
                        observed_at: captured,
                    }),
                    ..empty()
                },
                false,
            )
            .expect("unchanged state");
        assert!(events.is_empty());
        assert_eq!(source.sequence, 0);
    }

    #[test]
    fn asynchronous_unchanged_snapshot_still_completes_prior_notification() {
        let mut source = bridge();
        let captured = source.clock.origin + Duration::from_millis(1);
        let (events, _) = source
            .translate(
                SessionDrain {
                    events: vec![event(captured)],
                    ..empty()
                },
                false,
            )
            .expect("notification");
        assert_eq!(events.len(), 1);
        assert!(source.awaiting_reconciliation);
        let (events, _) = source
            .translate(
                SessionDrain {
                    snapshot: Some(SessionSnapshot {
                        state: state(),
                        capture_started_at: captured,
                        observed_at: captured,
                    }),
                    ..empty()
                },
                false,
            )
            .expect("later reconciliation");
        assert_eq!(events.len(), 1);
        assert!(!source.awaiting_reconciliation);
        let HelperSourceEvent::Observation(observation) = &events[0] else {
            panic!("reconciliation")
        };
        assert_eq!(
            observation
                .interactive_session_event
                .as_ref()
                .expect("event")
                .kind,
            InteractiveSessionEventKind::Reconciled
        );
    }

    struct RecordingOpener {
        deadlines: Vec<Instant>,
        capacities: Vec<usize>,
    }
    impl SessionOpener for RecordingOpener {
        type Source = EmptySource;
        fn open(
            &mut self,
            capacity: usize,
            deadline: Instant,
        ) -> Result<(SessionSnapshot, Self::Source), HelperFailureCode> {
            self.deadlines.push(deadline);
            self.capacities.push(capacity);
            let now = Instant::now();
            Ok((
                SessionSnapshot {
                    state: state(),
                    capture_started_at: now,
                    observed_at: now,
                },
                EmptySource,
            ))
        }
    }
    #[test]
    fn each_open_has_new_deadline_and_reserves_reconciliation_capacity() {
        let mut opener = RecordingOpener {
            deadlines: Vec::new(),
            capacities: Vec::new(),
        };
        let mut request = request();
        request.queue_capacity = 2;
        let first = open_session_source(&request, 10, &mut opener);
        assert!(matches!(first, HelperSourceOpenOutcome::Opened(_)));
        drop(first);
        let second = open_session_source(&request, 20, &mut opener);
        assert!(matches!(second, HelperSourceOpenOutcome::Opened(_)));
        assert!(opener.deadlines[1] >= opener.deadlines[0]);
        assert_eq!(opener.capacities, [1, 1]);
    }
}
