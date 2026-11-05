//! Windows CNG owns the persistent signing key; its export policy must remain zero.
#![allow(unsafe_code)]
use std::{ffi::c_void, ptr};
#[link(name = "ncrypt")]
unsafe extern "system" {
    fn NCryptOpenStorageProvider(provider: *mut usize, name: *const u16, flags: u32) -> i32;
    fn NCryptOpenKey(
        provider: usize,
        key: *mut usize,
        name: *const u16,
        legacy: u32,
        flags: u32,
    ) -> i32;
    fn NCryptCreatePersistedKey(
        provider: usize,
        key: *mut usize,
        algorithm: *const u16,
        name: *const u16,
        legacy: u32,
        flags: u32,
    ) -> i32;
    fn NCryptSetProperty(
        key: usize,
        property: *const u16,
        value: *const u8,
        length: u32,
        flags: u32,
    ) -> i32;
    fn NCryptGetProperty(
        key: usize,
        property: *const u16,
        value: *mut u8,
        length: u32,
        written: *mut u32,
        flags: u32,
    ) -> i32;
    fn NCryptFinalizeKey(key: usize, flags: u32) -> i32;
    fn NCryptExportKey(
        key: usize,
        export_key: usize,
        blob_type: *const u16,
        parameters: *const c_void,
        output: *mut u8,
        size: u32,
        written: *mut u32,
        flags: u32,
    ) -> i32;
    fn NCryptSignHash(
        key: usize,
        padding: *const c_void,
        digest: *const u8,
        length: u32,
        output: *mut u8,
        size: u32,
        written: *mut u32,
        flags: u32,
    ) -> i32;
    fn NCryptFreeObject(handle: usize) -> i32;
    fn NCryptDeleteKey(key: usize, flags: u32) -> i32;
}
struct Handle(usize);
impl Drop for Handle {
    fn drop(&mut self) {
        unsafe {
            NCryptFreeObject(self.0);
        }
    }
}
fn wide(value: &str) -> Vec<u16> {
    value.encode_utf16().chain(Some(0)).collect()
}
fn provider() -> Result<Handle, ()> {
    let mut handle = 0;
    if unsafe {
        NCryptOpenStorageProvider(
            &raw mut handle,
            wide("Microsoft Software Key Storage Provider").as_ptr(),
            0,
        )
    } != 0
    {
        return Err(());
    }
    Ok(Handle(handle))
}
fn key(scope: &str, create: bool) -> Result<Handle, ()> {
    let provider = provider()?;
    let name = wide(&format!("org.proctor.desktop.key.v1.{scope}"));
    let mut handle = 0;
    let status = unsafe { NCryptOpenKey(provider.0, &raw mut handle, name.as_ptr(), 0, 0) };
    if status != 0 {
        if u32::from_ne_bytes(status.to_ne_bytes()) != 0x8009_0016 || !create {
            return Err(());
        }
        if unsafe {
            NCryptCreatePersistedKey(
                provider.0,
                &raw mut handle,
                wide("ECDSA_P256").as_ptr(),
                name.as_ptr(),
                0,
                0,
            )
        } != 0
        {
            return Err(());
        }
        let created = Handle(handle);
        let export_policy = 0_u32;
        if unsafe {
            NCryptSetProperty(
                created.0,
                wide("Export Policy").as_ptr(),
                ptr::from_ref(&export_policy).cast(),
                4,
                0,
            )
        } != 0
            || unsafe { NCryptFinalizeKey(created.0, 0) } != 0
        {
            return Err(());
        }
        std::mem::forget(created);
    }
    let key = Handle(handle);
    let mut policy = 0_u32;
    let mut size = 0;
    if unsafe {
        NCryptGetProperty(
            key.0,
            wide("Export Policy").as_ptr(),
            ptr::from_mut(&mut policy).cast(),
            4,
            &raw mut size,
            0,
        )
    } != 0
        || size != 4
        || policy != 0
    {
        return Err(());
    }
    Ok(key)
}
pub fn public_key(scope: &str) -> Result<Vec<u8>, ()> {
    let key = key(scope, true)?;
    let mut blob = [0_u8; 72];
    let mut size = 0;
    if unsafe {
        NCryptExportKey(
            key.0,
            0,
            wide("ECCPUBLICBLOB").as_ptr(),
            ptr::null(),
            blob.as_mut_ptr(),
            72,
            &raw mut size,
            0,
        )
    } != 0
        || size != 72
        || &blob[..4] != b"ECS1"
        || blob[4..8] != 32_u32.to_le_bytes()
    {
        return Err(());
    }
    let mut result = vec![4];
    result.extend_from_slice(&blob[8..]);
    Ok(result)
}
pub fn sign(scope: &str, digest: &[u8]) -> Result<Vec<u8>, ()> {
    if digest.len() != 32 {
        return Err(());
    }
    let key = key(scope, false)?;
    let mut signature = vec![0_u8; 64];
    let mut size = 0;
    if unsafe {
        NCryptSignHash(
            key.0,
            ptr::null(),
            digest.as_ptr(),
            32,
            signature.as_mut_ptr(),
            64,
            &raw mut size,
            0,
        )
    } != 0
        || size != 64
    {
        return Err(());
    }
    Ok(signature)
}
pub fn delete(scope: &str) -> Result<(), ()> {
    let provider = provider()?;
    let mut handle = 0;
    let status = unsafe {
        NCryptOpenKey(
            provider.0,
            &raw mut handle,
            wide(&format!("org.proctor.desktop.key.v1.{scope}")).as_ptr(),
            0,
            0,
        )
    };
    if u32::from_ne_bytes(status.to_ne_bytes()) == 0x8009_0016 {
        return Ok(());
    }
    if status != 0 {
        return Err(());
    }
    let key = Handle(handle);
    if unsafe { NCryptDeleteKey(key.0, 0) } != 0 {
        return Err(());
    }
    std::mem::forget(key);
    Ok(())
}
