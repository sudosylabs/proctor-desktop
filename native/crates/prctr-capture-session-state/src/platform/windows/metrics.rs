use std::ffi::c_void;
use std::iter;
use std::mem;
use std::ptr;

use windows_sys::Win32::Foundation::ERROR_SUCCESS;
use windows_sys::Win32::System::Registry::{HKEY_LOCAL_MACHINE, RRF_RT_REG_DWORD, RegGetValueW};
use windows_sys::Win32::System::RemoteDesktop::ProcessIdToSessionId;
use windows_sys::Win32::System::Threading::GetCurrentProcessId;
use windows_sys::Win32::UI::WindowsAndMessaging::{
    GetSystemMetrics, SM_REMOTECONTROL, SM_REMOTESESSION,
};

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(super) enum NativeRemoteSessionStatus {
    Known(bool),
    Indeterminate,
}

pub(super) fn native_remote_session_status() -> NativeRemoteSessionStatus {
    // SAFETY: GetSystemMetrics has no pointer arguments and these indexes are
    // documented system metrics.
    let remote_session = unsafe { GetSystemMetrics(SM_REMOTESESSION) != 0 };
    // SAFETY: same contract as the preceding call.
    let remote_control = unsafe { GetSystemMetrics(SM_REMOTECONTROL) != 0 };
    classify_remote_session(remote_session, remote_control, remote_fx_session_active())
}

fn classify_remote_session(
    remote_session: bool,
    remote_control: bool,
    remote_fx_fallback: Option<bool>,
) -> NativeRemoteSessionStatus {
    if remote_session || remote_control {
        return NativeRemoteSessionStatus::Known(true);
    }
    remote_fx_fallback.map_or(
        NativeRemoteSessionStatus::Indeterminate,
        NativeRemoteSessionStatus::Known,
    )
}

/// Applies Microsoft's documented `RemoteFX` fallback: when
/// `SM_REMOTESESSION` is false, compare this process's session with the
/// physical-console `GlassSessionId` rather than claiming a local session.
fn remote_fx_session_active() -> Option<bool> {
    let mut process_session_id = 0_u32;
    // SAFETY: process_session_id is writable and GetCurrentProcessId returns
    // the identifier for the calling process.
    let session_resolved =
        unsafe { ProcessIdToSessionId(GetCurrentProcessId(), &raw mut process_session_id) } != 0;
    if !session_resolved {
        return None;
    }

    let subkey = wide("SYSTEM\\CurrentControlSet\\Control\\Terminal Server");
    let value = wide("GlassSessionId");
    let mut glass_session_id = 0_u32;
    let expected_byte_count = u32::try_from(mem::size_of::<u32>()).ok()?;
    let mut byte_count = expected_byte_count;
    // SAFETY: both strings are nul-terminated; the destination points to one
    // DWORD and byte_count advertises exactly that storage. RegGetValueW does
    // not retain any supplied pointer.
    let result = unsafe {
        RegGetValueW(
            HKEY_LOCAL_MACHINE,
            subkey.as_ptr(),
            value.as_ptr(),
            RRF_RT_REG_DWORD,
            ptr::null_mut(),
            (&raw mut glass_session_id).cast::<c_void>(),
            &raw mut byte_count,
        )
    };
    if result != ERROR_SUCCESS || byte_count != expected_byte_count {
        return None;
    }
    Some(process_session_id != glass_session_id)
}

fn wide(value: &str) -> Vec<u16> {
    value.encode_utf16().chain(iter::once(0)).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn either_positive_metric_is_complete_remote_evidence() {
        assert_eq!(
            classify_remote_session(true, false, None),
            NativeRemoteSessionStatus::Known(true)
        );
        assert_eq!(
            classify_remote_session(false, true, None),
            NativeRemoteSessionStatus::Known(true)
        );
    }

    #[test]
    fn negative_metrics_defer_to_the_remotefx_fallback() {
        assert_eq!(
            classify_remote_session(false, false, Some(true)),
            NativeRemoteSessionStatus::Known(true)
        );
        assert_eq!(
            classify_remote_session(false, false, Some(false)),
            NativeRemoteSessionStatus::Known(false)
        );
    }

    #[test]
    fn unavailable_fallback_never_claims_a_local_session() {
        assert_eq!(
            classify_remote_session(false, false, None),
            NativeRemoteSessionStatus::Indeterminate
        );
    }
}
