//! Bounded Windows process capture pinned to native process/token handles.
//! A successful capture still needs the lifecycle owner's admitted ETW barrier.
//! Native query stalls require the supervising helper-process deadline; checking
//! the deadline around synchronous SDK calls does not make those calls bounded.
#![allow(unsafe_code)]

use super::windows_etw_core::{WindowsEtwProcessEvent, WindowsProcessLifetime};
use super::windows_lifecycle::{
    WINDOWS_MAX_INVENTORY, WindowsCandidateSession, WindowsInventoryCapture, WindowsInventoryFact,
    WindowsLifecycleFailure, WindowsProcessAccount, WindowsProcessScopeBackend,
};
use prctr_native_source_runtime::{
    BoundedTaskError, ensure_native_source_process_usable, poison_native_source_process,
    run_bounded_task,
};
use std::mem::size_of;
use std::time::Instant;
use windows_sys::Win32::Foundation::{
    CloseHandle, ERROR_ACCESS_DENIED, FILETIME, GetLastError, HANDLE, INVALID_HANDLE_VALUE,
    WAIT_TIMEOUT,
};
use windows_sys::Win32::Security::{
    EqualSid, GetLengthSid, GetTokenInformation, IsValidSid, IsWellKnownSid, PSID, TOKEN_QUERY,
    TOKEN_STATISTICS, TOKEN_USER, TokenPrimary, TokenSessionId, TokenStatistics, TokenUser,
    WinLocalServiceSid, WinLocalSystemSid, WinNetworkServiceSid,
};
use windows_sys::Win32::System::Performance::QueryPerformanceCounter;
use windows_sys::Win32::System::RemoteDesktop::{
    WTS_CURRENT_SERVER_HANDLE, WTS_PROCESS_INFOW, WTSEnumerateProcessesExW, WTSFreeMemoryExW,
    WTSQueryUserToken, WTSTypeProcessInfoLevel0,
};
use windows_sys::Win32::System::Threading::{
    GetProcessId, GetProcessTimes, OpenProcess, OpenProcessToken,
    PROCESS_QUERY_LIMITED_INFORMATION, PROCESS_SYNCHRONIZE, WaitForSingleObject,
};

pub struct WindowsPinnedProcessInventory;
impl WindowsPinnedProcessInventory {
    /// Captures the verified candidate's session. WTS reports primary-token SIDs
    /// before protected system processes would require impossible `OpenProcess`
    /// access. Only proven System/service accounts are excluded; unknown or
    /// unreadable candidate processes fail rather than silently disappearing.
    /// # Errors
    /// Permissions, churn, clock/deadline, inventory bounds or unproved cleanup
    /// prevent a successful capture. The caller must keep the verified session
    /// binding live throughout this generation (numeric session IDs can be reused).
    pub fn snapshot(
        candidate: WindowsCandidateSession,
        deadline: Instant,
    ) -> Result<WindowsInventoryCapture, WindowsLifecycleFailure> {
        verify_candidate_logon(candidate, deadline)?;
        let capture_start = clock()?;
        let mut level = 0_u32;
        let mut pointer = std::ptr::null_mut();
        let mut count = 0_u32;
        // Level 0 requests only PID/session/name-pointer/SID, not extended process
        // accounting. The executable-name pointer is never dereferenced.
        // https://learn.microsoft.com/windows/win32/api/wtsapi32/nf-wtsapi32-wtsenumerateprocessesexw
        // SAFETY: trusted local WTS service writes its owned array and count.
        let success = unsafe {
            WTSEnumerateProcessesExW(
                WTS_CURRENT_SERVER_HANDLE,
                &raw mut level,
                candidate.session_id(),
                &raw mut pointer,
                &raw mut count,
            )
        };
        if success == 0 {
            return Err(last_error());
        }
        let records = OwnedProcessRecords {
            pointer: pointer.cast(),
            count,
        };
        let result = if level == 0 {
            enumerate(&records, candidate, capture_start, deadline)
        } else {
            Err(WindowsLifecycleFailure::Backend)
        };
        let capture = records.finish(result)?;
        let capture_end = clock()?;
        verify_candidate_logon(candidate, deadline)?;
        capture.finish(capture_end)
    }
}

/// Native scope enrichment for a verified service caller. This owns no renderer
/// or policy data and never adjusts privileges. The service must supervise SDK
/// calls with its request deadline; a stalled Windows call is not cancellable here.
pub struct WindowsPinnedProcessScope {
    candidate: WindowsCandidateSession,
}
impl WindowsPinnedProcessScope {
    #[must_use]
    pub const fn new(candidate: WindowsCandidateSession) -> Self {
        Self { candidate }
    }
}
impl WindowsProcessScopeBackend for WindowsPinnedProcessScope {
    fn check_logon(&mut self, deadline: Instant) -> Result<(), WindowsLifecycleFailure> {
        let candidate = self.candidate;
        bounded_query(deadline, move || {
            verify_candidate_logon(candidate, deadline)
        })
    }
    fn prove_start(
        &mut self,
        event: &WindowsEtwProcessEvent,
        deadline: Instant,
    ) -> Result<WindowsInventoryFact, WindowsLifecycleFailure> {
        if !event.started {
            return Err(WindowsLifecycleFailure::Protocol);
        }
        let session = event.session_id.ok_or(WindowsLifecycleFailure::Protocol)?;
        let lifetime = event.lifetime;
        bounded_query(deadline, move || {
            read_pinned_process(
                lifetime.process_id,
                session,
                None,
                Some(lifetime.creation_file_time),
                deadline,
            )
        })
    }
}

fn bounded_query<T: Send + 'static>(
    deadline: Instant,
    query: impl FnOnce() -> Result<T, WindowsLifecycleFailure> + Send + 'static,
) -> Result<T, WindowsLifecycleFailure> {
    check_boundary(deadline)?;
    let remaining = deadline
        .checked_duration_since(Instant::now())
        .ok_or(WindowsLifecycleFailure::Deadline)?;
    let result = match run_bounded_task("windows-process-scope", remaining, query) {
        Ok(result) => result,
        Err(BoundedTaskError::CannotStart) => Err(WindowsLifecycleFailure::Backend),
        Err(_) => {
            // A timed-out SDK task can still own a token/handle. Never acknowledge
            // cleanup or open another source in this process after that boundary.
            poison_native_source_process();
            Err(WindowsLifecycleFailure::Cleanup)
        }
    };
    check_boundary(deadline)?;
    result
}

fn verify_candidate_logon(
    candidate: WindowsCandidateSession,
    deadline: Instant,
) -> Result<(), WindowsLifecycleFailure> {
    check_boundary(deadline)?;
    let mut raw = std::ptr::null_mut();
    // LocalSystem + SeTcbPrivilege is required by the public WTS contract.
    // https://learn.microsoft.com/windows/win32/api/wtsapi32/nf-wtsapi32-wtsqueryusertoken
    // SAFETY: trusted native session from authenticated peer; owned token output.
    if unsafe { WTSQueryUserToken(candidate.session_id(), &raw mut raw) } == 0 {
        return Err(last_error());
    }
    let token = OwnedHandle::new(raw)?;
    let result = (|| {
        let fingerprint = token_fingerprint(token.raw)?;
        if fingerprint.logon != candidate.authentication_id()
            || read_session(token.raw)? != candidate.session_id()
        {
            return Err(WindowsLifecycleFailure::Backend);
        }
        with_token_user(token.raw, |sid| {
            if excluded_system_account(sid)? {
                Err(WindowsLifecycleFailure::Backend)
            } else {
                Ok(())
            }
        })
    })();
    token.finish(result)?;
    check_boundary(deadline)
}

#[derive(Eq, PartialEq)]
struct TokenFingerprint {
    token: u64,
    logon: u64,
    revision: u64,
}
impl Drop for TokenFingerprint {
    fn drop(&mut self) {
        for field in [&mut self.token, &mut self.logon, &mut self.revision] {
            // SAFETY: initialized exclusively owned raw identity scalars.
            unsafe {
                std::ptr::write_volatile(field, 0);
            }
        }
    }
}
fn token_fingerprint(token: HANDLE) -> Result<TokenFingerprint, WindowsLifecycleFailure> {
    let mut statistics = TOKEN_STATISTICS::default();
    let mut returned = 0;
    // SAFETY: fixed aligned native output, primary token handle remains owned.
    let success = unsafe {
        GetTokenInformation(
            token,
            TokenStatistics,
            (&raw mut statistics).cast(),
            u32::try_from(size_of::<TOKEN_STATISTICS>()).expect("fixed token statistics"),
            &raw mut returned,
        )
    };
    let fingerprint = TokenFingerprint {
        token: (u64::from(statistics.TokenId.HighPart.cast_unsigned()) << 32)
            | u64::from(statistics.TokenId.LowPart),
        logon: (u64::from(statistics.AuthenticationId.HighPart.cast_unsigned()) << 32)
            | u64::from(statistics.AuthenticationId.LowPart),
        revision: (u64::from(statistics.ModifiedId.HighPart.cast_unsigned()) << 32)
            | u64::from(statistics.ModifiedId.LowPart),
    };
    let valid = success != 0
        && returned as usize == size_of::<TOKEN_STATISTICS>()
        && statistics.TokenType == TokenPrimary
        && fingerprint.logon != 0;
    for offset in 0..size_of::<TOKEN_STATISTICS>() {
        // SAFETY: erase bounded native token metadata including unused fields.
        unsafe {
            std::ptr::write_volatile((&raw mut statistics).cast::<u8>().add(offset), 0);
        }
    }
    if valid {
        Ok(fingerprint)
    } else {
        Err(WindowsLifecycleFailure::Backend)
    }
}

fn enumerate(
    records: &OwnedProcessRecords,
    candidate: WindowsCandidateSession,
    start: i64,
    deadline: Instant,
) -> Result<WindowsInventoryCapture, WindowsLifecycleFailure> {
    let mut capture = WindowsInventoryCapture::begin(start)?;
    if records.count as usize > WINDOWS_MAX_INVENTORY {
        return Err(WindowsLifecycleFailure::InventoryOverflow);
    }
    if records.count != 0 && records.pointer.is_null() {
        return Err(WindowsLifecycleFailure::Backend);
    }
    for index in 0..records.count as usize {
        check_boundary(deadline)?;
        // SAFETY: successful level-0 WTS array remains owned; count was bounded.
        let record = unsafe { &*records.pointer.add(index) };
        if record.SessionId != candidate.session_id() || record.ProcessId == 0 {
            return Err(WindowsLifecycleFailure::Backend);
        }
        // WTS SID belongs to the enumerated primary token, not a name/PID guess.
        if excluded_system_account(record.pUserSid)? {
            continue;
        }
        capture.push(read_pinned_process(
            record.ProcessId,
            record.SessionId,
            Some(record.pUserSid),
            None,
            deadline,
        )?)?;
    }
    Ok(capture)
}

fn excluded_system_account(sid: PSID) -> Result<bool, WindowsLifecycleFailure> {
    // SAFETY: non-null SID is owned by the live trusted WTS result allocation.
    if sid.is_null() || unsafe { IsValidSid(sid) } == 0 {
        return Err(WindowsLifecycleFailure::Backend);
    }
    for known in [WinLocalSystemSid, WinLocalServiceSid, WinNetworkServiceSid] {
        // SAFETY: SID validated above and remains inside WTS lifetime.
        if unsafe { IsWellKnownSid(sid, known) } != 0 {
            return Ok(true);
        }
    }
    Ok(false)
}

struct OwnedProcessRecords {
    pointer: *mut WTS_PROCESS_INFOW,
    count: u32,
}
impl OwnedProcessRecords {
    fn finish<T>(
        mut self,
        result: Result<T, WindowsLifecycleFailure>,
    ) -> Result<T, WindowsLifecycleFailure> {
        self.close()?;
        result
    }
    fn close(&mut self) -> Result<(), WindowsLifecycleFailure> {
        if self.pointer.is_null() {
            return Ok(());
        }
        let pointer = std::mem::replace(&mut self.pointer, std::ptr::null_mut());
        // WTS owns record/name/SID allocation topology: release via its exact API,
        // never scan names or overwrite pointers needed by its allocator.
        // SAFETY: sole owner releases the original level-0 buffer exactly once.
        if unsafe { WTSFreeMemoryExW(WTSTypeProcessInfoLevel0, pointer.cast(), self.count) } == 0 {
            poison_native_source_process();
            return Err(WindowsLifecycleFailure::Cleanup);
        }
        Ok(())
    }
}
impl Drop for OwnedProcessRecords {
    fn drop(&mut self) {
        let _closed = self.close();
    }
}

fn read_pinned_process(
    process_id: u32,
    expected_session: u32,
    expected_sid: Option<PSID>,
    expected_creation: Option<u64>,
    deadline: Instant,
) -> Result<WindowsInventoryFact, WindowsLifecycleFailure> {
    // SAFETY: least-privilege query handle; no inheritance, mutation or content read.
    let raw = unsafe {
        OpenProcess(
            PROCESS_QUERY_LIMITED_INFORMATION | PROCESS_SYNCHRONIZE,
            0,
            process_id,
        )
    };
    if raw.is_null() {
        return Err(last_error());
    }
    let process = OwnedHandle::new(raw)?;
    let result = (|| {
        check_boundary(deadline)?;
        // SAFETY: identity is queried from the pinned handle, not a new PID lookup.
        if unsafe { GetProcessId(process.raw) } != process_id {
            return Err(WindowsLifecycleFailure::Backend);
        }
        let creation_file_time = live_creation_time(process.raw)?;
        if expected_creation.is_some_and(|expected| expected != creation_file_time) {
            return Err(WindowsLifecycleFailure::Backend);
        }
        let mut token_raw = std::ptr::null_mut();
        // SAFETY: token belongs to that exact process handle and access is read-only.
        if unsafe { OpenProcessToken(process.raw, TOKEN_QUERY, &raw mut token_raw) } == 0 {
            return Err(last_error());
        }
        let token = OwnedHandle::new(token_raw)?;
        let queried = (|| {
            let session = read_session(token.raw)?;
            let fingerprint = token_fingerprint(token.raw)?;
            if session != expected_session {
                return Err(WindowsLifecycleFailure::Backend);
            }
            let account = with_token_user(token.raw, |sid| {
                if let Some(expected) = expected_sid {
                    // SAFETY: both validated SIDs are owned through this call.
                    if unsafe { EqualSid(sid, expected) } == 0 {
                        return Err(WindowsLifecycleFailure::Backend);
                    }
                }
                Ok(if excluded_system_account(sid)? {
                    WindowsProcessAccount::SystemService
                } else {
                    WindowsProcessAccount::UserSpace
                })
            })?;
            // Reopen from the retained process, not PID: primary-token replacement
            // or mutation while querying cannot silently keep an earlier scope.
            let mut current_raw = std::ptr::null_mut();
            // SAFETY: same owned process, read-only primary token query.
            if unsafe { OpenProcessToken(process.raw, TOKEN_QUERY, &raw mut current_raw) } == 0 {
                return Err(last_error());
            }
            let current = OwnedHandle::new(current_raw)?;
            let current_result = (|| {
                if token_fingerprint(current.raw)? != fingerprint
                    || read_session(current.raw)? != session
                {
                    return Err(WindowsLifecycleFailure::Backend);
                }
                Ok(())
            })();
            current.finish(current_result)?;
            Ok((session, account))
        })();
        let (session_id, account) = token.finish(queried)?;
        check_boundary(deadline)?;
        if live_creation_time(process.raw)? != creation_file_time {
            return Err(WindowsLifecycleFailure::Backend);
        }
        Ok(WindowsInventoryFact {
            lifetime: WindowsProcessLifetime {
                process_id,
                creation_file_time,
            },
            session_id,
            account,
        })
    })();
    process.finish(result)
}

// Maximum SID is 68 bytes. The aligned fixed buffer holds TOKEN_USER and its
// embedded SID; no user names, memberships, privileges or arbitrary token data.
#[repr(C)]
struct TokenUserBuffer {
    user: TOKEN_USER,
    sid: [u8; 68],
}
impl Drop for TokenUserBuffer {
    fn drop(&mut self) {
        let pointer = std::ptr::from_mut(self).cast::<u8>();
        for offset in 0..size_of::<Self>() {
            // SAFETY: exclusive fixed storage, including pointer/padding fields.
            unsafe {
                std::ptr::write_volatile(pointer.add(offset), 0);
            }
        }
    }
}
fn with_token_user<T>(
    token: HANDLE,
    inspect: impl FnOnce(PSID) -> Result<T, WindowsLifecycleFailure>,
) -> Result<T, WindowsLifecycleFailure> {
    let mut storage = TokenUserBuffer {
        user: TOKEN_USER::default(),
        sid: [0; 68],
    };
    let mut returned = 0_u32;
    let capacity =
        u32::try_from(size_of::<TokenUserBuffer>()).expect("fixed token buffer fits DWORD");
    // SAFETY: fixed aligned output owns TOKEN_USER and maximum embedded SID.
    if unsafe {
        GetTokenInformation(
            token,
            TokenUser,
            (&raw mut storage).cast(),
            capacity,
            &raw mut returned,
        )
    } == 0
    {
        return Err(last_error());
    }
    if returned < u32::try_from(size_of::<TOKEN_USER>()).unwrap() || returned > capacity {
        return Err(WindowsLifecycleFailure::Backend);
    }
    let base = (&raw const storage) as usize;
    let sid = storage.user.User.Sid;
    let offset = (sid as usize)
        .checked_sub(base)
        .ok_or(WindowsLifecycleFailure::Backend)?;
    if offset < size_of::<TOKEN_USER>()
        || offset
            .checked_add(8)
            .is_none_or(|end| end > returned as usize)
    {
        return Err(WindowsLifecycleFailure::Backend);
    }
    // SAFETY: SID header is inside returned storage; OS-provided SID must be valid.
    if unsafe { IsValidSid(sid) } == 0 {
        return Err(WindowsLifecycleFailure::Backend);
    }
    // SAFETY: validated SID header defines bounded required length.
    let length = unsafe { GetLengthSid(sid) } as usize;
    if length > 68
        || offset
            .checked_add(length)
            .is_none_or(|end| end > returned as usize)
    {
        return Err(WindowsLifecycleFailure::Backend);
    }
    inspect(sid)
}

fn read_session(token: HANDLE) -> Result<u32, WindowsLifecycleFailure> {
    let mut session = 0_u32;
    let mut returned = 0_u32;
    // SAFETY: TokenSessionId is exactly one DWORD. No account name/SID is requested.
    let result = unsafe {
        GetTokenInformation(
            token,
            TokenSessionId,
            (&raw mut session).cast(),
            4,
            &raw mut returned,
        )
    };
    if result == 0 {
        return Err(last_error());
    }
    if returned != 4 || session == u32::MAX {
        return Err(WindowsLifecycleFailure::Backend);
    }
    Ok(session)
}

fn live_creation_time(process: HANDLE) -> Result<u64, WindowsLifecycleFailure> {
    require_alive(process)?;
    let mut creation = FILETIME::default();
    let mut exit = FILETIME::default();
    let mut kernel = FILETIME::default();
    let mut user = FILETIME::default();
    // SAFETY: initialized fixed scalar outputs and the same still-pinned process.
    let queried = unsafe {
        GetProcessTimes(
            process,
            &raw mut creation,
            &raw mut exit,
            &raw mut kernel,
            &raw mut user,
        )
    };
    let identity = (u64::from(creation.dwHighDateTime) << 32) | u64::from(creation.dwLowDateTime);
    // Fixed transient native records are cleared regardless of query outcome.
    for value in [&mut creation, &mut exit, &mut kernel, &mut user] {
        // SAFETY: initialized exclusive FILETIME fields.
        unsafe {
            std::ptr::write_volatile(&raw mut value.dwHighDateTime, 0);
            std::ptr::write_volatile(&raw mut value.dwLowDateTime, 0);
        }
    }
    if queried == 0 || identity == 0 {
        return Err(WindowsLifecycleFailure::Backend);
    }
    require_alive(process)?;
    Ok(identity)
}

fn require_alive(process: HANDLE) -> Result<(), WindowsLifecycleFailure> {
    // GetProcessTimes exit time is undefined for a live process. Instead observe
    // the pinned process object's signaled state without blocking or effects:
    // https://learn.microsoft.com/windows/win32/api/synchapi/nf-synchapi-waitforsingleobject
    // SAFETY: this owned process handle has SYNCHRONIZE access and remains live.
    if unsafe { WaitForSingleObject(process, 0) } != WAIT_TIMEOUT {
        return Err(WindowsLifecycleFailure::Backend);
    }
    Ok(())
}

fn clock() -> Result<i64, WindowsLifecycleFailure> {
    let mut counter = 0_i64;
    // SAFETY: fixed scalar output; this is the same QPC domain used by ETW.
    if unsafe { QueryPerformanceCounter(&raw mut counter) } == 0 || counter < 0 {
        return Err(WindowsLifecycleFailure::Backend);
    }
    Ok(counter)
}
fn check_boundary(deadline: Instant) -> Result<(), WindowsLifecycleFailure> {
    ensure_native_source_process_usable().map_err(|_| WindowsLifecycleFailure::Cleanup)?;
    if Instant::now() >= deadline {
        return Err(WindowsLifecycleFailure::Deadline);
    }
    Ok(())
}
fn last_error() -> WindowsLifecycleFailure {
    // SAFETY: caller invokes immediately after its failed Windows query.
    if unsafe { GetLastError() } == ERROR_ACCESS_DENIED {
        WindowsLifecycleFailure::Permission
    } else {
        WindowsLifecycleFailure::Backend
    }
}

struct OwnedHandle {
    raw: HANDLE,
}
impl OwnedHandle {
    fn new(raw: HANDLE) -> Result<Self, WindowsLifecycleFailure> {
        if raw.is_null() || raw == INVALID_HANDLE_VALUE {
            return Err(WindowsLifecycleFailure::Backend);
        }
        Ok(Self { raw })
    }
    fn finish<T>(
        mut self,
        result: Result<T, WindowsLifecycleFailure>,
    ) -> Result<T, WindowsLifecycleFailure> {
        self.close()?;
        result
    }
    fn close(&mut self) -> Result<(), WindowsLifecycleFailure> {
        if self.raw.is_null() {
            return Ok(());
        }
        let raw = std::mem::replace(&mut self.raw, std::ptr::null_mut());
        // SAFETY: sole owner relinquishes the handle exactly once.
        if unsafe { CloseHandle(raw) } == 0 {
            poison_native_source_process();
            return Err(WindowsLifecycleFailure::Cleanup);
        }
        Ok(())
    }
}
impl Drop for OwnedHandle {
    fn drop(&mut self) {
        let _closed = self.close();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use windows_sys::Win32::Security::{CreateWellKnownSid, WinBuiltinAdministratorsSid};

    #[test]
    fn native_sid_classification_excludes_only_proven_system_service_accounts() {
        for kind in [
            WinLocalSystemSid,
            WinLocalServiceSid,
            WinNetworkServiceSid,
            WinBuiltinAdministratorsSid,
        ] {
            let mut buffer = [0_u32; 17];
            let mut size = 68_u32;
            // SAFETY: aligned maximum SID buffer is owned throughout both calls.
            assert_ne!(
                unsafe {
                    CreateWellKnownSid(
                        kind,
                        std::ptr::null_mut(),
                        buffer.as_mut_ptr().cast(),
                        &raw mut size,
                    )
                },
                0
            );
            assert_eq!(
                excluded_system_account(buffer.as_mut_ptr().cast()).unwrap(),
                kind != WinBuiltinAdministratorsSid
            );
        }
        assert_eq!(
            excluded_system_account(std::ptr::null_mut()),
            Err(WindowsLifecycleFailure::Backend)
        );
    }

    #[test]
    fn native_start_scope_is_bound_to_process_creation_and_token_session() {
        use std::time::Duration;
        use windows_sys::Win32::System::Threading::{GetCurrentProcess, GetCurrentProcessId};
        // SAFETY: query-only pseudo-handle to this running test process.
        let process = unsafe { GetCurrentProcess() };
        let creation = live_creation_time(process).unwrap();
        // SAFETY: scalar ID of this still-running test process.
        let pid = unsafe { GetCurrentProcessId() };
        let mut raw = std::ptr::null_mut();
        // SAFETY: read-only token output from retained current process.
        assert_ne!(
            unsafe { OpenProcessToken(process, TOKEN_QUERY, &raw mut raw) },
            0
        );
        let token = OwnedHandle::new(raw).unwrap();
        let session = read_session(token.raw).unwrap();
        token.finish(Ok(())).unwrap();
        let deadline = Instant::now() + Duration::from_secs(3);
        let proved = read_pinned_process(pid, session, None, Some(creation), deadline).unwrap();
        assert!(
            proved.lifetime
                == WindowsProcessLifetime {
                    process_id: pid,
                    creation_file_time: creation
                }
        );
        assert!(matches!(
            read_pinned_process(pid, session, None, Some(creation + 1), deadline),
            Err(WindowsLifecycleFailure::Backend)
        ));
        assert!(matches!(
            read_pinned_process(pid, session.wrapping_add(1), None, Some(creation), deadline),
            Err(WindowsLifecycleFailure::Backend)
        ));
    }

    #[test]
    fn own_process_matches_primary_token_sid_but_not_another_account() {
        use windows_sys::Win32::System::Threading::GetCurrentProcess;
        let mut raw = std::ptr::null_mut();
        // SAFETY: current-process pseudo-handle only supplies a query token.
        assert_ne!(
            unsafe { OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &raw mut raw) },
            0
        );
        let token = OwnedHandle::new(raw).unwrap();
        let mut user = TokenUserBuffer {
            user: TOKEN_USER::default(),
            sid: [0; 68],
        };
        let mut length = 0_u32;
        // SAFETY: initialized fixed aligned token output.
        assert_ne!(
            unsafe {
                GetTokenInformation(
                    token.raw,
                    TokenUser,
                    (&raw mut user).cast(),
                    u32::try_from(size_of::<TokenUserBuffer>()).unwrap(),
                    &raw mut length,
                )
            },
            0
        );
        assert!(
            with_token_user(token.raw, |sid| {
                // SAFETY: both SIDs remain owned within this test query.
                Ok(unsafe { EqualSid(sid, user.user.User.Sid) } != 0)
            })
            .unwrap()
        );
        let mut group = [0_u32; 17];
        let mut size = 68_u32;
        // SAFETY: maximum SID storage; Administrators is a group, never a primary user SID.
        assert_ne!(
            unsafe {
                CreateWellKnownSid(
                    WinBuiltinAdministratorsSid,
                    std::ptr::null_mut(),
                    group.as_mut_ptr().cast(),
                    &raw mut size,
                )
            },
            0
        );
        assert!(
            !with_token_user(token.raw, |sid| {
                // SAFETY: validated primary SID and fixed well-known SID remain owned.
                Ok(unsafe { EqualSid(sid, group.as_mut_ptr().cast()) } != 0)
            })
            .unwrap()
        );
        token.finish(Ok(())).unwrap();
    }
}
