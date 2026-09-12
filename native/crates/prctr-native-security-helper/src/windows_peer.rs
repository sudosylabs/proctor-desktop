//! Kernel session binding for an already code-authenticated, retained peer.
use std::mem;
use std::os::windows::io::{AsRawHandle, BorrowedHandle};
use std::ptr;
use std::time::Instant;

use prctr_interactive_session_state::WindowsCandidateSession;
use windows_sys::Win32::Foundation::{
    CloseHandle, ERROR_NO_TOKEN, GetLastError, HANDLE, WAIT_TIMEOUT,
};
use windows_sys::Win32::Security::{
    GetTokenInformation, RevertToSelf, TOKEN_QUERY, TOKEN_STATISTICS, TokenSessionId,
    TokenStatistics,
};
use windows_sys::Win32::System::Pipes::{GetNamedPipeClientProcessId, ImpersonateNamedPipeClient};
use windows_sys::Win32::System::Threading::{
    GetCurrentThread, GetProcessId, OpenProcessToken, OpenThreadToken, WaitForSingleObject,
};

use crate::HelperTransportError;

/// Bind a candidate session to a connected local pipe and retained live process.
///
/// The privileged service bootstrap must authenticate the executable against
/// its packaged manifest using this exact retained process handle **before**
/// calling this function. This function proves kernel pipe/token/session binding,
/// not executable identity. A second PID/path lookup is not that prior proof.
/// The retained process handle requires query and SYNCHRONIZE access.
/// The pipe must be exclusively owned for this operation, reject remote clients,
/// and have received the bounded handshake message before impersonation. The
/// caller enforces the same absolute launch deadline in a killable verifier.
/// Neither handle nor candidate identity may come from a renderer request.
///
/// # Errors
/// Rejects expired deadlines, nested impersonation, exited or mismatched peers,
/// missing tokens, service sessions, and different process/message logons.
/// If Windows cannot revert impersonation, the helper aborts rather than
/// continuing to execute under an unproved security context.
pub fn candidate_session_for_verified_pipe_peer(
    pipe: BorrowedHandle<'_>,
    verified_process: BorrowedHandle<'_>,
    deadline: Instant,
) -> Result<WindowsCandidateSession, HelperTransportError> {
    ensure_peer_usable()?;
    check_deadline(deadline)?;
    let result = bind_pipe_peer(
        pipe.as_raw_handle().cast(),
        verified_process.as_raw_handle().cast(),
        deadline,
    );
    // All temporary token guards have dropped before this final fence, on both
    // successful and failed authentication paths. Cleanup failure takes priority.
    ensure_peer_usable()?;
    check_deadline(deadline)?;
    result
}

fn ensure_peer_usable() -> Result<(), HelperTransportError> {
    crate::ensure_helper_utility_usable()?;
    if prctr_native_source_runtime::ensure_native_source_process_usable().is_err() {
        crate::poison_helper_utility();
        return Err(HelperTransportError::UtilityPoisoned);
    }
    Ok(())
}

fn bind_pipe_peer(
    pipe: HANDLE,
    process: HANDLE,
    deadline: Instant,
) -> Result<WindowsCandidateSession, HelperTransportError> {
    ensure_unimpersonated()?;
    verify_pipe_process(pipe, process)?;
    let process_token = process_token(process)?;
    let original = token_binding(process_token.0)?;

    // Microsoft specifies that this uses the security context of the last
    // message read, which is why the service owns handshake and pipe I/O.
    // https://learn.microsoft.com/en-us/windows/win32/api/namedpipeapi/nf-namedpipeapi-impersonatenamedpipeclient
    // SAFETY: the caller retains the connected server pipe throughout this call.
    if unsafe { ImpersonateNamedPipeClient(pipe) } == 0 {
        return Err(HelperTransportError::ExecutableIdentity);
    }
    let impersonation = ImpersonationGuard(std::marker::PhantomData);
    let message_binding = thread_token().and_then(|token| token_binding(token.0));
    // Revert before any later privileged operation, including error handling.
    drop(impersonation);
    let message_binding = message_binding?;
    if original != message_binding {
        return Err(HelperTransportError::ExecutableIdentity);
    }
    // Recheck the retained process after impersonation and token inspection;
    // an exited process/PID reuse must not authenticate a replacement peer.
    verify_pipe_process(pipe, process)?;
    let current = process_token_for_binding(process)?;
    if original != current {
        return Err(HelperTransportError::ExecutableIdentity);
    }
    check_deadline(deadline)?;
    WindowsCandidateSession::from_verified_peer(original.session_id, original.authentication_id)
        .ok_or(HelperTransportError::ExecutableIdentity)
}

fn check_deadline(deadline: Instant) -> Result<(), HelperTransportError> {
    if Instant::now() >= deadline {
        Err(HelperTransportError::DeadlineExceeded)
    } else {
        Ok(())
    }
}

fn verify_pipe_process(pipe: HANDLE, process: HANDLE) -> Result<(), HelperTransportError> {
    let mut client_id = 0;
    // SAFETY: borrowed live handles and exact scalar output storage.
    let valid = unsafe {
        GetNamedPipeClientProcessId(pipe, &raw mut client_id) != 0
            && client_id != 0
            && GetProcessId(process) == client_id
            && WaitForSingleObject(process, 0) == WAIT_TIMEOUT
    };
    if valid {
        Ok(())
    } else {
        Err(HelperTransportError::ExecutableIdentity)
    }
}

struct CheckedToken(HANDLE);
impl Drop for CheckedToken {
    fn drop(&mut self) {
        // SAFETY: exclusively owned token from OpenThreadToken/OpenProcessToken.
        if unsafe { CloseHandle(self.0) } == 0 {
            crate::poison_helper_utility();
            prctr_native_source_runtime::poison_native_source_process();
        }
        self.0 = ptr::null_mut();
    }
}
fn ensure_unimpersonated() -> Result<(), HelperTransportError> {
    let mut handle = ptr::null_mut();
    // SAFETY: current-thread pseudo-handle and exact writable token output.
    let opened =
        unsafe { OpenThreadToken(GetCurrentThread(), TOKEN_QUERY, 1, &raw mut handle) } != 0;
    // SAFETY: capture last error before cleanup can change it.
    let error = unsafe { GetLastError() };
    let token = (!handle.is_null()).then(|| CheckedToken(handle));
    if opened || error != ERROR_NO_TOKEN {
        drop(token);
        return Err(HelperTransportError::ExecutableIdentity);
    }
    drop(token);
    Ok(())
}
fn process_token(process: HANDLE) -> Result<CheckedToken, HelperTransportError> {
    let mut handle = ptr::null_mut();
    // SAFETY: retained process and exact writable token output.
    let opened = unsafe { OpenProcessToken(process, TOKEN_QUERY, &raw mut handle) } != 0;
    take_token(opened, handle)
}
fn thread_token() -> Result<CheckedToken, HelperTransportError> {
    let mut handle = ptr::null_mut();
    // SAFETY: current impersonating thread; OpenAsSelf grants only query access.
    let opened =
        unsafe { OpenThreadToken(GetCurrentThread(), TOKEN_QUERY, 1, &raw mut handle) } != 0;
    take_token(opened, handle)
}
fn take_token(opened: bool, handle: HANDLE) -> Result<CheckedToken, HelperTransportError> {
    let token = (!handle.is_null()).then(|| CheckedToken(handle));
    if !opened {
        return Err(HelperTransportError::ExecutableIdentity);
    }
    token.ok_or(HelperTransportError::ExecutableIdentity)
}

#[derive(PartialEq, Eq)]
struct TokenBinding {
    session_id: u32,
    authentication_id: u64,
}
impl Drop for TokenBinding {
    fn drop(&mut self) {
        // SAFETY: exclusively owned fixed scalar storage, with no destructor.
        unsafe {
            ptr::write_volatile(&raw mut self.session_id, 0);
            ptr::write_volatile(&raw mut self.authentication_id, 0);
        }
    }
}
struct TokenStatisticsBuffer(TOKEN_STATISTICS);
impl Drop for TokenStatisticsBuffer {
    fn drop(&mut self) {
        // SAFETY: exclusively owned fixed Windows scalar structure. Clear
        // padding as well as fields rather than relying on aggregate copying.
        for offset in 0..mem::size_of::<TOKEN_STATISTICS>() {
            unsafe {
                ptr::write_volatile((&raw mut self.0).cast::<u8>().add(offset), 0);
            }
        }
    }
}
fn process_token_for_binding(process: HANDLE) -> Result<TokenBinding, HelperTransportError> {
    let token = process_token(process)?;
    token_binding(token.0)
}
fn token_binding(token: HANDLE) -> Result<TokenBinding, HelperTransportError> {
    let mut binding = TokenBinding {
        session_id: 0,
        authentication_id: 0,
    };
    let mut statistics = TokenStatisticsBuffer(TOKEN_STATISTICS::default());
    let mut length = 0;
    let statistics_size =
        u32::try_from(mem::size_of::<TOKEN_STATISTICS>()).expect("fixed token structure fits u32");
    // SAFETY: token is queryable; each output is exactly sized and checked.
    if unsafe {
        GetTokenInformation(
            token,
            TokenSessionId,
            (&raw mut binding.session_id).cast(),
            4,
            &raw mut length,
        )
    } == 0
        || length != 4
    {
        return Err(HelperTransportError::ExecutableIdentity);
    }
    // SAFETY: fixed writable TOKEN_STATISTICS buffer with exact capacity.
    if unsafe {
        GetTokenInformation(
            token,
            TokenStatistics,
            (&raw mut statistics.0).cast(),
            statistics_size,
            &raw mut length,
        )
    } == 0
        || length != statistics_size
    {
        return Err(HelperTransportError::ExecutableIdentity);
    }
    binding.authentication_id = (u64::from(statistics.0.AuthenticationId.HighPart.cast_unsigned())
        << 32)
        | u64::from(statistics.0.AuthenticationId.LowPart);
    Ok(binding)
}

struct ImpersonationGuard(std::marker::PhantomData<std::rc::Rc<()>>);
impl Drop for ImpersonationGuard {
    fn drop(&mut self) {
        // SAFETY: this guard exists only after successful impersonation on this
        // thread and never moves to another thread or escapes the call.
        if unsafe { RevertToSelf() } == 0 {
            // Windows requires process shutdown when reversion fails:
            // https://learn.microsoft.com/en-us/windows/win32/api/securitybaseapi/nf-securitybaseapi-reverttoself
            std::process::abort();
        }
    }
}

/// Kernel-proven user token for a closed launch request. This intentionally
/// grants no code identity or observation capability to the requesting process.
pub struct WindowsLaunchUser {
    token: CheckedToken,
    candidate: WindowsCandidateSession,
}
// SAFETY: this owns a primary-token kernel handle, not a thread impersonation.
// Ownership transfers once to the launch worker; no shared mutation is exposed.
unsafe impl Send for WindowsLaunchUser {}

impl WindowsLaunchUser {
    pub(super) fn token(&self) -> BorrowedHandle<'_> {
        // SAFETY: the token guard outlives this borrow.
        unsafe { BorrowedHandle::borrow_raw(self.token.0) }
    }
    pub(super) fn candidate(&self) -> WindowsCandidateSession {
        self.candidate
    }
}

/// Resolve only the interactive logon that sent the fixed launch-request frame.
/// The service reads that complete bounded frame before calling this function.
/// An untrusted launcher cannot choose an executable or another user's session.
/// # Errors
/// Rejects impersonation, missing/stale logon identity, noninteractive sessions,
/// WTS token mismatch, cleanup failure or an expired launch deadline.
pub fn user_for_windows_launch_request(
    pipe: BorrowedHandle<'_>,
    deadline: Instant,
) -> Result<WindowsLaunchUser, HelperTransportError> {
    ensure_peer_usable()?;
    check_deadline(deadline)?;
    ensure_unimpersonated()?;
    // SAFETY: the exclusive server pipe has consumed the fixed request frame.
    if unsafe { ImpersonateNamedPipeClient(pipe.as_raw_handle().cast()) } == 0 {
        return Err(HelperTransportError::ExecutableIdentity);
    }
    let impersonation = ImpersonationGuard(std::marker::PhantomData);
    let requested = thread_token().and_then(|token| token_binding(token.0));
    drop(impersonation);
    let requested = requested?;
    let candidate = WindowsCandidateSession::from_verified_peer(
        requested.session_id,
        requested.authentication_id,
    )
    .ok_or(HelperTransportError::ExecutableIdentity)?;
    let mut token = ptr::null_mut();
    // SAFETY: SYSTEM service obtains the primary token for this kernel-proven
    // logon session. Compare authentication ID again to reject session-ID reuse.
    let opened = unsafe {
        windows_sys::Win32::System::RemoteDesktop::WTSQueryUserToken(
            requested.session_id,
            &raw mut token,
        )
    } != 0;
    let token = take_token(opened, token)?;
    if token_binding(token.0)? != requested {
        return Err(HelperTransportError::ExecutableIdentity);
    }
    ensure_peer_usable()?;
    check_deadline(deadline)?;
    Ok(WindowsLaunchUser { token, candidate })
}

#[cfg(test)]
mod tests {
    use super::*;
    use windows_sys::Win32::Security::{ImpersonateSelf, SecurityIdentification};
    use windows_sys::Win32::System::Threading::GetCurrentProcess;

    #[test]
    fn retained_process_token_binding_is_stable() {
        // SAFETY: pseudo-handle stays valid for the running test process.
        let process = unsafe { GetCurrentProcess() };
        let first = process_token_for_binding(process).expect("current process token");
        let second = process_token_for_binding(process).expect("same process token");
        assert!(first == second);
        assert_ne!(first.authentication_id, 0);
    }

    #[test]
    fn existing_impersonation_is_rejected_without_reverting_the_caller() {
        ensure_unimpersonated().expect("test thread starts without impersonation");
        // SAFETY: impersonates only this test process at identification level.
        assert_ne!(unsafe { ImpersonateSelf(SecurityIdentification) }, 0);
        let guard = ImpersonationGuard(std::marker::PhantomData);
        assert!(ensure_unimpersonated().is_err());
        assert!(
            thread_token().is_ok(),
            "nested check must preserve caller context"
        );
        drop(guard);
        ensure_unimpersonated().expect("guard restored test thread");
    }
}
