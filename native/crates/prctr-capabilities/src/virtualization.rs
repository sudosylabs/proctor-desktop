//! Whether the exam runs inside a virtual machine. Classification only: the absence of a guest marker
//! never proves physical hardware. Static while running; re-read after every interruption.
//! Contract: `docs/architecture/native-capability-families.md`, "Virtualization".

use prctr_core::{
    CapabilityDescriptor, FieldKind, FieldSpec, FieldValue, Observation, Sink, Source, SourceError,
};
use prctr_os::{RawHypervisor, RawVirtualization};
use prctr_protocol::facts::{Certainty, Envelope, Health, Permission};
use prctr_protocol::scalars::Identifier;
use schemars::JsonSchema;
use serde::Serialize;

pub const CAPABILITY: &str = "virtualization";
pub const STABILITY_MS: u64 = 0;
pub const REASON_GUEST: &str = "virtualization.guest_detected";
pub const REASON_PHYSICAL: &str = "virtualization.physical_required";

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum Classification {
    RecognizedGuest,
    RecognizedPhysicalOrRoot,
    Unknown,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum Hypervisor {
    Hyperv,
    Vmware,
    Virtualbox,
    Parallels,
    QemuKvm,
    AppleVirtualization,
    Xen,
    Other,
    NoneDetected,
}

impl Classification {
    const fn text(self) -> &'static str {
        match self {
            Self::RecognizedGuest => "recognized_guest",
            Self::RecognizedPhysicalOrRoot => "recognized_physical_or_root",
            Self::Unknown => "unknown",
        }
    }
}

impl Hypervisor {
    const fn text(self) -> &'static str {
        match self {
            Self::Hyperv => "hyperv",
            Self::Vmware => "vmware",
            Self::Virtualbox => "virtualbox",
            Self::Parallels => "parallels",
            Self::QemuKvm => "qemu_kvm",
            Self::AppleVirtualization => "apple_virtualization",
            Self::Xen => "xen",
            Self::Other => "other",
            Self::NoneDetected => "none_detected",
        }
    }

    const fn of(raw: RawHypervisor) -> Self {
        match raw {
            RawHypervisor::HyperV => Self::Hyperv,
            RawHypervisor::Vmware => Self::Vmware,
            RawHypervisor::VirtualBox => Self::Virtualbox,
            RawHypervisor::Parallels => Self::Parallels,
            RawHypervisor::QemuKvm => Self::QemuKvm,
            RawHypervisor::AppleVirtualization => Self::AppleVirtualization,
            RawHypervisor::Xen => Self::Xen,
            RawHypervisor::Other => Self::Other,
            RawHypervisor::None => Self::NoneDetected,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct VirtualizationState {
    pub classification: Classification,
    pub hypervisor: Hypervisor,
}

fn id(text: &str) -> Identifier {
    Identifier::new(text).expect("virtualization identifier is valid")
}

#[must_use]
pub fn descriptor() -> CapabilityDescriptor {
    let symbol = |name: &str, values: Vec<&str>| FieldSpec {
        name: id(name),
        kind: FieldKind::Symbol {
            values: values.into_iter().map(id).collect(),
        },
    };
    CapabilityDescriptor {
        id: id(CAPABILITY),
        sensitive: false,
        stability_ms: STABILITY_MS,
        categories: Vec::new(),
        fields: vec![
            symbol(
                "virtualization.classification",
                vec!["recognized_guest", "recognized_physical_or_root", "unknown"],
            ),
            symbol(
                "virtualization.hypervisor",
                vec![
                    "hyperv",
                    "vmware",
                    "virtualbox",
                    "parallels",
                    "qemu_kvm",
                    "apple_virtualization",
                    "xen",
                    "other",
                    "none_detected",
                ],
            ),
        ],
        reasons: vec![id(REASON_GUEST), id(REASON_PHYSICAL)],
        app_conditions: false,
        permission_prompt: false,
    }
}

/// The facts for one probe. A completed probe is complete certainty: the classification itself says
/// how much the evidence proves.
#[must_use]
pub fn classify(raw: RawVirtualization) -> Observation {
    let state = VirtualizationState {
        classification: if raw.guest_of != RawHypervisor::None {
            Classification::RecognizedGuest
        } else if raw.physical_or_root {
            Classification::RecognizedPhysicalOrRoot
        } else {
            Classification::Unknown
        },
        hypervisor: Hypervisor::of(raw.guest_of),
    };
    let envelope = if raw.probed {
        Envelope {
            permission: Permission::Granted,
            health: Health::Healthy,
            certainty: Certainty::Complete,
        }
    } else {
        Envelope {
            permission: Permission::Granted,
            health: Health::Unsupported,
            certainty: Certainty::Unknown,
        }
    };
    Observation {
        envelope,
        state: serde_json::to_value(state).unwrap_or_default(),
        summary: serde_json::json!({}),
        fields: [
            (
                id("virtualization.classification"),
                FieldValue::Symbol(id(state.classification.text())),
            ),
            (
                id("virtualization.hypervisor"),
                FieldValue::Symbol(id(state.hypervisor.text())),
            ),
        ]
        .into_iter()
        .collect(),
        apps: None,
        changes: Vec::new(),
    }
}

fn read() -> RawVirtualization {
    #[cfg(target_os = "macos")]
    return prctr_os::macos::virtualization();
    #[cfg(target_os = "windows")]
    return prctr_os::windows::virtualization();
    #[cfg(target_os = "linux")]
    return prctr_os::linux::virtualization();
    #[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
    RawVirtualization::unprobed()
}

/// The virtualization source. It holds no thread: nothing it reports changes while the system runs.
#[derive(Default)]
pub struct VirtualizationSource;

impl Source for VirtualizationSource {
    fn descriptor(&self) -> CapabilityDescriptor {
        descriptor()
    }

    fn start(
        &mut self,
        _categories: &[Identifier],
        _sink: Sink,
    ) -> Result<Observation, SourceError> {
        Ok(self.current())
    }

    fn current(&mut self) -> Observation {
        classify(read())
    }

    fn stop(&mut self) {}
}

#[cfg(test)]
mod tests {
    use super::*;

    fn raw(guest_of: RawHypervisor, physical_or_root: bool) -> RawVirtualization {
        RawVirtualization {
            probed: true,
            guest_of,
            physical_or_root,
        }
    }

    #[test]
    fn a_hypervisor_marker_is_a_recognized_guest() {
        let observation = classify(raw(RawHypervisor::Vmware, false));
        assert_eq!(observation.state["classification"], "recognized_guest");
        assert_eq!(observation.state["hypervisor"], "vmware");
    }

    #[test]
    fn a_root_partition_or_real_hardware_model_is_physical_or_root() {
        let observation = classify(raw(RawHypervisor::None, true));
        assert_eq!(
            observation.state["classification"],
            "recognized_physical_or_root"
        );
    }

    #[test]
    fn no_marker_is_unknown_never_physical_and_still_complete() {
        let observation = classify(raw(RawHypervisor::None, false));
        assert_eq!(observation.state["classification"], "unknown");
        assert_eq!(observation.envelope.certainty, Certainty::Complete);
    }

    #[test]
    fn an_unprobed_platform_is_unsupported() {
        let observation = classify(RawVirtualization::unprobed());
        assert_eq!(observation.envelope.health, Health::Unsupported);
    }

    #[test]
    fn known_dmi_vendors_are_recognized() {
        #[cfg(target_os = "linux")]
        {
            assert_eq!(
                prctr_os::linux::dmi_guest("QEMU", "Standard PC"),
                RawHypervisor::QemuKvm
            );
            assert_eq!(
                prctr_os::linux::dmi_guest("Dell Inc.", "XPS 13"),
                RawHypervisor::None
            );
        }
    }

    #[test]
    fn virtualization_passes_the_core_conformance_suite() {
        prctr_core::testing::assert_capability_conformance(
            &descriptor(),
            &classify(raw(RawHypervisor::None, true)),
            &classify(raw(RawHypervisor::Parallels, false)),
        );
    }

    /// Real OS: this machine is probed. A physical Apple-silicon Mac reports physical; a CI VM reports
    /// a recognized guest.
    #[cfg(target_os = "macos")]
    #[test]
    fn macos_probes_this_machine() {
        let raw = prctr_os::macos::virtualization();
        assert!(raw.probed, "kern.hv_vmm_present is readable");
        assert!(
            raw.guest_of != RawHypervisor::None
                || raw.physical_or_root
                || cfg!(target_arch = "x86_64")
        );
    }
}
