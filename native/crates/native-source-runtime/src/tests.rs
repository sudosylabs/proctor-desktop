use super::*;

#[test]
fn bounded_reader_rejects_actual_content_past_the_limit() {
    let error = read_bounded(io::Cursor::new(vec![0_u8; 5]), 4)
        .expect_err("fifth byte must prove overflow");
    assert!(matches!(
        error,
        BoundedFileReadError::Overflow { max_bytes: 4 }
    ));
}

struct OrderedOpeningModel;

impl SourceModel for OrderedOpeningModel {
    type State = u8;
    type Input = u8;
    type Observation = u8;
    type Error = PassiveStateSourceError;

    fn validate_state(_state: &Self::State) -> Result<(), Self::Error> {
        Ok(())
    }

    fn health(_state: &Self::State) -> SourceHealth {
        SourceHealth::Healthy
    }

    fn apply(
        _previous: Option<&Self::State>,
        input: Self::Input,
    ) -> Result<SourceStateChange<Self::State, Self::Observation>, Self::Error> {
        Ok(SourceStateChange::Observe {
            state: Some(input),
            observation: input,
        })
    }

    fn final_observation(state: Self::State) -> Self::Observation {
        state
    }

    fn queue_error(error: QueueError) -> Self::Error {
        PassiveStateSourceError::Queue(error)
    }

    fn overflow_error() -> Self::Error {
        PassiveStateSourceError::QueueOverflow
    }
}

#[test]
fn loss_reported_before_snapshot_preserves_earlier_and_later_inputs() {
    let session = SourceSession::<OrderedOpeningModel>::new(8).expect("session");
    session.submit(1);
    session.submit(2);
    session.report_missing(3);
    session.submit(6);
    session
        .finish_open(0, SourceHealth::Healthy, None)
        .expect("finish open");

    let drain = session.drain();
    assert_eq!(drain.health, SourceHealth::Failed);
    assert!(matches!(
        drain.terminal_error,
        Some(PassiveStateSourceError::QueueOverflow)
    ));
    assert_eq!(drain.facts.len(), 3);
    assert_eq!(drain.facts[0].sequence, 1);
    assert_eq!(drain.facts[1].sequence, 2);
    assert_eq!(drain.facts[2].sequence, 6);
    assert_eq!(
        drain.facts[2].gap,
        Some(SequenceGap {
            first_missing: 3,
            last_missing: 5,
        })
    );
}

#[test]
fn loss_reported_after_snapshot_has_the_same_exact_order() {
    let session = SourceSession::<OrderedOpeningModel>::new(8).expect("session");
    session
        .finish_open(0, SourceHealth::Healthy, None)
        .expect("finish open");
    session.submit(1);
    session.submit(2);
    session.report_missing(3);

    let drain = session.drain();
    assert_eq!(drain.health, SourceHealth::Failed);
    assert_eq!(drain.facts.len(), 3);
    assert_eq!(drain.facts[0].sequence, 1);
    assert_eq!(drain.facts[1].sequence, 2);
    assert_eq!(drain.facts[2].sequence, 6);
    assert_eq!(
        drain.facts[2].gap,
        Some(SequenceGap {
            first_missing: 3,
            last_missing: 5,
        })
    );
}

#[test]
fn restart_reset_survives_an_input_followed_by_opening_loss_at_minimum_capacity() {
    let session = SourceSession::<OrderedOpeningModel>::new(2).expect("session");
    session.submit(1);
    session.report_missing(1);
    let snapshot_metadata = session
        .finish_open(
            0,
            SourceHealth::Healthy,
            Some(SourceResetPlan::new(1, "replacement".to_owned()).expect("reset")),
        )
        .expect("finish open");

    let drain = session.drain();
    assert_eq!(drain.facts.len(), 2);
    assert!(matches!(
        &drain.facts[0].payload,
        SourceSessionFact::Reset(reason) if reason == "replacement"
    ));
    assert!(matches!(
        drain.facts[1].payload,
        SourceSessionFact::Observation(0)
    ));
    assert_eq!(drain.health, SourceHealth::Failed);
    assert!(matches!(
        drain.terminal_error,
        Some(PassiveStateSourceError::QueueOverflow)
    ));
    assert!(
        snapshot_metadata.observed_at.monotonic_time_ns
            <= drain.facts[0].observed_at.monotonic_time_ns
    );
    assert!(
        drain.facts[0].observed_at.monotonic_time_ns
            <= drain.facts[1].observed_at.monotonic_time_ns
    );
}

#[test]
fn opening_metadata_is_immutable_when_buffered_input_changes_live_health() {
    struct HealthChangingModel;

    impl SourceModel for HealthChangingModel {
        type State = u8;
        type Input = u8;
        type Observation = u8;
        type Error = PassiveStateSourceError;

        fn validate_state(_state: &Self::State) -> Result<(), Self::Error> {
            Ok(())
        }

        fn health(state: &Self::State) -> SourceHealth {
            if *state == 0 {
                SourceHealth::Degraded
            } else {
                SourceHealth::Healthy
            }
        }

        fn apply(
            _previous: Option<&Self::State>,
            input: Self::Input,
        ) -> Result<SourceStateChange<Self::State, Self::Observation>, Self::Error> {
            Ok(SourceStateChange::Observe {
                state: Some(input),
                observation: input,
            })
        }

        fn final_observation(state: Self::State) -> Self::Observation {
            state
        }

        fn queue_error(error: QueueError) -> Self::Error {
            PassiveStateSourceError::Queue(error)
        }

        fn overflow_error() -> Self::Error {
            PassiveStateSourceError::QueueOverflow
        }
    }

    let session = SourceSession::<HealthChangingModel>::new(4).expect("session");
    session.submit(1);
    let snapshot_metadata = session
        .finish_open(0, SourceHealth::Degraded, None)
        .expect("finish open");

    assert_eq!(snapshot_metadata.health, SourceHealth::Degraded);
    assert_eq!(session.health(), SourceHealth::Healthy);
    assert!(snapshot_metadata.observed_at.monotonic_time_ns > 0);
    let drain = session.drain();
    assert!(matches!(
        drain.facts[0].payload,
        SourceSessionFact::Observation(1)
    ));
    assert!(
        snapshot_metadata.observed_at.monotonic_time_ns
            <= drain.facts[0].observed_at.monotonic_time_ns
    );
}

#[derive(Clone, Debug, Eq, PartialEq)]
struct RejectChangedState(u8);

impl ProtocolValidatable for RejectChangedState {
    fn validate_protocol(&self) -> Result<(), ProtocolValidationError> {
        Ok(())
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
struct RejectChangedEvent {
    reconciled: bool,
    state: RejectChangedState,
}

impl ProtocolValidatable for RejectChangedEvent {
    fn validate_protocol(&self) -> Result<(), ProtocolValidationError> {
        Ok(())
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
struct RejectChangedObservation {
    sequence: u64,
    gap: Option<SequenceGap>,
    event: RejectChangedEvent,
}

impl ProtocolValidatable for RejectChangedObservation {
    fn validate_protocol(&self) -> Result<(), ProtocolValidationError> {
        if !self.event.reconciled {
            return SourceReset {
                source_instance_id: "invalid".to_owned(),
                sequence: 0,
                observed_at: SourceTimestamp {
                    monotonic_time_ns: 0,
                },
                gap: None,
                reason: String::new(),
            }
            .validate_protocol();
        }
        Ok(())
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
struct RejectChangedDrain {
    health: SourceHealth,
    observations: Vec<RejectChangedObservation>,
    terminal_error: Option<SourceFailureCode>,
}

impl ProtocolValidatable for RejectChangedDrain {
    fn validate_protocol(&self) -> Result<(), ProtocolValidationError> {
        for observation in &self.observations {
            observation.validate_protocol()?;
        }
        Ok(())
    }
}

struct RejectChangedWire;

impl PassiveStateWire for RejectChangedWire {
    type State = RejectChangedState;
    type Event = RejectChangedEvent;
    type Snapshot = RejectChangedState;
    type Observation = RejectChangedObservation;
    type Drain = RejectChangedDrain;

    const SCHEMA_VERSION: u16 = 1;
    const SOURCE_VERSION: &'static str = "test";
    const STOP_THREAD_NAME: &'static str = "reject-changed-stop";

    fn health(_state: &Self::State) -> SourceHealth {
        SourceHealth::Healthy
    }

    fn unavailable_state() -> Self::State {
        RejectChangedState(0)
    }

    fn event(kind: PassiveStateEventKind, state: Self::State) -> Self::Event {
        RejectChangedEvent {
            reconciled: matches!(kind, PassiveStateEventKind::Reconciled),
            state,
        }
    }

    fn snapshot(
        _metadata: SourceSessionMetadata,
        _platform: PlatformFamily,
        _permission: PermissionState,
        _adapter_version: &str,
        state: Self::State,
    ) -> Self::Snapshot {
        state
    }

    fn observation(
        _source_instance_id: String,
        fact: SequencedObservation<Self::Event>,
    ) -> Self::Observation {
        RejectChangedObservation {
            sequence: fact.sequence,
            gap: fact.gap,
            event: fact.payload,
        }
    }

    fn drain(
        _source_instance_id: String,
        health: SourceHealth,
        observations: Vec<Self::Observation>,
        _resets: Vec<SourceReset>,
        terminal_error: Option<SourceFailureCode>,
    ) -> Self::Drain {
        RejectChangedDrain {
            health,
            observations,
            terminal_error,
        }
    }
}

fn timestamp(value: u64) -> SourceTimestamp {
    SourceTimestamp {
        monotonic_time_ns: value,
    }
}

#[test]
fn wire_conversion_failure_returns_failed_reconciliation_with_discarded_gap() {
    let emitter = PassiveStateEmitter::<RejectChangedWire>::new(4).expect("emitter");
    emitter
        .session
        .finish_open(RejectChangedState(1), SourceHealth::Healthy, None)
        .expect("open");
    emitter.observe(RejectChangedState(2));

    let drain = passive_state_drain::<RejectChangedWire>(&emitter.session);

    assert_eq!(drain.health, SourceHealth::Failed);
    assert_eq!(drain.terminal_error, Some(SourceFailureCode::Protocol));
    assert_eq!(drain.observations.len(), 1);
    assert_eq!(drain.observations[0].sequence, 2);
    assert_eq!(
        drain.observations[0].gap,
        Some(SequenceGap {
            first_missing: 1,
            last_missing: 1,
        })
    );
    assert!(drain.observations[0].event.reconciled);
    drain
        .validate_protocol()
        .expect("failed drain remains valid");
}

#[test]
fn inventory_overflow_remains_distinct_from_backend_failure() {
    let error =
        PassiveStateSourceError::InventoryOverflow("bounded inventory was truncated".to_owned());
    assert_eq!(error.failure_code(), SourceFailureCode::InventoryOverflow);
    assert!(!error.allows_initial_unavailable_fallback());
    assert!(
        !PassiveStateSourceError::Cleanup("unproved fence".to_owned())
            .allows_initial_unavailable_fallback()
    );
    assert!(
        PassiveStateSourceError::Backend("missing service".to_owned())
            .allows_initial_unavailable_fallback()
    );
}

#[test]
fn authoritative_initial_backend_failure_degrades_after_a_successful_probe() {
    let calls = Arc::new(AtomicU64::new(0));
    let query_calls = Arc::clone(&calls);
    let query = move || {
        if query_calls.fetch_add(1, Ordering::Relaxed) == 0 {
            Ok(RejectChangedState(1))
        } else {
            Err(PassiveStateSourceError::Backend(
                "service disappeared after probe".to_owned(),
            ))
        }
    };
    assert_eq!(query(), Ok(RejectChangedState(1)));
    let emitter = PassiveStateEmitter::<RejectChangedWire>::new(4).expect("emitter");
    let opened = PollingPassiveStateBackend::new(
        PlatformFamily::Linux,
        PermissionState::Granted,
        "test-polling",
        Duration::from_secs(1),
        query,
    )
    .open_with_initial_backend_fallback(emitter, "test-unavailable", RejectChangedState(0))
    .expect("ordinary query discovery failure degrades");

    assert_eq!(opened.permission, PermissionState::Unavailable);
    assert_eq!(opened.adapter_version, "test-unavailable");
    assert_eq!(opened.initial_state, RejectChangedState(0));
    assert_eq!(
        opened.subscription.stop().expect("static source stops"),
        RejectChangedState(0)
    );
}

#[test]
fn authoritative_initial_inventory_overflow_remains_terminal() {
    let emitter = PassiveStateEmitter::<RejectChangedWire>::new(4).expect("emitter");
    let result = PollingPassiveStateBackend::new(
        PlatformFamily::Linux,
        PermissionState::Granted,
        "test-polling",
        Duration::from_secs(1),
        || {
            Err(PassiveStateSourceError::InventoryOverflow(
                "bounded inventory changed during open".to_owned(),
            ))
        },
    )
    .open_with_initial_backend_fallback(emitter, "test-unavailable", RejectChangedState(0));

    assert!(matches!(
        result,
        Err(PassiveStateSourceError::InventoryOverflow(message))
            if message == "bounded inventory changed during open"
    ));
}

#[test]
fn released_polling_worker_accepts_an_immediate_stop() {
    let emitter = PassiveStateEmitter::<RejectChangedWire>::new(4).expect("emitter");
    let opened = PollingPassiveStateBackend::new(
        PlatformFamily::Linux,
        PermissionState::Granted,
        "test-polling",
        Duration::from_secs(1),
        || Ok(RejectChangedState(1)),
    )
    .open_with_initial_backend_fallback(emitter, "test-unavailable", RejectChangedState(0))
    .expect("polling source opens");

    assert_eq!(
        opened
            .subscription
            .stop()
            .expect("immediate stop is queued"),
        RejectChangedState(1)
    );
}

#[test]
fn bounded_task_returns_a_completed_value() {
    assert_eq!(
        run_bounded_task("bounded-task-success", Duration::from_secs(1), || 42),
        Ok(42)
    );
}

#[test]
fn queued_task_result_after_setup_exhausted_budget_is_not_success() {
    let (result_sender, result_receiver) = mpsc::sync_channel(1);
    let mut worker = DeadlineThread::spawn("expired-queued-task", move || {
        result_sender.send(Ok(42)).expect("queue completed result");
    })
    .expect("spawn worker");
    worker
        .finish(Duration::from_secs(1))
        .expect("prove actual worker join");
    let budget = Duration::from_millis(10);
    let before_setup = Instant::now()
        .checked_sub(Duration::from_secs(1))
        .expect("past instant");
    assert_eq!(
        collect_bounded_task_result(worker, &result_receiver, before_setup, budget),
        Err(BoundedTaskError::TimedOut)
    );
}

#[test]
fn bounded_task_reports_panics_without_unwinding_the_caller() {
    assert_eq!(
        run_bounded_task("bounded-task-panic", Duration::from_secs(1), || {
            panic!("worker panic")
        }),
        Err(BoundedTaskError::Panicked)
    );
}

#[test]
fn bounded_task_timeout_detaches_until_the_owner_releases_it() {
    let (release_sender, release_receiver) = mpsc::sync_channel(1);
    let (finished_sender, finished_receiver) = mpsc::sync_channel(1);
    let result = run_bounded_task(
        "bounded-task-timeout",
        Duration::from_millis(20),
        move || {
            let _ = release_receiver.recv();
            let _ = finished_sender.send(());
        },
    );

    assert_eq!(result, Err(BoundedTaskError::TimedOut));
    release_sender.send(()).expect("release detached worker");
    finished_receiver
        .recv_timeout(Duration::from_secs(1))
        .expect("detached worker exits after release");
}

#[test]
fn bounded_source_stop_poisons_every_returned_error_category() {
    let poisoned = AtomicBool::new(false);
    let result = run_bounded_source_stop_with(
        "bounded-source-stop-error",
        Duration::from_secs(1),
        || Err::<(), _>("backend"),
        |_| "bounded",
        &|| poisoned.store(true, Ordering::Release),
    );

    assert_eq!(result, Err("backend"));
    assert!(poisoned.load(Ordering::Acquire));
}

#[test]
fn bounded_source_stop_poisons_deadline_failures_before_mapping() {
    let (release_sender, release_receiver) = mpsc::sync_channel(1);
    let poisoned = AtomicBool::new(false);
    let result = run_bounded_source_stop_with(
        "bounded-source-stop-timeout",
        Duration::from_millis(20),
        move || {
            let _ = release_receiver.recv();
            Ok::<_, &'static str>(())
        },
        |_| "bounded",
        &|| poisoned.store(true, Ordering::Release),
    );

    assert_eq!(result, Err("bounded"));
    assert!(poisoned.load(Ordering::Acquire));
    release_sender.send(()).expect("release detached stop");
}

#[test]
fn boundary_failure_takes_precedence_during_rollback() {
    assert_eq!(
        prefer_boundary_error("primary", Err::<(), _>("boundary")),
        "boundary"
    );
    assert_eq!(
        prefer_boundary_error("primary", Ok::<(), &str>(())),
        "primary"
    );
}

#[test]
fn overflow_reports_the_complete_missing_range() {
    let mut queue = BoundedObservationQueue::new(2).expect("valid queue");
    queue.push(timestamp(1), "one").expect("push one");
    queue.push(timestamp(2), "two").expect("push two");
    let first_overflow = queue.push(timestamp(3), "three").expect("push three");
    let second_overflow = queue.push(timestamp(4), "four").expect("push four");

    assert_eq!(
        first_overflow.dropped,
        Some(SequenceGap {
            first_missing: 1,
            last_missing: 1,
        })
    );
    assert_eq!(
        second_overflow.dropped,
        Some(SequenceGap {
            first_missing: 1,
            last_missing: 2,
        })
    );

    let drained = queue.drain();
    assert_eq!(drained.len(), 2);
    assert_eq!(drained[0].sequence, 3);
    assert_eq!(
        drained[0].gap,
        Some(SequenceGap {
            first_missing: 1,
            last_missing: 2
        })
    );
    assert_eq!(drained[1].sequence, 4);
}

#[test]
fn stop_is_idempotent_and_rejects_new_input() {
    let mut queue = BoundedObservationQueue::new(2).expect("valid queue");
    queue.stop();
    queue.stop();
    assert!(queue.is_stopped());
    assert_eq!(queue.push(timestamp(1), "late"), Err(QueueError::Stopped));
}

#[test]
fn instance_identifiers_are_fresh_and_bounded() {
    let first = fresh_source_instance_id();
    let second = fresh_source_instance_id();
    assert_ne!(first, second);
    assert_eq!(first.len(), 48);
    assert!(first.bytes().all(|byte| byte.is_ascii_hexdigit()));
}

#[test]
fn protocol_integer_conversion_saturates_at_the_wire_bound() {
    assert_eq!(bounded_protocol_integer(42), 42);
    assert_eq!(
        bounded_protocol_integer(u128::MAX),
        MAX_PROTOCOL_SAFE_INTEGER
    );
    assert_eq!(
        bounded_protocol_integer(u128::from(MAX_PROTOCOL_SAFE_INTEGER) + 1),
        MAX_PROTOCOL_SAFE_INTEGER
    );
}

#[test]
fn reset_plan_validates_the_complete_synthetic_wire_boundary() {
    let plan =
        SourceResetPlan::new(2, "supervised-reopen".to_owned()).expect("representable reset plan");
    assert_eq!(plan.missing_count, 2);
    assert_eq!(plan.reason, "supervised-reopen");
    assert!(SourceResetPlan::new(u64::MAX, "supervised-reopen".to_owned()).is_err());
}

#[test]
fn deadline_thread_completion_probe_does_not_wait_for_running_task() {
    let (release, wait) = std::sync::mpsc::sync_channel(1);
    let mut worker = DeadlineThread::spawn("completion-probe", move || {
        let _ = wait.recv();
    })
    .expect("worker");
    assert!(!worker.is_finished());
    release.send(()).expect("release worker");
    worker
        .finish(Duration::from_secs(1))
        .expect("join completed worker");
    assert!(worker.is_finished());
}

#[test]
fn deadline_thread_reports_completion_and_panic() {
    let mut completed = DeadlineThread::spawn("completed-test", || {}).expect("spawn worker");
    assert_eq!(completed.finish(Duration::from_secs(1)), Ok(()));
    assert_eq!(completed.finish(Duration::from_secs(1)), Ok(()));

    let mut panicked =
        DeadlineThread::spawn("panic-test", || panic!("expected panic")).expect("spawn worker");
    assert_eq!(
        panicked.finish(Duration::from_secs(1)),
        Err(ThreadFinishError::Panicked)
    );
}

struct BlockingTlsDrop {
    entered: mpsc::SyncSender<()>,
    release: Receiver<()>,
}
impl Drop for BlockingTlsDrop {
    fn drop(&mut self) {
        self.entered.send(()).unwrap();
        self.release.recv().unwrap();
    }
}
thread_local! {
    static BLOCKED_TLS: std::cell::RefCell<Option<BlockingTlsDrop>> = const { std::cell::RefCell::new(None) };
}

#[test]
fn deadline_thread_receipt_waits_for_actual_tls_cleanup() {
    let (entered, blocked) = mpsc::sync_channel(1);
    let (release, wait) = mpsc::sync_channel(1);
    let mut worker = DeadlineThread::spawn("tls-receipt", move || {
        BLOCKED_TLS.with(|value| {
            *value.borrow_mut() = Some(BlockingTlsDrop {
                entered,
                release: wait,
            });
        });
    })
    .unwrap();
    blocked.recv_timeout(Duration::from_secs(3)).unwrap();
    assert!(!worker.is_finished());
    assert_eq!(
        worker.finish(Duration::ZERO),
        Err(ThreadFinishError::TimedOut)
    );
    assert_eq!(
        worker.finish(Duration::ZERO),
        Err(ThreadFinishError::TimedOut)
    );
    release.send(()).unwrap();
    worker.finish(Duration::from_secs(3)).unwrap();
    assert!(worker.is_finished());
    worker.finish(Duration::ZERO).unwrap();
}

#[test]
fn deadline_thread_times_out_without_joining_a_blocked_worker() {
    let (release_sender, release_receiver) = mpsc::sync_channel(1);
    let (finished_sender, finished_receiver) = mpsc::sync_channel(1);
    let mut blocked = DeadlineThread::spawn("blocked-test", move || {
        let _ = release_receiver.recv();
        let _ = finished_sender.send(());
    })
    .expect("spawn blocked worker");

    assert_eq!(
        blocked.finish(Duration::from_millis(25)),
        Err(ThreadFinishError::TimedOut)
    );
    release_sender.send(()).expect("release detached worker");
    finished_receiver
        .recv_timeout(Duration::from_secs(1))
        .expect("detached worker exits after release");
}
