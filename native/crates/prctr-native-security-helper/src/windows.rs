use std::ffi::OsString;
use std::fs::{File, OpenOptions};
use std::io::{Read, Seek, SeekFrom};
use std::mem;
use std::os::windows::ffi::{OsStrExt, OsStringExt};
use std::os::windows::fs::OpenOptionsExt;
use std::os::windows::io::AsRawHandle;
use std::path::{Path, PathBuf};
use std::ptr;

use windows_sys::Win32::Foundation::{CloseHandle, HANDLE, INVALID_HANDLE_VALUE};
use windows_sys::Win32::Security::Cryptography::{
    BCRYPT_ALG_HANDLE, BCRYPT_SHA256_ALGORITHM, BCRYPT_USE_SYSTEM_PREFERRED_RNG,
    BCryptCloseAlgorithmProvider, BCryptGenRandom, BCryptHash, BCryptOpenAlgorithmProvider,
};
use windows_sys::Win32::Security::WinTrust::{
    WINTRUST_ACTION_GENERIC_VERIFY_V2, WINTRUST_DATA, WINTRUST_DATA_0, WINTRUST_FILE_INFO,
    WTD_CACHE_ONLY_URL_RETRIEVAL, WTD_CHOICE_FILE, WTD_DISABLE_MD2_MD4,
    WTD_REVOCATION_CHECK_CHAIN_EXCLUDE_ROOT, WTD_REVOKE_WHOLECHAIN, WTD_STATEACTION_CLOSE,
    WTD_STATEACTION_VERIFY, WTD_UI_NONE, WinVerifyTrust,
};
use windows_sys::Win32::Storage::FileSystem::FILE_SHARE_READ;
use windows_sys::Win32::System::Threading::{
    OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION, QueryFullProcessImageNameW,
};

use crate::HelperTransportError;

const MAX_HELPER_EXECUTABLE_BYTES: u64 = 64 * 1024 * 1024;
const MAX_WINDOWS_IMAGE_PATH_CODE_UNITS: usize = 32_768;

pub(super) fn lock_and_verify_executable(
    path: &Path,
    expected_sha256: &str,
) -> Result<File, HelperTransportError> {
    let file = OpenOptions::new()
        .read(true)
        .share_mode(FILE_SHARE_READ)
        .open(path)?;
    let mut wide_path = path.as_os_str().encode_wide().collect::<Vec<_>>();
    wide_path.push(0);
    let mut trust_file = WINTRUST_FILE_INFO {
        cbStruct: u32::try_from(mem::size_of::<WINTRUST_FILE_INFO>()).unwrap_or(u32::MAX),
        pcwszFilePath: wide_path.as_ptr(),
        hFile: file.as_raw_handle().cast(),
        pgKnownSubject: ptr::null_mut(),
    };
    let mut data = WINTRUST_DATA {
        cbStruct: u32::try_from(mem::size_of::<WINTRUST_DATA>()).unwrap_or(u32::MAX),
        pPolicyCallbackData: ptr::null_mut(),
        pSIPClientData: ptr::null_mut(),
        dwUIChoice: WTD_UI_NONE,
        fdwRevocationChecks: WTD_REVOKE_WHOLECHAIN,
        dwUnionChoice: WTD_CHOICE_FILE,
        Anonymous: WINTRUST_DATA_0 {
            pFile: &raw mut trust_file,
        },
        dwStateAction: WTD_STATEACTION_VERIFY,
        hWVTStateData: ptr::null_mut(),
        pwszURLReference: ptr::null_mut(),
        dwProvFlags: WTD_REVOCATION_CHECK_CHAIN_EXCLUDE_ROOT
            | WTD_CACHE_ONLY_URL_RETRIEVAL
            | WTD_DISABLE_MD2_MD4,
        dwUIContext: 0,
        pSignatureSettings: ptr::null_mut(),
    };
    let mut action = WINTRUST_ACTION_GENERIC_VERIFY_V2;
    // SAFETY: all pointers reference live initialized WinTrust structures for
    // the duration of the synchronous verification call.
    let status =
        unsafe { WinVerifyTrust(ptr::null_mut(), &raw mut action, (&raw mut data).cast()) };
    data.dwStateAction = WTD_STATEACTION_CLOSE;
    // SAFETY: this closes only the state handle created by the verification
    // call above and uses the same initialized structures.
    unsafe {
        WinVerifyTrust(ptr::null_mut(), &raw mut action, (&raw mut data).cast());
    }
    if status != 0 || sha256(&file)? != parse_sha256(expected_sha256)? {
        return Err(HelperTransportError::ExecutableIdentity);
    }
    Ok(file)
}

pub(super) fn verify_spawned_image(
    process_id: u32,
    expected_path: &Path,
    locked_executable: &File,
) -> Result<(), HelperTransportError> {
    // SAFETY: this opens only a query handle to the exact freshly spawned PID.
    let process = unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, process_id) };
    if process.is_null() || process == INVALID_HANDLE_VALUE {
        return Err(HelperTransportError::ExecutableIdentity);
    }
    let process = OwnedProcessHandle(process);
    let mut path = vec![0_u16; MAX_WINDOWS_IMAGE_PATH_CODE_UNITS];
    let mut length = u32::try_from(path.len()).unwrap_or(u32::MAX);
    // SAFETY: the child handle is live, the output buffer is writable, and
    // length describes its complete capacity.
    let success =
        unsafe { QueryFullProcessImageNameW(process.0, 0, path.as_mut_ptr(), &raw mut length) };
    if success == 0 || length == 0 || length as usize > path.len() {
        return Err(HelperTransportError::ExecutableIdentity);
    }
    let spawned_path = PathBuf::from(OsString::from_wide(&path[..length as usize]));
    if spawned_path.canonicalize()? != expected_path.canonicalize()? {
        return Err(HelperTransportError::ExecutableIdentity);
    }
    if !locked_executable.metadata()?.is_file() {
        return Err(HelperTransportError::ExecutableIdentity);
    }
    // The verified handle was opened without FILE_SHARE_WRITE or
    // FILE_SHARE_DELETE and remains live across CreateProcess and this child
    // image check. Windows therefore cannot replace the admitted bytes at the
    // resolved path during launch.
    Ok(())
}

struct OwnedProcessHandle(HANDLE);

impl Drop for OwnedProcessHandle {
    fn drop(&mut self) {
        if !self.0.is_null() && self.0 != INVALID_HANDLE_VALUE {
            // SAFETY: this wrapper owns the query handle and closes it once.
            unsafe { CloseHandle(self.0) };
            self.0 = ptr::null_mut();
        }
    }
}

fn sha256(file: &File) -> Result<[u8; 32], HelperTransportError> {
    let metadata = file.metadata()?;
    if !metadata.is_file() || metadata.len() == 0 || metadata.len() > MAX_HELPER_EXECUTABLE_BYTES {
        return Err(HelperTransportError::ExecutableIdentity);
    }
    let mut file = file.try_clone()?;
    file.seek(SeekFrom::Start(0))?;
    let mut bytes = Vec::with_capacity(
        usize::try_from(metadata.len())
            .map_err(|_error| HelperTransportError::ExecutableIdentity)?,
    );
    file.take(MAX_HELPER_EXECUTABLE_BYTES + 1)
        .read_to_end(&mut bytes)?;
    if bytes.len() as u64 != metadata.len() || bytes.len() as u64 > MAX_HELPER_EXECUTABLE_BYTES {
        return Err(HelperTransportError::ExecutableIdentity);
    }
    let input_length =
        u32::try_from(bytes.len()).map_err(|_error| HelperTransportError::ExecutableIdentity)?;
    let mut algorithm: BCRYPT_ALG_HANDLE = ptr::null_mut();
    // SAFETY: algorithm is valid output storage and the SHA-256 identifier is
    // a static Windows string.
    let open_status = unsafe {
        BCryptOpenAlgorithmProvider(&raw mut algorithm, BCRYPT_SHA256_ALGORITHM, ptr::null(), 0)
    };
    if open_status < 0 || algorithm.is_null() {
        return Err(HelperTransportError::ExecutableIdentity);
    }
    let mut digest = [0_u8; 32];
    // SAFETY: the algorithm handle is live and all byte buffers remain valid
    // for the duration of this one-shot hash call.
    let hash_status = unsafe {
        BCryptHash(
            algorithm,
            ptr::null(),
            0,
            bytes.as_ptr(),
            input_length,
            digest.as_mut_ptr(),
            u32::try_from(digest.len()).unwrap_or(u32::MAX),
        )
    };
    // SAFETY: this closes only the algorithm handle opened above.
    unsafe { BCryptCloseAlgorithmProvider(algorithm, 0) };
    if hash_status < 0 {
        return Err(HelperTransportError::ExecutableIdentity);
    }
    Ok(digest)
}

pub(super) fn fill_random(bytes: &mut [u8]) -> Result<(), HelperTransportError> {
    let length =
        u32::try_from(bytes.len()).map_err(|_error| HelperTransportError::ExecutableIdentity)?;
    // SAFETY: the output slice is writable for exactly `length` bytes and the
    // system-preferred provider requires no caller-owned algorithm handle.
    let status = unsafe {
        BCryptGenRandom(
            ptr::null_mut(),
            bytes.as_mut_ptr(),
            length,
            BCRYPT_USE_SYSTEM_PREFERRED_RNG,
        )
    };
    if status < 0 {
        return Err(HelperTransportError::ExecutableIdentity);
    }
    Ok(())
}

fn parse_sha256(value: &str) -> Result<[u8; 32], HelperTransportError> {
    if value.len() != 64
        || !value
            .bytes()
            .all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase())
    {
        return Err(HelperTransportError::ExecutableIdentity);
    }
    let mut output = [0_u8; 32];
    for (index, chunk) in value.as_bytes().chunks_exact(2).enumerate() {
        output[index] = (hex_nibble(chunk[0])? << 4) | hex_nibble(chunk[1])?;
    }
    Ok(output)
}

const fn hex_nibble(byte: u8) -> Result<u8, HelperTransportError> {
    match byte {
        b'0'..=b'9' => Ok(byte - b'0'),
        b'a'..=b'f' => Ok(byte - b'a' + 10),
        _ => Err(HelperTransportError::ExecutableIdentity),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn release_digest_accepts_only_exact_lowercase_sha256() {
        assert_eq!(parse_sha256(&"ab".repeat(32)).expect("digest"), [0xab; 32]);
        assert!(parse_sha256(&"AB".repeat(32)).is_err());
        assert!(parse_sha256("ab").is_err());
        assert!(parse_sha256(&format!("{}zz", "ab".repeat(31))).is_err());
    }
}
