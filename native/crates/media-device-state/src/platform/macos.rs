use std::ffi::c_void;
use std::mem;
use std::time::Duration;

use crate::{
    MediaDeviceSelection, MediaDeviceWire, not_collected_endpoint, selected_unavailable_state,
};
use native_protocol::{
    MediaConcurrentUse, MediaDeviceCertainty, MediaDeviceCoverage, MediaDeviceState,
    MediaEndpointReadiness, MediaEndpointState, PermissionState, PlatformFamily,
};
use native_source_runtime::{
    InitialFallbackPollingSubscription, OpenedPassiveStateBackend, PassiveStateBackend,
    PassiveStateEmitter, PassiveStateSourceError, PollingPassiveStateBackend,
};

const AV_CAPTURE_DEVICE_CLASS: &[u8] = b"AVCaptureDevice\0";
const AV_CAPTURE_DEVICE_INPUT_CLASS: &[u8] = b"AVCaptureDeviceInput\0";
const NS_AUTORELEASE_POOL_CLASS: &[u8] = b"NSAutoreleasePool\0";
const ALLOC_SELECTOR: &[u8] = b"alloc\0";
const INIT_SELECTOR: &[u8] = b"init\0";
const DRAIN_SELECTOR: &[u8] = b"drain\0";
const AUTHORIZATION_SELECTOR: &[u8] = b"authorizationStatusForMediaType:\0";
const DEVICES_SELECTOR: &[u8] = b"devicesWithMediaType:\0";
const COUNT_SELECTOR: &[u8] = b"count\0";
const OBJECT_SELECTOR: &[u8] = b"objectAtIndex:\0";
const CONNECTED_SELECTOR: &[u8] = b"isConnected\0";
const SUSPENDED_SELECTOR: &[u8] = b"isSuspended\0";
const IN_USE_SELECTOR: &[u8] = b"isInUseByAnotherApplication\0";
const DEVICE_INPUT_SELECTOR: &[u8] = b"deviceInputWithDevice:error:\0";
const MAX_ENDPOINTS: usize = 16;

#[link(name = "AVFoundation", kind = "framework")]
unsafe extern "C" {
    static AVMediaTypeVideo: *mut c_void;
    static AVMediaTypeAudio: *mut c_void;
}

#[link(name = "objc")]
unsafe extern "C" {
    fn objc_getClass(name: *const i8) -> *mut c_void;
    fn sel_registerName(name: *const i8) -> *mut c_void;
    fn objc_msgSend();
}

type RawMessageSend = unsafe extern "C" fn();
type MessageSendId = unsafe extern "C" fn(*mut c_void, *mut c_void) -> *mut c_void;
type MessageSendIdWithId =
    unsafe extern "C" fn(*mut c_void, *mut c_void, *mut c_void) -> *mut c_void;
type MessageSendIntegerWithId =
    unsafe extern "C" fn(*mut c_void, *mut c_void, *mut c_void) -> isize;
type MessageSendUsize = unsafe extern "C" fn(*mut c_void, *mut c_void) -> usize;
type MessageSendIdWithUsize = unsafe extern "C" fn(*mut c_void, *mut c_void, usize) -> *mut c_void;
type MessageSendBool = unsafe extern "C" fn(*mut c_void, *mut c_void) -> i8;
type MessageSendVoid = unsafe extern "C" fn(*mut c_void, *mut c_void);
type MessageSendIdWithIdAndOutId =
    unsafe extern "C" fn(*mut c_void, *mut c_void, *mut c_void, *mut *mut c_void) -> *mut c_void;

pub struct PlatformMediaDeviceBackend {
    selection: MediaDeviceSelection,
}

impl PlatformMediaDeviceBackend {
    #[must_use]
    pub const fn new(selection: MediaDeviceSelection) -> Self {
        Self { selection }
    }
}

impl PassiveStateBackend<MediaDeviceWire> for PlatformMediaDeviceBackend {
    type Subscription = InitialFallbackPollingSubscription<MediaDeviceWire>;

    fn open(
        self,
        emitter: PassiveStateEmitter<MediaDeviceWire>,
    ) -> Result<
        OpenedPassiveStateBackend<MediaDeviceWire, Self::Subscription>,
        PassiveStateSourceError,
    > {
        let selection = self.selection;
        PollingPassiveStateBackend::new(
            PlatformFamily::Macos,
            PermissionState::Granted,
            "macos-avfoundation-media-state",
            Duration::from_millis(500),
            move || query_state(selection),
        )
        .open_with_initial_backend_fallback(
            emitter,
            "macos-selected-avfoundation-unavailable",
            selected_unavailable_state(selection),
        )
    }
}

fn query_state(
    selection: MediaDeviceSelection,
) -> Result<MediaDeviceState, PassiveStateSourceError> {
    let _pool = AutoreleasePool::new()?;
    Ok(MediaDeviceState {
        camera: if selection.includes_camera() {
            // SAFETY: this is an exported immutable AVFoundation media-type constant.
            let camera_type = unsafe { AVMediaTypeVideo };
            if camera_type.is_null() {
                return Err(PassiveStateSourceError::Backend(
                    "macOS camera media-type constant is unavailable".to_owned(),
                ));
            }
            query_endpoint(camera_type)?
        } else {
            not_collected_endpoint()
        },
        microphone: if selection.includes_microphone() {
            // SAFETY: this is an exported immutable AVFoundation media-type constant.
            let microphone_type = unsafe { AVMediaTypeAudio };
            if microphone_type.is_null() {
                return Err(PassiveStateSourceError::Backend(
                    "macOS microphone media-type constant is unavailable".to_owned(),
                ));
            }
            query_endpoint(microphone_type)?
        } else {
            not_collected_endpoint()
        },
    })
}

fn query_endpoint(media_type: *mut c_void) -> Result<MediaEndpointState, PassiveStateSourceError> {
    // SAFETY: this is a static NUL-terminated Objective-C class name.
    let class = unsafe { objc_getClass(AV_CAPTURE_DEVICE_CLASS.as_ptr().cast()) };
    if class.is_null() {
        return Err(PassiveStateSourceError::Backend(
            "macOS AVCaptureDevice class is unavailable".to_owned(),
        ));
    }
    let authorization = selector(AUTHORIZATION_SELECTOR)?;
    let devices = selector(DEVICES_SELECTOR)?;
    // SAFETY: +authorizationStatusForMediaType: only inspects current TCC state
    // and never requests permission.
    let permission =
        permission_from_status(unsafe { send_integer_with_id(class, authorization, media_type) });
    // SAFETY: +devicesWithMediaType: returns an autoreleased bounded NSArray of
    // endpoint objects and does not open a capture stream.
    let array = unsafe { send_id_with_id(class, devices, media_type) };
    if array.is_null() {
        return Err(PassiveStateSourceError::Backend(
            "macOS media endpoint inventory is unavailable".to_owned(),
        ));
    }
    let count_selector = selector(COUNT_SELECTOR)?;
    // SAFETY: -count is a no-argument NSArray method.
    let count = unsafe { send_usize(array, count_selector) };
    if count > MAX_ENDPOINTS {
        return Err(PassiveStateSourceError::InventoryOverflow(
            "macOS media endpoint inventory exceeds the protocol bound".to_owned(),
        ));
    }
    let object_selector = selector(OBJECT_SELECTOR)?;
    let connected_selector = selector(CONNECTED_SELECTOR)?;
    let suspended_selector = selector(SUSPENDED_SELECTOR)?;
    let in_use_selector = selector(IN_USE_SELECTOR)?;
    let device_input_selector = selector(DEVICE_INPUT_SELECTOR)?;
    // SAFETY: this is a static NUL-terminated Objective-C class name.
    let device_input_class =
        unsafe { objc_getClass(AV_CAPTURE_DEVICE_INPUT_CLASS.as_ptr().cast()) };
    if device_input_class.is_null() {
        return Err(PassiveStateSourceError::Backend(
            "macOS AVCaptureDeviceInput class is unavailable".to_owned(),
        ));
    }
    let authorized = matches!(permission, PermissionState::Granted);
    let mut control_ready = false;
    let mut in_use = false;
    for index in 0..count {
        // SAFETY: index is strictly inside the current NSArray count.
        let device = validate_inventory_object(unsafe {
            send_id_with_usize(array, object_selector, index)
        })?;
        // SAFETY: each selector is a no-argument BOOL property on
        // AVCaptureDevice; no capture stream or media content is accessed.
        let connected = unsafe { send_bool(device, connected_selector) };
        let suspended = unsafe { send_bool(device, suspended_selector) };
        if authorized {
            in_use |= unsafe { send_bool(device, in_use_selector) };
            if connected && !suspended {
                let mut error = std::ptr::null_mut();
                // SAFETY: +deviceInputWithDevice:error: receives this live
                // AVCaptureDevice and a valid NSError output slot. The returned
                // input is only a bounded readiness probe; no session starts.
                let input = unsafe {
                    send_id_with_id_and_out_id(
                        device_input_class,
                        device_input_selector,
                        device,
                        &raw mut error,
                    )
                };
                control_ready |= !input.is_null();
            }
        }
    }
    Ok(MediaEndpointState {
        coverage: MediaDeviceCoverage::ReadinessAndConcurrentUse,
        certainty: if authorized {
            MediaDeviceCertainty::Complete
        } else {
            MediaDeviceCertainty::Partial
        },
        permission,
        readiness: if control_ready {
            MediaEndpointReadiness::Ready
        } else {
            MediaEndpointReadiness::NotReady
        },
        endpoint_count: u8::try_from(count).unwrap_or(u8::MAX),
        other_application_use: if authorized {
            if in_use {
                MediaConcurrentUse::Active
            } else {
                MediaConcurrentUse::Inactive
            }
        } else {
            MediaConcurrentUse::Unknown
        },
    })
}

fn validate_inventory_object(object: *mut c_void) -> Result<*mut c_void, PassiveStateSourceError> {
    if object.is_null() {
        Err(PassiveStateSourceError::Protocol(
            native_protocol::ProtocolViolation::Schema(native_protocol::ProtocolValidationError {
                type_name: "MacOsMediaDeviceAdapter",
                field: "endpoint_inventory",
                rule: "non-null object at every reported array index",
            }),
        ))
    } else {
        Ok(object)
    }
}

fn selector(name: &[u8]) -> Result<*mut c_void, PassiveStateSourceError> {
    // SAFETY: callers provide static NUL-terminated selector names.
    let selector = unsafe { sel_registerName(name.as_ptr().cast()) };
    if selector.is_null() {
        Err(PassiveStateSourceError::Backend(
            "macOS AVFoundation selector is unavailable".to_owned(),
        ))
    } else {
        Ok(selector)
    }
}

unsafe fn send_id(receiver: *mut c_void, selector: *mut c_void) -> *mut c_void {
    let raw: RawMessageSend = objc_msgSend;
    // SAFETY: Objective-C message dispatch requires selecting the ABI signature
    // that exactly matches the invoked method.
    let send = unsafe { mem::transmute::<RawMessageSend, MessageSendId>(raw) };
    // SAFETY: the caller owns validation of receiver and selector types.
    unsafe { send(receiver, selector) }
}

unsafe fn send_id_with_id(
    receiver: *mut c_void,
    selector: *mut c_void,
    argument: *mut c_void,
) -> *mut c_void {
    let raw: RawMessageSend = objc_msgSend;
    // SAFETY: the selected method has one Objective-C object argument and an
    // Objective-C object return on supported macOS ABIs.
    let send = unsafe { mem::transmute::<RawMessageSend, MessageSendIdWithId>(raw) };
    unsafe { send(receiver, selector, argument) }
}

unsafe fn send_integer_with_id(
    receiver: *mut c_void,
    selector: *mut c_void,
    argument: *mut c_void,
) -> isize {
    let raw: RawMessageSend = objc_msgSend;
    // SAFETY: +authorizationStatusForMediaType: returns NSInteger and accepts
    // one Objective-C object argument.
    let send = unsafe { mem::transmute::<RawMessageSend, MessageSendIntegerWithId>(raw) };
    unsafe { send(receiver, selector, argument) }
}

unsafe fn send_usize(receiver: *mut c_void, selector: *mut c_void) -> usize {
    let raw: RawMessageSend = objc_msgSend;
    // SAFETY: NSArray -count returns NSUInteger and takes no explicit argument.
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

unsafe fn send_bool(receiver: *mut c_void, selector: *mut c_void) -> bool {
    let raw: RawMessageSend = objc_msgSend;
    // SAFETY: the selected AVCaptureDevice properties return Objective-C BOOL
    // and take no explicit argument.
    let send = unsafe { mem::transmute::<RawMessageSend, MessageSendBool>(raw) };
    unsafe { send(receiver, selector) != 0 }
}

unsafe fn send_id_with_id_and_out_id(
    receiver: *mut c_void,
    selector: *mut c_void,
    argument: *mut c_void,
    output: *mut *mut c_void,
) -> *mut c_void {
    let raw: RawMessageSend = objc_msgSend;
    // SAFETY: +deviceInputWithDevice:error: returns an Objective-C object and
    // accepts one object plus one NSError double-pointer argument.
    let send = unsafe { mem::transmute::<RawMessageSend, MessageSendIdWithIdAndOutId>(raw) };
    unsafe { send(receiver, selector, argument, output) }
}

unsafe fn send_void(receiver: *mut c_void, selector: *mut c_void) {
    let raw: RawMessageSend = objc_msgSend;
    // SAFETY: NSAutoreleasePool -drain returns void and has no explicit
    // arguments on supported macOS ABIs.
    let send = unsafe { mem::transmute::<RawMessageSend, MessageSendVoid>(raw) };
    unsafe { send(receiver, selector) };
}

const fn permission_from_status(status: isize) -> PermissionState {
    match status {
        0 => PermissionState::NotDetermined,
        1 => PermissionState::Restricted,
        2 => PermissionState::Denied,
        3 => PermissionState::Granted,
        _ => PermissionState::Unavailable,
    }
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
        // SAFETY: allocated is the live NSAutoreleasePool allocation above.
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
                // SAFETY: self owns this initialized NSAutoreleasePool and drop
                // executes exactly once.
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
    fn null_object_inside_successful_endpoint_inventory_is_terminal() {
        assert!(matches!(
            validate_inventory_object(std::ptr::null_mut()),
            Err(PassiveStateSourceError::Protocol(_))
        ));
        assert!(validate_inventory_object(std::ptr::dangling_mut()).is_ok());
    }
}
