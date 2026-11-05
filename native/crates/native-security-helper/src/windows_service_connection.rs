//! Fixed controlled-client service owner. No endpoint accepts launch parameters.
//! Installed-role verification on the main side remains a separate prerequisite;
//! this API does not turn a pipe name or a server PID into executable identity.
use std::path::PathBuf;
use std::sync::Arc;
use std::time::{Duration, Instant};

use interactive_session_state::{WindowsCandidateSession, WindowsWtsServiceDispatcher};
use native_helper_protocol::{HelperClientMessage, HelperHandshake, HelperServerMessage};
use native_protocol::ProtocolValidatable;

use crate::{
    DeadlineFramedTransport, HELPER_STARTUP_DEADLINE, HelperTransportError,
    WindowsControlledClient, WindowsLaunchManifest, WindowsProtectedLaunchClosure,
    WindowsServiceBody, WindowsServicePipe, ensure_helper_utility_usable, generate_channel_nonce,
    remaining, run_startup_task,
};

/// Length-prefixed literal requests. They carry no identity, path, arguments,
/// session, digest or nonce. The OS pipe token supplies the launch user's logon.
pub const WINDOWS_LAUNCH_REQUEST: &[u8] = b"proctor-native-launch/1";
pub const WINDOWS_SOURCE_REQUEST: &[u8] = b"proctor-native-sources/1";
const POLL: Duration = Duration::from_millis(5);

/// Owns pipe cancellation before joining the existing bounded frame workers.
struct ServiceFrames {
    pipe: WindowsServicePipe,
    transport: DeadlineFramedTransport,
}
impl ServiceFrames {
    fn new(pipe: WindowsServicePipe) -> Result<Self, HelperTransportError> {
        let transport = DeadlineFramedTransport::new(pipe.writer(), pipe.reader())?;
        Ok(Self { pipe, transport })
    }
    fn close(&mut self) -> Result<(), HelperTransportError> {
        self.pipe.shutdown();
        self.transport.shutdown()?;
        ensure_helper_utility_usable()
    }
}
impl Drop for ServiceFrames {
    fn drop(&mut self) {
        let _ = self.close();
    }
}

/// An exact controlled main process has already authenticated this connection.
/// The owner retains its executable closure, process/job and original logon
/// until all sources and frame workers close. Raw handles never enter messages.
pub struct WindowsSourceChannel {
    frames: ServiceFrames,
    client: WindowsControlledClient,
    dispatcher: Arc<WindowsWtsServiceDispatcher>,
    nonce: String,
}
impl WindowsSourceChannel {
    #[must_use]
    pub fn channel_nonce(&self) -> &str {
        &self.nonce
    }

    /// # Errors
    /// Returns kernel/process failure; stop and process exit fence further input.
    pub fn stopping(&self) -> Result<bool, HelperTransportError> {
        Ok(self.dispatcher.stop_requested() || self.client.has_exited()?)
    }

    /// Quiet channels do not expire; once the first frame byte arrives, the
    /// shared framing owner enforces its absolute completion deadline.
    /// # Errors
    /// Invalid frames, expired partial frames, stopped owners and disconnected peers fail closed.
    pub fn poll(&self) -> Result<Option<HelperClientMessage>, HelperTransportError> {
        if self.stopping()? {
            return Err(HelperTransportError::ConnectionFenced);
        }
        let bytes = self.frames.transport.poll_read_bytes(POLL)?;
        if self.stopping()? {
            return Err(HelperTransportError::ConnectionFenced);
        }
        bytes
            .map(|bytes| {
                let message: HelperClientMessage = serde_json::from_slice(&bytes)?;
                message.validate_protocol()?;
                Ok(message)
            })
            .transpose()
    }

    /// # Errors
    /// Handshake validation, stop fencing or bounded frame delivery can fail.
    pub fn handshake(&self, handshake: &HelperHandshake) -> Result<(), HelperTransportError> {
        handshake.validate_protocol()?;
        if handshake.channel_nonce != self.nonce || self.stopping()? {
            return Err(HelperTransportError::ConnectionFenced);
        }
        self.frames
            .transport
            .write_json(handshake, crate::HELPER_REQUEST_DEADLINE)
    }

    /// # Errors
    /// Invalid messages, stopped owners and delivery failure fence the connection.
    pub fn send(&self, message: &HelperServerMessage) -> Result<(), HelperTransportError> {
        message.validate_protocol()?;
        if self.stopping()? {
            return Err(HelperTransportError::ConnectionFenced);
        }
        self.frames
            .transport
            .write_json(message, crate::HELPER_REQUEST_DEADLINE)
    }

    fn close(&mut self) -> Result<(), HelperTransportError> {
        let frames = self.frames.close();
        let client = self.client.terminate();
        ensure_helper_utility_usable()?;
        frames.and(client)
    }
}
impl Drop for WindowsSourceChannel {
    fn drop(&mut self) {
        let _ = self.close();
    }
}

/// Binary composition supplies only the existing bounded helper source server.
/// It must close every source before returning, including transport/SCM failure.
pub trait WindowsSourceHandler: Send {
    /// # Errors
    /// Returns source, transport or cleanup failure after fencing native intake.
    fn serve(
        &mut self,
        channel: &WindowsSourceChannel,
        dispatcher: Arc<WindowsWtsServiceDispatcher>,
        candidate: WindowsCandidateSession,
    ) -> Result<(), HelperTransportError>;
}

/// Trusted installer/release configuration, never deserialized from a client.
/// The root and every descendant directory must satisfy the protected launch
/// closure ACL contract. Provisioning and signed inventory selection are external.
pub struct WindowsConfiguredService<H> {
    root: PathBuf,
    manifest: Arc<WindowsLaunchManifest>,
    handler: H,
}
impl<H: WindowsSourceHandler> WindowsConfiguredService<H> {
    #[must_use]
    pub fn new(root: PathBuf, manifest: WindowsLaunchManifest, handler: H) -> Self {
        Self {
            root,
            manifest: Arc::new(manifest),
            handler,
        }
    }
}
impl<H: WindowsSourceHandler> WindowsServiceBody for WindowsConfiguredService<H> {
    fn run(
        mut self: Box<Self>,
        dispatcher: Arc<WindowsWtsServiceDispatcher>,
    ) -> Result<(), HelperTransportError> {
        let mut announced = false;
        loop {
            let launch = crate::windows_pipe::create_listener()?;
            if !announced {
                dispatcher
                    .announce_running()
                    .map_err(|_| HelperTransportError::ConnectionFenced)?;
                announced = true;
            }
            let cancellation = launch.cancellation();
            let launch = match crate::service_accept::accept_owned(
                move || {
                    crate::windows_pipe::accept(&launch, || false)?;
                    Ok(launch)
                },
                cancellation,
                || dispatcher.stop_requested(),
                None,
            ) {
                Ok(launch) => launch,
                Err(error) => {
                    ensure_helper_utility_usable()?;
                    if dispatcher.stop_requested() {
                        return Ok(());
                    }
                    return Err(error);
                }
            };
            let deadline = Instant::now() + HELPER_STARTUP_DEADLINE;
            let mut channel = match self.open(launch, Arc::clone(&dispatcher), deadline) {
                Ok(channel) => channel,
                Err(_error) => {
                    // This endpoint accepts untrusted fixed launch requests. A
                    // rejected request with observed owner cleanup must not stop
                    // the installed service. Poison still forbids any new client.
                    ensure_helper_utility_usable()?;
                    native_source_runtime::ensure_native_source_process_usable()
                        .map_err(|_| HelperTransportError::UtilityPoisoned)?;
                    if dispatcher.stop_requested() {
                        return Ok(());
                    }
                    continue;
                }
            };
            let candidate = channel.client.candidate();
            let result = self
                .handler
                .serve(&channel, Arc::clone(&dispatcher), candidate);
            if matches!(result, Err(HelperTransportError::UtilityPoisoned)) {
                crate::poison_helper_utility();
            }
            let close = run_startup_task(
                "service-client-close",
                Instant::now() + crate::HELPER_TERMINATION_DEADLINE,
                move || {
                    let result = channel.close();
                    drop(channel);
                    result
                },
            );
            ensure_helper_utility_usable()?;
            close?;
            if dispatcher.stop_requested() {
                return Ok(());
            }
            result?;
        }
    }
}
impl<H: WindowsSourceHandler> WindowsConfiguredService<H> {
    fn open(
        &self,
        launch: WindowsServicePipe,
        dispatcher: Arc<WindowsWtsServiceDispatcher>,
        deadline: Instant,
    ) -> Result<WindowsSourceChannel, HelperTransportError> {
        let launch = ServiceFrames::new(launch)?;
        if launch.transport.read_bytes(remaining(deadline)?)? != WINDOWS_LAUNCH_REQUEST {
            return Err(HelperTransportError::ConnectionFenced);
        }
        let (mut launch, user) = run_startup_task("service-launch-user", deadline, move || {
            let user = crate::windows_peer::user_for_windows_launch_request(
                launch.pipe.handle(),
                deadline,
            )?;
            Ok((launch, user))
        })?;
        // Create the fixed source endpoint before the suspended client is resumed.
        let source = crate::windows_pipe::create_source_listener()?;
        let root = self.root.clone();
        let manifest = Arc::clone(&self.manifest);
        let client = run_startup_task("service-controlled-launch", deadline, move || {
            let closure = WindowsProtectedLaunchClosure::open(&root, &manifest, deadline)?;
            WindowsControlledClient::launch(closure, &user, deadline)
        })?;
        launch.close()?;
        drop(launch);
        let cancellation = source.cancellation();
        let source = crate::service_accept::accept_owned(
            move || {
                crate::windows_pipe::accept(&source, || false)?;
                Ok(source)
            },
            cancellation,
            || dispatcher.stop_requested(),
            Some(deadline),
        )?;
        let source = ServiceFrames::new(source)?;
        if source.transport.read_bytes(remaining(deadline)?)? != WINDOWS_SOURCE_REQUEST {
            return Err(HelperTransportError::ConnectionFenced);
        }
        let (source, client) = run_startup_task("service-main-peer", deadline, move || {
            let candidate = crate::windows_peer::candidate_session_for_verified_pipe_peer(
                source.pipe.handle(),
                client.process(),
                deadline,
            )?;
            if candidate != client.candidate() {
                return Err(HelperTransportError::ExecutableIdentity);
            }
            Ok((source, client))
        })?;
        let nonce = run_startup_task("service-nonce", deadline, generate_channel_nonce)?;
        remaining(deadline)?;
        if dispatcher.stop_requested() {
            return Err(HelperTransportError::ConnectionFenced);
        }
        Ok(WindowsSourceChannel {
            frames: source,
            client,
            dispatcher,
            nonce,
        })
    }
}
