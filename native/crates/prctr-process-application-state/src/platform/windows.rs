use std::mem;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use prctr_native_protocol::PlatformFamily;
use prctr_native_source_runtime::{poison_native_source_process, prefer_boundary_error};

use super::snapshot::{
    InitialFallbackSnapshotProcessSubscription, ProcessIdentityTracker,
    SnapshotPollingProcessBackend,
};
use crate::{
    OpenedProcessApplicationBackend, ProcessApplicationBackend, ProcessApplicationEmitter,
    ProcessApplicationError,
};
use windows_sys::Win32::Foundation::{
    CloseHandle, ERROR_NO_MORE_FILES, FILETIME, GetLastError, HANDLE, INVALID_HANDLE_VALUE,
};
use windows_sys::Win32::System::Diagnostics::ToolHelp::{
    CreateToolhelp32Snapshot, PROCESSENTRY32W, Process32FirstW, Process32NextW, TH32CS_SNAPPROCESS,
};
use windows_sys::Win32::System::RemoteDesktop::ProcessIdToSessionId;
use windows_sys::Win32::System::Threading::{
    GetCurrentProcessId, GetProcessTimes, OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION,
};

const MAX_RAW_PROCESSES: usize = 65_536;

pub struct WindowsProcessApplicationBackend;

impl ProcessApplicationBackend for WindowsProcessApplicationBackend {
    type Subscription = InitialFallbackSnapshotProcessSubscription;

    fn open(
        self,
        emitter: ProcessApplicationEmitter,
    ) -> Result<OpenedProcessApplicationBackend<Self::Subscription>, ProcessApplicationError> {
        let tracker = Arc::new(Mutex::new(ProcessIdentityTracker::default()));
        let query_tracker = Arc::clone(&tracker);
        SnapshotPollingProcessBackend::new(
            PlatformFamily::Windows,
            "windows-toolhelp-snapshot-v1",
            Duration::from_millis(500),
            move || query_state(&query_tracker),
        )
        .open_with_initial_backend_fallback(emitter, "windows-toolhelp-unavailable-v1")
    }
}

fn query_state(
    tracker: &Mutex<ProcessIdentityTracker>,
) -> Result<prctr_native_protocol::ProcessApplicationState, ProcessApplicationError> {
    let candidate_session = process_session_id(unsafe { GetCurrentProcessId() })?;
    // SAFETY: this requests a read-only kernel-owned process snapshot.
    let handle = unsafe { CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) };
    if handle == INVALID_HANDLE_VALUE {
        return Err(ProcessApplicationError::Backend(
            "Windows process snapshot is unavailable".to_owned(),
        ));
    }
    let snapshot = OwnedHandle::new(
        handle,
        close_kernel_handle,
        "Windows process snapshot handle close failed",
    );
    let result = query_snapshot(&snapshot, candidate_session, tracker);
    let cleanup = snapshot.close();
    match result {
        Ok(state) => cleanup.map(|()| state),
        Err(primary) => Err(prefer_boundary_error(primary, cleanup)),
    }
}

fn query_snapshot(
    snapshot: &OwnedHandle,
    candidate_session: u32,
    tracker: &Mutex<ProcessIdentityTracker>,
) -> Result<prctr_native_protocol::ProcessApplicationState, ProcessApplicationError> {
    let mut entry = PROCESSENTRY32W {
        dwSize: u32::try_from(mem::size_of::<PROCESSENTRY32W>()).unwrap_or(u32::MAX),
        ..PROCESSENTRY32W::default()
    };
    // SAFETY: entry has the required dwSize and snapshot is live.
    if unsafe { Process32FirstW(snapshot.raw(), &raw mut entry) } == 0 {
        return Err(ProcessApplicationError::Backend(
            "Windows process snapshot has no readable first entry".to_owned(),
        ));
    }
    let mut raw_keys = Vec::new();
    let mut scanned = 0_usize;
    loop {
        scanned += 1;
        if scanned > MAX_RAW_PROCESSES {
            return Err(ProcessApplicationError::InventoryOverflow(
                "Windows process snapshot exceeds the source bound".to_owned(),
            ));
        }
        let process_id = entry.th32ProcessID;
        if process_id != 0
            && process_belongs_to_candidate_session(
                process_id,
                candidate_session,
                process_session_id,
            )?
            && let Some(key) = process_key(process_id)?
        {
            raw_keys.push(key);
        }
        // SAFETY: entry remains initialized with the required dwSize and the
        // snapshot handle is live for the complete enumeration.
        if unsafe { Process32NextW(snapshot.raw(), &raw mut entry) } == 0 {
            // SAFETY: this immediately follows the failed enumeration call.
            let error = unsafe { GetLastError() };
            if error != ERROR_NO_MORE_FILES {
                return Err(ProcessApplicationError::Backend(
                    "Windows process snapshot enumeration failed".to_owned(),
                ));
            }
            break;
        }
    }
    tracker
        .lock()
        .map_err(|_poisoned| {
            ProcessApplicationError::Backend(
                "Windows process identity tracker lock was poisoned".to_owned(),
            )
        })?
        .snapshot(raw_keys)
}

fn process_session_id(process_id: u32) -> Result<u32, ProcessApplicationError> {
    let mut session_id = 0_u32;
    // SAFETY: session_id is valid output storage for this scalar query.
    if unsafe { ProcessIdToSessionId(process_id, &raw mut session_id) } == 0 {
        return Err(ProcessApplicationError::Backend(
            "Windows process session classification is unavailable".to_owned(),
        ));
    }
    Ok(session_id)
}

fn process_belongs_to_candidate_session(
    process_id: u32,
    candidate_session: u32,
    query: impl FnOnce(u32) -> Result<u32, ProcessApplicationError>,
) -> Result<bool, ProcessApplicationError> {
    Ok(query(process_id)? == candidate_session)
}

fn process_key(process_id: u32) -> Result<Option<String>, ProcessApplicationError> {
    // SAFETY: this requests query-only access to derive a transient creation
    // timestamp; the returned handle is closed before the function returns.
    let handle = unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, process_id) };
    if handle.is_null() {
        return Ok(None);
    }
    let process = OwnedHandle::new(
        handle,
        close_kernel_handle,
        "Windows queried-process handle close failed",
    );
    let mut creation = FILETIME::default();
    let mut exit = FILETIME::default();
    let mut kernel = FILETIME::default();
    let mut user = FILETIME::default();
    // SAFETY: all scalar output records are valid and the query-only process
    // handle remains live for this call.
    let result = if unsafe {
        GetProcessTimes(
            process.raw(),
            &raw mut creation,
            &raw mut exit,
            &raw mut kernel,
            &raw mut user,
        )
    } == 0
    {
        Ok(None)
    } else {
        let created =
            (u64::from(creation.dwHighDateTime) << 32) | u64::from(creation.dwLowDateTime);
        Ok(Some(format!("{process_id}:{created}")))
    };
    let cleanup = process.close();
    match result {
        Ok(value) => cleanup.map(|()| value),
        Err(primary) => Err(prefer_boundary_error(primary, cleanup)),
    }
}

type HandleCloser = unsafe fn(HANDLE) -> i32;

struct OwnedHandle {
    raw: HANDLE,
    close_handle: HandleCloser,
    cleanup_reason: &'static str,
}

impl OwnedHandle {
    const fn new(raw: HANDLE, close_handle: HandleCloser, cleanup_reason: &'static str) -> Self {
        Self {
            raw,
            close_handle,
            cleanup_reason,
        }
    }

    const fn raw(&self) -> HANDLE {
        self.raw
    }

    fn close(mut self) -> Result<(), ProcessApplicationError> {
        self.close_owned()
    }

    fn close_owned(&mut self) -> Result<(), ProcessApplicationError> {
        if self.raw.is_null() || self.raw == INVALID_HANDLE_VALUE {
            return Ok(());
        }
        let raw = std::mem::replace(&mut self.raw, std::ptr::null_mut());
        // SAFETY: this wrapper owns the live handle and invalidates it before
        // invoking its matching closer exactly once.
        if unsafe { (self.close_handle)(raw) } == 0 {
            poison_native_source_process();
            return Err(ProcessApplicationError::Cleanup(
                self.cleanup_reason.to_owned(),
            ));
        }
        Ok(())
    }
}

impl Drop for OwnedHandle {
    fn drop(&mut self) {
        let _ = self.close_owned();
    }
}

unsafe fn close_kernel_handle(handle: HANDLE) -> i32 {
    // SAFETY: callers transfer one live kernel handle owned by `OwnedHandle`.
    unsafe { CloseHandle(handle) }
}

#[cfg(test)]
mod tests {
    use std::sync::atomic::{AtomicUsize, Ordering};

    use super::*;

    static CLOSE_CALLS: AtomicUsize = AtomicUsize::new(0);

    unsafe fn fail_close(_handle: HANDLE) -> i32 {
        CLOSE_CALLS.fetch_add(1, Ordering::SeqCst);
        0
    }

    fn fail_session_query(_process_id: u32) -> Result<u32, ProcessApplicationError> {
        Err(ProcessApplicationError::Backend(
            "injected session query failure".to_owned(),
        ))
    }

    #[test]
    fn explicit_handle_close_failure_is_cleanup_and_drop_does_not_retry() {
        CLOSE_CALLS.store(0, Ordering::SeqCst);
        let handle = OwnedHandle::new(
            std::ptr::dangling_mut(),
            fail_close,
            "injected handle close failure",
        );
        assert!(matches!(
            handle.close(),
            Err(ProcessApplicationError::Cleanup(_))
        ));
        assert_eq!(CLOSE_CALLS.load(Ordering::SeqCst), 1);
    }

    #[test]
    fn failed_per_process_session_classification_is_not_silently_omitted() {
        assert!(matches!(
            process_belongs_to_candidate_session(42, 1, fail_session_query),
            Err(ProcessApplicationError::Backend(_))
        ));
    }
}
