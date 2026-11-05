#![deny(unsafe_code)]

use std::cell::RefCell;
use std::collections::{BTreeMap, VecDeque};
use std::fmt;
use std::fmt::Write as _;
use std::io::{self, Read, Write};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{self, Receiver, SyncSender};
use std::thread;
use std::time::{Duration, Instant};

use native_helper_protocol::{
    HelperFailureCode, HelperObservation, HelperProtocolError, HelperServerMessage,
    HelperServerMessageKind, HelperSourceClose, HelperSourceFailure, HelperSourceFence,
    HelperSourceKind, HelperSourceOpen, HelperSourceSnapshot, VerifiedHelperChannel,
    VerifiedHelperPeer, bind_verified_helper_channel, validate_helper_frame_size,
};
use native_protocol::{
    HelperClientMessage, HelperClientMessageKind, HelperHandshake, ProtocolValidatable,
    ProtocolValidationError,
};
use serde::Serialize;
use serde::de::DeserializeOwned;

#[cfg(any(target_os = "windows", test))]
mod service_accept;
#[cfg(target_os = "windows")]
#[allow(unsafe_code)]
mod windows;
#[cfg(target_os = "windows")]
#[allow(unsafe_code)]
mod windows_launch_closure;
#[cfg(any(target_os = "windows", test))]
mod windows_launch_manifest;
#[cfg(any(target_os = "windows", test))]
mod windows_lifecycle_checks;
#[cfg(any(target_os = "windows", test))]
mod windows_service_package;
#[cfg(target_os = "windows")]
pub use windows_launch_closure::WindowsProtectedLaunchClosure;
#[cfg(target_os = "windows")]
pub use windows_service_package::{WindowsServicePackage, packaged_windows_service_configuration};
#[cfg(target_os = "windows")]
#[allow(unsafe_code)]
mod windows_peer;
#[cfg(target_os = "windows")]
#[allow(unsafe_code)]
mod windows_pipe;
#[cfg(target_os = "windows")]
pub use windows_pipe::{
    WindowsPipeReader, WindowsPipeWriter, WindowsServicePipe,
    accept as accept_windows_service_pipe, create_listener as create_windows_service_listener,
};
#[cfg(target_os = "windows")]
#[allow(unsafe_code)]
mod windows_scm;
#[cfg(target_os = "windows")]
pub use windows_launch_manifest::{WindowsLaunchFile, WindowsLaunchManifest};
#[cfg(target_os = "windows")]
pub use windows_peer::{
    WindowsLaunchUser, candidate_session_for_verified_pipe_peer, user_for_windows_launch_request,
};
#[cfg(target_os = "windows")]
#[allow(unsafe_code)]
mod windows_controlled_client;
#[cfg(target_os = "windows")]
pub use windows_controlled_client::WindowsControlledClient;
#[cfg(target_os = "windows")]
pub use windows_scm::{WINDOWS_SERVICE_NAME, WindowsServiceBody, run_windows_service};

#[cfg(target_os = "windows")]
mod windows_service_connection;
#[cfg(target_os = "windows")]
#[allow(unsafe_code)]
mod windows_service_installation;
#[cfg(target_os = "windows")]
pub use windows_service_connection::{
    WINDOWS_LAUNCH_REQUEST, WINDOWS_SOURCE_REQUEST, WindowsConfiguredService, WindowsSourceChannel,
    WindowsSourceHandler,
};

#[cfg(target_os = "macos")]
#[allow(unsafe_code)]
mod macos;
#[cfg(target_os = "macos")]
pub use macos::{
    activated_macos_service_listeners, require_macos_service_privilege,
    verify_candidate_socket_peer, verify_same_macos_socket_peer, verify_service_socket_peer,
};

#[cfg(target_os = "macos")]
mod macos_service;
#[cfg(target_os = "macos")]
pub use macos_service::{
    HELPER_SERVICE_FRAME_BYTES, MACOS_SERVICE_ACCEPTANCE_FRAME,
    MacOsServiceConnectionConfiguration, MacOsServicePackage, PrivilegedMacOsWorker,
    launch_macos_service_worker, packaged_macos_service_configuration,
    verify_candidate_socket_peer_under_deadline,
};

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
    owner: HelperOwner,
    transport: DeadlineFramedTransport,
    channel: VerifiedHelperChannel,
    active_sources: BTreeMap<String, ActiveHelperSource>,
    pending_events: VecDeque<NativeHelperSourceEvent>,
    fenced: bool,
}

enum HelperOwner {
    Child(Child),
    #[cfg(target_os = "macos")]
    Service(macos_service::ConnectedService),
}

impl HelperOwner {
    fn terminate(&mut self) -> Result<(), HelperTransportError> {
        match self {
            Self::Child(child) => terminate_child(child),
            #[cfg(target_os = "macos")]
            Self::Service(service) => service.terminate(),
        }
    }
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
    /// Builds a source request from the authenticated channel's authority.
    /// # Errors
    /// Rejects invalid identifiers, capacities or unnegotiated source kinds.
    pub fn make_source_request(
        &self,
        kind: HelperSourceKind,
        instance_id: String,
        capacity: u16,
    ) -> Result<HelperSourceOpen, HelperTransportError> {
        self.assert_usable()?;
        let (schema_version, event_classes) = match kind {
            HelperSourceKind::ProcessApplication => (
                native_protocol::PROCESS_APPLICATION_SCHEMA_VERSION,
                vec![
                    native_protocol::HelperEventClass::ProcessLifecycle,
                    native_protocol::HelperEventClass::ProcessIdentity,
                ],
            ),
            HelperSourceKind::InteractiveSession => (
                native_protocol::INTERACTIVE_SESSION_SCHEMA_VERSION,
                vec![native_protocol::HelperEventClass::InteractiveSessionLifecycle],
            ),
        };
        let request = HelperSourceOpen {
            protocol_version: native_helper_protocol::HELPER_PROTOCOL_VERSION,
            channel_nonce: self.channel.channel_nonce().to_owned(),
            helper_source_instance_id: instance_id,
            source_kind: kind,
            schema_version,
            queue_capacity: capacity,
            event_classes,
        };
        self.channel.open_source(&request)?;
        Ok(request)
    }

    /// Builds a close request for an existing authenticated source.
    /// # Errors
    /// Rejects an inactive source or fenced connection.
    pub fn make_source_close(
        &self,
        instance_id: &str,
    ) -> Result<HelperSourceClose, HelperTransportError> {
        self.assert_usable()?;
        if !self.active_sources.contains_key(instance_id) {
            return Err(HelperProtocolError::Lifecycle.into());
        }
        Ok(HelperSourceClose {
            protocol_version: native_helper_protocol::HELPER_PROTOCOL_VERSION,
            channel_nonce: self.channel.channel_nonce().to_owned(),
            helper_source_instance_id: instance_id.to_owned(),
        })
    }

    /// Proves owner termination and closes all framing workers.
    /// # Errors
    /// Missing termination proof poisons the utility rather than allowing reuse.
    pub fn close_connection(&mut self) -> Result<(), HelperTransportError> {
        self.fence()
    }

    /// Polls one event without treating an idle source as a deadline failure.
    /// A partially received frame still has a fixed completion deadline.
    /// # Errors
    /// Rejects malformed, out-of-order, stalled or failed source messages.
    pub fn poll_event(&mut self) -> Result<Option<NativeHelperSourceEvent>, HelperTransportError> {
        let result = (|| {
            self.assert_usable()?;
            if let Some(event) = self.pending_events.pop_front() {
                return Ok(Some(event));
            }
            let Some(bytes) = self.transport.poll_read_bytes(Duration::ZERO)? else {
                return Ok(None);
            };
            let message = serde_json::from_slice(&bytes)?;
            match route_server_message(message, &mut self.active_sources)? {
                HelperServerPayload::Event(event) => Ok(Some(event)),
                HelperServerPayload::Snapshot => Err(HelperProtocolError::Lifecycle.into()),
            }
        })();
        self.finish_operation(result)
    }
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
                owner: HelperOwner::Child(child),
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

    /// Connects to the packaged privileged supervisor and binds its separately
    /// owned observation worker. A socket disconnect is never worker-exit proof.
    ///
    /// # Errors
    /// Rejects unavailable, unauthenticated, stale or unresponsive service peers.
    #[cfg(target_os = "macos")]
    pub fn connect_macos_service(
        configuration: MacOsServiceConnectionConfiguration,
    ) -> Result<Self, HelperTransportError> {
        macos_service::connect(configuration)
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
            let owner = self.owner.terminate();
            let transport = self.transport.shutdown();
            match (owner, transport) {
                (_, Err(error)) | (Err(error), Ok(())) => Err(error),
                (Ok(()), Ok(())) => Ok(()),
            }
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
    pending_read: RefCell<Option<PendingRead>>,
}

struct PendingRead {
    response: Receiver<CompletedRead>,
    started: Receiver<Instant>,
    frame_deadline: Option<Instant>,
}

struct CompletedRead {
    completed_at: Instant,
    result: Result<Vec<u8>, HelperTransportError>,
}

impl PendingRead {
    fn refresh_deadline(&mut self) {
        if self.frame_deadline.is_none()
            && let Ok(started) = self.started.try_recv()
        {
            self.frame_deadline = Some(started + HELPER_REQUEST_DEADLINE);
        }
    }
}

struct FrameWorker {
    join: Option<WorkerJoinReceipt>,
}

struct WriteRequest {
    bytes: Vec<u8>,
    response: SyncSender<Result<(), HelperTransportError>>,
}

struct ReadRequest {
    response: SyncSender<CompletedRead>,
    started: SyncSender<Instant>,
}

impl FrameWorker {
    fn spawn(
        name: &str,
        task: impl FnOnce() + Send + 'static,
    ) -> Result<Self, HelperTransportError> {
        Ok(Self {
            join: Some(WorkerJoinReceipt::spawn(name, task)?),
        })
    }

    fn finish(&mut self, deadline: Instant) -> Result<(), ()> {
        self.join
            .take()
            .map_or(Ok(()), |mut join| join.wait(deadline).map_err(|_error| ()))
    }
}

impl DeadlineFramedTransport {
    fn new(
        writer: impl Write + Send + 'static,
        reader: impl Read + Send + 'static,
    ) -> Result<Self, HelperTransportError> {
        Self::new_bounded(
            writer,
            reader,
            native_helper_protocol::MAX_HELPER_FRAME_BYTES,
        )
    }

    fn new_bounded(
        mut writer: impl Write + Send + 'static,
        mut reader: impl Read + Send + 'static,
        maximum_bytes: usize,
    ) -> Result<Self, HelperTransportError> {
        validate_helper_frame_size(maximum_bytes)?;
        let (write_sender, write_receiver) = mpsc::sync_channel::<WriteRequest>(1);
        let mut writer_worker = FrameWorker::spawn("prctr-helper-frame-writer", move || {
            while let Ok(request) = write_receiver.recv() {
                let result = if request.bytes.len() > maximum_bytes {
                    Err(HelperProtocolError::FrameSize.into())
                } else {
                    write_frame(&mut writer, &request.bytes)
                };
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
                let result = read_frame_started(&mut reader, maximum_bytes, &request.started);
                let terminal = result.is_err();
                let _ = request.response.send(CompletedRead {
                    completed_at: Instant::now(),
                    result,
                });
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
            pending_read: RefCell::new(None),
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
        let deadline = Instant::now() + timeout;
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
        let result = result
            .recv_timeout(remaining(deadline)?)
            .map_err(|error| match error {
                mpsc::RecvTimeoutError::Timeout => HelperTransportError::DeadlineExceeded,
                mpsc::RecvTimeoutError::Disconnected => HelperTransportError::ConnectionFenced,
            })?;
        remaining(deadline)?;
        result
    }

    fn read_json<T: DeserializeOwned>(&self, timeout: Duration) -> Result<T, HelperTransportError> {
        let bytes = self.read_bytes(timeout)?;
        Ok(serde_json::from_slice(&bytes)?)
    }

    fn read_bytes(&self, timeout: Duration) -> Result<Vec<u8>, HelperTransportError> {
        let deadline = Instant::now() + timeout;
        let result = self.poll_read_bytes(remaining(deadline)?)?;
        remaining(deadline)?;
        result.ok_or(HelperTransportError::DeadlineExceeded)
    }

    fn poll_read_bytes(&self, timeout: Duration) -> Result<Option<Vec<u8>>, HelperTransportError> {
        let mut pending = self.pending_read.borrow_mut();
        if pending.is_none() {
            let (response, result) = mpsc::sync_channel(1);
            let (started, progress) = mpsc::sync_channel(1);
            self.reads
                .as_ref()
                .ok_or(HelperTransportError::ConnectionFenced)?
                .try_send(ReadRequest { response, started })
                .map_err(|_error| HelperTransportError::ConnectionFenced)?;
            *pending = Some(PendingRead {
                response: result,
                started: progress,
                frame_deadline: None,
            });
        }
        let read = pending
            .as_mut()
            .ok_or(HelperTransportError::ConnectionFenced)?;
        read.refresh_deadline();
        let wait = match read.frame_deadline {
            Some(deadline) => timeout.min(deadline.saturating_duration_since(Instant::now())),
            None => timeout,
        };
        let response = read.response.recv_timeout(wait);
        // The first byte may arrive while waiting for the completed frame.
        read.refresh_deadline();
        match response {
            Ok(completed) => {
                let deadline = read.frame_deadline;
                *pending = None;
                if deadline.is_some_and(|deadline| completed.completed_at > deadline) {
                    return Err(HelperTransportError::DeadlineExceeded);
                }
                if completed.result.is_ok() && deadline.is_none() {
                    return Err(HelperTransportError::ConnectionFenced);
                }
                completed.result.map(Some)
            }
            Err(mpsc::RecvTimeoutError::Timeout) => {
                if let Some(deadline) = read.frame_deadline {
                    remaining(deadline)?;
                }
                Ok(None)
            }
            Err(mpsc::RecvTimeoutError::Disconnected) => {
                *pending = None;
                Err(HelperTransportError::ConnectionFenced)
            }
        }
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

/// Checks the process-wide helper ownership fence before admitting more work.
/// # Errors
/// A failed cleanup or overdue worker requires process replacement.
pub fn ensure_helper_utility_usable() -> Result<(), HelperTransportError> {
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
    read_frame_bounded(reader, native_helper_protocol::MAX_HELPER_FRAME_BYTES)
}

/// Reads a frame with a caller-owned smaller boundary, before allocating payload.
///
/// # Errors
/// Rejects invalid bounds, excessive prefixes and incomplete I/O.
pub fn read_frame_bounded(
    reader: &mut impl Read,
    maximum_bytes: usize,
) -> Result<Vec<u8>, HelperTransportError> {
    validate_helper_frame_size(maximum_bytes)?;
    let mut prefix = [0_u8; 4];
    reader.read_exact(&mut prefix)?;
    let length = usize::try_from(u32::from_be_bytes(prefix))
        .map_err(|_error| HelperTransportError::Protocol(HelperProtocolError::FrameSize))?;
    validate_helper_frame_size(length)?;
    if length > maximum_bytes {
        return Err(HelperProtocolError::FrameSize.into());
    }
    let mut bytes = vec![0_u8; length];
    reader.read_exact(&mut bytes)?;
    Ok(bytes)
}

fn read_frame_started(
    reader: &mut impl Read,
    maximum_bytes: usize,
    started: &SyncSender<Instant>,
) -> Result<Vec<u8>, HelperTransportError> {
    let mut prefix = [0_u8; 4];
    reader.read_exact(&mut prefix[..1])?;
    let _ = started.try_send(Instant::now());
    reader.read_exact(&mut prefix[1..])?;
    let length =
        usize::try_from(u32::from_be_bytes(prefix)).map_err(|_| HelperProtocolError::FrameSize)?;
    validate_helper_frame_size(length)?;
    if length > maximum_bytes {
        return Err(HelperProtocolError::FrameSize.into());
    }
    let mut bytes = vec![0; length];
    reader.read_exact(&mut bytes)?;
    Ok(bytes)
}

/// A receipt for the resource-owning thread's actual join, including TLS drops.
/// The bounded waiter owns no SDK state and only joins once, then sends one
/// acknowledgement. No caller joins that waiter or assumes `is_finished` proves
/// native cleanup. A missed acknowledgement poisons the utility; it cannot start
/// replacement workers while either original thread might still be running.
struct WorkerJoinReceipt {
    completion: Receiver<Result<(), ()>>,
    observed: Option<Result<(), ()>>,
}

impl WorkerJoinReceipt {
    fn spawn(
        name: &str,
        task: impl FnOnce() + Send + 'static,
    ) -> Result<Self, HelperTransportError> {
        let (start, gate) = mpsc::sync_channel(1);
        let worker = thread::Builder::new()
            .name(name.to_owned())
            .spawn(move || {
                if gate.recv().is_ok() {
                    task();
                }
            })?;
        let (acknowledge, completion) = mpsc::sync_channel(1);
        // Establish the join owner before releasing work. If its creation fails,
        // dropping the gate prevents SDK calls or an unowned spawned Child.
        if thread::Builder::new()
            .name("prctr-worker-join".to_owned())
            .spawn(move || {
                let joined = worker.join().map_err(|_panic_payload| ());
                let _ = acknowledge.send(joined);
            })
            .is_err()
        {
            poison_helper_utility();
            return Err(HelperTransportError::UtilityPoisoned);
        }
        start.send(()).map_err(|_disconnected| {
            poison_helper_utility();
            HelperTransportError::UtilityPoisoned
        })?;
        Ok(Self {
            completion,
            observed: None,
        })
    }

    fn wait(&mut self, deadline: Instant) -> Result<(), HelperTransportError> {
        if let Some(joined) = self.observed {
            return joined.map_err(|()| HelperTransportError::UtilityPoisoned);
        }
        let joined = match self.completion.try_recv() {
            Ok(joined) => joined,
            Err(mpsc::TryRecvError::Disconnected) => {
                return Err(HelperTransportError::UtilityPoisoned);
            }
            Err(mpsc::TryRecvError::Empty) => self
                .completion
                .recv_timeout(remaining(deadline)?)
                .map_err(|error| match error {
                    mpsc::RecvTimeoutError::Timeout => HelperTransportError::DeadlineExceeded,
                    mpsc::RecvTimeoutError::Disconnected => HelperTransportError::UtilityPoisoned,
                })?,
        };
        self.observed = Some(joined);
        joined.map_err(|()| HelperTransportError::UtilityPoisoned)
    }
}

fn run_startup_task<T: Send + 'static>(
    name: &str,
    deadline: Instant,
    task: impl FnOnce() -> Result<T, HelperTransportError> + Send + 'static,
) -> Result<T, HelperTransportError> {
    remaining(deadline)?;
    let (sender, receiver) = mpsc::sync_channel(1);
    let mut worker = WorkerJoinReceipt::spawn(name, move || {
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
            if let Err(error) = worker.wait(deadline) {
                poison_helper_utility();
                drop(result);
                Err(error)
            } else if let Err(error) = remaining(deadline) {
                poison_helper_utility();
                drop(result);
                Err(error)
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
            let _ = worker.wait(deadline);
            Err(HelperTransportError::UtilityPoisoned)
        }
    }
}

/// Retains kill-and-observed-exit ownership even while a successful spawn result
/// is buffered in a channel whose receiver can time out before consuming it.
struct PendingSpawnedChild(Option<Child>);

impl PendingSpawnedChild {
    fn into_child(mut self) -> Child {
        self.0.take().expect("owned spawned child")
    }

    fn terminate(mut self) -> Result<(), HelperTransportError> {
        self.0
            .take()
            .map_or(Ok(()), |mut child| terminate_child(&mut child))
    }
}

impl Drop for PendingSpawnedChild {
    fn drop(&mut self) {
        if let Some(mut child) = self.0.take() {
            let _ = terminate_child(&mut child);
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
    let mut worker = WorkerJoinReceipt::spawn("prctr-helper-spawn", move || {
        let result = Command::new(executable)
            .env_clear()
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .map(|child| PendingSpawnedChild(Some(child)))
            .map_err(HelperTransportError::Io);
        // Both a failed send and a successful but abandoned buffered result drop
        // the ownership guard, terminating and observing the exact child.
        let _ = sender.send(result);
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
            if let Err(error) = worker.wait(deadline) {
                poison_helper_utility();
                if let Ok(child) = result {
                    child.terminate()?;
                }
                Err(error)
            } else if let Err(error) = remaining(deadline) {
                poison_helper_utility();
                if let Ok(child) = result {
                    child.terminate()?;
                }
                Err(error)
            } else {
                result.map(PendingSpawnedChild::into_child)
            }
        }
        Err(mpsc::RecvTimeoutError::Timeout) => {
            poison_helper_utility();
            drop(worker);
            Err(HelperTransportError::DeadlineExceeded)
        }
        Err(mpsc::RecvTimeoutError::Disconnected) => {
            poison_helper_utility();
            let _ = worker.wait(deadline);
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
                helper_kind: native_helper_protocol::HelperKind::MacosEndpointSecurityHelper,
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
                helper_kind: native_helper_protocol::HelperKind::WindowsSecurityService,
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

#[cfg(test)]
mod framed_transport_tests;
