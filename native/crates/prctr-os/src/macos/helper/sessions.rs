use crate::helper::{Attachment, MAX_PROCESSES, MAX_SESSIONS, SessionInfo};
use objc2_core_foundation::{CFArray, CFBoolean, CFDictionary, CFNumber, CFString, CFType};
use objc2_io_kit::{
    IOObjectRelease, IORegistryEntryCreateCFProperty, IORegistryGetRootEntry, kIOMainPortDefault,
};

#[repr(C)]
#[derive(Clone, Copy)]
struct Fd {
    fd: i32,
    kind: u32,
}

pub struct ConsoleSession {
    pub user_key: u64,
    pub info: SessionInfo,
}

fn value<'a>(dictionary: &'a CFDictionary, key: &'static str) -> Option<&'a CFType> {
    let key = CFString::from_static_str(key);
    // SAFETY: IOConsoleUsers dictionaries have CFString keys and CFType values.
    let value = unsafe { dictionary.value(std::ptr::from_ref::<CFString>(&key).cast()) };
    // SAFETY: values belong to the live dictionary; null is handled by as_ref.
    unsafe { value.cast::<CFType>().as_ref() }
}
fn number(dictionary: &CFDictionary, key: &'static str) -> Option<u32> {
    let mut result = 0_i64;
    let number = value(dictionary, key)?.downcast_ref::<CFNumber>()?;
    // SAFETY: result is writable for the requested signed 64-bit number type.
    if !unsafe {
        number.value(
            objc2_core_foundation::CFNumberType::SInt64Type,
            (&raw mut result).cast(),
        )
    } {
        return None;
    }
    u32::try_from(result).ok()
}
fn boolean(dictionary: &CFDictionary, key: &'static str) -> Option<bool> {
    value(dictionary, key)?
        .downcast_ref::<CFBoolean>()
        .map(CFBoolean::as_bool)
}

#[must_use]
pub fn initial_sessions() -> Option<(Option<u32>, Vec<ConsoleSession>)> {
    // SAFETY: returns a new registry entry reference for the default IOKit port.
    let root = unsafe { IORegistryGetRootEntry(kIOMainPortDefault) };
    if root == 0 {
        return None;
    }
    let key = CFString::from_static_str("IOConsoleUsers");
    // SAFETY: root and key are live, and the copy result is owned.
    let users = unsafe { IORegistryEntryCreateCFProperty(root, Some(&key), None, 0) };
    let lock_key = CFString::from_static_str("IOConsoleLocked");
    // SAFETY: root and the immutable lock property key remain live.
    let locked = unsafe { IORegistryEntryCreateCFProperty(root, Some(&lock_key), None, 0) };
    let console_locked = locked
        .as_ref()
        .and_then(|value| value.downcast_ref::<CFBoolean>())
        .map(CFBoolean::as_bool);
    let _ = IOObjectRelease(root);
    let users = users?;
    let users = users.downcast_ref::<CFArray>()?;
    let count = users.len();
    if count > MAX_SESSIONS {
        return None;
    }
    let mut console = None;
    let mut result = Vec::new();
    for index in 0..count {
        // SAFETY: index is within this immutable array's length.
        let raw = unsafe { users.value_at_index(isize::try_from(index).ok()?) };
        // SAFETY: IOConsoleUsers elements are CFType objects; null is handled.
        let object = unsafe { raw.cast::<CFType>().as_ref() }?;
        let dictionary = object.downcast_ref::<CFDictionary>()?;
        let id = number(dictionary, "kCGSSessionAuditIDKey")?;
        let user = value(dictionary, "kCGSSessionUserNameKey")
            .or_else(|| value(dictionary, "kCGSessionOnUserNameKey"))?
            .downcast_ref::<CFString>()?;
        if user.length() > 512 {
            return None;
        }
        let user = user.to_string();
        let has_user = !user.is_empty();
        let user_key = crate::fingerprint(user.as_bytes());
        let on_console = boolean(dictionary, "kCGSSessionOnConsoleKey")?;
        if on_console {
            console = Some(id);
        }
        result.push(ConsoleSession {
            user_key,
            info: SessionInfo {
                id,
                attachment: if on_console {
                    Attachment::Active
                } else {
                    Attachment::Disconnected
                },
                has_user,
                remote: false,
                locked: boolean(dictionary, "CGSSessionScreenIsLocked")
                    .or_else(|| on_console.then_some(console_locked).flatten()),
            },
        });
    }
    Some((console, result))
}

/// Established TCP on local ports 5900/3283, owned by macOS's own remote-management daemons, is
/// the initial screen-sharing signal. Only those daemons' descriptors are read (third-party
/// remote tools are application-rule matters). No addresses, peer identity or connection content
/// are retained.
/// The macOS remote-management bundle that holds `screensharingd` and `ARDAgent`.
const REMOTE_MANAGEMENT: &[u8] = b"/System/Library/CoreServices/RemoteManagement/";

/// Whether `pid` runs an executable from macOS's remote-management bundle.
fn remote_management(pid: i32) -> bool {
    let mut path = [0_u8; libc::PROC_PIDPATHINFO_MAXSIZE as usize];
    let Ok(capacity) = u32::try_from(path.len()) else {
        return false;
    };
    // SAFETY: path is writable for capacity bytes; the call writes at most that many.
    let length = unsafe { libc::proc_pidpath(pid, path.as_mut_ptr().cast(), capacity) };
    usize::try_from(length)
        .ok()
        .and_then(|length| path.get(..length))
        .is_some_and(|path| path.starts_with(REMOTE_MANAGEMENT))
}

#[must_use]
pub fn screen_sharing() -> Option<bool> {
    let mut pids = vec![0_i32; MAX_PROCESSES];
    // SAFETY: pids is writable for the supplied bounded byte length.
    let count = unsafe {
        libc::proc_listallpids(
            pids.as_mut_ptr().cast(),
            i32::try_from(pids.len() * 4).ok()?,
        )
    };
    let count = usize::try_from(count).ok()?;
    if count == 0 || count >= pids.len() {
        return None;
    }
    let mut descriptors = vec![Fd { fd: 0, kind: 0 }; 8192];
    for &pid in &pids[..count] {
        if pid <= 0 || !remote_management(pid) {
            continue;
        }
        let capacity = i32::try_from(descriptors.len() * size_of::<Fd>()).ok()?;
        // SAFETY: descriptors is writable with the public proc_fdinfo layout and byte capacity.
        let bytes = unsafe {
            libc::proc_pidinfo(
                pid,
                libc::PROC_PIDLISTFDS,
                0,
                descriptors.as_mut_ptr().cast(),
                capacity,
            )
        };
        if bytes == 0 {
            continue;
        }
        if bytes < 0 {
            if matches!(
                std::io::Error::last_os_error().raw_os_error(),
                Some(libc::ESRCH | libc::ENOENT)
            ) {
                continue;
            }
            return None;
        }
        if bytes >= capacity || usize::try_from(bytes).ok()? % size_of::<Fd>() != 0 {
            return None;
        }
        for fd in descriptors
            .iter()
            .take(usize::try_from(bytes).ok()? / size_of::<Fd>())
            .filter(|fd| fd.kind == 2)
        {
            // Public socket_fdinfo ABI from sys/proc_info.h (arm64 and x86_64). Decode only the
            // four scalar fields we need, after an exact-size write. No address fields are read.
            let mut record = [0_u8; 792];
            // SAFETY: record is writable for the public PROC_PIDFDSOCKETINFO_SIZE (792).
            let bytes =
                unsafe { libc::proc_pidfdinfo(pid, fd.fd, 3, record.as_mut_ptr().cast(), 792) };
            if bytes != 792 {
                if matches!(
                    std::io::Error::last_os_error().raw_os_error(),
                    Some(libc::ESRCH | libc::ENOENT | libc::EBADF)
                ) {
                    continue;
                }
                return None;
            }
            let scalar = |offset: usize| {
                i32::from_ne_bytes(record[offset..offset + 4].try_into().unwrap_or([0; 4]))
            };
            if scalar(180) == libc::IPPROTO_TCP && scalar(256) == 2 && scalar(344) == 4 {
                let port = u16::from_be(u16::try_from(scalar(268)).ok()?);
                if matches!(port, 5900 | 3283) {
                    return Some(true);
                }
            }
        }
    }
    Some(false)
}
