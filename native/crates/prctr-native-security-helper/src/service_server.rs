//! Closed launchd lifecycle owner. Observation and policy stay in their existing
//! worker and utility boundaries; this process only authenticates and reaps.

use std::io::{self, Read, Write};
use std::net::Shutdown;
use std::os::unix::net::{UnixListener, UnixStream};
use std::thread;
use std::time::{Duration, Instant};

use prctr_native_protocol::{
    HelperServiceRequest, HelperServiceRequestKind, HelperServiceResponse,
    HelperServiceResponseKind, HelperServiceWorkerBootstrap, ProtocolValidatable,
};
use prctr_native_security_helper::{
    HELPER_SERVICE_FRAME_BYTES as CONTROL_FRAME_LIMIT, HelperLaunchConfiguration,
    HelperTransportError, MACOS_SERVICE_ACCEPTANCE_FRAME,
};
use serde::Serialize;
use serde::de::DeserializeOwned;

pub(crate) const STARTUP_TIMEOUT: Duration = Duration::from_secs(5);
const POLL_INTERVAL: Duration = Duration::from_millis(5);

pub(crate) struct ServiceConfiguration {
    pub(crate) worker: HelperLaunchConfiguration,
    pub(crate) client_designated_requirement: String,
}

#[allow(
    clippy::needless_pass_by_value,
    reason = "the service entrypoint owns both activated listeners and configuration through shutdown"
)]
pub(crate) fn run_macos_service(
    control_listener: UnixListener,
    observation_listener: UnixListener,
    configuration: ServiceConfiguration,
) -> Result<(), HelperTransportError> {
    prctr_native_security_helper::require_macos_service_privilege()?;
    control_listener.set_nonblocking(false)?;
    observation_listener.set_nonblocking(true)?;
    // The listener backlog is OS-bounded. Only one authenticated connection and
    // one worker are admitted at a time; no per-connection tasks accumulate.
    for connection in control_listener.incoming() {
        prctr_native_security_helper::ensure_helper_utility_usable()?;
        let control = connection?;
        let served = serve_connection(control, &observation_listener, &configuration);
        prctr_native_security_helper::ensure_helper_utility_usable()?;
        if let Err(error) = served {
            match error {
                HelperTransportError::ChildTermination | HelperTransportError::UtilityPoisoned => {
                    return Err(error);
                }
                _ => {}
            }
        }
    }
    Err(HelperTransportError::ConnectionFenced)
}

fn serve_connection(
    mut control: UnixStream,
    observation_listener: &UnixListener,
    configuration: &ServiceConfiguration,
) -> Result<(), HelperTransportError> {
    let deadline = Instant::now() + STARTUP_TIMEOUT;
    prctr_native_security_helper::verify_candidate_socket_peer_under_deadline(
        &control,
        &configuration.client_designated_requirement,
        deadline,
    )?;
    write_frame_before(&mut control, MACOS_SERVICE_ACCEPTANCE_FRAME, deadline)?;
    let open: HelperServiceRequest = read_control(&mut control, deadline)?;
    require_request(&open, HelperServiceRequestKind::Open, &open.channel_nonce)?;
    write_response(
        &mut control,
        &open.channel_nonce,
        HelperServiceResponseKind::Ready,
        deadline,
    )?;

    let mut observation = accept_before(observation_listener, deadline)?;
    prctr_native_security_helper::verify_same_macos_socket_peer(&control, &observation)?;
    write_frame_before(&mut observation, MACOS_SERVICE_ACCEPTANCE_FRAME, deadline)?;
    let attach: HelperServiceRequest = read_control(&mut observation, deadline)?;
    require_request(
        &attach,
        HelperServiceRequestKind::Attach,
        &open.channel_nonce,
    )?;
    observation.set_nonblocking(false)?;
    let mut worker = prctr_native_security_helper::launch_macos_service_worker(
        &configuration.worker,
        observation,
        &HelperServiceWorkerBootstrap {
            protocol_version: 1,
            channel_nonce: open.channel_nonce.clone(),
            client_designated_requirement: configuration.client_designated_requirement.clone(),
        },
        deadline,
    )?;
    // The client sends the observation handshake only after this response.
    let startup = write_response(
        &mut control,
        &open.channel_nonce,
        HelperServiceResponseKind::Started,
        deadline,
    );
    if let Err(error) = startup {
        worker.terminate()?;
        return Err(error);
    }
    supervise_worker(&mut control, &open.channel_nonce, &mut worker)
}

trait ServiceWorker {
    fn has_exited(&mut self) -> Result<bool, HelperTransportError>;
    fn terminate(&mut self) -> Result<(), HelperTransportError>;
}

impl ServiceWorker for prctr_native_security_helper::PrivilegedMacOsWorker {
    fn has_exited(&mut self) -> Result<bool, HelperTransportError> {
        Self::has_exited(self)
    }

    fn terminate(&mut self) -> Result<(), HelperTransportError> {
        Self::terminate(self)
    }
}

fn supervise_worker(
    control: &mut UnixStream,
    nonce: &str,
    worker: &mut impl ServiceWorker,
) -> Result<(), HelperTransportError> {
    // Every return after launch passes through termination; failure to observe
    // exit outranks the original protocol/transport error.
    let result = monitor_worker(control, nonce, worker);
    if let Err(error) = worker.terminate() {
        let _ = control.shutdown(Shutdown::Both);
        return Err(error);
    }
    match result {
        Ok(()) => write_response(
            control,
            nonce,
            HelperServiceResponseKind::Stopped,
            Instant::now() + STARTUP_TIMEOUT,
        ),
        Err(error) => {
            let _ = control.shutdown(Shutdown::Both);
            Err(error)
        }
    }
}

fn monitor_worker(
    control: &mut UnixStream,
    nonce: &str,
    worker: &mut impl ServiceWorker,
) -> Result<(), HelperTransportError> {
    control.set_nonblocking(true)?;
    let mut reader = ControlReader::new();
    loop {
        if worker.has_exited()? {
            return Ok(());
        }
        if let Some(request) = reader.poll(control)? {
            require_request(&request, HelperServiceRequestKind::Stop, nonce)?;
            return Ok(());
        }
        thread::sleep(POLL_INTERVAL);
    }
}

fn accept_before(
    listener: &UnixListener,
    deadline: Instant,
) -> Result<UnixStream, HelperTransportError> {
    loop {
        remaining(deadline)?;
        match listener.accept() {
            Ok((stream, _address)) => return Ok(stream),
            Err(error) if error.kind() == io::ErrorKind::WouldBlock => thread::sleep(POLL_INTERVAL),
            Err(error) => return Err(error.into()),
        }
    }
}

fn require_request(
    request: &HelperServiceRequest,
    expected_kind: HelperServiceRequestKind,
    nonce: &str,
) -> Result<(), HelperTransportError> {
    request.validate_protocol()?;
    if request.kind != expected_kind || request.channel_nonce != nonce {
        return Err(HelperTransportError::ConnectionFenced);
    }
    Ok(())
}

fn write_response(
    stream: &mut UnixStream,
    nonce: &str,
    kind: HelperServiceResponseKind,
    deadline: Instant,
) -> Result<(), HelperTransportError> {
    write_control(
        stream,
        &HelperServiceResponse {
            protocol_version: 1,
            channel_nonce: nonce.to_owned(),
            kind,
        },
        deadline,
    )
}

pub(crate) fn remaining(deadline: Instant) -> Result<Duration, HelperTransportError> {
    deadline
        .checked_duration_since(Instant::now())
        .filter(|duration| !duration.is_zero())
        .ok_or(HelperTransportError::DeadlineExceeded)
}

pub(crate) fn read_control<T: DeserializeOwned + ProtocolValidatable>(
    stream: &mut UnixStream,
    deadline: Instant,
) -> Result<T, HelperTransportError> {
    let bytes = read_frame_before(stream, deadline)?;
    let message: T = serde_json::from_slice(&bytes)?;
    message.validate_protocol()?;
    Ok(message)
}

pub(crate) fn read_frame_before(
    stream: &mut UnixStream,
    deadline: Instant,
) -> Result<Vec<u8>, HelperTransportError> {
    let mut header = [0_u8; 4];
    read_exact_before(stream, &mut header, deadline)?;
    let length = bounded_length(header)?;
    let mut bytes = vec![0; length];
    read_exact_before(stream, &mut bytes, deadline)?;
    remaining(deadline)?;
    Ok(bytes)
}

fn read_exact_before(
    stream: &mut UnixStream,
    mut bytes: &mut [u8],
    deadline: Instant,
) -> Result<(), HelperTransportError> {
    stream.set_nonblocking(true)?;
    while !bytes.is_empty() {
        remaining(deadline)?;
        match stream.read(bytes) {
            Ok(0) => return Err(HelperTransportError::ConnectionFenced),
            Ok(count) => bytes = &mut bytes[count..],
            Err(error) if error.kind() == io::ErrorKind::Interrupted => {}
            Err(error) if error.kind() == io::ErrorKind::WouldBlock => thread::sleep(POLL_INTERVAL),
            Err(error) => return Err(error.into()),
        }
    }
    Ok(())
}

fn write_control<T: Serialize + ProtocolValidatable>(
    stream: &mut UnixStream,
    message: &T,
    deadline: Instant,
) -> Result<(), HelperTransportError> {
    message.validate_protocol()?;
    let bytes = serde_json::to_vec(message)?;
    write_frame_before(stream, &bytes, deadline)
}

fn write_frame_before(
    stream: &mut UnixStream,
    bytes: &[u8],
    deadline: Instant,
) -> Result<(), HelperTransportError> {
    stream.set_nonblocking(true)?;
    let length = u32::try_from(bytes.len()).map_err(|_| HelperTransportError::ConnectionFenced)?;
    bounded_length(length.to_be_bytes())?;
    for mut part in [&length.to_be_bytes()[..], bytes] {
        while !part.is_empty() {
            remaining(deadline)?;
            match stream.write(part) {
                Ok(0) => return Err(HelperTransportError::ConnectionFenced),
                Ok(count) => part = &part[count..],
                Err(error) if error.kind() == io::ErrorKind::Interrupted => {}
                Err(error) if error.kind() == io::ErrorKind::WouldBlock => {
                    thread::sleep(POLL_INTERVAL);
                }
                Err(error) => return Err(error.into()),
            }
        }
    }
    remaining(deadline)?;
    Ok(())
}

fn bounded_length(header: [u8; 4]) -> Result<usize, HelperTransportError> {
    let length = u32::from_be_bytes(header) as usize;
    if length == 0 || length > CONTROL_FRAME_LIMIT {
        return Err(HelperTransportError::ConnectionFenced);
    }
    Ok(length)
}

/// No detached reader and no idle deadline. Once a peer begins a frame, the
/// whole frame must arrive within one deadline, even with byte-at-a-time input.
struct ControlReader {
    header: [u8; 4],
    header_read: usize,
    payload: Vec<u8>,
    payload_read: usize,
    deadline: Option<Instant>,
}

impl ControlReader {
    const fn new() -> Self {
        Self {
            header: [0; 4],
            header_read: 0,
            payload: Vec::new(),
            payload_read: 0,
            deadline: None,
        }
    }

    fn poll(
        &mut self,
        stream: &mut UnixStream,
    ) -> Result<Option<HelperServiceRequest>, HelperTransportError> {
        // At most one bounded frame is consumed in a poll, preserving child
        // liveness supervision even when the client continually writes.
        loop {
            if let Some(deadline) = self.deadline {
                remaining(deadline)?;
            }
            if self.header_read == 4 && self.payload.is_empty() {
                self.payload.resize(bounded_length(self.header)?, 0);
            }
            if !self.payload.is_empty() && self.payload_read == self.payload.len() {
                let request: HelperServiceRequest = serde_json::from_slice(&self.payload)?;
                request.validate_protocol()?;
                return Ok(Some(request));
            }
            let destination = if self.header_read < 4 {
                &mut self.header[self.header_read..]
            } else {
                &mut self.payload[self.payload_read..]
            };
            match stream.read(destination) {
                Ok(0) => return Err(HelperTransportError::ConnectionFenced),
                Ok(count) => {
                    if self.deadline.is_none() {
                        self.deadline = Some(Instant::now() + STARTUP_TIMEOUT);
                    }
                    if self.header_read < 4 {
                        self.header_read += count;
                    } else {
                        self.payload_read += count;
                    }
                }
                Err(error) if error.kind() == io::ErrorKind::WouldBlock => return Ok(None),
                Err(error) if error.kind() == io::ErrorKind::Interrupted => {}
                Err(error) => return Err(error.into()),
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::process::{Child, Command, Stdio};
    use std::sync::Arc;
    use std::sync::atomic::{AtomicBool, Ordering};

    const NONCE: &str = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

    struct TestWorker {
        child: Child,
        observed: Arc<AtomicBool>,
    }

    impl TestWorker {
        fn launch() -> Self {
            Self {
                child: Command::new("/bin/sleep")
                    .arg("30")
                    .stdin(Stdio::null())
                    .stdout(Stdio::null())
                    .stderr(Stdio::null())
                    .spawn()
                    .expect("test child"),
                observed: Arc::new(AtomicBool::new(false)),
            }
        }
    }

    impl ServiceWorker for TestWorker {
        fn has_exited(&mut self) -> Result<bool, HelperTransportError> {
            let exited = self.child.try_wait()?.is_some();
            if exited {
                self.observed.store(true, Ordering::SeqCst);
            }
            Ok(exited)
        }

        fn terminate(&mut self) -> Result<(), HelperTransportError> {
            if self.has_exited()? {
                return Ok(());
            }
            self.child.kill()?;
            let deadline = Instant::now() + Duration::from_millis(500);
            while !self.has_exited()? {
                if Instant::now() >= deadline {
                    return Err(HelperTransportError::ChildTermination);
                }
                thread::sleep(Duration::from_millis(1));
            }
            Ok(())
        }
    }

    impl Drop for TestWorker {
        fn drop(&mut self) {
            let _ = self.child.kill();
            let _ = self.child.wait();
        }
    }

    fn request(kind: HelperServiceRequestKind) -> HelperServiceRequest {
        HelperServiceRequest {
            protocol_version: 1,
            channel_nonce: NONCE.to_owned(),
            kind,
        }
    }

    #[test]
    fn stopped_acknowledges_observed_real_child_exit() {
        let (mut client, mut server) = UnixStream::pair().expect("control pair");
        let mut worker = TestWorker::launch();
        let observed = Arc::clone(&worker.observed);
        let host = thread::spawn(move || supervise_worker(&mut server, NONCE, &mut worker));
        let deadline = Instant::now() + STARTUP_TIMEOUT;
        write_control(
            &mut client,
            &request(HelperServiceRequestKind::Stop),
            deadline,
        )
        .expect("stop");
        let response: HelperServiceResponse =
            read_control(&mut client, deadline).expect("exit ack");
        assert_eq!(response.kind, HelperServiceResponseKind::Stopped);
        assert_eq!(response.channel_nonce, NONCE);
        assert!(
            observed.load(Ordering::SeqCst),
            "ack preceded waitpid exit proof"
        );
        host.join().expect("host thread").expect("host stop");
    }

    #[test]
    fn control_peer_loss_reaps_real_worker() {
        let (client, mut server) = UnixStream::pair().expect("control pair");
        let mut worker = TestWorker::launch();
        let observed = Arc::clone(&worker.observed);
        drop(client);
        assert!(supervise_worker(&mut server, NONCE, &mut worker).is_err());
        assert!(observed.load(Ordering::SeqCst));
    }

    #[test]
    fn wrong_nonce_reaps_worker_without_exit_ack() {
        let (mut client, mut server) = UnixStream::pair().expect("control pair");
        let mut worker = TestWorker::launch();
        let observed = Arc::clone(&worker.observed);
        let mut stop = request(HelperServiceRequestKind::Stop);
        stop.channel_nonce = "a".repeat(64);
        write_control(&mut client, &stop, Instant::now() + STARTUP_TIMEOUT).expect("wrong stop");
        assert!(supervise_worker(&mut server, NONCE, &mut worker).is_err());
        assert!(observed.load(Ordering::SeqCst));
        assert!(matches!(
            read_frame_before(&mut client, Instant::now() + STARTUP_TIMEOUT),
            Err(HelperTransportError::ConnectionFenced)
        ));
    }

    #[test]
    fn worker_crash_is_observed_before_stopped() {
        let (mut client, mut server) = UnixStream::pair().expect("control pair");
        let mut worker = TestWorker::launch();
        worker.child.kill().expect("simulate crash");
        supervise_worker(&mut server, NONCE, &mut worker).expect("observed crash");
        assert!(worker.observed.load(Ordering::SeqCst));
        let response: HelperServiceResponse =
            read_control(&mut client, Instant::now() + STARTUP_TIMEOUT).expect("exit ack");
        assert_eq!(response.kind, HelperServiceResponseKind::Stopped);
    }

    #[test]
    fn failed_termination_never_acknowledges_stopped() {
        struct Unreaped;
        impl ServiceWorker for Unreaped {
            fn has_exited(&mut self) -> Result<bool, HelperTransportError> {
                Ok(false)
            }
            fn terminate(&mut self) -> Result<(), HelperTransportError> {
                Err(HelperTransportError::ChildTermination)
            }
        }
        let (mut client, mut server) = UnixStream::pair().expect("control pair");
        write_control(
            &mut client,
            &request(HelperServiceRequestKind::Stop),
            Instant::now() + STARTUP_TIMEOUT,
        )
        .expect("stop");
        assert!(matches!(
            supervise_worker(&mut server, NONCE, &mut Unreaped),
            Err(HelperTransportError::ChildTermination)
        ));
        drop(server);
        assert!(matches!(
            read_frame_before(&mut client, Instant::now() + STARTUP_TIMEOUT),
            Err(HelperTransportError::ConnectionFenced)
        ));
    }

    #[test]
    fn decoder_rejects_oversized_header_without_payload_allocation() {
        let (mut client, mut server) = UnixStream::pair().expect("control pair");
        server.set_nonblocking(true).expect("nonblocking");
        client.write_all(&4097_u32.to_be_bytes()).expect("header");
        let mut reader = ControlReader::new();
        assert!(reader.poll(&mut server).is_err());
        assert!(reader.payload.is_empty());
    }

    #[test]
    fn decoder_preserves_fragmented_frame_and_enforces_absolute_deadline() {
        let (mut client, mut server) = UnixStream::pair().expect("control pair");
        server.set_nonblocking(true).expect("nonblocking");
        let mut reader = ControlReader::new();
        client.write_all(&[0]).expect("first header byte");
        assert!(reader.poll(&mut server).expect("partial header").is_none());
        reader.deadline = Some(Instant::now());
        client.write_all(&[0]).expect("second header byte");
        assert!(matches!(
            reader.poll(&mut server),
            Err(HelperTransportError::DeadlineExceeded)
        ));
    }

    #[test]
    fn idle_control_has_no_arbitrary_session_expiry() {
        let (_client, mut server) = UnixStream::pair().expect("control pair");
        server.set_nonblocking(true).expect("nonblocking");
        let mut reader = ControlReader::new();
        assert!(reader.poll(&mut server).expect("idle").is_none());
        assert!(reader.deadline.is_none());
    }
}
