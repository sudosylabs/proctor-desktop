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
