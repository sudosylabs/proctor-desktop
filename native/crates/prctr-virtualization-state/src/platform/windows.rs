use crate::VirtualizationWire;
use prctr_native_protocol::{PermissionState, PlatformFamily, VirtualizationState};
use prctr_native_source_runtime::{
    OpenedPassiveStateBackend, PassiveStateBackend, PassiveStateEmitter, PassiveStateSourceError,
    StaticPassiveStateBackend, StaticPassiveStateSubscription,
};

use super::classification::{
    complete_unknown, cpuid_vendor_recognizes_guest, hyper_v_root_has_create_partitions_privilege,
    recognized_guest, recognized_physical_or_root,
};

pub struct PlatformVirtualizationBackend;

impl PassiveStateBackend<VirtualizationWire> for PlatformVirtualizationBackend {
    type Subscription = StaticPassiveStateSubscription<VirtualizationWire>;

    fn open(
        self,
        emitter: PassiveStateEmitter<VirtualizationWire>,
    ) -> Result<
        OpenedPassiveStateBackend<VirtualizationWire, Self::Subscription>,
        PassiveStateSourceError,
    > {
        StaticPassiveStateBackend::new(
            PlatformFamily::Windows,
            PermissionState::Granted,
            "windows-cpuid-guest-markers-v1",
            classify_current_environment(),
        )
        .open(emitter)
    }
}

fn classify_current_environment() -> VirtualizationState {
    #[cfg(target_arch = "x86")]
    use std::arch::x86::__cpuid;
    #[cfg(target_arch = "x86_64")]
    use std::arch::x86_64::__cpuid;

    #[cfg(any(target_arch = "x86", target_arch = "x86_64"))]
    {
        // SAFETY: CPUID leaf 1 and the hypervisor vendor leaf are architectural
        // queries supported on the Windows x86/x64 targets admitted here.
        let features = unsafe { __cpuid(1) };
        if features.ecx & (1 << 31) == 0 {
            return complete_unknown();
        }
        // SAFETY: the hypervisor-present bit advertises the hypervisor CPUID
        // range; leaf 0x40000000 is the vendor/max-leaf query.
        let vendor_leaf = unsafe { __cpuid(0x4000_0000) };
        let mut vendor = [0_u8; 12];
        vendor[..4].copy_from_slice(&vendor_leaf.ebx.to_le_bytes());
        vendor[4..8].copy_from_slice(&vendor_leaf.ecx.to_le_bytes());
        vendor[8..].copy_from_slice(&vendor_leaf.edx.to_le_bytes());
        if cpuid_vendor_recognizes_guest(&vendor) {
            return recognized_guest();
        }
        if &vendor == b"Microsoft Hv" && vendor_leaf.eax >= 0x4000_0003 {
            // SAFETY: the advertised maximum leaf covers 0x40000003.
            let privileges = unsafe { __cpuid(0x4000_0003) };
            // CreatePartitions is exposed only to the Hyper-V root partition.
            if hyper_v_root_has_create_partitions_privilege(privileges.ebx) {
                return recognized_physical_or_root();
            }
        }
    }
    complete_unknown()
}
