//! Root daemon OS wrappers. Sensitive records are reduced before crossing this module.
mod events;
mod sessions;
mod transport;

pub use events::{Event, Watch, watch};
pub use sessions::{ConsoleSession, initial_sessions, screen_sharing};
pub use transport::{
    Registration, activate_socket, authorize_agent, peer_token, peer_uid, registration,
    wait_for_stop,
};

use crate::helper::{MAX_PROCESSES, ProcessStart, timeval_to_unix};

#[must_use]
pub fn is_root() -> bool {
    // SAFETY: geteuid has no preconditions.
    unsafe { libc::geteuid() == 0 }
}

// libc does not bind auditon or its records. These are the public bsm/audit.h layouts.
#[repr(C)]
#[derive(Default)]
struct AuditProcess {
    pid: i32,
    uid: u32,
    mask: [u32; 2],
    terminal: [u32; 6],
    session: i32,
    flags: u64,
}
#[link(name = "bsm")]
unsafe extern "C" {
    fn auditon(command: i32, data: *mut std::ffi::c_void, size: i32) -> i32;
}

#[must_use]
pub fn process_session(pid: u32) -> Option<u32> {
    let mut data = AuditProcess {
        pid: i32::try_from(pid).ok()?,
        ..Default::default()
    };
    // SAFETY: A_GETPINFO_ADDR (28) fills the sized public auditpinfo_addr record.
    if unsafe {
        auditon(
            28,
            (&raw mut data).cast(),
            i32::try_from(size_of::<AuditProcess>()).ok()?,
        )
    } != 0
    {
        return None;
    }
    Some(normalize_session(data.session.cast_unsigned()))
}

// The default, unauthenticated audit session is used by system daemons. Never fold a
// different user's authenticated audit session into this system scope.
fn normalize_session(session: u32) -> u32 {
    if session == u32::MAX { 0 } else { session }
}

/// Whether `pid` no longer names a process.
fn exited(pid: u32) -> bool {
    let Ok(pid) = i32::try_from(pid) else {
        return true;
    };
    // SAFETY: signal 0 only checks that the process exists; nothing is delivered.
    let alive = unsafe { libc::kill(pid, 0) } == 0;
    !alive && std::io::Error::last_os_error().raw_os_error() == Some(libc::ESRCH)
}

#[must_use]
pub fn snapshot() -> Option<Vec<ProcessStart>> {
    let mut pids = vec![0_i32; MAX_PROCESSES];
    let bytes = i32::try_from(pids.len() * size_of::<i32>()).ok()?;
    // SAFETY: pids is writable for bytes bytes; proc_listallpids returns a PID count.
    let count =
        usize::try_from(unsafe { libc::proc_listallpids(pids.as_mut_ptr().cast(), bytes) }).ok()?;
    if count == 0 || count >= pids.len() {
        return None;
    }
    let mut result = Vec::with_capacity(count);
    for &pid in &pids[..count] {
        if pid <= 0 {
            continue;
        }
        let mut info = std::mem::MaybeUninit::<libc::proc_bsdinfo>::zeroed();
        let size = i32::try_from(size_of::<libc::proc_bsdinfo>()).ok()?;
        // SAFETY: info is writable for size bytes with the PROC_PIDTBSDINFO layout.
        if unsafe {
            libc::proc_pidinfo(
                pid,
                libc::PROC_PIDTBSDINFO,
                0,
                info.as_mut_ptr().cast(),
                size,
            )
        } != size
        {
            if matches!(
                std::io::Error::last_os_error().raw_os_error(),
                Some(libc::ESRCH | libc::ENOENT)
            ) {
                continue; // A process exited after enumeration.
            }
            return None; // Permission/partial-read failures cannot establish a full inventory.
        }
        // SAFETY: the successful full-size write initialized this plain-data structure.
        let info = unsafe { info.assume_init() };
        let Some(session) = process_session(info.pbi_pid) else {
            if exited(info.pbi_pid) {
                continue; // The process exited between the two reads.
            }
            return None; // A live process whose session cannot be read.
        };
        result.push(ProcessStart {
            pid: info.pbi_pid,
            parent: info.pbi_ppid,
            session,
            created: timeval_to_unix(info.pbi_start_tvsec, info.pbi_start_tvusec)?,
        });
    }
    Some(result)
}
