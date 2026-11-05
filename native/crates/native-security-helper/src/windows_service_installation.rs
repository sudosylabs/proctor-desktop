//! OS-owned machine installation root; never derived from inherited environment.
use crate::{HelperTransportError, remaining};
use std::ffi::OsString;
use std::os::windows::ffi::OsStringExt;
use std::path::PathBuf;
use std::ptr;
use std::time::Instant;
use windows_sys::Win32::System::Com::CoTaskMemFree;
use windows_sys::Win32::UI::Shell::{FOLDERID_ProgramFilesX64, SHGetKnownFolderPath};

pub(super) fn program_files(deadline: Instant) -> Result<PathBuf, HelperTransportError> {
    remaining(deadline)?;
    let mut output = ptr::null_mut();
    // SAFETY: fixed machine known-folder and valid output; no caller-selected ID,
    // token or path. Windows owns the returned NUL-terminated allocation.
    let status = unsafe {
        SHGetKnownFolderPath(
            &FOLDERID_ProgramFilesX64,
            0,
            ptr::null_mut(),
            &raw mut output,
        )
    };
    let owned = KnownFolder(output);
    if status < 0 || owned.0.is_null() {
        return Err(HelperTransportError::ExecutableIdentity);
    }
    let mut length = 0;
    // The Windows path limit also bounds our read. SDK success promises a
    // NUL-terminated UTF-16 string; no untrusted process supplies this pointer.
    while length < 32_768 && unsafe { *owned.0.add(length) } != 0 {
        length += 1;
    }
    if length == 0 || length == 32_768 {
        return Err(HelperTransportError::ExecutableIdentity);
    }
    let root = PathBuf::from(OsString::from_wide(unsafe {
        std::slice::from_raw_parts(owned.0, length)
    }));
    drop(owned);
    remaining(deadline)?;
    if !root.is_absolute() {
        return Err(HelperTransportError::ExecutableIdentity);
    }
    Ok(root)
}
struct KnownFolder(*mut u16);
impl Drop for KnownFolder {
    fn drop(&mut self) {
        // SAFETY: frees the exact SDK allocation even on failed/late setup.
        // CoTaskMemFree has no fallible status and accepts null.
        unsafe {
            CoTaskMemFree(self.0.cast());
        }
    }
}
