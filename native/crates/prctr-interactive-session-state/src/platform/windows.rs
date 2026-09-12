use std::ffi::c_void;
use std::mem;
use std::ptr;
use std::time::Duration;

use crate::InteractiveSessionWire;
use prctr_native_protocol::{
    InteractiveConsoleOwnership, InteractiveLockState, InteractiveRemoteAttachment,
    InteractiveSessionCertainty, InteractiveSessionCoverage, InteractiveSessionState,
    PermissionState, PlatformFamily, ProtocolValidationError, ProtocolViolation,
};
use prctr_native_source_runtime::{
    InitialFallbackPollingSubscription, OpenedPassiveStateBackend, PassiveStateBackend,
    PassiveStateEmitter, PassiveStateSourceError, PassiveStateWire, PollingPassiveStateBackend,
};
use windows_sys::Win32::System::RemoteDesktop::{
    ProcessIdToSessionId, WTS_CURRENT_SERVER_HANDLE, WTS_SESSION_INFOW, WTS_SESSIONSTATE_LOCK,
    WTS_SESSIONSTATE_UNLOCK, WTSActive, WTSClientProtocolType, WTSEnumerateSessionsW,
    WTSFreeMemory, WTSINFOEXW, WTSQuerySessionInformationW, WTSSessionInfoEx, WTSUserName,
};
use windows_sys::Win32::System::Threading::GetCurrentProcessId;

const MAX_RAW_SESSIONS: u32 = 4_096;
const MAX_HUMAN_SESSIONS: usize = 17;
const MAX_USER_NAME_CODE_UNITS: usize = 257;

pub struct PlatformInteractiveSessionBackend;

impl PassiveStateBackend<InteractiveSessionWire> for PlatformInteractiveSessionBackend {
    type Subscription = InitialFallbackPollingSubscription<InteractiveSessionWire>;

    fn open(
        self,
        emitter: PassiveStateEmitter<InteractiveSessionWire>,
    ) -> Result<
        OpenedPassiveStateBackend<InteractiveSessionWire, Self::Subscription>,
        PassiveStateSourceError,
    > {
        PollingPassiveStateBackend::new(
            PlatformFamily::Windows,
            PermissionState::Granted,
            "windows-wts-session-snapshot-v1",
            Duration::from_millis(500),
            query_state,
        )
        .open_with_initial_backend_fallback(
            emitter,
            "windows-wts-session-unavailable-v1",
            InteractiveSessionWire::unavailable_state(),
        )
    }
}

fn query_state() -> Result<InteractiveSessionState, PassiveStateSourceError> {
    let mut candidate_session = 0_u32;
    // SAFETY: candidate_session is scalar output storage and the current process
    // identifier requires no handle or user identifier.
    if unsafe { ProcessIdToSessionId(GetCurrentProcessId(), &raw mut candidate_session) } == 0 {
        return Err(PassiveStateSourceError::Backend(
            "Windows current interactive session is unavailable".to_owned(),
        ));
    }
    query_state_for(candidate_session)
}

pub(super) fn query_state_for(
    candidate_session: u32,
) -> Result<InteractiveSessionState, PassiveStateSourceError> {
    if candidate_session == 0 || candidate_session == u32::MAX {
        return Err(PassiveStateSourceError::Backend(
            "invalid authenticated interactive session".to_owned(),
        ));
    }
    let inventory = SessionInventory::query()?;
    let mut human_sessions = Vec::new();
    for session in inventory.records() {
        if !is_human_session(session.SessionId)? {
            continue;
        }
        human_sessions.push(SessionFact {
            id: session.SessionId,
            state: session.State,
            remote: is_remote_session(session.SessionId)?,
        });
        if human_sessions.len() > MAX_HUMAN_SESSIONS {
            return Err(PassiveStateSourceError::InventoryOverflow(
                "Windows human-session count exceeds the source bound".to_owned(),
            ));
        }
    }
    let candidate = human_sessions
        .iter()
        .find(|session| session.id == candidate_session);
    let other_count = human_sessions
        .iter()
        .filter(|session| session.id != candidate_session)
        .count();
    if other_count > 16 {
        return Err(PassiveStateSourceError::InventoryOverflow(
            "Windows other-human-session count exceeds the protocol bound".to_owned(),
        ));
    }
    let another_active = human_sessions
        .iter()
        .any(|session| session.id != candidate_session && session_is_active(session.state));
    Ok(InteractiveSessionState {
        coverage: InteractiveSessionCoverage::SnapshotOnly,
        certainty: InteractiveSessionCertainty::Partial,
        console_ownership: match candidate {
            Some(session) if session_is_active(session.state) => {
                InteractiveConsoleOwnership::Candidate
            }
            _ if another_active => InteractiveConsoleOwnership::OtherHuman,
            Some(_) => InteractiveConsoleOwnership::Unknown,
            _ => InteractiveConsoleOwnership::None,
        },
        lock_state: query_lock_state(candidate_session)?,
        remote_attachment: if human_sessions.iter().any(|session| session.remote) {
            InteractiveRemoteAttachment::Present
        } else {
            InteractiveRemoteAttachment::Absent
        },
        other_human_session_count: u8::try_from(other_count).unwrap_or(u8::MAX),
    })
}

const fn session_is_active(state: i32) -> bool {
    state == WTSActive
}

fn is_human_session(session_id: u32) -> Result<bool, PassiveStateSourceError> {
    // Session zero is isolated for services on supported Windows releases and
    // must never count as another human session even if a service account has
    // a display name. Other WTS sessions count only when WTS associates a
    // non-empty interactive user name with them.
    if session_id == 0 {
        return Ok(false);
    }
    let buffer = QueryBuffer::query(session_id, WTSUserName)?;
    buffer.has_nonempty_utf16_string("user_name", MAX_USER_NAME_CODE_UNITS)
}

fn is_remote_session(session_id: u32) -> Result<bool, PassiveStateSourceError> {
    let buffer = QueryBuffer::query(session_id, WTSClientProtocolType)?;
    Ok(buffer.utf16_scalar("client_protocol")? != 0)
}

fn interactive_protocol_error(field: &'static str, rule: &'static str) -> PassiveStateSourceError {
    PassiveStateSourceError::Protocol(ProtocolViolation::Schema(ProtocolValidationError {
        type_name: "WindowsInteractiveSessionAdapter",
        field,
        rule,
    }))
}

fn query_lock_state(session_id: u32) -> Result<InteractiveLockState, PassiveStateSourceError> {
    resolve_lock_state_query(QueryBuffer::query(session_id, WTSSessionInfoEx))
}

fn resolve_lock_state_query(
    query: Result<QueryBuffer, PassiveStateSourceError>,
) -> Result<InteractiveLockState, PassiveStateSourceError> {
    let buffer = match query {
        Ok(buffer) => buffer,
        Err(PassiveStateSourceError::Backend(_)) => return Ok(InteractiveLockState::Unknown),
        Err(error) => return Err(error),
    };
    if usize::try_from(buffer.bytes).unwrap_or(0) < mem::size_of::<WTSINFOEXW>() {
        return Err(interactive_protocol_error(
            "lock_state",
            "complete WTSINFOEXW in a successful query result",
        ));
    }
    // SAFETY: WTSInfoEx returned at least one complete WTSINFOEXW record. The
    // Windows binding types this opaque query buffer as UTF-16 storage, so use
    // an unaligned value read instead of manufacturing an aligned reference.
    let info = unsafe { ptr::read_unaligned(buffer.pointer.cast::<WTSINFOEXW>()) };
    if info.Level != 1 {
        return Err(interactive_protocol_error(
            "lock_state_level",
            "supported WTS session-info level 1",
        ));
    }
    // SAFETY: Level 1 makes this the initialized active union member.
    let flags = unsafe { info.Data.WTSInfoExLevel1.SessionFlags };
    match u32::try_from(flags).unwrap_or(u32::MAX) {
        WTS_SESSIONSTATE_LOCK => Ok(InteractiveLockState::Locked),
        WTS_SESSIONSTATE_UNLOCK => Ok(InteractiveLockState::Unlocked),
        _ => Ok(InteractiveLockState::Unknown),
    }
}

struct SessionFact {
    id: u32,
    state: i32,
    remote: bool,
}

struct SessionInventory {
    pointer: *mut WTS_SESSION_INFOW,
    count: u32,
    deallocate: unsafe fn(*mut c_void),
}

impl SessionInventory {
    fn query() -> Result<Self, PassiveStateSourceError> {
        let mut pointer = ptr::null_mut();
        let mut count = 0_u32;
        // SAFETY: pointer and count are valid output storage for the local WTS
        // server's level-zero session inventory.
        let success = unsafe {
            WTSEnumerateSessionsW(
                WTS_CURRENT_SERVER_HANDLE,
                0,
                1,
                &raw mut pointer,
                &raw mut count,
            )
        };
        Self::from_raw(success != 0, pointer, count, free_wts_memory)
    }

    fn from_raw(
        success: bool,
        pointer: *mut WTS_SESSION_INFOW,
        count: u32,
        deallocate: unsafe fn(*mut c_void),
    ) -> Result<Self, PassiveStateSourceError> {
        // Establish ownership before classifying any result so even an
        // allocation returned with a failed or malformed call is released.
        let inventory = Self {
            pointer,
            count,
            deallocate,
        };
        if !success {
            return Err(PassiveStateSourceError::Backend(
                "Windows WTS session inventory is unavailable".to_owned(),
            ));
        }
        if inventory.count > 0 && inventory.pointer.is_null() {
            return Err(interactive_protocol_error(
                "session_inventory",
                "non-null storage for a non-empty successful result",
            ));
        }
        if inventory.count > MAX_RAW_SESSIONS {
            return Err(PassiveStateSourceError::InventoryOverflow(
                "Windows WTS session inventory exceeds the source bound".to_owned(),
            ));
        }
        Ok(inventory)
    }

    fn records(&self) -> &[WTS_SESSION_INFOW] {
        if self.count == 0 {
            return &[];
        }
        // SAFETY: WTSEnumerateSessionsW initialized count records and this
        // inventory retains the allocation for the returned borrow.
        unsafe { std::slice::from_raw_parts(self.pointer, self.count as usize) }
    }
}

impl Drop for SessionInventory {
    fn drop(&mut self) {
        if !self.pointer.is_null() {
            // SAFETY: WTS allocated this inventory and drop runs once.
            unsafe { (self.deallocate)(self.pointer.cast()) };
            self.pointer = ptr::null_mut();
        }
    }
}

struct QueryBuffer {
    pointer: *mut u16,
    bytes: u32,
    deallocate: unsafe fn(*mut c_void),
}

impl QueryBuffer {
    fn query(session_id: u32, information_class: i32) -> Result<Self, PassiveStateSourceError> {
        let mut pointer = ptr::null_mut();
        let mut bytes = 0_u32;
        // SAFETY: output storage is valid and returned WTS memory is immediately
        // wrapped for deterministic release without copying user identifiers.
        let success = unsafe {
            WTSQuerySessionInformationW(
                WTS_CURRENT_SERVER_HANDLE,
                session_id,
                information_class,
                &raw mut pointer,
                &raw mut bytes,
            )
        };
        Self::from_raw(success != 0, pointer, bytes, free_wts_memory)
    }

    fn from_raw(
        success: bool,
        pointer: *mut u16,
        bytes: u32,
        deallocate: unsafe fn(*mut c_void),
    ) -> Result<Self, PassiveStateSourceError> {
        let buffer = Self {
            pointer,
            bytes,
            deallocate,
        };
        if !success {
            return Err(PassiveStateSourceError::Backend(
                "Windows WTS session query failed".to_owned(),
            ));
        }
        if buffer.pointer.is_null() {
            return Err(interactive_protocol_error(
                "session_query",
                "non-null storage for a successful result",
            ));
        }
        Ok(buffer)
    }

    fn utf16_scalar(&self, field: &'static str) -> Result<u16, PassiveStateSourceError> {
        if self.bytes != u32::try_from(mem::size_of::<u16>()).unwrap_or(u32::MAX) {
            return Err(interactive_protocol_error(
                field,
                "exactly one UTF-16 scalar in a successful query result",
            ));
        }
        // SAFETY: construction rejects null and the byte bound proves one
        // complete UTF-16 scalar. Use an unaligned read for opaque WTS storage.
        Ok(unsafe { ptr::read_unaligned(self.pointer) })
    }

    fn has_nonempty_utf16_string(
        &self,
        field: &'static str,
        maximum_code_units: usize,
    ) -> Result<bool, PassiveStateSourceError> {
        let bytes = usize::try_from(self.bytes).map_err(|_error| {
            PassiveStateSourceError::InventoryOverflow(
                "Windows WTS user-name result exceeds the source bound".to_owned(),
            )
        })?;
        if bytes % mem::size_of::<u16>() != 0 {
            return Err(interactive_protocol_error(
                field,
                "even-length UTF-16 string in a successful query result",
            ));
        }
        let code_unit_count = bytes / mem::size_of::<u16>();
        if code_unit_count > maximum_code_units {
            return Err(PassiveStateSourceError::InventoryOverflow(
                "Windows WTS user name exceeds the source bound".to_owned(),
            ));
        }
        if code_unit_count == 0 {
            return Err(interactive_protocol_error(
                field,
                "NUL-terminated UTF-16 string in a successful query result",
            ));
        }
        // SAFETY: construction rejects null; the byte count is even and
        // explicitly bounded before this borrowed view is created.
        let value = unsafe { std::slice::from_raw_parts(self.pointer, code_unit_count) };
        if value.last() != Some(&0) || value[..code_unit_count - 1].contains(&0) {
            return Err(interactive_protocol_error(
                field,
                "exactly NUL-terminated UTF-16 string in a successful query result",
            ));
        }
        if char::decode_utf16(value[..code_unit_count - 1].iter().copied())
            .any(|item| item.is_err())
        {
            return Err(interactive_protocol_error(
                field,
                "valid UTF-16 string in a successful query result",
            ));
        }
        Ok(code_unit_count > 1)
    }
}

impl Drop for QueryBuffer {
    fn drop(&mut self) {
        if !self.pointer.is_null() {
            // SAFETY: WTS allocated this query result and drop runs once.
            unsafe { (self.deallocate)(self.pointer.cast()) };
            self.pointer = ptr::null_mut();
        }
    }
}

unsafe fn free_wts_memory(pointer: *mut c_void) {
    // SAFETY: callers transfer only allocations returned by WTS APIs.
    unsafe { WTSFreeMemory(pointer) };
}

#[cfg(test)]
mod tests {
    use std::sync::atomic::{AtomicUsize, Ordering};

    use super::*;

    static INVENTORY_DEALLOCATIONS: AtomicUsize = AtomicUsize::new(0);
    static QUERY_DEALLOCATIONS: AtomicUsize = AtomicUsize::new(0);

    unsafe fn count_inventory_deallocation(_pointer: *mut c_void) {
        INVENTORY_DEALLOCATIONS.fetch_add(1, Ordering::SeqCst);
    }

    unsafe fn count_query_deallocation(_pointer: *mut c_void) {
        QUERY_DEALLOCATIONS.fetch_add(1, Ordering::SeqCst);
    }

    #[test]
    fn inventory_owns_error_path_allocations_and_classifies_malformed_success() {
        INVENTORY_DEALLOCATIONS.store(0, Ordering::SeqCst);
        let pointer = ptr::dangling_mut::<WTS_SESSION_INFOW>();
        assert!(matches!(
            SessionInventory::from_raw(false, pointer, 1, count_inventory_deallocation),
            Err(PassiveStateSourceError::Backend(_))
        ));
        assert_eq!(INVENTORY_DEALLOCATIONS.load(Ordering::SeqCst), 1);
        assert!(matches!(
            SessionInventory::from_raw(true, ptr::null_mut(), 1, count_inventory_deallocation,),
            Err(PassiveStateSourceError::Protocol(_))
        ));
    }

    #[test]
    fn truncated_successful_query_is_terminal_and_releases_its_allocation() {
        QUERY_DEALLOCATIONS.store(0, Ordering::SeqCst);
        let buffer = QueryBuffer::from_raw(
            true,
            ptr::dangling_mut::<u16>(),
            1,
            count_query_deallocation,
        )
        .expect("owned successful WTS result");
        assert!(matches!(
            buffer.utf16_scalar("client_protocol"),
            Err(PassiveStateSourceError::Protocol(_))
        ));
        drop(buffer);
        assert_eq!(QUERY_DEALLOCATIONS.load(Ordering::SeqCst), 1);
        assert!(matches!(
            QueryBuffer::from_raw(true, ptr::null_mut(), 2, count_query_deallocation),
            Err(PassiveStateSourceError::Protocol(_))
        ));
    }

    #[test]
    fn successful_user_name_query_requires_bounded_even_terminated_utf16() {
        QUERY_DEALLOCATIONS.store(0, Ordering::SeqCst);

        let mut unterminated = [u16::from(b'a')];
        let buffer =
            QueryBuffer::from_raw(true, unterminated.as_mut_ptr(), 2, count_query_deallocation)
                .expect("owned query");
        assert!(matches!(
            buffer.has_nonempty_utf16_string("user_name", MAX_USER_NAME_CODE_UNITS),
            Err(PassiveStateSourceError::Protocol(_))
        ));

        let mut odd = [u16::from(b'a'), 0];
        let buffer = QueryBuffer::from_raw(true, odd.as_mut_ptr(), 3, count_query_deallocation)
            .expect("owned query");
        assert!(matches!(
            buffer.has_nonempty_utf16_string("user_name", MAX_USER_NAME_CODE_UNITS),
            Err(PassiveStateSourceError::Protocol(_))
        ));

        let mut oversized = vec![0_u16; MAX_USER_NAME_CODE_UNITS + 1];
        let oversized_bytes =
            u32::try_from(oversized.len() * mem::size_of::<u16>()).expect("bounded fixture");
        let buffer = QueryBuffer::from_raw(
            true,
            oversized.as_mut_ptr(),
            oversized_bytes,
            count_query_deallocation,
        )
        .expect("owned query");
        assert!(matches!(
            buffer.has_nonempty_utf16_string("user_name", MAX_USER_NAME_CODE_UNITS),
            Err(PassiveStateSourceError::InventoryOverflow(_))
        ));

        let mut valid = [u16::from(b'a'), 0];
        let buffer = QueryBuffer::from_raw(true, valid.as_mut_ptr(), 4, count_query_deallocation)
            .expect("owned query");
        assert!(
            buffer
                .has_nonempty_utf16_string("user_name", MAX_USER_NAME_CODE_UNITS)
                .expect("valid user name")
        );
    }

    #[test]
    fn malformed_successful_lock_queries_remain_terminal() {
        QUERY_DEALLOCATIONS.store(0, Ordering::SeqCst);
        let successful_null = QueryBuffer::from_raw(
            true,
            ptr::null_mut(),
            u32::try_from(mem::size_of::<WTSINFOEXW>()).expect("WTS record size fits u32"),
            count_query_deallocation,
        );
        assert!(matches!(
            resolve_lock_state_query(successful_null),
            Err(PassiveStateSourceError::Protocol(_))
        ));

        let truncated = QueryBuffer::from_raw(
            true,
            ptr::dangling_mut::<u16>(),
            u32::try_from(mem::size_of::<WTSINFOEXW>() - 1).expect("WTS record size fits u32"),
            count_query_deallocation,
        );
        assert!(matches!(
            resolve_lock_state_query(truncated),
            Err(PassiveStateSourceError::Protocol(_))
        ));

        let mut invalid_level = WTSINFOEXW {
            Level: 2,
            ..WTSINFOEXW::default()
        };
        let invalid_level = QueryBuffer::from_raw(
            true,
            (&raw mut invalid_level).cast::<u16>(),
            u32::try_from(mem::size_of::<WTSINFOEXW>()).expect("WTS record size fits u32"),
            count_query_deallocation,
        );
        assert!(matches!(
            resolve_lock_state_query(invalid_level),
            Err(PassiveStateSourceError::Protocol(_))
        ));
        assert_eq!(QUERY_DEALLOCATIONS.load(Ordering::SeqCst), 2);
    }

    #[test]
    fn unavailable_lock_query_is_explicitly_partial() {
        assert!(matches!(
            resolve_lock_state_query(Err(PassiveStateSourceError::Backend(
                "WTS lock query unavailable".to_owned(),
            ))),
            Ok(InteractiveLockState::Unknown)
        ));
    }
}
