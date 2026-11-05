use std::collections::BTreeMap;
use std::ffi::c_void;
use std::mem;
use std::ptr;
use std::slice;
use std::time::Duration;

use crate::PrintSpoolerWire;
use native_protocol::{
    PermissionState, PlatformFamily, PrintSpoolerCertainty, PrintSpoolerCoverage,
    PrintSpoolerState, ProtocolValidationError, ProtocolViolation,
};
use native_source_runtime::{
    InitialFallbackPollingSubscription, OpenedPassiveStateBackend, PassiveStateBackend,
    PassiveStateEmitter, PassiveStateSourceError, PassiveStateWire, PollingPassiveStateBackend,
    SOURCE_CLEANUP_DEADLINE, poison_native_source_process, prefer_boundary_error, run_bounded_task,
};
use windows_sys::Win32::Foundation::{HANDLE, INVALID_HANDLE_VALUE};
use windows_sys::Win32::Globalization::{CSTR_EQUAL, CompareStringOrdinal};
use windows_sys::Win32::Graphics::Printing::{
    ClosePrinter, FindClosePrinterChangeNotification, FindFirstPrinterChangeNotification,
    FindNextPrinterChangeNotification, FreePrinterNotifyInfo, JOB_NOTIFY_FIELD_STATUS,
    JOB_NOTIFY_FIELD_USER_NAME, JOB_NOTIFY_TYPE, JOB_STATUS_COMPLETE, JOB_STATUS_DELETED,
    JOB_STATUS_DELETING, JOB_STATUS_PRINTED, OpenPrinterW, PRINTER_CHANGE_JOB, PRINTER_HANDLE,
    PRINTER_NOTIFY_INFO, PRINTER_NOTIFY_INFO_DATA, PRINTER_NOTIFY_INFO_DISCARDED,
    PRINTER_NOTIFY_OPTIONS, PRINTER_NOTIFY_OPTIONS_REFRESH, PRINTER_NOTIFY_OPTIONS_TYPE,
};
use windows_sys::Win32::System::WindowsProgramming::GetUserNameW;

const MAX_RAW_JOB_FIELDS: u32 = 8_192;
const MAX_REPORTED_JOBS: u8 = 64;
const MAX_ACCOUNT_CODE_UNITS: usize = 256;

pub struct PlatformPrintSpoolerBackend;

impl PassiveStateBackend<PrintSpoolerWire> for PlatformPrintSpoolerBackend {
    type Subscription = InitialFallbackPollingSubscription<PrintSpoolerWire>;

    fn open(
        self,
        emitter: PassiveStateEmitter<PrintSpoolerWire>,
    ) -> Result<
        OpenedPassiveStateBackend<PrintSpoolerWire, Self::Subscription>,
        PassiveStateSourceError,
    > {
        PollingPassiveStateBackend::new(
            PlatformFamily::Windows,
            PermissionState::Granted,
            "windows-spooler-field-selective-v1",
            Duration::from_millis(500),
            query_state,
        )
        .open_with_initial_backend_fallback(
            emitter,
            "windows-spooler-field-selective-unavailable-v1",
            PrintSpoolerWire::unavailable_state(),
        )
    }
}

fn query_state() -> Result<PrintSpoolerState, PassiveStateSourceError> {
    let current_user = CurrentUser::query()?;
    let server = PrinterHandle::open_local_server()?;
    let mut fields = [
        u16::try_from(JOB_NOTIFY_FIELD_USER_NAME).unwrap_or(u16::MAX),
        u16::try_from(JOB_NOTIFY_FIELD_STATUS).unwrap_or(u16::MAX),
    ];
    let mut requested_type = PRINTER_NOTIFY_OPTIONS_TYPE {
        Type: u16::try_from(JOB_NOTIFY_TYPE).unwrap_or(u16::MAX),
        Reserved0: 0,
        Reserved1: 0,
        Reserved2: 0,
        Count: u32::try_from(fields.len()).unwrap_or(u32::MAX),
        pFields: fields.as_mut_ptr(),
    };
    let options = PRINTER_NOTIFY_OPTIONS {
        Version: 2,
        Flags: 0,
        Count: 1,
        pTypes: &raw mut requested_type,
    };
    let notification = match NotificationHandle::open(server.raw(), &options) {
        Ok(notification) => notification,
        Err(primary) => return Err(prefer_boundary_error(primary, server.close())),
    };
    let mut refresh_options = options;
    refresh_options.Flags = PRINTER_NOTIFY_OPTIONS_REFRESH;
    let info = match notification.refresh(&refresh_options) {
        Ok(info) => info,
        Err(primary) => {
            let cleanup = first_cleanup_error([notification.close(), server.close()]);
            return Err(prefer_boundary_error(primary, cleanup));
        }
    };
    let state = summarize_jobs(&info, &current_user);
    let cleanup = first_cleanup_error([info.release(), notification.close(), server.close()]);
    match state {
        Ok(state) => cleanup.map(|()| state),
        Err(primary) => Err(prefer_boundary_error(primary, cleanup)),
    }
}

fn first_cleanup_error<const N: usize>(
    results: [Result<(), PassiveStateSourceError>; N],
) -> Result<(), PassiveStateSourceError> {
    results
        .into_iter()
        .find_map(Result::err)
        .map_or(Ok(()), Err)
}

fn summarize_jobs(
    info: &NotificationInfo,
    current_user: &CurrentUser,
) -> Result<PrintSpoolerState, PassiveStateSourceError> {
    if info.flags() & PRINTER_NOTIFY_INFO_DISCARDED != 0 {
        return Err(PassiveStateSourceError::InventoryOverflow(
            "Windows discarded field-selective print notifications".to_owned(),
        ));
    }
    let mut jobs = BTreeMap::<u32, PartialJob>::new();
    for field in info.fields()? {
        validate_notification_type(field.Type)?;
        if jobs.len() >= MAX_RAW_JOB_FIELDS as usize && !jobs.contains_key(&field.Id) {
            return Err(PassiveStateSourceError::InventoryOverflow(
                "Windows print-job field inventory exceeds the source bound".to_owned(),
            ));
        }
        let job = jobs.entry(field.Id).or_default();
        match u32::from(field.Field) {
            JOB_NOTIFY_FIELD_USER_NAME => {
                // SAFETY: the spooler owns this field buffer for the lifetime
                // of `info`; the bounded view never escapes this call.
                let data = unsafe { field.NotifyData.Data };
                job.owner = Some(current_user.classify(data.pBuf.cast(), data.cbBuf)?);
            }
            JOB_NOTIFY_FIELD_STATUS => {
                // SAFETY: status fields use the documented two-DWORD union arm.
                job.status = Some(unsafe { field.NotifyData.adwData[0] });
            }
            _ => {
                return Err(print_protocol_error(
                    "notification_field",
                    "requested field discriminator",
                ));
            }
        }
    }
    let mut counts = JobCounts::default();
    for job in jobs.values() {
        if job.status.is_some_and(is_terminal_job) {
            continue;
        }
        match job.owner {
            Some(OwnerClass::Candidate) => counts.add_candidate()?,
            Some(OwnerClass::Other) => counts.add_other()?,
            None => counts.add_unknown()?,
        }
    }
    Ok(PrintSpoolerState {
        coverage: PrintSpoolerCoverage::SnapshotOnly,
        certainty: PrintSpoolerCertainty::Partial,
        candidate_job_count: counts.candidate,
        other_job_count: counts.other,
        unknown_job_count: counts.unknown,
    })
}

fn validate_notification_type(notification_type: u16) -> Result<(), PassiveStateSourceError> {
    if u32::from(notification_type) != JOB_NOTIFY_TYPE {
        return Err(print_protocol_error(
            "notification_type",
            "requested job notification discriminator",
        ));
    }
    Ok(())
}

fn print_protocol_error(field: &'static str, rule: &'static str) -> PassiveStateSourceError {
    PassiveStateSourceError::Protocol(ProtocolViolation::Schema(ProtocolValidationError {
        type_name: "WindowsPrintSpoolerAdapter",
        field,
        rule,
    }))
}

const fn is_terminal_job(status: u32) -> bool {
    const TERMINAL: u32 =
        JOB_STATUS_COMPLETE | JOB_STATUS_DELETED | JOB_STATUS_DELETING | JOB_STATUS_PRINTED;
    status & TERMINAL != 0
}

#[derive(Clone, Copy)]
enum OwnerClass {
    Candidate,
    Other,
}

#[derive(Default)]
struct PartialJob {
    owner: Option<OwnerClass>,
    status: Option<u32>,
}

struct CurrentUser {
    code_units: [u16; MAX_ACCOUNT_CODE_UNITS + 1],
    length: usize,
}

impl CurrentUser {
    fn query() -> Result<Self, PassiveStateSourceError> {
        let mut current = Self {
            code_units: [0; MAX_ACCOUNT_CODE_UNITS + 1],
            length: 0,
        };
        let mut length = u32::try_from(current.code_units.len()).unwrap_or(u32::MAX);
        // SAFETY: the fixed buffer and in/out length are valid for GetUserNameW.
        let success = unsafe { GetUserNameW(current.code_units.as_mut_ptr(), &raw mut length) };
        current.length = validate_current_user_query(success != 0, length, &current.code_units)?;
        Ok(current)
    }

    fn classify(
        &self,
        pointer: *const u16,
        byte_length: u32,
    ) -> Result<OwnerClass, PassiveStateSourceError> {
        if pointer.is_null() || byte_length == 0 || byte_length % 2 != 0 {
            return Err(print_protocol_error(
                "owner",
                "non-null non-empty UTF-16 field",
            ));
        }
        if byte_length as usize > (MAX_ACCOUNT_CODE_UNITS + 1) * mem::size_of::<u16>() {
            return Err(PassiveStateSourceError::InventoryOverflow(
                "Windows print-job owner exceeds the source bound".to_owned(),
            ));
        }
        let capacity = byte_length as usize / mem::size_of::<u16>();
        // SAFETY: the validated notification field owns `capacity` UTF-16 code
        // units until the notification info is freed.
        let owner = unsafe { slice::from_raw_parts(pointer, capacity) };
        let length = owner.iter().position(|unit| *unit == 0).ok_or_else(|| {
            if capacity > MAX_ACCOUNT_CODE_UNITS {
                PassiveStateSourceError::InventoryOverflow(
                    "Windows print-job owner exceeds the source bound".to_owned(),
                )
            } else {
                print_protocol_error("owner", "NUL-terminated UTF-16 field")
            }
        })?;
        if length == 0 {
            return Err(print_protocol_error("owner", "non-empty account value"));
        }
        if length > MAX_ACCOUNT_CODE_UNITS {
            return Err(PassiveStateSourceError::InventoryOverflow(
                "Windows print-job owner exceeds the source bound".to_owned(),
            ));
        }
        // SAFETY: both slices are live and their lengths fit the Win32 signed
        // parameter after the explicit protocol bounds above.
        let comparison = unsafe {
            CompareStringOrdinal(
                self.code_units.as_ptr(),
                i32::try_from(self.length).unwrap_or(i32::MAX),
                owner.as_ptr(),
                i32::try_from(length).unwrap_or(i32::MAX),
                1,
            )
        };
        if comparison == 0 {
            return Err(PassiveStateSourceError::Backend(
                "Windows could not classify a print-job owner".to_owned(),
            ));
        }
        Ok(if comparison == CSTR_EQUAL {
            OwnerClass::Candidate
        } else {
            OwnerClass::Other
        })
    }
}

fn validate_current_user_query(
    success: bool,
    reported_length: u32,
    code_units: &[u16],
) -> Result<usize, PassiveStateSourceError> {
    let reported_length = reported_length as usize;
    if reported_length > code_units.len() {
        return Err(PassiveStateSourceError::InventoryOverflow(
            "Windows current interactive account exceeds the source bound".to_owned(),
        ));
    }
    if !success {
        return Err(PassiveStateSourceError::Backend(
            "Windows current interactive account is unavailable".to_owned(),
        ));
    }
    if reported_length <= 1 {
        return Err(print_protocol_error(
            "current_user",
            "non-empty NUL-terminated account value",
        ));
    }
    if code_units[reported_length - 1] != 0 || code_units[..reported_length - 1].contains(&0) {
        return Err(print_protocol_error(
            "current_user",
            "exactly NUL-terminated account value",
        ));
    }
    Ok(reported_length - 1)
}

impl Drop for CurrentUser {
    fn drop(&mut self) {
        self.code_units.fill(0);
        self.length = 0;
    }
}

struct PrinterHandle(Option<PRINTER_HANDLE>);

impl PrinterHandle {
    fn open_local_server() -> Result<Self, PassiveStateSourceError> {
        let mut handle = PRINTER_HANDLE::default();
        // SAFETY: a null name opens the local print server and handle is valid output storage.
        let success = unsafe { OpenPrinterW(ptr::null(), &raw mut handle, ptr::null()) };
        if success == 0 || handle.Value.is_null() {
            return Err(PassiveStateSourceError::Backend(
                "Windows local print server is unavailable".to_owned(),
            ));
        }
        Ok(Self(Some(handle)))
    }

    fn raw(&self) -> PRINTER_HANDLE {
        self.0.unwrap_or_default()
    }

    fn close(mut self) -> Result<(), PassiveStateSourceError> {
        self.close_owned()
    }

    fn close_owned(&mut self) -> Result<(), PassiveStateSourceError> {
        let Some(handle) = self.0.take() else {
            return Ok(());
        };
        // SAFETY: this closes only the handle transferred from this wrapper.
        if unsafe { ClosePrinter(handle) } == 0 {
            return Err(poisoned_cleanup_error(
                "Windows local print-server handle close failed",
            ));
        }
        Ok(())
    }
}

impl Drop for PrinterHandle {
    fn drop(&mut self) {
        let _ = self.close_owned();
    }
}

struct NotificationHandle(Option<HANDLE>);

impl NotificationHandle {
    fn open(
        printer: PRINTER_HANDLE,
        options: &PRINTER_NOTIFY_OPTIONS,
    ) -> Result<Self, PassiveStateSourceError> {
        // SAFETY: the printer handle and options remain live during this synchronous call.
        let handle = unsafe {
            FindFirstPrinterChangeNotification(
                printer,
                PRINTER_CHANGE_JOB,
                0,
                ptr::from_ref(options).cast(),
            )
        };
        if handle.is_null() || handle == INVALID_HANDLE_VALUE {
            return Err(PassiveStateSourceError::Backend(
                "Windows field-selective print notification is unavailable".to_owned(),
            ));
        }
        Ok(Self(Some(handle)))
    }

    fn refresh(
        &self,
        options: &PRINTER_NOTIFY_OPTIONS,
    ) -> Result<NotificationInfo, PassiveStateSourceError> {
        let mut change = 0_u32;
        let mut info: *mut c_void = ptr::null_mut();
        // SAFETY: the notification handle and refresh options are live, and
        // info is valid output storage for a spooler-owned allocation.
        let success = unsafe {
            FindNextPrinterChangeNotification(
                self.0.unwrap_or(ptr::null_mut()),
                &raw mut change,
                ptr::from_ref(options).cast(),
                &raw mut info,
            )
        };
        NotificationInfo::from_raw(success != 0, info, release_notification)
    }

    fn close(mut self) -> Result<(), PassiveStateSourceError> {
        self.close_owned()
    }

    fn close_owned(&mut self) -> Result<(), PassiveStateSourceError> {
        let Some(handle) = self.0.take() else {
            return Ok(());
        };
        // SAFETY: this closes only the notification handle transferred from this wrapper.
        if unsafe { FindClosePrinterChangeNotification(handle) } == 0 {
            return Err(poisoned_cleanup_error(
                "Windows print notification handle close failed",
            ));
        }
        Ok(())
    }
}

impl Drop for NotificationHandle {
    fn drop(&mut self) {
        let _ = self.close_owned();
    }
}

struct NotificationInfo {
    pointer: usize,
    release_allocation: fn(usize) -> Result<(), PassiveStateSourceError>,
}

impl NotificationInfo {
    fn from_raw(
        success: bool,
        pointer: *mut c_void,
        release_allocation: fn(usize) -> Result<(), PassiveStateSourceError>,
    ) -> Result<Self, PassiveStateSourceError> {
        let owned = (!pointer.is_null()).then_some(Self {
            pointer: pointer.cast::<PRINTER_NOTIFY_INFO>() as usize,
            release_allocation,
        });
        if !success {
            let primary = PassiveStateSourceError::Backend(
                "Windows print notification refresh failed".to_owned(),
            );
            return match owned {
                Some(info) => Err(prefer_boundary_error(primary, info.release())),
                None => Err(primary),
            };
        }
        owned.ok_or_else(|| {
            print_protocol_error(
                "notification_info",
                "non-null allocation for a successful refresh",
            )
        })
    }

    fn flags(&self) -> u32 {
        // SAFETY: the constructor rejects a null spooler allocation.
        unsafe { (*self.pointer()).Flags }
    }

    fn fields(&self) -> Result<&[PRINTER_NOTIFY_INFO_DATA], PassiveStateSourceError> {
        // SAFETY: the constructor rejects null and the header is initialized by the spooler.
        let count = unsafe { (*self.pointer()).Count };
        if count > MAX_RAW_JOB_FIELDS {
            return Err(PassiveStateSourceError::InventoryOverflow(
                "Windows print notification field count exceeds the source bound".to_owned(),
            ));
        }
        // SAFETY: PRINTER_NOTIFY_INFO is a flexible-array allocation containing Count records.
        Ok(unsafe { slice::from_raw_parts((*self.pointer()).aData.as_ptr(), count as usize) })
    }

    fn pointer(&self) -> *mut PRINTER_NOTIFY_INFO {
        self.pointer as *mut PRINTER_NOTIFY_INFO
    }

    fn release(mut self) -> Result<(), PassiveStateSourceError> {
        let pointer = std::mem::take(&mut self.pointer);
        (self.release_allocation)(pointer)
    }
}

impl Drop for NotificationInfo {
    fn drop(&mut self) {
        if self.pointer != 0 {
            let pointer = std::mem::take(&mut self.pointer);
            let _ = (self.release_allocation)(pointer);
        }
    }
}

fn release_notification(pointer: usize) -> Result<(), PassiveStateSourceError> {
    if cleanup_is_within_fixed_bound(pointer) {
        return clear_owner_buffers_and_free(pointer);
    }
    match run_bounded_task(
        "print-notification-cleanup",
        SOURCE_CLEANUP_DEADLINE,
        move || clear_owner_buffers_and_free(pointer),
    ) {
        Ok(result) => result,
        Err(error) => Err(poisoned_cleanup_error(&format!(
            "Windows print notification cleanup {error}; native utility restart is required"
        ))),
    }
}

fn poisoned_cleanup_error(reason: &str) -> PassiveStateSourceError {
    poison_native_source_process();
    PassiveStateSourceError::Cleanup(reason.to_owned())
}

fn cleanup_is_within_fixed_bound(pointer: usize) -> bool {
    let info = pointer as *mut PRINTER_NOTIFY_INFO;
    // SAFETY: the pointer is a live spooler allocation until the matching free.
    let count = unsafe { (*info).Count };
    if count > MAX_RAW_JOB_FIELDS {
        return false;
    }
    // SAFETY: the allocation contains exactly Count flexible-array records.
    let fields = unsafe { slice::from_raw_parts((*info).aData.as_ptr(), count as usize) };
    fields.iter().all(|field| {
        if u32::from(field.Type) != JOB_NOTIFY_TYPE
            || u32::from(field.Field) != JOB_NOTIFY_FIELD_USER_NAME
        {
            return true;
        }
        // SAFETY: owner fields use the documented buffer union arm.
        let data = unsafe { field.NotifyData.Data };
        data.pBuf.is_null()
            || data.cbBuf as usize <= (MAX_ACCOUNT_CODE_UNITS + 1) * mem::size_of::<u16>()
    })
}

fn clear_owner_buffers_and_free(pointer: usize) -> Result<(), PassiveStateSourceError> {
    let info = pointer as *mut PRINTER_NOTIFY_INFO;
    // SAFETY: the pointer is a live spooler allocation containing Count records
    // until FreePrinterNotifyInfo. Oversized cleanup executes only behind the
    // hard cleanup deadline and poisons the utility if completion is unproved.
    let count = unsafe { (*info).Count as usize };
    let fields = unsafe { slice::from_raw_parts((*info).aData.as_ptr(), count) };
    for field in fields {
        if u32::from(field.Type) == JOB_NOTIFY_TYPE
            && u32::from(field.Field) == JOB_NOTIFY_FIELD_USER_NAME
        {
            // SAFETY: the spooler owns this live buffer and supplies its exact
            // byte size. No identity bytes are retained after the clear.
            unsafe {
                let data = field.NotifyData.Data;
                if !data.pBuf.is_null() {
                    ptr::write_bytes(data.pBuf, 0, data.cbBuf as usize);
                }
            }
        }
    }
    // SAFETY: this frees only the spooler allocation transferred to this task.
    if unsafe { FreePrinterNotifyInfo(info) } == 0 {
        return Err(poisoned_cleanup_error(
            "Windows print notification allocation release failed",
        ));
    }
    Ok(())
}

#[derive(Default)]
struct JobCounts {
    candidate: u8,
    other: u8,
    unknown: u8,
}

impl JobCounts {
    fn add_candidate(&mut self) -> Result<(), PassiveStateSourceError> {
        increment(&mut self.candidate)
    }

    fn add_other(&mut self) -> Result<(), PassiveStateSourceError> {
        increment(&mut self.other)
    }

    fn add_unknown(&mut self) -> Result<(), PassiveStateSourceError> {
        increment(&mut self.unknown)
    }
}

fn increment(value: &mut u8) -> Result<(), PassiveStateSourceError> {
    if *value >= MAX_REPORTED_JOBS {
        return Err(PassiveStateSourceError::InventoryOverflow(
            "Windows active print-job count exceeds the protocol bound".to_owned(),
        ));
    }
    *value += 1;
    Ok(())
}

#[cfg(test)]
mod tests {
    use std::sync::atomic::{AtomicUsize, Ordering};

    use super::*;

    static NOTIFICATION_RELEASES: AtomicUsize = AtomicUsize::new(0);

    fn count_notification_release(pointer: usize) -> Result<(), PassiveStateSourceError> {
        NOTIFICATION_RELEASES.fetch_add(1, Ordering::SeqCst);
        if pointer == 0 {
            Err(PassiveStateSourceError::Cleanup(
                "injected null notification allocation".to_owned(),
            ))
        } else {
            Ok(())
        }
    }

    fn fail_notification_release(_pointer: usize) -> Result<(), PassiveStateSourceError> {
        NOTIFICATION_RELEASES.fetch_add(1, Ordering::SeqCst);
        Err(PassiveStateSourceError::Cleanup(
            "injected notification release failure".to_owned(),
        ))
    }

    fn current_user() -> CurrentUser {
        let mut user = CurrentUser {
            code_units: [0; MAX_ACCOUNT_CODE_UNITS + 1],
            length: 1,
        };
        user.code_units[0] = u16::from(b'a');
        user
    }

    #[test]
    fn owner_size_and_structure_failures_remain_terminal_categories() {
        let user = current_user();
        let oversized = vec![u16::from(b'a'); MAX_ACCOUNT_CODE_UNITS + 2];
        assert!(matches!(
            user.classify(
                oversized.as_ptr(),
                u32::try_from(oversized.len() * mem::size_of::<u16>()).expect("bounded fixture"),
            ),
            Err(PassiveStateSourceError::InventoryOverflow(_))
        ));

        let unterminated = [u16::from(b'a')];
        assert!(matches!(
            user.classify(
                unterminated.as_ptr(),
                u32::try_from(mem::size_of_val(&unterminated)).expect("bounded fixture"),
            ),
            Err(PassiveStateSourceError::Protocol(_))
        ));
        assert!(matches!(
            print_protocol_error("notification_field", "requested field discriminator"),
            PassiveStateSourceError::Protocol(_)
        ));
    }

    #[test]
    fn current_user_query_distinguishes_unavailability_from_bounded_output_failures() {
        let capacity = MAX_ACCOUNT_CODE_UNITS + 1;
        let mut code_units = vec![0_u16; capacity];
        assert!(matches!(
            validate_current_user_query(false, 0, &code_units),
            Err(PassiveStateSourceError::Backend(_))
        ));
        assert!(matches!(
            validate_current_user_query(
                false,
                u32::try_from(capacity + 1).expect("bounded fixture"),
                &code_units,
            ),
            Err(PassiveStateSourceError::InventoryOverflow(_))
        ));
        assert!(matches!(
            validate_current_user_query(true, 1, &code_units),
            Err(PassiveStateSourceError::Protocol(_))
        ));
        code_units[0] = u16::from(b'a');
        code_units[1] = u16::from(b'b');
        assert!(matches!(
            validate_current_user_query(true, 2, &code_units),
            Err(PassiveStateSourceError::Protocol(_))
        ));
        code_units[1] = 0;
        assert_eq!(
            validate_current_user_query(true, 2, &code_units).expect("terminated user"),
            1
        );
    }

    #[test]
    fn unrequested_notification_type_is_a_terminal_protocol_result() {
        assert!(matches!(
            validate_notification_type(u16::MAX),
            Err(PassiveStateSourceError::Protocol(_))
        ));
    }

    #[test]
    fn refresh_result_owns_failure_allocations_and_rejects_successful_null() {
        NOTIFICATION_RELEASES.store(0, Ordering::SeqCst);
        assert!(matches!(
            NotificationInfo::from_raw(
                false,
                ptr::dangling_mut::<c_void>(),
                count_notification_release,
            ),
            Err(PassiveStateSourceError::Backend(_))
        ));
        assert_eq!(NOTIFICATION_RELEASES.load(Ordering::SeqCst), 1);
        assert!(matches!(
            NotificationInfo::from_raw(
                false,
                ptr::dangling_mut::<c_void>(),
                fail_notification_release,
            ),
            Err(PassiveStateSourceError::Cleanup(_))
        ));
        assert_eq!(NOTIFICATION_RELEASES.load(Ordering::SeqCst), 2);
        assert!(matches!(
            NotificationInfo::from_raw(true, ptr::null_mut(), count_notification_release,),
            Err(PassiveStateSourceError::Protocol(_))
        ));
    }

    #[test]
    fn terminal_job_statuses_are_not_counted_as_active() {
        assert!(is_terminal_job(JOB_STATUS_COMPLETE));
        assert!(is_terminal_job(JOB_STATUS_DELETED));
        assert!(!is_terminal_job(0));
    }

    #[test]
    fn bounded_job_counts_reject_overflow() {
        let mut counts = JobCounts::default();
        for _ in 0..MAX_REPORTED_JOBS {
            counts.add_unknown().expect("bounded job");
        }
        assert!(matches!(
            counts.add_unknown(),
            Err(PassiveStateSourceError::InventoryOverflow(_))
        ));
    }
}
