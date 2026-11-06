//! Security.framework owns persistent non-exportable P-256 keys. All CF references
//! are scoped and released; external representation is requested only for the public key.
#![allow(unsafe_code, non_upper_case_globals)]
use std::{
    ffi::c_void,
    ptr, slice,
    sync::{Mutex, MutexGuard, PoisonError},
};
type Ref = *const c_void;
// Keychain find-then-generate is not atomic: two concurrent creators would each
// add a key under one tag. This serializes lookup, creation and deletion within
// the process (all Node threads loading this addon). Cross-process creation is
// not serialized here; the Electron main single-instance lock owns that.
static CUSTODY: Mutex<()> = Mutex::new(());
fn custody() -> MutexGuard<'static, ()> {
    // The guard protects no data, so a panicked holder leaves nothing inconsistent.
    CUSTODY.lock().unwrap_or_else(PoisonError::into_inner)
}
#[link(name = "CoreFoundation", kind = "framework")]
unsafe extern "C" {
    fn CFRelease(value: Ref);
    fn CFDataCreate(allocator: Ref, bytes: *const u8, length: isize) -> Ref;
    fn CFDataGetLength(data: Ref) -> isize;
    fn CFDataGetBytePtr(data: Ref) -> *const u8;
    fn CFNumberCreate(allocator: Ref, kind: i32, value: *const i32) -> Ref;
    fn CFDictionaryCreate(
        allocator: Ref,
        keys: *const Ref,
        values: *const Ref,
        count: isize,
        keys_callbacks: Ref,
        values_callbacks: Ref,
    ) -> Ref;
    fn CFDictionaryGetValue(dict: Ref, key: Ref) -> Ref;
    fn CFBooleanGetValue(value: Ref) -> bool;
    static kCFBooleanTrue: Ref;
    static kCFBooleanFalse: Ref;
}
#[link(name = "Security", kind = "framework")]
unsafe extern "C" {
    static kSecClass: Ref;
    static kSecClassKey: Ref;
    static kSecAttrApplicationTag: Ref;
    static kSecAttrKeyType: Ref;
    static kSecAttrKeyTypeECSECPrimeRandom: Ref;
    static kSecReturnRef: Ref;
    static kSecAttrIsPermanent: Ref;
    static kSecAttrIsExtractable: Ref;
    static kSecAttrKeySizeInBits: Ref;
    static kSecAttrKeyClass: Ref;
    static kSecAttrKeyClassPrivate: Ref;
    static kSecPrivateKeyAttrs: Ref;
    static kSecKeyAlgorithmECDSASignatureDigestX962SHA256: Ref;
    fn SecItemCopyMatching(query: Ref, result: *mut Ref) -> i32;
    fn SecItemDelete(query: Ref) -> i32;
    fn SecKeyGeneratePair(attributes: Ref, public: *mut Ref, private: *mut Ref) -> i32;
    fn SecKeyCopyAttributes(key: Ref) -> Ref;
    fn SecKeyCopyPublicKey(key: Ref) -> Ref;
    fn SecKeyCopyExternalRepresentation(key: Ref, error: *mut Ref) -> Ref;
    fn SecKeyCreateSignature(key: Ref, algorithm: Ref, digest: Ref, error: *mut Ref) -> Ref;
}
struct Owned(Ref);
impl Owned {
    fn new(value: Ref) -> Result<Self, ()> {
        if value.is_null() {
            Err(())
        } else {
            Ok(Self(value))
        }
    }
}
impl Drop for Owned {
    fn drop(&mut self) {
        unsafe {
            CFRelease(self.0);
        }
    }
}
// Dictionaries do not retain their entries; every caller keeps entries alive through the OS call.
fn dict(entries: &[(Ref, Ref)]) -> Result<Owned, ()> {
    let keys: Vec<Ref> = entries.iter().map(|e| e.0).collect();
    let values: Vec<Ref> = entries.iter().map(|e| e.1).collect();
    Owned::new(unsafe {
        CFDictionaryCreate(
            ptr::null(),
            keys.as_ptr(),
            values.as_ptr(),
            isize::try_from(entries.len()).map_err(|_| ())?,
            ptr::null(),
            ptr::null(),
        )
    })
}
fn tag(scope: &str) -> Result<Owned, ()> {
    let value = format!("org.proctor.desktop.key.{scope}");
    Owned::new(unsafe {
        CFDataCreate(
            ptr::null(),
            value.as_ptr(),
            isize::try_from(value.len()).map_err(|_| ())?,
        )
    })
}
fn query(tag: &Owned, return_ref: bool) -> Result<Owned, ()> {
    unsafe {
        let mut entries = vec![
            (kSecClass, kSecClassKey),
            (kSecAttrApplicationTag, tag.0),
            (kSecAttrKeyType, kSecAttrKeyTypeECSECPrimeRandom),
            (kSecAttrKeyClass, kSecAttrKeyClassPrivate),
        ];
        if return_ref {
            entries.push((kSecReturnRef, kCFBooleanTrue));
        }
        dict(&entries)
    }
}
fn key(scope: &str, create: bool) -> Result<Owned, ()> {
    let _custody = custody();
    let tag = tag(scope)?;
    let query = query(&tag, true)?;
    let mut result = ptr::null();
    let status = unsafe { SecItemCopyMatching(query.0, &raw mut result) };
    let key = if status == 0 {
        Owned::new(result)?
    } else {
        if status != -25300 || !create {
            return Err(());
        }
        let size = Owned::new(unsafe { CFNumberCreate(ptr::null(), 3, &256) })?;
        let private = unsafe {
            dict(&[
                (kSecAttrApplicationTag, tag.0),
                (kSecAttrIsPermanent, kCFBooleanTrue),
                (kSecAttrIsExtractable, kCFBooleanFalse),
            ])?
        };
        let attributes = unsafe {
            dict(&[
                (kSecAttrKeyType, kSecAttrKeyTypeECSECPrimeRandom),
                (kSecAttrKeySizeInBits, size.0),
                (kSecAttrIsExtractable, kCFBooleanFalse),
                (kSecPrivateKeyAttrs, private.0),
            ])?
        };
        let mut public = ptr::null();
        let mut private = ptr::null();
        let status = unsafe { SecKeyGeneratePair(attributes.0, &raw mut public, &raw mut private) };
        if !public.is_null() {
            drop(Owned(public));
        }
        if status != 0 {
            if !private.is_null() {
                drop(Owned(private));
            }
            return Err(());
        }
        Owned::new(private)?
    };
    // Refuse old/imported/exportable keys even if they happen to share our application tag.
    let attrs = Owned::new(unsafe { SecKeyCopyAttributes(key.0) })?;
    let extractable = unsafe { CFDictionaryGetValue(attrs.0, kSecAttrIsExtractable) };
    if extractable.is_null() || unsafe { CFBooleanGetValue(extractable) } {
        return Err(());
    }
    Ok(key)
}
fn bytes(data: &Owned, max: usize) -> Result<Vec<u8>, ()> {
    let length = usize::try_from(unsafe { CFDataGetLength(data.0) }).map_err(|_| ())?;
    if length < 1 || length > max {
        return Err(());
    }
    Ok(unsafe { slice::from_raw_parts(CFDataGetBytePtr(data.0), length) }.to_vec())
}
pub fn public_key(scope: &str) -> Result<Vec<u8>, ()> {
    let key = key(scope, true)?;
    let public = Owned::new(unsafe { SecKeyCopyPublicKey(key.0) })?;
    let mut error = ptr::null();
    // This function is invoked only on the public reference from SecKeyCopyPublicKey.
    let data = unsafe { SecKeyCopyExternalRepresentation(public.0, &raw mut error) };
    if !error.is_null() {
        drop(Owned(error));
    }
    let result = bytes(&Owned::new(data)?, 65)?;
    if result.len() != 65 || result[0] != 4 {
        return Err(());
    }
    Ok(result)
}
pub fn sign(scope: &str, digest: &[u8]) -> Result<Vec<u8>, ()> {
    let key = key(scope, false)?;
    let data = Owned::new(unsafe {
        CFDataCreate(
            ptr::null(),
            digest.as_ptr(),
            isize::try_from(digest.len()).map_err(|_| ())?,
        )
    })?;
    let mut error = ptr::null();
    let signed = unsafe {
        SecKeyCreateSignature(
            key.0,
            kSecKeyAlgorithmECDSASignatureDigestX962SHA256,
            data.0,
            &raw mut error,
        )
    };
    if !error.is_null() {
        drop(Owned(error));
    }
    let der = bytes(&Owned::new(signed)?, 72)?;
    p1363(&der)
}
fn p1363(der: &[u8]) -> Result<Vec<u8>, ()> {
    if der.len() < 8 || der[0] != 0x30 || usize::from(der[1]) != der.len() - 2 {
        return Err(());
    }
    let mut cursor = 2;
    let mut result = vec![0; 64];
    for offset in [0, 32] {
        if cursor + 2 > der.len() || der[cursor] != 2 {
            return Err(());
        }
        let length = usize::from(der[cursor + 1]);
        cursor += 2;
        if length == 0 || length > 33 || cursor + length > der.len() {
            return Err(());
        }
        let mut value = &der[cursor..cursor + length];
        cursor += length;
        if value[0] == 0 {
            value = &value[1..];
        }
        if value.len() > 32 {
            return Err(());
        }
        result[offset + 32 - value.len()..offset + 32].copy_from_slice(value);
    }
    if cursor != der.len() {
        return Err(());
    }
    Ok(result)
}
pub fn delete(scope: &str) -> Result<(), ()> {
    let _custody = custody();
    let tag = tag(scope)?;
    let query = query(&tag, false)?;
    match unsafe { SecItemDelete(query.0) } {
        0 | -25300 => Ok(()),
        _ => Err(()),
    }
}
