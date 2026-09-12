//! The privileged supervisor owns worker termination; the utility owns only
//! authenticated control and observation sockets. Neither EOF nor a sent stop
//! request is accepted as proof of root worker exit.
use std::collections::{BTreeMap, VecDeque};
use std::net::Shutdown;
use std::os::unix::net::UnixStream;
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::time::Instant;

use prctr_native_helper_protocol::{
    HelperKind, HelperSourceKind, VerifiedHelperPeer, bind_verified_helper_channel,
};
use prctr_native_protocol::{
    HelperHandshake, HelperServiceRequest, HelperServiceRequestKind, HelperServiceResponse,
    HelperServiceResponseKind, HelperServiceWorkerBootstrap, ProtocolValidatable,
};

use crate::{
    DeadlineFramedTransport, HELPER_BUILD_ID, HELPER_REQUEST_DEADLINE, HELPER_STARTUP_DEADLINE,
    HelperLaunchConfiguration, HelperOwner, HelperProtocolError, HelperTransportError,
    NativeHelperConnection, ensure_helper_utility_usable, generate_channel_nonce,
    poison_helper_utility, remaining, run_startup_task, terminate_child, verify_packaged_helper,
    verify_spawned_helper,
};

pub const HELPER_SERVICE_FRAME_BYTES: usize = 4096;
/// A nonce-free framing barrier proving only that the acceptor has written to
/// this socket. The client must still verify its live code identity before
/// sending authority. This exact versioned marker has no extensible fields.
pub const MACOS_SERVICE_ACCEPTANCE_FRAME: &[u8] = b"prctr-native-service-accepted-v1";
pub(crate) const CONTROL_SOCKET_PATH: &str = "/var/run/com.proctor.native.control";
pub(crate) const OBSERVATION_SOCKET_PATH: &str = "/var/run/com.proctor.native.observation";

/// Fixed packaged identities. Paths and requirements never come from renderers.
#[derive(Clone)]
pub struct MacOsServiceConnectionConfiguration {
    pub service_designated_requirement: String,
    pub expected_helper_build_id: String,
    pub expected_capabilities: Vec<HelperSourceKind>,
}

/// Build-selected service authority, shared by the supervisor and its worker.
pub struct MacOsServicePackage {
    pub worker: HelperLaunchConfiguration,
    pub client_designated_requirement: String,
}

/// Loads literal release inputs compiled into this signed executable. The same
/// bundle/executable runs the dormant supervisor and separately owned workers.
///
/// # Errors
/// An ordinary development build without release identities has no service mode.
pub fn packaged_macos_service_configuration() -> Result<MacOsServicePackage, HelperTransportError> {
    let service = option_env!("PRCTR_NATIVE_SERVICE_REQUIREMENT")
        .ok_or(HelperTransportError::ExecutableIdentity)?;
    let client = option_env!("PRCTR_NATIVE_CLIENT_REQUIREMENT")
        .ok_or(HelperTransportError::ExecutableIdentity)?;
    validate_requirement(service)?;
    validate_requirement(client)?;
    Ok(MacOsServicePackage {
        worker: HelperLaunchConfiguration {
            executable: std::env::current_exe()?,
            expected_helper_build_id: HELPER_BUILD_ID.to_owned(),
            expected_capabilities: vec![
                HelperSourceKind::ProcessApplication,
                HelperSourceKind::InteractiveSession,
            ],
            macos_designated_requirement: Some(service.to_owned()),
            windows_executable_sha256: None,
        },
        client_designated_requirement: client.to_owned(),
    })
}

fn validate_requirement(value: &str) -> Result<(), HelperTransportError> {
    if value.is_empty() || value.len() > 2048 || value.as_bytes().contains(&0) {
        Err(HelperTransportError::ExecutableIdentity)
    } else {
        Ok(())
    }
}

/// Bounds the Security.framework call, retaining its actual kernel socket peer.
///
/// # Errors
/// A timed-out verifier poisons this process; it cannot authorize a later open.
pub fn verify_candidate_socket_peer_under_deadline(
    socket: &UnixStream,
    requirement: &str,
    deadline: Instant,
) -> Result<prctr_process_application_state::MacOsCandidateAuditSession, HelperTransportError> {
    ensure_helper_utility_usable()?;
    validate_requirement(requirement)?;
    let socket = socket.try_clone()?;
    let requirement = requirement.to_owned();
    let result = run_startup_task("prctr-service-candidate-verifier", deadline, move || {
        crate::verify_candidate_socket_peer(&socket, &requirement)
    });
    ensure_helper_utility_usable()?;
    result
}

pub(crate) struct ConnectedService {
    control: DeadlineFramedTransport,
    control_socket: UnixStream,
    observation_socket: UnixStream,
    nonce: String,
    terminated: bool,
}

pub(crate) fn connect(
    configuration: MacOsServiceConnectionConfiguration,
) -> Result<NativeHelperConnection, HelperTransportError> {
    ensure_helper_utility_usable()?;
    validate_requirement(&configuration.service_designated_requirement)?;
    let deadline = Instant::now() + HELPER_STARTUP_DEADLINE;
    // The absolute budget includes connect, both live-peer checks and handshakes.
    run_startup_task("prctr-service-connect", deadline, move || {
        connect_before(configuration, deadline)
    })
}

fn connect_before(
    configuration: MacOsServiceConnectionConfiguration,
    deadline: Instant,
) -> Result<NativeHelperConnection, HelperTransportError> {
    let nonce = generate_channel_nonce()?;
    remaining(deadline)?;
    let (control_socket, mut control) =
        connect_verified_control(&configuration.service_designated_requirement, deadline)?;
    // Shutdown unblocks every cloned socket before joining its framing workers.
    let mut worker_may_exist = false;
    let opening = (|| {
        send_control(&control, &nonce, HelperServiceRequestKind::Open, deadline)?;
        expect_control(&control, &nonce, HelperServiceResponseKind::Ready, deadline)?;
        let observation_socket =
            attach_observation(&control_socket, &nonce, deadline, &mut worker_may_exist);
        let observation_socket = observation_socket?;
        expect_control(
            &control,
            &nonce,
            HelperServiceResponseKind::Started,
            deadline,
        )?;
        Ok(observation_socket)
    })();
    let observation_socket = match opening {
        Ok(socket) => socket,
        Err(error) => {
            let _ = control_socket.shutdown(Shutdown::Both);
            control.shutdown()?;
            if worker_may_exist {
                poison_helper_utility();
                return Err(HelperTransportError::ChildTermination);
            }
            return Err(error);
        }
    };
    let mut service = ConnectedService {
        control,
        control_socket,
        observation_socket,
        nonce,
        terminated: false,
    };
    let mut transport = match DeadlineFramedTransport::new(
        service.observation_socket.try_clone()?,
        service.observation_socket.try_clone()?,
    ) {
        Ok(transport) => transport,
        Err(error) => {
            service.terminate()?;
            return Err(error);
        }
    };
    let handshake = (|| {
        transport.write_bytes(service.nonce.as_bytes(), remaining(deadline)?)?;
        let handshake: HelperHandshake = transport.read_json(remaining(deadline)?)?;
        let peer = VerifiedHelperPeer {
            helper_kind: HelperKind::MacosEndpointSecurityHelper,
            helper_build_id: configuration.expected_helper_build_id,
            capabilities: configuration.expected_capabilities,
        };
        bind_verified_helper_channel(&handshake, &peer, &service.nonce)
            .map_err(HelperTransportError::from)
    })();
    match handshake {
        Ok(channel) => Ok(NativeHelperConnection {
            owner: HelperOwner::Service(service),
            transport,
            channel,
            active_sources: BTreeMap::new(),
            pending_events: VecDeque::new(),
            fenced: false,
        }),
        Err(error) => {
            let stopped = service.terminate();
            let framed = transport.shutdown();
            stopped.and(framed)?;
            Err(error)
        }
    }
}

fn connect_verified_control(
    requirement: &str,
    deadline: Instant,
) -> Result<(UnixStream, DeadlineFramedTransport), HelperTransportError> {
    let socket = UnixStream::connect(CONTROL_SOCKET_PATH)?;
    let mut transport = service_framing(&socket)?;
    let verified = (|| {
        expect_acceptance(&transport, deadline)?;
        crate::verify_service_socket_peer(&socket, requirement)?;
        remaining(deadline)?;
        Ok(())
    })();
    if let Err(error) = verified {
        let _ = socket.shutdown(Shutdown::Both);
        transport.shutdown()?;
        return Err(error);
    }
    Ok((socket, transport))
}

fn attach_observation(
    control: &UnixStream,
    nonce: &str,
    deadline: Instant,
    worker_may_exist: &mut bool,
) -> Result<UnixStream, HelperTransportError> {
    let socket = UnixStream::connect(OBSERVATION_SOCKET_PATH)?;
    let mut transport = service_framing(&socket)?;
    let attached = (|| {
        expect_acceptance(&transport, deadline)?;
        crate::verify_same_macos_socket_peer(control, &socket)?;
        remaining(deadline)?;
        *worker_may_exist = true;
        send_control(
            &transport,
            nonce,
            HelperServiceRequestKind::Attach,
            deadline,
        )
    })();
    if attached.is_err() {
        let _ = socket.shutdown(Shutdown::Both);
    }
    // The greeting read and attach write have settled. Retire these temporary
    // framing workers before observation-protocol workers acquire the stream.
    transport.shutdown()?;
    attached?;
    Ok(socket)
}

fn service_framing(socket: &UnixStream) -> Result<DeadlineFramedTransport, HelperTransportError> {
    DeadlineFramedTransport::new_bounded(
        socket.try_clone()?,
        socket.try_clone()?,
        HELPER_SERVICE_FRAME_BYTES,
    )
}

fn expect_acceptance(
    transport: &DeadlineFramedTransport,
    deadline: Instant,
) -> Result<(), HelperTransportError> {
    let frame = transport.read_bytes(remaining(deadline)?)?;
    if frame != MACOS_SERVICE_ACCEPTANCE_FRAME {
        return Err(HelperProtocolError::Lifecycle.into());
    }
    remaining(deadline)?;
    Ok(())
}

fn send_control(
    transport: &DeadlineFramedTransport,
    nonce: &str,
    kind: HelperServiceRequestKind,
    deadline: Instant,
) -> Result<(), HelperTransportError> {
    let request = HelperServiceRequest {
        protocol_version: 1,
        channel_nonce: nonce.to_owned(),
        kind,
    };
    request.validate_protocol()?;
    transport.write_json(&request, remaining(deadline)?)
}

fn expect_control(
    transport: &DeadlineFramedTransport,
    nonce: &str,
    kind: HelperServiceResponseKind,
    deadline: Instant,
) -> Result<(), HelperTransportError> {
    let response: HelperServiceResponse = transport.read_json(remaining(deadline)?)?;
    response.validate_protocol()?;
    if response.channel_nonce != nonce || response.kind != kind {
        return Err(HelperProtocolError::Lifecycle.into());
    }
    Ok(())
}

impl ConnectedService {
    pub(crate) fn terminate(&mut self) -> Result<(), HelperTransportError> {
        if self.terminated {
            return ensure_helper_utility_usable();
        }
        self.terminated = true;
        let deadline = Instant::now() + HELPER_REQUEST_DEADLINE;
        let proof = send_control(
            &self.control,
            &self.nonce,
            HelperServiceRequestKind::Stop,
            deadline,
        )
        .and_then(|()| {
            expect_control(
                &self.control,
                &self.nonce,
                HelperServiceResponseKind::Stopped,
                deadline,
            )
        });
        let _ = self.observation_socket.shutdown(Shutdown::Both);
        let _ = self.control_socket.shutdown(Shutdown::Both);
        let framing = self.control.shutdown();
        if proof.is_err() {
            poison_helper_utility();
            return Err(HelperTransportError::ChildTermination);
        }
        framing
    }
}
impl Drop for ConnectedService {
    fn drop(&mut self) {
        let _ = self.terminate();
    }
}

/// Only the privileged supervisor owns this child and its lifetime socket.
pub struct PrivilegedMacOsWorker {
    child: Child,
    lifetime: UnixStream,
}
impl PrivilegedMacOsWorker {
    /// Queries the retained child handle, never a reused PID.
    /// # Errors
    /// Returns an OS wait error without claiming the worker has exited.
    pub fn has_exited(&mut self) -> Result<bool, HelperTransportError> {
        Ok(self.child.try_wait()?.is_some())
    }
    /// Kills if necessary and observes worker exit within the fixed bound.
    /// # Errors
    /// Unproved termination poisons the owner and cannot produce a stopped ack.
    pub fn terminate(&mut self) -> Result<(), HelperTransportError> {
        let result = terminate_child(&mut self.child);
        let _ = self.lifetime.shutdown(Shutdown::Both);
        result
    }
}
impl Drop for PrivilegedMacOsWorker {
    fn drop(&mut self) {
        let _ = self.terminate();
    }
}

/// Starts only the verified fixed worker mode, with data and private bootstrap
/// sockets inherited from the privileged owner, never paths supplied by a client.
///
/// # Errors
/// Rejects non-root callers, invalid configuration, failed code proof or startup.
pub fn launch_macos_service_worker(
    configuration: &HelperLaunchConfiguration,
    observation: UnixStream,
    bootstrap: &HelperServiceWorkerBootstrap,
    deadline: Instant,
) -> Result<PrivilegedMacOsWorker, HelperTransportError> {
    crate::require_macos_service_privilege()?;
    ensure_helper_utility_usable()?;
    bootstrap.validate_protocol()?;
    validate_requirement(&bootstrap.client_designated_requirement)?;
    let config = configuration.clone();
    let verified = run_startup_task("prctr-service-worker-package", deadline, move || {
        verify_packaged_helper(&config, deadline)
    })?;
    let (lifetime, bootstrap_socket) = UnixStream::pair()?;
    let input = observation.try_clone()?;
    let executable: PathBuf = configuration.executable.clone();
    let mut worker = run_startup_task("prctr-service-worker-spawn", deadline, move || {
        let child = Command::new(executable)
            .arg("--service-worker")
            .env_clear()
            .stdin(Stdio::from(std::os::fd::OwnedFd::from(input)))
            .stdout(Stdio::from(std::os::fd::OwnedFd::from(observation)))
            .stderr(Stdio::from(std::os::fd::OwnedFd::from(bootstrap_socket)))
            .spawn()?;
        let mut worker = PrivilegedMacOsWorker { child, lifetime };
        if Instant::now() >= deadline {
            worker.terminate()?;
            return Err(HelperTransportError::DeadlineExceeded);
        }
        Ok(worker)
    })?;
    let started = (|| {
        let process_id = worker.child.id();
        let config = configuration.clone();
        run_startup_task("prctr-service-worker-live", deadline, move || {
            verify_spawned_helper(&config, process_id, &verified)
        })?;
        let mut framing = DeadlineFramedTransport::new_bounded(
            worker.lifetime.try_clone()?,
            worker.lifetime.try_clone()?,
            HELPER_SERVICE_FRAME_BYTES,
        )?;
        let wrote = framing.write_json(&bootstrap, remaining(deadline)?);
        if wrote.is_err() {
            let _ = worker.lifetime.shutdown(Shutdown::Both);
        }
        framing.shutdown()?;
        wrote?;
        if worker.child.try_wait()?.is_some() {
            return Err(HelperTransportError::ChildExited);
        }
        Ok(())
    })();
    if let Err(error) = started {
        worker.terminate()?;
        return Err(error);
    }
    Ok(worker)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{read_json_frame, write_json_frame};
    use std::thread;
    const NONCE: &str = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

    #[test]
    fn acceptance_marker_is_exact_and_does_not_authorize_the_peer() {
        for marker in [
            MACOS_SERVICE_ACCEPTANCE_FRAME,
            b"prctr-native-service-accepted-v2".as_slice(),
            b"{}".as_slice(),
        ] {
            let (socket, mut peer) = UnixStream::pair().unwrap();
            let mut transport = service_framing(&socket).unwrap();
            crate::write_frame(&mut peer, marker).unwrap();
            let result = expect_acceptance(&transport, Instant::now() + HELPER_STARTUP_DEADLINE);
            assert_eq!(result.is_ok(), marker == MACOS_SERVICE_ACCEPTANCE_FRAME);
            if result.is_ok() {
                // A valid marker is never a signature proof: this ordinary
                // unprivileged test peer still fails the service verifier.
                assert!(
                    crate::verify_service_socket_peer(&socket, "identifier \"invalid.service\"")
                        .is_err()
                );
            }
            socket.shutdown(Shutdown::Both).unwrap();
            transport.shutdown().unwrap();
        }
    }

    #[test]
    fn acceptance_marker_rejects_oversized_frame_before_payload_read() {
        use std::io::Write;
        let (socket, mut peer) = UnixStream::pair().unwrap();
        let mut transport = service_framing(&socket).unwrap();
        peer.write_all(&4097_u32.to_be_bytes()).unwrap();
        assert!(matches!(
            expect_acceptance(&transport, Instant::now() + HELPER_STARTUP_DEADLINE),
            Err(HelperTransportError::Protocol(
                HelperProtocolError::FrameSize
            ))
        ));
        socket.shutdown(Shutdown::Both).unwrap();
        transport.shutdown().unwrap();
    }

    #[test]
    fn service_stop_requires_an_exact_acknowledgement_not_eof() {
        const CASE: &str = "PRCTR_TEST_SERVICE_ACK";
        let Ok(case) = std::env::var(CASE) else {
            for case in ["valid", "eof", "wrong_nonce", "wrong_kind"] {
                assert!(Command::new(std::env::current_exe().unwrap())
                    .args(["--exact", "macos_service::tests::service_stop_requires_an_exact_acknowledgement_not_eof", "--nocapture"])
                    .env(CASE, case).status().unwrap().success());
            }
            return;
        };
        let (control_socket, mut peer) = UnixStream::pair().unwrap();
        let (observation_socket, _observation_peer) = UnixStream::pair().unwrap();
        let reply_case = case.clone();
        let server = thread::spawn(move || {
            let request: HelperServiceRequest = read_json_frame(&mut peer).unwrap();
            assert_eq!(request.kind, HelperServiceRequestKind::Stop);
            assert_eq!(request.channel_nonce, NONCE);
            if reply_case != "eof" {
                write_json_frame(
                    &mut peer,
                    &HelperServiceResponse {
                        protocol_version: 1,
                        channel_nonce: if reply_case == "wrong_nonce" {
                            "a".repeat(64)
                        } else {
                            NONCE.to_owned()
                        },
                        kind: if reply_case == "wrong_kind" {
                            HelperServiceResponseKind::Started
                        } else {
                            HelperServiceResponseKind::Stopped
                        },
                    },
                )
                .unwrap();
            }
        });
        let mut service = ConnectedService {
            control: DeadlineFramedTransport::new_bounded(
                control_socket.try_clone().unwrap(),
                control_socket.try_clone().unwrap(),
                HELPER_SERVICE_FRAME_BYTES,
            )
            .unwrap(),
            control_socket,
            observation_socket,
            nonce: NONCE.to_owned(),
            terminated: false,
        };
        let result = service.terminate();
        server.join().unwrap();
        if case == "valid" {
            assert!(result.is_ok());
            assert!(service.terminate().is_ok());
            assert!(ensure_helper_utility_usable().is_ok());
        } else {
            assert!(matches!(
                result,
                Err(HelperTransportError::ChildTermination)
            ));
            assert!(matches!(
                ensure_helper_utility_usable(),
                Err(HelperTransportError::UtilityPoisoned)
            ));
            assert!(service.terminate().is_err());
        }
    }
}
