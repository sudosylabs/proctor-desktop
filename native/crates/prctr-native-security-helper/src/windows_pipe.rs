//! Fixed local service transport. A connected pipe is not an authenticated peer.
//! The service bootstrap must bind the live process/token before exchanging facts.
use std::io::{self, Read, Write};
use std::mem;
use std::os::windows::io::BorrowedHandle;
use std::ptr;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};

use windows_sys::Win32::Foundation::{
    CloseHandle, ERROR_IO_PENDING, ERROR_NOT_FOUND, ERROR_OPERATION_ABORTED, ERROR_PIPE_CONNECTED,
    GetLastError, HANDLE, INVALID_HANDLE_VALUE, LocalFree, WAIT_OBJECT_0, WAIT_TIMEOUT,
};
use windows_sys::Win32::Security::Authorization::{
    ConvertStringSecurityDescriptorToSecurityDescriptorW, SDDL_REVISION_1,
};
use windows_sys::Win32::Security::SECURITY_ATTRIBUTES;
use windows_sys::Win32::Storage::FileSystem::{
    FILE_FLAG_FIRST_PIPE_INSTANCE, FILE_FLAG_OVERLAPPED, PIPE_ACCESS_DUPLEX, ReadFile, WriteFile,
};
use windows_sys::Win32::System::IO::{CancelIoEx, GetOverlappedResult, OVERLAPPED};
use windows_sys::Win32::System::Pipes::{
    ConnectNamedPipe, CreateNamedPipeW, PIPE_READMODE_BYTE, PIPE_REJECT_REMOTE_CLIENTS,
    PIPE_TYPE_BYTE, PIPE_WAIT,
};
use windows_sys::Win32::System::Threading::{CreateEventW, WaitForSingleObject};

use crate::{HelperTransportError, poison_helper_utility};

pub(super) const PIPE_NAME: &str = r"\\.\pipe\Proctor.Native.Control.v1";
const PIPE_BUFFER_BYTES: u32 = 65_536;
const ACCEPT_POLL_MS: u32 = 50;

struct CheckedHandle(usize);
impl CheckedHandle {
    fn take(handle: HANDLE) -> io::Result<Self> {
        if handle.is_null() || handle == INVALID_HANDLE_VALUE {
            Err(io::Error::last_os_error())
        } else {
            Ok(Self(handle as usize))
        }
    }
    fn raw(&self) -> HANDLE {
        self.0 as HANDLE
    }
}
impl Drop for CheckedHandle {
    fn drop(&mut self) {
        // SAFETY: this guard exclusively owns a successful kernel handle creation.
        if unsafe { CloseHandle(self.raw()) } == 0 {
            poison_helper_utility();
        }
    }
}

struct PipeState {
    handle: CheckedHandle,
    stopping: AtomicBool,
}
impl PipeState {
    fn cancel(&self) {
        self.stopping.store(true, Ordering::Release);
        // SAFETY: Arc ownership keeps the handle alive through all pending operations.
        if unsafe { CancelIoEx(self.handle.raw(), ptr::null()) } == 0
            && unsafe { GetLastError() } != ERROR_NOT_FOUND
        {
            poison_helper_utility();
        }
    }
}

/// Owns cancellation; reader/writer clones never close the channel independently.
/// All Read/Write calls belong in the existing deadline-framed worker owner.
/// Cancellation does not release OVERLAPPED storage until the kernel completes it.
pub struct WindowsServicePipe {
    state: Arc<PipeState>,
}
pub struct WindowsPipeReader(Arc<PipeState>);
pub struct WindowsPipeWriter(Arc<PipeState>);

impl WindowsServicePipe {
    pub(super) fn cancellation(&self) -> impl Fn() + Send + Sync + 'static {
        let state = Arc::clone(&self.state);
        move || state.cancel()
    }

    #[must_use]
    pub fn reader(&self) -> WindowsPipeReader {
        WindowsPipeReader(Arc::clone(&self.state))
    }
    #[must_use]
    pub fn writer(&self) -> WindowsPipeWriter {
        WindowsPipeWriter(Arc::clone(&self.state))
    }
    #[must_use]
    pub fn handle(&self) -> BorrowedHandle<'_> {
        // SAFETY: self owns the handle throughout the returned borrow.
        unsafe { BorrowedHandle::borrow_raw(self.state.handle.raw()) }
    }
    pub fn shutdown(&self) {
        self.state.cancel();
    }
}
impl Drop for WindowsServicePipe {
    fn drop(&mut self) {
        self.shutdown();
    }
}

/// Create one fixed, local-only, non-inheritable server instance. An existing
/// instance is an error, never something whose ACL or ownership is taken over.
/// # Errors
/// Returns ACL, endpoint collision, handle creation or cleanup failure.
pub fn create_listener() -> Result<WindowsServicePipe, HelperTransportError> {
    create_named_listener(PIPE_NAME)
}

pub(super) fn create_source_listener() -> Result<WindowsServicePipe, HelperTransportError> {
    create_named_listener(r"\\.\pipe\Proctor.Native.Sources.v1")
}

fn create_named_listener(name: &str) -> Result<WindowsServicePipe, HelperTransportError> {
    crate::ensure_helper_utility_usable()?;
    let name: Vec<_> = name.encode_utf16().chain([0]).collect();
    // Only SYSTEM and local interactive users may open this pipe. Interactive
    // access permits a closed launch request, not native source authorization.
    let descriptor: Vec<_> = "D:P(A;;GA;;;SY)(A;;GRGW;;;IU)"
        .encode_utf16()
        .chain([0])
        .collect();
    let mut security = ptr::null_mut();
    // SAFETY: fixed terminated SDDL and valid output storage; no client-selected ACL.
    if unsafe {
        ConvertStringSecurityDescriptorToSecurityDescriptorW(
            descriptor.as_ptr(),
            SDDL_REVISION_1,
            &raw mut security,
            ptr::null_mut(),
        )
    } == 0
    {
        return Err(io::Error::last_os_error().into());
    }
    let attributes = SECURITY_ATTRIBUTES {
        nLength: u32::try_from(mem::size_of::<SECURITY_ATTRIBUTES>()).expect("fixed SDK structure"),
        lpSecurityDescriptor: security,
        bInheritHandle: 0,
    };
    // SAFETY: all initialized inputs remain alive for this synchronous creation.
    let result = CheckedHandle::take(unsafe {
        CreateNamedPipeW(
            name.as_ptr(),
            PIPE_ACCESS_DUPLEX | FILE_FLAG_OVERLAPPED | FILE_FLAG_FIRST_PIPE_INSTANCE,
            PIPE_TYPE_BYTE | PIPE_READMODE_BYTE | PIPE_WAIT | PIPE_REJECT_REMOTE_CLIENTS,
            1,
            PIPE_BUFFER_BYTES,
            PIPE_BUFFER_BYTES,
            0,
            &raw const attributes,
        )
    });
    // SAFETY: Windows allocated this descriptor; creation has already copied it.
    if !unsafe { LocalFree(security) }.is_null() {
        poison_helper_utility();
        return Err(HelperTransportError::UtilityPoisoned);
    }
    let handle = result?;
    Ok(WindowsServicePipe {
        state: Arc::new(PipeState {
            handle,
            stopping: AtomicBool::new(false),
        }),
    })
}

/// Dormant accept owns no candidate source. The process-owned SCM stop flag
/// cancels it; client admission receives its separate startup deadline afterward.
/// Invoke inside the service's bounded cleanup owner so a stuck kernel cancel
/// poisons/replaces the service rather than releasing pending native storage.
/// # Errors
/// Returns cancellation, connection, or OS completion failure.
pub fn accept(
    pipe: &WindowsServicePipe,
    stop_requested: impl Fn() -> bool,
) -> Result<(), HelperTransportError> {
    finish_accept(pipe, &stop_requested)?;
    let mut operation = OverlappedOperation::new()?;
    // SAFETY: event and OVERLAPPED stay live until completion/cancellation settles.
    let connected =
        unsafe { ConnectNamedPipe(pipe.state.handle.raw(), &raw mut operation.overlapped) };
    if connected != 0 {
        return finish_accept(pipe, &stop_requested);
    }
    // SAFETY: capture the error before any other SDK operation.
    match unsafe { GetLastError() } {
        ERROR_PIPE_CONNECTED => return finish_accept(pipe, &stop_requested),
        ERROR_IO_PENDING => {}
        error => return Err(io::Error::from_raw_os_error(error.cast_signed()).into()),
    }
    loop {
        if stop_requested() || pipe.state.stopping.load(Ordering::Acquire) {
            pipe.shutdown();
            // Preserve operation storage even when cancellation takes longer than
            // the outer owner's cleanup deadline; that owner fences the process.
            let _ = operation.complete(&pipe.state);
            return Err(HelperTransportError::ConnectionFenced);
        }
        // SAFETY: the event is exclusively owned and remains alive while waiting.
        match unsafe { WaitForSingleObject(operation.event.raw(), ACCEPT_POLL_MS) } {
            WAIT_OBJECT_0 => {
                operation.complete(&pipe.state)?;
                return finish_accept(pipe, &stop_requested);
            }
            WAIT_TIMEOUT => {}
            _ => {
                pipe.shutdown();
                let _ = operation.complete(&pipe.state);
                return Err(HelperTransportError::ConnectionFenced);
            }
        }
    }
}

fn finish_accept(
    pipe: &WindowsServicePipe,
    stop_requested: &impl Fn() -> bool,
) -> Result<(), HelperTransportError> {
    if stop_requested() || pipe.state.stopping.load(Ordering::Acquire) {
        pipe.shutdown();
        Err(HelperTransportError::ConnectionFenced)
    } else {
        Ok(())
    }
}

struct OverlappedOperation {
    overlapped: OVERLAPPED,
    event: CheckedHandle,
}
impl OverlappedOperation {
    fn new() -> io::Result<Self> {
        // SAFETY: unnamed manual-reset event, no inherited security descriptor.
        let event = CheckedHandle::take(unsafe { CreateEventW(ptr::null(), 1, 0, ptr::null()) })?;
        Ok(Self {
            overlapped: OVERLAPPED {
                hEvent: event.raw(),
                ..OVERLAPPED::default()
            },
            event,
        })
    }
    fn complete(&mut self, pipe: &PipeState) -> io::Result<usize> {
        if pipe.stopping.load(Ordering::Acquire) {
            // Close the launch-vs-shutdown race: cancellation may have run just
            // before this operation was submitted to the kernel.
            unsafe {
                CancelIoEx(pipe.handle.raw(), &raw const self.overlapped);
            }
        }
        let mut bytes = 0;
        // SAFETY: the framing worker owns both its buffer and this operation
        // until the kernel signals completion. The caller never detaches buffers.
        if unsafe {
            GetOverlappedResult(
                pipe.handle.raw(),
                &raw const self.overlapped,
                &raw mut bytes,
                1,
            )
        } == 0
        {
            let error = io::Error::last_os_error();
            if error.raw_os_error() == Some(ERROR_OPERATION_ABORTED.cast_signed()) {
                return Err(io::Error::new(
                    io::ErrorKind::BrokenPipe,
                    "native pipe closed",
                ));
            }
            return Err(error);
        }
        Ok(bytes as usize)
    }
}

fn ensure_open(pipe: &PipeState) -> io::Result<()> {
    if pipe.stopping.load(Ordering::Acquire) {
        Err(io::Error::new(
            io::ErrorKind::BrokenPipe,
            "native pipe closed",
        ))
    } else {
        Ok(())
    }
}
impl Read for WindowsPipeReader {
    fn read(&mut self, bytes: &mut [u8]) -> io::Result<usize> {
        ensure_open(&self.0)?;
        if bytes.is_empty() {
            return Ok(0);
        }
        let mut operation = OverlappedOperation::new()?;
        let length =
            u32::try_from(bytes.len().min(PIPE_BUFFER_BYTES as usize)).expect("bounded pipe read");
        // SAFETY: buffer and operation live through complete; exactly one reader.
        let success = unsafe {
            ReadFile(
                self.0.handle.raw(),
                bytes.as_mut_ptr(),
                length,
                ptr::null_mut(),
                &raw mut operation.overlapped,
            )
        };
        if success == 0 && unsafe { GetLastError() } != ERROR_IO_PENDING {
            return Err(io::Error::last_os_error());
        }
        operation.complete(&self.0)
    }
}
impl Write for WindowsPipeWriter {
    fn write(&mut self, bytes: &[u8]) -> io::Result<usize> {
        ensure_open(&self.0)?;
        if bytes.is_empty() {
            return Ok(0);
        }
        let mut operation = OverlappedOperation::new()?;
        let length =
            u32::try_from(bytes.len().min(PIPE_BUFFER_BYTES as usize)).expect("bounded pipe write");
        // SAFETY: buffer and operation live through complete; exactly one writer.
        let success = unsafe {
            WriteFile(
                self.0.handle.raw(),
                bytes.as_ptr(),
                length,
                ptr::null_mut(),
                &raw mut operation.overlapped,
            )
        };
        if success == 0 && unsafe { GetLastError() } != ERROR_IO_PENDING {
            return Err(io::Error::last_os_error());
        }
        operation.complete(&self.0)
    }
    fn flush(&mut self) -> io::Result<()> {
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::AtomicU32;
    use std::time::{Duration, Instant};
    use windows_sys::Win32::Foundation::{GENERIC_READ, GENERIC_WRITE};
    use windows_sys::Win32::Storage::FileSystem::{CreateFileW, OPEN_EXISTING};

    static NEXT: AtomicU32 = AtomicU32::new(0);
    fn pair() -> (WindowsServicePipe, WindowsServicePipe) {
        let name = format!(
            r"\\.\pipe\Proctor.Native.Test.{}.{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        );
        let server = create_named_listener(&name).unwrap();
        assert!(
            create_named_listener(&name).is_err(),
            "first-instance name cannot be taken over"
        );
        let name: Vec<_> = name.encode_utf16().chain([0]).collect();
        // SAFETY: own test endpoint, noninheritable overlapped connection.
        let handle = CheckedHandle::take(unsafe {
            CreateFileW(
                name.as_ptr(),
                GENERIC_READ | GENERIC_WRITE,
                0,
                ptr::null(),
                OPEN_EXISTING,
                FILE_FLAG_OVERLAPPED,
                ptr::null_mut(),
            )
        })
        .unwrap();
        let client = WindowsServicePipe {
            state: Arc::new(PipeState {
                handle,
                stopping: AtomicBool::new(false),
            }),
        };
        accept(&server, || false).unwrap();
        (server, client)
    }

    #[test]
    fn overlapped_pipe_preserves_framing_and_closes_pending_reads() {
        let (server, client) = pair();
        let mut receiver = server.reader();
        let mut sender = client.writer();
        sender.write_all(b"bounded service frame").unwrap();
        let mut bytes = [0; 21];
        receiver.read_exact(&mut bytes).unwrap();
        assert_eq!(&bytes, b"bounded service frame");
        let (started, waiting) = std::sync::mpsc::sync_channel(1);
        let (returned, result) = std::sync::mpsc::sync_channel(1);
        let mut join = crate::WorkerJoinReceipt::spawn("test-pipe-read", move || {
            started.send(()).unwrap();
            returned.send(receiver.read(&mut [0; 1])).unwrap();
        })
        .unwrap();
        waiting.recv_timeout(Duration::from_secs(1)).unwrap();
        server.shutdown();
        assert!(
            result
                .recv_timeout(Duration::from_secs(1))
                .unwrap()
                .is_err()
        );
        join.wait(Instant::now() + Duration::from_secs(1)).unwrap();
    }

    #[test]
    fn already_connected_accept_still_observes_service_stop() {
        let (server, _client) = pair();
        assert!(accept(&server, || true).is_err());
        assert!(server.reader().read(&mut [0; 1]).is_err());
    }

    #[test]
    fn stopped_accept_and_late_io_do_not_reopen_the_endpoint() {
        let name = format!(
            r"\\.\pipe\Proctor.Native.Test.{}.{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        );
        let server = create_named_listener(&name).unwrap();
        assert!(accept(&server, || true).is_err());
        assert!(server.reader().read(&mut [0; 1]).is_err());
        assert!(server.writer().write(b"x").is_err());
    }
}
