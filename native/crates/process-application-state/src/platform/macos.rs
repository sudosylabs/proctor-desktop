use std::ffi::c_void;
use std::mem;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use native_protocol::{PlatformFamily, ProcessApplicationState};

use super::snapshot::{
    InitialFallbackSnapshotProcessSubscription, ProcessIdentityTracker,
    SnapshotPollingProcessBackend,
};
use crate::{
    OpenedProcessApplicationBackend, ProcessApplicationBackend, ProcessApplicationEmitter,
    ProcessApplicationError,
};

const NS_WORKSPACE_CLASS: &[u8] = b"NSWorkspace\0";
const NS_AUTORELEASE_POOL_CLASS: &[u8] = b"NSAutoreleasePool\0";
const ALLOC_SELECTOR: &[u8] = b"alloc\0";
const INIT_SELECTOR: &[u8] = b"init\0";
const DRAIN_SELECTOR: &[u8] = b"drain\0";
const SHARED_WORKSPACE_SELECTOR: &[u8] = b"sharedWorkspace\0";
const RUNNING_APPLICATIONS_SELECTOR: &[u8] = b"runningApplications\0";
const COUNT_SELECTOR: &[u8] = b"count\0";
const OBJECT_SELECTOR: &[u8] = b"objectAtIndex:\0";
const PROCESS_IDENTIFIER_SELECTOR: &[u8] = b"processIdentifier\0";
const LAUNCH_DATE_SELECTOR: &[u8] = b"launchDate\0";
const TIME_INTERVAL_SELECTOR: &[u8] = b"timeIntervalSinceReferenceDate\0";
const MAX_RAW_APPLICATIONS: usize = 4_096;

#[link(name = "AppKit", kind = "framework")]
unsafe extern "C" {
    fn NSApplicationLoad() -> bool;
}

#[link(name = "objc")]
unsafe extern "C" {
    fn objc_getClass(name: *const i8) -> *mut c_void;
    fn sel_registerName(name: *const i8) -> *mut c_void;
    fn objc_msgSend();
}

type RawMessageSend = unsafe extern "C" fn();
type MessageSendId = unsafe extern "C" fn(*mut c_void, *mut c_void) -> *mut c_void;
type MessageSendUsize = unsafe extern "C" fn(*mut c_void, *mut c_void) -> usize;
type MessageSendIdWithUsize = unsafe extern "C" fn(*mut c_void, *mut c_void, usize) -> *mut c_void;
type MessageSendPid = unsafe extern "C" fn(*mut c_void, *mut c_void) -> i32;
type MessageSendF64 = unsafe extern "C" fn(*mut c_void, *mut c_void) -> f64;
type MessageSendVoid = unsafe extern "C" fn(*mut c_void, *mut c_void);

pub struct MacOsProcessApplicationBackend;

impl ProcessApplicationBackend for MacOsProcessApplicationBackend {
    type Subscription = InitialFallbackSnapshotProcessSubscription;

    fn open(
        self,
        emitter: ProcessApplicationEmitter,
    ) -> Result<OpenedProcessApplicationBackend<Self::Subscription>, ProcessApplicationError> {
        let tracker = Arc::new(Mutex::new(ProcessIdentityTracker::default()));
        let query_tracker = Arc::clone(&tracker);
        SnapshotPollingProcessBackend::new(
            PlatformFamily::Macos,
            "macos-running-applications-snapshot-v1",
            Duration::from_millis(500),
            move || query_state(&query_tracker),
        )
        .open_with_initial_backend_fallback(emitter, "macos-running-applications-unavailable-v1")
    }
}

fn query_state(
    tracker: &Mutex<ProcessIdentityTracker>,
) -> Result<ProcessApplicationState, ProcessApplicationError> {
    let _pool = AutoreleasePool::new()?;
    // SAFETY: NSApplicationLoad idempotently initializes AppKit before this
    // utility requests the current user's declared application inventory.
    if !unsafe { NSApplicationLoad() } {
        return Err(ProcessApplicationError::Backend(
            "macOS AppKit application inventory is unavailable".to_owned(),
        ));
    }
    // SAFETY: class and selector names are static NUL-terminated strings.
    let class = unsafe { objc_getClass(NS_WORKSPACE_CLASS.as_ptr().cast()) };
    if class.is_null() {
        return Err(ProcessApplicationError::Backend(
            "macOS NSWorkspace class is unavailable".to_owned(),
        ));
    }
    let workspace = unsafe { send_id(class, selector(SHARED_WORKSPACE_SELECTOR)?) };
    if workspace.is_null() {
        return Err(ProcessApplicationError::Backend(
            "macOS shared NSWorkspace is unavailable".to_owned(),
        ));
    }
    let applications = unsafe { send_id(workspace, selector(RUNNING_APPLICATIONS_SELECTOR)?) };
    if applications.is_null() {
        return Err(ProcessApplicationError::Backend(
            "macOS running-application inventory is unavailable".to_owned(),
        ));
    }
    let count = unsafe { send_usize(applications, selector(COUNT_SELECTOR)?) };
    if count > MAX_RAW_APPLICATIONS {
        return Err(ProcessApplicationError::InventoryOverflow(
            "macOS running-application inventory exceeds the source bound".to_owned(),
        ));
    }
    let object_selector = selector(OBJECT_SELECTOR)?;
    let pid_selector = selector(PROCESS_IDENTIFIER_SELECTOR)?;
    let launch_date_selector = selector(LAUNCH_DATE_SELECTOR)?;
    let time_interval_selector = selector(TIME_INTERVAL_SELECTOR)?;
    let mut raw_keys = Vec::with_capacity(count);
    for index in 0..count {
        let application = unsafe { send_id_with_usize(applications, object_selector, index) };
        if application.is_null() {
            continue;
        }
        let pid = unsafe { send_pid(application, pid_selector) };
        let launch_date = unsafe { send_id(application, launch_date_selector) };
        if pid > 0 && !launch_date.is_null() {
            let launch_time = unsafe { send_f64(launch_date, time_interval_selector) };
            if let Some(key) = stable_process_key(pid, launch_time) {
                raw_keys.push(key);
            }
        }
    }
    tracker
        .lock()
        .map_err(|_poisoned| {
            ProcessApplicationError::Backend(
                "macOS process identity tracker lock was poisoned".to_owned(),
            )
        })?
        .snapshot(raw_keys)
}

fn selector(name: &[u8]) -> Result<*mut c_void, ProcessApplicationError> {
    // SAFETY: callers pass static NUL-terminated selector names.
    let selector = unsafe { sel_registerName(name.as_ptr().cast()) };
    if selector.is_null() {
        Err(ProcessApplicationError::Backend(
            "macOS NSWorkspace selector is unavailable".to_owned(),
        ))
    } else {
        Ok(selector)
    }
}

unsafe fn send_id(receiver: *mut c_void, selector: *mut c_void) -> *mut c_void {
    let raw: RawMessageSend = objc_msgSend;
    // SAFETY: the selected AppKit method takes no explicit argument and returns
    // an Objective-C object.
    let send = unsafe { mem::transmute::<RawMessageSend, MessageSendId>(raw) };
    unsafe { send(receiver, selector) }
}

unsafe fn send_usize(receiver: *mut c_void, selector: *mut c_void) -> usize {
    let raw: RawMessageSend = objc_msgSend;
    // SAFETY: NSArray -count returns NSUInteger.
    let send = unsafe { mem::transmute::<RawMessageSend, MessageSendUsize>(raw) };
    unsafe { send(receiver, selector) }
}

unsafe fn send_id_with_usize(
    receiver: *mut c_void,
    selector: *mut c_void,
    argument: usize,
) -> *mut c_void {
    let raw: RawMessageSend = objc_msgSend;
    // SAFETY: NSArray -objectAtIndex: accepts NSUInteger and returns an object.
    let send = unsafe { mem::transmute::<RawMessageSend, MessageSendIdWithUsize>(raw) };
    unsafe { send(receiver, selector, argument) }
}

unsafe fn send_pid(receiver: *mut c_void, selector: *mut c_void) -> i32 {
    let raw: RawMessageSend = objc_msgSend;
    // SAFETY: NSRunningApplication -processIdentifier returns pid_t.
    let send = unsafe { mem::transmute::<RawMessageSend, MessageSendPid>(raw) };
    unsafe { send(receiver, selector) }
}

unsafe fn send_f64(receiver: *mut c_void, selector: *mut c_void) -> f64 {
    let raw: RawMessageSend = objc_msgSend;
    // SAFETY: NSDate -timeIntervalSinceReferenceDate returns NSTimeInterval,
    // which is a double on every supported macOS ABI.
    let send = unsafe { mem::transmute::<RawMessageSend, MessageSendF64>(raw) };
    unsafe { send(receiver, selector) }
}

fn stable_process_key(pid: i32, launch_time: f64) -> Option<String> {
    (pid > 0 && launch_time.is_finite() && launch_time > 0.0)
        .then(|| format!("{pid}:{:016x}", launch_time.to_bits()))
}

unsafe fn send_void(receiver: *mut c_void, selector: *mut c_void) {
    let raw: RawMessageSend = objc_msgSend;
    // SAFETY: NSAutoreleasePool -drain returns void and has no explicit
    // arguments on supported macOS ABIs.
    let send = unsafe { mem::transmute::<RawMessageSend, MessageSendVoid>(raw) };
    unsafe { send(receiver, selector) };
}

struct AutoreleasePool(*mut c_void);

impl AutoreleasePool {
    fn new() -> Result<Self, ProcessApplicationError> {
        // SAFETY: this is a static NUL-terminated Objective-C class name.
        let class = unsafe { objc_getClass(NS_AUTORELEASE_POOL_CLASS.as_ptr().cast()) };
        if class.is_null() {
            return Err(ProcessApplicationError::Backend(
                "macOS autorelease pool class is unavailable".to_owned(),
            ));
        }
        // SAFETY: NSAutoreleasePool has the standard +alloc/-init lifecycle.
        let allocated = unsafe { send_id(class, selector(ALLOC_SELECTOR)?) };
        if allocated.is_null() {
            return Err(ProcessApplicationError::Backend(
                "macOS autorelease pool allocation failed".to_owned(),
            ));
        }
        let pool = unsafe { send_id(allocated, selector(INIT_SELECTOR)?) };
        if pool.is_null() {
            return Err(ProcessApplicationError::Backend(
                "macOS autorelease pool initialization failed".to_owned(),
            ));
        }
        Ok(Self(pool))
    }
}

impl Drop for AutoreleasePool {
    fn drop(&mut self) {
        if !self.0.is_null() {
            if let Ok(selector) = selector(DRAIN_SELECTOR) {
                // SAFETY: self owns this initialized NSAutoreleasePool.
                unsafe { send_void(self.0, selector) };
            }
            self.0 = std::ptr::null_mut();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::stable_process_key;

    #[test]
    fn stable_key_uses_pid_and_launch_generation_not_object_address() {
        let first = stable_process_key(42, 1234.5).expect("valid launch identity");
        assert_eq!(first, stable_process_key(42, 1234.5).unwrap());
        assert_ne!(first, stable_process_key(42, 1235.0).unwrap());
        assert!(stable_process_key(42, f64::NAN).is_none());
    }
}
