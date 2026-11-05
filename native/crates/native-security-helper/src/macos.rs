use std::ffi::c_void;
use std::ptr;

use crate::HelperTransportError;

type CfTypeRef = *const c_void;
type CfStringRef = *const c_void;
type CfNumberRef = *const c_void;
type CfDictionaryRef = *const c_void;
type SecCodeRef = *const c_void;
type SecRequirementRef = *const c_void;

const CF_NUMBER_SINT32_TYPE: i32 = 3;
const CF_STRING_ENCODING_UTF8: u32 = 0x0800_0100;

#[link(name = "CoreFoundation", kind = "framework")]
unsafe extern "C" {
    fn CFNumberCreate(
        allocator: *const c_void,
        number_type: i32,
        value: *const c_void,
    ) -> CfNumberRef;
    fn CFStringCreateWithBytes(
        allocator: *const c_void,
        bytes: *const u8,
        length: isize,
        encoding: u32,
        is_external_representation: u8,
    ) -> CfStringRef;
    fn CFDictionaryCreate(
        allocator: *const c_void,
        keys: *const *const c_void,
        values: *const *const c_void,
        count: isize,
        key_callbacks: *const c_void,
        value_callbacks: *const c_void,
    ) -> CfDictionaryRef;
    fn CFRelease(value: CfTypeRef);
}

#[link(name = "Security", kind = "framework")]
unsafe extern "C" {
    static kSecGuestAttributePid: CfStringRef;
    fn SecCodeCopyGuestWithAttributes(
        host: SecCodeRef,
        attributes: CfDictionaryRef,
        flags: u32,
        guest: *mut SecCodeRef,
    ) -> i32;
    fn SecRequirementCreateWithString(
        text: CfStringRef,
        flags: u32,
        requirement: *mut SecRequirementRef,
    ) -> i32;
    fn SecCodeCheckValidity(code: SecCodeRef, flags: u32, requirement: SecRequirementRef) -> i32;
}

pub(super) fn verify_spawned_code(
    process_id: u32,
    designated_requirement: &str,
) -> Result<(), HelperTransportError> {
    if designated_requirement.is_empty() || designated_requirement.len() > 2_048 {
        return Err(HelperTransportError::ExecutableIdentity);
    }
    let pid =
        i32::try_from(process_id).map_err(|_error| HelperTransportError::ExecutableIdentity)?;
    // SAFETY: every CoreFoundation object is checked for null, remains live
    // across the synchronous Security.framework calls, and is released once.
    unsafe {
        let pid_number =
            CFNumberCreate(ptr::null(), CF_NUMBER_SINT32_TYPE, (&raw const pid).cast());
        if pid_number.is_null() {
            return Err(HelperTransportError::ExecutableIdentity);
        }
        let keys = [kSecGuestAttributePid.cast::<c_void>()];
        let values = [pid_number.cast::<c_void>()];
        let attributes = CFDictionaryCreate(
            ptr::null(),
            keys.as_ptr(),
            values.as_ptr(),
            1,
            ptr::null(),
            ptr::null(),
        );
        if attributes.is_null() {
            CFRelease(pid_number);
            return Err(HelperTransportError::ExecutableIdentity);
        }
        let mut code: SecCodeRef = ptr::null();
        let guest_status =
            SecCodeCopyGuestWithAttributes(ptr::null(), attributes, 0, &raw mut code);
        CFRelease(attributes);
        CFRelease(pid_number);
        if guest_status != 0 || code.is_null() {
            return Err(HelperTransportError::ExecutableIdentity);
        }
        let requirement_text = CFStringCreateWithBytes(
            ptr::null(),
            designated_requirement.as_ptr(),
            isize::try_from(designated_requirement.len())
                .map_err(|_error| HelperTransportError::ExecutableIdentity)?,
            CF_STRING_ENCODING_UTF8,
            0,
        );
        if requirement_text.is_null() {
            CFRelease(code);
            return Err(HelperTransportError::ExecutableIdentity);
        }
        let mut requirement: SecRequirementRef = ptr::null();
        let requirement_status =
            SecRequirementCreateWithString(requirement_text, 0, &raw mut requirement);
        CFRelease(requirement_text);
        if requirement_status != 0 || requirement.is_null() {
            CFRelease(code);
            return Err(HelperTransportError::ExecutableIdentity);
        }
        let validity_status = SecCodeCheckValidity(code, 0, requirement);
        CFRelease(requirement);
        CFRelease(code);
        if validity_status != 0 {
            return Err(HelperTransportError::ExecutableIdentity);
        }
    }
    Ok(())
}

// Public LOCAL_PEERTOKEN and Security.framework audit-token code identity are
// used together: the token, not a second PID/path lookup, selects the live peer.
#[repr(C)]
#[derive(Clone, Copy, Default)]
struct AuditToken {
    values: [u32; 8],
}
struct OwnedAuditToken(AuditToken);
impl Drop for OwnedAuditToken {
    fn drop(&mut self) {
        // SAFETY: the guard exclusively owns this fixed integer token buffer.
        unsafe {
            ptr::write_volatile(&raw mut self.0, AuditToken::default());
        }
    }
}

#[link(name = "bsm")]
unsafe extern "C" {
    fn audit_token_to_auid(token: AuditToken) -> u32;
    fn audit_token_to_asid(token: AuditToken) -> i32;
    fn audit_token_to_pid(token: AuditToken) -> i32;
    fn audit_token_to_euid(token: AuditToken) -> u32;
    #[cfg(test)]
    fn audit_token_to_pidversion(token: AuditToken) -> i32;
}

/// Requires the installed service privilege; it never requests elevation.
///
/// # Errors
/// Returns an identity error for an ordinary user process.
pub fn require_macos_service_privilege() -> Result<(), HelperTransportError> {
    unsafe extern "C" {
        fn geteuid() -> u32;
    }
    // SAFETY: geteuid has no arguments or borrowed memory.
    if unsafe { geteuid() } == 0 {
        Ok(())
    } else {
        Err(HelperTransportError::ExecutableIdentity)
    }
}

/// Verifies the actual root service attached to a kernel socket endpoint.
///
/// # Errors
/// Rejects unprivileged, unsigned, stale or wrong-code endpoints.
pub fn verify_service_socket_peer(
    socket: &std::os::unix::net::UnixStream,
    requirement: &str,
) -> Result<(), HelperTransportError> {
    let token = socket_peer_token(socket)?;
    // SAFETY: libbsm decodes the owned initialized audit token by value.
    if unsafe { audit_token_to_euid(token.0) } != 0 {
        return Err(HelperTransportError::ExecutableIdentity);
    }
    verify_audit_token_code(&token.0, requirement)
}

/// Binds the control and observation connections to the same exact OS peer.
///
/// # Errors
/// Rejects different processes, executable generations or credentials.
pub fn verify_same_macos_socket_peer(
    left: &std::os::unix::net::UnixStream,
    right: &std::os::unix::net::UnixStream,
) -> Result<(), HelperTransportError> {
    let left = socket_peer_token(left)?;
    let right = socket_peer_token(right)?;
    if left.0.values == right.0.values {
        Ok(())
    } else {
        Err(HelperTransportError::ExecutableIdentity)
    }
}

/// Takes ownership of the two fixed launchd-activated listening sockets.
///
/// # Errors
/// Rejects missing, duplicate, wrong-path or non-listening socket descriptors.
pub fn activated_macos_service_listeners() -> Result<
    (
        std::os::unix::net::UnixListener,
        std::os::unix::net::UnixListener,
    ),
    HelperTransportError,
> {
    require_macos_service_privilege()?;
    Ok((
        activated_listener(c"ProctorControl", crate::macos_service::CONTROL_SOCKET_PATH)?,
        activated_listener(
            c"ProctorObservation",
            crate::macos_service::OBSERVATION_SOCKET_PATH,
        )?,
    ))
}

fn activated_listener(
    name: &std::ffi::CStr,
    path: &str,
) -> Result<std::os::unix::net::UnixListener, HelperTransportError> {
    use std::os::fd::{FromRawFd, OwnedFd};
    unsafe extern "C" {
        fn launch_activate_socket(
            name: *const std::ffi::c_char,
            fds: *mut *mut i32,
            count: *mut usize,
        ) -> i32;
        fn free(value: *mut c_void);
    }
    let mut descriptors = ptr::null_mut();
    let mut count = 0;
    // SAFETY: launchd initializes the malloc-owned descriptor array and count.
    let status =
        unsafe { launch_activate_socket(name.as_ptr(), &raw mut descriptors, &raw mut count) };
    if status != 0 {
        return Err(std::io::Error::from_raw_os_error(status).into());
    }
    if descriptors.is_null() {
        return Err(HelperTransportError::ExecutableIdentity);
    }
    // A malformed privileged launch configuration cannot create unbounded cleanup
    // work in the service. Exiting closes every descriptor owned by this process.
    if count > 16 {
        std::process::abort();
    }
    let mut owned = Vec::with_capacity(count);
    for index in 0..count {
        // SAFETY: the OS returned exactly count descriptor entries, transferring ownership.
        let fd = unsafe { *descriptors.add(index) };
        if fd >= 0 {
            owned.push(unsafe { OwnedFd::from_raw_fd(fd) });
        }
    }
    // SAFETY: release the array, not the descriptors now owned by their guards.
    unsafe {
        free(descriptors.cast());
    }
    if count != 1 || owned.len() != 1 {
        return Err(HelperTransportError::ExecutableIdentity);
    }
    let listener = std::os::unix::net::UnixListener::from(owned.remove(0));
    validate_activated_listener(&listener)?;
    set_close_on_exec(&listener)?;
    if listener.local_addr()?.as_pathname() != Some(std::path::Path::new(path)) {
        return Err(HelperTransportError::ExecutableIdentity);
    }
    listener.set_nonblocking(true)?;
    Ok(listener)
}

/// launchd hands over descriptors that are not close-on-exec, so a spawned
/// worker or `codesign` would inherit the listening socket.
fn set_close_on_exec(listener: &std::os::unix::net::UnixListener) -> std::io::Result<()> {
    use std::os::fd::AsRawFd;
    unsafe extern "C" {
        fn fcntl(fd: i32, cmd: i32, ...) -> i32;
    }
    const F_SETFD: i32 = 2;
    const FD_CLOEXEC: i32 = 1;
    // SAFETY: the listener owns this descriptor for the duration of the call.
    if unsafe { fcntl(listener.as_raw_fd(), F_SETFD, FD_CLOEXEC) } == -1 {
        return Err(std::io::Error::last_os_error());
    }
    Ok(())
}

fn validate_activated_listener(
    listener: &std::os::unix::net::UnixListener,
) -> Result<(), HelperTransportError> {
    use std::os::fd::AsRawFd;
    // Darwin exposes SO_ACCEPTCONN in proc_pidfdinfo, not getsockopt. The SDK
    // shim checks the owned descriptor without accepting or changing its state.
    // SAFETY: the listener owns this descriptor throughout the bounded query.
    if unsafe { macos_service_listener_is_valid(listener.as_raw_fd()) } != 1 {
        return Err(HelperTransportError::ExecutableIdentity);
    }
    Ok(())
}
unsafe extern "C" {
    fn macos_service_listener_is_valid(fd: i32) -> i32;
    fn getsockopt(socket: i32, level: i32, name: i32, value: *mut c_void, length: *mut u32) -> i32;
}
#[link(name = "CoreFoundation", kind = "framework")]
unsafe extern "C" {
    fn CFDataCreate(allocator: *const c_void, bytes: *const u8, length: isize) -> CfTypeRef;
}
#[link(name = "Security", kind = "framework")]
unsafe extern "C" {
    static kSecGuestAttributeAudit: CfStringRef;
}

/// Authenticates a connected native peer using the kernel audit token, then
/// projects only its candidate audit-session context into the passive source.
/// The socket and requirement are owned by the privileged bootstrap, not IPC
/// input. This function neither grants a source claim nor elevates the caller.
///
/// # Errors
///
/// Rejects missing peer tokens, stale/exited/unsigned or wrong-code peers and
/// unset audit-session identities. Account/session classification is a separate source fact. The caller must bound this OS call with its existing
/// helper launch deadline and poison on unobserved verifier completion.
pub fn verify_candidate_socket_peer(
    socket: &std::os::unix::net::UnixStream,
    requirement: &str,
) -> Result<process_application_state::MacOsCandidateAuditSession, HelperTransportError> {
    let token = socket_peer_token(socket)?;
    verify_audit_token_code(&token.0, requirement).and_then(|()| {
        // SAFETY: libbsm decodes the fixed kernel-returned token by value.
        let (user, session) =
            unsafe { (audit_token_to_auid(token.0), audit_token_to_asid(token.0)) };
        process_application_state::MacOsCandidateAuditSession::from_verified_peer(
            session.cast_unsigned(),
            user,
        )
        .ok_or(HelperTransportError::ExecutableIdentity)
    })
}

fn socket_peer_token(
    socket: &std::os::unix::net::UnixStream,
) -> Result<OwnedAuditToken, HelperTransportError> {
    use std::os::fd::AsRawFd as _;
    let mut token = OwnedAuditToken(AuditToken::default());
    let mut length = 32_u32;
    // SAFETY: valid connected socket; one exact writable audit_token_t buffer.
    let result = unsafe {
        getsockopt(
            socket.as_raw_fd(),
            0,
            6,
            (&raw mut token.0).cast(),
            &raw mut length,
        )
    };
    if result != 0 || length != 32 {
        return Err(HelperTransportError::ExecutableIdentity);
    }
    // SAFETY: successful LOCAL_PEERTOKEN returned an initialized kernel token.
    if unsafe { audit_token_to_pid(token.0) } <= 0 {
        return Err(HelperTransportError::ExecutableIdentity);
    }
    Ok(token)
}

fn verify_audit_token_code(
    token: &AuditToken,
    designated_requirement: &str,
) -> Result<(), HelperTransportError> {
    if designated_requirement.is_empty() || designated_requirement.len() > 2_048 {
        return Err(HelperTransportError::ExecutableIdentity);
    }
    // SAFETY: every CF object is checked and owned until its final release.
    unsafe {
        let token_data = CFDataCreate(ptr::null(), ptr::from_ref(token).cast(), 32);
        if token_data.is_null() {
            return Err(HelperTransportError::ExecutableIdentity);
        }
        let keys = [kSecGuestAttributeAudit.cast::<c_void>()];
        let values = [token_data];
        let attributes = CFDictionaryCreate(
            ptr::null(),
            keys.as_ptr(),
            values.as_ptr(),
            1,
            ptr::null(),
            ptr::null(),
        );
        if attributes.is_null() {
            CFRelease(token_data);
            return Err(HelperTransportError::ExecutableIdentity);
        }
        let mut code = ptr::null();
        let guest_status =
            SecCodeCopyGuestWithAttributes(ptr::null(), attributes, 0, &raw mut code);
        CFRelease(attributes);
        CFRelease(token_data);
        if guest_status != 0 || code.is_null() {
            return Err(HelperTransportError::ExecutableIdentity);
        }
        let text = CFStringCreateWithBytes(
            ptr::null(),
            designated_requirement.as_ptr(),
            isize::try_from(designated_requirement.len())
                .map_err(|_| HelperTransportError::ExecutableIdentity)?,
            CF_STRING_ENCODING_UTF8,
            0,
        );
        if text.is_null() {
            CFRelease(code);
            return Err(HelperTransportError::ExecutableIdentity);
        }
        let mut requirement = ptr::null();
        let requirement_status = SecRequirementCreateWithString(text, 0, &raw mut requirement);
        CFRelease(text);
        if requirement_status != 0 || requirement.is_null() {
            CFRelease(code);
            return Err(HelperTransportError::ExecutableIdentity);
        }
        let status = SecCodeCheckValidity(code, 0, requirement);
        CFRelease(requirement);
        CFRelease(code);
        if status != 0 {
            return Err(HelperTransportError::ExecutableIdentity);
        }
    }
    Ok(())
}

#[cfg(test)]
mod peer_tests {
    use super::*;
    use std::os::unix::net::UnixStream;

    struct ListenerPath(std::path::PathBuf);

    impl ListenerPath {
        fn bind() -> (Self, std::os::unix::net::UnixListener) {
            static NEXT: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
            let path = std::path::PathBuf::from(format!(
                "/tmp/listener-{}-{}",
                std::process::id(),
                NEXT.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
            ));
            let listener = std::os::unix::net::UnixListener::bind(&path).expect("test listener");
            (Self(path), listener)
        }
    }

    impl Drop for ListenerPath {
        fn drop(&mut self) {
            let _ = std::fs::remove_file(&self.0);
        }
    }

    #[test]
    fn activated_listener_requires_stream_and_listening_state() {
        use std::os::fd::OwnedFd;
        use std::os::unix::net::{UnixDatagram, UnixListener};
        let (_path, listener) = ListenerPath::bind();
        validate_activated_listener(&listener).expect("listening stream");
        let (stream, _peer) = UnixStream::pair().expect("non-listening stream");
        let not_listening = UnixListener::from(OwnedFd::from(stream));
        assert!(validate_activated_listener(&not_listening).is_err());
        let datagram =
            UnixListener::from(OwnedFd::from(UnixDatagram::unbound().expect("datagram")));
        assert!(validate_activated_listener(&datagram).is_err());
    }

    #[test]
    fn activated_listener_acceptance_child() {
        use std::io::{Read, Write};
        use std::os::fd::AsFd;
        if std::env::var_os("TEST_ACCEPTANCE_CHILD").is_none() {
            return;
        }
        let listener = std::os::unix::net::UnixListener::from(
            std::io::stdin()
                .as_fd()
                .try_clone_to_owned()
                .expect("inherited listener"),
        );
        let mut gate = UnixStream::from(
            std::io::stderr()
                .as_fd()
                .try_clone_to_owned()
                .expect("test gate"),
        );
        gate.set_read_timeout(Some(std::time::Duration::from_secs(5)))
            .unwrap();
        gate.write_all(&[1]).unwrap();
        gate.read_exact(&mut [0]).unwrap();
        let (mut accepted, _) = listener.accept().unwrap();
        crate::write_frame(&mut accepted, crate::MACOS_SERVICE_ACCEPTANCE_FRAME).unwrap();
        gate.read_exact(&mut [0]).unwrap();
    }

    #[test]
    fn acceptance_frame_precedes_proof_of_the_actual_accepting_process() {
        use std::io::{Read, Write};
        use std::os::fd::OwnedFd;
        use std::process::{Command, Stdio};
        use std::time::{Duration, Instant};
        let (path, listener) = ListenerPath::bind();
        let (mut gate, child_gate) = UnixStream::pair().unwrap();
        let mut child = Command::new(std::env::current_exe().unwrap())
            .args([
                "--exact",
                "macos::peer_tests::activated_listener_acceptance_child",
                "--nocapture",
            ])
            .env("TEST_ACCEPTANCE_CHILD", "1")
            .stdin(Stdio::from(OwnedFd::from(listener)))
            .stdout(Stdio::null())
            .stderr(Stdio::from(OwnedFd::from(child_gate)))
            .spawn()
            .unwrap();
        let outcome = (|| -> Result<(), Box<dyn std::error::Error>> {
            gate.set_read_timeout(Some(Duration::from_secs(5)))?;
            gate.read_exact(&mut [0])?;
            let mut client = UnixStream::connect(&path.0)?;
            client.set_read_timeout(Some(Duration::from_secs(5)))?;
            let before = socket_peer_token(&client)?;
            // launchd is simulated by this listener-creating parent. Merely
            // connecting cannot yet authenticate the future accepting child.
            assert_eq!(
                unsafe { audit_token_to_pid(before.0) }.cast_unsigned(),
                std::process::id()
            );
            gate.write_all(&[1])?;
            assert_eq!(
                crate::read_frame(&mut client)?,
                crate::MACOS_SERVICE_ACCEPTANCE_FRAME
            );
            let after = socket_peer_token(&client)?;
            assert_eq!(
                unsafe { audit_token_to_pid(after.0) }.cast_unsigned(),
                child.id()
            );
            gate.write_all(&[1])?;
            Ok(())
        })();
        let deadline = Instant::now() + Duration::from_secs(5);
        let status = loop {
            match child.try_wait() {
                Ok(Some(status)) => break Some(status),
                Ok(None) if Instant::now() < deadline => {
                    std::thread::sleep(Duration::from_millis(5));
                }
                _ => break None,
            }
        };
        if status.is_none() {
            let _ = child.kill();
            let _ = child.wait();
        }
        outcome.expect("cross-process acceptance handshake");
        assert!(status.is_some_and(|status| status.success()));
    }

    #[test]
    fn socket_peer_token_is_kernel_bound_to_the_live_connecting_process() {
        let (left, _right) = UnixStream::pair().expect("local socket pair");
        let token = socket_peer_token(&left).expect("kernel token");
        // SAFETY: decode the initialized kernel token without exposing it.
        let pid = unsafe { audit_token_to_pid(token.0) };
        assert_eq!(
            u32::try_from(pid).expect("positive pid"),
            std::process::id()
        );
        // The generation is tested only as stable, not as a guessed numeric value.
        let other = socket_peer_token(&left).expect("same connection");
        assert_eq!(unsafe { audit_token_to_pidversion(token.0) }, unsafe {
            audit_token_to_pidversion(other.0)
        });
    }

    #[test]
    fn socket_peer_with_unmatched_code_requirement_is_rejected() {
        let (left, _right) = UnixStream::pair().expect("local socket pair");
        assert!(
            verify_candidate_socket_peer(&left, "identifier \"invalid.proctor.test-peer\"")
                .is_err()
        );
        assert!(verify_candidate_socket_peer(&left, "").is_err());
    }
}
