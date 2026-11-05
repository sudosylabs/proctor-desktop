//! Real binary checks. These do not install/activate a service or assert any
//! entitlement, signature, root-worker source coverage or packaged support.
#![cfg(any(target_os = "macos", target_os = "windows"))]

use std::process::{Child, Command, ExitStatus, Stdio};
use std::thread;
use std::time::{Duration, Instant};

use native_protocol::{HelperHandshake, ProtocolValidatable};
use native_security_helper::{read_json_frame, write_frame};

struct TestProcess(Child);

impl TestProcess {
    fn wait_bounded(&mut self) -> ExitStatus {
        let deadline = Instant::now() + Duration::from_secs(5);
        loop {
            if let Some(status) = self.0.try_wait().expect("child status") {
                return status;
            }
            assert!(
                Instant::now() < deadline,
                "helper did not exit before deadline"
            );
            thread::sleep(Duration::from_millis(5));
        }
    }
}

impl Drop for TestProcess {
    fn drop(&mut self) {
        let _ = self.0.kill();
        let _ = self.0.wait();
    }
}

fn command() -> Command {
    let mut command = Command::new(env!("CARGO_BIN_EXE_native-security-helper"));
    command
        .env_clear()
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    command
}

#[test]
fn ordinary_stdio_mode_keeps_the_existing_nonce_handshake() {
    let mut process = TestProcess(command().spawn().expect("helper executable"));
    let nonce = "ab".repeat(32);
    let mut input = process.0.stdin.take().expect("stdin");
    write_frame(&mut input, nonce.as_bytes()).expect("nonce frame");
    drop(input);
    assert!(process.wait_bounded().success());
    let handshake: HelperHandshake =
        read_json_frame(&mut process.0.stdout.take().expect("stdout")).expect("handshake");
    handshake.validate_protocol().expect("valid handshake");
    assert_eq!(handshake.channel_nonce, nonce);
}

#[test]
fn unexpected_entrypoint_arguments_never_fall_back_to_stdio() {
    let mut process = TestProcess(
        command()
            .arg("--arbitrary-worker-path")
            .spawn()
            .expect("helper executable"),
    );
    assert_eq!(process.wait_bounded().code(), Some(70));
}

#[cfg(target_os = "macos")]
#[test]
fn service_worker_rejects_missing_private_supervisor_socket() {
    let mut process = TestProcess(
        command()
            .arg("--service-worker")
            .spawn()
            .expect("helper executable"),
    );
    assert_eq!(process.wait_bounded().code(), Some(70));
}
