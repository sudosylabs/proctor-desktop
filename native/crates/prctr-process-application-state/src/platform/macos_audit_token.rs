//! Exact kernel audit tokens through the read-only Mach task-name interface.
//! No task-control/read right, process memory, or synthesized token is used.
#![allow(unsafe_code)]

use std::time::Instant;

use super::macos_lifecycle::{MacOsCandidateAuditSession, MacOsLifecycleFailure};
use prctr_native_source_runtime::{
    ensure_native_source_process_usable, poison_native_source_process,
};

#[repr(C)]
struct NativeAuditToken {
    words: [u32; 8],
}

unsafe extern "C" {
    static mach_task_self_: u32;
    fn task_name_for_pid(task: u32, pid: i32, name: *mut u32) -> i32;
    fn task_info(task: u32, flavor: u32, info: *mut i32, count: *mut u32) -> i32;
    fn mach_port_deallocate(task: u32, name: u32) -> i32;
}
#[link(name = "bsm")]
unsafe extern "C" {
    fn audit_token_to_pid(token: NativeAuditToken) -> i32;
    fn audit_token_to_pidversion(token: NativeAuditToken) -> i32;
    fn audit_token_to_auid(token: NativeAuditToken) -> u32;
    fn audit_token_to_asid(token: NativeAuditToken) -> i32;
}

/// Native-only owner. Copies enter only from an OS-provided ES/Mach token and
/// are erased after verification; this type never crosses the helper protocol.
pub(super) struct OwnedAuditToken {
    words: [u32; 8],
}
impl OwnedAuditToken {
    pub(super) const fn copy_from_kernel(words: &[u32; 8]) -> Self {
        Self { words: *words }
    }
    pub(super) const fn as_words(&self) -> &[u32; 8] {
        &self.words
    }

    pub(super) fn matches_candidate(&self, candidate: MacOsCandidateAuditSession) -> bool {
        // SAFETY: libbsm's required by-value ABI decodes the owned kernel token.
        unsafe {
            candidate.matches_audit_identity(
                audit_token_to_asid(NativeAuditToken { words: self.words }).cast_unsigned(),
                audit_token_to_auid(NativeAuditToken { words: self.words }),
            )
        }
    }

    /// Capture a token for exactly the inventory's PID and exec generation.
    /// The surrounding helper supervisor bounds synchronous Mach calls with
    /// its absolute request deadline; these APIs have no per-call timeout.
    pub(super) fn capture_for_process(
        pid: i32,
        generation: u32,
        deadline: Instant,
    ) -> Result<Self, MacOsLifecycleFailure> {
        ensure_usable()?;
        let result = Self::capture(pid, deadline).and_then(|token| {
            if token.matches(pid, generation) {
                Ok(token)
            } else {
                Err(MacOsLifecycleFailure::Backend)
            }
        });
        // Capture's Mach right is already released, including on query errors.
        ensure_usable()?;
        check_deadline(deadline)?;
        result
    }

    fn capture(pid: i32, deadline: Instant) -> Result<Self, MacOsLifecycleFailure> {
        check_deadline(deadline)?;
        if pid <= 0 {
            return Err(MacOsLifecycleFailure::Backend);
        }
        let mut name = 0;
        // SAFETY: public task-name query with a scalar PID and writable output.
        let acquired = unsafe { task_name_for_pid(mach_task_self_, pid, &raw mut name) };
        let name = (name != 0 && name != u32::MAX).then(|| TaskName(name));
        if acquired != 0 {
            return Err(MacOsLifecycleFailure::Backend);
        }
        let name = name.ok_or(MacOsLifecycleFailure::Backend)?;
        let mut token = Self { words: [0; 8] };
        let mut count = 8;
        // Public SDK TASK_AUDIT_TOKEN=15, count in natural_t elements. XNU
        // task_info_from_user accepts a task-name port for this flavor:
        // https://github.com/apple-oss-distributions/xnu/blob/main/osfmk/kern/task.c
        // SAFETY: exact audit_token_t storage, live name right, exact count.
        let queried =
            unsafe { task_info(name.0, 15, token.words.as_mut_ptr().cast(), &raw mut count) };
        drop(name);
        ensure_usable()?;
        if queried != 0 || count != 8 {
            return Err(MacOsLifecycleFailure::Backend);
        }
        check_deadline(deadline)?;
        Ok(token)
    }

    fn matches(&self, pid: i32, generation: u32) -> bool {
        // SAFETY: libbsm decodes exact kernel-returned tokens by value as its
        // public ABI requires. No opaque field positions are interpreted here.
        unsafe {
            audit_token_to_pid(NativeAuditToken { words: self.words }) == pid
                && audit_token_to_pidversion(NativeAuditToken { words: self.words }).cast_unsigned()
                    == generation
        }
    }
}
impl Drop for OwnedAuditToken {
    fn drop(&mut self) {
        for word in &mut self.words {
            // SAFETY: exclusive fixed-size scalar storage.
            unsafe {
                std::ptr::write_volatile(word, 0);
            }
        }
    }
}

struct TaskName(u32);
impl Drop for TaskName {
    fn drop(&mut self) {
        // SAFETY: one owned task-name send right, released exactly once.
        if unsafe { mach_port_deallocate(mach_task_self_, self.0) } != 0 {
            poison_native_source_process();
        }
    }
}
fn ensure_usable() -> Result<(), MacOsLifecycleFailure> {
    ensure_native_source_process_usable().map_err(|_| MacOsLifecycleFailure::Cleanup)
}
fn check_deadline(deadline: Instant) -> Result<(), MacOsLifecycleFailure> {
    if Instant::now() >= deadline {
        Err(MacOsLifecycleFailure::Backend)
    } else {
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;

    #[test]
    fn task_name_supplies_exact_current_process_token() {
        let pid = i32::try_from(std::process::id()).expect("own PID fits");
        let deadline = Instant::now() + Duration::from_secs(1);
        let token = OwnedAuditToken::capture(pid, deadline).expect("kernel task token");
        // SAFETY: decode the live kernel token with the SDK's public decoder.
        let generation =
            unsafe { audit_token_to_pidversion(NativeAuditToken { words: token.words }) }
                .cast_unsigned();
        assert!(token.matches(pid, generation));
        let again = OwnedAuditToken::capture_for_process(pid, generation, deadline)
            .expect("same live generation");
        assert!(again.matches(pid, generation));
        ensure_usable().expect("Mach rights closed successfully");
    }

    #[test]
    fn stale_generation_and_expired_deadline_do_not_return_tokens() {
        let pid = i32::try_from(std::process::id()).expect("own PID fits");
        let deadline = Instant::now() + Duration::from_secs(1);
        let token = OwnedAuditToken::capture(pid, deadline).expect("kernel task token");
        // SAFETY: exact token decoded using libbsm, never exposed in diagnostics.
        let generation =
            unsafe { audit_token_to_pidversion(NativeAuditToken { words: token.words }) }
                .cast_unsigned();
        assert!(
            OwnedAuditToken::capture_for_process(pid, generation.wrapping_add(1), deadline)
                .is_err()
        );
        assert!(OwnedAuditToken::capture_for_process(pid, generation, Instant::now()).is_err());
        ensure_usable().expect("failed capture still closed Mach right");
    }
}
