//! Immutable, installer/setup-provisioned code closure for controlled Windows launch.
//! Ordinary mutable Squirrel paths cannot satisfy this proof by assertion.
use std::collections::BTreeSet;
use std::fs::{File, OpenOptions};
use std::mem;
use std::os::windows::fs::OpenOptionsExt;
use std::os::windows::io::AsRawHandle;
use std::path::{Component, Path, PathBuf, Prefix};
use std::ptr;
use std::time::Instant;

use crate::{HelperTransportError, WindowsLaunchManifest, ensure_helper_utility_usable, remaining};
use windows_sys::Win32::Foundation::LocalFree;
use windows_sys::Win32::Security::Authorization::{
    ConvertStringSecurityDescriptorToSecurityDescriptorW, GetSecurityInfo, SDDL_REVISION_1,
    SE_FILE_OBJECT,
};
use windows_sys::Win32::Security::{
    ACL, DACL_SECURITY_INFORMATION, GetSecurityDescriptorControl, GetSecurityDescriptorDacl,
    GetSecurityDescriptorLength, IsWellKnownSid, OWNER_SECURITY_INFORMATION, SE_DACL_PRESENT,
    SE_DACL_PROTECTED, WinBuiltinAdministratorsSid, WinLocalSystemSid,
};
use windows_sys::Win32::Storage::FileSystem::{
    FILE_ATTRIBUTE_DIRECTORY, FILE_ATTRIBUTE_REPARSE_POINT, FILE_ATTRIBUTE_TAG_INFO,
    FILE_FLAG_BACKUP_SEMANTICS, FILE_FLAG_OPEN_REPARSE_POINT, FILE_SHARE_READ, FILE_SHARE_WRITE,
    FileAttributeTagInfo, GetFileInformationByHandleEx,
};

const ROOT_SDDL: &str = "D:P(A;OICI;FA;;;SY)(A;OICI;FA;;;BA)(A;OICI;FRFX;;;AU)";
const MAX_ACL_BYTES: usize = 4_096;
const MAX_DESCRIPTOR_BYTES: usize = 65_536;

/// Constructed only after all manifest files and the protected path are verified.
/// Keep this owner for the entire controlled process lifetime, including cleanup.
pub struct WindowsProtectedLaunchClosure {
    executable: PathBuf,
    root: PathBuf,
    _directory_locks: Vec<File>,
    _file_locks: Vec<File>,
}
impl WindowsProtectedLaunchClosure {
    /// root is a trusted installer/setup destination, not an incoming request path.
    /// Provision every directory with the exact protected SYSTEM/admin-write,
    /// authenticated-user read/execute ACL. Every active version is immutable; updates use a new root.
    /// Run under the launch owner's one absolute deadline in a killable worker.
    /// # Errors
    /// Rejects mutable or reparse roots, unlisted files, changed digests, missing
    /// signature, incomplete inventories, expired budgets, or SDK cleanup failure.
    pub fn open(
        root: &Path,
        manifest: &WindowsLaunchManifest,
        deadline: Instant,
    ) -> Result<Self, HelperTransportError> {
        remaining(deadline)?;
        ensure_helper_utility_usable()?;
        let mut directories = lock_ancestors(root, deadline)?;
        verify_root_acl(
            directories
                .last()
                .ok_or(HelperTransportError::ExecutableIdentity)?,
        )?;
        let expected = manifest
            .files()
            .iter()
            .map(|file| file.relative_path.to_ascii_lowercase())
            .collect::<BTreeSet<_>>();
        let mut discovered = BTreeSet::new();
        let mut pending = vec![root.to_owned()];
        while let Some(directory) = pending.pop() {
            remaining(deadline)?;
            for entry in std::fs::read_dir(directory)? {
                remaining(deadline)?;
                let path = entry?.path();
                let relative = path
                    .strip_prefix(root)
                    .map_err(|_| HelperTransportError::ExecutableIdentity)?;
                let name = relative
                    .iter()
                    .map(|part| {
                        part.to_str()
                            .ok_or(HelperTransportError::ExecutableIdentity)
                    })
                    .collect::<Result<Vec<_>, _>>()?
                    .join("/")
                    .to_ascii_lowercase();
                // Only paths named by the release inventory or their exact parent
                // directories are admitted. No opportunistic runtime code roots.
                if expected
                    .iter()
                    .any(|file| file.starts_with(&(name.clone() + "/")))
                {
                    let lock = lock_directory(&path)?;
                    verify_root_acl(&lock)?;
                    directories.push(lock);
                    if directories.len() > 4_352 {
                        return Err(HelperTransportError::ExecutableIdentity);
                    }
                    pending.push(path);
                } else if expected.contains(&name) && discovered.insert(name) {
                    let file = open_file(&path)?;
                    if attributes(&file)? & FILE_ATTRIBUTE_DIRECTORY != 0 {
                        return Err(HelperTransportError::ExecutableIdentity);
                    }
                } else {
                    return Err(HelperTransportError::ExecutableIdentity);
                }
            }
        }
        if discovered != expected {
            return Err(HelperTransportError::ExecutableIdentity);
        }
        let mut files = Vec::with_capacity(manifest.files().len());
        for entry in manifest.files() {
            remaining(deadline)?;
            let path = root.join(&entry.relative_path);
            let file = open_file(&path)?;
            if file.metadata()?.len() != entry.bytes {
                return Err(HelperTransportError::ExecutableIdentity);
            }
            crate::windows::file_matches_digest(&file, &entry.sha256, entry.bytes)?;
            files.push(file);
        }
        let executable = root.join(manifest.executable());
        let entry = manifest
            .files()
            .iter()
            .find(|entry| {
                entry
                    .relative_path
                    .eq_ignore_ascii_case(manifest.executable())
            })
            .ok_or(HelperTransportError::ExecutableIdentity)?;
        files.push(crate::windows::lock_and_verify_executable_bounded(
            &executable,
            &entry.sha256,
            entry.bytes,
        )?);
        remaining(deadline)?;
        ensure_helper_utility_usable()?;
        Ok(Self {
            executable,
            root: root.to_owned(),
            _directory_locks: directories,
            _file_locks: files,
        })
    }
    pub(super) fn executable(&self) -> &Path {
        &self.executable
    }
    pub(super) fn root(&self) -> &Path {
        &self.root
    }
}

fn lock_ancestors(root: &Path, deadline: Instant) -> Result<Vec<File>, HelperTransportError> {
    let mut parts = root.components();
    let Some(Component::Prefix(prefix)) = parts.next() else {
        return Err(HelperTransportError::ExecutableIdentity);
    };
    if !matches!(prefix.kind(), Prefix::Disk(_)) || parts.next() != Some(Component::RootDir) {
        return Err(HelperTransportError::ExecutableIdentity);
    }
    let mut path = PathBuf::from(prefix.as_os_str());
    path.push(std::path::MAIN_SEPARATOR_STR);
    let mut locks = vec![lock_directory(&path)?];
    for component in parts {
        remaining(deadline)?;
        let Component::Normal(name) = component else {
            return Err(HelperTransportError::ExecutableIdentity);
        };
        path.push(name);
        locks.push(lock_directory(&path)?);
        if locks.len() > 256 {
            return Err(HelperTransportError::ExecutableIdentity);
        }
    }
    if locks.len() < 3 {
        return Err(HelperTransportError::ExecutableIdentity);
    }
    Ok(locks)
}
fn lock_directory(path: &Path) -> Result<File, HelperTransportError> {
    let file = OpenOptions::new()
        .read(true)
        .share_mode(FILE_SHARE_READ | FILE_SHARE_WRITE)
        .custom_flags(FILE_FLAG_BACKUP_SEMANTICS | FILE_FLAG_OPEN_REPARSE_POINT)
        .open(path)?;
    if attributes(&file)? & FILE_ATTRIBUTE_DIRECTORY == 0 {
        return Err(HelperTransportError::ExecutableIdentity);
    }
    Ok(file)
}
fn open_file(path: &Path) -> Result<File, HelperTransportError> {
    let file = OpenOptions::new()
        .read(true)
        .share_mode(FILE_SHARE_READ)
        .custom_flags(FILE_FLAG_OPEN_REPARSE_POINT)
        .open(path)?;
    if attributes(&file)? & FILE_ATTRIBUTE_DIRECTORY != 0 {
        return Err(HelperTransportError::ExecutableIdentity);
    }
    Ok(file)
}
fn attributes(file: &File) -> Result<u32, HelperTransportError> {
    let mut info = FILE_ATTRIBUTE_TAG_INFO::default();
    // SAFETY: retained file and fixed SDK-sized output buffer.
    if unsafe {
        GetFileInformationByHandleEx(
            file.as_raw_handle().cast(),
            FileAttributeTagInfo,
            (&raw mut info).cast(),
            u32::try_from(mem::size_of_val(&info)).expect("fixed file information"),
        )
    } == 0
        || info.FileAttributes & FILE_ATTRIBUTE_REPARSE_POINT != 0
    {
        return Err(HelperTransportError::ExecutableIdentity);
    }
    Ok(info.FileAttributes)
}

struct Descriptor(*mut core::ffi::c_void);
impl Drop for Descriptor {
    fn drop(&mut self) {
        // SAFETY: successful SDK descriptor allocation remains owned here.
        let length = unsafe { GetSecurityDescriptorLength(self.0) } as usize;
        if length > MAX_DESCRIPTOR_BYTES {
            crate::poison_helper_utility();
        } else {
            for offset in 0..length {
                unsafe {
                    ptr::write_volatile(self.0.cast::<u8>().add(offset), 0);
                }
            }
        }
        if !unsafe { LocalFree(self.0) }.is_null() {
            crate::poison_helper_utility();
        }
    }
}
fn verify_root_acl(root: &File) -> Result<(), HelperTransportError> {
    let mut descriptor = ptr::null_mut();
    let mut owner = ptr::null_mut();
    let mut acl = ptr::null_mut();
    // SAFETY: exact retained root handle and owned descriptor output.
    if unsafe {
        GetSecurityInfo(
            root.as_raw_handle().cast(),
            SE_FILE_OBJECT,
            OWNER_SECURITY_INFORMATION | DACL_SECURITY_INFORMATION,
            &raw mut owner,
            ptr::null_mut(),
            &raw mut acl,
            ptr::null_mut(),
            &raw mut descriptor,
        )
    } != 0
    {
        return Err(HelperTransportError::ExecutableIdentity);
    }
    if descriptor.is_null() {
        return Err(HelperTransportError::ExecutableIdentity);
    }
    let descriptor = Descriptor(descriptor);
    let mut control = 0;
    let mut revision = 0;
    if owner.is_null()
        || acl.is_null()
        || unsafe {
            GetSecurityDescriptorControl(descriptor.0, &raw mut control, &raw mut revision)
        } == 0
        || control & (SE_DACL_PRESENT | SE_DACL_PROTECTED) != SE_DACL_PRESENT | SE_DACL_PROTECTED
        || (unsafe { IsWellKnownSid(owner, WinLocalSystemSid) } == 0
            && unsafe { IsWellKnownSid(owner, WinBuiltinAdministratorsSid) } == 0)
    {
        return Err(HelperTransportError::ExecutableIdentity);
    }
    let sddl: Vec<_> = ROOT_SDDL.encode_utf16().chain([0]).collect();
    let mut expected = ptr::null_mut();
    if unsafe {
        ConvertStringSecurityDescriptorToSecurityDescriptorW(
            sddl.as_ptr(),
            SDDL_REVISION_1,
            &raw mut expected,
            ptr::null_mut(),
        )
    } == 0
    {
        return Err(HelperTransportError::ExecutableIdentity);
    }
    let expected = Descriptor(expected);
    let mut expected_acl = ptr::null_mut();
    let mut present = 0;
    let mut defaulted = 0;
    if unsafe {
        GetSecurityDescriptorDacl(
            expected.0,
            &raw mut present,
            &raw mut expected_acl,
            &raw mut defaulted,
        )
    } == 0
        || present == 0
        || expected_acl.is_null()
    {
        return Err(HelperTransportError::ExecutableIdentity);
    }
    // SAFETY: SDK returned validated allocated ACL structures. Refuse oversized
    // ACLs before constructing bounded slices; compare the exact fixed policy.
    let length = unsafe { (*acl).AclSize } as usize;
    let expected_length = unsafe { (*expected_acl).AclSize } as usize;
    if length < mem::size_of::<ACL>() || length > MAX_ACL_BYTES || length != expected_length {
        return Err(HelperTransportError::ExecutableIdentity);
    }
    if unsafe {
        std::slice::from_raw_parts(acl.cast::<u8>(), length)
            != std::slice::from_raw_parts(expected_acl.cast::<u8>(), length)
    } {
        return Err(HelperTransportError::ExecutableIdentity);
    }
    drop(expected);
    drop(descriptor);
    ensure_helper_utility_usable()
}
