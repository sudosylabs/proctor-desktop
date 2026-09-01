#![deny(unsafe_code)]

use std::collections::{BTreeMap, VecDeque};
use std::fmt;
use std::fmt::Write as _;
use std::io::{self, Read, Write};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{self, Receiver, SyncSender};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};

use prctr_native_helper_protocol::{
    HelperFailureCode, HelperObservation, HelperProtocolError, HelperServerMessage,
    HelperServerMessageKind, HelperSourceClose, HelperSourceFailure, HelperSourceFence,
    HelperSourceKind, HelperSourceOpen, HelperSourceSnapshot, VerifiedHelperChannel,
    VerifiedHelperPeer, bind_verified_helper_channel, validate_helper_frame_size,
};
use prctr_native_protocol::{
    HelperClientMessage, HelperClientMessageKind, HelperHandshake, ProtocolValidatable,
    ProtocolValidationError,
};
use serde::Serialize;
use serde::de::DeserializeOwned;

#[cfg(target_os = "windows")]
#[allow(unsafe_code)]
mod windows;

#[cfg(target_os = "macos")]
#[allow(unsafe_code)]
mod macos;

pub const HELPER_BUILD_ID: &str = "prctr-native-helper-0.1.0";
const MAX_PENDING_HELPER_OBSERVATIONS: usize = 2_048;
const HELPER_STARTUP_DEADLINE: Duration = Duration::from_secs(5);
const HELPER_REQUEST_DEADLINE: Duration = Duration::from_secs(5);
const HELPER_TERMINATION_DEADLINE: Duration = Duration::from_millis(500);
static HELPER_UTILITY_POISONED: AtomicBool = AtomicBool::new(false);

#[derive(Debug)]
pub enum HelperTransportError {
    Io(io::Error),
    Json(serde_json::Error),
    Protocol(HelperProtocolError),
    Wire(ProtocolValidationError),
    ExecutableIdentity,
    UnsupportedPlatform,
    ChildExited,
    ChildTermination,
    DeadlineExceeded,
    ConnectionFenced,
    UtilityPoisoned,
    SourceFailure(HelperSourceFailure),
}

impl fmt::Display for HelperTransportError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(match self {
            Self::Io(_) => "native helper transport I/O failed",
            Self::Json(_) => "native helper sent malformed JSON",
            Self::Protocol(_) => "native helper protocol validation failed",
            Self::Wire(_) => "native helper wire validation failed",
            Self::ExecutableIdentity => "native helper executable identity is not trusted",
            Self::UnsupportedPlatform => "native helper transport is unsupported on this platform",
            Self::ChildExited => "native helper exited before its private channel was established",
            Self::ChildTermination => "native helper termination could not be proved",
            Self::DeadlineExceeded => "native helper transport deadline was exceeded",
            Self::ConnectionFenced => "native helper connection is terminally fenced",
            Self::UtilityPoisoned => "native helper utility process must be replaced",
            Self::SourceFailure(_) => "native helper source reported a terminal failure",
        })
    }
}

impl std::error::Error for HelperTransportError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            Self::Io(error) => Some(error),
            Self::Json(error) => Some(error),
            Self::Protocol(error) => Some(error),
            Self::Wire(error) => Some(error),
            Self::ExecutableIdentity
            | Self::UnsupportedPlatform
            | Self::ChildExited
            | Self::ChildTermination
            | Self::DeadlineExceeded
            | Self::ConnectionFenced
            | Self::UtilityPoisoned
            | Self::SourceFailure(_) => None,
        }
    }
}

impl From<io::Error> for HelperTransportError {
    fn from(error: io::Error) -> Self {
        Self::Io(error)
    }
}

impl From<serde_json::Error> for HelperTransportError {
    fn from(error: serde_json::Error) -> Self {
        Self::Json(error)
    }
}

impl From<HelperProtocolError> for HelperTransportError {
    fn from(error: HelperProtocolError) -> Self {
        Self::Protocol(error)
    }
}

impl From<ProtocolValidationError> for HelperTransportError {
    fn from(error: ProtocolValidationError) -> Self {
        Self::Wire(error)
    }
}

#[derive(Clone)]
pub struct HelperLaunchConfiguration {
    pub executable: PathBuf,
    pub expected_helper_build_id: String,
    pub expected_capabilities: Vec<HelperSourceKind>,
    pub macos_designated_requirement: Option<String>,
    pub windows_executable_sha256: Option<String>,
}

struct VerifiedPackagedHelper {
    peer: VerifiedHelperPeer,
    #[cfg(target_os = "windows")]
    locked_executable: std::fs::File,
}

pub struct NativeHelperConnection {
    child: Child,
    transport: DeadlineFramedTransport,
    channel: VerifiedHelperChannel,
    active_sources: BTreeMap<String, ActiveHelperSource>,
    pending_events: VecDeque<NativeHelperSourceEvent>,
    fenced: bool,
}

struct ActiveHelperSource {
    kind: HelperSourceKind,
    fence: HelperSourceFence,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum NativeHelperSourceEvent {
    Observation(Box<HelperObservation>),
    Failure(HelperSourceFailure),
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct HelperSourceCloseResult {
    pub events: Vec<NativeHelperSourceEvent>,
    pub final_snapshot: HelperSourceSnapshot,
}

impl NativeHelperConnection {
    /// Launches the exact packaged helper over private inherited pipes after
    /// platform code-signature verification and binds its handshake to the
    /// broker-generated single-use nonce.
    ///
    /// # Errors
    ///
    /// Returns an identity, spawn, framing, deserialization, or handshake error.
    #[allow(
        clippy::needless_pass_by_value,
        reason = "launch authority is intentionally consumed and cannot be reused"
    )]
    pub fn launch(configuration: HelperLaunchConfiguration) -> Result<Self, HelperTransportError> {
        ensure_helper_utility_usable()?;
        let deadline = Instant::now() + HELPER_STARTUP_DEADLINE;
        let verify_configuration = configuration.clone();
        let verified =
            run_startup_task("prctr-helper-package-verification", deadline, move || {
                verify_packaged_helper(&verify_configuration, deadline)
            })?;
        let channel_nonce =
            run_startup_task("prctr-helper-nonce", deadline, generate_channel_nonce)?;
        let mut child = spawn_helper_before_deadline(&configuration.executable, deadline)?;
        let mut startup_transport = None;
        let startup = (|| {
            let peer = verified.peer.clone();
            let verify_configuration = configuration.clone();
            let process_id = child.id();
            run_startup_task("prctr-helper-live-verification", deadline, move || {
                verify_spawned_helper(&verify_configuration, process_id, &verified)
            })?;
            let input = child
                .stdin
                .take()
                .ok_or(HelperTransportError::ChildExited)?;
            let output = child
                .stdout
                .take()
                .ok_or(HelperTransportError::ChildExited)?;
            startup_transport = Some(DeadlineFramedTransport::new(input, output)?);
            let transport = startup_transport
                .as_ref()
                .ok_or(HelperTransportError::ConnectionFenced)?;
            remaining(deadline)?;
            transport.write_bytes(channel_nonce.as_bytes(), remaining(deadline)?)?;
            let handshake: HelperHandshake = transport.read_json(remaining(deadline)?)?;
            let channel = bind_verified_helper_channel(&handshake, &peer, &channel_nonce)?;
            if child.try_wait()?.is_some() {
                return Err(HelperTransportError::ChildExited);
            }
            Ok(channel)
        })();
        match startup {
            Ok(channel) => Ok(Self {
                child,
                transport: startup_transport
                    .take()
                    .ok_or(HelperTransportError::ConnectionFenced)?,
                channel,
                active_sources: BTreeMap::new(),
                pending_events: VecDeque::new(),
                fenced: false,
            }),
            Err(error) => {
                let cleanup = match startup_transport.as_mut() {
                    Some(transport) => fence_child_and_transport(&mut child, transport),
                    None => terminate_child(&mut child),
                };
                cleanup.map_or_else(Err, |()| Err(error))
            }
        }
    }

    /// Opens a negotiated helper source and validates its sequence-zero snapshot.
    ///
    /// # Errors
    ///
    /// Returns a capability, framing, serialization, or snapshot error.
    pub fn open_source(
        &mut self,
        request: &HelperSourceOpen,
    ) -> Result<HelperSourceSnapshot, HelperTransportError> {
        match self.open_source_inner(request) {
            Err(HelperTransportError::SourceFailure(failure)) => {
                match failure_disposition(failure.failure_code) {
                    FailureDisposition::PreserveChannel => {
                        Err(HelperTransportError::SourceFailure(failure))
                    }
                    FailureDisposition::FenceConnection => {
                        self.finish_operation(Err(HelperTransportError::SourceFailure(failure)))
                    }
                    FailureDisposition::PoisonUtility => {
                        poison_helper_utility();
                        self.finish_operation(Err(HelperTransportError::UtilityPoisoned))
                    }
                }
            }
            result => self.finish_operation(result),
        }
    }

    fn open_source_inner(
        &mut self,
        request: &HelperSourceOpen,
    ) -> Result<HelperSourceSnapshot, HelperTransportError> {
        self.assert_usable()?;
        if self.active_sources.len() >= self.channel.peer().capabilities.len()
            || self
                .active_sources
                .contains_key(&request.helper_source_instance_id)
            || self
                .active_sources
                .values()
                .any(|source| source.kind == request.source_kind)
        {
            return Err(HelperProtocolError::Lifecycle.into());
        }
        let mut fence = self.channel.open_source(request)?;
        let deadline = Instant::now() + HELPER_REQUEST_DEADLINE;
        self.transport.write_json(
            &HelperClientMessage {
                kind: HelperClientMessageKind::Open,
                open: Some(request.clone()),
                close: None,
            },
            remaining(deadline)?,
        )?;
        loop {
            match self.read_server_payload(deadline)? {
                DecodedHelperServerPayload::Snapshot(snapshot) => {
                    if snapshot.helper_source_instance_id != request.helper_source_instance_id {
                        return Err(HelperProtocolError::Lifecycle.into());
                    }
                    fence.accept_initial_snapshot(&snapshot)?;
                    self.active_sources.insert(
                        request.helper_source_instance_id.clone(),
                        ActiveHelperSource {
                            kind: request.source_kind,
                            fence,
                        },
                    );
                    return Ok(snapshot);
                }
                DecodedHelperServerPayload::Observation(observation) => {
                    let event = route_server_event(
                        DecodedHelperServerPayload::Observation(observation),
                        &mut self.active_sources,
                    )?;
                    self.queue_event(event)?;
                }
                DecodedHelperServerPayload::Failure(failure)
                    if failure.helper_source_instance_id == request.helper_source_instance_id =>
                {
                    fence.accept_initial_failure(&failure)?;
                    return Err(HelperTransportError::SourceFailure(failure));
                }
                DecodedHelperServerPayload::Failure(failure) => {
                    let event = route_server_event(
                        DecodedHelperServerPayload::Failure(failure),
                        &mut self.active_sources,
                    )?;
                    self.queue_event(event)?;
                }
            }
        }
    }

    /// Receives and fences exactly one ordered observation or terminal source failure.
    ///
    /// # Errors
    ///
    /// Returns a framing, deserialization, ordering, identity, or time error.
    pub fn receive_event(&mut self) -> Result<NativeHelperSourceEvent, HelperTransportError> {
        let result = self.receive_event_inner();
        self.finish_operation(result)
    }

    fn receive_event_inner(&mut self) -> Result<NativeHelperSourceEvent, HelperTransportError> {
        self.assert_usable()?;
        if let Some(event) = self.pending_events.pop_front() {
            return Ok(event);
        }
        match self.read_server_message(Instant::now() + HELPER_REQUEST_DEADLINE)? {
            HelperServerPayload::Event(event) => Ok(event),
            HelperServerPayload::Snapshot => Err(HelperProtocolError::Lifecycle.into()),
        }
    }

    /// Fences callback intake and returns the ordered accepted tail atomically
    /// with its validated final snapshot.
    ///
    /// # Errors
    ///
    /// Returns a framing, serialization, identity, lifecycle, or snapshot error.
    pub fn close_source(
        &mut self,
        request: &HelperSourceClose,
    ) -> Result<HelperSourceCloseResult, HelperTransportError> {
        let result = self.close_source_inner(request);
        self.finish_operation(result)
    }

    fn close_source_inner(
        &mut self,
        request: &HelperSourceClose,
    ) -> Result<HelperSourceCloseResult, HelperTransportError> {
        self.assert_usable()?;
        self.channel.validate_source_close(request)?;
        if !self
            .active_sources
            .contains_key(&request.helper_source_instance_id)
        {
            return Err(HelperProtocolError::Lifecycle.into());
        }
        let mut events = self.take_pending_events_for(&request.helper_source_instance_id);
        let mut event_counts =
            HelperEventBatchCounts::from_events(events.iter(), &request.helper_source_instance_id);
        if !event_counts.fits() {
            return Err(HelperProtocolError::Lifecycle.into());
        }
        let deadline = Instant::now() + HELPER_REQUEST_DEADLINE;
        self.transport.write_json(
            &HelperClientMessage {
                kind: HelperClientMessageKind::Close,
                open: None,
                close: Some(request.clone()),
            },
            remaining(deadline)?,
        )?;
        loop {
            match self.read_server_payload(deadline)? {
                DecodedHelperServerPayload::Snapshot(snapshot) => {
                    if snapshot.helper_source_instance_id != request.helper_source_instance_id {
                        return Err(HelperProtocolError::Lifecycle.into());
                    }
                    let source = self
                        .active_sources
                        .get_mut(&request.helper_source_instance_id)
                        .ok_or(HelperProtocolError::Lifecycle)?;
                    source.fence.accept_final_snapshot(&snapshot)?;
                    self.active_sources
                        .remove(&request.helper_source_instance_id);
                    return Ok(HelperSourceCloseResult {
                        events,
                        final_snapshot: snapshot,
                    });
                }
                DecodedHelperServerPayload::Failure(failure)
                    if failure.helper_source_instance_id == request.helper_source_instance_id
                        && matches!(
                            failure.failure_code,
                            HelperFailureCode::Cleanup | HelperFailureCode::Protocol
                        ) =>
                {
                    let source = self
                        .active_sources
                        .get_mut(&request.helper_source_instance_id)
                        .ok_or(HelperProtocolError::Lifecycle)?;
                    source.fence.accept_close_failure(&failure)?;
                    return match failure.failure_code {
                        HelperFailureCode::Cleanup => {
                            poison_helper_utility();
                            Err(HelperTransportError::UtilityPoisoned)
                        }
                        HelperFailureCode::Protocol => {
                            Err(HelperTransportError::SourceFailure(failure))
                        }
                        HelperFailureCode::PermissionLost
                        | HelperFailureCode::NativeEventLoss
                        | HelperFailureCode::QueueOverflow
                        | HelperFailureCode::InventoryOverflow
                        | HelperFailureCode::Backend => {
                            unreachable!("close-failure guard admitted a recoverable failure code")
                        }
                    };
                }
                payload @ (DecodedHelperServerPayload::Observation(_)
                | DecodedHelperServerPayload::Failure(_)) => {
                    let event = route_server_event(payload, &mut self.active_sources)?;
                    if event_source_id(&event) == request.helper_source_instance_id {
                        if !event_counts.try_append(&event) {
                            return Err(HelperProtocolError::Lifecycle.into());
                        }
                        events.push(event);
                    } else {
                        self.queue_event(event)?;
                    }
                }
            }
        }
    }

    fn read_server_message(
        &mut self,
        deadline: Instant,
    ) -> Result<HelperServerPayload, HelperTransportError> {
        let message: HelperServerMessage = self.transport.read_json(remaining(deadline)?)?;
        route_server_message(message, &mut self.active_sources)
    }

    fn read_server_payload(
        &self,
        deadline: Instant,
    ) -> Result<DecodedHelperServerPayload, HelperTransportError> {
        let message: HelperServerMessage = self.transport.read_json(remaining(deadline)?)?;
        decode_server_message(message)
    }

    fn queue_event(&mut self, event: NativeHelperSourceEvent) -> Result<(), HelperTransportError> {
        let source_id = event_source_id(&event);
        self.active_sources
            .get(source_id)
            .ok_or(HelperProtocolError::Lifecycle)?;
        let mut event_counts =
            HelperEventBatchCounts::from_events(self.pending_events.iter(), source_id);
        if !event_counts.try_append(&event) {
            return Err(HelperProtocolError::Lifecycle.into());
        }
        self.pending_events.push_back(event);
        Ok(())
    }

    fn take_pending_events_for(&mut self, source_id: &str) -> Vec<NativeHelperSourceEvent> {
        let mut selected = Vec::new();
        let mut retained = VecDeque::with_capacity(self.pending_events.len());
        while let Some(event) = self.pending_events.pop_front() {
            if event_source_id(&event) == source_id {
                selected.push(event);
            } else {
                retained.push_back(event);
            }
        }
        self.pending_events = retained;
        selected
    }

    fn assert_usable(&self) -> Result<(), HelperTransportError> {
        ensure_helper_utility_usable()?;
        if self.fenced {
            Err(HelperTransportError::ConnectionFenced)
        } else {
            Ok(())
        }
    }

    fn finish_operation<T>(
        &mut self,
        result: Result<T, HelperTransportError>,
    ) -> Result<T, HelperTransportError> {
        match result {
            Ok(value) => Ok(value),
            Err(error) => self.fence().map_or_else(Err, |()| Err(error)),
        }
    }

    fn fence(&mut self) -> Result<(), HelperTransportError> {
        if self.fenced {
            ensure_helper_utility_usable()
        } else {
            self.fenced = true;
            self.active_sources.clear();
            self.pending_events.clear();
            fence_child_and_transport(&mut self.child, &mut self.transport)
        }
    }
}

fn event_source_id(event: &NativeHelperSourceEvent) -> &str {
    match event {
        NativeHelperSourceEvent::Observation(observation) => &observation.helper_source_instance_id,
        NativeHelperSourceEvent::Failure(failure) => &failure.helper_source_instance_id,
    }
}

#[derive(Clone, Copy, Default)]
struct HelperEventBatchCounts {
    observations: usize,
    failures_for_source: usize,
}

impl HelperEventBatchCounts {
    fn from_events<'a>(
        events: impl IntoIterator<Item = &'a NativeHelperSourceEvent>,
        failure_source_id: &str,
    ) -> Self {
        let mut counts = Self::default();
        for event in events {
            match event {
                NativeHelperSourceEvent::Observation(_) => counts.observations += 1,
                NativeHelperSourceEvent::Failure(_)
                    if event_source_id(event) == failure_source_id =>
                {
                    counts.failures_for_source += 1;
                }
                NativeHelperSourceEvent::Failure(_) => {}
            }
        }
        counts
    }

    const fn fits(self) -> bool {
        self.observations <= MAX_PENDING_HELPER_OBSERVATIONS && self.failures_for_source <= 1
    }

    fn try_append(&mut self, event: &NativeHelperSourceEvent) -> bool {
        if !self.fits() {
            return false;
        }
        match event {
            NativeHelperSourceEvent::Observation(_)
                if self.observations < MAX_PENDING_HELPER_OBSERVATIONS =>
            {
                self.observations += 1;
                true
            }
            NativeHelperSourceEvent::Failure(_) if self.failures_for_source == 0 => {
                self.failures_for_source = 1;
                true
            }
            NativeHelperSourceEvent::Observation(_) | NativeHelperSourceEvent::Failure(_) => false,
        }
    }
}

fn remaining(deadline: Instant) -> Result<Duration, HelperTransportError> {
    let remaining = deadline.saturating_duration_since(Instant::now());
    if remaining.is_zero() {
        Err(HelperTransportError::DeadlineExceeded)
    } else {
        Ok(remaining)
    }
}

fn route_server_message(
    message: HelperServerMessage,
    active_sources: &mut BTreeMap<String, ActiveHelperSource>,
) -> Result<HelperServerPayload, HelperTransportError> {
    match decode_server_message(message)? {
        DecodedHelperServerPayload::Snapshot(_) => Ok(HelperServerPayload::Snapshot),
        payload => Ok(HelperServerPayload::Event(route_server_event(
            payload,
            active_sources,
        )?)),
    }
}

fn decode_server_message(
    message: HelperServerMessage,
) -> Result<DecodedHelperServerPayload, HelperTransportError> {
    message.validate_protocol()?;
    match message.kind {
        HelperServerMessageKind::Snapshot => Ok(DecodedHelperServerPayload::Snapshot(
            message.snapshot.ok_or(HelperProtocolError::Snapshot)?,
        )),
        HelperServerMessageKind::Observation => {
            Ok(DecodedHelperServerPayload::Observation(Box::new(
                message
                    .observation
                    .ok_or(HelperProtocolError::Observation)?,
            )))
        }
        HelperServerMessageKind::Failure => Ok(DecodedHelperServerPayload::Failure(
            message.failure.ok_or(HelperProtocolError::Failure)?,
        )),
    }
}

fn route_server_event(
    payload: DecodedHelperServerPayload,
    active_sources: &mut BTreeMap<String, ActiveHelperSource>,
) -> Result<NativeHelperSourceEvent, HelperTransportError> {
    match payload {
        DecodedHelperServerPayload::Snapshot(_) => Err(HelperProtocolError::Lifecycle.into()),
        DecodedHelperServerPayload::Observation(observation) => {
            let source = active_sources
                .get_mut(&observation.helper_source_instance_id)
                .ok_or(HelperProtocolError::Lifecycle)?;
            source.fence.accept_observation(&observation)?;
            Ok(NativeHelperSourceEvent::Observation(observation))
        }
        DecodedHelperServerPayload::Failure(failure) => {
            let source = active_sources
                .get_mut(&failure.helper_source_instance_id)
                .ok_or(HelperProtocolError::Lifecycle)?;
            source.fence.accept_failure(&failure)?;
            match failure_disposition(failure.failure_code) {
                FailureDisposition::PreserveChannel => {
                    Ok(NativeHelperSourceEvent::Failure(failure))
                }
                FailureDisposition::FenceConnection => {
                    Err(HelperTransportError::SourceFailure(failure))
                }
                FailureDisposition::PoisonUtility => {
                    poison_helper_utility();
                    Err(HelperTransportError::UtilityPoisoned)
                }
            }
        }
    }
}

enum HelperServerPayload {
    Snapshot,
    Event(NativeHelperSourceEvent),
}

enum DecodedHelperServerPayload {
    Snapshot(HelperSourceSnapshot),
    Observation(Box<HelperObservation>),
    Failure(HelperSourceFailure),
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum FailureDisposition {
    PreserveChannel,
    FenceConnection,
    PoisonUtility,
}

const fn failure_disposition(code: HelperFailureCode) -> FailureDisposition {
    match code {
        HelperFailureCode::Cleanup => FailureDisposition::PoisonUtility,
        HelperFailureCode::Protocol => FailureDisposition::FenceConnection,
        HelperFailureCode::PermissionLost
        | HelperFailureCode::NativeEventLoss
        | HelperFailureCode::QueueOverflow
        | HelperFailureCode::InventoryOverflow
        | HelperFailureCode::Backend => FailureDisposition::PreserveChannel,
    }
}

struct DeadlineFramedTransport {
    writes: Option<SyncSender<WriteRequest>>,
    reads: Option<SyncSender<ReadRequest>>,
    writer_worker: FrameWorker,
    reader_worker: FrameWorker,
}

struct FrameWorker {
    completion: Receiver<()>,
    handle: Option<JoinHandle<()>>,
}

struct WriteRequest {
    bytes: Vec<u8>,
    response: SyncSender<Result<(), HelperTransportError>>,
}

struct ReadRequest {
    response: SyncSender<Result<Vec<u8>, HelperTransportError>>,
}

impl FrameWorker {
    fn spawn(
        name: &str,
        task: impl FnOnce() + Send + 'static,
    ) -> Result<Self, HelperTransportError> {
        let (completion_sender, completion) = mpsc::sync_channel(1);
        let handle = thread::Builder::new()
            .name(name.to_owned())
            .spawn(move || {
                task();
                let _ = completion_sender.send(());
            })?;
        Ok(Self {
            completion,
            handle: Some(handle),
        })
    }

    fn finish(&mut self, deadline: Instant) -> Result<(), ()> {
        let Some(handle) = self.handle.take() else {
            return Ok(());
        };
        match self.completion.try_recv() {
            Ok(()) | Err(mpsc::TryRecvError::Disconnected) => {
                return handle.join().map_err(|_panic_payload| ());
            }
            Err(mpsc::TryRecvError::Empty) => {}
        }
        let remaining = deadline.saturating_duration_since(Instant::now());
        if !remaining.is_zero() {
            match self.completion.recv_timeout(remaining) {
                Ok(()) | Err(mpsc::RecvTimeoutError::Disconnected) => {
                    return handle.join().map_err(|_panic_payload| ());
                }
                Err(mpsc::RecvTimeoutError::Timeout) => {}
            }
        }
        drop(handle);
        Err(())
    }
}

impl DeadlineFramedTransport {
    fn new(
        mut writer: impl Write + Send + 'static,
        mut reader: impl Read + Send + 'static,
    ) -> Result<Self, HelperTransportError> {
        let (write_sender, write_receiver) = mpsc::sync_channel::<WriteRequest>(1);
        let mut writer_worker = FrameWorker::spawn("prctr-helper-frame-writer", move || {
            while let Ok(request) = write_receiver.recv() {
                let result = write_frame(&mut writer, &request.bytes);
                let terminal = result.is_err();
                let _ = request.response.send(result);
                if terminal {
                    break;
                }
            }
        })?;
        let (read_sender, read_receiver) = mpsc::sync_channel::<ReadRequest>(1);
        let reader_worker = match FrameWorker::spawn("prctr-helper-frame-reader", move || {
            while let Ok(request) = read_receiver.recv() {
                let result = read_frame(&mut reader);
                let terminal = result.is_err();
                let _ = request.response.send(result);
                if terminal {
                    break;
                }
            }
        }) {
            Ok(worker) => worker,
            Err(error) => {
                drop(write_sender);
                if writer_worker
                    .finish(Instant::now() + HELPER_TERMINATION_DEADLINE)
                    .is_err()
                {
                    poison_helper_utility();
                    return Err(HelperTransportError::UtilityPoisoned);
                }
                return Err(error);
            }
        };
        Ok(Self {
            writes: Some(write_sender),
            reads: Some(read_sender),
            writer_worker,
            reader_worker,
        })
    }

    fn shutdown(&mut self) -> Result<(), HelperTransportError> {
        drop(self.writes.take());
        drop(self.reads.take());
        let deadline = Instant::now() + HELPER_TERMINATION_DEADLINE;
        let writer_result = self.writer_worker.finish(deadline);
        let reader_result = self.reader_worker.finish(deadline);
        if writer_result.is_err() || reader_result.is_err() {
            poison_helper_utility();
            Err(HelperTransportError::UtilityPoisoned)
        } else {
            Ok(())
        }
    }

    fn write_json(
        &self,
        value: &impl Serialize,
        timeout: Duration,
    ) -> Result<(), HelperTransportError> {
        let bytes = serde_json::to_vec(value)?;
        self.write_bytes(&bytes, timeout)
    }

    fn write_bytes(&self, bytes: &[u8], timeout: Duration) -> Result<(), HelperTransportError> {
        validate_helper_frame_size(bytes.len())?;
        let (response, result) = mpsc::sync_channel(1);
        self.writes
            .as_ref()
            .ok_or(HelperTransportError::ConnectionFenced)?
            .try_send(WriteRequest {
                bytes: bytes.to_vec(),
                response,
            })
            .map_err(|_error| HelperTransportError::ConnectionFenced)?;
        result.recv_timeout(timeout).map_err(|error| match error {
            mpsc::RecvTimeoutError::Timeout => HelperTransportError::DeadlineExceeded,
            mpsc::RecvTimeoutError::Disconnected => HelperTransportError::ConnectionFenced,
        })?
    }

    fn read_json<T: DeserializeOwned>(&self, timeout: Duration) -> Result<T, HelperTransportError> {
        let bytes = self.read_bytes(timeout)?;
        Ok(serde_json::from_slice(&bytes)?)
    }

    fn read_bytes(&self, timeout: Duration) -> Result<Vec<u8>, HelperTransportError> {
        let (response, result) = mpsc::sync_channel(1);
        self.reads
            .as_ref()
            .ok_or(HelperTransportError::ConnectionFenced)?
            .try_send(ReadRequest { response })
            .map_err(|_error| HelperTransportError::ConnectionFenced)?;
        result.recv_timeout(timeout).map_err(|error| match error {
            mpsc::RecvTimeoutError::Timeout => HelperTransportError::DeadlineExceeded,
            mpsc::RecvTimeoutError::Disconnected => HelperTransportError::ConnectionFenced,
        })?
    }
}

impl Drop for DeadlineFramedTransport {
    fn drop(&mut self) {
        let _ = self.shutdown();
    }
}

impl Drop for NativeHelperConnection {
    fn drop(&mut self) {
        let _ = self.fence();
    }
}

fn fence_child_and_transport(
    child: &mut Child,
    transport: &mut DeadlineFramedTransport,
) -> Result<(), HelperTransportError> {
    let child_result = terminate_child(child);
    let transport_result = transport.shutdown();
    match (child_result, transport_result) {
        (_, Err(error)) | (Err(error), Ok(())) => Err(error),
        (Ok(()), Ok(())) => Ok(()),
    }
}

fn terminate_child(child: &mut Child) -> Result<(), HelperTransportError> {
    match child.try_wait() {
        Ok(Some(_status)) => return Ok(()),
        Ok(None) => {}
        Err(_error) => return poison_after_termination_failure(),
    }
    if child.kill().is_err() {
        match child.try_wait() {
            Ok(Some(_status)) => return Ok(()),
            Ok(None) | Err(_) => return poison_after_termination_failure(),
        }
    }
    let deadline = Instant::now() + HELPER_TERMINATION_DEADLINE;
    while Instant::now() < deadline {
        match child.try_wait() {
            Ok(Some(_status)) => return Ok(()),
            Ok(None) => thread::sleep(Duration::from_millis(5)),
            Err(_error) => return poison_after_termination_failure(),
        }
    }
    match child.try_wait() {
        Ok(Some(_status)) => Ok(()),
        Ok(None) | Err(_) => poison_after_termination_failure(),
    }
}

fn poison_after_termination_failure() -> Result<(), HelperTransportError> {
    poison_helper_utility();
    Err(HelperTransportError::ChildTermination)
}

fn ensure_helper_utility_usable() -> Result<(), HelperTransportError> {
    if HELPER_UTILITY_POISONED.load(Ordering::Acquire) {
        Err(HelperTransportError::UtilityPoisoned)
    } else {
        Ok(())
    }
}

fn poison_helper_utility() {
    HELPER_UTILITY_POISONED.store(true, Ordering::Release);
}

/// Serializes one bounded JSON value and writes it as a size-prefixed frame.
///
/// # Errors
///
/// Returns a serialization, frame-size, or transport I/O error.
pub fn write_json_frame(
    writer: &mut impl Write,
    value: &impl Serialize,
) -> Result<(), HelperTransportError> {
    let bytes = serde_json::to_vec(value)?;
    write_frame(writer, &bytes)
}

/// Reads one bounded size-prefixed frame and deserializes its JSON value.
///
/// # Errors
///
/// Returns a frame-size, transport I/O, or deserialization error.
pub fn read_json_frame<T: DeserializeOwned>(
    reader: &mut impl Read,
) -> Result<T, HelperTransportError> {
    let bytes = read_frame(reader)?;
    Ok(serde_json::from_slice(&bytes)?)
}

/// Writes one non-empty bounded byte frame using a big-endian length prefix.
///
/// # Errors
///
/// Returns a frame-size or transport I/O error.
pub fn write_frame(writer: &mut impl Write, bytes: &[u8]) -> Result<(), HelperTransportError> {
    validate_helper_frame_size(bytes.len())?;
    let length = u32::try_from(bytes.len())
        .map_err(|_error| HelperTransportError::Protocol(HelperProtocolError::FrameSize))?;
    writer.write_all(&length.to_be_bytes())?;
    writer.write_all(bytes)?;
    writer.flush()?;
    Ok(())
}

/// Reads one non-empty bounded byte frame after validating its length prefix.
///
/// # Errors
///
/// Returns a frame-size or transport I/O error.
pub fn read_frame(reader: &mut impl Read) -> Result<Vec<u8>, HelperTransportError> {
    let mut prefix = [0_u8; 4];
    reader.read_exact(&mut prefix)?;
    let length = usize::try_from(u32::from_be_bytes(prefix))
        .map_err(|_error| HelperTransportError::Protocol(HelperProtocolError::FrameSize))?;
    validate_helper_frame_size(length)?;
    let mut bytes = vec![0_u8; length];
    reader.read_exact(&mut bytes)?;
    Ok(bytes)
}

fn run_startup_task<T: Send + 'static>(
    name: &str,
    deadline: Instant,
    task: impl FnOnce() -> Result<T, HelperTransportError> + Send + 'static,
) -> Result<T, HelperTransportError> {
    remaining(deadline)?;
    let (sender, receiver) = mpsc::sync_channel(1);
    let worker = thread::Builder::new()
        .name(name.to_owned())
        .spawn(move || {
            let _ = sender.send(task());
        })?;
    let wait = match remaining(deadline) {
        Ok(wait) => wait,
        Err(error) => {
            poison_helper_utility();
            drop(worker);
            return Err(error);
        }
    };
    match receiver.recv_timeout(wait) {
        Ok(result) => {
            if worker.join().is_err() {
                poison_helper_utility();
                Err(HelperTransportError::UtilityPoisoned)
            } else {
                result
            }
        }
        Err(mpsc::RecvTimeoutError::Timeout) => {
            poison_helper_utility();
            drop(worker);
            Err(HelperTransportError::DeadlineExceeded)
        }
        Err(mpsc::RecvTimeoutError::Disconnected) => {
            poison_helper_utility();
            let _ = worker.join();
            Err(HelperTransportError::UtilityPoisoned)
        }
    }
}

fn spawn_helper_before_deadline(
    executable: &std::path::Path,
    deadline: Instant,
) -> Result<Child, HelperTransportError> {
    remaining(deadline)?;
    let executable = executable.to_owned();
    let (sender, receiver) = mpsc::sync_channel(1);
    let worker = thread::Builder::new()
        .name("prctr-helper-spawn".to_owned())
        .spawn(move || {
            let result = Command::new(executable)
                .env_clear()
                .stdin(Stdio::piped())
                .stdout(Stdio::piped())
                .stderr(Stdio::null())
                .spawn()
                .map_err(HelperTransportError::Io);
            if let Err(mpsc::SendError(Ok(mut child))) = sender.send(result) {
                let _ = terminate_child(&mut child);
            }
        })?;
    let wait = match remaining(deadline) {
        Ok(wait) => wait,
        Err(error) => {
            poison_helper_utility();
            drop(worker);
            return Err(error);
        }
    };
    match receiver.recv_timeout(wait) {
        Ok(result) => {
            if worker.join().is_err() {
                poison_helper_utility();
                Err(HelperTransportError::UtilityPoisoned)
            } else {
                result
            }
        }
        Err(mpsc::RecvTimeoutError::Timeout) => {
            poison_helper_utility();
            drop(worker);
            Err(HelperTransportError::DeadlineExceeded)
        }
        Err(mpsc::RecvTimeoutError::Disconnected) => {
            poison_helper_utility();
            let _ = worker.join();
            Err(HelperTransportError::UtilityPoisoned)
        }
    }
}

fn verify_packaged_helper(
    configuration: &HelperLaunchConfiguration,
    deadline: Instant,
) -> Result<VerifiedPackagedHelper, HelperTransportError> {
    let executable = configuration.executable.canonicalize()?;
    if executable != configuration.executable || !executable.is_file() {
        return Err(HelperTransportError::ExecutableIdentity);
    }
    #[cfg(target_os = "macos")]
    {
        let requirement = configuration
            .macos_designated_requirement
            .as_deref()
            .ok_or(HelperTransportError::ExecutableIdentity)?;
        if requirement.is_empty() || requirement.len() > 2_048 {
            return Err(HelperTransportError::ExecutableIdentity);
        }
        let mut codesign = Command::new("/usr/bin/codesign")
            .args([
                "--verify",
                "--strict",
                &format!("-R={requirement}"),
                executable
                    .to_str()
                    .ok_or(HelperTransportError::ExecutableIdentity)?,
            ])
            .env_clear()
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()?;
        let status = loop {
            if let Some(status) = codesign.try_wait()? {
                break status;
            }
            if remaining(deadline).is_err() {
                return terminate_child(&mut codesign)
                    .map_or_else(Err, |()| Err(HelperTransportError::DeadlineExceeded));
            }
            thread::sleep(Duration::from_millis(5));
        };
        if !status.success() {
            return Err(HelperTransportError::ExecutableIdentity);
        }
        Ok(VerifiedPackagedHelper {
            peer: VerifiedHelperPeer {
                helper_kind: prctr_native_helper_protocol::HelperKind::MacosEndpointSecurityHelper,
                helper_build_id: configuration.expected_helper_build_id.clone(),
                capabilities: configuration.expected_capabilities.clone(),
            },
        })
    }
    #[cfg(target_os = "windows")]
    {
        remaining(deadline)?;
        let digest = configuration
            .windows_executable_sha256
            .as_deref()
            .ok_or(HelperTransportError::ExecutableIdentity)?;
        let locked_executable = windows::lock_and_verify_executable(&executable, digest)?;
        Ok(VerifiedPackagedHelper {
            peer: VerifiedHelperPeer {
                helper_kind: prctr_native_helper_protocol::HelperKind::WindowsSecurityService,
                helper_build_id: configuration.expected_helper_build_id.clone(),
                capabilities: configuration.expected_capabilities.clone(),
            },
            locked_executable,
        })
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        let _ = (executable, deadline);
        Err(HelperTransportError::UnsupportedPlatform)
    }
}

fn verify_spawned_helper(
    configuration: &HelperLaunchConfiguration,
    process_id: u32,
    verified: &VerifiedPackagedHelper,
) -> Result<(), HelperTransportError> {
    #[cfg(target_os = "windows")]
    {
        windows::verify_spawned_image(
            process_id,
            &configuration.executable,
            &verified.locked_executable,
        )
    }
    #[cfg(target_os = "macos")]
    {
        let _ = verified;
        let requirement = configuration
            .macos_designated_requirement
            .as_deref()
            .ok_or(HelperTransportError::ExecutableIdentity)?;
        macos::verify_spawned_code(process_id, requirement)
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        let _ = (configuration, process_id, verified);
        Err(HelperTransportError::UnsupportedPlatform)
    }
}

fn generate_channel_nonce() -> Result<String, HelperTransportError> {
    let mut bytes = [0_u8; 32];
    #[cfg(target_os = "windows")]
    windows::fill_random(&mut bytes)?;
    #[cfg(not(target_os = "windows"))]
    {
        std::fs::File::open("/dev/urandom")?.read_exact(&mut bytes)?;
    }
    let mut nonce = String::with_capacity(64);
    for byte in bytes {
        write!(nonce, "{byte:02x}").map_err(|_error| HelperTransportError::ExecutableIdentity)?;
    }
    Ok(nonce)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;
    use std::sync::{Arc, mpsc::Receiver};

    use prctr_native_helper_protocol::{
        HELPER_PROTOCOL_VERSION, HelperEventClass, HelperKind, MAX_HELPER_FRAME_BYTES,
    };
    use prctr_native_protocol::{
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
        while !worker.handle.as_ref().expect("worker handle").is_finished() {
            thread::yield_now();
        }
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
            child,
            transport: DeadlineFramedTransport::new(Vec::<u8>::new(), reader)
                .expect("test transport"),
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
}
