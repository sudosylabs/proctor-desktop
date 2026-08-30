#[cfg(any(target_os = "linux", target_os = "windows"))]
use prctr_native_protocol::{
    VirtualizationCertainty, VirtualizationClassification, VirtualizationCoverage,
    VirtualizationState,
};

#[cfg(any(target_os = "linux", target_os = "windows"))]
pub(super) fn recognized_guest() -> VirtualizationState {
    classified(VirtualizationClassification::RecognizedGuest)
}

#[cfg(target_os = "windows")]
pub(super) fn recognized_physical_or_root() -> VirtualizationState {
    classified(VirtualizationClassification::RecognizedPhysicalOrRoot)
}

#[cfg(any(target_os = "linux", target_os = "windows"))]
pub(super) fn complete_unknown() -> VirtualizationState {
    classified(VirtualizationClassification::Unknown)
}

#[cfg(target_os = "linux")]
pub(super) fn partial_unknown() -> VirtualizationState {
    VirtualizationState {
        coverage: VirtualizationCoverage::Classification,
        certainty: VirtualizationCertainty::Partial,
        classification: VirtualizationClassification::Unknown,
    }
}

#[cfg(any(target_os = "linux", target_os = "windows"))]
fn classified(classification: VirtualizationClassification) -> VirtualizationState {
    VirtualizationState {
        coverage: VirtualizationCoverage::Classification,
        certainty: VirtualizationCertainty::Complete,
        classification,
    }
}

#[cfg(any(target_os = "linux", test))]
pub(super) fn marker_recognizes_guest(marker: &str) -> bool {
    let marker = marker.trim().to_ascii_lowercase();
    [
        "bhyve",
        "bochs",
        "google compute engine",
        "innotek gmbh",
        "kvm",
        "openstack",
        "oracle corporation",
        "parallels",
        "qemu",
        "rhev",
        "virtualbox",
        "virtual machine",
        "vmware",
        "xen",
    ]
    .iter()
    .any(|known| marker.contains(known))
}

#[cfg(any(target_os = "windows", test))]
pub(super) fn cpuid_vendor_recognizes_guest(vendor: &[u8; 12]) -> bool {
    matches!(
        vendor,
        b"KVMKVMKVM\0\0\0"
            | b"VMwareVMware"
            | b"VBoxVBoxVBox"
            | b"XenVMMXenVMM"
            | b"prl hyperv  "
            | b"bhyve bhyve "
    )
}

#[cfg(any(target_os = "windows", test))]
pub(super) const fn hyper_v_root_has_create_partitions_privilege(ebx: u32) -> bool {
    // Microsoft documents CreatePartitions as bit 0 of EBX for CPUID leaf
    // 0x40000003. EAX contains a different privilege group.
    ebx & 1 != 0
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_specific_normalized_markers_recognize_a_guest() {
        assert!(marker_recognizes_guest("VMware, Inc."));
        assert!(marker_recognizes_guest(
            "Microsoft Corporation Virtual Machine"
        ));
        assert!(!marker_recognizes_guest("Microsoft Corporation"));
        assert!(!marker_recognizes_guest("Apple Inc."));
        assert!(!marker_recognizes_guest("virtualization enabled"));
    }

    #[test]
    fn hyper_v_vendor_is_not_misclassified_as_a_guest() {
        assert!(cpuid_vendor_recognizes_guest(b"VMwareVMware"));
        assert!(!cpuid_vendor_recognizes_guest(b"Microsoft Hv"));
    }

    #[test]
    fn hyper_v_root_privilege_is_read_from_ebx() {
        assert!(hyper_v_root_has_create_partitions_privilege(1));
        assert!(!hyper_v_root_has_create_partitions_privilege(0));
        assert!(!hyper_v_root_has_create_partitions_privilege(1 << 31));
    }
}
