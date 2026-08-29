use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};
#[cfg(target_os = "linux")]
use std::time::Duration;

use prctr_native_protocol::{
    DisplayPowerState, DisplayPrimaryState, DisplayTarget, DisplayTargetKind,
    DisplayTopologySnapshot, MAX_DISPLAY_TARGETS, TopologyCertainty,
};
#[cfg(target_os = "linux")]
use prctr_native_protocol::{PermissionState, PlatformFamily};

#[cfg(target_os = "linux")]
use super::polling::PollingSubscription;
use crate::DisplayTopologyError;
#[cfg(target_os = "linux")]
use crate::{
    DisplayTopologyBackend, DisplayTopologyEmitter, OpenedDisplayTopologyBackend,
    OpenedSourceHealth, prefer_cleanup_error,
};

#[cfg(target_os = "linux")]
const DRM_ROOT: &str = "/sys/class/drm";
#[cfg(target_os = "linux")]
const POLL_INTERVAL: Duration = Duration::from_secs(1);
const MAX_DRM_CONNECTOR_RECORDS: usize = 4_096;

#[cfg(target_os = "linux")]
pub struct LinuxDisplayTopologyBackend;

#[cfg(target_os = "linux")]
impl DisplayTopologyBackend for LinuxDisplayTopologyBackend {
    type Subscription = PollingSubscription;

    fn open(
        self,
        emitter: DisplayTopologyEmitter,
    ) -> Result<OpenedDisplayTopologyBackend<Self::Subscription>, DisplayTopologyError> {
        let mut subscription =
            PollingSubscription::start(emitter, POLL_INTERVAL, enumerate_topology)?;
        let initial_topology = match enumerate_topology() {
            Ok(topology) => topology,
            Err(error) => {
                return Err(prefer_cleanup_error(error, subscription.stop_resources()));
            }
        };
        Ok(OpenedDisplayTopologyBackend {
            platform: PlatformFamily::Linux,
            permission: PermissionState::Granted,
            health: OpenedSourceHealth::Degraded,
            adapter_version: "drm-sysfs-v1",
            initial_topology,
            subscription,
        })
    }
}

#[cfg(target_os = "linux")]
fn enumerate_topology() -> Result<DisplayTopologySnapshot, DisplayTopologyError> {
    enumerate_drm(Path::new(DRM_ROOT))
}

fn enumerate_drm(root: &Path) -> Result<DisplayTopologySnapshot, DisplayTopologyError> {
    let entries = fs::read_dir(root).map_err(|error| {
        DisplayTopologyError::Backend(format!("cannot read {}: {error}", root.display()))
    })?;
    let mut connector_paths = Vec::<PathBuf>::new();
    let mut scanned_connectors = 0_usize;
    for entry in entries.filter_map(Result::ok) {
        let path = entry.path();
        let status_path = path.join("status");
        if !status_path.is_file() {
            continue;
        }
        scanned_connectors += 1;
        if scanned_connectors > MAX_DRM_CONNECTOR_RECORDS {
            return Err(DisplayTopologyError::Backend(format!(
                "DRM exposed more than {MAX_DRM_CONNECTOR_RECORDS} raw connector records"
            )));
        }
        let status = read_trimmed(&status_path).unwrap_or_else(|| "unknown".to_owned());
        if status == "disconnected" {
            continue;
        }
        connector_paths.push(path);
        if connector_paths.len() > MAX_DISPLAY_TARGETS {
            return Err(DisplayTopologyError::Backend(format!(
                "DRM exposed more than {MAX_DISPLAY_TARGETS} reportable display targets"
            )));
        }
    }
    connector_paths.sort();

    let mut targets = Vec::new();
    let mut crtc_groups: BTreeMap<String, Vec<String>> = BTreeMap::new();
    for path in &connector_paths {
        let target_id = path
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("unknown-connector")
            .to_owned();
        if let Some(crtc_id) = read_trimmed(&path.join("crtc_id")).filter(|value| value != "0") {
            crtc_groups
                .entry(crtc_id)
                .or_default()
                .push(target_id.clone());
        }
        let active = read_trimmed(&path.join("enabled")).is_some_and(|value| value == "enabled");
        let (pixel_width, pixel_height) = read_trimmed(&path.join("modes"))
            .and_then(|modes| modes.lines().next().and_then(parse_mode))
            .unwrap_or((0, 0));
        let connector_name = target_id
            .split_once('-')
            .map_or(target_id.as_str(), |(_, name)| name);
        let builtin = is_builtin_connector(connector_name);
        let kind = classify_connector(path, connector_name, builtin);
        targets.push(DisplayTarget {
            target_id,
            active,
            primary_state: DisplayPrimaryState::Unknown,
            builtin,
            power_state: DisplayPowerState::Unknown,
            kind,
            mirror_primary_id: None,
            pixel_width,
            pixel_height,
        });
    }

    for group in crtc_groups.values_mut() {
        if group.len() < 2 {
            continue;
        }
        group.sort();
        let primary = group[0].clone();
        for target in &mut targets {
            if target.target_id != primary && group.contains(&target.target_id) {
                target.mirror_primary_id = Some(primary.clone());
            }
        }
    }

    Ok(DisplayTopologySnapshot {
        certainty: TopologyCertainty::Partial,
        targets,
    })
}

fn read_trimmed(path: &Path) -> Option<String> {
    fs::read_to_string(path)
        .ok()
        .map(|value| value.trim().to_owned())
}

fn parse_mode(mode: &str) -> Option<(u32, u32)> {
    let (width, height) = mode.split_once('x')?;
    Some((width.parse().ok()?, height.parse().ok()?))
}

fn is_builtin_connector(name: &str) -> bool {
    ["eDP", "LVDS", "DSI"]
        .iter()
        .any(|prefix| name.starts_with(prefix))
}

fn classify_connector(path: &Path, name: &str, builtin: bool) -> DisplayTargetKind {
    if name.starts_with("Virtual") {
        return DisplayTargetKind::Virtual;
    }
    if name.starts_with("Writeback") {
        return DisplayTargetKind::Specialized;
    }
    if builtin || fs::metadata(path.join("edid")).is_ok_and(|metadata| metadata.len() > 0) {
        return DisplayTargetKind::Physical;
    }
    DisplayTargetKind::Unknown
}

#[cfg(test)]
mod tests {
    use super::*;
    #[cfg(target_os = "linux")]
    use crate::assert_adapter_baseline_conformance;
    use std::time::{SystemTime, UNIX_EPOCH};

    #[cfg(target_os = "linux")]
    #[test]
    fn real_drm_source_passes_baseline_conformance() {
        assert_adapter_baseline_conformance(LinuxDisplayTopologyBackend, PlatformFamily::Linux);
    }

    #[test]
    fn drm_fixture_reports_connected_targets_and_mirroring() {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("time after epoch")
            .as_nanos();
        let root = std::env::temp_dir().join(format!("prctr-drm-{unique}"));
        let first = root.join("card0-eDP-1");
        let second = root.join("card0-HDMI-A-1");
        fs::create_dir_all(&first).expect("create first connector");
        fs::create_dir_all(&second).expect("create second connector");
        write_fixture(&first, "connected", "enabled", "1920x1080", "7", true);
        write_fixture(&second, "connected", "enabled", "1920x1080", "7", true);

        let topology = enumerate_drm(&root).expect("enumerate fixture");
        assert_eq!(topology.targets.len(), 2);
        assert!(
            topology
                .targets
                .iter()
                .all(|target| target.kind == DisplayTargetKind::Physical)
        );
        assert!(
            topology
                .targets
                .iter()
                .any(|target| target.target_id == "card0-eDP-1" && target.builtin)
        );
        assert_eq!(
            topology
                .targets
                .iter()
                .filter(|target| target.mirror_primary_id.is_some())
                .count(),
            1
        );
        fs::remove_dir_all(root).expect("remove fixture");
    }

    #[test]
    fn disconnected_connectors_do_not_consume_the_protocol_target_limit() {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("time after epoch")
            .as_nanos();
        let root = std::env::temp_dir().join(format!("prctr-drm-disconnected-{unique}"));
        for index in 0..=MAX_DISPLAY_TARGETS {
            let connector = root.join(format!("card0-HDMI-A-{index}"));
            fs::create_dir_all(&connector).expect("create disconnected connector");
            write_fixture(&connector, "disconnected", "disabled", "", "0", false);
        }
        let connected = root.join("card0-eDP-1");
        fs::create_dir_all(&connected).expect("create connected connector");
        write_fixture(&connected, "connected", "enabled", "1920x1080", "1", true);

        let topology = enumerate_drm(&root).expect("enumerate fixture");
        assert_eq!(topology.targets.len(), 1);
        assert_eq!(topology.targets[0].target_id, "card0-eDP-1");
        fs::remove_dir_all(root).expect("remove fixture");
    }

    fn write_fixture(
        connector: &Path,
        status: &str,
        enabled: &str,
        modes: &str,
        crtc_id: &str,
        edid: bool,
    ) {
        fs::write(connector.join("status"), status).expect("write status");
        fs::write(connector.join("enabled"), enabled).expect("write enabled");
        fs::write(connector.join("modes"), modes).expect("write modes");
        fs::write(connector.join("crtc_id"), crtc_id).expect("write crtc");
        if edid {
            fs::write(connector.join("edid"), [1_u8]).expect("write edid");
        }
    }
}
