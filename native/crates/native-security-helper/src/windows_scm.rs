//! Process-owned SCM entrypoint. This never installs, starts or elevates a service.
use std::mem;
use std::panic::{AssertUnwindSafe, catch_unwind};
use std::ptr;
use std::sync::{Arc, Mutex, OnceLock};

use interactive_session_state::WindowsWtsServiceDispatcher;
use windows_sys::Win32::Foundation::{CloseHandle, HANDLE};
use windows_sys::Win32::Security::{
    GetLengthSid, GetTokenInformation, IsValidSid, IsWellKnownSid, TOKEN_QUERY, TOKEN_USER,
    TokenUser, WinLocalSystemSid,
};
use windows_sys::Win32::System::Services::{SERVICE_TABLE_ENTRYW, StartServiceCtrlDispatcherW};
use windows_sys::Win32::System::Threading::{GetCurrentProcess, OpenProcessToken};

use crate::{HelperTransportError, ensure_helper_utility_usable, poison_helper_utility};

pub const WINDOWS_SERVICE_NAME: &str = "ProctorNative";

/// Concrete bootstrap owns its fixed listener, authenticated controlled client,
/// and sources. It announces running only after the listener is ready, observes
/// `stop_requested`, and returns only after closing all accepted source lifetimes.
pub trait WindowsServiceBody: Send {
    /// # Errors
    /// Returns authentication, source, transport, or cleanup failure after fencing owned work.
    fn run(
        self: Box<Self>,
        dispatcher: Arc<WindowsWtsServiceDispatcher>,
    ) -> Result<(), HelperTransportError>;
}
struct ServiceSlot {
    body: Mutex<Option<Box<dyn WindowsServiceBody>>>,
    outcome: Mutex<Option<Result<(), HelperTransportError>>>,
}
static SERVICE: OnceLock<ServiceSlot> = OnceLock::new();

/// Enter only from the exact packaged executable's fixed SCM mode. The ordinary
/// desktop process must not invoke this as an installation or elevation fallback.
/// # Errors
/// Rejects non-SYSTEM execution, duplicate entry, missing SCM ownership, body or cleanup failure.
pub fn run_windows_service(body: Box<dyn WindowsServiceBody>) -> Result<(), HelperTransportError> {
    ensure_helper_utility_usable()?;
    require_system_primary_token()?;
    SERVICE
        .set(ServiceSlot {
            body: Mutex::new(Some(body)),
            outcome: Mutex::new(None),
        })
        .map_err(|_| HelperTransportError::ConnectionFenced)?;
    let mut name: Vec<_> = WINDOWS_SERVICE_NAME.encode_utf16().chain([0]).collect();
    let table = [
        SERVICE_TABLE_ENTRYW {
            lpServiceName: name.as_mut_ptr(),
            lpServiceProc: Some(service_main),
        },
        SERVICE_TABLE_ENTRYW {
            lpServiceName: ptr::null_mut(),
            lpServiceProc: None,
        },
    ];
    // SAFETY: fixed service table/name stay alive while SCM invokes the callback.
    // This is the process-lifetime service dispatcher, not an observation callback.
    if unsafe { StartServiceCtrlDispatcherW(table.as_ptr()) } == 0 {
        return Err(std::io::Error::last_os_error().into());
    }
    ensure_helper_utility_usable()?;
    SERVICE
        .get()
        .and_then(|slot| slot.outcome.lock().ok()?.take())
        .ok_or(HelperTransportError::ConnectionFenced)?
}

unsafe extern "system" fn service_main(_argument_count: u32, _arguments: *mut *mut u16) {
    // SCM arguments never choose an executable, manifest, pipe name or native policy.
    let outcome = catch_unwind(AssertUnwindSafe(run_service_main));
    let Ok(result) = outcome else {
        // No Rust unwind crosses SCM. A panic cannot prove source/worker cleanup.
        std::process::abort();
    };
    let Some(slot) = SERVICE.get() else {
        std::process::abort();
    };
    let Ok(mut stored) = slot.outcome.lock() else {
        std::process::abort();
    };
    *stored = Some(result);
}

fn run_service_main() -> Result<(), HelperTransportError> {
    require_system_primary_token()?;
    let slot = SERVICE
        .get()
        .ok_or(HelperTransportError::ConnectionFenced)?;
    let body = slot
        .body
        .lock()
        .map_err(|_| HelperTransportError::UtilityPoisoned)?
        .take()
        .ok_or(HelperTransportError::ConnectionFenced)?;
    let dispatcher = Arc::new(
        WindowsWtsServiceDispatcher::register(WINDOWS_SERVICE_NAME)
            .map_err(|_| HelperTransportError::ConnectionFenced)?,
    );
    // All service-body SDK work, including cancellation and destructor cleanup,
    // remains behind a process-owned actual-join watchdog. SCM stop cannot hang
    // indefinitely in a kernel call even if that call ignores cancellation.
    let worker_dispatcher = Arc::clone(&dispatcher);
    let outcome = crate::service_accept::accept_owned(
        move || body.run(worker_dispatcher),
        || {},
        || dispatcher.stop_requested(),
        None,
    );
    let outcome = if dispatcher.stop_requested() && ensure_helper_utility_usable().is_ok() {
        Ok(())
    } else {
        outcome
    };
    // Reporting SERVICE_STOPPED must never precede proof that every source owner
    // returned its dispatcher reference and every SDK cleanup owner settled.
    if Arc::strong_count(&dispatcher) != 1
        || ensure_helper_utility_usable().is_err()
        || native_source_runtime::ensure_native_source_process_usable().is_err()
    {
        std::process::abort();
    }
    drop(dispatcher);
    if native_source_runtime::ensure_native_source_process_usable().is_err() {
        std::process::abort();
    }
    outcome
}

fn require_system_primary_token() -> Result<(), HelperTransportError> {
    let mut token: HANDLE = ptr::null_mut();
    // SAFETY: fixed primary-token query on this process, no thread impersonation.
    if unsafe { OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &raw mut token) } == 0 {
        return Err(HelperTransportError::ExecutableIdentity);
    }
    let mut buffer = [0_usize; 32];
    let mut returned = 0;
    // SAFETY: aligned fixed storage holds TOKEN_USER plus maximum SID bytes.
    let queried = unsafe {
        GetTokenInformation(
            token,
            TokenUser,
            buffer.as_mut_ptr().cast(),
            u32::try_from(mem::size_of_val(&buffer)).expect("fixed token bound"),
            &raw mut returned,
        )
    } != 0;
    let valid = if queried
        && usize::try_from(returned).is_ok_and(|size| {
            size <= mem::size_of_val(&buffer) && size >= mem::size_of::<TOKEN_USER>()
        }) {
        // SAFETY: successful SDK result is large enough for this aligned structure.
        let user = unsafe { &*buffer.as_ptr().cast::<TOKEN_USER>() };
        let start = buffer.as_ptr() as usize;
        let end = start + returned as usize;
        let address = user.User.Sid as usize;
        address >= start
            && address.checked_add(8).is_some_and(|value| value <= end)
            && address
                .checked_add(8 + 4 * usize::from(unsafe { *user.User.Sid.cast::<u8>().add(1) }))
                .is_some_and(|value| value <= end)
            && unsafe { IsValidSid(user.User.Sid) } != 0
            && address
                .checked_add(unsafe { GetLengthSid(user.User.Sid) } as usize)
                .is_some_and(|value| value <= end)
            && unsafe { IsWellKnownSid(user.User.Sid, WinLocalSystemSid) } != 0
    } else {
        false
    };
    for word in &mut buffer {
        // SAFETY: exclusively owned bounded scalar identity storage.
        unsafe {
            ptr::write_volatile(word, 0);
        }
    }
    // SAFETY: exactly the opened token's ownership is consumed here.
    if unsafe { CloseHandle(token) } == 0 {
        poison_helper_utility();
        return Err(HelperTransportError::UtilityPoisoned);
    }
    if valid {
        Ok(())
    } else {
        Err(HelperTransportError::ExecutableIdentity)
    }
}
