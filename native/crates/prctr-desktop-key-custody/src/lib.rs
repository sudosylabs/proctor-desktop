//! Privileged identity adapter. No observation, generic key import, or private-key export.
// Node-API owns argument conversion and requires owned values for these exports.
#![allow(clippy::needless_pass_by_value)]
use napi::{Error, Result, bindgen_prelude::Buffer};
use napi_derive::napi;
#[cfg(target_os = "macos")]
mod macos;
#[cfg(target_os = "windows")]
mod windows;
#[cfg(target_os = "macos")]
use macos as platform;
#[cfg(target_os = "windows")]
use windows as platform;
#[cfg(not(any(target_os = "macos", target_os = "windows")))]
mod platform {
    pub fn public_key(_: &str) -> Result<Vec<u8>, ()> {
        Err(())
    }
    pub fn sign(_: &str, _: &[u8]) -> Result<Vec<u8>, ()> {
        Err(())
    }
    pub fn delete(_: &str) -> Result<(), ()> {
        Err(())
    }
}
fn scope(value: &str) -> Result<()> {
    if value.len() == 64
        && value
            .bytes()
            .all(|c| c.is_ascii_digit() || (b'a'..=b'f').contains(&c))
    {
        Ok(())
    } else {
        Err(Error::from_reason("Invalid key scope"))
    }
}
fn unavailable(_: ()) -> Error {
    Error::from_reason("Native key custody unavailable")
}
/// Load or create the installation public key.
/// # Errors
/// Rejects invalid scopes or unavailable/nonconforming OS custody.
#[napi]
pub fn public_key(key_scope: String) -> Result<Buffer> {
    scope(&key_scope)?;
    platform::public_key(&key_scope)
        .map(Buffer::from)
        .map_err(unavailable)
}
/// Sign one SHA-256 digest without exporting key material.
/// # Errors
/// Rejects invalid input, missing keys, or unavailable OS custody.
#[napi]
pub fn sign_digest(key_scope: String, digest: Buffer) -> Result<Buffer> {
    scope(&key_scope)?;
    if digest.len() != 32 {
        return Err(Error::from_reason("Invalid signing digest"));
    }
    platform::sign(&key_scope, &digest)
        .map(Buffer::from)
        .map_err(unavailable)
}
/// Remove one installation key.
/// # Errors
/// Rejects invalid scopes or unsuccessful OS deletion.
#[napi]
pub fn delete_key(key_scope: String) -> Result<()> {
    scope(&key_scope)?;
    platform::delete(&key_scope).map_err(unavailable)
}
