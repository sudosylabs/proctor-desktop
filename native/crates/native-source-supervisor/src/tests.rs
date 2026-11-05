use super::*;

use std::cell::Cell;
use std::collections::VecDeque;
use std::rc::Rc;
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::mpsc::{self, Receiver, SyncSender};
use std::sync::{Arc, Mutex};

use candidate_window_state::{CandidateWindowEmitter, OpenedCandidateWindowBackend};
use capture_session_state::{CaptureSessionEmitter, OpenedCaptureSessionBackend};
use display_topology::{DisplayTopologyEmitter, OpenedDisplayTopologyBackend, OpenedSourceHealth};
use native_protocol::{
    CandidateWindowBounds, CandidateWindowCertainty, CandidateWindowFocus,
    CandidateWindowPlacement, CandidateWindowPresence, CandidateWindowState,
    CandidateWindowVisibility, CaptureSessionActivity, CaptureSessionCertainty,
    CaptureSessionSignal, CaptureSessionState, CaptureSessionSupport, DisplayTopologySnapshot,
    PlatformFamily, ProcessApplicationCertainty, ProcessApplicationCoverage,
    ProcessApplicationState, SequenceGap, SourceReset, SourceTimestamp, TopologyCertainty,
};
use native_source_runtime::{SourceSessionMetadata, UnavailablePassiveStateBackend};
use process_application_state::{OpenedProcessApplicationBackend, ProcessApplicationEmitter};

struct TestDisplayBackend;
struct TestDisplaySubscription;

impl DisplayTopologyBackend for TestDisplayBackend {
    type Subscription = TestDisplaySubscription;

    fn open(
        self,
        _emitter: DisplayTopologyEmitter,
    ) -> Result<OpenedDisplayTopologyBackend<Self::Subscription>, DisplayTopologyError> {
        Ok(OpenedDisplayTopologyBackend {
            platform: PlatformFamily::Linux,
            permission: PermissionState::Granted,
            health: OpenedSourceHealth::Healthy,
            adapter_version: "test-display",
            initial_topology: display_state(),
            subscription: TestDisplaySubscription,
        })
    }
}

impl DisplayTopologySubscription for TestDisplaySubscription {
    fn stop(&mut self) -> Result<DisplayTopologySnapshot, DisplayTopologyError> {
        Ok(display_state())
    }
}

struct TestWindowBackend;
struct TestWindowSubscription;

impl CandidateWindowBackend for TestWindowBackend {
    type Subscription = TestWindowSubscription;

    fn open(
        self,
        _emitter: CandidateWindowEmitter,
    ) -> Result<OpenedCandidateWindowBackend<Self::Subscription>, CandidateWindowError> {
        Ok(OpenedCandidateWindowBackend {
            platform: PlatformFamily::Linux,
            permission: PermissionState::Granted,
            adapter_version: "test-window",
            initial_window: window_state(),
            subscription: TestWindowSubscription,
        })
    }
}

impl CandidateWindowSubscription for TestWindowSubscription {
    fn stop(self) -> Result<CandidateWindowState, CandidateWindowError> {
        Ok(window_state())
    }
}

struct TestSessionBackend;
struct TestSessionSubscription;

impl CaptureSessionBackend for TestSessionBackend {
    type Subscription = TestSessionSubscription;

    fn open(
        self,
        _emitter: CaptureSessionEmitter,
    ) -> Result<OpenedCaptureSessionBackend<Self::Subscription>, CaptureSessionError> {
        Ok(OpenedCaptureSessionBackend {
            platform: PlatformFamily::Linux,
            permission: PermissionState::Unavailable,
            adapter_version: "test-session",
            initial_state: capture_state(),
            subscription: TestSessionSubscription,
        })
    }
}

impl CaptureSessionSubscription for TestSessionSubscription {
    fn stop(self) -> Result<CaptureSessionState, CaptureSessionError> {
        Ok(capture_state())
    }
}

struct TestProcessBackend;
struct TestProcessSubscription;

impl ProcessApplicationBackend for TestProcessBackend {
    type Subscription = TestProcessSubscription;

    fn open(
        self,
        _emitter: ProcessApplicationEmitter,
    ) -> Result<OpenedProcessApplicationBackend<Self::Subscription>, ProcessApplicationError> {
        Ok(OpenedProcessApplicationBackend {
            platform: PlatformFamily::Linux,
            permission: PermissionState::Unavailable,
            adapter_version: "test-process",
            initial_state: process_state(),
            subscription: TestProcessSubscription,
        })
    }
}

impl ProcessApplicationSubscription for TestProcessSubscription {
    fn stop(self) -> Result<ProcessApplicationState, ProcessApplicationError> {
        Ok(process_state())
    }
}

#[test]
fn public_factories_open_the_fixed_baseline_and_stop_in_reverse_order() {
    let factories = BaselineSourceFactories::new(
        display_topology_factory(|| Ok(TestDisplayBackend)),
        candidate_window_factory(|| Ok(TestWindowBackend)),
        capture_session_factory(|| Ok(TestSessionBackend)),
        process_application_factory(|| Ok(TestProcessBackend)),
    )
    .with_passive_source(passive_state_factory::<InteractiveSessionWire, _, _>(
        || {
            Ok(UnavailablePassiveStateBackend::new(
                PlatformFamily::Linux,
                "test-interactive",
            ))
        },
    ))
    .with_passive_source(passive_state_factory::<ClipboardWire, _, _>(|| {
        Ok(UnavailablePassiveStateBackend::new(
            PlatformFamily::Linux,
            "test-clipboard",
        ))
    }))
    .with_passive_source(passive_state_factory::<PrintSpoolerWire, _, _>(|| {
        Ok(UnavailablePassiveStateBackend::new(
            PlatformFamily::Linux,
            "test-print",
        ))
    }))
    .with_passive_source(passive_state_factory::<RemovableStorageWire, _, _>(|| {
        Ok(UnavailablePassiveStateBackend::new(
            PlatformFamily::Linux,
            "test-storage",
        ))
    }))
    .with_passive_source(passive_state_factory::<VirtualizationWire, _, _>(|| {
        Ok(UnavailablePassiveStateBackend::new(
            PlatformFamily::Linux,
            "test-virtual",
        ))
    }))
    .with_passive_source(passive_state_factory::<NetworkConfigurationWire, _, _>(
        || {
            Ok(UnavailablePassiveStateBackend::new(
                PlatformFamily::Linux,
                "test-network",
            ))
        },
    ))
    .with_passive_source(passive_state_factory::<MediaDeviceWire, _, _>(|| {
        Ok(UnavailablePassiveStateBackend::new(
            PlatformFamily::Linux,
            "test-media",
        ))
    }));
    let opened = NativeSourceSupervisor::open(config(), factories).expect("baseline opens");

    assert_eq!(opened.snapshots.sources.len(), NATIVE_SOURCE_COUNT);
    assert!(opened.snapshots.sources.iter().all(|snapshot| {
        matches!(
            snapshot.permission(),
            PermissionState::Granted | PermissionState::Unavailable
        )
    }));
    assert_eq!(opened.supervisor.state(), SupervisorState::Degraded);

    let mut supervisor = opened.supervisor;
    let stopped = supervisor.stop();
    assert_eq!(stopped.state, SupervisorState::Stopped);
    assert!(!stopped.process_replacement_required);
    assert_eq!(
        stopped
            .batches
            .iter()
            .map(NativeSourceBatch::kind)
            .collect::<Vec<_>>(),
        vec![
            NativeSourceKind::MediaDevice,
            NativeSourceKind::NetworkConfiguration,
            NativeSourceKind::Virtualization,
            NativeSourceKind::RemovableStorage,
            NativeSourceKind::PrintSpooler,
            NativeSourceKind::Clipboard,
            NativeSourceKind::InteractiveSession,
            NativeSourceKind::ProcessApplication,
            NativeSourceKind::CaptureSession,
            NativeSourceKind::CandidateWindow,
            NativeSourceKind::DisplayTopology,
        ]
    );
    assert!(
        stopped
            .batches
            .iter()
            .all(|batch| batch.health() == SourceHealth::Stopped)
    );
    assert!(supervisor.stop().batches.is_empty());
}

#[test]
fn explicit_source_selection_does_not_open_disabled_factories() {
    let display = fake_factory(
        NativeSourceKind::DisplayTopology,
        vec![FactoryStep::open(fake_source(
            display_snapshot("display-instance-0001", SourceHealth::Healthy),
            Vec::new(),
            empty_batch(
                NativeSourceKind::DisplayTopology,
                "display-instance-0001",
                SourceHealth::Stopped,
                None,
            ),
            Arc::new(AtomicU32::new(0)),
        ))],
    );
    let factories = healthy_fake_baseline(display)
        .select_sources(&[
            NativeSourceKind::DisplayTopology,
            NativeSourceKind::Clipboard,
        ])
        .expect("selection is valid");
    let opened = NativeSourceSupervisor::open(config(), factories).expect("selection opens");

    assert_eq!(
        opened
            .snapshots
            .sources
            .iter()
            .map(NativeSourceSnapshot::kind)
            .collect::<Vec<_>>(),
        vec![
            NativeSourceKind::DisplayTopology,
            NativeSourceKind::Clipboard,
        ]
    );
    let mut supervisor = opened.supervisor;
    assert_eq!(
        supervisor
            .stop()
            .batches
            .iter()
            .map(NativeSourceBatch::kind)
            .collect::<Vec<_>>(),
        vec![
            NativeSourceKind::Clipboard,
            NativeSourceKind::DisplayTopology,
        ]
    );
}

#[test]
fn configuration_rejects_unbounded_requests_and_restart_policies() {
    assert_eq!(
        RestartPolicy::new(0, Duration::from_millis(1), Duration::from_secs(1)),
        Err(SupervisorConfigError::InvalidRestartAttempts)
    );
    assert_eq!(
        RestartPolicy::new(2, Duration::from_millis(1), Duration::from_secs(1)),
        Err(SupervisorConfigError::InvalidRestartAttempts)
    );
    assert_eq!(
        RestartPolicy::new(1, Duration::ZERO, Duration::from_secs(1)),
        Err(SupervisorConfigError::InvalidRestartBackoff)
    );
    assert_eq!(
        SupervisorConfig::new("short".to_owned(), 1, RestartPolicy::default()),
        Err(SupervisorConfigError::InvalidSourceRequest)
    );
}

#[test]
fn a_partial_open_rolls_back_prior_sources_and_reports_cleanup_failure() {
    let display_stop_count = Arc::new(AtomicU32::new(0));
    let display = fake_factory(
        NativeSourceKind::DisplayTopology,
        vec![FactoryStep::open(fake_source(
            display_snapshot("display-instance-0001", SourceHealth::Healthy),
            Vec::new(),
            empty_batch(
                NativeSourceKind::DisplayTopology,
                "display-instance-0001",
                SourceHealth::Failed,
                Some(SourceFailureCode::Cleanup),
            ),
            Arc::clone(&display_stop_count),
        ))],
    );
    let candidate = fake_factory(
        NativeSourceKind::CandidateWindow,
        vec![FactoryStep::Fail(SourceFailureCode::Backend)],
    );
    let capture = fake_factory(NativeSourceKind::CaptureSession, Vec::new());
    let process = fake_factory(NativeSourceKind::ProcessApplication, Vec::new());
    let factories = factories_from_prefix(vec![
        (NativeSourceKind::DisplayTopology, display),
        (NativeSourceKind::CandidateWindow, candidate),
        (NativeSourceKind::CaptureSession, capture),
        (NativeSourceKind::ProcessApplication, process),
    ]);

    let error = NativeSourceSupervisor::open(config(), factories)
        .err()
        .expect("candidate open fails");
    assert_eq!(error.source, NativeSourceKind::CandidateWindow);
    assert_eq!(error.failure, SourceFailureCode::Backend);
    assert!(error.process_replacement_required);
    assert_eq!(
        error.cleanup_failures,
        vec![NativeSourceKind::DisplayTopology]
    );
    assert_eq!(display_stop_count.load(Ordering::Acquire), 1);
}

#[test]
fn a_poisoned_initial_failure_reports_process_replacement() {
    let display = fake_factory(
        NativeSourceKind::DisplayTopology,
        vec![FactoryStep::PoisonedFailure(SourceFailureCode::Protocol)],
    );
    let factories = factories_from_prefix(vec![(NativeSourceKind::DisplayTopology, display)]);

    let error = NativeSourceSupervisor::open(config(), factories)
        .err()
        .expect("poisoned initial open fails");
    assert_eq!(error.source, NativeSourceKind::DisplayTopology);
    assert_eq!(error.failure, SourceFailureCode::Protocol);
    assert!(error.cleanup_failures.is_empty());
    assert!(error.process_replacement_required);
}

#[test]
fn a_poisoned_process_rejects_and_stops_the_last_opened_source() {
    let stop_count = Arc::new(AtomicU32::new(0));
    let source = fake_source(
        display_snapshot("display-instance-0001", SourceHealth::Healthy),
        Vec::new(),
        empty_batch(
            NativeSourceKind::DisplayTopology,
            "display-instance-0001",
            SourceHealth::Stopped,
            None,
        ),
        Arc::clone(&stop_count),
    );

    let error = validate_opened_source(
        NativeSourceKind::DisplayTopology,
        Box::new(source),
        None,
        false,
    )
    .err()
    .expect("poisoned process rejects opened source");

    assert_eq!(error.code, SourceFailureCode::Cleanup);
    assert!(error.process_replacement_required);
    assert_eq!(stop_count.load(Ordering::Acquire), 1);
}

#[test]
fn a_failed_source_restarts_after_backoff_with_a_fresh_reset_boundary() {
    let clock = FakeClock::default();
    let display_calls = Arc::new(Mutex::new(Vec::new()));
    let display = fake_factory_with_calls(
        NativeSourceKind::DisplayTopology,
        vec![
            FactoryStep::open(fake_source(
                display_snapshot("display-instance-0001", SourceHealth::Healthy),
                vec![empty_batch(
                    NativeSourceKind::DisplayTopology,
                    "display-instance-0001",
                    SourceHealth::Failed,
                    Some(SourceFailureCode::Backend),
                )],
                empty_batch(
                    NativeSourceKind::DisplayTopology,
                    "display-instance-0001",
                    SourceHealth::Failed,
                    Some(SourceFailureCode::Backend),
                ),
                Arc::new(AtomicU32::new(0)),
            )),
            FactoryStep::open(fake_source(
                display_snapshot("display-instance-0002", SourceHealth::Healthy),
                vec![display_reset_batch("display-instance-0002")],
                empty_batch(
                    NativeSourceKind::DisplayTopology,
                    "display-instance-0002",
                    SourceHealth::Stopped,
                    None,
                ),
                Arc::new(AtomicU32::new(0)),
            )),
        ],
        Arc::clone(&display_calls),
    );
    let factories = healthy_fake_baseline(display);
    let mut supervisor =
        NativeSourceSupervisor::open_with_clock(config(), factories, Box::new(clock.clone()))
            .expect("baseline opens")
            .supervisor;

    let failed = supervisor.poll();
    assert_eq!(failed.state, SupervisorState::Recovering);
    assert!(matches!(
        failed.transitions.as_slice(),
        [SourceLifecycleTransition::RestartScheduled {
            source: NativeSourceKind::DisplayTopology,
            next_attempt: 1,
            retry_after,
            failure: SourceFailureCode::Backend,
            ..
        }] if *retry_after == Duration::from_millis(10)
    ));

    assert!(supervisor.poll().opened_snapshots.is_empty());
    clock.advance(Duration::from_millis(10));
    let started = supervisor.poll();
    assert_eq!(started.state, SupervisorState::Recovering);
    assert!(started.transitions.is_empty());
    let restarted = poll_until(&mut supervisor, |poll| {
        matches!(
            poll.transitions.as_slice(),
            [SourceLifecycleTransition::Restarted { .. }]
        )
    });
    assert_eq!(restarted.state, SupervisorState::Healthy);
    assert!(matches!(
        restarted.transitions.as_slice(),
        [SourceLifecycleTransition::Restarted {
            source: NativeSourceKind::DisplayTopology,
            attempt: 1,
            ..
        }]
    ));
    assert_eq!(
        restarted.opened_snapshots[0].source_instance_id(),
        "display-instance-0002"
    );

    let after_restart = supervisor.poll();
    let reset_batch = after_restart
        .batches
        .iter()
        .find(|batch| batch.kind() == NativeSourceKind::DisplayTopology)
        .expect("restarted display batch");
    assert_eq!(reset_batch.fact_count(), 1);
    let calls = display_calls.lock().expect("display calls lock");
    assert_eq!(calls.len(), 2);
    assert!(calls[0].is_none());
    assert_eq!(
        calls[1],
        Some(RestartBoundary {
            missing_count: RESTART_BOUNDARY_MISSING_COUNT,
            reason: RESTART_REASON,
        })
    );
}

#[test]
fn one_restart_failure_exhausts_the_fixed_budget() {
    let clock = FakeClock::default();
    let display = fake_factory(
        NativeSourceKind::DisplayTopology,
        vec![
            FactoryStep::open(fake_source(
                display_snapshot("display-instance-0001", SourceHealth::Healthy),
                vec![empty_batch(
                    NativeSourceKind::DisplayTopology,
                    "display-instance-0001",
                    SourceHealth::Failed,
                    Some(SourceFailureCode::Backend),
                )],
                empty_batch(
                    NativeSourceKind::DisplayTopology,
                    "display-instance-0001",
                    SourceHealth::Failed,
                    Some(SourceFailureCode::Backend),
                ),
                Arc::new(AtomicU32::new(0)),
            )),
            FactoryStep::Fail(SourceFailureCode::Backend),
        ],
    );
    let factories = healthy_fake_baseline(display);
    let policy = RestartPolicy::new(1, Duration::from_millis(10), Duration::from_millis(40))
        .expect("valid policy");
    let config = SupervisorConfig::new("collection-session-0001".to_owned(), 16, policy)
        .expect("valid config");
    let mut supervisor =
        NativeSourceSupervisor::open_with_clock(config, factories, Box::new(clock.clone()))
            .expect("baseline opens")
            .supervisor;

    assert_eq!(supervisor.poll().state, SupervisorState::Recovering);
    clock.advance(Duration::from_millis(10));
    let started_first_attempt = supervisor.poll();
    assert!(started_first_attempt.transitions.is_empty());
    let first_attempt = poll_until(&mut supervisor, |poll| {
        matches!(
            poll.transitions.as_slice(),
            [SourceLifecycleTransition::RestartExhausted { .. }]
        )
    });
    assert_eq!(first_attempt.state, SupervisorState::Failed);
    assert!(matches!(
        first_attempt.transitions.as_slice(),
        [SourceLifecycleTransition::RestartExhausted {
            source: NativeSourceKind::DisplayTopology,
            attempts: 1,
            failure: SourceFailureCode::Backend,
        }]
    ));
    assert!(supervisor.poll().transitions.is_empty());
}

#[test]
fn a_failed_stop_requires_process_replacement_instead_of_local_restart() {
    let clock = FakeClock::default();
    let poisoned = Arc::new(AtomicBool::new(false));
    let mut display_source = fake_source(
        display_snapshot("display-instance-0001", SourceHealth::Healthy),
        vec![empty_batch(
            NativeSourceKind::DisplayTopology,
            "display-instance-0001",
            SourceHealth::Failed,
            Some(SourceFailureCode::Backend),
        )],
        empty_batch(
            NativeSourceKind::DisplayTopology,
            "display-instance-0001",
            SourceHealth::Failed,
            Some(SourceFailureCode::Backend),
        ),
        Arc::new(AtomicU32::new(0)),
    );
    display_source.closed_input_boundary = false;
    let factories = healthy_fake_baseline(fake_factory(
        NativeSourceKind::DisplayTopology,
        vec![FactoryStep::open(display_source)],
    ));
    let mut supervisor = NativeSourceSupervisor::open_with_environment(
        config(),
        factories,
        Box::new(clock),
        Box::new(RecordingProcessFence {
            poisoned: Arc::clone(&poisoned),
        }),
        SOURCE_OPEN_DEADLINE,
    )
    .expect("baseline opens")
    .supervisor;

    let failed = supervisor.poll();
    assert_eq!(failed.state, SupervisorState::Failed);
    assert!(matches!(
        failed.transitions.as_slice(),
        [SourceLifecycleTransition::ProcessReplacementRequired {
            source: NativeSourceKind::DisplayTopology,
            failure: SourceFailureCode::Cleanup,
        }]
    ));
    assert!(poisoned.load(Ordering::Acquire));
    let later = supervisor.poll();
    assert_eq!(later.state, SupervisorState::Failed);
    assert!(later.batches.is_empty());
    assert!(later.transitions.is_empty());
}

#[test]
fn a_poisoned_backend_failure_while_restarting_requires_process_replacement() {
    let clock = FakeClock::default();
    let poisoned = Arc::new(AtomicBool::new(false));
    let display = fake_factory(
        NativeSourceKind::DisplayTopology,
        vec![
            FactoryStep::open(failing_display_source()),
            FactoryStep::PoisonedFailure(SourceFailureCode::Backend),
        ],
    );
    let factories = healthy_fake_baseline(display);
    let mut supervisor = NativeSourceSupervisor::open_with_environment(
        config(),
        factories,
        Box::new(clock.clone()),
        Box::new(RecordingProcessFence {
            poisoned: Arc::clone(&poisoned),
        }),
        SOURCE_OPEN_DEADLINE,
    )
    .expect("baseline opens")
    .supervisor;

    assert_eq!(supervisor.poll().state, SupervisorState::Recovering);
    clock.advance(Duration::from_millis(10));
    assert_eq!(supervisor.poll().state, SupervisorState::Recovering);
    let failed = poll_until(&mut supervisor, |poll| {
        matches!(
            poll.transitions.as_slice(),
            [SourceLifecycleTransition::ProcessReplacementRequired { .. }]
        )
    });
    assert_eq!(failed.state, SupervisorState::Failed);
    assert!(matches!(
        failed.transitions.as_slice(),
        [SourceLifecycleTransition::ProcessReplacementRequired {
            source: NativeSourceKind::DisplayTopology,
            failure: SourceFailureCode::Backend,
        }]
    ));
    assert!(poisoned.load(Ordering::Acquire));
}

#[test]
fn stop_preserves_process_replacement_from_an_in_flight_protocol_failure() {
    let clock = FakeClock::default();
    let poisoned = Arc::new(AtomicBool::new(false));
    let calls = Arc::new(Mutex::new(Vec::new()));
    let display = fake_factory_with_calls(
        NativeSourceKind::DisplayTopology,
        vec![
            FactoryStep::open(failing_display_source()),
            FactoryStep::PoisonedFailure(SourceFailureCode::Protocol),
        ],
        Arc::clone(&calls),
    );
    let factories = healthy_fake_baseline(display);
    let mut supervisor = NativeSourceSupervisor::open_with_environment(
        config(),
        factories,
        Box::new(clock.clone()),
        Box::new(RecordingProcessFence {
            poisoned: Arc::clone(&poisoned),
        }),
        SOURCE_OPEN_DEADLINE,
    )
    .expect("baseline opens")
    .supervisor;

    assert_eq!(supervisor.poll().state, SupervisorState::Recovering);
    clock.advance(Duration::from_millis(10));
    assert_eq!(supervisor.poll().state, SupervisorState::Recovering);
    wait_for_factory_calls(&calls, 2);
    let stopped = supervisor.stop();

    assert_eq!(stopped.state, SupervisorState::Stopped);
    assert!(stopped.process_replacement_required);
    assert!(poisoned.load(Ordering::Acquire));
    assert!(supervisor.stop().process_replacement_required);
}

#[test]
fn a_due_restart_open_never_blocks_the_poll_caller() {
    let (started_sender, started_receiver) = mpsc::sync_channel(1);
    let (release_sender, release_receiver) = mpsc::sync_channel(1);
    let (finished_sender, _finished_receiver) = mpsc::sync_channel(1);
    let clock = FakeClock::default();
    let display = Box::new(BlockingRestartFactory {
        initial: Some(Box::new(failing_display_source())),
        replacement: Some(Box::new(healthy_replacement_display_source())),
        started_sender,
        release_receiver,
        finished_sender,
    });
    let factories = healthy_fake_baseline(display);
    let mut supervisor =
        NativeSourceSupervisor::open_with_clock(config(), factories, Box::new(clock.clone()))
            .expect("baseline opens")
            .supervisor;

    assert_eq!(supervisor.poll().state, SupervisorState::Recovering);
    clock.advance(Duration::from_millis(10));
    let began_at = Instant::now();
    let opening = supervisor.poll();
    let elapsed = began_at.elapsed();
    assert_eq!(opening.state, SupervisorState::Recovering);
    assert!(opening.transitions.is_empty());
    assert!(elapsed < Duration::from_millis(100));
    started_receiver
        .recv_timeout(Duration::from_secs(1))
        .expect("restart worker starts");
    release_sender.send(()).expect("release restart worker");

    let restarted = poll_until(&mut supervisor, |poll| {
        matches!(
            poll.transitions.as_slice(),
            [SourceLifecycleTransition::Restarted { .. }]
        )
    });
    assert_eq!(restarted.state, SupervisorState::Healthy);
}

#[test]
fn stop_fences_an_in_flight_restart_before_reporting_stopped() {
    let (started_sender, started_receiver) = mpsc::sync_channel(1);
    let (release_sender, release_receiver) = mpsc::sync_channel(1);
    let (finished_sender, finished_receiver) = mpsc::sync_channel(1);
    let clock = FakeClock::default();
    let display = Box::new(BlockingRestartFactory {
        initial: Some(Box::new(failing_display_source())),
        replacement: Some(Box::new(healthy_replacement_display_source())),
        started_sender,
        release_receiver,
        finished_sender,
    });
    let factories = healthy_fake_baseline(display);
    let mut supervisor =
        NativeSourceSupervisor::open_with_clock(config(), factories, Box::new(clock.clone()))
            .expect("baseline opens")
            .supervisor;

    assert_eq!(supervisor.poll().state, SupervisorState::Recovering);
    clock.advance(Duration::from_millis(10));
    assert_eq!(supervisor.poll().state, SupervisorState::Recovering);
    started_receiver
        .recv_timeout(Duration::from_secs(1))
        .expect("restart worker starts");
    let releaser = thread::spawn(move || {
        thread::sleep(Duration::from_millis(20));
        release_sender.send(()).expect("release restart worker");
    });

    let stopped = supervisor.stop();
    releaser.join().expect("release thread exits");
    finished_receiver
        .recv_timeout(Duration::from_secs(1))
        .expect("restart worker closes its open boundary");
    assert_eq!(stopped.state, SupervisorState::Stopped);
    assert!(!stopped.process_replacement_required);
    assert_eq!(
        stopped
            .batches
            .iter()
            .map(NativeSourceBatch::kind)
            .collect::<Vec<_>>(),
        vec![
            NativeSourceKind::MediaDevice,
            NativeSourceKind::NetworkConfiguration,
            NativeSourceKind::Virtualization,
            NativeSourceKind::RemovableStorage,
            NativeSourceKind::PrintSpooler,
            NativeSourceKind::Clipboard,
            NativeSourceKind::InteractiveSession,
            NativeSourceKind::ProcessApplication,
            NativeSourceKind::CaptureSession,
            NativeSourceKind::CandidateWindow,
            NativeSourceKind::DisplayTopology,
        ]
    );
}

#[test]
fn a_stalled_restart_open_requires_process_replacement_after_its_deadline() {
    let (started_sender, started_receiver) = mpsc::sync_channel(1);
    let (release_sender, release_receiver) = mpsc::sync_channel(1);
    let (finished_sender, finished_receiver) = mpsc::sync_channel(1);
    let poisoned = Arc::new(AtomicBool::new(false));
    let clock = FakeClock::default();
    let display = Box::new(BlockingRestartFactory {
        initial: Some(Box::new(failing_display_source())),
        replacement: Some(Box::new(healthy_replacement_display_source())),
        started_sender,
        release_receiver,
        finished_sender,
    });
    let factories = healthy_fake_baseline(display);
    let mut supervisor = NativeSourceSupervisor::open_with_environment(
        config(),
        factories,
        Box::new(clock.clone()),
        Box::new(RecordingProcessFence {
            poisoned: Arc::clone(&poisoned),
        }),
        Duration::from_millis(20),
    )
    .expect("baseline opens")
    .supervisor;

    assert_eq!(supervisor.poll().state, SupervisorState::Recovering);
    clock.advance(Duration::from_millis(10));
    assert_eq!(supervisor.poll().state, SupervisorState::Recovering);
    started_receiver
        .recv_timeout(Duration::from_secs(1))
        .expect("restart worker starts");
    thread::sleep(Duration::from_millis(30));
    let failed = supervisor.poll();
    assert_eq!(failed.state, SupervisorState::Failed);
    assert!(matches!(
        failed.transitions.as_slice(),
        [SourceLifecycleTransition::ProcessReplacementRequired {
            source: NativeSourceKind::DisplayTopology,
            failure: SourceFailureCode::Cleanup,
        }]
    ));
    assert!(poisoned.load(Ordering::Acquire));

    release_sender.send(()).expect("release timed-out worker");
    finished_receiver
        .recv_timeout(Duration::from_secs(1))
        .expect("timed-out worker exits after release");
}

#[test]
fn a_stalled_open_is_deadline_bounded_and_poisoned() {
    let (release_sender, release_receiver) = mpsc::sync_channel(1);
    let (finished_sender, finished_receiver) = mpsc::sync_channel(1);
    let poisoned = AtomicBool::new(false);
    let outcome = bounded_factory_open_with(
        NativeSourceKind::DisplayTopology,
        Box::new(BlockingFactory {
            release_receiver,
            finished_sender,
        }),
        SourceParameters::from(&config()),
        None,
        Duration::from_millis(20),
        &|| poisoned.store(true, Ordering::Release),
    );

    assert!(matches!(
        outcome,
        FactoryOpenOutcome::LifecycleFailure(BoundedTaskError::TimedOut)
    ));
    assert!(poisoned.load(Ordering::Acquire));
    release_sender.send(()).expect("release stalled factory");
    finished_receiver
        .recv_timeout(Duration::from_secs(1))
        .expect("detached factory exits after release");
}

fn config() -> SupervisorConfig {
    let policy = RestartPolicy::new(1, Duration::from_millis(10), Duration::from_millis(40))
        .expect("valid policy");
    SupervisorConfig::new("collection-session-0001".to_owned(), 16, policy).expect("valid config")
}

fn poll_until(
    supervisor: &mut NativeSourceSupervisor,
    predicate: impl Fn(&SupervisorPoll) -> bool,
) -> SupervisorPoll {
    let deadline = Instant::now() + Duration::from_secs(1);
    loop {
        let poll = supervisor.poll();
        if predicate(&poll) {
            return poll;
        }
        assert!(
            Instant::now() < deadline,
            "supervisor did not produce the expected transition"
        );
        thread::yield_now();
    }
}

fn wait_for_factory_calls(calls: &Arc<Mutex<Vec<Option<RestartBoundary>>>>, expected: usize) {
    let deadline = Instant::now() + Duration::from_secs(1);
    loop {
        if calls.lock().expect("factory calls lock").len() >= expected {
            return;
        }
        assert!(
            Instant::now() < deadline,
            "restart worker did not call the factory"
        );
        thread::yield_now();
    }
}

fn display_state() -> DisplayTopologySnapshot {
    DisplayTopologySnapshot {
        certainty: TopologyCertainty::Complete,
        targets: Vec::new(),
    }
}

fn window_state() -> CandidateWindowState {
    CandidateWindowState {
        certainty: CandidateWindowCertainty::Complete,
        presence: CandidateWindowPresence::Present,
        focus: CandidateWindowFocus::Focused,
        visibility: CandidateWindowVisibility::Visible,
        placement: CandidateWindowPlacement::Maximized,
        bounds: Some(CandidateWindowBounds {
            x: 0,
            y: 0,
            width: 1920,
            height: 1080,
        }),
        display_target_id: Some("display-1".to_owned()),
    }
}

fn capture_state() -> CaptureSessionState {
    let unsupported = CaptureSessionSignal {
        support: CaptureSessionSupport::Unsupported,
        activity: CaptureSessionActivity::Unknown,
        certainty: CaptureSessionCertainty::Unknown,
    };
    CaptureSessionState {
        screen_capture: unsupported.clone(),
        native_remote_session: unsupported,
    }
}

fn process_state() -> ProcessApplicationState {
    ProcessApplicationState {
        coverage: ProcessApplicationCoverage::FullLifecycle,
        certainty: ProcessApplicationCertainty::Complete,
        processes: Vec::new(),
    }
}

fn timestamp() -> SourceTimestamp {
    SourceTimestamp {
        monotonic_time_ns: 1,
    }
}

fn display_snapshot(id: &str, health: SourceHealth) -> NativeSourceSnapshot {
    NativeSourceSnapshot::DisplayTopology(DisplayTopologySourceSnapshot {
        source_instance_id: id.to_owned(),
        source_version: "test".to_owned(),
        adapter_version: "test-adapter".to_owned(),
        schema_version: DISPLAY_TOPOLOGY_SCHEMA_VERSION,
        platform: PlatformFamily::Linux,
        permission: PermissionState::Granted,
        health,
        sequence: 0,
        observed_at: timestamp(),
        topology: display_state(),
    })
}

fn candidate_snapshot(id: &str) -> NativeSourceSnapshot {
    NativeSourceSnapshot::CandidateWindow(CandidateWindowSourceSnapshot {
        source_instance_id: id.to_owned(),
        source_version: "test".to_owned(),
        adapter_version: "test-adapter".to_owned(),
        schema_version: CANDIDATE_WINDOW_SCHEMA_VERSION,
        platform: PlatformFamily::Linux,
        permission: PermissionState::Granted,
        health: SourceHealth::Healthy,
        sequence: 0,
        observed_at: timestamp(),
        window: window_state(),
    })
}

fn capture_snapshot(id: &str) -> NativeSourceSnapshot {
    NativeSourceSnapshot::CaptureSession(CaptureSessionSourceSnapshot {
        source_instance_id: id.to_owned(),
        source_version: "test".to_owned(),
        adapter_version: "test-adapter".to_owned(),
        schema_version: CAPTURE_SESSION_SCHEMA_VERSION,
        platform: PlatformFamily::Linux,
        permission: PermissionState::Unavailable,
        health: SourceHealth::Healthy,
        sequence: 0,
        observed_at: timestamp(),
        state: capture_state(),
    })
}

fn process_snapshot(id: &str) -> NativeSourceSnapshot {
    NativeSourceSnapshot::ProcessApplication(ProcessApplicationSourceSnapshot {
        source_instance_id: id.to_owned(),
        source_version: "test".to_owned(),
        adapter_version: "test-adapter".to_owned(),
        schema_version: PROCESS_APPLICATION_SCHEMA_VERSION,
        platform: PlatformFamily::Linux,
        permission: PermissionState::Unavailable,
        health: SourceHealth::Healthy,
        sequence: 0,
        observed_at: timestamp(),
        state: process_state(),
    })
}

fn passive_snapshot<W: SupervisedPassiveStateWire>(id: &str) -> NativeSourceSnapshot {
    W::wrap_snapshot(W::snapshot(
        SourceSessionMetadata {
            source_instance_id: id.to_owned(),
            health: SourceHealth::Healthy,
            observed_at: timestamp(),
        },
        PlatformFamily::Linux,
        PermissionState::Unavailable,
        "test-adapter",
        W::unavailable_state(),
    ))
}

fn empty_passive_batch<W: SupervisedPassiveStateWire>(
    id: &str,
    health: SourceHealth,
    terminal_error: Option<SourceFailureCode>,
) -> NativeSourceBatch {
    W::wrap_batch(W::drain(
        id.to_owned(),
        health,
        Vec::new(),
        Vec::new(),
        terminal_error,
    ))
}

fn empty_batch(
    kind: NativeSourceKind,
    id: &str,
    health: SourceHealth,
    terminal_error: Option<SourceFailureCode>,
) -> NativeSourceBatch {
    match kind {
        NativeSourceKind::DisplayTopology => {
            NativeSourceBatch::DisplayTopology(DisplayTopologyDrain {
                source_instance_id: id.to_owned(),
                observations: Vec::new(),
                resets: Vec::new(),
                health,
                terminal_error,
            })
        }
        NativeSourceKind::CandidateWindow => {
            NativeSourceBatch::CandidateWindow(CandidateWindowDrain {
                source_instance_id: id.to_owned(),
                health,
                observations: Vec::new(),
                resets: Vec::new(),
                terminal_error,
            })
        }
        NativeSourceKind::CaptureSession => {
            NativeSourceBatch::CaptureSession(CaptureSessionDrain {
                source_instance_id: id.to_owned(),
                health,
                observations: Vec::new(),
                resets: Vec::new(),
                terminal_error,
            })
        }
        NativeSourceKind::ProcessApplication => {
            NativeSourceBatch::ProcessApplication(ProcessApplicationDrain {
                source_instance_id: id.to_owned(),
                health,
                observations: Vec::new(),
                resets: Vec::new(),
                terminal_error,
            })
        }
        NativeSourceKind::InteractiveSession => {
            empty_passive_batch::<InteractiveSessionWire>(id, health, terminal_error)
        }
        NativeSourceKind::Clipboard => {
            empty_passive_batch::<ClipboardWire>(id, health, terminal_error)
        }
        NativeSourceKind::PrintSpooler => {
            empty_passive_batch::<PrintSpoolerWire>(id, health, terminal_error)
        }
        NativeSourceKind::RemovableStorage => {
            empty_passive_batch::<RemovableStorageWire>(id, health, terminal_error)
        }
        NativeSourceKind::Virtualization => {
            empty_passive_batch::<VirtualizationWire>(id, health, terminal_error)
        }
        NativeSourceKind::NetworkConfiguration => {
            empty_passive_batch::<NetworkConfigurationWire>(id, health, terminal_error)
        }
        NativeSourceKind::MediaDevice => {
            empty_passive_batch::<MediaDeviceWire>(id, health, terminal_error)
        }
    }
}

fn display_reset_batch(id: &str) -> NativeSourceBatch {
    NativeSourceBatch::DisplayTopology(DisplayTopologyDrain {
        source_instance_id: id.to_owned(),
        observations: Vec::new(),
        resets: vec![SourceReset {
            source_instance_id: id.to_owned(),
            sequence: 2,
            observed_at: timestamp(),
            gap: Some(SequenceGap {
                first_missing: 1,
                last_missing: 1,
            }),
            reason: RESTART_REASON.to_owned(),
        }],
        health: SourceHealth::Healthy,
        terminal_error: None,
    })
}

struct FakeSource {
    snapshot: NativeSourceSnapshot,
    drains: VecDeque<NativeSourceBatch>,
    fallback_health: SourceHealth,
    stop_batch: NativeSourceBatch,
    closed_input_boundary: bool,
    stop_count: Arc<AtomicU32>,
}

impl ErasedSource for FakeSource {
    fn kind(&self) -> NativeSourceKind {
        self.snapshot.kind()
    }

    fn snapshot(&self) -> NativeSourceSnapshot {
        self.snapshot.clone()
    }

    fn health(&self) -> SourceHealth {
        self.fallback_health
    }

    fn drain(&mut self) -> NativeSourceBatch {
        if let Some(batch) = self.drains.pop_front() {
            self.fallback_health = batch.health();
            return batch;
        }
        empty_batch(
            self.kind(),
            self.snapshot.source_instance_id(),
            self.fallback_health,
            (self.fallback_health == SourceHealth::Failed).then_some(SourceFailureCode::Backend),
        )
    }

    fn stop(&mut self) -> SourceStopOutcome {
        self.stop_count.fetch_add(1, Ordering::AcqRel);
        SourceStopOutcome {
            preceding_batches: Vec::new(),
            final_snapshot: None,
            batch: self.stop_batch.clone(),
            closed_input_boundary: self.closed_input_boundary,
        }
    }
}

fn fake_source(
    snapshot: NativeSourceSnapshot,
    drains: Vec<NativeSourceBatch>,
    stop_batch: NativeSourceBatch,
    stop_count: Arc<AtomicU32>,
) -> FakeSource {
    let fallback_health = snapshot.health();
    FakeSource {
        snapshot,
        drains: drains.into(),
        fallback_health,
        stop_batch,
        closed_input_boundary: true,
        stop_count,
    }
}

fn failing_display_source() -> FakeSource {
    fake_source(
        display_snapshot("display-instance-0001", SourceHealth::Healthy),
        vec![empty_batch(
            NativeSourceKind::DisplayTopology,
            "display-instance-0001",
            SourceHealth::Failed,
            Some(SourceFailureCode::Backend),
        )],
        empty_batch(
            NativeSourceKind::DisplayTopology,
            "display-instance-0001",
            SourceHealth::Failed,
            Some(SourceFailureCode::Backend),
        ),
        Arc::new(AtomicU32::new(0)),
    )
}

fn healthy_replacement_display_source() -> FakeSource {
    fake_source(
        display_snapshot("display-instance-0002", SourceHealth::Healthy),
        vec![display_reset_batch("display-instance-0002")],
        empty_batch(
            NativeSourceKind::DisplayTopology,
            "display-instance-0002",
            SourceHealth::Stopped,
            None,
        ),
        Arc::new(AtomicU32::new(0)),
    )
}

enum FactoryStep {
    Open(Box<FakeSource>),
    Fail(SourceFailureCode),
    PoisonedFailure(SourceFailureCode),
}

impl FactoryStep {
    fn open(source: FakeSource) -> Self {
        Self::Open(Box::new(source))
    }
}

struct FakeFactory {
    kind: NativeSourceKind,
    steps: VecDeque<FactoryStep>,
    calls: Arc<Mutex<Vec<Option<RestartBoundary>>>>,
}

struct BlockingFactory {
    release_receiver: Receiver<()>,
    finished_sender: SyncSender<()>,
}

struct BlockingRestartFactory {
    initial: Option<Box<FakeSource>>,
    replacement: Option<Box<FakeSource>>,
    started_sender: SyncSender<()>,
    release_receiver: Receiver<()>,
    finished_sender: SyncSender<()>,
}

impl ErasedFactory for BlockingFactory {
    fn open(
        &mut self,
        _parameters: &SourceParameters,
        _restart: Option<RestartBoundary>,
    ) -> Result<Box<dyn ErasedSource>, SourceStartFailure> {
        let _ = self.release_receiver.recv();
        let _ = self.finished_sender.send(());
        Err(SourceStartFailure {
            code: SourceFailureCode::Backend,
            process_replacement_required: false,
        })
    }
}

impl ErasedFactory for BlockingRestartFactory {
    fn open(
        &mut self,
        _parameters: &SourceParameters,
        restart: Option<RestartBoundary>,
    ) -> Result<Box<dyn ErasedSource>, SourceStartFailure> {
        if restart.is_none() {
            return self
                .initial
                .take()
                .map(|source| source as Box<dyn ErasedSource>)
                .ok_or(SourceStartFailure {
                    code: SourceFailureCode::Backend,
                    process_replacement_required: false,
                });
        }
        let _ = self.started_sender.send(());
        let _ = self.release_receiver.recv();
        let _ = self.finished_sender.send(());
        self.replacement
            .take()
            .map(|source| source as Box<dyn ErasedSource>)
            .ok_or(SourceStartFailure {
                code: SourceFailureCode::Backend,
                process_replacement_required: false,
            })
    }
}

impl ErasedFactory for FakeFactory {
    fn open(
        &mut self,
        _parameters: &SourceParameters,
        restart: Option<RestartBoundary>,
    ) -> Result<Box<dyn ErasedSource>, SourceStartFailure> {
        self.calls.lock().expect("factory calls lock").push(restart);
        match self.steps.pop_front() {
            Some(FactoryStep::Open(source)) if source.kind() == self.kind => Ok(source),
            Some(FactoryStep::Open(_source)) => Err(SourceStartFailure {
                code: SourceFailureCode::Protocol,
                process_replacement_required: false,
            }),
            Some(FactoryStep::Fail(code)) => Err(SourceStartFailure {
                code,
                process_replacement_required: false,
            }),
            Some(FactoryStep::PoisonedFailure(code)) => Err(SourceStartFailure {
                code,
                process_replacement_required: true,
            }),
            None => Err(SourceStartFailure {
                code: SourceFailureCode::Backend,
                process_replacement_required: false,
            }),
        }
    }
}

fn fake_factory(kind: NativeSourceKind, steps: Vec<FactoryStep>) -> Box<dyn ErasedFactory> {
    fake_factory_with_calls(kind, steps, Arc::new(Mutex::new(Vec::new())))
}

fn fake_factory_with_calls(
    kind: NativeSourceKind,
    steps: Vec<FactoryStep>,
    calls: Arc<Mutex<Vec<Option<RestartBoundary>>>>,
) -> Box<dyn ErasedFactory> {
    Box::new(FakeFactory {
        kind,
        steps: steps.into(),
        calls,
    })
}

fn healthy_fake_baseline(display: Box<dyn ErasedFactory>) -> BaselineSourceFactories {
    let candidate = fake_factory(
        NativeSourceKind::CandidateWindow,
        vec![FactoryStep::open(fake_source(
            candidate_snapshot("candidate-instance-0001"),
            Vec::new(),
            empty_batch(
                NativeSourceKind::CandidateWindow,
                "candidate-instance-0001",
                SourceHealth::Stopped,
                None,
            ),
            Arc::new(AtomicU32::new(0)),
        ))],
    );
    let capture = fake_factory(
        NativeSourceKind::CaptureSession,
        vec![FactoryStep::open(fake_source(
            capture_snapshot("capture-instance-0001"),
            Vec::new(),
            empty_batch(
                NativeSourceKind::CaptureSession,
                "capture-instance-0001",
                SourceHealth::Stopped,
                None,
            ),
            Arc::new(AtomicU32::new(0)),
        ))],
    );
    let process = fake_factory(
        NativeSourceKind::ProcessApplication,
        vec![FactoryStep::open(fake_source(
            process_snapshot("process-instance-0001"),
            Vec::new(),
            empty_batch(
                NativeSourceKind::ProcessApplication,
                "process-instance-0001",
                SourceHealth::Stopped,
                None,
            ),
            Arc::new(AtomicU32::new(0)),
        ))],
    );
    let mut manifest_order = vec![
        (NativeSourceKind::DisplayTopology, display),
        (NativeSourceKind::CandidateWindow, candidate),
        (NativeSourceKind::CaptureSession, capture),
        (NativeSourceKind::ProcessApplication, process),
    ];
    manifest_order.push(healthy_passive_entry::<InteractiveSessionWire>(
        "interactive-instance-0001",
    ));
    manifest_order.push(healthy_passive_entry::<ClipboardWire>(
        "clipboard-instance-0001",
    ));
    manifest_order.push(healthy_passive_entry::<PrintSpoolerWire>(
        "print-instance-000001",
    ));
    manifest_order.push(healthy_passive_entry::<RemovableStorageWire>(
        "storage-instance-0001",
    ));
    manifest_order.push(healthy_passive_entry::<VirtualizationWire>(
        "virtual-instance-0001",
    ));
    manifest_order.push(healthy_passive_entry::<NetworkConfigurationWire>(
        "network-instance-0001",
    ));
    manifest_order.push(healthy_passive_entry::<MediaDeviceWire>(
        "media-instance-00001",
    ));
    BaselineSourceFactories::from_erased(manifest_order)
}

fn factories_from_prefix(
    mut manifest_order: Vec<(NativeSourceKind, Box<dyn ErasedFactory>)>,
) -> BaselineSourceFactories {
    for kind in NATIVE_SOURCE_KINDS
        .iter()
        .copied()
        .skip(manifest_order.len())
    {
        manifest_order.push((kind, fake_factory(kind, Vec::new())));
    }
    BaselineSourceFactories::from_erased(manifest_order)
}

fn healthy_passive_entry<W: SupervisedPassiveStateWire>(
    id: &str,
) -> (NativeSourceKind, Box<dyn ErasedFactory>) {
    (
        W::KIND,
        fake_factory(
            W::KIND,
            vec![FactoryStep::open(fake_source(
                passive_snapshot::<W>(id),
                Vec::new(),
                empty_passive_batch::<W>(id, SourceHealth::Stopped, None),
                Arc::new(AtomicU32::new(0)),
            ))],
        ),
    )
}

#[derive(Clone, Default)]
struct FakeClock {
    elapsed: Rc<Cell<Duration>>,
}

impl FakeClock {
    fn advance(&self, duration: Duration) {
        self.elapsed
            .set(self.elapsed.get().saturating_add(duration));
    }
}

impl SupervisorClock for FakeClock {
    fn now(&self) -> Duration {
        self.elapsed.get()
    }
}

struct RecordingProcessFence {
    poisoned: Arc<AtomicBool>,
}

impl ProcessFence for RecordingProcessFence {
    fn poison(&self) {
        self.poisoned.store(true, Ordering::Release);
    }
}
