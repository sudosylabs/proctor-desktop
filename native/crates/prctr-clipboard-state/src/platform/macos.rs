use std::ffi::c_void;
use std::mem;
use std::time::Duration;

use crate::ClipboardWire;
use prctr_native_protocol::{
    ClipboardCertainty, ClipboardCoverage, ClipboardState, PermissionState, PlatformFamily,
    ProtocolValidationError, ProtocolViolation,
};
use prctr_native_source_runtime::{
    InitialFallbackPollingSubscription, OpenedPassiveStateBackend, PassiveStateBackend,
    PassiveStateEmitter, PassiveStateSourceError, PassiveStateWire, PollingPassiveStateBackend,
};

const NS_PASTEBOARD_CLASS: &[u8] = b"NSPasteboard\0";
const NS_AUTORELEASE_POOL_CLASS: &[u8] = b"NSAutoreleasePool\0";
const ALLOC_SELECTOR: &[u8] = b"alloc\0";
const INIT_SELECTOR: &[u8] = b"init\0";
const DRAIN_SELECTOR: &[u8] = b"drain\0";
const GENERAL_PASTEBOARD_SELECTOR: &[u8] = b"generalPasteboard\0";
const CHANGE_COUNT_SELECTOR: &[u8] = b"changeCount\0";

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
type MessageSendInteger = unsafe extern "C" fn(*mut c_void, *mut c_void) -> isize;
type MessageSendVoid = unsafe extern "C" fn(*mut c_void, *mut c_void);

pub struct PlatformClipboardBackend;

impl PassiveStateBackend<ClipboardWire> for PlatformClipboardBackend {
    type Subscription = InitialFallbackPollingSubscription<ClipboardWire>;

    fn open(
        self,
        emitter: PassiveStateEmitter<ClipboardWire>,
    ) -> Result<OpenedPassiveStateBackend<ClipboardWire, Self::Subscription>, PassiveStateSourceError>
    {
        PollingPassiveStateBackend::new(
            PlatformFamily::Macos,
            PermissionState::Granted,
            "macos-pasteboard-generation-v1",
            Duration::from_millis(250),
            query_state,
        )
        .open_with_initial_backend_fallback(
            emitter,
            "macos-pasteboard-service-unavailable-v1",
            ClipboardWire::unavailable_state(),
        )
    }
}

fn query_state() -> Result<ClipboardState, PassiveStateSourceError> {
    let _pool = AutoreleasePool::new()?;
    // SAFETY: NSApplicationLoad idempotently initializes AppKit for a
    // command-line/utility process before requesting the shared pasteboard.
    if !unsafe { NSApplicationLoad() } {
        return Err(PassiveStateSourceError::Backend(
            "macOS AppKit could not initialize the pasteboard service".to_owned(),
        ));
    }
    // SAFETY: each name is a static NUL-terminated Objective-C runtime name.
    let class = unsafe { objc_getClass(NS_PASTEBOARD_CLASS.as_ptr().cast()) };
    let general_selector = unsafe { sel_registerName(GENERAL_PASTEBOARD_SELECTOR.as_ptr().cast()) };
    let change_selector = unsafe { sel_registerName(CHANGE_COUNT_SELECTOR.as_ptr().cast()) };
    if class.is_null() || general_selector.is_null() || change_selector.is_null() {
        return Err(PassiveStateSourceError::Backend(
            "macOS NSPasteboard runtime entrypoints are unavailable".to_owned(),
        ));
    }
    // SAFETY: +generalPasteboard is a no-argument AppKit class method returning
    // an NSPasteboard singleton. No clipboard content is requested.
    let pasteboard = unsafe { send_id(class, general_selector) };
    if pasteboard.is_null() {
        return Err(PassiveStateSourceError::Backend(
            "macOS general NSPasteboard is unavailable".to_owned(),
        ));
    }
    // SAFETY: -changeCount is a no-argument NSPasteboard method returning an
    // NSInteger in the pointer-sized return register on supported macOS ABIs.
    let generation = unsafe { send_integer(pasteboard, change_selector) };
    let change_generation = change_generation(generation)?;
    Ok(ClipboardState {
        coverage: ClipboardCoverage::SnapshotCounter,
        certainty: ClipboardCertainty::Partial,
        change_generation,
    })
}

fn change_generation(generation: isize) -> Result<u64, PassiveStateSourceError> {
    u64::try_from(generation).map_err(|_| {
        PassiveStateSourceError::Protocol(ProtocolViolation::Schema(ProtocolValidationError {
            type_name: "MacosClipboardAdapter",
            field: "change_generation",
            rule: "non-negative NSPasteboard change count",
        }))
    })
}

fn selector(name: &[u8]) -> Result<*mut c_void, PassiveStateSourceError> {
    // SAFETY: callers provide static NUL-terminated selector names.
    let selector = unsafe { sel_registerName(name.as_ptr().cast()) };
    if selector.is_null() {
        Err(PassiveStateSourceError::Backend(
            "macOS NSPasteboard selector is unavailable".to_owned(),
        ))
    } else {
        Ok(selector)
    }
}

unsafe fn send_id(receiver: *mut c_void, selector: *mut c_void) -> *mut c_void {
    let raw: RawMessageSend = objc_msgSend;
    // SAFETY: the selected Objective-C method has an object return and no
    // explicit arguments on supported macOS ABIs.
    let send = unsafe { mem::transmute::<RawMessageSend, MessageSendId>(raw) };
    unsafe { send(receiver, selector) }
}

unsafe fn send_integer(receiver: *mut c_void, selector: *mut c_void) -> isize {
    let raw: RawMessageSend = objc_msgSend;
    // SAFETY: NSPasteboard -changeCount returns NSInteger and has no explicit
    // arguments on supported macOS ABIs.
    let send = unsafe { mem::transmute::<RawMessageSend, MessageSendInteger>(raw) };
    unsafe { send(receiver, selector) }
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
    fn new() -> Result<Self, PassiveStateSourceError> {
        // SAFETY: this is a static NUL-terminated Objective-C class name.
        let class = unsafe { objc_getClass(NS_AUTORELEASE_POOL_CLASS.as_ptr().cast()) };
        if class.is_null() {
            return Err(PassiveStateSourceError::Backend(
                "macOS autorelease pool class is unavailable".to_owned(),
            ));
        }
        // SAFETY: NSAutoreleasePool has the standard +alloc/-init lifecycle.
        let allocated = unsafe { send_id(class, selector(ALLOC_SELECTOR)?) };
        if allocated.is_null() {
            return Err(PassiveStateSourceError::Backend(
                "macOS autorelease pool allocation failed".to_owned(),
            ));
        }
        let pool = unsafe { send_id(allocated, selector(INIT_SELECTOR)?) };
        if pool.is_null() {
            return Err(PassiveStateSourceError::Backend(
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
    use super::*;

    #[test]
    fn negative_change_generation_is_a_terminal_protocol_result() {
        assert!(matches!(
            change_generation(-1),
            Err(PassiveStateSourceError::Protocol(_))
        ));
    }
}
