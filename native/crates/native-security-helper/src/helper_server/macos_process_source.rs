use std::time::{Duration, Instant};

use native_helper_protocol::{
    HelperEventClass, HelperFailureCode, HelperObservation, HelperSourceFailure, HelperSourceKind,
    HelperSourceOpen, HelperSourceSnapshot,
};
use native_protocol::{
    MAX_PROTOCOL_SAFE_INTEGER, ProcessApplicationEvent, ProcessApplicationState,
    ProtocolValidatable,
};
use process_application_state::{
    MacOsLifecycleDrain, MacOsLifecycleFailure, MacOsLifecycleSubscription,
    MacOsLifecycleTimeOrigin, MacOsProcessLifecycle,
};

use super::{
    HelperSource, HelperSourceCloseOutput, HelperSourceEvent, HelperSourceOpenOutcome,
    HelperTransportError, OpenedHelperSource, unavailable_snapshot,
};

// Leave room for response/cleanup inside the transport's five-second request
// deadline. Blocking SDK calls still require external helper supervision.
const SOURCE_OPEN_BUDGET: Duration = Duration::from_secs(3);

/// Owner-thread connector seam for the future signed Endpoint Security component.
///
/// The opener, rather than the wire request, owns candidate audit-session
/// context and constructs fresh feed/inventory boundaries. Event classes remain
/// the only caller-selected native categories.
pub(super) trait MacOsProcessLifecycleOpener {
    type Subscription: MacOsLifecycleSubscription + 'static;

    fn open(
        &mut self,
        queue_capacity: u16,
        event_classes: &[HelperEventClass],
        time_origin: MacOsLifecycleTimeOrigin,
        deadline: Instant,
    ) -> Result<
        (
            ProcessApplicationState,
            MacOsProcessLifecycle<Self::Subscription>,
        ),
        MacOsLifecycleFailure,
    >;
}

/// Concrete source composition. The privileged socket bootstrap supplies the
/// verified candidate; the wire never chooses an audit session or executable.
pub(super) struct EndpointSecurityProcessOpener {
    candidate: process_application_state::MacOsCandidateAuditSession,
}

impl EndpointSecurityProcessOpener {
    pub(super) const fn new(
        candidate: process_application_state::MacOsCandidateAuditSession,
    ) -> Self {
        Self { candidate }
    }
}

impl MacOsProcessLifecycleOpener for EndpointSecurityProcessOpener {
    type Subscription = process_application_state::EndpointSecuritySubscription;

    fn open(
        &mut self,
        queue_capacity: u16,
        event_classes: &[HelperEventClass],
        time_origin: MacOsLifecycleTimeOrigin,
        deadline: Instant,
    ) -> Result<
        (
            ProcessApplicationState,
            MacOsProcessLifecycle<Self::Subscription>,
        ),
        MacOsLifecycleFailure,
    > {
        // This source's lifecycle transitions include identity-generation facts.
        // Do not subscribe a broader native set than the selected protocol set.
        if event_classes
            != [
                HelperEventClass::ProcessLifecycle,
                HelperEventClass::ProcessIdentity,
            ]
            || Instant::now() >= deadline
        {
            return Err(MacOsLifecycleFailure::Backend);
        }
        let feed =
            process_application_state::EndpointSecurityEventFeed::new(self.candidate, deadline);
        let inventory = process_application_state::MacOsAuditProcessInventory::new(
            self.candidate,
            feed.bootstrap_registrar(),
        );
        MacOsProcessLifecycle::open_with_time_origin(
            self.candidate,
            queue_capacity,
            time_origin,
            feed,
            inventory,
        )
    }
}

/// Opens the normalized helper source without selecting it as a packaged
/// platform capability.
pub(super) fn open_process_source<O: MacOsProcessLifecycleOpener>(
    request: &HelperSourceOpen,
    monotonic_time_ns: u64,
    opener: &mut O,
) -> HelperSourceOpenOutcome {
    let deadline = Instant::now() + SOURCE_OPEN_BUDGET;
    let time_origin = MacOsLifecycleTimeOrigin::capture();
    let mut clock = SourceClock::new(monotonic_time_ns, time_origin.clone());
    if request.source_kind != HelperSourceKind::ProcessApplication
        || request.validate_protocol().is_err()
    {
        return HelperSourceOpenOutcome::Failed(source_failure(
            request,
            0,
            clock.now(),
            &MacOsLifecycleFailure::Protocol,
        ));
    }
    match opener.open(
        request.queue_capacity,
        &request.event_classes,
        time_origin,
        deadline,
    ) {
        Ok((initial_state, mut lifecycle)) => {
            if Instant::now() >= deadline {
                let failure = match lifecycle.close() {
                    Ok(_) => MacOsLifecycleFailure::Backend,
                    Err(_) => MacOsLifecycleFailure::Cleanup,
                };
                return HelperSourceOpenOutcome::Failed(source_failure(
                    request,
                    0,
                    clock.now(),
                    &failure,
                ));
            }
            let initial_time_ns = clock.at_source_elapsed(lifecycle.initial_monotonic_time_ns());
            HelperSourceOpenOutcome::Opened(OpenedHelperSource {
                initial_snapshot: source_snapshot(request, 0, initial_time_ns, initial_state),
                source: Box::new(MacOsLifecycleHelperSource {
                    request: request.clone(),
                    lifecycle,
                    last_sequence: 0,
                    clock,
                    terminal_forwarded: false,
                }),
            })
        }
        Err(failure) => {
            HelperSourceOpenOutcome::Failed(source_failure(request, 0, clock.now(), &failure))
        }
    }
}

struct MacOsLifecycleHelperSource<S: MacOsLifecycleSubscription> {
    request: HelperSourceOpen,
    lifecycle: MacOsProcessLifecycle<S>,
    last_sequence: u64,
    clock: SourceClock,
    terminal_forwarded: bool,
}

impl<S: MacOsLifecycleSubscription> HelperSource for MacOsLifecycleHelperSource<S> {
    fn source_kind(&self) -> HelperSourceKind {
        HelperSourceKind::ProcessApplication
    }

    fn drain(&mut self) -> Result<Vec<HelperSourceEvent>, HelperTransportError> {
        let drain = self.lifecycle.drain();
        self.translate_drain(drain)
    }

    fn close(
        &mut self,
        monotonic_time_ns: u64,
    ) -> Result<HelperSourceCloseOutput, HelperTransportError> {
        match self.lifecycle.close() {
            Ok(closed) => {
                let events = match self.translate_drain_transactionally(closed.drain) {
                    Ok(events) => events,
                    Err(HelperTransportError::Protocol(_)) => {
                        return Ok(self.failed_close_output(
                            monotonic_time_ns,
                            MacOsLifecycleFailure::Protocol,
                        ));
                    }
                    Err(error) => return Err(error),
                };
                self.clock.observe(monotonic_time_ns);
                let final_time_ns = self.clock.now();
                Ok(HelperSourceCloseOutput {
                    events,
                    final_snapshot: source_snapshot(
                        &self.request,
                        self.last_sequence,
                        final_time_ns,
                        closed.final_state,
                    ),
                })
            }
            Err(failure) => Ok(self.failed_close_output(monotonic_time_ns, failure)),
        }
    }
}

impl<S: MacOsLifecycleSubscription> MacOsLifecycleHelperSource<S> {
    fn translate_drain_transactionally(
        &mut self,
        drain: MacOsLifecycleDrain,
    ) -> Result<Vec<HelperSourceEvent>, HelperTransportError> {
        let last_sequence = self.last_sequence;
        let last_clock_ns = self.clock.last_ns;
        let terminal_forwarded = self.terminal_forwarded;
        match self.translate_drain(drain) {
            Ok(events) => Ok(events),
            Err(error) => {
                self.last_sequence = last_sequence;
                self.clock.last_ns = last_clock_ns;
                self.terminal_forwarded = terminal_forwarded;
                Err(error)
            }
        }
    }

    fn failed_close_output(
        &mut self,
        monotonic_time_ns: u64,
        failure: MacOsLifecycleFailure,
    ) -> HelperSourceCloseOutput {
        self.clock.observe(monotonic_time_ns);
        let failure_time_ns = self.clock.now();
        let event = HelperSourceEvent::Failure(source_failure(
            &self.request,
            self.last_sequence,
            failure_time_ns,
            &failure,
        ));
        let mut final_snapshot = unavailable_snapshot(&self.request, failure_time_ns);
        final_snapshot.last_sequence = self.last_sequence;
        self.terminal_forwarded = true;
        HelperSourceCloseOutput {
            events: vec![event],
            final_snapshot,
        }
    }

    fn translate_drain(
        &mut self,
        drain: MacOsLifecycleDrain,
    ) -> Result<Vec<HelperSourceEvent>, HelperTransportError> {
        let MacOsLifecycleDrain {
            events: lifecycle_events,
            terminal,
        } = drain;
        if self.terminal_forwarded {
            if lifecycle_events.is_empty() && terminal.is_none() {
                return Ok(Vec::new());
            }
            return Err(native_helper_protocol::HelperProtocolError::Lifecycle.into());
        }

        if let Some(terminal) = terminal.as_ref()
            && matches!(
                terminal.failure(),
                MacOsLifecycleFailure::Cleanup | MacOsLifecycleFailure::Protocol
            )
        {
            let event = HelperSourceEvent::Failure(source_failure(
                &self.request,
                self.last_sequence,
                self.clock.at_source_elapsed(terminal.monotonic_time_ns()),
                &terminal.failure(),
            ));
            self.terminal_forwarded = true;
            return Ok(vec![event]);
        }

        let mut events = Vec::with_capacity(
            lifecycle_events
                .len()
                .saturating_add(usize::from(terminal.is_some())),
        );
        for mut lifecycle_event in lifecycle_events {
            let monotonic_time_ns = self.clock.event_time(
                lifecycle_event.monotonic_time_ns,
                &mut lifecycle_event.event,
            )?;
            self.last_sequence = self
                .last_sequence
                .checked_add(1)
                .filter(|sequence| *sequence <= MAX_PROTOCOL_SAFE_INTEGER)
                .ok_or(native_helper_protocol::HelperProtocolError::Sequence)?;
            events.push(HelperSourceEvent::Observation(Box::new(
                HelperObservation {
                    channel_nonce: self.request.channel_nonce.clone(),
                    helper_source_instance_id: self.request.helper_source_instance_id.clone(),
                    source_kind: HelperSourceKind::ProcessApplication,
                    sequence: self.last_sequence,
                    monotonic_time_ns,
                    process_event: Some(lifecycle_event.event),
                    interactive_session_event: None,
                },
            )));
        }
        if let Some(terminal) = terminal {
            let failure_time_ns = self.clock.at_source_elapsed(terminal.monotonic_time_ns());
            events.push(HelperSourceEvent::Failure(source_failure(
                &self.request,
                self.last_sequence,
                failure_time_ns,
                &terminal.failure(),
            )));
            self.terminal_forwarded = true;
        }
        Ok(events)
    }
}

struct SourceClock {
    origin: MacOsLifecycleTimeOrigin,
    origin_ns: u64,
    last_ns: u64,
}

impl SourceClock {
    fn new(origin_ns: u64, origin: MacOsLifecycleTimeOrigin) -> Self {
        let origin_ns = origin_ns.min(MAX_PROTOCOL_SAFE_INTEGER);
        Self {
            origin,
            origin_ns,
            last_ns: origin_ns,
        }
    }

    fn now(&mut self) -> u64 {
        let elapsed_ns = self.origin.elapsed_ns();
        let observed = self
            .origin_ns
            .saturating_add(elapsed_ns)
            .min(MAX_PROTOCOL_SAFE_INTEGER);
        self.observe(observed)
    }

    fn observe(&mut self, monotonic_time_ns: u64) -> u64 {
        self.last_ns = self
            .last_ns
            .max(monotonic_time_ns.min(MAX_PROTOCOL_SAFE_INTEGER));
        self.last_ns
    }

    fn at_source_elapsed(&mut self, elapsed_ns: u64) -> u64 {
        let observed = self
            .origin_ns
            .saturating_add(elapsed_ns.min(MAX_PROTOCOL_SAFE_INTEGER))
            .min(MAX_PROTOCOL_SAFE_INTEGER);
        self.observe(observed)
    }

    fn event_time(
        &mut self,
        elapsed_ns: u64,
        event: &mut ProcessApplicationEvent,
    ) -> Result<u64, HelperTransportError> {
        let captured_ns = elapsed_ns
            .checked_sub(event.capture_delay_ns.unwrap_or(0))
            .and_then(|elapsed| self.origin_ns.checked_add(elapsed))
            .filter(|time| *time <= MAX_PROTOCOL_SAFE_INTEGER)
            .ok_or(native_helper_protocol::HelperProtocolError::Sequence)?;
        let settled_ns = self
            .origin_ns
            .checked_add(elapsed_ns)
            .filter(|time| *time <= MAX_PROTOCOL_SAFE_INTEGER)
            .ok_or(native_helper_protocol::HelperProtocolError::Sequence)?;
        let published_ns = self.observe(settled_ns);
        // Moving the outer timestamp forward must not move the original capture.
        // Durations survive the helper/source origin translation without exposing
        // a second ambiguous absolute clock in the event payload.
        let delay = published_ns - captured_ns;
        if event.capture_delay_ns.is_some() || delay != 0 {
            event.capture_delay_ns = Some(delay);
        }
        Ok(published_ns)
    }
}

fn source_snapshot(
    request: &HelperSourceOpen,
    last_sequence: u64,
    monotonic_time_ns: u64,
    state: ProcessApplicationState,
) -> HelperSourceSnapshot {
    HelperSourceSnapshot {
        channel_nonce: request.channel_nonce.clone(),
        helper_source_instance_id: request.helper_source_instance_id.clone(),
        source_kind: HelperSourceKind::ProcessApplication,
        last_sequence,
        monotonic_time_ns,
        process_state: Some(state),
        interactive_session_state: None,
    }
}

fn source_failure(
    request: &HelperSourceOpen,
    last_sequence: u64,
    monotonic_time_ns: u64,
    failure: &MacOsLifecycleFailure,
) -> HelperSourceFailure {
    let (failure_code, lost_event_count) = match failure {
        MacOsLifecycleFailure::NativeEventLoss(count)
            if (1..=MAX_PROTOCOL_SAFE_INTEGER).contains(count) =>
        {
            (HelperFailureCode::NativeEventLoss, Some(*count))
        }
        MacOsLifecycleFailure::QueueOverflow(count)
            if (1..=MAX_PROTOCOL_SAFE_INTEGER).contains(count) =>
        {
            (HelperFailureCode::QueueOverflow, Some(*count))
        }
        MacOsLifecycleFailure::NativeEventLoss(_) | MacOsLifecycleFailure::QueueOverflow(_) => {
            (HelperFailureCode::Protocol, None)
        }
        MacOsLifecycleFailure::PermissionLost => (HelperFailureCode::PermissionLost, None),
        MacOsLifecycleFailure::InventoryOverflow => (HelperFailureCode::InventoryOverflow, None),
        MacOsLifecycleFailure::Backend => (HelperFailureCode::Backend, None),
        MacOsLifecycleFailure::Cleanup => (HelperFailureCode::Cleanup, None),
        MacOsLifecycleFailure::Protocol => (HelperFailureCode::Protocol, None),
    };
    HelperSourceFailure {
        channel_nonce: request.channel_nonce.clone(),
        helper_source_instance_id: request.helper_source_instance_id.clone(),
        source_kind: HelperSourceKind::ProcessApplication,
        failure_code,
        last_sequence,
        lost_event_count,
        monotonic_time_ns,
    }
}

#[cfg(test)]
mod tests {
    use std::sync::{Arc, Mutex};
    use std::thread::{self, ThreadId};
    use std::time::Duration;

    use native_protocol::{
        ProcessApplicationCertainty, ProcessApplicationCoverage, ProcessApplicationEventKind,
        ProcessExecutableIdentity, ProcessExecutableIdentityStatus,
    };
    use process_application_state::{
        MacOsCandidateAuditSession, MacOsIdentityResolution, MacOsLifecycleCheckpoint,
        MacOsLifecycleEventFeed, MacOsLifecycleInput, MacOsLifecycleSink, MacOsProcessAccountClass,
        MacOsProcessFact, MacOsProcessInventory, MacOsProcessInventoryCollector, MacOsProcessKey,
    };

    use super::*;

    const NONCE: &str = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

    #[test]
    fn translated_settlement_time_preserves_original_capture_under_clock_clamping() {
        let mut clock = SourceClock::new(100, MacOsLifecycleTimeOrigin::capture());
        let mut event = ProcessApplicationEvent {
            kind: native_protocol::ProcessApplicationEventKind::Exited,
            capture_delay_ns: Some(7),
            process_instance_id: Some("process-instance-0001".to_owned()),
            process: None,
            state: None,
        };
        assert_eq!(clock.event_time(20, &mut event).unwrap(), 120);
        assert_eq!(event.capture_delay_ns, Some(7));
        clock.observe(150);
        event.capture_delay_ns = Some(5);
        assert_eq!(clock.event_time(25, &mut event).unwrap(), 150);
        assert_eq!(event.capture_delay_ns, Some(30));
        event.capture_delay_ns = None;
        assert_eq!(clock.event_time(26, &mut event).unwrap(), 150);
        assert_eq!(event.capture_delay_ns, Some(24));
        event.capture_delay_ns = Some(27);
        assert!(clock.event_time(26, &mut event).is_err());
        assert_eq!(clock.last_ns, 150);
        event.capture_delay_ns = None;
        assert!(
            clock
                .event_time(MAX_PROTOCOL_SAFE_INTEGER, &mut event)
                .is_err()
        );
        assert_eq!(clock.last_ns, 150);
    }

    struct ScriptedOpener {
        shared_sink: Arc<Mutex<Option<MacOsLifecycleSink>>>,
        stop_thread: Arc<Mutex<Option<ThreadId>>>,
    }

    struct DelayedOpener {
        inner: ScriptedOpener,
        before_open_delay: Duration,
        after_open_delay: Duration,
        event_after_open: Option<MacOsLifecycleInput>,
    }

    struct ScriptedFeed {
        shared_sink: Arc<Mutex<Option<MacOsLifecycleSink>>>,
        stop_thread: Arc<Mutex<Option<ThreadId>>>,
    }

    struct ScriptedSubscription {
        sink: MacOsLifecycleSink,
        shared_sink: Arc<Mutex<Option<MacOsLifecycleSink>>>,
        stop_thread: Arc<Mutex<Option<ThreadId>>>,
    }

    struct EmptyInventory;

    struct DeadlineRecorder {
        inner: ScriptedOpener,
        deadlines: Vec<Instant>,
    }

    impl MacOsProcessLifecycleOpener for DeadlineRecorder {
        type Subscription = ScriptedSubscription;

        fn open(
            &mut self,
            queue_capacity: u16,
            event_classes: &[HelperEventClass],
            time_origin: MacOsLifecycleTimeOrigin,
            deadline: Instant,
        ) -> Result<
            (
                ProcessApplicationState,
                MacOsProcessLifecycle<Self::Subscription>,
            ),
            MacOsLifecycleFailure,
        > {
            self.deadlines.push(deadline);
            self.inner
                .open(queue_capacity, event_classes, time_origin, deadline)
        }
    }

    impl MacOsProcessLifecycleOpener for ScriptedOpener {
        type Subscription = ScriptedSubscription;

        fn open(
            &mut self,
            queue_capacity: u16,
            _event_classes: &[HelperEventClass],
            time_origin: MacOsLifecycleTimeOrigin,
            _deadline: Instant,
        ) -> Result<
            (
                ProcessApplicationState,
                MacOsProcessLifecycle<Self::Subscription>,
            ),
            MacOsLifecycleFailure,
        > {
            MacOsProcessLifecycle::open_with_time_origin(
                MacOsCandidateAuditSession::from_verified_peer(41, 501)
                    .expect("verified candidate context"),
                queue_capacity,
                time_origin,
                ScriptedFeed {
                    shared_sink: Arc::clone(&self.shared_sink),
                    stop_thread: Arc::clone(&self.stop_thread),
                },
                EmptyInventory,
            )
        }
    }

    impl MacOsProcessLifecycleOpener for DelayedOpener {
        type Subscription = ScriptedSubscription;

        fn open(
            &mut self,
            queue_capacity: u16,
            event_classes: &[HelperEventClass],
            time_origin: MacOsLifecycleTimeOrigin,
            deadline: Instant,
        ) -> Result<
            (
                ProcessApplicationState,
                MacOsProcessLifecycle<Self::Subscription>,
            ),
            MacOsLifecycleFailure,
        > {
            thread::sleep(self.before_open_delay);
            let opened = self
                .inner
                .open(queue_capacity, event_classes, time_origin, deadline);
            if opened.is_ok()
                && let Some(input) = self.event_after_open.take()
                && let Some(sink) = self.inner.shared_sink.lock().expect("shared sink").as_ref()
            {
                thread::sleep(Duration::from_millis(1));
                sink.submit(input);
            }
            thread::sleep(self.after_open_delay);
            opened
        }
    }

    impl MacOsLifecycleEventFeed for ScriptedFeed {
        type Subscription = ScriptedSubscription;

        fn start(
            self,
            sink: MacOsLifecycleSink,
        ) -> Result<Self::Subscription, MacOsLifecycleFailure> {
            *self.shared_sink.lock().expect("shared sink") = Some(sink.clone());
            Ok(ScriptedSubscription {
                sink,
                shared_sink: self.shared_sink,
                stop_thread: self.stop_thread,
            })
        }
    }

    impl MacOsLifecycleSubscription for ScriptedSubscription {
        fn bootstrap_barrier(&mut self) -> Result<MacOsLifecycleCheckpoint, MacOsLifecycleFailure> {
            self.sink.checkpoint()
        }

        fn stop(self) -> Result<(), MacOsLifecycleFailure> {
            drop(self.shared_sink.lock().expect("shared sink").take());
            *self.stop_thread.lock().expect("stop thread") = Some(thread::current().id());
            Ok(())
        }
    }

    impl MacOsProcessInventory for EmptyInventory {
        fn snapshot(
            &mut self,
            _collector: &mut MacOsProcessInventoryCollector,
        ) -> Result<(), MacOsLifecycleFailure> {
            Ok(())
        }
    }

    #[test]
    fn reopening_a_source_receives_a_new_operation_deadline() {
        let mut opener = DeadlineRecorder {
            inner: ScriptedOpener {
                shared_sink: Arc::new(Mutex::new(None)),
                stop_thread: Arc::new(Mutex::new(None)),
            },
            deadlines: Vec::new(),
        };
        let request = process_request(vec![
            HelperEventClass::ProcessLifecycle,
            HelperEventClass::ProcessIdentity,
        ]);
        for _ in 0..2 {
            let started = Instant::now();
            let HelperSourceOpenOutcome::Opened(mut source) =
                open_process_source(&request, 10, &mut opener)
            else {
                panic!("source opens with a fresh budget");
            };
            let deadline = *opener.deadlines.last().expect("operation deadline");
            assert!(deadline >= started + SOURCE_OPEN_BUDGET);
            assert!(deadline <= Instant::now() + SOURCE_OPEN_BUDGET);
            source
                .source
                .close(20)
                .expect("source closes before reentry");
        }
        assert_eq!(opener.deadlines.len(), 2);
    }

    #[test]
    fn bridge_resequences_selected_events_and_preserves_exact_terminal_loss() {
        let opening_thread = thread::current().id();
        let shared_sink = Arc::new(Mutex::new(None));
        let stop_thread = Arc::new(Mutex::new(None));
        let mut lifecycle_opener = ScriptedOpener {
            shared_sink: Arc::clone(&shared_sink),
            stop_thread: Arc::clone(&stop_thread),
        };
        let request = process_request(vec![
            HelperEventClass::ProcessLifecycle,
            HelperEventClass::ProcessIdentity,
        ]);
        let HelperSourceOpenOutcome::Opened(mut opened_source) =
            open_process_source(&request, 10, &mut lifecycle_opener)
        else {
            panic!("source opens");
        };
        let initial_state = opened_source
            .initial_snapshot
            .process_state
            .as_ref()
            .expect("initial process state");
        assert_eq!(
            initial_state.coverage,
            ProcessApplicationCoverage::FullLifecycle
        );
        assert_eq!(
            initial_state.certainty,
            ProcessApplicationCertainty::Complete
        );

        let process_key = MacOsProcessKey::new(321, 50, 0).expect("process key");
        let sink = shared_sink
            .lock()
            .expect("shared sink")
            .clone()
            .expect("sink");
        sink.submit(MacOsLifecycleInput::Fork(MacOsProcessFact::new(
            process_key,
            1,
            41,
            501,
            MacOsProcessAccountClass::Human,
        )));
        sink.submit(MacOsLifecycleInput::NativeEventLoss(2));

        let events = opened_source.source.drain().expect("bounded drain");
        assert!(matches!(
            events.as_slice(),
            [
                HelperSourceEvent::Observation(observation),
                HelperSourceEvent::Failure(HelperSourceFailure {
                    failure_code: HelperFailureCode::NativeEventLoss,
                    last_sequence: 1,
                    lost_event_count: Some(2),
                    ..
                })
            ] if observation.sequence == 1
                && observation
                    .process_event
                    .as_ref()
                    .is_some_and(|event| event.kind == ProcessApplicationEventKind::Started)
        ));

        drop(sink);
        let closed = opened_source.source.close(20).expect("source closes");
        assert!(closed.events.is_empty());
        assert_eq!(closed.final_snapshot.last_sequence, 1);
        assert_eq!(
            closed
                .final_snapshot
                .process_state
                .expect("final state")
                .certainty,
            ProcessApplicationCertainty::Partial
        );
        assert_eq!(
            *stop_thread.lock().expect("stop thread"),
            Some(opening_thread)
        );
    }

    #[test]
    fn bridge_rejects_an_event_subset_that_cannot_form_a_coherent_state_stream() {
        let shared_sink = Arc::new(Mutex::new(None));
        let mut lifecycle_opener = ScriptedOpener {
            shared_sink: Arc::clone(&shared_sink),
            stop_thread: Arc::new(Mutex::new(None)),
        };
        let request = process_request(vec![HelperEventClass::ProcessIdentity]);
        assert!(matches!(
            open_process_source(&request, MAX_PROTOCOL_SAFE_INTEGER, &mut lifecycle_opener),
            HelperSourceOpenOutcome::Failed(HelperSourceFailure {
                failure_code: HelperFailureCode::Protocol,
                last_sequence: 0,
                ..
            })
        ));
        assert!(shared_sink.lock().expect("shared sink").is_none());
    }

    #[test]
    fn bridge_rejects_unrepresentable_loss_counts_before_the_wire() {
        let request = process_request(vec![
            HelperEventClass::ProcessLifecycle,
            HelperEventClass::ProcessIdentity,
        ]);
        for failure in [
            MacOsLifecycleFailure::NativeEventLoss(0),
            MacOsLifecycleFailure::QueueOverflow(MAX_PROTOCOL_SAFE_INTEGER + 1),
        ] {
            let mapped = source_failure(&request, 0, 1, &failure);
            assert_eq!(mapped.failure_code, HelperFailureCode::Protocol);
            assert_eq!(mapped.lost_event_count, None);
        }
    }

    #[test]
    fn bridge_does_not_advance_its_sequence_for_a_protocol_terminal_batch() {
        let shared_sink = Arc::new(Mutex::new(None));
        let mut lifecycle_opener = ScriptedOpener {
            shared_sink: Arc::clone(&shared_sink),
            stop_thread: Arc::new(Mutex::new(None)),
        };
        let request = process_request(vec![
            HelperEventClass::ProcessLifecycle,
            HelperEventClass::ProcessIdentity,
        ]);
        let HelperSourceOpenOutcome::Opened(mut opened_source) =
            open_process_source(&request, 10, &mut lifecycle_opener)
        else {
            panic!("source opens");
        };
        let process_fact = MacOsProcessFact::new(
            MacOsProcessKey::new(778, 71, 0).expect("process key"),
            1,
            41,
            501,
            MacOsProcessAccountClass::Human,
        );
        let sink = shared_sink
            .lock()
            .expect("shared sink")
            .clone()
            .expect("sink");
        sink.submit(MacOsLifecycleInput::Fork(process_fact));
        sink.submit(MacOsLifecycleInput::Fork(process_fact));

        let events = opened_source.source.drain().expect("bounded drain");
        assert!(matches!(
            events.as_slice(),
            [HelperSourceEvent::Failure(HelperSourceFailure {
                failure_code: HelperFailureCode::Protocol,
                last_sequence: 0,
                ..
            })]
        ));
        drop(sink);
        let closed = opened_source.source.close(20).expect("source closes");
        assert!(closed.events.is_empty());
        assert_eq!(closed.final_snapshot.last_sequence, 0);
    }

    #[test]
    fn bridge_and_lifecycle_share_one_origin_across_slow_open_work() {
        let shared_sink = Arc::new(Mutex::new(None));
        let mut lifecycle_opener = DelayedOpener {
            inner: ScriptedOpener {
                shared_sink: Arc::clone(&shared_sink),
                stop_thread: Arc::new(Mutex::new(None)),
            },
            before_open_delay: Duration::from_millis(20),
            after_open_delay: Duration::ZERO,
            event_after_open: None,
        };
        let request = process_request(vec![
            HelperEventClass::ProcessLifecycle,
            HelperEventClass::ProcessIdentity,
        ]);
        let HelperSourceOpenOutcome::Opened(mut opened_source) =
            open_process_source(&request, 10, &mut lifecycle_opener)
        else {
            panic!("source opens");
        };
        let initial_time_ns = opened_source.initial_snapshot.monotonic_time_ns;
        thread::sleep(Duration::from_millis(1));
        shared_sink
            .lock()
            .expect("shared sink")
            .as_ref()
            .expect("sink")
            .submit(MacOsLifecycleInput::Fork(MacOsProcessFact::new(
                MacOsProcessKey::new(777, 70, 0).expect("process key"),
                1,
                41,
                501,
                MacOsProcessAccountClass::Human,
            )));
        let events = opened_source.source.drain().expect("bounded drain");
        assert!(matches!(
            events.as_slice(),
            [HelperSourceEvent::Observation(observation)]
                if observation.monotonic_time_ns > initial_time_ns
        ));
        opened_source.source.close(10).expect("source closes");
    }

    #[test]
    fn snapshot_zero_uses_the_barrier_time_before_post_barrier_open_work() {
        let shared_sink = Arc::new(Mutex::new(None));
        let mut lifecycle_opener = DelayedOpener {
            inner: ScriptedOpener {
                shared_sink,
                stop_thread: Arc::new(Mutex::new(None)),
            },
            before_open_delay: Duration::ZERO,
            after_open_delay: Duration::from_millis(20),
            event_after_open: Some(MacOsLifecycleInput::Fork(MacOsProcessFact::new(
                MacOsProcessKey::new(780, 73, 0).expect("process key"),
                1,
                41,
                501,
                MacOsProcessAccountClass::Human,
            ))),
        };
        let request = process_request(vec![
            HelperEventClass::ProcessLifecycle,
            HelperEventClass::ProcessIdentity,
        ]);
        let HelperSourceOpenOutcome::Opened(mut opened_source) =
            open_process_source(&request, 10, &mut lifecycle_opener)
        else {
            panic!("source opens");
        };
        let initial_time_ns = opened_source.initial_snapshot.monotonic_time_ns;
        let events = opened_source.source.drain().expect("bounded drain");
        assert!(matches!(
            events.as_slice(),
            [HelperSourceEvent::Observation(observation)]
                if observation.monotonic_time_ns > initial_time_ns
        ));
        opened_source.source.close(10).expect("source closes");
    }

    #[test]
    fn close_preserves_tail_occurrence_times_before_the_close_request_time() {
        let shared_sink = Arc::new(Mutex::new(None));
        let mut lifecycle_opener = ScriptedOpener {
            shared_sink: Arc::clone(&shared_sink),
            stop_thread: Arc::new(Mutex::new(None)),
        };
        let request = process_request(vec![
            HelperEventClass::ProcessLifecycle,
            HelperEventClass::ProcessIdentity,
        ]);
        let HelperSourceOpenOutcome::Opened(mut opened_source) =
            open_process_source(&request, 10, &mut lifecycle_opener)
        else {
            panic!("source opens");
        };
        let process_key = MacOsProcessKey::new(779, 72, 0).expect("process key");
        let sink = shared_sink
            .lock()
            .expect("shared sink")
            .clone()
            .expect("sink");
        sink.submit(MacOsLifecycleInput::Fork(MacOsProcessFact::new(
            process_key,
            1,
            41,
            501,
            MacOsProcessAccountClass::Human,
        )));
        sink.submit(MacOsLifecycleInput::IdentityResolved(Box::new(
            MacOsIdentityResolution::new(process_key, 1, unavailable_identity())
                .expect("bounded identity"),
        )));

        drop(sink);
        let closed = opened_source
            .source
            .close(MAX_PROTOCOL_SAFE_INTEGER)
            .expect("source closes");
        assert_eq!(closed.events.len(), 2);
        assert!(closed.events.iter().all(|event| matches!(
            event,
            HelperSourceEvent::Observation(observation)
                if observation.monotonic_time_ns < MAX_PROTOCOL_SAFE_INTEGER
        )));
        assert_eq!(
            closed.final_snapshot.monotonic_time_ns,
            MAX_PROTOCOL_SAFE_INTEGER
        );
    }

    #[test]
    fn successful_lifecycle_close_translation_failure_is_protocol_not_cleanup() {
        let opening_thread = thread::current().id();
        let shared_sink = Arc::new(Mutex::new(None));
        let stop_thread = Arc::new(Mutex::new(None));
        let mut lifecycle_opener = ScriptedOpener {
            shared_sink: Arc::clone(&shared_sink),
            stop_thread: Arc::clone(&stop_thread),
        };
        let request = process_request(vec![
            HelperEventClass::ProcessLifecycle,
            HelperEventClass::ProcessIdentity,
        ]);
        let time_origin = MacOsLifecycleTimeOrigin::capture();
        let (_initial_state, lifecycle) = lifecycle_opener
            .open(
                request.queue_capacity,
                &request.event_classes,
                time_origin.clone(),
                Instant::now() + SOURCE_OPEN_BUDGET,
            )
            .expect("lifecycle opens");
        let mut source = MacOsLifecycleHelperSource {
            request: request.clone(),
            lifecycle,
            last_sequence: MAX_PROTOCOL_SAFE_INTEGER - 1,
            clock: SourceClock::new(10, time_origin),
            terminal_forwarded: false,
        };
        let process_key = MacOsProcessKey::new(781, 74, 0).expect("process key");
        let sink = shared_sink
            .lock()
            .expect("shared sink")
            .clone()
            .expect("sink");
        sink.submit(MacOsLifecycleInput::Fork(MacOsProcessFact::new(
            process_key,
            1,
            41,
            501,
            MacOsProcessAccountClass::Human,
        )));
        sink.submit(MacOsLifecycleInput::IdentityResolved(Box::new(
            MacOsIdentityResolution::new(process_key, 1, unavailable_identity())
                .expect("bounded identity"),
        )));
        drop(sink);

        let closed = source
            .close(20)
            .expect("successful stop returns a typed protocol close");

        assert!(matches!(
            closed.events.as_slice(),
            [HelperSourceEvent::Failure(HelperSourceFailure {
                failure_code: HelperFailureCode::Protocol,
                last_sequence,
                ..
            })] if *last_sequence == MAX_PROTOCOL_SAFE_INTEGER - 1
        ));
        assert_eq!(source.last_sequence, MAX_PROTOCOL_SAFE_INTEGER - 1);
        assert_eq!(
            closed.final_snapshot.last_sequence,
            MAX_PROTOCOL_SAFE_INTEGER - 1
        );
        assert_eq!(
            closed
                .final_snapshot
                .process_state
                .expect("unavailable final state")
                .coverage,
            ProcessApplicationCoverage::Unavailable
        );
        assert_eq!(
            *stop_thread.lock().expect("stop thread"),
            Some(opening_thread)
        );
    }

    fn process_request(event_classes: Vec<HelperEventClass>) -> HelperSourceOpen {
        HelperSourceOpen {
            channel_nonce: NONCE.to_owned(),
            helper_source_instance_id: "process-source-0001".to_owned(),
            source_kind: HelperSourceKind::ProcessApplication,
            queue_capacity: 4,
            event_classes,
        }
    }

    fn unavailable_identity() -> ProcessExecutableIdentity {
        ProcessExecutableIdentity {
            status: ProcessExecutableIdentityStatus::Unavailable,
            signer_chain_id: None,
            publisher_id: None,
            product_id: None,
            signing_id: None,
            team_id: None,
            designated_requirement: None,
            bundle_id: None,
            package_id: None,
            version: None,
            digest_sha256: None,
        }
    }
}
