//! The entitled worker receives authority only over supervisor-owned fd 2.
//! Neither argv nor the environment can supply a nonce or candidate identity.

use std::io::{self, Read};
use std::os::fd::AsFd;
use std::os::unix::net::UnixStream;
use std::thread;
use std::time::Instant;

use prctr_native_protocol::HelperServiceWorkerBootstrap;
use prctr_native_security_helper::HelperTransportError;

use crate::helper_server::{PlatformHelperSourceFactory, run_helper_server_with_nonce};
use crate::service_server::{STARTUP_TIMEOUT, read_control, read_frame_before};

pub(crate) fn run() -> Result<(), HelperTransportError> {
    prctr_native_security_helper::require_macos_service_privilege()?;
    let deadline = Instant::now() + STARTUP_TIMEOUT;
    let mut guard = UnixStream::from(io::stderr().as_fd().try_clone_to_owned()?);
    let bootstrap: HelperServiceWorkerBootstrap = read_control(&mut guard, deadline)?;
    guard.set_nonblocking(false)?;
    arm_supervisor_watchdog(guard)?;

    let mut observation = UnixStream::from(io::stdin().as_fd().try_clone_to_owned()?);
    let candidate = prctr_native_security_helper::verify_candidate_socket_peer_under_deadline(
        &observation,
        &bootstrap.client_designated_requirement,
        deadline,
    )?;
    let nonce = String::from_utf8(read_frame_before(&mut observation, deadline)?)
        .map_err(|_| HelperTransportError::ConnectionFenced)?;
    if nonce != bootstrap.channel_nonce {
        return Err(HelperTransportError::ConnectionFenced);
    }
    observation.set_nonblocking(false)?;
    let output = observation.try_clone()?;
    run_helper_server_with_nonce(
        observation,
        output,
        crate::platform_helper_kind(),
        PlatformHelperSourceFactory::from_verified_candidate(candidate),
        nonce,
    )
}

fn arm_supervisor_watchdog(mut guard: UnixStream) -> Result<(), HelperTransportError> {
    // This thread intentionally owns the guard until process exit. The caller
    // is a dedicated binary entrypoint, not a reusable in-process task. Any EOF,
    // unexpected payload or I/O failure means its sole lifecycle owner is lost.
    // Abort also interrupts a worker blocked inside a native SDK callback.
    let _watchdog = thread::Builder::new()
        .name("prctr-service-owner-watchdog".to_owned())
        .spawn(move || {
            let mut byte = [0_u8; 1];
            loop {
                match guard.read(&mut byte) {
                    Err(error) if error.kind() == io::ErrorKind::Interrupted => {}
                    _ => std::process::abort(),
                }
            }
        })?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use std::process::{Command, Stdio};
    use std::time::Duration;

    #[test]
    fn watchdog_child() {
        if std::env::var_os("PRCTR_TEST_OWNER_WATCHDOG").is_none() {
            return;
        }
        let mut guard =
            UnixStream::from(io::stderr().as_fd().try_clone_to_owned().expect("guard fd"));
        guard.write_all(&[1]).expect("ready");
        arm_supervisor_watchdog(guard).expect("watchdog");
        loop {
            thread::park();
        }
    }

    #[test]
    fn actual_worker_process_exits_when_supervisor_guard_is_lost() {
        let (mut owner, worker_guard) = UnixStream::pair().expect("private lifetime guard");
        let mut child = Command::new(std::env::current_exe().expect("test executable"))
            .args([
                "--exact",
                "service_worker::tests::watchdog_child",
                "--nocapture",
            ])
            .env("PRCTR_TEST_OWNER_WATCHDOG", "1")
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::from(std::os::fd::OwnedFd::from(worker_guard)))
            .spawn()
            .expect("worker child");
        owner
            .set_read_timeout(Some(STARTUP_TIMEOUT))
            .expect("ready deadline");
        let mut ready = [0];
        let ready_result = owner.read_exact(&mut ready);
        drop(owner);
        let deadline = Instant::now() + STARTUP_TIMEOUT;
        let status = loop {
            match child.try_wait() {
                Ok(Some(status)) => break Some(status),
                Ok(None) if Instant::now() < deadline => thread::sleep(Duration::from_millis(5)),
                _ => break None,
            }
        };
        if status.is_none() {
            let _ = child.kill();
            let _ = child.wait();
        }
        ready_result.expect("worker armed private lifetime guard");
        assert_eq!(ready, [1]);
        assert!(
            status.is_some_and(|status| !status.success()),
            "orphaned worker did not abort"
        );
    }
}
