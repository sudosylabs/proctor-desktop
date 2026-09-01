use std::collections::BTreeMap;
use std::io::{self, Read, Write};
use std::sync::mpsc;
use std::thread;
use std::time::{Duration, Instant};

use prctr_native_helper_protocol::{
    HELPER_PROTOCOL_VERSION, HelperClientMessage, HelperClientMessageKind, HelperFailureCode,
    HelperHandshake, HelperKind, HelperObservation, HelperProtocolError, HelperServerMessage,
    HelperServerMessageKind, HelperSourceFailure, HelperSourceKind, HelperSourceOpen,
    HelperSourceSnapshot, validate_helper_frame_size, validate_helper_observation,
    validate_helper_source_close, validate_helper_source_failure, validate_helper_source_open,
    validate_helper_source_snapshot,
};
use prctr_native_protocol::{
    InteractiveConsoleOwnership, InteractiveLockState, InteractiveRemoteAttachment,
    InteractiveSessionCertainty, InteractiveSessionCoverage, InteractiveSessionState,
    MAX_PROTOCOL_SAFE_INTEGER, ProcessApplicationCertainty, ProcessApplicationCoverage,
    ProcessApplicationState, ProtocolValidatable,
};
use prctr_native_security_helper::{
    HELPER_BUILD_ID, HelperTransportError, read_json_frame, write_json_frame,
};

#[cfg(target_os = "macos")]
#[allow(
    dead_code,
    reason = "selected only after the signed Endpoint Security connector can supply trusted candidate audit context"
)]
mod macos_process_source;

const SERVER_POLL_INTERVAL: Duration = Duration::from_millis(5);

pub(crate) trait HelperSourceFactory {
    fn capabilities(&self) -> &[HelperSourceKind];

    fn open(
        &mut self,
        request: &HelperSourceOpen,
        monotonic_time_ns: u64,
    ) -> Result<HelperSourceOpenOutcome, HelperTransportError>;
}

#[cfg_attr(not(test), allow(dead_code))]
pub(crate) enum HelperSourceOpenOutcome {
    Opened(OpenedHelperSource),
    Failed(HelperSourceFailure),
}

pub(crate) struct OpenedHelperSource {
    pub initial_snapshot: HelperSourceSnapshot,
    pub source: Box<dyn HelperSource>,
}

pub(crate) trait HelperSource {
    fn source_kind(&self) -> HelperSourceKind;
    fn schema_version(&self) -> u16;
    fn requires_polling(&self) -> bool {
        true
    }
    fn drain(&mut self) -> Result<Vec<HelperSourceEvent>, HelperTransportError>;
    fn close(
        &mut self,
        monotonic_time_ns: u64,
    ) -> Result<HelperSourceCloseOutput, HelperTransportError>;
}

#[cfg_attr(not(test), allow(dead_code))]
pub(crate) enum HelperSourceEvent {
    Observation(Box<HelperObservation>),
    Failure(HelperSourceFailure),
}

pub(crate) struct HelperSourceCloseOutput {
    pub events: Vec<HelperSourceEvent>,
    pub final_snapshot: HelperSourceSnapshot,
}

struct ActiveHelperSource {
    request: HelperSourceOpen,
    source: Box<dyn HelperSource>,
    last_sequence: u64,
    last_monotonic_time_ns: u64,
    failed: bool,
    wire_overflowed: bool,
}

pub(crate) struct HelperServer<F> {
    nonce: String,
    started: Instant,
    capabilities: Vec<HelperSourceKind>,
    factory: F,
    sources: BTreeMap<String, ActiveHelperSource>,
}

impl<F: HelperSourceFactory> HelperServer<F> {
    pub(crate) fn new(nonce: String, factory: F) -> Self {
        let capabilities = factory.capabilities().to_vec();
        Self {
            nonce,
            started: Instant::now(),
            capabilities,
            factory,
            sources: BTreeMap::new(),
        }
    }

    pub(crate) fn capabilities(&self) -> &[HelperSourceKind] {
        &self.capabilities
    }

    pub(crate) fn has_active_sources(&self) -> bool {
        !self.sources.is_empty()
    }

    pub(crate) fn has_pollable_sources(&self) -> bool {
        self.sources
            .values()
            .any(|source| !source.failed && source.source.requires_polling())
    }

    pub(crate) fn handle_message(
        &mut self,
        message: HelperClientMessage,
    ) -> Result<Vec<HelperServerMessage>, HelperTransportError> {
        message.validate_protocol()?;
        match message.kind {
            HelperClientMessageKind::Open => self.open_source(
                message
                    .open
                    .ok_or(prctr_native_helper_protocol::HelperProtocolError::Lifecycle)?,
            ),
            HelperClientMessageKind::Close => self.close_source(
                &message
                    .close
                    .ok_or(prctr_native_helper_protocol::HelperProtocolError::Lifecycle)?,
            ),
        }
    }

    pub(crate) fn drain_events(
        &mut self,
    ) -> Result<Vec<HelperServerMessage>, HelperTransportError> {
        let mut messages = Vec::new();
        let started = self.started;
        for active in self.sources.values_mut() {
            if active.failed || !active.source.requires_polling() {
                continue;
            }
            let events = active.source.drain()?;
            let drain_completed_time_ns = monotonic_time_ns_since(started);
            append_validated_events(active, events, drain_completed_time_ns, &mut messages)?;
        }
        Ok(messages)
    }

    fn open_source(
        &mut self,
        request: HelperSourceOpen,
    ) -> Result<Vec<HelperServerMessage>, HelperTransportError> {
        validate_helper_source_open(&request, &self.nonce)?;
        if self.sources.len() >= self.capabilities.len()
            || !self.capabilities.contains(&request.source_kind)
            || self
                .sources
                .contains_key(&request.helper_source_instance_id)
            || self
                .sources
                .values()
                .any(|source| source.request.source_kind == request.source_kind)
        {
            return Err(prctr_native_helper_protocol::HelperProtocolError::Lifecycle.into());
        }
        let open_request_time_ns = self.monotonic_time_ns();
        let outcome = self.factory.open(&request, open_request_time_ns);
        let open_completed_time_ns = self.monotonic_time_ns();
        match outcome? {
            HelperSourceOpenOutcome::Failed(failure) => {
                if matches!(
                    failure.failure_code,
                    HelperFailureCode::Cleanup | HelperFailureCode::Protocol
                ) {
                    return initial_failure_response(
                        &request,
                        failure.failure_code,
                        open_completed_time_ns,
                    );
                }
                validate_helper_source_failure(
                    &failure,
                    &self.nonce,
                    &request.helper_source_instance_id,
                    request.source_kind,
                )?;
                if failure.last_sequence != 0 {
                    return Err(prctr_native_helper_protocol::HelperProtocolError::Sequence.into());
                }
                let message = failure_message(failure);
                validate_outbound_message_size(&message)?;
                Ok(vec![message])
            }
            HelperSourceOpenOutcome::Opened(opened) => {
                let OpenedHelperSource {
                    initial_snapshot,
                    mut source,
                } = opened;
                if let Err(error) = validate_opened_source(
                    &initial_snapshot,
                    source.as_ref(),
                    &request,
                    &self.nonce,
                ) {
                    let cleanup_request_time_ns = self.monotonic_time_ns();
                    let rollback_failure = rollback_opened_source(
                        source.as_mut(),
                        request.queue_capacity,
                        cleanup_request_time_ns,
                    );
                    let cleanup_completed_time_ns = self.monotonic_time_ns();
                    if let Some(failure_code) = rollback_failure {
                        return initial_failure_response(
                            &request,
                            failure_code,
                            cleanup_completed_time_ns,
                        );
                    }
                    if matches!(
                        &error,
                        HelperTransportError::Protocol(HelperProtocolError::FrameSize)
                    ) {
                        return initial_failure_response(
                            &request,
                            HelperFailureCode::InventoryOverflow,
                            cleanup_completed_time_ns,
                        );
                    }
                    return Err(error);
                }
                let last_monotonic_time_ns = initial_snapshot.monotonic_time_ns;
                self.sources.insert(
                    request.helper_source_instance_id.clone(),
                    ActiveHelperSource {
                        request,
                        source,
                        last_sequence: 0,
                        last_monotonic_time_ns,
                        failed: false,
                        wire_overflowed: false,
                    },
                );
                Ok(vec![snapshot_message(initial_snapshot)])
            }
        }
    }

    fn close_source(
        &mut self,
        request: &prctr_native_helper_protocol::HelperSourceClose,
    ) -> Result<Vec<HelperServerMessage>, HelperTransportError> {
        validate_helper_source_close(request, &self.nonce)?;
        let close_request_time_ns = self.monotonic_time_ns();
        let started = self.started;
        let active = self
            .sources
            .get_mut(&request.helper_source_instance_id)
            .ok_or(prctr_native_helper_protocol::HelperProtocolError::Lifecycle)?;
        let mut messages = Vec::new();
        let closed = match active.source.close(close_request_time_ns) {
            Ok(closed) => closed,
            Err(_error) => {
                let close_completed_time_ns = monotonic_time_ns_since(started);
                append_terminal_failure(
                    active,
                    HelperFailureCode::Cleanup,
                    close_completed_time_ns,
                    &mut messages,
                )?;
                self.sources.remove(&request.helper_source_instance_id);
                return Ok(messages);
            }
        };
        let close_completed_time_ns = monotonic_time_ns_since(started);
        if !source_batch_length_is_bounded(active.request.queue_capacity, &closed.events) {
            return Err(HelperProtocolError::Lifecycle.into());
        }
        if let Some(failure_code) = fatal_failure_code_in_events(&closed.events) {
            append_terminal_failure(active, failure_code, close_completed_time_ns, &mut messages)?;
            self.sources.remove(&request.helper_source_instance_id);
            return Ok(messages);
        }
        if !active.wire_overflowed {
            append_validated_events(
                active,
                closed.events,
                close_completed_time_ns,
                &mut messages,
            )?;
        }
        if active.wire_overflowed {
            let snapshot = terminal_unavailable_snapshot(
                &active.request,
                active.last_sequence,
                close_completed_time_ns.max(active.last_monotonic_time_ns),
            );
            let message = snapshot_message(snapshot);
            message.validate_protocol()?;
            validate_outbound_message_size(&message)?;
            messages.push(message);
            self.sources.remove(&request.helper_source_instance_id);
            return Ok(messages);
        }
        validate_helper_source_snapshot(
            &closed.final_snapshot,
            &self.nonce,
            &active.request.helper_source_instance_id,
            active.request.source_kind,
            active.request.schema_version,
        )?;
        if closed.final_snapshot.last_sequence != active.last_sequence
            || closed.final_snapshot.monotonic_time_ns < active.last_monotonic_time_ns
        {
            return Err(prctr_native_helper_protocol::HelperProtocolError::Sequence.into());
        }
        let final_message = snapshot_message(closed.final_snapshot);
        match validate_outbound_message_size(&final_message) {
            Ok(()) => messages.push(final_message),
            Err(error) if is_frame_size_error(&error) => {
                if !active.failed {
                    append_terminal_failure(
                        active,
                        HelperFailureCode::InventoryOverflow,
                        final_message
                            .snapshot
                            .as_ref()
                            .map_or(close_completed_time_ns, |snapshot| {
                                close_completed_time_ns.max(snapshot.monotonic_time_ns)
                            }),
                        &mut messages,
                    )?;
                }
                let snapshot = terminal_unavailable_snapshot(
                    &active.request,
                    active.last_sequence,
                    active.last_monotonic_time_ns,
                );
                let message = snapshot_message(snapshot);
                message.validate_protocol()?;
                validate_outbound_message_size(&message)?;
                messages.push(message);
            }
            Err(error) => return Err(error),
        }
        self.sources.remove(&request.helper_source_instance_id);
        Ok(messages)
    }

    fn monotonic_time_ns(&self) -> u64 {
        monotonic_time_ns_since(self.started)
    }
}

fn monotonic_time_ns_since(started: Instant) -> u64 {
    u64::try_from(started.elapsed().as_nanos())
        .unwrap_or(MAX_PROTOCOL_SAFE_INTEGER)
        .min(MAX_PROTOCOL_SAFE_INTEGER)
}

fn validate_opened_source(
    initial_snapshot: &HelperSourceSnapshot,
    source: &dyn HelperSource,
    request: &HelperSourceOpen,
    nonce: &str,
) -> Result<(), HelperTransportError> {
    if source.source_kind() != request.source_kind
        || source.schema_version() != request.schema_version
    {
        return Err(HelperProtocolError::Lifecycle.into());
    }
    validate_helper_source_snapshot(
        initial_snapshot,
        nonce,
        &request.helper_source_instance_id,
        request.source_kind,
        request.schema_version,
    )?;
    if initial_snapshot.last_sequence != 0 {
        return Err(HelperProtocolError::Sequence.into());
    }
    validate_outbound_message_size(&snapshot_message(initial_snapshot.clone()))
}

fn validate_outbound_message_size(
    message: &HelperServerMessage,
) -> Result<(), HelperTransportError> {
    let bytes = serde_json::to_vec(message)?;
    validate_helper_frame_size(bytes.len())?;
    Ok(())
}

fn is_frame_size_error(error: &HelperTransportError) -> bool {
    matches!(
        error,
        HelperTransportError::Protocol(HelperProtocolError::FrameSize)
    )
}

fn initial_failure_response(
    request: &HelperSourceOpen,
    failure_code: HelperFailureCode,
    monotonic_time_ns: u64,
) -> Result<Vec<HelperServerMessage>, HelperTransportError> {
    let message = failure_message(HelperSourceFailure {
        protocol_version: HELPER_PROTOCOL_VERSION,
        channel_nonce: request.channel_nonce.clone(),
        helper_source_instance_id: request.helper_source_instance_id.clone(),
        source_kind: request.source_kind,
        failure_code,
        last_sequence: 0,
        lost_event_count: None,
        monotonic_time_ns,
    });
    message.validate_protocol()?;
    validate_outbound_message_size(&message)?;
    Ok(vec![message])
}

fn rollback_opened_source(
    source: &mut dyn HelperSource,
    queue_capacity: u16,
    monotonic_time_ns: u64,
) -> Option<HelperFailureCode> {
    let closed = match source.close(monotonic_time_ns) {
        Ok(closed) => closed,
        Err(_error) => return Some(HelperFailureCode::Cleanup),
    };
    if !source_batch_length_is_bounded(queue_capacity, &closed.events) {
        return Some(HelperFailureCode::Protocol);
    }
    fatal_failure_code_in_events(&closed.events)
}

fn append_validated_events(
    active: &mut ActiveHelperSource,
    events: Vec<HelperSourceEvent>,
    trusted_monotonic_time_ns: u64,
    messages: &mut Vec<HelperServerMessage>,
) -> Result<(), HelperTransportError> {
    if !source_batch_length_is_bounded(active.request.queue_capacity, &events) {
        return Err(HelperProtocolError::Lifecycle.into());
    }
    if let Some(failure_code) = fatal_failure_code_in_events(&events) {
        append_terminal_failure(active, failure_code, trusted_monotonic_time_ns, messages)?;
        return Ok(());
    }
    let observation_count = events
        .iter()
        .filter(|event| matches!(event, HelperSourceEvent::Observation(_)))
        .count();
    let failure_count = events
        .iter()
        .filter(|event| matches!(event, HelperSourceEvent::Failure(_)))
        .count();
    if observation_count > usize::from(active.request.queue_capacity) || failure_count > 1 {
        return Err(HelperProtocolError::Lifecycle.into());
    }
    for event in events {
        match event {
            HelperSourceEvent::Observation(observation) => {
                if active.failed {
                    return Err(prctr_native_helper_protocol::HelperProtocolError::Lifecycle.into());
                }
                validate_helper_observation(
                    &observation,
                    &active.request.channel_nonce,
                    &active.request.helper_source_instance_id,
                    active.request.source_kind,
                )?;
                let expected_sequence = active
                    .last_sequence
                    .checked_add(1)
                    .ok_or(HelperProtocolError::Sequence)?;
                if observation.sequence != expected_sequence
                    || observation.monotonic_time_ns < active.last_monotonic_time_ns
                {
                    return Err(prctr_native_helper_protocol::HelperProtocolError::Sequence.into());
                }
                let message = observation_message((*observation).clone());
                match validate_outbound_message_size(&message) {
                    Ok(()) => {}
                    Err(error) if is_frame_size_error(&error) => {
                        append_terminal_failure(
                            active,
                            HelperFailureCode::InventoryOverflow,
                            observation.monotonic_time_ns,
                            messages,
                        )?;
                        active.wire_overflowed = true;
                        return Ok(());
                    }
                    Err(error) => return Err(error),
                }
                active.last_sequence = observation.sequence;
                active.last_monotonic_time_ns = observation.monotonic_time_ns;
                messages.push(message);
            }
            HelperSourceEvent::Failure(failure) => {
                if active.failed {
                    return Err(prctr_native_helper_protocol::HelperProtocolError::Lifecycle.into());
                }
                validate_helper_source_failure(
                    &failure,
                    &active.request.channel_nonce,
                    &active.request.helper_source_instance_id,
                    active.request.source_kind,
                )?;
                if failure.last_sequence != active.last_sequence
                    || failure.monotonic_time_ns < active.last_monotonic_time_ns
                {
                    return Err(prctr_native_helper_protocol::HelperProtocolError::Sequence.into());
                }
                active.last_monotonic_time_ns = failure.monotonic_time_ns;
                active.failed = true;
                let message = failure_message(failure);
                validate_outbound_message_size(&message)?;
                messages.push(message);
            }
        }
    }
    Ok(())
}

fn source_batch_length_is_bounded(queue_capacity: u16, events: &[HelperSourceEvent]) -> bool {
    events.len() <= usize::from(queue_capacity).saturating_add(1)
}

fn fatal_failure_code_in_events(events: &[HelperSourceEvent]) -> Option<HelperFailureCode> {
    if events.iter().any(|event| {
        matches!(
            event,
            HelperSourceEvent::Failure(HelperSourceFailure {
                failure_code: HelperFailureCode::Cleanup,
                ..
            })
        )
    }) {
        Some(HelperFailureCode::Cleanup)
    } else if events.iter().any(|event| {
        matches!(
            event,
            HelperSourceEvent::Failure(HelperSourceFailure {
                failure_code: HelperFailureCode::Protocol,
                ..
            })
        )
    }) {
        Some(HelperFailureCode::Protocol)
    } else {
        None
    }
}

fn append_terminal_failure(
    active: &mut ActiveHelperSource,
    failure_code: HelperFailureCode,
    monotonic_time_ns: u64,
    messages: &mut Vec<HelperServerMessage>,
) -> Result<(), HelperTransportError> {
    let failure = HelperSourceFailure {
        protocol_version: HELPER_PROTOCOL_VERSION,
        channel_nonce: active.request.channel_nonce.clone(),
        helper_source_instance_id: active.request.helper_source_instance_id.clone(),
        source_kind: active.request.source_kind,
        failure_code,
        last_sequence: active.last_sequence,
        lost_event_count: None,
        monotonic_time_ns: monotonic_time_ns.max(active.last_monotonic_time_ns),
    };
    validate_helper_source_failure(
        &failure,
        &active.request.channel_nonce,
        &active.request.helper_source_instance_id,
        active.request.source_kind,
    )?;
    let message = failure_message(failure);
    validate_outbound_message_size(&message)?;
    active.last_monotonic_time_ns = monotonic_time_ns.max(active.last_monotonic_time_ns);
    active.failed = true;
    messages.push(message);
    Ok(())
}

enum ClientReaderEvent {
    Message(HelperClientMessage),
    Error(HelperTransportError),
}

pub(crate) fn run_helper_server<R, W, F>(
    mut input: R,
    mut output: W,
    kind: HelperKind,
    factory: F,
) -> Result<(), HelperTransportError>
where
    R: Read + Send + 'static,
    W: Write,
    F: HelperSourceFactory,
{
    let nonce = String::from_utf8(prctr_native_security_helper::read_frame(&mut input)?).map_err(
        |_error| {
            HelperTransportError::Protocol(
                prctr_native_helper_protocol::HelperProtocolError::ChannelNonce,
            )
        },
    )?;
    let mut server = HelperServer::new(nonce.clone(), factory);
    let handshake = HelperHandshake {
        protocol_version: HELPER_PROTOCOL_VERSION,
        channel_nonce: nonce,
        helper_kind: kind,
        helper_build_id: HELPER_BUILD_ID.to_owned(),
        capabilities: server.capabilities().to_vec(),
    };
    handshake.validate_protocol()?;
    write_json_frame(&mut output, &handshake)?;

    let (sender, receiver) = mpsc::sync_channel(2);
    let reader = thread::Builder::new()
        .name("prctr-helper-client-reader".to_owned())
        .spawn(move || {
            loop {
                let event = match read_json_frame(&mut input) {
                    Ok(message) => ClientReaderEvent::Message(message),
                    Err(error) => ClientReaderEvent::Error(error),
                };
                let terminal = matches!(event, ClientReaderEvent::Error(_));
                if sender.send(event).is_err() || terminal {
                    break;
                }
            }
        })?;

    loop {
        let event = if server.has_pollable_sources() {
            match receiver.recv_timeout(SERVER_POLL_INTERVAL) {
                Ok(event) => Some(event),
                Err(mpsc::RecvTimeoutError::Timeout) => None,
                Err(mpsc::RecvTimeoutError::Disconnected) => {
                    return Err(HelperTransportError::ConnectionFenced);
                }
            }
        } else {
            Some(
                receiver
                    .recv()
                    .map_err(|_error| HelperTransportError::ConnectionFenced)?,
            )
        };
        match event {
            Some(ClientReaderEvent::Message(message)) => {
                write_messages(&mut output, server.handle_message(message)?)?;
            }
            Some(ClientReaderEvent::Error(HelperTransportError::Io(error)))
                if error.kind() == io::ErrorKind::UnexpectedEof && !server.has_active_sources() =>
            {
                reader
                    .join()
                    .map_err(|_panic_payload| HelperTransportError::ConnectionFenced)?;
                return Ok(());
            }
            Some(ClientReaderEvent::Error(error)) => return Err(error),
            None => {}
        }
        if server.has_pollable_sources() {
            write_messages(&mut output, server.drain_events()?)?;
        }
    }
}

fn write_messages(
    output: &mut impl Write,
    messages: Vec<HelperServerMessage>,
) -> Result<(), HelperTransportError> {
    for message in messages {
        message.validate_protocol()?;
        write_json_frame(output, &message)?;
    }
    Ok(())
}

const fn snapshot_message(snapshot: HelperSourceSnapshot) -> HelperServerMessage {
    HelperServerMessage {
        kind: HelperServerMessageKind::Snapshot,
        snapshot: Some(snapshot),
        observation: None,
        failure: None,
    }
}

const fn observation_message(observation: HelperObservation) -> HelperServerMessage {
    HelperServerMessage {
        kind: HelperServerMessageKind::Observation,
        snapshot: None,
        observation: Some(observation),
        failure: None,
    }
}

const fn failure_message(failure: HelperSourceFailure) -> HelperServerMessage {
    HelperServerMessage {
        kind: HelperServerMessageKind::Failure,
        snapshot: None,
        observation: None,
        failure: Some(failure),
    }
}

pub(crate) struct PlatformHelperSourceFactory {
    capabilities: [HelperSourceKind; 2],
}

impl PlatformHelperSourceFactory {
    pub(crate) const fn new() -> Self {
        Self {
            capabilities: [
                HelperSourceKind::ProcessApplication,
                HelperSourceKind::InteractiveSession,
            ],
        }
    }
}

impl HelperSourceFactory for PlatformHelperSourceFactory {
    fn capabilities(&self) -> &[HelperSourceKind] {
        &self.capabilities
    }

    fn open(
        &mut self,
        request: &HelperSourceOpen,
        monotonic_time_ns: u64,
    ) -> Result<HelperSourceOpenOutcome, HelperTransportError> {
        Ok(HelperSourceOpenOutcome::Opened(OpenedHelperSource {
            initial_snapshot: unavailable_snapshot(request, monotonic_time_ns),
            source: Box::new(UnavailableHelperSource {
                request: request.clone(),
                last_monotonic_time_ns: monotonic_time_ns,
            }),
        }))
    }
}

struct UnavailableHelperSource {
    request: HelperSourceOpen,
    last_monotonic_time_ns: u64,
}

impl HelperSource for UnavailableHelperSource {
    fn source_kind(&self) -> HelperSourceKind {
        self.request.source_kind
    }

    fn schema_version(&self) -> u16 {
        self.request.schema_version
    }

    fn requires_polling(&self) -> bool {
        false
    }

    fn drain(&mut self) -> Result<Vec<HelperSourceEvent>, HelperTransportError> {
        Ok(Vec::new())
    }

    fn close(
        &mut self,
        monotonic_time_ns: u64,
    ) -> Result<HelperSourceCloseOutput, HelperTransportError> {
        self.last_monotonic_time_ns = self.last_monotonic_time_ns.max(monotonic_time_ns);
        Ok(HelperSourceCloseOutput {
            events: Vec::new(),
            final_snapshot: unavailable_snapshot(&self.request, self.last_monotonic_time_ns),
        })
    }
}

fn unavailable_snapshot(
    request: &HelperSourceOpen,
    monotonic_time_ns: u64,
) -> HelperSourceSnapshot {
    HelperSourceSnapshot {
        protocol_version: HELPER_PROTOCOL_VERSION,
        channel_nonce: request.channel_nonce.clone(),
        helper_source_instance_id: request.helper_source_instance_id.clone(),
        source_kind: request.source_kind,
        schema_version: request.schema_version,
        last_sequence: 0,
        monotonic_time_ns,
        process_state: matches!(request.source_kind, HelperSourceKind::ProcessApplication).then(
            || ProcessApplicationState {
                coverage: ProcessApplicationCoverage::Unavailable,
                certainty: ProcessApplicationCertainty::Unknown,
                processes: Vec::new(),
            },
        ),
        interactive_session_state: matches!(
            request.source_kind,
            HelperSourceKind::InteractiveSession
        )
        .then(|| InteractiveSessionState {
            coverage: InteractiveSessionCoverage::Unavailable,
            certainty: InteractiveSessionCertainty::Unknown,
            console_ownership: InteractiveConsoleOwnership::Unknown,
            lock_state: InteractiveLockState::Unknown,
            remote_attachment: InteractiveRemoteAttachment::Unknown,
            other_human_session_count: 0,
        }),
    }
}

fn terminal_unavailable_snapshot(
    request: &HelperSourceOpen,
    last_sequence: u64,
    monotonic_time_ns: u64,
) -> HelperSourceSnapshot {
    let mut snapshot = unavailable_snapshot(request, monotonic_time_ns);
    snapshot.last_sequence = last_sequence;
    snapshot
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::thread;
    use std::time::Duration;

    use super::*;
    use prctr_native_helper_protocol::{
        HelperEventClass, HelperFailureCode, HelperSourceClose, MAX_HELPER_FRAME_BYTES,
    };
    use prctr_native_protocol::{
        INTERACTIVE_SESSION_SCHEMA_VERSION, PROCESS_APPLICATION_SCHEMA_VERSION,
        ProcessApplicationEvent, ProcessApplicationEventKind, ProcessApplicationProcess,
        ProcessApplicationScope, ProcessExecutableIdentity, ProcessExecutableIdentityStatus,
    };

    const NONCE: &str = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
    const DELAYED_SOURCE_OPERATION: Duration = Duration::from_millis(10);

    #[test]
    fn unavailable_factory_preserves_snapshot_then_close_order() {
        let mut server = HelperServer::new(NONCE.to_owned(), PlatformHelperSourceFactory::new());
        let request = process_request();
        let opened = server
            .handle_message(open_message(request.clone()))
            .expect("source opens");
        assert!(matches!(
            opened.as_slice(),
            [HelperServerMessage {
                kind: HelperServerMessageKind::Snapshot,
                ..
            }]
        ));
        assert!(!server.has_pollable_sources());
        assert!(server.drain_events().expect("drain").is_empty());
        let closed = server
            .handle_message(close_message(&request))
            .expect("source closes");
        assert!(matches!(
            closed.as_slice(),
            [HelperServerMessage {
                kind: HelperServerMessageKind::Snapshot,
                ..
            }]
        ));
        assert!(!server.has_active_sources());
    }

    #[test]
    fn fatal_open_failure_uses_a_post_factory_timestamp() {
        let mut server = HelperServer::new(
            NONCE.to_owned(),
            DelayedFailureFactory {
                capabilities: [HelperSourceKind::ProcessApplication],
                stage: DelayedFailureStage::Open,
            },
        );
        let before = server.monotonic_time_ns();
        let messages = server
            .handle_message(open_message(process_request()))
            .expect("fatal failure is normalized");
        assert_failure_after_delayed_operation(&messages, before);
    }

    #[test]
    fn fatal_drain_failure_uses_a_post_source_timestamp() {
        let request = process_request();
        let mut server = HelperServer::new(
            NONCE.to_owned(),
            DelayedFailureFactory {
                capabilities: [HelperSourceKind::ProcessApplication],
                stage: DelayedFailureStage::Drain,
            },
        );
        server
            .handle_message(open_message(request))
            .expect("source opens");
        let before = server.monotonic_time_ns();
        let messages = server.drain_events().expect("fatal failure is normalized");
        assert_failure_after_delayed_operation(&messages, before);
    }

    #[test]
    fn close_error_uses_a_post_source_timestamp() {
        let request = process_request();
        let mut server = HelperServer::new(
            NONCE.to_owned(),
            DelayedFailureFactory {
                capabilities: [HelperSourceKind::ProcessApplication],
                stage: DelayedFailureStage::Close,
            },
        );
        server
            .handle_message(open_message(request.clone()))
            .expect("source opens");
        let before = server.monotonic_time_ns();
        let messages = server
            .handle_message(close_message(&request))
            .expect("close error is normalized");
        assert_failure_after_delayed_operation(&messages, before);
    }

    #[test]
    fn factory_failure_is_a_typed_sequence_zero_message_without_active_state() {
        let failure = HelperSourceFailure {
            protocol_version: HELPER_PROTOCOL_VERSION,
            channel_nonce: NONCE.to_owned(),
            helper_source_instance_id: "process-source-0001".to_owned(),
            source_kind: HelperSourceKind::ProcessApplication,
            failure_code: HelperFailureCode::InventoryOverflow,
            last_sequence: 0,
            lost_event_count: None,
            monotonic_time_ns: 1,
        };
        let mut server = HelperServer::new(
            NONCE.to_owned(),
            FailingFactory {
                failure: failure.clone(),
                capabilities: [HelperSourceKind::ProcessApplication],
            },
        );
        let messages = server
            .handle_message(open_message(process_request()))
            .expect("failure is delivered");
        assert!(matches!(
            messages.as_slice(),
            [HelperServerMessage { kind: HelperServerMessageKind::Failure, failure: Some(value), .. }] if value == &failure
        ));
        assert!(!server.has_active_sources());
    }

    #[test]
    fn fatal_factory_failure_is_normalized_from_server_owned_open_context() {
        let mut server = HelperServer::new(
            NONCE.to_owned(),
            FailingFactory {
                failure: HelperSourceFailure {
                    protocol_version: 0,
                    channel_nonce: "malformed".to_owned(),
                    helper_source_instance_id: "wrong-source-id-0001".to_owned(),
                    source_kind: HelperSourceKind::InteractiveSession,
                    failure_code: HelperFailureCode::Cleanup,
                    last_sequence: MAX_PROTOCOL_SAFE_INTEGER + 1,
                    lost_event_count: Some(1),
                    monotonic_time_ns: MAX_PROTOCOL_SAFE_INTEGER + 1,
                },
                capabilities: [HelperSourceKind::ProcessApplication],
            },
        );
        let messages = server
            .handle_message(open_message(process_request()))
            .expect("fatal failure is normalized");
        assert!(matches!(
            messages.as_slice(),
            [HelperServerMessage {
                kind: HelperServerMessageKind::Failure,
                failure: Some(HelperSourceFailure {
                    protocol_version: HELPER_PROTOCOL_VERSION,
                    channel_nonce,
                    helper_source_instance_id,
                    source_kind: HelperSourceKind::ProcessApplication,
                    failure_code: HelperFailureCode::Cleanup,
                    last_sequence: 0,
                    lost_event_count: None,
                    monotonic_time_ns,
                }),
                ..
            }] if channel_nonce == NONCE
                && helper_source_instance_id == "process-source-0001"
                && *monotonic_time_ns <= MAX_PROTOCOL_SAFE_INTEGER
        ));
        assert!(!server.has_active_sources());
    }

    #[test]
    fn buffered_transition_is_released_only_after_snapshot_zero() {
        let request = process_request();
        let state = unavailable_snapshot(&request, 1)
            .process_state
            .expect("process state");
        let observation = HelperObservation {
            protocol_version: HELPER_PROTOCOL_VERSION,
            channel_nonce: NONCE.to_owned(),
            helper_source_instance_id: request.helper_source_instance_id.clone(),
            source_kind: HelperSourceKind::ProcessApplication,
            sequence: 1,
            monotonic_time_ns: 2,
            process_event: Some(ProcessApplicationEvent {
                kind: ProcessApplicationEventKind::Reconciled,
                process_instance_id: None,
                process: None,
                state: Some(state),
            }),
            interactive_session_event: None,
        };
        let mut server = HelperServer::new(
            NONCE.to_owned(),
            EventFactory {
                capabilities: [HelperSourceKind::ProcessApplication],
                observation: observation.clone(),
            },
        );
        let opened = server
            .handle_message(open_message(request))
            .expect("source opens");
        assert_eq!(opened[0].kind, HelperServerMessageKind::Snapshot);
        let events = server.drain_events().expect("event drain");
        assert!(matches!(
            events.as_slice(),
            [HelperServerMessage { kind: HelperServerMessageKind::Observation, observation: Some(value), .. }] if value == &observation
        ));
    }

    #[test]
    fn active_source_failure_is_terminal_and_preserves_the_last_sequence() {
        let request = process_request();
        let drain_count = Arc::new(AtomicUsize::new(0));
        let failure = HelperSourceFailure {
            protocol_version: HELPER_PROTOCOL_VERSION,
            channel_nonce: NONCE.to_owned(),
            helper_source_instance_id: request.helper_source_instance_id.clone(),
            source_kind: HelperSourceKind::ProcessApplication,
            failure_code: HelperFailureCode::Backend,
            last_sequence: 0,
            lost_event_count: None,
            monotonic_time_ns: 2,
        };
        let mut server = HelperServer::new(
            NONCE.to_owned(),
            SourceFailureFactory {
                capabilities: [HelperSourceKind::ProcessApplication],
                failure: failure.clone(),
                drain_count: Arc::clone(&drain_count),
            },
        );
        let opened = server
            .handle_message(open_message(request))
            .expect("source opens");
        assert_eq!(opened[0].kind, HelperServerMessageKind::Snapshot);
        let events = server.drain_events().expect("failure drain");
        assert!(matches!(
            events.as_slice(),
            [HelperServerMessage { kind: HelperServerMessageKind::Failure, failure: Some(value), .. }] if value == &failure
        ));
        assert!(server.drain_events().expect("terminal drain").is_empty());
        assert_eq!(drain_count.load(Ordering::SeqCst), 1);
    }

    #[test]
    fn oversized_initial_inventory_rolls_back_and_reports_typed_failure() {
        let close_count = Arc::new(AtomicUsize::new(0));
        let mut server = HelperServer::new(
            NONCE.to_owned(),
            OversizedFactory {
                capabilities: [HelperSourceKind::ProcessApplication],
                close_count: Arc::clone(&close_count),
            },
        );
        let request = process_request();
        let messages = server
            .handle_message(open_message(request))
            .expect("oversized inventory is classified");
        assert!(matches!(
            messages.as_slice(),
            [HelperServerMessage {
                kind: HelperServerMessageKind::Failure,
                failure: Some(HelperSourceFailure {
                    failure_code: HelperFailureCode::InventoryOverflow,
                    last_sequence: 0,
                    ..
                }),
                ..
            }]
        ));
        assert_eq!(close_count.load(Ordering::SeqCst), 1);
        assert!(!server.has_active_sources());
    }

    #[test]
    fn failed_open_rollback_is_reported_as_cleanup_failure() {
        let mut server = HelperServer::new(
            NONCE.to_owned(),
            RollbackFailureFactory {
                capabilities: [HelperSourceKind::ProcessApplication],
            },
        );
        let messages = server
            .handle_message(open_message(process_request()))
            .expect("cleanup failure is delivered to the broker");
        assert!(matches!(
            messages.as_slice(),
            [HelperServerMessage {
                kind: HelperServerMessageKind::Failure,
                failure: Some(HelperSourceFailure {
                    failure_code: HelperFailureCode::Cleanup,
                    last_sequence: 0,
                    ..
                }),
                ..
            }]
        ));
        assert!(!server.has_active_sources());
    }

    #[test]
    fn source_batch_reserves_one_terminal_failure_beyond_ingress_capacity() {
        let request = process_request_with_capacity(2);
        let events = vec![
            process_observation(&request, 1, 2),
            process_observation(&request, 2, 3),
            HelperSourceEvent::Failure(HelperSourceFailure {
                protocol_version: HELPER_PROTOCOL_VERSION,
                channel_nonce: NONCE.to_owned(),
                helper_source_instance_id: request.helper_source_instance_id.clone(),
                source_kind: request.source_kind,
                failure_code: HelperFailureCode::QueueOverflow,
                last_sequence: 2,
                lost_event_count: Some(1),
                monotonic_time_ns: 4,
            }),
        ];
        let mut server = HelperServer::new(
            NONCE.to_owned(),
            BatchFactory {
                capabilities: [HelperSourceKind::ProcessApplication],
                events: Some(events),
                close_events: None,
            },
        );
        server
            .handle_message(open_message(request))
            .expect("source opens");
        let messages = server.drain_events().expect("bounded batch drains");
        assert_eq!(messages.len(), 3);
        assert_eq!(messages[2].kind, HelperServerMessageKind::Failure);
    }

    #[test]
    fn source_batch_rejects_more_observations_than_ingress_capacity() {
        let request = process_request_with_capacity(2);
        let events = vec![
            process_observation(&request, 1, 2),
            process_observation(&request, 2, 3),
            process_observation(&request, 3, 4),
        ];
        let mut server = HelperServer::new(
            NONCE.to_owned(),
            BatchFactory {
                capabilities: [HelperSourceKind::ProcessApplication],
                events: Some(events),
                close_events: None,
            },
        );
        server
            .handle_message(open_message(request))
            .expect("source opens");
        assert!(matches!(
            server.drain_events(),
            Err(HelperTransportError::Protocol(
                HelperProtocolError::Lifecycle
            ))
        ));
    }

    #[test]
    fn oversized_fatal_drain_batch_is_rejected_before_failure_inspection() {
        let request = process_request_with_capacity(2);
        let cleanup = HelperSourceEvent::Failure(HelperSourceFailure {
            protocol_version: HELPER_PROTOCOL_VERSION,
            channel_nonce: request.channel_nonce.clone(),
            helper_source_instance_id: request.helper_source_instance_id.clone(),
            source_kind: request.source_kind,
            failure_code: HelperFailureCode::Cleanup,
            last_sequence: 3,
            lost_event_count: None,
            monotonic_time_ns: 5,
        });
        let mut server = HelperServer::new(
            NONCE.to_owned(),
            BatchFactory {
                capabilities: [HelperSourceKind::ProcessApplication],
                events: Some(vec![
                    process_observation(&request, 1, 2),
                    process_observation(&request, 2, 3),
                    process_observation(&request, 3, 4),
                    cleanup,
                ]),
                close_events: None,
            },
        );
        server
            .handle_message(open_message(request))
            .expect("source opens");
        assert!(matches!(
            server.drain_events(),
            Err(HelperTransportError::Protocol(
                HelperProtocolError::Lifecycle
            ))
        ));
    }

    #[test]
    fn oversized_fatal_close_batch_is_rejected_before_failure_inspection() {
        let request = process_request_with_capacity(2);
        let cleanup = HelperSourceEvent::Failure(HelperSourceFailure {
            protocol_version: HELPER_PROTOCOL_VERSION,
            channel_nonce: request.channel_nonce.clone(),
            helper_source_instance_id: request.helper_source_instance_id.clone(),
            source_kind: request.source_kind,
            failure_code: HelperFailureCode::Cleanup,
            last_sequence: 3,
            lost_event_count: None,
            monotonic_time_ns: 5,
        });
        let mut server = HelperServer::new(
            NONCE.to_owned(),
            BatchFactory {
                capabilities: [HelperSourceKind::ProcessApplication],
                events: None,
                close_events: Some(vec![
                    process_observation(&request, 1, 2),
                    process_observation(&request, 2, 3),
                    process_observation(&request, 3, 4),
                    cleanup,
                ]),
            },
        );
        server
            .handle_message(open_message(request.clone()))
            .expect("source opens");
        assert!(matches!(
            server.handle_message(close_message(&request)),
            Err(HelperTransportError::Protocol(
                HelperProtocolError::Lifecycle
            ))
        ));
    }

    #[test]
    fn oversized_fatal_rollback_batch_is_protocol_not_cleanup() {
        let request = process_request_with_capacity(2);
        let cleanup = HelperSourceEvent::Failure(HelperSourceFailure {
            protocol_version: HELPER_PROTOCOL_VERSION,
            channel_nonce: request.channel_nonce.clone(),
            helper_source_instance_id: request.helper_source_instance_id.clone(),
            source_kind: request.source_kind,
            failure_code: HelperFailureCode::Cleanup,
            last_sequence: 3,
            lost_event_count: None,
            monotonic_time_ns: 5,
        });
        let mut source = BatchSource {
            request: request.clone(),
            events: vec![
                process_observation(&request, 1, 2),
                process_observation(&request, 2, 3),
                process_observation(&request, 3, 4),
            ],
            close_events: vec![cleanup],
        };
        assert_eq!(
            rollback_opened_source(&mut source, request.queue_capacity, 5),
            Some(HelperFailureCode::Protocol)
        );
    }

    #[test]
    fn oversized_live_observation_becomes_one_failure_and_frame_safe_close() {
        let request = process_request_with_capacity(2);
        let event = HelperSourceEvent::Observation(Box::new(HelperObservation {
            protocol_version: HELPER_PROTOCOL_VERSION,
            channel_nonce: request.channel_nonce.clone(),
            helper_source_instance_id: request.helper_source_instance_id.clone(),
            source_kind: request.source_kind,
            sequence: 1,
            monotonic_time_ns: 2,
            process_event: Some(ProcessApplicationEvent {
                kind: ProcessApplicationEventKind::Reconciled,
                process_instance_id: None,
                process: None,
                state: Some(oversized_process_state()),
            }),
            interactive_session_event: None,
        }));
        let mut server = HelperServer::new(
            NONCE.to_owned(),
            BatchFactory {
                capabilities: [HelperSourceKind::ProcessApplication],
                events: Some(vec![event]),
                close_events: None,
            },
        );
        server
            .handle_message(open_message(request.clone()))
            .expect("source opens");
        let messages = server.drain_events().expect("overflow is classified");
        assert!(matches!(
            messages.as_slice(),
            [HelperServerMessage {
                kind: HelperServerMessageKind::Failure,
                failure: Some(HelperSourceFailure {
                    failure_code: HelperFailureCode::InventoryOverflow,
                    last_sequence: 0,
                    ..
                }),
                ..
            }]
        ));
        assert!(
            server
                .drain_events()
                .expect("failed source is idle")
                .is_empty()
        );
        let closed = server
            .handle_message(close_message(&request))
            .expect("failed source closes");
        assert!(matches!(
            closed.as_slice(),
            [HelperServerMessage {
                kind: HelperServerMessageKind::Snapshot,
                snapshot: Some(HelperSourceSnapshot {
                    process_state: Some(ProcessApplicationState {
                        coverage: ProcessApplicationCoverage::Unavailable,
                        ..
                    }),
                    last_sequence: 0,
                    ..
                }),
                ..
            }]
        ));
    }

    #[test]
    fn oversized_final_snapshot_becomes_failure_then_frame_safe_snapshot() {
        let request = process_request();
        let mut server = HelperServer::new(
            NONCE.to_owned(),
            FinalOversizedFactory {
                capabilities: [HelperSourceKind::ProcessApplication],
            },
        );
        server
            .handle_message(open_message(request.clone()))
            .expect("source opens");
        let closed = server
            .handle_message(close_message(&request))
            .expect("oversized final state is classified");
        assert!(matches!(
            closed.as_slice(),
            [
                HelperServerMessage {
                    kind: HelperServerMessageKind::Failure,
                    failure: Some(HelperSourceFailure {
                        failure_code: HelperFailureCode::InventoryOverflow,
                        last_sequence: 0,
                        ..
                    }),
                    ..
                },
                HelperServerMessage {
                    kind: HelperServerMessageKind::Snapshot,
                    snapshot: Some(HelperSourceSnapshot {
                        process_state: Some(ProcessApplicationState {
                            coverage: ProcessApplicationCoverage::Unavailable,
                            ..
                        }),
                        last_sequence: 0,
                        ..
                    }),
                    ..
                }
            ]
        ));
    }

    #[test]
    fn fatal_failure_after_oversized_observation_is_not_masked() {
        let request = process_request_with_capacity(2);
        let oversized = oversized_process_observation(&request, 1, 2);
        let cleanup = HelperSourceEvent::Failure(HelperSourceFailure {
            protocol_version: HELPER_PROTOCOL_VERSION,
            channel_nonce: request.channel_nonce.clone(),
            helper_source_instance_id: request.helper_source_instance_id.clone(),
            source_kind: request.source_kind,
            failure_code: HelperFailureCode::Cleanup,
            last_sequence: 1,
            lost_event_count: None,
            monotonic_time_ns: 3,
        });
        let mut server = HelperServer::new(
            NONCE.to_owned(),
            BatchFactory {
                capabilities: [HelperSourceKind::ProcessApplication],
                events: Some(vec![oversized, cleanup]),
                close_events: None,
            },
        );
        server
            .handle_message(open_message(request))
            .expect("source opens");
        let messages = server.drain_events().expect("fatal failure is preserved");
        assert!(matches!(
            messages.as_slice(),
            [HelperServerMessage {
                kind: HelperServerMessageKind::Failure,
                failure: Some(HelperSourceFailure {
                    failure_code: HelperFailureCode::Cleanup,
                    last_sequence: 0,
                    ..
                }),
                ..
            }]
        ));
    }

    #[test]
    fn fatal_failure_outranks_an_out_of_order_observation() {
        let request = process_request_with_capacity(2);
        let cleanup = HelperSourceEvent::Failure(HelperSourceFailure {
            protocol_version: 0,
            channel_nonce: "malformed".to_owned(),
            helper_source_instance_id: "wrong-source-id-0001".to_owned(),
            source_kind: HelperSourceKind::InteractiveSession,
            failure_code: HelperFailureCode::Cleanup,
            last_sequence: MAX_PROTOCOL_SAFE_INTEGER + 1,
            lost_event_count: Some(1),
            monotonic_time_ns: MAX_PROTOCOL_SAFE_INTEGER + 1,
        });
        let mut server = HelperServer::new(
            NONCE.to_owned(),
            BatchFactory {
                capabilities: [HelperSourceKind::ProcessApplication],
                events: Some(vec![process_observation(&request, 7, 2), cleanup]),
                close_events: None,
            },
        );
        server
            .handle_message(open_message(request))
            .expect("source opens");
        let messages = server.drain_events().expect("fatal failure is preserved");
        assert!(matches!(
            messages.as_slice(),
            [HelperServerMessage {
                kind: HelperServerMessageKind::Failure,
                failure: Some(HelperSourceFailure {
                    failure_code: HelperFailureCode::Cleanup,
                    last_sequence: 0,
                    ..
                }),
                ..
            }]
        ));
    }

    #[test]
    fn cleanup_failure_during_wire_overflow_close_remains_fatal() {
        let request = process_request_with_capacity(2);
        let cleanup = HelperSourceEvent::Failure(HelperSourceFailure {
            protocol_version: HELPER_PROTOCOL_VERSION,
            channel_nonce: request.channel_nonce.clone(),
            helper_source_instance_id: request.helper_source_instance_id.clone(),
            source_kind: request.source_kind,
            failure_code: HelperFailureCode::Cleanup,
            last_sequence: 1,
            lost_event_count: None,
            monotonic_time_ns: 3,
        });
        let mut server = HelperServer::new(
            NONCE.to_owned(),
            BatchFactory {
                capabilities: [HelperSourceKind::ProcessApplication],
                events: Some(vec![oversized_process_observation(&request, 1, 2)]),
                close_events: Some(vec![cleanup]),
            },
        );
        server
            .handle_message(open_message(request.clone()))
            .expect("source opens");
        server.drain_events().expect("wire overflow is classified");
        let messages = server
            .handle_message(close_message(&request))
            .expect("cleanup is returned as a typed close failure");
        assert!(matches!(
            messages.as_slice(),
            [HelperServerMessage {
                kind: HelperServerMessageKind::Failure,
                failure: Some(HelperSourceFailure {
                    failure_code: HelperFailureCode::Cleanup,
                    last_sequence: 0,
                    ..
                }),
                ..
            }]
        ));
        assert!(!server.has_active_sources());
    }

    #[test]
    fn unprovable_source_close_is_normalized_to_cleanup_failure() {
        let request = process_request();
        let mut server = HelperServer::new(
            NONCE.to_owned(),
            CloseErrorFactory {
                capabilities: [HelperSourceKind::ProcessApplication],
            },
        );
        server
            .handle_message(open_message(request.clone()))
            .expect("source opens");
        let messages = server
            .handle_message(close_message(&request))
            .expect("close failure is normalized");
        assert!(matches!(
            messages.as_slice(),
            [HelperServerMessage {
                kind: HelperServerMessageKind::Failure,
                failure: Some(HelperSourceFailure {
                    failure_code: HelperFailureCode::Cleanup,
                    last_sequence: 0,
                    lost_event_count: None,
                    ..
                }),
                ..
            }]
        ));
        assert!(!server.has_active_sources());
    }

    #[test]
    fn protocol_failure_during_close_is_typed_after_an_earlier_source_failure() {
        let request = process_request();
        let backend = HelperSourceEvent::Failure(HelperSourceFailure {
            protocol_version: HELPER_PROTOCOL_VERSION,
            channel_nonce: request.channel_nonce.clone(),
            helper_source_instance_id: request.helper_source_instance_id.clone(),
            source_kind: request.source_kind,
            failure_code: HelperFailureCode::Backend,
            last_sequence: 0,
            lost_event_count: None,
            monotonic_time_ns: 2,
        });
        let protocol = HelperSourceEvent::Failure(HelperSourceFailure {
            protocol_version: HELPER_PROTOCOL_VERSION,
            channel_nonce: request.channel_nonce.clone(),
            helper_source_instance_id: request.helper_source_instance_id.clone(),
            source_kind: request.source_kind,
            failure_code: HelperFailureCode::Protocol,
            last_sequence: 0,
            lost_event_count: None,
            monotonic_time_ns: 3,
        });
        let mut server = HelperServer::new(
            NONCE.to_owned(),
            BatchFactory {
                capabilities: [HelperSourceKind::ProcessApplication],
                events: Some(vec![backend]),
                close_events: Some(vec![protocol]),
            },
        );
        server
            .handle_message(open_message(request.clone()))
            .expect("source opens");
        server
            .drain_events()
            .expect("operational failure is delivered");
        let messages = server
            .handle_message(close_message(&request))
            .expect("protocol failure is returned as a typed close failure");
        assert!(matches!(
            messages.as_slice(),
            [HelperServerMessage {
                kind: HelperServerMessageKind::Failure,
                failure: Some(HelperSourceFailure {
                    failure_code: HelperFailureCode::Protocol,
                    last_sequence: 0,
                    ..
                }),
                ..
            }]
        ));
        assert!(!server.has_active_sources());
    }

    #[test]
    fn negotiated_capabilities_are_frozen_before_factory_state_changes() {
        let mut server = HelperServer::new(
            NONCE.to_owned(),
            MutableCapabilitiesFactory {
                capabilities: vec![HelperSourceKind::ProcessApplication],
            },
        );
        assert_eq!(
            server.capabilities(),
            [HelperSourceKind::ProcessApplication]
        );
        let process = process_request();
        server
            .handle_message(open_message(process.clone()))
            .expect("negotiated source opens");
        server
            .handle_message(close_message(&process))
            .expect("negotiated source closes");
        let session = HelperSourceOpen {
            helper_source_instance_id: "session-source-0001".to_owned(),
            source_kind: HelperSourceKind::InteractiveSession,
            schema_version: INTERACTIVE_SESSION_SCHEMA_VERSION,
            event_classes: vec![HelperEventClass::InteractiveSessionLifecycle],
            ..process
        };
        assert!(matches!(
            server.handle_message(open_message(session)),
            Err(HelperTransportError::Protocol(
                HelperProtocolError::Lifecycle
            ))
        ));
    }

    #[derive(Clone, Copy, Eq, PartialEq)]
    enum DelayedFailureStage {
        Open,
        Drain,
        Close,
    }

    struct DelayedFailureFactory {
        capabilities: [HelperSourceKind; 1],
        stage: DelayedFailureStage,
    }

    impl HelperSourceFactory for DelayedFailureFactory {
        fn capabilities(&self) -> &[HelperSourceKind] {
            &self.capabilities
        }

        fn open(
            &mut self,
            request: &HelperSourceOpen,
            monotonic_time_ns: u64,
        ) -> Result<HelperSourceOpenOutcome, HelperTransportError> {
            if self.stage == DelayedFailureStage::Open {
                thread::sleep(DELAYED_SOURCE_OPERATION);
                return Ok(HelperSourceOpenOutcome::Failed(HelperSourceFailure {
                    protocol_version: HELPER_PROTOCOL_VERSION,
                    channel_nonce: request.channel_nonce.clone(),
                    helper_source_instance_id: request.helper_source_instance_id.clone(),
                    source_kind: request.source_kind,
                    failure_code: HelperFailureCode::Cleanup,
                    last_sequence: 0,
                    lost_event_count: None,
                    monotonic_time_ns,
                }));
            }
            Ok(HelperSourceOpenOutcome::Opened(OpenedHelperSource {
                initial_snapshot: unavailable_snapshot(request, monotonic_time_ns),
                source: Box::new(DelayedFailureSource {
                    request: request.clone(),
                    stage: self.stage,
                }),
            }))
        }
    }

    struct DelayedFailureSource {
        request: HelperSourceOpen,
        stage: DelayedFailureStage,
    }

    impl HelperSource for DelayedFailureSource {
        fn source_kind(&self) -> HelperSourceKind {
            self.request.source_kind
        }

        fn schema_version(&self) -> u16 {
            self.request.schema_version
        }

        fn drain(&mut self) -> Result<Vec<HelperSourceEvent>, HelperTransportError> {
            if self.stage != DelayedFailureStage::Drain {
                return Ok(Vec::new());
            }
            thread::sleep(DELAYED_SOURCE_OPERATION);
            Ok(vec![HelperSourceEvent::Failure(HelperSourceFailure {
                protocol_version: HELPER_PROTOCOL_VERSION,
                channel_nonce: self.request.channel_nonce.clone(),
                helper_source_instance_id: self.request.helper_source_instance_id.clone(),
                source_kind: self.request.source_kind,
                failure_code: HelperFailureCode::Cleanup,
                last_sequence: 0,
                lost_event_count: None,
                monotonic_time_ns: 0,
            })])
        }

        fn close(
            &mut self,
            monotonic_time_ns: u64,
        ) -> Result<HelperSourceCloseOutput, HelperTransportError> {
            if self.stage == DelayedFailureStage::Close {
                thread::sleep(DELAYED_SOURCE_OPERATION);
                return Err(HelperTransportError::Protocol(
                    HelperProtocolError::Lifecycle,
                ));
            }
            Ok(HelperSourceCloseOutput {
                events: Vec::new(),
                final_snapshot: unavailable_snapshot(&self.request, monotonic_time_ns),
            })
        }
    }

    struct FailingFactory {
        failure: HelperSourceFailure,
        capabilities: [HelperSourceKind; 1],
    }

    impl HelperSourceFactory for FailingFactory {
        fn capabilities(&self) -> &[HelperSourceKind] {
            &self.capabilities
        }

        fn open(
            &mut self,
            _request: &HelperSourceOpen,
            _monotonic_time_ns: u64,
        ) -> Result<HelperSourceOpenOutcome, HelperTransportError> {
            Ok(HelperSourceOpenOutcome::Failed(self.failure.clone()))
        }
    }

    struct EventFactory {
        capabilities: [HelperSourceKind; 1],
        observation: HelperObservation,
    }

    struct OversizedFactory {
        capabilities: [HelperSourceKind; 1],
        close_count: Arc<AtomicUsize>,
    }

    struct FinalOversizedFactory {
        capabilities: [HelperSourceKind; 1],
    }

    struct CloseErrorFactory {
        capabilities: [HelperSourceKind; 1],
    }

    impl HelperSourceFactory for CloseErrorFactory {
        fn capabilities(&self) -> &[HelperSourceKind] {
            &self.capabilities
        }

        fn open(
            &mut self,
            request: &HelperSourceOpen,
            monotonic_time_ns: u64,
        ) -> Result<HelperSourceOpenOutcome, HelperTransportError> {
            Ok(HelperSourceOpenOutcome::Opened(OpenedHelperSource {
                initial_snapshot: unavailable_snapshot(request, monotonic_time_ns),
                source: Box::new(CloseErrorSource {
                    request: request.clone(),
                }),
            }))
        }
    }

    struct CloseErrorSource {
        request: HelperSourceOpen,
    }

    impl HelperSource for CloseErrorSource {
        fn source_kind(&self) -> HelperSourceKind {
            self.request.source_kind
        }

        fn schema_version(&self) -> u16 {
            self.request.schema_version
        }

        fn drain(&mut self) -> Result<Vec<HelperSourceEvent>, HelperTransportError> {
            Ok(Vec::new())
        }

        fn close(
            &mut self,
            _monotonic_time_ns: u64,
        ) -> Result<HelperSourceCloseOutput, HelperTransportError> {
            Err(HelperTransportError::Protocol(
                HelperProtocolError::Lifecycle,
            ))
        }
    }

    impl HelperSourceFactory for FinalOversizedFactory {
        fn capabilities(&self) -> &[HelperSourceKind] {
            &self.capabilities
        }

        fn open(
            &mut self,
            request: &HelperSourceOpen,
            monotonic_time_ns: u64,
        ) -> Result<HelperSourceOpenOutcome, HelperTransportError> {
            Ok(HelperSourceOpenOutcome::Opened(OpenedHelperSource {
                initial_snapshot: unavailable_snapshot(request, monotonic_time_ns),
                source: Box::new(FinalOversizedSource {
                    request: request.clone(),
                }),
            }))
        }
    }

    struct FinalOversizedSource {
        request: HelperSourceOpen,
    }

    impl HelperSource for FinalOversizedSource {
        fn source_kind(&self) -> HelperSourceKind {
            self.request.source_kind
        }

        fn schema_version(&self) -> u16 {
            self.request.schema_version
        }

        fn drain(&mut self) -> Result<Vec<HelperSourceEvent>, HelperTransportError> {
            Ok(Vec::new())
        }

        fn close(
            &mut self,
            monotonic_time_ns: u64,
        ) -> Result<HelperSourceCloseOutput, HelperTransportError> {
            Ok(HelperSourceCloseOutput {
                events: Vec::new(),
                final_snapshot: HelperSourceSnapshot {
                    protocol_version: HELPER_PROTOCOL_VERSION,
                    channel_nonce: self.request.channel_nonce.clone(),
                    helper_source_instance_id: self.request.helper_source_instance_id.clone(),
                    source_kind: self.request.source_kind,
                    schema_version: self.request.schema_version,
                    last_sequence: 0,
                    monotonic_time_ns,
                    process_state: Some(oversized_process_state()),
                    interactive_session_state: None,
                },
            })
        }
    }

    impl HelperSourceFactory for OversizedFactory {
        fn capabilities(&self) -> &[HelperSourceKind] {
            &self.capabilities
        }

        fn open(
            &mut self,
            request: &HelperSourceOpen,
            monotonic_time_ns: u64,
        ) -> Result<HelperSourceOpenOutcome, HelperTransportError> {
            let snapshot = HelperSourceSnapshot {
                protocol_version: HELPER_PROTOCOL_VERSION,
                channel_nonce: request.channel_nonce.clone(),
                helper_source_instance_id: request.helper_source_instance_id.clone(),
                source_kind: request.source_kind,
                schema_version: request.schema_version,
                last_sequence: 0,
                monotonic_time_ns,
                process_state: Some(oversized_process_state()),
                interactive_session_state: None,
            };
            assert!(
                serde_json::to_vec(&snapshot_message(snapshot.clone()))
                    .expect("snapshot serializes")
                    .len()
                    > MAX_HELPER_FRAME_BYTES
            );
            Ok(HelperSourceOpenOutcome::Opened(OpenedHelperSource {
                initial_snapshot: snapshot,
                source: Box::new(TrackingSource {
                    request: request.clone(),
                    close_count: Arc::clone(&self.close_count),
                }),
            }))
        }
    }

    struct TrackingSource {
        request: HelperSourceOpen,
        close_count: Arc<AtomicUsize>,
    }

    impl HelperSource for TrackingSource {
        fn source_kind(&self) -> HelperSourceKind {
            self.request.source_kind
        }

        fn schema_version(&self) -> u16 {
            self.request.schema_version
        }

        fn drain(&mut self) -> Result<Vec<HelperSourceEvent>, HelperTransportError> {
            Ok(Vec::new())
        }

        fn close(
            &mut self,
            monotonic_time_ns: u64,
        ) -> Result<HelperSourceCloseOutput, HelperTransportError> {
            self.close_count.fetch_add(1, Ordering::SeqCst);
            Ok(HelperSourceCloseOutput {
                events: Vec::new(),
                final_snapshot: unavailable_snapshot(&self.request, monotonic_time_ns),
            })
        }
    }

    struct RollbackFailureFactory {
        capabilities: [HelperSourceKind; 1],
    }

    impl HelperSourceFactory for RollbackFailureFactory {
        fn capabilities(&self) -> &[HelperSourceKind] {
            &self.capabilities
        }

        fn open(
            &mut self,
            request: &HelperSourceOpen,
            monotonic_time_ns: u64,
        ) -> Result<HelperSourceOpenOutcome, HelperTransportError> {
            let mut invalid_snapshot = unavailable_snapshot(request, monotonic_time_ns);
            invalid_snapshot.last_sequence = 1;
            invalid_snapshot.monotonic_time_ns = MAX_PROTOCOL_SAFE_INTEGER + 1;
            Ok(HelperSourceOpenOutcome::Opened(OpenedHelperSource {
                initial_snapshot: invalid_snapshot,
                source: Box::new(RollbackFailureSource {
                    request: request.clone(),
                }),
            }))
        }
    }

    struct RollbackFailureSource {
        request: HelperSourceOpen,
    }

    impl HelperSource for RollbackFailureSource {
        fn source_kind(&self) -> HelperSourceKind {
            self.request.source_kind
        }

        fn schema_version(&self) -> u16 {
            self.request.schema_version
        }

        fn drain(&mut self) -> Result<Vec<HelperSourceEvent>, HelperTransportError> {
            Ok(Vec::new())
        }

        fn close(
            &mut self,
            monotonic_time_ns: u64,
        ) -> Result<HelperSourceCloseOutput, HelperTransportError> {
            Ok(HelperSourceCloseOutput {
                events: vec![HelperSourceEvent::Failure(HelperSourceFailure {
                    protocol_version: HELPER_PROTOCOL_VERSION,
                    channel_nonce: self.request.channel_nonce.clone(),
                    helper_source_instance_id: self.request.helper_source_instance_id.clone(),
                    source_kind: self.request.source_kind,
                    failure_code: HelperFailureCode::Cleanup,
                    last_sequence: 0,
                    lost_event_count: None,
                    monotonic_time_ns,
                })],
                final_snapshot: unavailable_snapshot(&self.request, monotonic_time_ns),
            })
        }
    }

    struct SourceFailureFactory {
        capabilities: [HelperSourceKind; 1],
        failure: HelperSourceFailure,
        drain_count: Arc<AtomicUsize>,
    }

    struct BatchFactory {
        capabilities: [HelperSourceKind; 1],
        events: Option<Vec<HelperSourceEvent>>,
        close_events: Option<Vec<HelperSourceEvent>>,
    }

    struct MutableCapabilitiesFactory {
        capabilities: Vec<HelperSourceKind>,
    }

    impl HelperSourceFactory for MutableCapabilitiesFactory {
        fn capabilities(&self) -> &[HelperSourceKind] {
            &self.capabilities
        }

        fn open(
            &mut self,
            request: &HelperSourceOpen,
            monotonic_time_ns: u64,
        ) -> Result<HelperSourceOpenOutcome, HelperTransportError> {
            if !self
                .capabilities
                .contains(&HelperSourceKind::InteractiveSession)
            {
                self.capabilities.push(HelperSourceKind::InteractiveSession);
            }
            Ok(HelperSourceOpenOutcome::Opened(OpenedHelperSource {
                initial_snapshot: unavailable_snapshot(request, monotonic_time_ns),
                source: Box::new(UnavailableHelperSource {
                    request: request.clone(),
                    last_monotonic_time_ns: monotonic_time_ns,
                }),
            }))
        }
    }

    impl HelperSourceFactory for BatchFactory {
        fn capabilities(&self) -> &[HelperSourceKind] {
            &self.capabilities
        }

        fn open(
            &mut self,
            request: &HelperSourceOpen,
            _monotonic_time_ns: u64,
        ) -> Result<HelperSourceOpenOutcome, HelperTransportError> {
            Ok(HelperSourceOpenOutcome::Opened(OpenedHelperSource {
                initial_snapshot: unavailable_snapshot(request, 1),
                source: Box::new(BatchSource {
                    request: request.clone(),
                    events: self.events.take().unwrap_or_default(),
                    close_events: self.close_events.take().unwrap_or_default(),
                }),
            }))
        }
    }

    struct BatchSource {
        request: HelperSourceOpen,
        events: Vec<HelperSourceEvent>,
        close_events: Vec<HelperSourceEvent>,
    }

    impl HelperSource for BatchSource {
        fn source_kind(&self) -> HelperSourceKind {
            self.request.source_kind
        }

        fn schema_version(&self) -> u16 {
            self.request.schema_version
        }

        fn drain(&mut self) -> Result<Vec<HelperSourceEvent>, HelperTransportError> {
            Ok(std::mem::take(&mut self.events))
        }

        fn close(
            &mut self,
            monotonic_time_ns: u64,
        ) -> Result<HelperSourceCloseOutput, HelperTransportError> {
            let mut events = self.drain()?;
            events.append(&mut self.close_events);
            Ok(HelperSourceCloseOutput {
                events,
                final_snapshot: unavailable_snapshot(&self.request, monotonic_time_ns),
            })
        }
    }

    impl HelperSourceFactory for SourceFailureFactory {
        fn capabilities(&self) -> &[HelperSourceKind] {
            &self.capabilities
        }

        fn open(
            &mut self,
            request: &HelperSourceOpen,
            _monotonic_time_ns: u64,
        ) -> Result<HelperSourceOpenOutcome, HelperTransportError> {
            Ok(HelperSourceOpenOutcome::Opened(OpenedHelperSource {
                initial_snapshot: unavailable_snapshot(request, 1),
                source: Box::new(SourceFailureSource {
                    request: request.clone(),
                    failure: self.failure.clone(),
                    drain_count: Arc::clone(&self.drain_count),
                }),
            }))
        }
    }

    struct SourceFailureSource {
        request: HelperSourceOpen,
        failure: HelperSourceFailure,
        drain_count: Arc<AtomicUsize>,
    }

    impl HelperSource for SourceFailureSource {
        fn source_kind(&self) -> HelperSourceKind {
            self.request.source_kind
        }

        fn schema_version(&self) -> u16 {
            self.request.schema_version
        }

        fn drain(&mut self) -> Result<Vec<HelperSourceEvent>, HelperTransportError> {
            self.drain_count.fetch_add(1, Ordering::SeqCst);
            Ok(vec![HelperSourceEvent::Failure(self.failure.clone())])
        }

        fn close(
            &mut self,
            monotonic_time_ns: u64,
        ) -> Result<HelperSourceCloseOutput, HelperTransportError> {
            Ok(HelperSourceCloseOutput {
                events: Vec::new(),
                final_snapshot: unavailable_snapshot(&self.request, monotonic_time_ns),
            })
        }
    }

    impl HelperSourceFactory for EventFactory {
        fn capabilities(&self) -> &[HelperSourceKind] {
            &self.capabilities
        }

        fn open(
            &mut self,
            request: &HelperSourceOpen,
            _monotonic_time_ns: u64,
        ) -> Result<HelperSourceOpenOutcome, HelperTransportError> {
            let initial_snapshot = unavailable_snapshot(request, 1);
            Ok(HelperSourceOpenOutcome::Opened(OpenedHelperSource {
                initial_snapshot: initial_snapshot.clone(),
                source: Box::new(EventSource {
                    request: request.clone(),
                    observation: Some(self.observation.clone()),
                    state: initial_snapshot.process_state.expect("process state"),
                }),
            }))
        }
    }

    struct EventSource {
        request: HelperSourceOpen,
        observation: Option<HelperObservation>,
        state: ProcessApplicationState,
    }

    impl HelperSource for EventSource {
        fn source_kind(&self) -> HelperSourceKind {
            self.request.source_kind
        }

        fn schema_version(&self) -> u16 {
            self.request.schema_version
        }

        fn drain(&mut self) -> Result<Vec<HelperSourceEvent>, HelperTransportError> {
            Ok(self
                .observation
                .take()
                .map(|observation| HelperSourceEvent::Observation(Box::new(observation)))
                .into_iter()
                .collect())
        }

        fn close(
            &mut self,
            monotonic_time_ns: u64,
        ) -> Result<HelperSourceCloseOutput, HelperTransportError> {
            Ok(HelperSourceCloseOutput {
                events: self.drain()?,
                final_snapshot: HelperSourceSnapshot {
                    protocol_version: HELPER_PROTOCOL_VERSION,
                    channel_nonce: self.request.channel_nonce.clone(),
                    helper_source_instance_id: self.request.helper_source_instance_id.clone(),
                    source_kind: self.request.source_kind,
                    schema_version: self.request.schema_version,
                    last_sequence: 1,
                    monotonic_time_ns,
                    process_state: Some(self.state.clone()),
                    interactive_session_state: None,
                },
            })
        }
    }

    fn assert_failure_after_delayed_operation(
        messages: &[HelperServerMessage],
        before_monotonic_time_ns: u64,
    ) {
        assert_eq!(messages.len(), 1);
        let failure = messages[0].failure.as_ref().expect("typed failure");
        let minimum_time_ns = before_monotonic_time_ns.saturating_add(
            u64::try_from(DELAYED_SOURCE_OPERATION.as_nanos()).expect("test delay fits in u64"),
        );
        assert_eq!(failure.failure_code, HelperFailureCode::Cleanup);
        assert!(
            failure.monotonic_time_ns >= minimum_time_ns,
            "failure timestamp {} predates delayed operation completion {minimum_time_ns}",
            failure.monotonic_time_ns
        );
    }

    fn process_request() -> HelperSourceOpen {
        process_request_with_capacity(8)
    }

    fn process_request_with_capacity(queue_capacity: u16) -> HelperSourceOpen {
        HelperSourceOpen {
            protocol_version: HELPER_PROTOCOL_VERSION,
            channel_nonce: NONCE.to_owned(),
            helper_source_instance_id: "process-source-0001".to_owned(),
            source_kind: HelperSourceKind::ProcessApplication,
            schema_version: PROCESS_APPLICATION_SCHEMA_VERSION,
            queue_capacity,
            event_classes: vec![
                HelperEventClass::ProcessLifecycle,
                HelperEventClass::ProcessIdentity,
            ],
        }
    }

    fn process_observation(
        request: &HelperSourceOpen,
        sequence: u64,
        monotonic_time_ns: u64,
    ) -> HelperSourceEvent {
        HelperSourceEvent::Observation(Box::new(HelperObservation {
            protocol_version: HELPER_PROTOCOL_VERSION,
            channel_nonce: request.channel_nonce.clone(),
            helper_source_instance_id: request.helper_source_instance_id.clone(),
            source_kind: request.source_kind,
            sequence,
            monotonic_time_ns,
            process_event: Some(ProcessApplicationEvent {
                kind: ProcessApplicationEventKind::Reconciled,
                process_instance_id: None,
                process: None,
                state: unavailable_snapshot(request, monotonic_time_ns).process_state,
            }),
            interactive_session_event: None,
        }))
    }

    fn oversized_process_observation(
        request: &HelperSourceOpen,
        sequence: u64,
        monotonic_time_ns: u64,
    ) -> HelperSourceEvent {
        HelperSourceEvent::Observation(Box::new(HelperObservation {
            protocol_version: HELPER_PROTOCOL_VERSION,
            channel_nonce: request.channel_nonce.clone(),
            helper_source_instance_id: request.helper_source_instance_id.clone(),
            source_kind: request.source_kind,
            sequence,
            monotonic_time_ns,
            process_event: Some(ProcessApplicationEvent {
                kind: ProcessApplicationEventKind::Reconciled,
                process_instance_id: None,
                process: None,
                state: Some(oversized_process_state()),
            }),
            interactive_session_event: None,
        }))
    }

    fn oversized_process_state() -> ProcessApplicationState {
        let processes = (0..256)
            .map(|index| ProcessApplicationProcess {
                process_instance_id: format!("process-instance-{index:047x}"),
                scope: ProcessApplicationScope::CandidateInteractiveSession,
                identity: ProcessExecutableIdentity {
                    status: ProcessExecutableIdentityStatus::Verified,
                    signer_chain_id: None,
                    publisher_id: None,
                    product_id: None,
                    signing_id: Some("s".repeat(256)),
                    team_id: Some("t".repeat(64)),
                    designated_requirement: Some("r".repeat(512)),
                    bundle_id: Some("b".repeat(256)),
                    package_id: None,
                    version: Some("1".repeat(64)),
                    digest_sha256: None,
                },
            })
            .collect();
        ProcessApplicationState {
            coverage: ProcessApplicationCoverage::FullLifecycle,
            certainty: ProcessApplicationCertainty::Complete,
            processes,
        }
    }

    fn open_message(request: HelperSourceOpen) -> HelperClientMessage {
        HelperClientMessage {
            kind: HelperClientMessageKind::Open,
            open: Some(request),
            close: None,
        }
    }

    fn close_message(request: &HelperSourceOpen) -> HelperClientMessage {
        HelperClientMessage {
            kind: HelperClientMessageKind::Close,
            open: None,
            close: Some(HelperSourceClose {
                protocol_version: HELPER_PROTOCOL_VERSION,
                channel_nonce: request.channel_nonce.clone(),
                helper_source_instance_id: request.helper_source_instance_id.clone(),
            }),
        }
    }
}
