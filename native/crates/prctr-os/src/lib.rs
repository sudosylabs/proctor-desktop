//! Safe wrappers over OS APIs. The only native crate allowed `unsafe`: every block states why it is
//! sound, and every wrapper returns owned, validated data.
#![deny(
    unsafe_op_in_unsafe_fn,
    clippy::undocumented_unsafe_blocks,
    clippy::multiple_unsafe_ops_per_block
)]
#![allow(unsafe_code)]

use std::fmt;

#[cfg(target_os = "linux")]
pub mod linux;
#[cfg(target_os = "macos")]
pub mod macos;
#[cfg(target_os = "windows")]
pub mod windows;

/// An OS call failed. Only a bounded operation name and numeric status cross this boundary.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct OsError {
    pub operation: &'static str,
    pub status: i64,
}

impl fmt::Display for OsError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            formatter,
            "{} failed with status {}",
            self.operation, self.status
        )
    }
}

impl std::error::Error for OsError {}

/// What the OS says a display target is.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum RawKind {
    /// A laptop panel.
    BuiltIn,
    /// A physical screen on a direct connector.
    External,
    /// A physical screen behind a software display driver (for example a USB dock).
    IndirectExternal,
    /// A software display with no screen behind it.
    Virtual,
    /// A wireless target (Miracast).
    Wireless,
    /// The OS gave too little information to tell a physical screen from a virtual or wireless one.
    Unclassified,
}

/// One display as the OS reports it, before classification into facts. Identifiers are
/// process-local and never leave the agent.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RawDisplay {
    pub id: u64,
    pub kind: RawKind,
    /// Drawing a desktop now.
    pub active: bool,
    pub main: bool,
    pub asleep: bool,
    /// The display whose image this one shows, if it is a mirror.
    pub mirror_of: Option<u64>,
}

/// Every display, and whether the platform can see mirroring at all.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RawTopology {
    pub displays: Vec<RawDisplay>,
    /// `false` where the platform cannot confirm mirroring (Linux sysfs).
    pub mirroring_known: bool,
}

/// At most this many displays are read; more is reported as an error, never truncated.
pub const MAX_DISPLAYS: usize = 32;

/// A rectangle in global screen coordinates (points on macOS, pixels on Windows).
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Rect {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

impl Rect {
    #[must_use]
    pub fn area(self) -> f64 {
        self.width.max(0.0) * self.height.max(0.0)
    }

    #[must_use]
    pub fn intersection(self, other: Self) -> Option<Self> {
        let left = self.x.max(other.x);
        let top = self.y.max(other.y);
        let right = (self.x + self.width).min(other.x + other.width);
        let bottom = (self.y + self.height).min(other.y + other.height);
        (right > left && bottom > top).then_some(Self {
            x: left,
            y: top,
            width: right - left,
            height: bottom - top,
        })
    }
}

/// What the OS says about the candidate window and the windows above it. No other window's name,
/// owner or content is read.
#[derive(Clone, Debug, PartialEq, Default)]
pub struct RawWindow {
    /// The OS knows a window with this identity.
    pub found: bool,
    /// `Some(true)` when the OS confirms the window is excluded from capture.
    pub capture_excluded: Option<bool>,
    pub bounds: Option<Rect>,
    /// Bounds of visible windows of other processes above it, excluding the dock, the cursor and
    /// assistive overlays.
    pub covering: Vec<Rect>,
}

/// The candidate's interactive session as the OS reports it without privileged components.
/// `None` means the platform cannot tell. No account name or session identity leaves here.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct RawSession {
    /// `Some(true)` when this process's session owns the physical console.
    pub on_console: Option<bool>,
    pub locked: Option<bool>,
    /// The session is being used or viewed remotely.
    pub remote: Option<bool>,
    /// Other human login sessions, active or disconnected.
    pub other_human_sessions: Option<u64>,
}

/// A hypervisor family the OS or CPU identifies.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum RawHypervisor {
    HyperV,
    Vmware,
    VirtualBox,
    Parallels,
    QemuKvm,
    AppleVirtualization,
    Xen,
    Other,
    /// No hypervisor marker was found. This never proves the machine is physical.
    None,
}

/// Evidence about virtualization. Serial numbers, UUIDs and firmware strings stay here.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct RawVirtualization {
    /// The probe ran to completion.
    pub probed: bool,
    /// Running inside a guest of this hypervisor.
    pub guest_of: RawHypervisor,
    /// Positive evidence of physical hardware or a hypervisor root partition.
    pub physical_or_root: bool,
}

impl RawVirtualization {
    #[must_use]
    pub const fn unprobed() -> Self {
        Self {
            probed: false,
            guest_of: RawHypervisor::None,
            physical_or_root: false,
        }
    }
}

/// CPUID evidence on x86-64: the hypervisor-present bit, the vendor leaf, and Hyper-V's root
/// partition privilege.
#[cfg(target_arch = "x86_64")]
#[must_use]
pub fn cpuid_virtualization() -> RawVirtualization {
    use std::arch::x86_64::__cpuid;
    // SAFETY: CPUID is available on every x86-64 processor; leaf 1 is always defined.
    let features = unsafe { __cpuid(1) };
    if features.ecx & (1 << 31) == 0 {
        return RawVirtualization {
            probed: true,
            guest_of: RawHypervisor::None,
            physical_or_root: false,
        };
    }
    // SAFETY: with the hypervisor bit set, leaf 0x4000_0000 is the hypervisor vendor leaf.
    let vendor = unsafe { __cpuid(0x4000_0000) };
    let mut name = [0_u8; 12];
    name[0..4].copy_from_slice(&vendor.ebx.to_le_bytes());
    name[4..8].copy_from_slice(&vendor.ecx.to_le_bytes());
    name[8..12].copy_from_slice(&vendor.edx.to_le_bytes());
    let family = match &name {
        b"Microsoft Hv" => RawHypervisor::HyperV,
        b"VMwareVMware" => RawHypervisor::Vmware,
        b"VBoxVBoxVBox" => RawHypervisor::VirtualBox,
        b"KVMKVMKVM\0\0\0" | b"TCGTCGTCGTCG" => RawHypervisor::QemuKvm,
        b"XenVMMXenVMM" => RawHypervisor::Xen,
        b" prl hyperv " | b" lrpepyh  vr" => RawHypervisor::Parallels,
        _ => RawHypervisor::Other,
    };
    if family == RawHypervisor::HyperV && vendor.eax >= 0x4000_0003 {
        // SAFETY: the vendor leaf reports leaf 0x4000_0003 as available.
        let privileges = unsafe { __cpuid(0x4000_0003) };
        // `CreatePartitions` is granted only to the root partition: a physical host running Hyper-V.
        if privileges.ebx & 1 != 0 {
            return RawVirtualization {
                probed: true,
                guest_of: RawHypervisor::None,
                physical_or_root: true,
            };
        }
    }
    RawVirtualization {
        probed: true,
        guest_of: family,
        physical_or_root: false,
    }
}
