use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};
#[cfg(target_os = "linux")]
use std::time::Duration;

use prctr_native_protocol::{
    DisplayPowerState, DisplayPrimaryState, DisplayTarget, DisplayTargetKind,
    DisplayTopologySnapshot, MAX_DISPLAY_TARGETS, ProtocolValidationError, ProtocolViolation,
    TopologyCertainty,
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
use prctr_native_source_runtime::{
    BoundedFileReadError, read_bounded_file, read_bounded_utf8_file,
};

#[cfg(target_os = "linux")]
const DRM_ROOT: &str = "/sys/class/drm";
#[cfg(target_os = "linux")]
const POLL_INTERVAL: Duration = Duration::from_secs(1);
const MAX_DRM_CONNECTOR_RECORDS: usize = 4_096;
const MAX_DRM_SYSFS_FACT_BYTES: usize = 4_096;
const MAX_DRM_EDID_BYTES: usize = 32 * 1024;

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
            PollingSubscription::start(&emitter, POLL_INTERVAL, enumerate_topology)?;
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
    for entry in entries {
        let entry = entry.map_err(|error| {
            DisplayTopologyError::Backend(format!(
                "cannot inspect one DRM connector entry: {error}"
            ))
        })?;
        let path = entry.path();
        let status_path = path.join("status");
        if !is_file(&status_path)? {
            continue;
        }
        scanned_connectors += 1;
        if scanned_connectors > MAX_DRM_CONNECTOR_RECORDS {
            return Err(DisplayTopologyError::InventoryOverflow(format!(
                "DRM exposed more than {MAX_DRM_CONNECTOR_RECORDS} raw connector records"
            )));
        }
        let status = read_trimmed(&status_path, "connector_status")?.ok_or_else(|| {
            DisplayTopologyError::Backend(
                "DRM connector status disappeared during enumeration".to_owned(),
            )
        })?;
        if !connector_is_reportable(&status)? {
            continue;
        }
        connector_paths.push(path);
        if connector_paths.len() > MAX_DISPLAY_TARGETS {
            return Err(DisplayTopologyError::InventoryOverflow(format!(
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
            .ok_or_else(|| {
                display_protocol_error("connector_name", "valid UTF-8 connector identifier")
            })?
            .to_owned();
        if let Some(crtc_id) = parse_crtc_id(read_trimmed(&path.join("crtc_id"), "crtc_id")?)? {
            crtc_groups
                .entry(crtc_id.to_string())
                .or_default()
                .push(target_id.clone());
        }
        let enabled = read_trimmed(&path.join("enabled"), "connector_enabled")?;
        let active = parse_connector_enabled(enabled.as_deref())?;
        let (pixel_width, pixel_height) =
            parse_connector_modes(read_trimmed(&path.join("modes"), "connector_modes")?)?;
        let connector_name = target_id
            .split_once('-')
            .map_or(target_id.as_str(), |(_, name)| name);
        let builtin = is_builtin_connector(connector_name);
        let kind = classify_connector(path, connector_name, builtin)?;
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

fn is_file(path: &Path) -> Result<bool, DisplayTopologyError> {
    match fs::metadata(path) {
        Ok(metadata) => Ok(metadata.is_file()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(false),
        Err(error) => Err(DisplayTopologyError::Backend(format!(
            "cannot inspect DRM connector fact {}: {error}",
            path.display()
        ))),
    }
}

fn read_trimmed(path: &Path, field: &'static str) -> Result<Option<String>, DisplayTopologyError> {
    match read_bounded_utf8_file(path, MAX_DRM_SYSFS_FACT_BYTES) {
        Ok(value) => Ok(Some(value.trim().to_owned())),
        Err(BoundedFileReadError::Io(error)) if error.kind() == std::io::ErrorKind::NotFound => {
            Ok(None)
        }
        Err(error) => Err(map_drm_file_error(error, path, field)),
    }
}

fn map_drm_file_error(
    error: BoundedFileReadError,
    path: &Path,
    field: &'static str,
) -> DisplayTopologyError {
    match error {
        BoundedFileReadError::Io(error) => DisplayTopologyError::Backend(format!(
            "cannot read DRM connector fact {}: {error}",
            path.display()
        )),
        BoundedFileReadError::Overflow { .. } => DisplayTopologyError::InventoryOverflow(format!(
            "DRM connector fact {} exceeds the source bound",
            path.display()
        )),
        BoundedFileReadError::InvalidUtf8 => {
            display_protocol_error(field, "valid UTF-8 bounded sysfs fact")
        }
    }
}

fn display_protocol_error(field: &'static str, rule: &'static str) -> DisplayTopologyError {
    DisplayTopologyError::Protocol(ProtocolViolation::Schema(ProtocolValidationError {
        type_name: "LinuxDisplayTopologyAdapter",
        field,
        rule,
    }))
}

fn connector_is_reportable(status: &str) -> Result<bool, DisplayTopologyError> {
    match status {
        "connected" | "unknown" => Ok(true),
        "disconnected" => Ok(false),
        _ => Err(display_protocol_error(
            "connector_status",
            "documented DRM connector status",
        )),
    }
}

fn parse_connector_enabled(value: Option<&str>) -> Result<bool, DisplayTopologyError> {
    match value {
        None | Some("disabled") => Ok(false),
        Some("enabled") => Ok(true),
        Some(_) => Err(display_protocol_error(
            "connector_enabled",
            "documented DRM connector enabled state",
        )),
    }
}

fn parse_crtc_id(value: Option<String>) -> Result<Option<u32>, DisplayTopologyError> {
    let Some(value) = value else {
        return Ok(None);
    };
    let parsed = value.parse::<u32>().map_err(|_error| {
        display_protocol_error("crtc_id", "canonical numeric DRM CRTC identifier")
    })?;
    if value != parsed.to_string() {
        return Err(display_protocol_error(
            "crtc_id",
            "canonical numeric DRM CRTC identifier",
        ));
    }
    Ok((parsed != 0).then_some(parsed))
}

fn parse_connector_modes(value: Option<String>) -> Result<(u32, u32), DisplayTopologyError> {
    let Some(value) = value else {
        return Ok((0, 0));
    };
    let Some(mode) = value.lines().find(|line| !line.is_empty()) else {
        return Ok((0, 0));
    };
    let (width, height) = mode
        .split_once('x')
        .ok_or_else(|| display_protocol_error("connector_modes", "WIDTHxHEIGHT first DRM mode"))?;
    if width.is_empty() || height.is_empty() || height.contains('x') {
        return Err(display_protocol_error(
            "connector_modes",
            "WIDTHxHEIGHT first DRM mode",
        ));
    }
    let width = width.parse::<u32>().map_err(|_error| {
        display_protocol_error("connector_modes", "numeric WIDTHxHEIGHT first DRM mode")
    })?;
    let height = height.parse::<u32>().map_err(|_error| {
        display_protocol_error("connector_modes", "numeric WIDTHxHEIGHT first DRM mode")
    })?;
    if width == 0 || height == 0 {
        return Err(display_protocol_error(
            "connector_modes",
            "positive WIDTHxHEIGHT first DRM mode",
        ));
    }
    Ok((width, height))
}

fn is_builtin_connector(name: &str) -> bool {
    ["eDP", "LVDS", "DSI"]
        .iter()
        .any(|prefix| name.starts_with(prefix))
}

fn classify_connector(
    path: &Path,
    name: &str,
    builtin: bool,
) -> Result<DisplayTargetKind, DisplayTopologyError> {
    if name.starts_with("Virtual") {
        return Ok(DisplayTargetKind::Virtual);
    }
    if name.starts_with("Writeback") {
        return Ok(DisplayTargetKind::Specialized);
    }
    if builtin {
        return Ok(DisplayTargetKind::Physical);
    }
    let edid_path = path.join("edid");
    let has_edid = read_edid_presence(&edid_path)?;
    if has_edid {
        return Ok(DisplayTargetKind::Physical);
    }
    Ok(DisplayTargetKind::Unknown)
}

fn read_edid_presence(path: &Path) -> Result<bool, DisplayTopologyError> {
    match read_bounded_file(path, MAX_DRM_EDID_BYTES) {
        Ok(contents) => Ok(!contents.is_empty()),
        Err(BoundedFileReadError::Io(error)) if error.kind() == std::io::ErrorKind::NotFound => {
            Ok(false)
        }
        Err(BoundedFileReadError::Io(error)) => Err(DisplayTopologyError::Backend(format!(
            "cannot read DRM connector EDID {}: {error}",
            path.display()
        ))),
        Err(BoundedFileReadError::Overflow { .. }) => {
            Err(DisplayTopologyError::InventoryOverflow(format!(
                "DRM connector EDID {} exceeds the source bound",
                path.display()
            )))
        }
        Err(BoundedFileReadError::InvalidUtf8) => Err(display_protocol_error(
            "connector_edid",
            "bounded binary EDID content",
        )),
    }
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

    #[test]
    fn bounded_sysfs_failures_preserve_terminal_categories() {
        let path = Path::new("/sys/class/drm/card0-eDP-1/status");
        assert!(matches!(
            map_drm_file_error(
                BoundedFileReadError::Overflow {
                    max_bytes: MAX_DRM_SYSFS_FACT_BYTES,
                },
                path,
                "connector_status",
            ),
            DisplayTopologyError::InventoryOverflow(_)
        ));
        assert!(matches!(
            map_drm_file_error(BoundedFileReadError::InvalidUtf8, path, "connector_status",),
            DisplayTopologyError::Protocol(_)
        ));
    }

    #[test]
    fn malformed_authoritative_connector_values_are_terminal_protocol_results() {
        assert!(matches!(
            connector_is_reportable("garbage"),
            Err(DisplayTopologyError::Protocol(_))
        ));
        assert!(matches!(
            parse_connector_enabled(Some("maybe")),
            Err(DisplayTopologyError::Protocol(_))
        ));
        assert!(matches!(
            parse_crtc_id(Some("controller".to_owned())),
            Err(DisplayTopologyError::Protocol(_))
        ));
        assert!(matches!(
            parse_crtc_id(Some("007".to_owned())),
            Err(DisplayTopologyError::Protocol(_))
        ));
        assert!(matches!(
            parse_connector_modes(Some("not-a-mode".to_owned())),
            Err(DisplayTopologyError::Protocol(_))
        ));
        assert!(!parse_connector_enabled(None).expect("optional enabled"));
        assert_eq!(parse_crtc_id(None).expect("optional CRTC"), None);
        assert_eq!(parse_connector_modes(None).expect("optional modes"), (0, 0));
    }

    #[test]
    fn edid_classification_uses_actual_bounded_content() {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("time after epoch")
            .as_nanos();
        let connector = std::env::temp_dir().join(format!("prctr-drm-edid-{unique}"));
        fs::create_dir_all(&connector).expect("create connector");
        let edid = connector.join("edid");

        assert_eq!(
            classify_connector(&connector, "HDMI-A-1", false).expect("missing EDID is optional"),
            DisplayTargetKind::Unknown,
        );
        fs::write(&edid, []).expect("write empty EDID");
        assert_eq!(
            classify_connector(&connector, "HDMI-A-1", false).expect("read empty EDID"),
            DisplayTargetKind::Unknown,
        );
        fs::write(&edid, [1_u8]).expect("write present EDID");
        assert_eq!(
            classify_connector(&connector, "HDMI-A-1", false).expect("read present EDID"),
            DisplayTargetKind::Physical,
        );
        fs::write(&edid, vec![0_u8; MAX_DRM_EDID_BYTES + 1]).expect("write oversized EDID");
        assert_eq!(
            classify_connector(&connector, "eDP-1", true)
                .expect("built-in connector does not query EDID"),
            DisplayTargetKind::Physical,
        );
        assert!(matches!(
            classify_connector(&connector, "HDMI-A-1", false),
            Err(DisplayTopologyError::InventoryOverflow(_))
        ));

        fs::remove_dir_all(connector).expect("remove fixture");
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
