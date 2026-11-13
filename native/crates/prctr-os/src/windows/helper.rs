//! Safe, owned Windows service observations. Sensitive paths stay in this module.
use std::fmt::Write as _;
use std::fs::File;
use std::os::windows::ffi::OsStringExt;
use std::os::windows::fs::OpenOptionsExt;
use std::os::windows::io::AsRawHandle;
use std::path::Path;

use windows::Win32::Foundation::{CloseHandle, FILETIME, HANDLE, HWND, WIN32_ERROR};
use windows::Win32::System::Threading::{
    GetProcessTimes, OpenProcess, PROCESS_NAME_WIN32, PROCESS_QUERY_LIMITED_INFORMATION,
    QueryFullProcessImageNameW,
};
use windows::core::{HSTRING, PWSTR};

use crate::OsError;
use crate::helper::{
    Attachment, MAX_PROCESSES, MAX_SESSIONS, ProcessStart, SessionInfo, filetime_to_unix,
};

struct Process(HANDLE);
impl Drop for Process {
    fn drop(&mut self) {
        // SAFETY: this wrapper owns the process handle and closes it once.
        let _ = unsafe { CloseHandle(self.0) };
    }
}

fn open(pid: u32) -> Option<Process> {
    // SAFETY: no pointer inputs; query-only access and no inheritance.
    unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid) }
        .ok()
        .map(Process)
}

#[must_use]
pub fn process_session(pid: u32) -> Option<u32> {
    let mut session = 0;
    // SAFETY: session is a live writable out parameter.
    unsafe { windows::Win32::System::RemoteDesktop::ProcessIdToSessionId(pid, &raw mut session) }
        .ok()?;
    Some(session)
}

fn created(process: &Process) -> Option<u64> {
    let (mut start, mut exit, mut kernel, mut user) = (
        FILETIME::default(),
        FILETIME::default(),
        FILETIME::default(),
        FILETIME::default(),
    );
    // SAFETY: the process handle is live and all FILETIME outputs are writable.
    unsafe {
        GetProcessTimes(
            process.0,
            &raw mut start,
            &raw mut exit,
            &raw mut kernel,
            &raw mut user,
        )
    }
    .ok()?;
    filetime_to_unix((u64::from(start.dwHighDateTime) << 32) | u64::from(start.dwLowDateTime))
}

/// Includes session-zero services. Failure or overflow never yields a truncated inventory.
#[must_use]
pub fn snapshot() -> Option<Vec<ProcessStart>> {
    use windows::Win32::System::Diagnostics::ToolHelp::{
        CreateToolhelp32Snapshot, PROCESSENTRY32W, Process32FirstW, Process32NextW,
        TH32CS_SNAPPROCESS,
    };
    // SAFETY: no pointer inputs, requesting the machine's process table.
    let snapshot = Process(unsafe { CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) }.ok()?);
    let mut entry = PROCESSENTRY32W {
        dwSize: u32::try_from(size_of::<PROCESSENTRY32W>()).ok()?,
        ..Default::default()
    };
    // SAFETY: snapshot is live and entry declares its initialized structure size.
    unsafe { Process32FirstW(snapshot.0, &raw mut entry) }.ok()?;
    let mut result = Vec::new();
    for _ in 0..MAX_PROCESSES {
        if entry.th32ProcessID != 0 {
            let process = open(entry.th32ProcessID);
            match process_session(entry.th32ProcessID) {
                Some(session) => result.push(ProcessStart {
                    pid: entry.th32ProcessID,
                    parent: entry.th32ParentProcessID,
                    session,
                    created: process.as_ref().and_then(created).unwrap_or(0),
                }),
                // The process exited after enumeration: it is no longer part of the inventory.
                None if process.is_none() => {}
                // A live process whose session cannot be read: no complete inventory exists.
                None => return None,
            }
        }
        // SAFETY: snapshot and sized entry remain live.
        if let Err(error) = unsafe { Process32NextW(snapshot.0, &raw mut entry) } {
            return (error.code() == windows::Win32::Foundation::ERROR_NO_MORE_FILES.to_hresult())
                .then_some(result);
        }
    }
    None
}

/// Full image path only for internal peer verification.
fn locked_file(path: &Path) -> Option<File> {
    // Holding a read-only, share-read handle prevents replacement or resource mutation during
    // path/signature/version verification. A conflicting writer makes authorization fail closed.
    File::options().read(true).share_mode(1).open(path).ok()
}

fn image(pid: u32) -> Option<File> {
    let process = open(pid)?;
    let mut buffer = vec![0_u16; 32_768];
    let mut size = u32::try_from(buffer.len()).ok()?;
    // SAFETY: live process and writable buffer with its declared capacity.
    unsafe {
        QueryFullProcessImageNameW(
            process.0,
            PROCESS_NAME_WIN32,
            PWSTR(buffer.as_mut_ptr()),
            &raw mut size,
        )
    }
    .ok()?;
    locked_file(Path::new(&std::ffi::OsString::from_wide(
        buffer.get(..size as usize)?,
    )))
}

fn final_path(file: &File) -> Option<Vec<u16>> {
    use windows::Win32::Storage::FileSystem::{FILE_NAME_NORMALIZED, GetFinalPathNameByHandleW};
    let mut buffer = vec![0_u16; 32_768];
    // SAFETY: borrowed file handle stays live and buffer is writable for its length.
    let size = unsafe {
        GetFinalPathNameByHandleW(
            HANDLE(file.as_raw_handle()),
            &mut buffer,
            FILE_NAME_NORMALIZED,
        )
    } as usize;
    if size == 0 || size >= buffer.len() {
        return None;
    }
    buffer.truncate(size);
    Some(buffer)
}

/// Validates embedded Authenticode and returns the exact signing certificate. A missing
/// signature is distinct from a present but invalid/unreadable signature; no online revocation.
fn signer(file: &File, path: &Path) -> Result<Option<Vec<u8>>, ()> {
    use windows::Win32::Security::WinTrust::{
        WINTRUST_ACTION_GENERIC_VERIFY_V2, WINTRUST_DATA, WINTRUST_DATA_0, WINTRUST_FILE_INFO,
        WTD_CACHE_ONLY_URL_RETRIEVAL, WTD_CHOICE_FILE, WTD_REVOKE_NONE, WTD_STATEACTION_CLOSE,
        WTD_STATEACTION_VERIFY, WTD_UI_NONE, WinVerifyTrust,
    };
    let path = HSTRING::from(path.as_os_str());
    let mut info = WINTRUST_FILE_INFO {
        cbStruct: u32::try_from(size_of::<WINTRUST_FILE_INFO>()).map_err(|_| ())?,
        pcwszFilePath: windows::core::PCWSTR(path.as_ptr()),
        hFile: HANDLE(file.as_raw_handle()),
        ..Default::default()
    };
    let mut data = WINTRUST_DATA {
        cbStruct: u32::try_from(size_of::<WINTRUST_DATA>()).map_err(|_| ())?,
        dwUIChoice: WTD_UI_NONE,
        fdwRevocationChecks: WTD_REVOKE_NONE,
        dwUnionChoice: WTD_CHOICE_FILE,
        Anonymous: WINTRUST_DATA_0 {
            pFile: &raw mut info,
        },
        dwStateAction: WTD_STATEACTION_VERIFY,
        dwProvFlags: WTD_CACHE_ONLY_URL_RETRIEVAL,
        ..Default::default()
    };
    let mut action = WINTRUST_ACTION_GENERIC_VERIFY_V2;
    // SAFETY: action, data and file info are initialized and live throughout verification.
    let status =
        unsafe { WinVerifyTrust(HWND::default(), &raw mut action, (&raw mut data).cast()) };
    let result = if status == 0 {
        verified_certificate(data.hWVTStateData).map(Some).ok_or(())
    } else if status == 0x800B_0100_u32.cast_signed() {
        Ok(None)
    } else {
        Err(())
    };
    data.dwStateAction = WTD_STATEACTION_CLOSE;
    // SAFETY: closes only state initialized by the preceding WinVerifyTrust call.
    let _ = unsafe { WinVerifyTrust(HWND::default(), &raw mut action, (&raw mut data).cast()) };
    result
}

fn verified_certificate(state: HANDLE) -> Option<Vec<u8>> {
    use windows::Win32::Security::WinTrust::{
        WTHelperGetProvSignerFromChain, WTHelperProvDataFromStateData,
    };
    // SAFETY: called only with successfully verified live WinTrust state.
    let provider = unsafe { WTHelperProvDataFromStateData(state) };
    if provider.is_null() {
        return None;
    }
    // SAFETY: the provider belongs to the live verification state; signer zero is requested.
    let signer = unsafe { WTHelperGetProvSignerFromChain(provider, 0, false, 0) };
    // SAFETY: null is handled by as_ref; valid signer data lives until state is closed.
    let signer = unsafe { signer.as_ref() }?;
    if signer.csCertChain == 0 {
        return None;
    }
    // SAFETY: csCertChain proves the first chain element exists.
    let cert = unsafe { signer.pasCertChain.as_ref() }?;
    // SAFETY: the chain's certificate context belongs to the live verification state.
    let cert = unsafe { cert.pCert.as_ref() }?;
    let size = usize::try_from(cert.cbCertEncoded).ok()?;
    if cert.pbCertEncoded.is_null() || size == 0 || size > 65_536 {
        return None;
    }
    // SAFETY: the certificate context declares this initialized DER buffer and length.
    Some(unsafe { std::slice::from_raw_parts(cert.pbCertEncoded, size) }.to_vec())
}

#[must_use]
pub fn authorize_agent(pid: u32) -> bool {
    std::env::current_exe()
        .ok()
        .is_some_and(|path| authorize_from(pid, &path))
}

fn authorize_from(pid: u32, service_path: &Path) -> bool {
    use windows::Win32::Globalization::{CSTR_EQUAL, CompareStringOrdinal};
    let check = || -> Option<bool> {
        let expected_path = service_path.parent()?.join("prctr-agent.exe");
        let service = locked_file(service_path)?;
        let expected = locked_file(&expected_path)?;
        let client = image(pid)?;
        let (expected_final, client_final) = (final_path(&expected)?, final_path(&client)?);
        // SAFETY: both bounded wide strings are valid for the duration of comparison.
        if unsafe { CompareStringOrdinal(&expected_final, &client_final, true) } != CSTR_EQUAL {
            return Some(false);
        }
        match trusted_signer(&service, service_path).ok()? {
            None => Some(true),
            Some(own) => Some(
                trusted_signer(&client, &expected_path)
                    .ok()?
                    .is_some_and(|peer| peer == own),
            ),
        }
    };
    check().unwrap_or(false)
}

/// Queries cumulative event loss; the ETW wrapper has no public loss counter.
/// # Errors
/// Returns the bounded ETW query failure.
pub fn events_lost(name: &str) -> Result<u32, OsError> {
    use windows::Win32::System::Diagnostics::Etw::{
        CONTROLTRACE_HANDLE, ControlTraceW, EVENT_TRACE_CONTROL_QUERY, EVENT_TRACE_PROPERTIES,
    };
    #[repr(C)]
    struct Query {
        properties: EVENT_TRACE_PROPERTIES,
        names: [u16; 2048],
    }
    let mut query = Query {
        properties: EVENT_TRACE_PROPERTIES::default(),
        names: [0; 2048],
    };
    query.properties.Wnode.BufferSize = u32::try_from(size_of::<Query>()).unwrap_or(0);
    query.properties.LoggerNameOffset =
        u32::try_from(size_of::<EVENT_TRACE_PROPERTIES>()).unwrap_or(0);
    let name = HSTRING::from(name);
    // SAFETY: properties is the first field in a suitably aligned struct with room for names.
    let status = unsafe {
        ControlTraceW(
            CONTROLTRACE_HANDLE::default(),
            &name,
            &raw mut query.properties,
            EVENT_TRACE_CONTROL_QUERY,
        )
    };
    if status != WIN32_ERROR(0) {
        return Err(OsError {
            operation: "ControlTraceW",
            status: i64::from(status.0),
        });
    }
    Ok(query
        .properties
        .EventsLost
        .saturating_add(query.properties.RealTimeBuffersLost))
}

/// Every WTS session. Query failures never silently become negative facts. A session that ends
/// between enumeration and its queries fails one read, so the read is repeated once.
#[must_use]
pub fn sessions() -> Option<(Option<u32>, Vec<SessionInfo>)> {
    read_sessions().or_else(read_sessions)
}

fn read_sessions() -> Option<(Option<u32>, Vec<SessionInfo>)> {
    use windows::Win32::System::RemoteDesktop::{
        WTS_CURRENT_SERVER_HANDLE, WTSActive, WTSClientProtocolType, WTSDisconnected,
        WTSEnumerateSessionsW, WTSFreeMemory, WTSGetActiveConsoleSessionId, WTSUserName,
    };
    let mut sessions = std::ptr::null_mut();
    let mut count = 0;
    // SAFETY: writable out parameters; WTS owns the allocated result until freed below.
    unsafe {
        WTSEnumerateSessionsW(
            Some(WTS_CURRENT_SERVER_HANDLE),
            0,
            1,
            &raw mut sessions,
            &raw mut count,
        )
    }
    .ok()?;
    let read = || -> Option<Vec<SessionInfo>> {
        let count = usize::try_from(count).ok()?;
        if count > MAX_SESSIONS || (count != 0 && sessions.is_null()) {
            return None;
        }
        let mut result = Vec::with_capacity(count);
        for index in 0..count {
            // SAFETY: WTS initialized exactly count entries; index is within that allocation.
            let pointer = unsafe { sessions.add(index) };
            // SAFETY: this pointer identifies one initialized WTS array element.
            let entry = unsafe { &*pointer };
            let remote =
                super::session::query(entry.SessionId, WTSClientProtocolType, |buffer, size| {
                    if size < 2 || buffer.is_null() {
                        return None;
                    }
                    // SAFETY: WTS provided at least a u16; unaligned read avoids alignment assumptions.
                    Some(unsafe { buffer.cast::<u16>().read_unaligned() } != 0)
                })
                .flatten()?;
            let has_user = super::session::query(entry.SessionId, WTSUserName, |buffer, size| {
                if size < 2 || buffer.is_null() {
                    return None;
                }
                // SAFETY: the first UTF-16 unit is within the WTS allocation.
                Some(unsafe { buffer.cast::<u16>().read_unaligned() } != 0)
            })
            .flatten()?;
            result.push(SessionInfo {
                id: entry.SessionId,
                attachment: if entry.State == WTSActive {
                    Attachment::Active
                } else if entry.State == WTSDisconnected {
                    Attachment::Disconnected
                } else {
                    Attachment::Other
                },
                has_user,
                remote,
                locked: super::session::locked(entry.SessionId),
            });
        }
        Some(result)
    };
    let result = read();
    // SAFETY: frees the one array allocated by WTSEnumerateSessionsW, including on read failure.
    unsafe { WTSFreeMemory(sessions.cast()) };
    // SAFETY: console session lookup has no preconditions.
    let console = unsafe { WTSGetActiveConsoleSessionId() };
    Some(((console != u32::MAX).then_some(console), result?))
}

/// Console-only lifecycle, used by SYSTEM acceptance runs. No stdin is required.
/// # Errors
/// Returns a console-handler registration or ownership error.
pub fn console_stop() -> std::io::Result<std::sync::mpsc::Receiver<()>> {
    use std::sync::{Mutex, OnceLock, mpsc};
    use windows::Win32::System::Console::SetConsoleCtrlHandler;
    static STOP: OnceLock<Mutex<Option<mpsc::Sender<()>>>> = OnceLock::new();
    unsafe extern "system" fn handler(kind: u32) -> windows::core::BOOL {
        if !matches!(kind, 0 | 1 | 2 | 5 | 6) {
            return false.into();
        }
        if let Some(sender) = STOP
            .get()
            .and_then(|state| state.lock().ok())
            .and_then(|state| state.clone())
        {
            let _ = sender.send(());
            return true.into();
        }
        false.into()
    }
    let (sender, receiver) = mpsc::channel();
    let slot = STOP.get_or_init(|| Mutex::new(None));
    *slot.lock().map_err(|_| std::io::ErrorKind::Other)? = Some(sender);
    // SAFETY: handler is a process-lifetime function, catches supported console shutdown events.
    unsafe { SetConsoleCtrlHandler(Some(handler), true) }.map_err(std::io::Error::from)?;
    Ok(receiver)
}

struct CatalogAdmin(isize);
impl Drop for CatalogAdmin {
    fn drop(&mut self) {
        // SAFETY: owns the one acquired catalog administration context.
        let _ = unsafe {
            windows::Win32::Security::Cryptography::Catalog::CryptCATAdminReleaseContext(self.0, 0)
        };
    }
}

/// Verifies catalog membership against the opened file, not merely the catalog's own signature.
fn catalog_signer(file: &File, path: &Path) -> Result<Option<Vec<u8>>, ()> {
    let mut failed = false;
    for algorithm in ["SHA256", "SHA1"] {
        match catalog_signer_with(file, path, algorithm) {
            Ok(Some(certificate)) => return Ok(Some(certificate)),
            Ok(None) => {}
            Err(()) => failed = true,
        }
    }
    if failed { Err(()) } else { Ok(None) }
}

fn trusted_signer(file: &File, path: &Path) -> Result<Option<Vec<u8>>, ()> {
    match signer(file, path)? {
        Some(certificate) => Ok(Some(certificate)),
        None => catalog_signer(file, path),
    }
}

fn catalog_signer_with(file: &File, path: &Path, algorithm: &str) -> Result<Option<Vec<u8>>, ()> {
    use windows::Win32::Security::Cryptography::Catalog::{
        CryptCATAdminAcquireContext2, CryptCATAdminCalcHashFromFileHandle2,
        CryptCATAdminEnumCatalogFromHash, CryptCATAdminReleaseCatalogContext,
    };
    let mut reader = file;
    std::io::Seek::rewind(&mut reader).map_err(|_| ())?;
    let algorithm = HSTRING::from(algorithm);
    let mut admin = 0;
    // SAFETY: writable context output; selects one of the two literal catalog hash algorithms.
    unsafe { CryptCATAdminAcquireContext2(&raw mut admin, None, &algorithm, None, None) }
        .map_err(|_| ())?;
    let admin = CatalogAdmin(admin);
    let mut size = 0;
    // SAFETY: queries required hash size for the borrowed file handle and live context.
    unsafe {
        CryptCATAdminCalcHashFromFileHandle2(
            admin.0,
            HANDLE(file.as_raw_handle()),
            &raw mut size,
            None,
            None,
        )
    }
    .map_err(|_| ())?;
    if size == 0 || size > 128 {
        return Err(());
    }
    let mut hash = vec![0_u8; size as usize];
    // SAFETY: hash is writable for the previously reported size, context and file remain live.
    unsafe {
        CryptCATAdminCalcHashFromFileHandle2(
            admin.0,
            HANDLE(file.as_raw_handle()),
            &raw mut size,
            Some(hash.as_mut_ptr()),
            None,
        )
    }
    .map_err(|_| ())?;
    hash.truncate(usize::try_from(size).map_err(|_| ())?);
    // One installed matching catalog is sufficient only when full member verification succeeds.
    // No match is unsigned, while a matching but invalid catalog is unavailable.
    // SAFETY: hash is initialized and bounded; the returned context is owned by this function.
    let catalog = unsafe { CryptCATAdminEnumCatalogFromHash(admin.0, &hash, None, None) };
    if catalog == 0 {
        return Ok(None);
    }
    let result = verify_catalog(file, path, admin.0, catalog, &hash).map(Some);
    // SAFETY: releases the one enumerated catalog before its administration context is dropped.
    let _ = unsafe { CryptCATAdminReleaseCatalogContext(admin.0, catalog, 0) };
    result
}

fn verify_catalog(
    file: &File,
    path: &Path,
    admin: isize,
    catalog: isize,
    hash: &[u8],
) -> Result<Vec<u8>, ()> {
    use windows::Win32::Security::Cryptography::Catalog::{
        CATALOG_INFO, CryptCATCatalogInfoFromContext,
    };
    use windows::Win32::Security::WinTrust::{
        WINTRUST_ACTION_GENERIC_VERIFY_V2, WINTRUST_CATALOG_INFO, WINTRUST_DATA, WINTRUST_DATA_0,
        WTD_CACHE_ONLY_URL_RETRIEVAL, WTD_CHOICE_CATALOG, WTD_REVOKE_NONE, WTD_STATEACTION_CLOSE,
        WTD_STATEACTION_VERIFY, WTD_UI_NONE, WinVerifyTrust,
    };
    let mut info = CATALOG_INFO {
        cbStruct: u32::try_from(size_of::<CATALOG_INFO>()).map_err(|_| ())?,
        ..Default::default()
    };
    // SAFETY: catalog is live and info is a correctly sized writable output.
    unsafe { CryptCATCatalogInfoFromContext(catalog, &raw mut info, 0) }.map_err(|_| ())?;
    let end = info
        .wszCatalogFile
        .iter()
        .position(|unit| *unit == 0)
        .ok_or(())?;
    let catalog_path = HSTRING::from_wide(&info.wszCatalogFile[..end]);
    let mut tag = String::with_capacity(hash.len() * 2);
    for byte in hash {
        write!(tag, "{byte:02X}").map_err(|_| ())?;
    }
    let tag = HSTRING::from(tag);
    let member = HSTRING::from(path.as_os_str());
    let mut info = WINTRUST_CATALOG_INFO {
        cbStruct: u32::try_from(size_of::<WINTRUST_CATALOG_INFO>()).map_err(|_| ())?,
        pcwszCatalogFilePath: windows::core::PCWSTR(catalog_path.as_ptr()),
        pcwszMemberTag: windows::core::PCWSTR(tag.as_ptr()),
        pcwszMemberFilePath: windows::core::PCWSTR(member.as_ptr()),
        hMemberFile: HANDLE(file.as_raw_handle()),
        pbCalculatedFileHash: hash.as_ptr().cast_mut(),
        cbCalculatedFileHash: u32::try_from(hash.len()).map_err(|_| ())?,
        hCatAdmin: admin,
        ..Default::default()
    };
    let mut data = WINTRUST_DATA {
        cbStruct: u32::try_from(size_of::<WINTRUST_DATA>()).map_err(|_| ())?,
        dwUIChoice: WTD_UI_NONE,
        fdwRevocationChecks: WTD_REVOKE_NONE,
        dwUnionChoice: WTD_CHOICE_CATALOG,
        Anonymous: WINTRUST_DATA_0 {
            pCatalog: &raw mut info,
        },
        dwStateAction: WTD_STATEACTION_VERIFY,
        dwProvFlags: WTD_CACHE_ONLY_URL_RETRIEVAL,
        ..Default::default()
    };
    let mut action = WINTRUST_ACTION_GENERIC_VERIFY_V2;
    // SAFETY: all catalog/member fields and their backing strings live through verification.
    let status =
        unsafe { WinVerifyTrust(HWND::default(), &raw mut action, (&raw mut data).cast()) };
    let result = if status == 0 {
        verified_certificate(data.hWVTStateData).ok_or(())
    } else {
        Err(())
    };
    data.dwStateAction = WTD_STATEACTION_CLOSE;
    // SAFETY: closes only the state created by the preceding verification call.
    let _ = unsafe { WinVerifyTrust(HWND::default(), &raw mut action, (&raw mut data).cast()) };
    result
}

fn publisher(der: &[u8]) -> Option<String> {
    use windows::Win32::Security::Cryptography::{
        CERT_NAME_SIMPLE_DISPLAY_TYPE, CertCreateCertificateContext, CertFreeCertificateContext,
        CertGetNameStringW, X509_ASN_ENCODING,
    };
    // SAFETY: der is the complete bounded certificate copied from verified WinTrust state.
    let context = unsafe { CertCreateCertificateContext(X509_ASN_ENCODING, der) };
    if context.is_null() {
        return None;
    }
    let mut name = [0_u16; 513];
    // SAFETY: context is live; name is writable for its declared length.
    let size = unsafe {
        CertGetNameStringW(
            context,
            CERT_NAME_SIMPLE_DISPLAY_TYPE,
            0,
            None,
            Some(&mut name),
        )
    } as usize;
    // SAFETY: releases the one owned certificate context.
    let _ = unsafe { CertFreeCertificateContext(Some(context)) };
    if size < 2 || size >= name.len() {
        return None;
    }
    String::from_utf16(&name[..size - 1]).ok()
}

fn original_file_name(path: &Path) -> Option<String> {
    use windows::Win32::Storage::FileSystem::{
        GetFileVersionInfoSizeW, GetFileVersionInfoW, VerQueryValueW,
    };
    let path = HSTRING::from(path.as_os_str());
    // SAFETY: live NUL-terminated path; no obsolete handle output is needed.
    let size = unsafe { GetFileVersionInfoSizeW(&path, None) };
    if size == 0 || size > 1_048_576 {
        return None;
    }
    let mut bytes = vec![0_u8; size as usize];
    // SAFETY: bytes is writable for the reported version-resource size.
    unsafe { GetFileVersionInfoW(&path, None, size, bytes.as_mut_ptr().cast()) }.ok()?;
    let query = |name: &HSTRING| -> Option<&[u8]> {
        let mut pointer = std::ptr::null_mut();
        let mut length = 0;
        // SAFETY: bytes is a complete version block; outputs are writable; name is NUL terminated.
        if !unsafe {
            VerQueryValueW(
                bytes.as_ptr().cast(),
                name,
                &raw mut pointer,
                &raw mut length,
            )
        }
        .as_bool()
            || pointer.is_null()
        {
            return None;
        }
        let offset = (pointer as usize).checked_sub(bytes.as_ptr() as usize)?;
        // String lengths are UTF-16 units, while the translation block length is bytes.
        let length = usize::try_from(length).ok()?;
        let is_translation = name == &HSTRING::from(r"\VarFileInfo\Translation");
        let length = if is_translation {
            length
        } else {
            length.checked_mul(2)?
        };
        bytes.get(offset..offset.checked_add(length)?)
    };
    let translations = query(&HSTRING::from(r"\VarFileInfo\Translation"))?;
    for pair in translations.chunks_exact(4).take(32) {
        let language = u16::from_le_bytes([pair[0], pair[1]]);
        let codepage = u16::from_le_bytes([pair[2], pair[3]]);
        let key = HSTRING::from(format!(
            r"\StringFileInfo\{language:04x}{codepage:04x}\OriginalFilename"
        ));
        let Some(value) = query(&key) else {
            continue;
        };
        if value.len() > 1026 {
            continue;
        }
        let wide: Vec<u16> = value
            .chunks_exact(2)
            .map(|unit| u16::from_le_bytes([unit[0], unit[1]]))
            .take_while(|unit| *unit != 0)
            .collect();
        let text = String::from_utf16(&wide).ok()?;
        if !text.is_empty() && !text.contains(['\\', '/', ':']) {
            return Some(text);
        }
    }
    None
}

#[must_use]
pub fn identify(pid: u32) -> crate::RawIdentity {
    let identify = || -> Option<crate::RawIdentity> {
        let file = image(pid)?;
        let path = std::path::PathBuf::from(std::ffi::OsString::from_wide(&final_path(&file)?));
        let certificate = trusted_signer(&file, &path).ok()?;
        let Some(certificate) = certificate else {
            return Some(crate::RawIdentity::Unsigned);
        };
        Some(crate::RawIdentity::Windows {
            publisher: publisher(&certificate)?,
            original_file_name: original_file_name(&path)?,
        })
    };
    identify().unwrap_or(crate::RawIdentity::Unavailable)
}

#[cfg(test)]
mod tests {
    use std::time::Duration;
    #[test]
    #[ignore = "Child process target for the installed-path authorization test"]
    fn peer_wait() {
        std::thread::park_timeout(Duration::from_secs(20));
    }

    #[test]
    fn a_real_agent_path_is_accepted_and_an_identical_copy_elsewhere_is_refused() {
        let own = std::env::current_exe().expect("test executable");
        let directory =
            std::env::temp_dir().join(format!("prctr-peer-test-{}", std::process::id()));
        std::fs::create_dir_all(directory.join("elsewhere")).expect("test directory");
        let service = directory.join("prctr-helper.exe");
        std::fs::copy(&own, &service).expect("service fixture");
        for (path, allowed) in [
            (directory.join("prctr-agent.exe"), true),
            (directory.join("elsewhere/prctr-agent.exe"), false),
        ] {
            std::fs::copy(&own, &path).expect("agent fixture");
            let mut child = std::process::Command::new(&path)
                .args(["--ignored", "--exact", "windows::helper::tests::peer_wait"])
                .stdout(std::process::Stdio::null())
                .spawn()
                .expect("fixture agent");
            let authorized = super::authorize_from(child.id(), &service);
            let _ = child.kill();
            let _ = child.wait();
            assert_eq!(authorized, allowed);
        }
        std::fs::remove_dir_all(directory).expect("remove test fixtures");
    }
}
