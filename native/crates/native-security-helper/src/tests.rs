use super::*;
use native_protocol::ProcessApplicationObservation;

#[test]
fn delayed_process_capture_is_bounded_by_each_observation_clock() {
    let source = serde_json::json!({
        "source_instance_id": "process-source-0001",
        "sequence": 1,
        "observed_at": {"monotonic_time_ns": 10},
        "event": {"kind": "exited", "process_instance_id": "process-instance-0001"}
    });
    let helper = serde_json::json!({
        "protocol_version": 1,
        "channel_nonce": "a".repeat(64),
        "helper_source_instance_id": "process-source-0001",
        "source_kind": "process_application",
        "sequence": 1,
        "monotonic_time_ns": 10,
        "process_event": {"kind": "exited", "process_instance_id": "process-instance-0001"}
    });
    for delay in [None, Some(0), Some(7), Some(10)] {
        let mut source = source.clone();
        let mut helper = helper.clone();
        if let Some(delay) = delay {
            source["event"]["capture_delay_ns"] = serde_json::json!(delay);
            helper["process_event"]["capture_delay_ns"] = serde_json::json!(delay);
        }
        let source: ProcessApplicationObservation = serde_json::from_value(source).unwrap();
        let helper: HelperObservation = serde_json::from_value(helper).unwrap();
        source.validate_protocol().expect("valid source capture");
        helper.validate_protocol().expect("valid helper capture");
        assert_eq!(source.event.capture_delay_ns, delay);
        assert_eq!(helper.process_event.unwrap().capture_delay_ns, delay);
    }
    for delay in [
        serde_json::json!(11),
        serde_json::json!(-1),
        serde_json::json!(1.5),
        serde_json::json!(9_007_199_254_740_992_u64),
        serde_json::Value::Null,
    ] {
        let mut source = source.clone();
        let mut helper = helper.clone();
        source["event"]["capture_delay_ns"] = delay.clone();
        helper["process_event"]["capture_delay_ns"] = delay;
        assert!(
            !serde_json::from_value::<ProcessApplicationObservation>(source)
                .is_ok_and(|value| value.validate_protocol().is_ok())
        );
        assert!(
            !serde_json::from_value::<HelperObservation>(helper)
                .is_ok_and(|value| value.validate_protocol().is_ok())
        );
    }
}

use std::io::Cursor;
use std::sync::{Arc, mpsc::Receiver};

use native_helper_protocol::{
    HELPER_PROTOCOL_VERSION, HelperEventClass, HelperKind, MAX_HELPER_FRAME_BYTES,
};
use native_protocol::{
    INTERACTIVE_SESSION_SCHEMA_VERSION, InteractiveConsoleOwnership, InteractiveLockState,
    InteractiveRemoteAttachment, InteractiveSessionCertainty, InteractiveSessionCoverage,
    InteractiveSessionState, PROCESS_APPLICATION_SCHEMA_VERSION, ProcessApplicationCertainty,
    ProcessApplicationCoverage, ProcessApplicationEvent, ProcessApplicationEventKind,
    ProcessApplicationState,
};

#[test]
fn frame_reader_rejects_an_oversized_prefix_before_allocating_payload() {
    let mut frame = Cursor::new(
        u32::try_from(MAX_HELPER_FRAME_BYTES + 1)
            .expect("bounded test size")
            .to_be_bytes(),
    );
    assert!(matches!(
        read_frame(&mut frame),
        Err(HelperTransportError::Protocol(
            HelperProtocolError::FrameSize
        ))
    ));
}

#[test]
fn frame_round_trip_preserves_exact_json_bytes() {
    let mut bytes = Vec::new();
    write_json_frame(&mut bytes, &vec!["bounded", "helper"]).expect("write frame");
    let decoded: Vec<String> = read_json_frame(&mut Cursor::new(bytes)).expect("read frame");
    assert_eq!(decoded, ["bounded", "helper"]);
}

#[test]
fn silent_and_partial_frames_are_bounded_by_the_transport_deadline() {
    for prefix in [Vec::new(), vec![0, 0]] {
        let (release, blocked) = mpsc::channel();
        let mut transport =
            DeadlineFramedTransport::new(Vec::<u8>::new(), BlockingReader { prefix, blocked })
                .expect("transport worker");
        assert!(matches!(
            transport.read_bytes(Duration::from_millis(10)),
            Err(HelperTransportError::DeadlineExceeded)
        ));
        drop(release);
        transport.shutdown().expect("transport workers stopped");
    }
}

#[test]
fn sequential_startup_phases_share_one_absolute_deadline() {
    let (release, blocked) = mpsc::channel();
    let mut transport = DeadlineFramedTransport::new(
        DelayedWriter {
            delay: Duration::from_millis(120),
            delayed: false,
        },
        BlockingReader {
            prefix: Vec::new(),
            blocked,
        },
    )
    .expect("transport worker");
    let started = Instant::now();
    let deadline = started + Duration::from_millis(200);
    transport
        .write_bytes(b"startup", remaining(deadline).expect("write budget"))
        .expect("first phase");
    assert!(matches!(
        transport.read_bytes(remaining(deadline).expect("read budget")),
        Err(HelperTransportError::DeadlineExceeded)
    ));
    assert!(started.elapsed() < Duration::from_millis(280));
    drop(release);
    transport.shutdown().expect("transport workers stopped");
}

#[test]
fn completed_worker_joins_after_a_shared_cleanup_deadline_is_exhausted() {
    let mut worker = FrameWorker::spawn("completed-frame-worker", || {}).expect("worker");
    worker
        .join
        .as_mut()
        .expect("join receipt")
        .wait(Instant::now() + Duration::from_secs(1))
        .expect("actual worker join");
    let expired = Instant::now()
        .checked_sub(Duration::from_millis(1))
        .expect("expired cleanup deadline");
    worker
        .finish(expired)
        .expect("queued completion remains observable without budget");
}

#[test]
fn expired_startup_deadlines_do_not_start_new_work() {
    let task_started = Arc::new(AtomicBool::new(false));
    let worker_started = Arc::clone(&task_started);
    let expired = Instant::now()
        .checked_sub(Duration::from_millis(1))
        .expect("representable expired deadline");
    assert!(matches!(
        run_startup_task("prctr-expired-test", expired, move || {
            worker_started.store(true, Ordering::Release);
            Ok(())
        }),
        Err(HelperTransportError::DeadlineExceeded)
    ));
    assert!(!task_started.load(Ordering::Acquire));
    assert!(matches!(
        spawn_helper_before_deadline(
            std::path::Path::new("/prctr-expired-helper-must-not-start"),
            expired,
        ),
        Err(HelperTransportError::DeadlineExceeded)
    ));
}

#[cfg(unix)]
#[test]
fn successful_termination_is_reported_only_after_exit_is_observed() {
    let mut child = Command::new("/bin/sh")
        .args(["-c", "sleep 30"])
        .spawn()
        .expect("test child");
    terminate_child(&mut child).expect("termination boundary");
    assert!(child.try_wait().expect("wait status").is_some());
}

#[test]
fn broker_generated_nonces_are_fresh_and_wire_bounded() {
    let first = generate_channel_nonce().expect("first nonce");
    let second = generate_channel_nonce().expect("second nonce");
    assert_eq!(first.len(), 64);
    assert!(first.bytes().all(|byte| byte.is_ascii_hexdigit()));
    assert_ne!(first, second);
}

struct BlockingReader {
    prefix: Vec<u8>,
    blocked: Receiver<()>,
}

struct DelayedWriter {
    delay: Duration,
    delayed: bool,
}

impl Write for DelayedWriter {
    fn write(&mut self, bytes: &[u8]) -> io::Result<usize> {
        if !self.delayed {
            self.delayed = true;
            thread::sleep(self.delay);
        }
        Ok(bytes.len())
    }

    fn flush(&mut self) -> io::Result<()> {
        Ok(())
    }
}

impl Read for BlockingReader {
    fn read(&mut self, buffer: &mut [u8]) -> io::Result<usize> {
        if !self.prefix.is_empty() {
            let length = buffer.len().min(self.prefix.len());
            buffer[..length].copy_from_slice(&self.prefix[..length]);
            self.prefix.drain(..length);
            return Ok(length);
        }
        let _ = self.blocked.recv();
        Ok(0)
    }
}

#[test]
fn discriminated_failure_frames_route_to_their_owned_source_fences() {
    const NONCE: &str = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
    let peer = VerifiedHelperPeer {
        helper_kind: HelperKind::MacosEndpointSecurityHelper,
        helper_build_id: HELPER_BUILD_ID.to_owned(),
        capabilities: vec![
            HelperSourceKind::ProcessApplication,
            HelperSourceKind::InteractiveSession,
        ],
    };
    let channel = bind_verified_helper_channel(
        &HelperHandshake {
            protocol_version: HELPER_PROTOCOL_VERSION,
            channel_nonce: NONCE.to_owned(),
            helper_kind: peer.helper_kind,
            helper_build_id: peer.helper_build_id.clone(),
            capabilities: peer.capabilities.clone(),
        },
        &peer,
        NONCE,
    )
    .expect("verified channel");
    let mut active_sources = BTreeMap::new();
    let (process_request, process_snapshot) = process_source(NONCE);
    insert_active_source(
        &channel,
        &mut active_sources,
        process_request,
        &process_snapshot,
    );
    let (session_request, session_snapshot) = session_source(NONCE);
    insert_active_source(
        &channel,
        &mut active_sources,
        session_request,
        &session_snapshot,
    );

    let failure = HelperSourceFailure {
        protocol_version: HELPER_PROTOCOL_VERSION,
        channel_nonce: NONCE.to_owned(),
        helper_source_instance_id: "session-source-0001".to_owned(),
        source_kind: HelperSourceKind::InteractiveSession,
        failure_code: HelperFailureCode::InventoryOverflow,
        last_sequence: 0,
        lost_event_count: None,
        monotonic_time_ns: 2,
    };
    let routed = route_server_message(
        HelperServerMessage {
            kind: HelperServerMessageKind::Failure,
            snapshot: None,
            observation: None,
            failure: Some(failure.clone()),
        },
        &mut active_sources,
    )
    .expect("routed failure");
    assert!(matches!(
        routed,
        HelperServerPayload::Event(NativeHelperSourceEvent::Failure(value))
            if value == failure
    ));
    assert_eq!(active_sources.len(), 2);
}

#[test]
fn initial_source_failure_preserves_its_category_without_fencing_the_channel() {
    const NONCE: &str = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
    let (channel, request, _initial) = process_channel(NONCE);
    let failure = HelperSourceFailure {
        protocol_version: HELPER_PROTOCOL_VERSION,
        channel_nonce: NONCE.to_owned(),
        helper_source_instance_id: request.helper_source_instance_id.clone(),
        source_kind: HelperSourceKind::ProcessApplication,
        failure_code: HelperFailureCode::InventoryOverflow,
        last_sequence: 0,
        lost_event_count: None,
        monotonic_time_ns: 1,
    };
    let mut frames = Vec::new();
    write_json_frame(
        &mut frames,
        &HelperServerMessage {
            kind: HelperServerMessageKind::Failure,
            snapshot: None,
            observation: None,
            failure: Some(failure.clone()),
        },
    )
    .expect("failure frame");
    let mut connection = test_connection(channel, Cursor::new(frames));
    assert!(matches!(
        connection.open_source(&request),
        Err(HelperTransportError::SourceFailure(value)) if value == failure
    ));
    assert!(!connection.fenced);
    assert!(connection.active_sources.is_empty());
    connection
        .assert_usable()
        .expect("verified channel remains usable");
}

#[test]
fn failure_disposition_preserves_only_clean_operational_categories() {
    for code in [
        HelperFailureCode::PermissionLost,
        HelperFailureCode::NativeEventLoss,
        HelperFailureCode::QueueOverflow,
        HelperFailureCode::InventoryOverflow,
        HelperFailureCode::Backend,
    ] {
        assert_eq!(
            failure_disposition(code),
            FailureDisposition::PreserveChannel
        );
    }
    assert_eq!(
        failure_disposition(HelperFailureCode::Protocol),
        FailureDisposition::FenceConnection
    );
    assert_eq!(
        failure_disposition(HelperFailureCode::Cleanup),
        FailureDisposition::PoisonUtility
    );
}

#[test]
fn interleaved_backlog_is_distinct_from_ingress_capacity_and_reserves_failure_control() {
    const NONCE: &str = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
    let (channel, mut request, initial) = process_channel(NONCE);
    request.queue_capacity = 2;
    let mut connection = test_connection(channel, Cursor::new(Vec::<u8>::new()));
    insert_active_source(
        &connection.channel,
        &mut connection.active_sources,
        request.clone(),
        &initial,
    );

    for sequence in 1..=4 {
        let observation = HelperObservation {
            protocol_version: HELPER_PROTOCOL_VERSION,
            channel_nonce: NONCE.to_owned(),
            helper_source_instance_id: request.helper_source_instance_id.clone(),
            source_kind: HelperSourceKind::ProcessApplication,
            sequence,
            monotonic_time_ns: sequence + 1,
            process_event: Some(ProcessApplicationEvent {
                capture_delay_ns: None,
                kind: ProcessApplicationEventKind::Reconciled,
                process_instance_id: None,
                process: None,
                state: initial.process_state.clone(),
            }),
            interactive_session_event: None,
        };
        let event = route_server_event(
            DecodedHelperServerPayload::Observation(Box::new(observation)),
            &mut connection.active_sources,
        )
        .expect("observation is ordered");
        connection.queue_event(event).expect("observation fits");
    }

    let failure = HelperSourceFailure {
        protocol_version: HELPER_PROTOCOL_VERSION,
        channel_nonce: NONCE.to_owned(),
        helper_source_instance_id: request.helper_source_instance_id,
        source_kind: HelperSourceKind::ProcessApplication,
        failure_code: HelperFailureCode::QueueOverflow,
        last_sequence: 4,
        lost_event_count: Some(1),
        monotonic_time_ns: 6,
    };
    let event = route_server_event(
        DecodedHelperServerPayload::Failure(failure.clone()),
        &mut connection.active_sources,
    )
    .expect("failure is ordered");
    connection
        .queue_event(event)
        .expect("terminal control event has reserved capacity");

    assert_eq!(connection.pending_events.len(), 5);
    assert!(matches!(
        connection.pending_events.back(),
        Some(NativeHelperSourceEvent::Failure(value)) if value == &failure
    ));
}

#[test]
fn close_returns_the_ordered_tail_before_its_terminal_snapshot() {
    const NONCE: &str = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
    let (channel, request, initial) = process_channel(NONCE);
    let observation = HelperObservation {
        protocol_version: HELPER_PROTOCOL_VERSION,
        channel_nonce: NONCE.to_owned(),
        helper_source_instance_id: request.helper_source_instance_id.clone(),
        source_kind: HelperSourceKind::ProcessApplication,
        sequence: 1,
        monotonic_time_ns: 2,
        process_event: Some(ProcessApplicationEvent {
            capture_delay_ns: None,
            kind: ProcessApplicationEventKind::Reconciled,
            process_instance_id: None,
            process: None,
            state: initial.process_state.clone(),
        }),
        interactive_session_event: None,
    };
    let final_snapshot = HelperSourceSnapshot {
        last_sequence: 1,
        monotonic_time_ns: 3,
        ..initial.clone()
    };
    let mut frames = Vec::new();
    write_json_frame(
        &mut frames,
        &HelperServerMessage {
            kind: HelperServerMessageKind::Observation,
            snapshot: None,
            observation: Some(observation.clone()),
            failure: None,
        },
    )
    .expect("observation frame");
    write_json_frame(
        &mut frames,
        &HelperServerMessage {
            kind: HelperServerMessageKind::Snapshot,
            snapshot: Some(final_snapshot.clone()),
            observation: None,
            failure: None,
        },
    )
    .expect("final frame");
    let mut connection = test_connection(channel, Cursor::new(frames));
    insert_active_source(
        &connection.channel,
        &mut connection.active_sources,
        request.clone(),
        &initial,
    );
    let result = connection
        .close_source(&HelperSourceClose {
            protocol_version: HELPER_PROTOCOL_VERSION,
            channel_nonce: NONCE.to_owned(),
            helper_source_instance_id: request.helper_source_instance_id,
        })
        .expect("atomic close");
    assert_eq!(
        result.events,
        [NativeHelperSourceEvent::Observation(Box::new(observation))]
    );
    assert_eq!(result.final_snapshot, final_snapshot);
    assert!(connection.pending_events.is_empty());
}

#[test]
fn close_protocol_failure_can_follow_an_operational_source_failure() {
    const NONCE: &str = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
    let (channel, request, initial) = process_channel(NONCE);
    let backend_failure = HelperSourceFailure {
        protocol_version: HELPER_PROTOCOL_VERSION,
        channel_nonce: NONCE.to_owned(),
        helper_source_instance_id: request.helper_source_instance_id.clone(),
        source_kind: request.source_kind,
        failure_code: HelperFailureCode::Backend,
        last_sequence: 0,
        lost_event_count: None,
        monotonic_time_ns: 2,
    };
    let close_failure = HelperSourceFailure {
        failure_code: HelperFailureCode::Protocol,
        monotonic_time_ns: 3,
        ..backend_failure.clone()
    };
    let mut frames = Vec::new();
    for failure in [&backend_failure, &close_failure] {
        write_json_frame(
            &mut frames,
            &HelperServerMessage {
                kind: HelperServerMessageKind::Failure,
                snapshot: None,
                observation: None,
                failure: Some(failure.clone()),
            },
        )
        .expect("failure frame");
    }
    let mut connection = test_connection(channel, Cursor::new(frames));
    insert_active_source(
        &connection.channel,
        &mut connection.active_sources,
        request.clone(),
        &initial,
    );
    assert!(matches!(
        connection.receive_event(),
        Ok(NativeHelperSourceEvent::Failure(value)) if value == backend_failure
    ));
    assert!(matches!(
        connection.close_source(&HelperSourceClose {
            protocol_version: HELPER_PROTOCOL_VERSION,
            channel_nonce: NONCE.to_owned(),
            helper_source_instance_id: request.helper_source_instance_id,
        }),
        Err(HelperTransportError::SourceFailure(value)) if value == close_failure
    ));
    assert!(connection.fenced);
}

#[test]
fn first_malformed_frame_terminally_fences_the_connection() {
    const NONCE: &str = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
    let (channel, _request, _initial) = process_channel(NONCE);
    let mut frame = Vec::new();
    write_frame(&mut frame, b"{").expect("malformed JSON frame");
    let mut connection = test_connection(channel, Cursor::new(frame));
    assert!(matches!(
        connection.receive_event(),
        Err(HelperTransportError::Json(_))
    ));
    assert!(connection.fenced);
    assert!(matches!(
        connection.receive_event(),
        Err(HelperTransportError::ConnectionFenced)
    ));
}

fn process_channel(
    nonce: &str,
) -> (
    VerifiedHelperChannel,
    HelperSourceOpen,
    HelperSourceSnapshot,
) {
    let peer = VerifiedHelperPeer {
        helper_kind: HelperKind::MacosEndpointSecurityHelper,
        helper_build_id: HELPER_BUILD_ID.to_owned(),
        capabilities: vec![HelperSourceKind::ProcessApplication],
    };
    let channel = bind_verified_helper_channel(
        &HelperHandshake {
            protocol_version: HELPER_PROTOCOL_VERSION,
            channel_nonce: nonce.to_owned(),
            helper_kind: peer.helper_kind,
            helper_build_id: peer.helper_build_id.clone(),
            capabilities: peer.capabilities.clone(),
        },
        &peer,
        nonce,
    )
    .expect("verified channel");
    let (request, snapshot) = process_source(nonce);
    (channel, request, snapshot)
}

fn test_connection(
    channel: VerifiedHelperChannel,
    reader: impl Read + Send + 'static,
) -> NativeHelperConnection {
    #[cfg(unix)]
    let child = Command::new("/bin/sh")
        .args(["-c", "sleep 30"])
        .spawn()
        .expect("test child");
    #[cfg(windows)]
    let child = Command::new("cmd")
        .args(["/C", "ping -n 30 127.0.0.1 >NUL"])
        .spawn()
        .expect("test child");
    NativeHelperConnection {
        owner: HelperOwner::Child(child),
        transport: DeadlineFramedTransport::new(Vec::<u8>::new(), reader).expect("test transport"),
        channel,
        active_sources: BTreeMap::new(),
        pending_events: VecDeque::new(),
        fenced: false,
    }
}

fn insert_active_source(
    channel: &VerifiedHelperChannel,
    active_sources: &mut BTreeMap<String, ActiveHelperSource>,
    request: HelperSourceOpen,
    snapshot: &HelperSourceSnapshot,
) {
    let mut fence = channel.open_source(&request).expect("source fence");
    fence
        .accept_initial_snapshot(snapshot)
        .expect("initial snapshot");
    active_sources.insert(
        request.helper_source_instance_id,
        ActiveHelperSource {
            kind: request.source_kind,
            fence,
        },
    );
}

fn process_source(nonce: &str) -> (HelperSourceOpen, HelperSourceSnapshot) {
    let source_id = "process-source-0001".to_owned();
    (
        HelperSourceOpen {
            protocol_version: HELPER_PROTOCOL_VERSION,
            channel_nonce: nonce.to_owned(),
            helper_source_instance_id: source_id.clone(),
            source_kind: HelperSourceKind::ProcessApplication,
            schema_version: PROCESS_APPLICATION_SCHEMA_VERSION,
            queue_capacity: 8,
            event_classes: vec![
                HelperEventClass::ProcessLifecycle,
                HelperEventClass::ProcessIdentity,
            ],
        },
        HelperSourceSnapshot {
            protocol_version: HELPER_PROTOCOL_VERSION,
            channel_nonce: nonce.to_owned(),
            helper_source_instance_id: source_id,
            source_kind: HelperSourceKind::ProcessApplication,
            schema_version: PROCESS_APPLICATION_SCHEMA_VERSION,
            last_sequence: 0,
            monotonic_time_ns: 1,
            process_state: Some(ProcessApplicationState {
                coverage: ProcessApplicationCoverage::Unavailable,
                certainty: ProcessApplicationCertainty::Unknown,
                processes: Vec::new(),
            }),
            interactive_session_state: None,
        },
    )
}

fn session_source(nonce: &str) -> (HelperSourceOpen, HelperSourceSnapshot) {
    let source_id = "session-source-0001".to_owned();
    (
        HelperSourceOpen {
            protocol_version: HELPER_PROTOCOL_VERSION,
            channel_nonce: nonce.to_owned(),
            helper_source_instance_id: source_id.clone(),
            source_kind: HelperSourceKind::InteractiveSession,
            schema_version: INTERACTIVE_SESSION_SCHEMA_VERSION,
            queue_capacity: 8,
            event_classes: vec![HelperEventClass::InteractiveSessionLifecycle],
        },
        HelperSourceSnapshot {
            protocol_version: HELPER_PROTOCOL_VERSION,
            channel_nonce: nonce.to_owned(),
            helper_source_instance_id: source_id,
            source_kind: HelperSourceKind::InteractiveSession,
            schema_version: INTERACTIVE_SESSION_SCHEMA_VERSION,
            last_sequence: 0,
            monotonic_time_ns: 1,
            process_state: None,
            interactive_session_state: Some(InteractiveSessionState {
                coverage: InteractiveSessionCoverage::Unavailable,
                certainty: InteractiveSessionCertainty::Unknown,
                console_ownership: InteractiveConsoleOwnership::Unknown,
                lock_state: InteractiveLockState::Unknown,
                remote_attachment: InteractiveRemoteAttachment::Unknown,
                other_human_session_count: 0,
            }),
        },
    )
}
