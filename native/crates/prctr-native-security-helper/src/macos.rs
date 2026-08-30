use std::ffi::c_void;
use std::ptr;

use crate::HelperTransportError;

type CfTypeRef = *const c_void;
type CfStringRef = *const c_void;
type CfNumberRef = *const c_void;
type CfDictionaryRef = *const c_void;
type SecCodeRef = *const c_void;
type SecRequirementRef = *const c_void;

const CF_NUMBER_SINT32_TYPE: i32 = 3;
const CF_STRING_ENCODING_UTF8: u32 = 0x0800_0100;

#[link(name = "CoreFoundation", kind = "framework")]
unsafe extern "C" {
    fn CFNumberCreate(
        allocator: *const c_void,
        number_type: i32,
        value: *const c_void,
    ) -> CfNumberRef;
    fn CFStringCreateWithBytes(
        allocator: *const c_void,
        bytes: *const u8,
        length: isize,
        encoding: u32,
        is_external_representation: u8,
    ) -> CfStringRef;
    fn CFDictionaryCreate(
        allocator: *const c_void,
        keys: *const *const c_void,
        values: *const *const c_void,
        count: isize,
        key_callbacks: *const c_void,
        value_callbacks: *const c_void,
    ) -> CfDictionaryRef;
    fn CFRelease(value: CfTypeRef);
}

#[link(name = "Security", kind = "framework")]
unsafe extern "C" {
    static kSecGuestAttributePid: CfStringRef;
    fn SecCodeCopyGuestWithAttributes(
        host: SecCodeRef,
        attributes: CfDictionaryRef,
        flags: u32,
        guest: *mut SecCodeRef,
    ) -> i32;
    fn SecRequirementCreateWithString(
        text: CfStringRef,
        flags: u32,
        requirement: *mut SecRequirementRef,
    ) -> i32;
    fn SecCodeCheckValidity(code: SecCodeRef, flags: u32, requirement: SecRequirementRef) -> i32;
}

pub(super) fn verify_spawned_code(
    process_id: u32,
    designated_requirement: &str,
) -> Result<(), HelperTransportError> {
    if designated_requirement.is_empty() || designated_requirement.len() > 2_048 {
        return Err(HelperTransportError::ExecutableIdentity);
    }
    let pid =
        i32::try_from(process_id).map_err(|_error| HelperTransportError::ExecutableIdentity)?;
    // SAFETY: every CoreFoundation object is checked for null, remains live
    // across the synchronous Security.framework calls, and is released once.
    unsafe {
        let pid_number =
            CFNumberCreate(ptr::null(), CF_NUMBER_SINT32_TYPE, (&raw const pid).cast());
        if pid_number.is_null() {
            return Err(HelperTransportError::ExecutableIdentity);
        }
        let keys = [kSecGuestAttributePid.cast::<c_void>()];
        let values = [pid_number.cast::<c_void>()];
        let attributes = CFDictionaryCreate(
            ptr::null(),
            keys.as_ptr(),
            values.as_ptr(),
            1,
            ptr::null(),
            ptr::null(),
        );
        if attributes.is_null() {
            CFRelease(pid_number);
            return Err(HelperTransportError::ExecutableIdentity);
        }
        let mut code: SecCodeRef = ptr::null();
        let guest_status =
            SecCodeCopyGuestWithAttributes(ptr::null(), attributes, 0, &raw mut code);
        CFRelease(attributes);
        CFRelease(pid_number);
        if guest_status != 0 || code.is_null() {
            return Err(HelperTransportError::ExecutableIdentity);
        }
        let requirement_text = CFStringCreateWithBytes(
            ptr::null(),
            designated_requirement.as_ptr(),
            isize::try_from(designated_requirement.len())
                .map_err(|_error| HelperTransportError::ExecutableIdentity)?,
            CF_STRING_ENCODING_UTF8,
            0,
        );
        if requirement_text.is_null() {
            CFRelease(code);
            return Err(HelperTransportError::ExecutableIdentity);
        }
        let mut requirement: SecRequirementRef = ptr::null();
        let requirement_status =
            SecRequirementCreateWithString(requirement_text, 0, &raw mut requirement);
        CFRelease(requirement_text);
        if requirement_status != 0 || requirement.is_null() {
            CFRelease(code);
            return Err(HelperTransportError::ExecutableIdentity);
        }
        let validity_status = SecCodeCheckValidity(code, 0, requirement);
        CFRelease(requirement);
        CFRelease(code);
        if validity_status != 0 {
            return Err(HelperTransportError::ExecutableIdentity);
        }
    }
    Ok(())
}
