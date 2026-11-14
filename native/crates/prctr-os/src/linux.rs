//! Linux: DRM connectors in sysfs, readable without privilege under X11 and Wayland.

use std::fs;
use std::path::Path;

use crate::{MAX_DISPLAYS, OsError, RawDisplay, RawKind, RawTopology};

const DRM: &str = "/sys/class/drm";

/// Connected DRM connectors. Mirroring cannot be confirmed from sysfs, so every target is reported
/// unclassified for mirroring; built-in panels and virtual connectors are recognised by type.
///
/// # Errors
/// When sysfs cannot be read, or reports more than [`MAX_DISPLAYS`] connected displays.
pub fn connected_displays() -> Result<RawTopology, OsError> {
    connected_displays_in(Path::new(DRM))
}

/// [`connected_displays`] against any directory laid out like `/sys/class/drm`, for tests.
///
/// # Errors
/// As [`connected_displays`].
pub fn connected_displays_in(root: &Path) -> Result<RawTopology, OsError> {
    let entries = fs::read_dir(root).map_err(|_| OsError {
        operation: "read /sys/class/drm",
        status: -1,
    })?;
    let mut names: Vec<String> = entries
        .filter_map(Result::ok)
        .filter_map(|entry| entry.file_name().into_string().ok())
        // Connectors are `card<N>-<TYPE>-<index>`; `card<N>` alone is the device.
        .filter(|name| name.starts_with("card") && name.contains('-'))
        .collect();
    names.sort();
    let mut displays = Vec::new();
    for (index, name) in names.iter().enumerate() {
        let connector = root.join(name);
        let read = |file: &str| fs::read_to_string(connector.join(file)).unwrap_or_default();
        if read("status").trim() != "connected" {
            continue;
        }
        let kind = name.split('-').nth(1).unwrap_or_default();
        if kind == "Writeback" {
            continue;
        }
        let dpms = read("dpms");
        displays.push(RawDisplay {
            id: u64::try_from(index).unwrap_or(u64::MAX),
            kind: match kind {
                "eDP" | "LVDS" | "DSI" => RawKind::BuiltIn,
                "Virtual" => RawKind::Virtual,
                _ => RawKind::External,
            },
            active: read("enabled").trim() == "enabled",
            main: false,
            asleep: !dpms.is_empty() && dpms.trim() != "On",
            mirror_of: None,
        });
        if displays.len() > MAX_DISPLAYS {
            return Err(OsError {
                operation: "read /sys/class/drm",
                status: -2,
            });
        }
    }
    Ok(RawTopology {
        displays,
        mirroring_known: false,
    })
}

/// The current logind session from `/run/systemd/sessions`, without D-Bus. The lock state is not
/// in these files, so it is unknown.
#[must_use]
pub fn session() -> crate::RawSession {
    session_in(
        Path::new("/proc/self/cgroup"),
        Path::new("/run/systemd/sessions"),
    )
}

fn session_fields(path: &Path) -> Option<std::collections::BTreeMap<String, String>> {
    let text = fs::read_to_string(path).ok()?;
    Some(
        text.lines()
            .filter_map(|line| line.split_once('='))
            .map(|(key, value)| (key.to_owned(), value.to_owned()))
            .collect(),
    )
}

/// [`session`] against any cgroup file and sessions directory, for tests.
#[must_use]
pub fn session_in(cgroup: &Path, sessions: &Path) -> crate::RawSession {
    let own = fs::read_to_string(cgroup).ok().and_then(|text| {
        text.split('/').find_map(|part| {
            part.trim()
                .strip_prefix("session-")?
                .strip_suffix(".scope")
                .map(str::to_owned)
        })
    });
    let Some(own) = own else {
        return crate::RawSession::default();
    };
    let own_fields = session_fields(&sessions.join(&own));
    let others = fs::read_dir(sessions).ok().map(|entries| {
        let count = entries
            .filter_map(Result::ok)
            .filter(|entry| entry.file_name().to_string_lossy() != own)
            .filter_map(|entry| session_fields(&entry.path()))
            .filter(|fields| {
                fields.get("CLASS").is_none_or(|class| class == "user")
                    && fields
                        .get("STATE")
                        .is_some_and(|state| state == "active" || state == "online")
            })
            .take(1024)
            .count();
        u64::try_from(count).unwrap_or(u64::MAX)
    });
    crate::RawSession {
        on_console: own_fields
            .as_ref()
            .map(|fields| fields.get("ACTIVE").is_some_and(|value| value == "1")),
        locked: None,
        remote: own_fields
            .as_ref()
            .map(|fields| fields.get("REMOTE").is_some_and(|value| value == "1")),
        other_human_sessions: others,
    }
}

/// Virtualization evidence: the DMI system vendor and product, then CPUID on x86-64. Linux evidence
/// recognises guests but never proves physical hardware.
#[must_use]
pub fn virtualization() -> crate::RawVirtualization {
    let read = |name: &str| {
        fs::read_to_string(Path::new("/sys/class/dmi/id").join(name))
            .unwrap_or_default()
            .trim()
            .to_owned()
    };
    let from_dmi = dmi_guest(&read("sys_vendor"), &read("product_name"));
    if from_dmi != crate::RawHypervisor::None {
        return crate::RawVirtualization {
            probed: true,
            guest_of: from_dmi,
            physical_or_root: false,
        };
    }
    #[cfg(target_arch = "x86_64")]
    {
        let mut cpuid = crate::cpuid_virtualization();
        cpuid.physical_or_root = false;
        cpuid
    }
    #[cfg(not(target_arch = "x86_64"))]
    crate::RawVirtualization {
        probed: true,
        guest_of: crate::RawHypervisor::None,
        physical_or_root: false,
    }
}

/// The hypervisor a DMI vendor and product name identify.
#[must_use]
pub fn dmi_guest(vendor: &str, product: &str) -> crate::RawHypervisor {
    use crate::RawHypervisor;
    match (vendor, product) {
        ("QEMU", _) | (_, "KVM") => RawHypervisor::QemuKvm,
        ("VMware, Inc.", _) => RawHypervisor::Vmware,
        ("innotek GmbH", _) | (_, "VirtualBox") => RawHypervisor::VirtualBox,
        ("Xen", _) => RawHypervisor::Xen,
        (_, product) if product.starts_with("Parallels") => RawHypervisor::Parallels,
        ("Microsoft Corporation", "Virtual Machine") => RawHypervisor::HyperV,
        _ => RawHypervisor::None,
    }
}

/// Tunnel and point-to-point interfaces that are up, from `/sys/class/net`.
#[must_use]
pub fn tunnels() -> Option<Vec<crate::RawTunnel>> {
    tunnels_in(Path::new("/sys/class/net"))
}

/// [`tunnels`] against any directory laid out like `/sys/class/net`, for tests.
#[must_use]
pub fn tunnels_in(root: &Path) -> Option<Vec<crate::RawTunnel>> {
    use crate::{RawTunnel, RawTunnelClass, fingerprint};
    /// `IFF_TAP` in `tun_flags`.
    const TAP: u32 = 0x0002;
    let mut tunnels = Vec::new();
    for entry in fs::read_dir(root).ok()?.filter_map(Result::ok).take(256) {
        let path = entry.path();
        let read = |file: &str| fs::read_to_string(path.join(file)).unwrap_or_default();
        let state = read("operstate");
        if !matches!(state.trim(), "up" | "unknown") || entry.file_name() == "lo" {
            continue;
        }
        let class = if let Some(flags) = read("tun_flags").trim().strip_prefix("0x") {
            let flags = u32::from_str_radix(flags, 16).unwrap_or(0);
            if flags & TAP != 0 {
                RawTunnelClass::VirtualEthernet
            } else {
                RawTunnelClass::PacketTunnel
            }
        } else if read("uevent")
            .lines()
            .any(|line| line == "DEVTYPE=wireguard")
        {
            RawTunnelClass::PacketTunnel
        } else if read("type").trim() == "512" {
            RawTunnelClass::PointToPoint
        } else {
            continue;
        };
        tunnels.push(RawTunnel {
            key: fingerprint(entry.file_name().as_encoded_bytes()),
            class,
        });
    }
    tunnels.sort();
    Some(tunnels)
}

/// A fingerprint of the IPv4 and IPv6 routing tables.
#[must_use]
pub fn route_fingerprint() -> Option<u64> {
    let ipv4 = fs::read("/proc/net/route").ok()?;
    let ipv6 = fs::read("/proc/net/ipv6_route").unwrap_or_default();
    Some(crate::fingerprint(&[ipv4, ipv6].concat()))
}

const MAX_STORAGE: usize = 256;

fn trimmed(path: &Path) -> Option<String> {
    fs::read_to_string(path)
        .ok()
        .map(|text| text.trim().to_owned())
}

/// Whether a `/proc/mounts` source names `disk` or one of its partitions (`sdb1`, `mmcblk0p1`).
fn mounts_disk(source: &str, disk: &str) -> bool {
    let Some(rest) = source
        .strip_prefix("/dev/")
        .and_then(|name| name.strip_prefix(disk))
    else {
        return false;
    };
    let rest = rest.strip_prefix('p').unwrap_or(rest);
    rest.bytes().all(|byte| byte.is_ascii_digit())
}

/// Removable, USB, SD and Thunderbolt-attached block devices.
#[must_use]
pub fn block_devices() -> Option<Vec<crate::RawStorageDevice>> {
    let mounts = fs::read_to_string("/proc/mounts").unwrap_or_default();
    block_devices_in(Path::new("/sys/block"), &mounts)
}

/// Reads block devices from a `/sys/block`-shaped tree; `mounts` is `/proc/mounts` content.
#[must_use]
pub fn block_devices_in(root: &Path, mounts: &str) -> Option<Vec<crate::RawStorageDevice>> {
    use crate::{RawStorageDevice, RawStorageKind, RawTransport, fingerprint};
    let sources: Vec<&str> = mounts
        .lines()
        .filter_map(|line| line.split_whitespace().next())
        .collect();
    let mut devices = Vec::new();
    for entry in fs::read_dir(root).ok()?.flatten().take(MAX_STORAGE) {
        let name = entry.file_name().to_string_lossy().into_owned();
        let path = entry.path();
        let topology = fs::canonicalize(&path).unwrap_or_else(|_| path.clone());
        let topology = topology.to_string_lossy();
        let removable = trimmed(&path.join("removable")).as_deref() == Some("1");
        let transport = if topology.contains("/usb") {
            RawTransport::Usb
        } else if topology.contains("/thunderbolt") || topology.contains("/domain") {
            RawTransport::Thunderbolt
        } else if name.starts_with("mmcblk") {
            RawTransport::Sd
        } else if removable {
            RawTransport::Other
        } else {
            continue;
        };
        let writable = trimmed(&path.join("ro")).map(|value| value == "0");
        devices.push(RawStorageDevice {
            key: fingerprint(name.as_bytes()),
            kind: RawStorageKind::Block,
            transport,
            mounted: Some(sources.iter().any(|source| mounts_disk(source, &name))),
            writable,
        });
    }
    devices.sort();
    Some(devices)
}

/// Phones and cameras exposing a still-image USB interface.
#[must_use]
pub fn portable_devices() -> Option<Vec<crate::RawStorageDevice>> {
    portable_devices_in(Path::new("/sys/bus/usb/devices"))
}

/// Reads still-image interfaces from a `/sys/bus/usb/devices`-shaped tree. Interfaces are named
/// `<device>:<config>.<interface>`; interfaces of one device count once.
#[must_use]
pub fn portable_devices_in(root: &Path) -> Option<Vec<crate::RawStorageDevice>> {
    use crate::{RawStorageDevice, RawStorageKind, RawTransport, fingerprint};
    let mut devices = std::collections::BTreeSet::new();
    for entry in fs::read_dir(root).ok()?.flatten().take(MAX_STORAGE * 4) {
        let name = entry.file_name().to_string_lossy().into_owned();
        let Some((device, _)) = name.split_once(':') else {
            continue;
        };
        if trimmed(&entry.path().join("bInterfaceClass")).as_deref() == Some("06") {
            devices.insert(RawStorageDevice {
                key: fingerprint(device.as_bytes()),
                kind: RawStorageKind::Portable,
                transport: RawTransport::Usb,
                mounted: None,
                writable: None,
            });
        }
    }
    Some(devices.into_iter().collect())
}

/// Video capture devices: the first V4L2 node of each device (`index` 0). A device under
/// `/devices/virtual` (v4l2loopback) is not physical. Linux has no OS media consent (device-file
/// access decides), so the permission is granted; other-application use is not readable.
#[must_use]
pub fn cameras() -> crate::RawMedia {
    cameras_in(Path::new("/sys/class/video4linux"))
}

#[must_use]
pub fn cameras_in(root: &Path) -> crate::RawMedia {
    use crate::{RawMedia, RawMediaDevice, RawMediaPermission, fingerprint};
    let devices = fs::read_dir(root).ok().map(|entries| {
        entries
            .flatten()
            .take(MAX_STORAGE)
            .filter(|entry| trimmed(&entry.path().join("index")).is_none_or(|index| index == "0"))
            .map(|entry| {
                let path = entry.path();
                let topology = fs::canonicalize(&path).unwrap_or_else(|_| path.clone());
                let topology = topology.to_string_lossy().into_owned();
                RawMediaDevice {
                    key: fingerprint(entry.file_name().as_encoded_bytes()),
                    physical: !topology.contains("/devices/virtual/"),
                    available: Some(true),
                }
            })
            .collect::<Vec<_>>()
    });
    let mut devices = devices;
    if let Some(devices) = devices.as_mut() {
        devices.sort();
    }
    RawMedia {
        permission: RawMediaPermission::Granted,
        devices,
        in_use_by_other: None,
    }
}

/// ALSA capture devices, and whether any capture substream is running. Sound servers and
/// direct device access both go through ALSA, so a running substream is a recording process.
#[must_use]
pub fn microphones() -> crate::RawMedia {
    microphones_in(Path::new("/proc/asound"))
}

#[must_use]
pub fn microphones_in(root: &Path) -> crate::RawMedia {
    use crate::{RawMedia, RawMediaDevice, RawMediaPermission, fingerprint};
    let Ok(cards) = fs::read_dir(root) else {
        return RawMedia::unavailable();
    };
    let mut devices = Vec::new();
    let mut running = false;
    for card in cards.flatten().take(64) {
        let card_name = card.file_name().to_string_lossy().into_owned();
        if !card_name.starts_with("card") {
            continue;
        }
        let Ok(pcms) = fs::read_dir(card.path()) else {
            continue;
        };
        for pcm in pcms.flatten().take(64) {
            let name = pcm.file_name().to_string_lossy().into_owned();
            if !(name.starts_with("pcm") && name.ends_with('c')) {
                continue;
            }
            devices.push(RawMediaDevice {
                key: fingerprint(format!("{card_name}/{name}").as_bytes()),
                physical: true,
                available: Some(true),
            });
            let Ok(substreams) = fs::read_dir(pcm.path()) else {
                continue;
            };
            for substream in substreams.flatten().take(64) {
                running |= fs::read_to_string(substream.path().join("status"))
                    .is_ok_and(|status| status.contains("state: RUNNING"));
            }
        }
    }
    devices.sort();
    devices.truncate(64);
    RawMedia {
        permission: RawMediaPermission::Granted,
        devices: Some(devices),
        in_use_by_other: Some(running),
    }
}

/// Every process of the account the agent runs as, from `/proc`.
#[must_use]
pub fn processes() -> Option<Vec<crate::RawProcess>> {
    processes_in(Path::new("/proc"), current_uid()?)
}

fn current_uid() -> Option<u32> {
    let status = fs::read_to_string("/proc/self/status").ok()?;
    status_field(&status, "Uid:")
}

fn status_field(status: &str, name: &str) -> Option<u32> {
    status
        .lines()
        .find_map(|line| line.strip_prefix(name))?
        .split_whitespace()
        .next()?
        .parse()
        .ok()
}

#[must_use]
pub fn processes_in(root: &Path, uid: u32) -> Option<Vec<crate::RawProcess>> {
    let mut processes = Vec::new();
    for entry in fs::read_dir(root).ok()?.flatten().take(32_768) {
        let Ok(pid) = entry.file_name().to_string_lossy().parse::<u32>() else {
            continue;
        };
        let Ok(status) = fs::read_to_string(entry.path().join("status")) else {
            continue;
        };
        if status_field(&status, "Uid:") != Some(uid) {
            continue;
        }
        // The 22nd field of `stat` is the start time; the command name before it may hold spaces.
        let start = fs::read_to_string(entry.path().join("stat"))
            .ok()
            .and_then(|stat| stat.rsplit_once(')').map(|(_, rest)| rest.to_owned()))
            .and_then(|rest| rest.split_whitespace().nth(19).map(str::to_owned))
            .unwrap_or_default();
        processes.push(crate::RawProcess {
            instance: crate::fingerprint(format!("{pid}:{start}").as_bytes()),
            pid,
            parent: status_field(&status, "PPid:").unwrap_or(0),
        });
    }
    Some(processes)
}

/// The executable's file name: Linux has no code identity.
#[must_use]
pub fn identity(pid: u32) -> crate::RawIdentity {
    fs::read_link(format!("/proc/{pid}/exe"))
        .ok()
        .and_then(|path| {
            path.file_name()
                .map(|name| name.to_string_lossy().into_owned())
        })
        .map_or(crate::RawIdentity::Unavailable, |executable| {
            crate::RawIdentity::Linux {
                executable: executable.trim_end_matches(" (deleted)").to_owned(),
            }
        })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn connector(root: &Path, name: &str, status: &str, enabled: &str) {
        let path = root.join(name);
        fs::create_dir_all(&path).expect("fixture directory");
        fs::write(path.join("status"), format!("{status}\n")).expect("fixture status");
        fs::write(path.join("enabled"), format!("{enabled}\n")).expect("fixture enabled");
    }

    #[test]
    fn only_connected_connectors_are_displays_and_panels_are_built_in() {
        let root = std::env::temp_dir().join(format!("prctr-drm-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(root.join("card0")).expect("device");
        connector(&root, "card0-eDP-1", "connected", "enabled");
        connector(&root, "card0-HDMI-A-1", "disconnected", "disabled");
        connector(&root, "card0-DP-1", "connected", "disabled");
        connector(&root, "card0-Virtual-1", "connected", "enabled");
        let displays = connected_displays_in(&root).expect("reads fixture");
        let _ = fs::remove_dir_all(&root);
        assert!(!displays.mirroring_known);
        let displays = displays.displays;
        assert_eq!(displays.len(), 3);
        assert!(
            displays
                .iter()
                .any(|display| display.kind == RawKind::BuiltIn && display.active)
        );
        assert!(
            displays
                .iter()
                .any(|display| display.kind == RawKind::External && !display.active)
        );
        assert!(
            displays
                .iter()
                .any(|display| display.kind == RawKind::Virtual)
        );
    }
}

#[cfg(test)]
mod network_tests {
    use super::*;

    #[test]
    fn tun_tap_wireguard_and_ppp_are_tunnels_and_ethernet_is_not() {
        let root = std::env::temp_dir().join(format!("prctr-net-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        let interface = |name: &str, files: &[(&str, &str)]| {
            let path = root.join(name);
            fs::create_dir_all(&path).expect("fixture interface");
            for (file, content) in files {
                fs::write(path.join(file), content).expect("fixture file");
            }
        };
        interface(
            "tun0",
            &[("operstate", "unknown\n"), ("tun_flags", "0x1001\n")],
        );
        interface("tap0", &[("operstate", "up\n"), ("tun_flags", "0x1002\n")]);
        interface(
            "wg0",
            &[
                ("operstate", "unknown\n"),
                ("uevent", "DEVTYPE=wireguard\n"),
            ],
        );
        interface("ppp0", &[("operstate", "up\n"), ("type", "512\n")]);
        interface("eth0", &[("operstate", "up\n"), ("type", "1\n")]);
        interface(
            "tun9",
            &[("operstate", "down\n"), ("tun_flags", "0x1001\n")],
        );
        let tunnels = tunnels_in(&root).expect("reads fixture");
        let _ = fs::remove_dir_all(&root);
        assert_eq!(tunnels.len(), 4, "eth0 and the down tun9 are not counted");
    }
}

#[cfg(test)]
mod storage_tests {
    use super::*;
    use crate::{RawStorageKind, RawTransport};

    fn fixture(name: &str) -> std::path::PathBuf {
        let root = std::env::temp_dir().join(format!("prctr-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).expect("fixture root");
        root
    }

    fn disk(root: &Path, devices: &Path, name: &str, topology: &str, removable: &str, ro: &str) {
        let target = devices.join(topology).join(name);
        fs::create_dir_all(&target).expect("fixture device");
        fs::write(target.join("removable"), format!("{removable}\n")).expect("removable");
        fs::write(target.join("ro"), format!("{ro}\n")).expect("ro");
        std::os::unix::fs::symlink(&target, root.join(name)).expect("fixture link");
    }

    #[test]
    fn usb_sd_and_removable_disks_count_and_internal_ones_do_not() {
        let base = fixture("block");
        let (root, devices) = (base.join("block"), base.join("devices"));
        fs::create_dir_all(&root).expect("block root");
        disk(
            &root,
            &devices,
            "nvme0n1",
            "pci0000:00/0000:00:1d.0/nvme",
            "0",
            "0",
        );
        disk(
            &root,
            &devices,
            "sdb",
            "pci0000:00/0000:00:14.0/usb2/2-1",
            "1",
            "0",
        );
        disk(&root, &devices, "mmcblk0", "platform/mmc0", "0", "1");
        disk(&root, &devices, "sr0", "pci0000:00/ata1", "1", "1");
        disk(&root, &devices, "loop0", "virtual/block", "0", "0");
        let mounts = "/dev/nvme0n1p2 / ext4 rw 0 0\n/dev/sdb1 /media/x vfat rw 0 0\n";
        let found = block_devices_in(&root, mounts).expect("reads fixture");
        let _ = fs::remove_dir_all(&base);
        assert_eq!(
            found.len(),
            3,
            "the NVMe system disk and the loop device are not removable"
        );
        let usb = found
            .iter()
            .find(|device| device.transport == RawTransport::Usb)
            .expect("usb");
        assert_eq!((usb.mounted, usb.writable), (Some(true), Some(true)));
        let sd = found
            .iter()
            .find(|device| device.transport == RawTransport::Sd)
            .expect("sd");
        assert_eq!((sd.mounted, sd.writable), (Some(false), Some(false)));
        assert!(
            found
                .iter()
                .all(|device| device.kind == RawStorageKind::Block)
        );
    }

    #[test]
    fn a_partition_source_matches_only_its_own_disk() {
        assert!(mounts_disk("/dev/sdb1", "sdb"));
        assert!(mounts_disk("/dev/sdb", "sdb"));
        assert!(mounts_disk("/dev/mmcblk0p1", "mmcblk0"));
        assert!(!mounts_disk("/dev/sdba1", "sdb"));
        assert!(!mounts_disk("tmpfs", "sdb"));
    }

    #[test]
    fn interfaces_of_one_still_image_device_count_once() {
        let root = fixture("usb");
        let interface = |name: &str, class: &str| {
            fs::create_dir_all(root.join(name)).expect("interface");
            fs::write(
                root.join(name).join("bInterfaceClass"),
                format!("{class}\n"),
            )
            .expect("class");
        };
        interface("1-2:1.0", "06");
        interface("1-2:1.1", "06");
        interface("1-3:1.0", "08");
        fs::create_dir_all(root.join("usb1")).expect("hub");
        let found = portable_devices_in(&root).expect("reads fixture");
        let _ = fs::remove_dir_all(&root);
        assert_eq!(found.len(), 1);
        assert_eq!(found[0].kind, RawStorageKind::Portable);
    }
}

#[cfg(test)]
mod media_tests {
    use super::*;

    #[test]
    fn one_camera_per_device_and_loopback_is_virtual() {
        let base = std::env::temp_dir().join(format!("prctr-v4l-{}", std::process::id()));
        let _ = fs::remove_dir_all(&base);
        let (root, devices) = (base.join("class"), base.join("devices"));
        fs::create_dir_all(&root).expect("root");
        for (name, topology, index) in [
            ("video0", "pci0000:00/usb1/1-1/video4linux", "0"),
            ("video1", "pci0000:00/usb1/1-1/video4linux", "1"),
            ("video2", "devices/virtual/video4linux", "0"),
        ] {
            let target = devices.join(topology).join(name);
            fs::create_dir_all(&target).expect("device");
            fs::write(target.join("index"), format!("{index}\n")).expect("index");
            std::os::unix::fs::symlink(&target, root.join(name)).expect("link");
        }
        let media = cameras_in(&root);
        let _ = fs::remove_dir_all(&base);
        let devices = media.devices.expect("listed");
        assert_eq!(devices.len(), 2, "the metadata node is not a second camera");
        assert_eq!(devices.iter().filter(|device| device.physical).count(), 1);
    }

    #[test]
    fn capture_pcms_are_microphones_and_a_running_substream_is_in_use() {
        let root = std::env::temp_dir().join(format!("prctr-asound-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        for (pcm, state) in [
            ("card0/pcm0c/sub0", "closed"),
            ("card0/pcm0p/sub0", "RUNNING"),
            ("card1/pcm0c/sub0", "RUNNING"),
        ] {
            fs::create_dir_all(root.join(pcm)).expect("pcm");
            fs::write(root.join(pcm).join("status"), format!("state: {state}\n")).expect("status");
        }
        let media = microphones_in(&root);
        let _ = fs::remove_dir_all(&root);
        assert_eq!(
            media.devices.map(|devices| devices.len()),
            Some(2),
            "playback is not capture"
        );
        assert_eq!(media.in_use_by_other, Some(true));
    }
}

#[cfg(test)]
mod process_tests {
    use super::*;

    #[test]
    fn only_the_accounts_processes_are_listed_and_start_times_make_instances() {
        let root = std::env::temp_dir().join(format!("prctr-proc-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        for (pid, uid, start) in [(10, 1000, 500), (11, 0, 600), (12, 1000, 700)] {
            let path = root.join(pid.to_string());
            fs::create_dir_all(&path).expect("pid");
            fs::write(
                path.join("status"),
                format!("Name:\tx\nPPid:\t1\nUid:\t{uid}\t{uid}\t{uid}\t{uid}\n"),
            )
            .expect("status");
            let fields = (0..19).map(|_| "0").collect::<Vec<_>>().join(" ");
            fs::write(
                path.join("stat"),
                format!("{pid} (a b) S {fields} {start} 0\n"),
            )
            .expect("stat");
        }
        fs::create_dir_all(root.join("self")).expect("self");
        let listed = processes_in(&root, 1000).expect("reads fixture");
        let _ = fs::remove_dir_all(&root);
        assert_eq!(listed.len(), 2);
        assert!(listed.iter().all(|process| process.parent == 1));
        assert_ne!(listed[0].instance, listed[1].instance);
    }
}

/// Nanoseconds this machine has spent suspended since boot: the boot clock counts suspend, the
/// monotonic clock does not.
#[must_use]
pub fn suspended_ns() -> Option<u64> {
    let read = |clock| {
        let mut time = libc::timespec {
            tv_sec: 0,
            tv_nsec: 0,
        };
        // SAFETY: `time` is a valid out-parameter for a supported clock.
        (unsafe { libc::clock_gettime(clock, &raw mut time) } == 0).then(|| {
            u64::try_from(time.tv_sec).unwrap_or(0) * 1_000_000_000
                + u64::try_from(time.tv_nsec).unwrap_or(0)
        })
    };
    let awake = read(libc::CLOCK_MONOTONIC)?;
    let total = read(libc::CLOCK_BOOTTIME)?;
    Some(total.saturating_sub(awake))
}
