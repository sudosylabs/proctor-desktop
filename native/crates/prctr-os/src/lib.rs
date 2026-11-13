//! Safe wrappers over OS APIs. The only native crate allowed `unsafe`: every block states why it is
//! sound, and every wrapper returns owned, validated data.
#![deny(
    unsafe_op_in_unsafe_fn,
    clippy::undocumented_unsafe_blocks,
    clippy::multiple_unsafe_ops_per_block
)]
#![allow(unsafe_code)]

use std::fmt;

#[cfg(any(target_os = "macos", target_os = "linux"))]
pub mod cups;
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

/// The system proxy configuration, as a kind only: hosts, ports and scripts are never read.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum RawProxy {
    None,
    Manual,
    AutomaticConfig,
    AutoDetect,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum RawTunnelClass {
    PointToPoint,
    PacketTunnel,
    VirtualEthernet,
    ManagedVpn,
    Other,
}

/// One active tunnel interface. `key` is a process-local hash of the interface name, so a tunnel
/// keeps its identity between reads; the name itself never leaves `prctr-os`.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub struct RawTunnel {
    pub key: u64,
    pub class: RawTunnelClass,
}

impl PartialOrd for RawTunnelClass {
    fn partial_cmp(&self, other: &Self) -> Option<std::cmp::Ordering> {
        Some(self.cmp(other))
    }
}

impl Ord for RawTunnelClass {
    fn cmp(&self, other: &Self) -> std::cmp::Ordering {
        (*self as u8).cmp(&(*other as u8))
    }
}

/// A stable, process-local hash: tunnel keys and route fingerprints are compared, never sent.
#[must_use]
pub fn fingerprint(bytes: &[u8]) -> u64 {
    use std::hash::{Hash, Hasher};
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    bytes.hash(&mut hasher);
    hasher.finish()
}

/// What kind of removable storage a device is.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub enum RawStorageKind {
    /// A block device the OS can mount: USB sticks, external disks, SD cards.
    Block,
    /// A phone or camera that exposes files over MTP/PTP rather than as a disk.
    Portable,
}

/// How a removable device is attached, as far as the OS states it.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub enum RawTransport {
    Usb,
    Thunderbolt,
    Sd,
    Other,
    Unknown,
}

/// One removable or external storage device. `key` is a process-local hash of the OS device name,
/// so a device keeps its identity between reads; names, labels, serials and contents are never
/// read or kept.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub struct RawStorageDevice {
    pub key: u64,
    pub kind: RawStorageKind,
    pub transport: RawTransport,
    /// Whether a file system on the device is mounted; `None` when the OS does not say.
    pub mounted: Option<bool>,
    /// Whether the media accepts writes; `None` when the OS does not say.
    pub writable: Option<bool>,
}

/// Who owns a print job, reduced at once from the scheduler's user name, which is never kept.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub enum RawJobOwner {
    /// The account the agent runs as: the candidate.
    Candidate,
    Other,
    /// The scheduler did not state an owner.
    Unknown,
}

/// One job the print scheduler knows, active or finished. `id` is the scheduler's job number,
/// compared inside the agent to tell new jobs from old ones and never sent.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub struct RawPrintJob {
    pub id: u32,
    pub owner: RawJobOwner,
    /// Pending, held, processing or stopped; false once completed, cancelled or aborted.
    pub active: bool,
}

/// The whole-disk name of a BSD device path: `/dev/disk4s1` and `disk4` are both `disk4`.
#[must_use]
pub fn whole_disk(path: &str) -> Option<String> {
    let name = path.strip_prefix("/dev/").unwrap_or(path);
    let number = name.strip_prefix("disk")?;
    let digits = number.bytes().take_while(u8::is_ascii_digit).count();
    (digits > 0).then(|| format!("disk{}", &number[..digits]))
}

#[cfg(test)]
mod tests {
    use super::whole_disk;

    #[test]
    fn a_partition_path_names_its_whole_disk() {
        assert_eq!(whole_disk("/dev/disk4s1").as_deref(), Some("disk4"));
        assert_eq!(whole_disk("/dev/disk12s2s1").as_deref(), Some("disk12"));
        assert_eq!(whole_disk("disk3").as_deref(), Some("disk3"));
        assert_eq!(whole_disk("/dev/disk"), None);
        assert_eq!(whole_disk("map auto_home"), None);
        assert_eq!(whole_disk("devfs"), None);
    }
}

/// The OS permission for a camera or microphone, for the agent's responsible application.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum RawMediaPermission {
    NotDetermined,
    Granted,
    Denied,
    Restricted,
    /// The platform has no such permission or it cannot be read.
    Unavailable,
}

/// One camera or microphone. Names, models and identifiers never leave `prctr-os`.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub struct RawMediaDevice {
    /// A process-local hash of the OS device identifier.
    pub key: u64,
    /// The OS states a hardware transport (built-in, USB, Thunderbolt, PCI, wireless). A device
    /// that cannot be classified is not physical.
    pub physical: bool,
    /// Connected and not suspended (for example, a closed laptop lid); `None` when unknown.
    pub available: Option<bool>,
}

/// One read of a media kind.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RawMedia {
    pub permission: RawMediaPermission,
    /// `None` when the devices cannot be listed.
    pub devices: Option<Vec<RawMediaDevice>>,
    /// Whether another application is capturing from a device of this kind.
    pub in_use_by_other: Option<bool>,
}

impl RawMedia {
    #[must_use]
    pub const fn unavailable() -> Self {
        Self {
            permission: RawMediaPermission::Unavailable,
            devices: None,
            in_use_by_other: None,
        }
    }
}

/// A process's code identity. Paths and process names are never identity.
#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub enum RawIdentity {
    /// macOS code signature. `team_id` is `None` for Apple's own code; `apple` is true when the
    /// signature satisfies `anchor apple`.
    MacOs {
        signing_identifier: String,
        team_id: Option<String>,
        apple: bool,
    },
    /// Windows Authenticode signer and the version resource's original file name.
    Windows {
        publisher: String,
        original_file_name: String,
    },
    /// Linux has no code identity; the executable's file name is a weak stand-in.
    Linux { executable: String },
    /// The code has no valid signature.
    Unsigned,
    /// The identity could not be read.
    Unavailable,
}

/// One process in the candidate's session. `instance` hashes the process number with its start
/// time, so a reused number is a new instance.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RawProcess {
    pub instance: u64,
    pub pid: u32,
    pub parent: u32,
}

/// Fills `buffer` from the OS's cryptographic random source. Returns `false` if it is unavailable;
/// callers must not fall back to anything weaker.
#[must_use]
pub fn random_bytes(buffer: &mut [u8]) -> bool {
    #[cfg(target_os = "macos")]
    {
        // SAFETY: `buffer` is writable for its length; `arc4random_buf` cannot fail.
        unsafe { libc::arc4random_buf(buffer.as_mut_ptr().cast(), buffer.len()) };
        true
    }
    #[cfg(target_os = "linux")]
    {
        let mut filled = 0;
        while filled < buffer.len() {
            let rest = &mut buffer[filled..];
            // SAFETY: `rest` is writable for its length.
            let read = unsafe { libc::getrandom(rest.as_mut_ptr().cast(), rest.len(), 0) };
            match usize::try_from(read) {
                Ok(read) if read > 0 => filled += read,
                _ if std::io::Error::last_os_error().kind() == std::io::ErrorKind::Interrupted => {}
                _ => return false,
            }
        }
        true
    }
    #[cfg(target_os = "windows")]
    {
        use ::windows::Win32::Security::Cryptography::{
            BCRYPT_USE_SYSTEM_PREFERRED_RNG, BCryptGenRandom,
        };
        // SAFETY: `buffer` is writable for its length; no algorithm handle is needed with the
        // system-preferred generator.
        unsafe { BCryptGenRandom(None, buffer, BCRYPT_USE_SYSTEM_PREFERRED_RNG) }.is_ok()
    }
    #[cfg(not(any(target_os = "macos", target_os = "linux", target_os = "windows")))]
    {
        let _ = buffer;
        false
    }
}

#[cfg(test)]
mod random_tests {
    #[test]
    fn two_draws_differ_and_are_not_zero() {
        let (mut first, mut second) = ([0_u8; 32], [0_u8; 32]);
        assert!(super::random_bytes(&mut first));
        assert!(super::random_bytes(&mut second));
        assert_ne!(first, second);
        assert_ne!(first, [0; 32]);
    }
}

/// Bytes available to this account on the volume holding `path`.
#[must_use]
pub fn free_space(path: &std::path::Path) -> Option<u64> {
    #[cfg(unix)]
    {
        use std::os::unix::ffi::OsStrExt;
        let path = std::ffi::CString::new(path.as_os_str().as_bytes()).ok()?;
        let mut stats = std::mem::MaybeUninit::<libc::statvfs>::zeroed();
        // SAFETY: `path` is NUL-terminated and `stats` is a valid out-parameter.
        if unsafe { libc::statvfs(path.as_ptr(), stats.as_mut_ptr()) } != 0 {
            return None;
        }
        // SAFETY: `statvfs` succeeded and filled `stats`.
        let stats = unsafe { stats.assume_init() };
        #[allow(clippy::useless_conversion)] // The field widths differ between platforms.
        let (blocks, size) = (u64::from(stats.f_bavail), u64::from(stats.f_frsize));
        blocks.checked_mul(size)
    }
    #[cfg(windows)]
    {
        use ::windows::Win32::Storage::FileSystem::GetDiskFreeSpaceExW;
        let mut available = 0_u64;
        let path = ::windows::core::HSTRING::from(path.as_os_str());
        // SAFETY: `path` is a valid wide string and `available` a valid out-parameter.
        unsafe { GetDiskFreeSpaceExW(&path, Some(&raw mut available), None, None) }.ok()?;
        Some(available)
    }
    #[cfg(not(any(unix, windows)))]
    {
        let _ = path;
        None
    }
}

/// Whether this process may capture the screen: macOS Screen Recording; always on elsewhere.
#[must_use]
pub fn screen_capture_allowed() -> bool {
    #[cfg(target_os = "macos")]
    return objc2_core_graphics::CGPreflightScreenCaptureAccess();
    #[cfg(not(target_os = "macos"))]
    true
}

/// Shows the macOS Screen Recording prompt once; later calls only say whether it is allowed. The
/// answer usually needs a relaunch to take effect.
#[must_use]
pub fn request_screen_capture() -> bool {
    #[cfg(target_os = "macos")]
    return objc2_core_graphics::CGRequestScreenCaptureAccess();
    #[cfg(not(target_os = "macos"))]
    true
}
