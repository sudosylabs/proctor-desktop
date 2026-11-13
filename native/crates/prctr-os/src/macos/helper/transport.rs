use crate::OsError;
use objc2_core_foundation::{CFData, CFDictionary, CFRetained, CFString, CFType, CFURL};
use objc2_security::{SecCSFlags, SecCode, SecRequirement, SecStaticCode, kSecGuestAttributeAudit};
use std::io;
use std::os::fd::{AsRawFd, FromRawFd};
use std::os::unix::net::{UnixListener, UnixStream};
use std::ptr::NonNull;

unsafe extern "C" {
    fn launch_activate_socket(
        name: *const libc::c_char,
        fds: *mut *mut i32,
        count: *mut usize,
    ) -> i32;
}

/// # Errors
/// Root, launchd socket activation, or descriptor-count validation failed.
pub fn activate_socket() -> io::Result<UnixListener> {
    if !super::is_root() {
        return Err(io::ErrorKind::PermissionDenied.into());
    }
    let mut fds = std::ptr::null_mut();
    let mut count = 0;
    // SAFETY: the literal socket key is NUL terminated; outputs are writable.
    let status =
        unsafe { launch_activate_socket(c"Listener".as_ptr(), &raw mut fds, &raw mut count) };
    if status != 0 {
        return Err(io::Error::from_raw_os_error(status));
    }
    if fds.is_null() {
        return Err(io::ErrorKind::InvalidData.into());
    }
    let mut listener = None;
    // launchd should supply exactly one descriptor for this AF_UNIX socket declaration.
    for index in 0..count.min(1024) {
        // SAFETY: successful launch_activate_socket returns count initialized descriptors.
        let pointer = unsafe { fds.add(index) };
        // SAFETY: the pointer identifies an initialized descriptor in the returned array.
        let fd = unsafe { *pointer };
        if count == 1 {
            // SAFETY: launchd transferred ownership of the listening descriptor to this process.
            listener = Some(unsafe { UnixListener::from_raw_fd(fd) });
        } else {
            // SAFETY: extra descriptors are owned by this process and must be closed.
            let _ = unsafe { libc::close(fd) };
        }
    }
    // SAFETY: launch_activate_socket allocates the descriptor array with malloc.
    unsafe { libc::free(fds.cast()) };
    listener.ok_or_else(|| io::ErrorKind::InvalidData.into())
}

/// # Errors
/// The peer token could not be read completely.
pub fn peer_token(stream: &UnixStream) -> io::Result<[u32; 8]> {
    let mut token = [0_u32; 8];
    let mut size = libc::socklen_t::try_from(size_of_val(&token)).map_err(io::Error::other)?;
    // SAFETY: token is writable for the declared size; stream owns a connected Unix socket.
    if unsafe {
        libc::getsockopt(
            stream.as_raw_fd(),
            0,
            libc::LOCAL_PEERTOKEN,
            token.as_mut_ptr().cast(),
            &raw mut size,
        )
    } != 0
    {
        return Err(io::Error::last_os_error());
    }
    if size as usize != size_of_val(&token) {
        return Err(io::ErrorKind::InvalidData.into());
    }
    Ok(token)
}

/// # Errors
/// The peer credentials could not be read completely.
pub fn peer_uid(stream: &UnixStream) -> io::Result<u32> {
    let mut credential = std::mem::MaybeUninit::<libc::xucred>::zeroed();
    let mut size =
        libc::socklen_t::try_from(size_of::<libc::xucred>()).map_err(io::Error::other)?;
    // SAFETY: credential is writable for size bytes; stream is a live Unix socket.
    if unsafe {
        libc::getsockopt(
            stream.as_raw_fd(),
            0,
            libc::LOCAL_PEERCRED,
            credential.as_mut_ptr().cast(),
            &raw mut size,
        )
    } != 0
    {
        return Err(io::Error::last_os_error());
    }
    if size as usize != size_of::<libc::xucred>() {
        return Err(io::ErrorKind::InvalidData.into());
    }
    // SAFETY: getsockopt initialized the full xucred structure.
    let credential = unsafe { credential.assume_init() };
    if credential.cr_version != libc::XUCRED_VERSION {
        return Err(io::ErrorKind::InvalidData.into());
    }
    Ok(credential.cr_uid)
}

#[must_use]
pub fn authorize_agent(token: [u32; 8]) -> bool {
    let check = || -> Option<bool> {
        let executable = std::env::current_exe().ok()?;
        let contents = executable
            .ancestors()
            .find(|path| path.file_name().is_some_and(|name| name == "Contents"))?;
        let url = CFURL::from_file_path(contents.join("MacOS/prctr-agent"))?;
        let mut expected = std::ptr::null();
        // SAFETY: url is live and expected is a writable static-code output.
        let status = unsafe {
            SecStaticCode::create_with_path(&url, SecCSFlags::empty(), NonNull::from(&mut expected))
        };
        let expected = NonNull::new(expected.cast_mut()).filter(|_| status == 0)?;
        // SAFETY: create_with_path transferred a +1 object to this owner.
        let expected = unsafe { CFRetained::from_raw(expected) };
        let mut requirement = std::ptr::null_mut::<SecRequirement>();
        // SAFETY: expected is live, and requirement is a writable output.
        let status = unsafe {
            SecCode::copy_designated_requirement(
                &expected,
                SecCSFlags::empty(),
                NonNull::from(&mut requirement),
            )
        };
        let requirement = NonNull::new(requirement).filter(|_| status == 0)?;
        // SAFETY: the copy call transferred a +1 requirement to this owner.
        let requirement = unsafe { CFRetained::from_raw(requirement) };
        // SAFETY: token is exactly the connection's initialized audit_token_t representation.
        let bytes =
            unsafe { std::slice::from_raw_parts(token.as_ptr().cast::<u8>(), size_of_val(&token)) };
        let data = CFData::from_bytes(bytes);
        // SAFETY: immutable Security framework key.
        let key = unsafe { kSecGuestAttributeAudit };
        let attributes = CFDictionary::<CFString, CFType>::from_slices(&[key], &[data.as_ref()]);
        let mut peer = std::ptr::null_mut::<SecCode>();
        // SAFETY: attributes contains a complete audit token, and peer is a writable output.
        let status = unsafe {
            SecCode::copy_guest_with_attributes(
                None,
                Some(attributes.as_opaque()),
                SecCSFlags::empty(),
                NonNull::from(&mut peer),
            )
        };
        let peer = NonNull::new(peer).filter(|_| status == 0)?;
        // SAFETY: the copy call transferred a +1 code object to this owner.
        let peer = unsafe { CFRetained::from_raw(peer) };
        // SAFETY: live guest and requirement, with the guest bound to the socket audit token.
        Some(unsafe { peer.check_validity(SecCSFlags::empty(), Some(&requirement)) } == 0)
    };
    check().unwrap_or(false)
}

/// Registration is setup-only. A status query never registers or changes approval.
/// # Errors
/// Registration or status query failed; only a numeric error is returned.
pub fn registration(register: bool) -> Result<Registration, OsError> {
    use objc2_foundation::NSString;
    use objc2_service_management::{SMAppService, SMAppServiceStatus};
    let name = NSString::from_str("com.proctor.native.plist");
    // SAFETY: literal bundle-relative LaunchDaemons plist name; no arbitrary job is selected.
    let service = unsafe { SMAppService::daemonServiceWithPlistName(&name) };
    if register {
        // SAFETY: explicit setup-only caller; errors contain only numeric status here.
        unsafe { service.registerAndReturnError() }.map_err(|error| OsError {
            operation: "SMAppService.register",
            status: error.code() as i64,
        })?;
    }
    // SAFETY: querying this live service's status has no side effects.
    match unsafe { service.status() } {
        SMAppServiceStatus::NotRegistered | SMAppServiceStatus::NotFound => {
            Ok(Registration::NotRegistered)
        }
        SMAppServiceStatus::RequiresApproval => Ok(Registration::RequiresApproval),
        SMAppServiceStatus::Enabled => Ok(Registration::Enabled),
        _ => Err(OsError {
            operation: "SMAppService.status",
            status: -1,
        }),
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Registration {
    NotRegistered,
    RequiresApproval,
    Enabled,
}

/// Waits for launchd's SIGTERM using kqueue, without installing a process-global handler.
/// # Errors
/// Signal notification could not be registered or received.
pub fn wait_for_stop() -> io::Result<()> {
    // SAFETY: kqueue has no preconditions and returns a new owned descriptor.
    let fd = unsafe { libc::kqueue() };
    if fd < 0 {
        return Err(io::Error::last_os_error());
    }
    // SAFETY: the successful call transferred descriptor ownership.
    let queue = unsafe { std::os::fd::OwnedFd::from_raw_fd(fd) };
    let event = libc::kevent {
        ident: libc::SIGTERM as usize,
        filter: libc::EVFILT_SIGNAL,
        flags: libc::EV_ADD | libc::EV_ENABLE,
        fflags: 0,
        data: 0,
        udata: std::ptr::null_mut(),
    };
    // SAFETY: initialized change record; no output is requested.
    if unsafe {
        libc::kevent(
            queue.as_raw_fd(),
            &raw const event,
            1,
            std::ptr::null_mut(),
            0,
            std::ptr::null(),
        )
    } < 0
    {
        return Err(io::Error::last_os_error());
    }
    // SAFETY: a daemon may ignore SIGTERM's default action after kqueue starts observing it.
    unsafe { libc::signal(libc::SIGTERM, libc::SIG_IGN) };
    let mut output = std::mem::MaybeUninit::<libc::kevent>::uninit();
    // SAFETY: queue is live, output has space for one event, no change inputs.
    if unsafe {
        libc::kevent(
            queue.as_raw_fd(),
            std::ptr::null(),
            0,
            output.as_mut_ptr(),
            1,
            std::ptr::null(),
        )
    } < 0
    {
        return Err(io::Error::last_os_error());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    #[test]
    fn unix_socket_credentials_and_audit_token_identify_the_connected_peer() {
        let (local, _remote) = std::os::unix::net::UnixStream::pair().expect("socket pair");
        let token = super::peer_token(&local).expect("audit token");
        assert_eq!(token[5], std::process::id());
        // SAFETY: geteuid has no preconditions and returns only this process's effective UID.
        let uid = unsafe { libc::geteuid() };
        assert_eq!(super::peer_uid(&local).expect("peer uid"), uid);
        assert!(
            !super::authorize_agent(token),
            "a test executable outside the app bundle is refused"
        );
    }
}
