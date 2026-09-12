//! Bounded privileged macOS inventory for the subscribed lifecycle source.
//!
//! `auditon(A_GETPINFO_ADDR)` is a root-only read. Flavor 17 is a pinned private
//! XNU ABI, not a portable public SDK contract. Layout evidence:
//! <https://github.com/apple-oss-distributions/xnu/blob/f6217f891ac0bb64f3d375211650a4c1ff8ca1ea/bsd/sys/proc_info_private.h>
//! The adapter remains unselected until its target tuple and the ES feed pass
//! complete reconciliation tests. It never substitutes PID-only correlation.

use std::mem::{self, MaybeUninit};
use std::ops::Deref;

use super::macos_audit_token::OwnedAuditToken;
use super::macos_endpoint_security::EndpointSecurityBootstrapRegistrar;
use super::macos_lifecycle::{
    MacOsCandidateAuditSession, MacOsLifecycleFailure, MacOsProcessAccountClass, MacOsProcessFact,
    MacOsProcessInventory, MacOsProcessInventoryCollector, MacOsProcessKey,
};

const MAX_PROCESSES: usize = 4_096;
const MAX_STABILITY_ATTEMPTS: usize = 3;
const PROC_PID_UNIQUE_IDENTIFIER_INFO: i32 = 17;
const AUDIT_GET_PROCESS_INFO_ADDR: i32 = 28;

#[repr(C)]
#[derive(Clone, Copy, Default)]
struct UniqueProcessInfo {
    executable_uuid: [u8; 16],
    unique_id: u64,
    parent_unique_id: u64,
    pid_version: i32,
    parent_pid_version: i32,
    reserved: [u64; 2],
}
const _: () = assert!(mem::size_of::<UniqueProcessInfo>() == 56);

// Public <bsm/audit.h> ABI. Addresses/masks are required output storage only;
// they are never interpreted or copied into facts and are erased on return.
#[repr(C)]
#[derive(Default)]
struct AuditProcessInfo {
    pid: i32,
    audit_user_id: u32,
    masks: [u32; 2],
    terminal_port: i32,
    terminal_type: u32,
    terminal_addresses: [u32; 4],
    audit_session_id: i32,
    flags: u64,
}
const _: () = assert!(mem::size_of::<AuditProcessInfo>() == 56);

#[link(name = "bsm")]
unsafe extern "C" {
    fn auditon(command: i32, data: *mut libc::c_void, length: i32) -> i32;
}

/// Reads a complete bounded process enumeration for an already subscribed feed.
/// It does not claim lifecycle or executable-identity coverage by itself.
pub struct MacOsAuditProcessInventory {
    candidate: MacOsCandidateAuditSession,
    registrar: EndpointSecurityBootstrapRegistrar,
}

impl MacOsAuditProcessInventory {
    /// Binds inventory identity completion to the same authenticated ES feed.
    #[must_use]
    pub const fn new(
        candidate: MacOsCandidateAuditSession,
        registrar: EndpointSecurityBootstrapRegistrar,
    ) -> Self {
        Self {
            candidate,
            registrar,
        }
    }
}

impl MacOsProcessInventory for MacOsAuditProcessInventory {
    fn snapshot(
        &mut self,
        collector: &mut MacOsProcessInventoryCollector,
    ) -> Result<(), MacOsLifecycleFailure> {
        // Root is required by XNU for A_GETPINFO_ADDR; no prompts or elevation.
        // SAFETY: geteuid is a side-effect-free process credential query.
        if unsafe { libc::geteuid() } != 0 {
            return Err(MacOsLifecycleFailure::PermissionLost);
        }
        let mut pids = ProcessIds(vec![0_i32; MAX_PROCESSES + 1].into_boxed_slice());
        // SAFETY: one fixed writable buffer, in bytes as required by libproc.
        let count = unsafe {
            libc::proc_listpids(
                1, // PROC_ALL_PIDS from the public libproc header.
                0,
                pids.0.as_mut_ptr().cast(),
                i32::try_from(mem::size_of_val(pids.0.as_ref())).unwrap_or(i32::MAX),
            )
        };
        let count = usize::try_from(count).map_err(|_| MacOsLifecycleFailure::Backend)?;
        if count == 0 || count % mem::size_of::<i32>() != 0 {
            return Err(MacOsLifecycleFailure::Backend);
        }
        let count = count / mem::size_of::<i32>();
        if count > MAX_PROCESSES {
            return Err(MacOsLifecycleFailure::InventoryOverflow);
        }
        for pid in pids.0.iter().take(count).copied().filter(|pid| *pid > 0) {
            if let Some(fact) = stable_process_fact(pid)? {
                let fact = fact.for_candidate(self.candidate);
                collector.push(fact)?;
                if fact.belongs_to(self.candidate) {
                    let (key, generation) = fact.inventory_identity();
                    let token = match OwnedAuditToken::capture_for_process(
                        pid,
                        generation,
                        self.registrar.bootstrap_deadline(),
                    ) {
                        Ok(token) if token.matches_candidate(self.candidate) => Some(token),
                        Ok(_) => return Err(MacOsLifecycleFailure::Backend),
                        Err(MacOsLifecycleFailure::Cleanup) => {
                            return Err(MacOsLifecycleFailure::Cleanup);
                        }
                        Err(_) => None,
                    };
                    self.registrar
                        .resolve_inventory_identity(key, generation, token)?;
                }
            }
        }
        Ok(())
    }
}

struct ProcessIds(Box<[i32]>);
impl Drop for ProcessIds {
    fn drop(&mut self) {
        for pid in &mut self.0 {
            // SAFETY: each pointer refers to an exclusively borrowed integer.
            unsafe {
                std::ptr::write_volatile(pid, 0);
            }
        }
    }
}

fn stable_process_fact(pid: i32) -> Result<Option<MacOsProcessFact>, MacOsLifecycleFailure> {
    for _ in 0..MAX_STABILITY_ATTEMPTS {
        let Some(before) = process_info::<UniqueProcessInfo>(pid, PROC_PID_UNIQUE_IDENTIFIER_INFO)?
        else {
            return Ok(None);
        };
        let Some(bsd) = process_info::<libc::proc_bsdinfo>(pid, libc::PROC_PIDTBSDINFO)? else {
            return Ok(None);
        };
        let Some((audit_user_id, audit_session_id)) = audit_process_identity(pid)? else {
            return Ok(None);
        };
        let Some(after) = process_info::<UniqueProcessInfo>(pid, PROC_PID_UNIQUE_IDENTIFIER_INFO)?
        else {
            return Ok(None);
        };
        let Some(audit_after) = audit_process_identity(pid)? else {
            return Ok(None);
        };
        let Some(final_identity) =
            process_info::<UniqueProcessInfo>(pid, PROC_PID_UNIQUE_IDENTIFIER_INFO)?
        else {
            return Ok(None);
        };
        if audit_after != (audit_user_id, audit_session_id)
            || final_identity.unique_id != after.unique_id
            || final_identity.pid_version != after.pid_version
            || before.unique_id == 0
            || before.unique_id != after.unique_id
            || before.pid_version != after.pid_version
        {
            continue;
        }
        if bsd.pbi_pid != pid.cast_unsigned() {
            return Err(MacOsLifecycleFailure::Protocol);
        }
        let key = MacOsProcessKey::new(
            pid,
            bsd.pbi_start_tvsec,
            u32::try_from(bsd.pbi_start_tvusec).map_err(|_| MacOsLifecycleFailure::Protocol)?,
        )
        .ok_or(MacOsLifecycleFailure::Protocol)?;
        return Ok(Some(MacOsProcessFact::new(
            key,
            after.pid_version.cast_unsigned(),
            audit_session_id.cast_unsigned(),
            audit_user_id,
            if audit_user_id == u32::MAX {
                MacOsProcessAccountClass::SystemOrService
            } else {
                MacOsProcessAccountClass::Human
            },
        )));
    }
    Err(MacOsLifecycleFailure::Backend)
}

struct NativeInfo<T: Copy>(MaybeUninit<T>);
impl<T: Copy> Drop for NativeInfo<T> {
    fn drop(&mut self) {
        let bytes = self.0.as_mut_ptr().cast::<u8>();
        for offset in 0..mem::size_of::<T>() {
            // SAFETY: owned writable object storage, including any padding. The
            // wrapper contains only MaybeUninit and no destructor-bearing fields.
            unsafe {
                std::ptr::write_volatile(bytes.add(offset), 0);
            }
        }
    }
}
impl<T: Copy> Deref for NativeInfo<T> {
    type Target = T;
    fn deref(&self) -> &T {
        // SAFETY: process_info returns the wrapper only after exact-size native
        // initialization of the two private admitted integer C layouts.
        unsafe { self.0.assume_init_ref() }
    }
}
fn process_info<T: Copy>(
    pid: i32,
    flavor: i32,
) -> Result<Option<NativeInfo<T>>, MacOsLifecycleFailure> {
    let mut value = NativeInfo(MaybeUninit::<T>::zeroed());
    let size = i32::try_from(mem::size_of::<T>()).map_err(|_| MacOsLifecycleFailure::Protocol)?;
    // SAFETY: callers supply only the pinned C layouts for these two literal
    // libproc flavors; exact returned byte count is checked before initialization.
    let count = unsafe { libc::proc_pidinfo(pid, flavor, 0, value.0.as_mut_ptr().cast(), size) };
    if count == 0 {
        return match std::io::Error::last_os_error().raw_os_error() {
            Some(libc::ESRCH) => Ok(None),
            Some(libc::EPERM | libc::EACCES) => Err(MacOsLifecycleFailure::PermissionLost),
            _ => Err(MacOsLifecycleFailure::Backend),
        };
    }
    if count != size {
        return Err(MacOsLifecycleFailure::Protocol);
    }
    // SAFETY: all bytes of the admitted integer/array C layout were initialized.
    Ok(Some(value))
}

fn audit_process_identity(pid: i32) -> Result<Option<(u32, i32)>, MacOsLifecycleFailure> {
    let mut info = AuditProcessInfo {
        pid,
        ..AuditProcessInfo::default()
    };
    // SAFETY: exact public C layout, initialized and live for the read-only call.
    let result = unsafe { auditon(AUDIT_GET_PROCESS_INFO_ADDR, (&raw mut info).cast(), 56) };
    let outcome = if result == 0 && info.pid == pid {
        Ok(Some((info.audit_user_id, info.audit_session_id)))
    } else {
        match std::io::Error::last_os_error().raw_os_error() {
            Some(libc::ESRCH) => Ok(None),
            Some(libc::EPERM | libc::EACCES) => Err(MacOsLifecycleFailure::PermissionLost),
            _ => Err(MacOsLifecycleFailure::Backend),
        }
    };
    // SAFETY: the plain integer C object has no destructor. A volatile erase
    // prevents borrowed kernel address/mask output from being retained.
    unsafe {
        std::ptr::write_volatile(&raw mut info, AuditProcessInfo::default());
    }
    outcome
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn native_unique_process_abi_matches_live_generation() {
        let pid = i32::try_from(std::process::id()).expect("pid");
        let before = process_info::<UniqueProcessInfo>(pid, PROC_PID_UNIQUE_IDENTIFIER_INFO)
            .expect("current process ABI")
            .expect("current process");
        let after = process_info::<UniqueProcessInfo>(pid, PROC_PID_UNIQUE_IDENTIFIER_INFO)
            .expect("current process ABI")
            .expect("current process");
        assert_ne!(before.unique_id, 0);
        assert_eq!(before.unique_id, after.unique_id);
        assert_eq!(before.pid_version, after.pid_version);
        let bsd = process_info::<libc::proc_bsdinfo>(pid, libc::PROC_PIDTBSDINFO)
            .expect("BSD ABI")
            .expect("current process");
        assert_eq!(bsd.pbi_pid, std::process::id());
        assert!(bsd.pbi_start_tvsec > 0);
    }

    #[test]
    fn audit_read_requires_root_instead_of_inventing_same_user_coverage() {
        // SAFETY: read-only query of the calling test process's credentials.
        if unsafe { libc::geteuid() } == 0 {
            assert!(
                audit_process_identity(i32::try_from(std::process::id()).expect("pid"))
                    .expect("root audit read")
                    .is_some()
            );
        } else {
            assert!(matches!(
                audit_process_identity(i32::try_from(std::process::id()).expect("pid")),
                Err(MacOsLifecycleFailure::PermissionLost)
            ));
        }
    }
}
