use std::fs;
use std::hash::{Hash, Hasher};
use std::path::Path;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use crate::{
    NetworkConfigurationCategory, NetworkConfigurationSelection, NetworkConfigurationWire,
};
use native_protocol::{
    NetworkActivityState, NetworkConfigurationCertainty, NetworkConfigurationCoverage,
    NetworkConfigurationState, NetworkTunnelClass, PermissionState, PlatformFamily,
    ProtocolValidationError, ProtocolViolation,
};
use native_source_runtime::{
    BoundedFileReadError, InitialFallbackPollingSubscription, OpenedPassiveStateBackend,
    PassiveStateBackend, PassiveStateEmitter, PassiveStateSourceError, PassiveStateWire,
    PollingPassiveStateBackend, read_bounded_file, read_bounded_utf8_file,
};

use super::identity::{NetworkStateTracker, RawTunnelInterface};

const NETWORK_ROOT: &str = "/sys/class/net";
const ROUTE_TABLE: &str = "/proc/net/route";
const MAX_RAW_INTERFACES: usize = 4_096;
const MAX_ROUTE_TABLE_BYTES: usize = 4 * 1024 * 1024;
const MAX_SYSFS_FACT_BYTES: usize = 4_096;

pub struct PlatformNetworkConfigurationBackend {
    selection: NetworkConfigurationSelection,
}

impl PlatformNetworkConfigurationBackend {
    #[must_use]
    pub const fn new(selection: NetworkConfigurationSelection) -> Self {
        Self { selection }
    }
}

impl PassiveStateBackend<NetworkConfigurationWire> for PlatformNetworkConfigurationBackend {
    type Subscription = InitialFallbackPollingSubscription<NetworkConfigurationWire>;

    fn open(
        self,
        emitter: PassiveStateEmitter<NetworkConfigurationWire>,
    ) -> Result<
        OpenedPassiveStateBackend<NetworkConfigurationWire, Self::Subscription>,
        PassiveStateSourceError,
    > {
        let selection = self.selection;
        let tracker = Arc::new(Mutex::new(NetworkStateTracker::default()));
        let query_tracker = Arc::clone(&tracker);
        PollingPassiveStateBackend::new(
            PlatformFamily::Linux,
            PermissionState::Granted,
            "linux-network-topology-v1",
            Duration::from_millis(500),
            move || {
                query_state(
                    &query_tracker,
                    selection,
                    Path::new(NETWORK_ROOT),
                    Path::new(ROUTE_TABLE),
                )
            },
        )
        .open_with_initial_backend_fallback(
            emitter,
            "linux-network-unavailable-v1",
            NetworkConfigurationWire::unavailable_state(),
        )
    }
}

fn query_state(
    tracker: &Mutex<NetworkStateTracker>,
    selection: NetworkConfigurationSelection,
    network_root: &Path,
    route_table: &Path,
) -> Result<NetworkConfigurationState, PassiveStateSourceError> {
    if !selection.requires_topology() {
        return tracker
            .lock()
            .map_err(|_poisoned| {
                PassiveStateSourceError::Backend(
                    "Linux network state tracker lock was poisoned".to_owned(),
                )
            })?
            .state(
                NetworkConfigurationCoverage::PartialConfiguration,
                NetworkConfigurationCertainty::Partial,
                NetworkActivityState::Unknown,
                NetworkActivityState::Unknown,
                None,
                Vec::new(),
            );
    }
    let mut interfaces = Vec::new();
    let mut active_interfaces = Vec::new();
    let mut route_hasher = StableHasher::default();
    let entries = fs::read_dir(network_root).map_err(|error| {
        PassiveStateSourceError::Backend(format!(
            "cannot read Linux network-interface inventory: {error}"
        ))
    })?;
    let mut scanned = 0_usize;
    for entry in entries {
        let entry = entry.map_err(|error| {
            PassiveStateSourceError::Backend(format!(
                "cannot inspect one Linux network-interface entry: {error}"
            ))
        })?;
        scanned += 1;
        if scanned > MAX_RAW_INTERFACES {
            return Err(PassiveStateSourceError::InventoryOverflow(
                "Linux network-interface inventory exceeds the source bound".to_owned(),
            ));
        }
        let name = entry.file_name().into_string().map_err(|_name| {
            network_protocol_error("interface_name", "valid UTF-8 interface identifier")
        })?;
        if !interface_is_up(&entry.path())? {
            continue;
        }
        if selection.contains(NetworkConfigurationCategory::RouteChange) {
            active_interfaces.push(name.clone());
        }
        if selection.contains(NetworkConfigurationCategory::TunnelInterfaceState)
            && let Some(class) = classify_tunnel(&name, &entry.path())?
        {
            interfaces.push(RawTunnelInterface {
                stable_key: name,
                class,
            });
        }
    }
    active_interfaces.sort();
    interfaces.sort_by(|left, right| left.stable_key.cmp(&right.stable_key));
    for name in active_interfaces {
        name.hash(&mut route_hasher);
    }
    if selection.contains(NetworkConfigurationCategory::RouteChange) {
        let routes = read_bounded_route_table(route_table)?;
        routes.hash(&mut route_hasher);
    }
    tracker
        .lock()
        .map_err(|_poisoned| {
            PassiveStateSourceError::Backend(
                "Linux network state tracker lock was poisoned".to_owned(),
            )
        })?
        .state(
            NetworkConfigurationCoverage::PartialConfiguration,
            NetworkConfigurationCertainty::Partial,
            NetworkActivityState::Unknown,
            NetworkActivityState::Unknown,
            selection
                .contains(NetworkConfigurationCategory::RouteChange)
                .then_some(route_hasher.finish()),
            interfaces,
        )
}

fn read_bounded_route_table(path: &Path) -> Result<Vec<u8>, PassiveStateSourceError> {
    read_bounded_file(path, MAX_ROUTE_TABLE_BYTES)
        .map_err(|error| map_network_file_error(error, "Linux route topology", "route_table"))
}

fn interface_is_up(path: &Path) -> Result<bool, PassiveStateSourceError> {
    let state =
        read_bounded_utf8_file(&path.join("operstate"), MAX_SYSFS_FACT_BYTES).map_err(|error| {
            map_network_file_error(error, "Linux network-interface state", "operstate")
        })?;
    parse_operstate(state.trim())
}

fn parse_operstate(state: &str) -> Result<bool, PassiveStateSourceError> {
    match state {
        "up" | "unknown" | "dormant" => Ok(true),
        "notpresent" | "down" | "lowerlayerdown" | "testing" => Ok(false),
        _ => Err(network_protocol_error(
            "operstate",
            "documented Linux interface operational state",
        )),
    }
}

fn map_network_file_error(
    error: BoundedFileReadError,
    description: &'static str,
    field: &'static str,
) -> PassiveStateSourceError {
    match error {
        BoundedFileReadError::Io(error) => {
            PassiveStateSourceError::Backend(format!("cannot read {description}: {error}"))
        }
        BoundedFileReadError::Overflow { .. } => PassiveStateSourceError::InventoryOverflow(
            format!("{description} exceeds the source bound"),
        ),
        BoundedFileReadError::InvalidUtf8 => {
            network_protocol_error(field, "valid UTF-8 bounded platform record")
        }
    }
}

fn network_protocol_error(field: &'static str, rule: &'static str) -> PassiveStateSourceError {
    PassiveStateSourceError::Protocol(ProtocolViolation::Schema(ProtocolValidationError {
        type_name: "LinuxNetworkConfigurationAdapter",
        field,
        rule,
    }))
}

fn classify_tunnel(
    name: &str,
    path: &Path,
) -> Result<Option<NetworkTunnelClass>, PassiveStateSourceError> {
    let lower = name.to_ascii_lowercase();
    if lower.starts_with("ppp") || lower.starts_with("ipsec") {
        Ok(Some(NetworkTunnelClass::PointToPoint))
    } else if lower.starts_with("tun") || lower.starts_with("wg") {
        Ok(Some(NetworkTunnelClass::PacketTunnel))
    } else if lower.starts_with("tap")
        || lower.starts_with("veth")
        || lower.starts_with("virbr")
        || lower.starts_with("docker")
        || lower.starts_with("br-")
    {
        Ok(Some(NetworkTunnelClass::VirtualEthernet))
    } else if marker_exists(&path.join("tun_flags"))? {
        Ok(Some(NetworkTunnelClass::Other))
    } else {
        Ok(None)
    }
}

fn marker_exists(path: &Path) -> Result<bool, PassiveStateSourceError> {
    match fs::metadata(path) {
        Ok(_) => Ok(true),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(false),
        Err(error) => Err(PassiveStateSourceError::Backend(format!(
            "cannot inspect Linux tunnel marker: {error}"
        ))),
    }
}

#[derive(Default)]
struct StableHasher(u64);

impl Hasher for StableHasher {
    fn finish(&self) -> u64 {
        self.0
    }

    fn write(&mut self, bytes: &[u8]) {
        let mut hash = if self.0 == 0 {
            0xcbf2_9ce4_8422_2325
        } else {
            self.0
        };
        for byte in bytes {
            hash ^= u64::from(*byte);
            hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
        }
        self.0 = hash;
    }
}

#[cfg(test)]
mod tests {
    use std::os::unix::fs::symlink;
    use std::time::{SystemTime, UNIX_EPOCH};

    use super::*;

    #[test]
    fn interface_state_parser_rejects_malformed_successful_output() {
        assert!(parse_operstate("up").expect("documented state"));
        assert!(!parse_operstate("down").expect("documented state"));
        assert!(matches!(
            parse_operstate("unexpected"),
            Err(PassiveStateSourceError::Protocol(_))
        ));
    }

    #[test]
    fn tunnel_marker_metadata_errors_are_not_treated_as_absence() {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("time after epoch")
            .as_nanos();
        let root = std::env::temp_dir().join(format!("prctr-tunnel-marker-{unique}"));
        fs::create_dir_all(&root).expect("create tunnel fixture");
        symlink("tun_flags", root.join("tun_flags")).expect("create symlink loop");
        assert!(matches!(
            classify_tunnel("eth0", &root),
            Err(PassiveStateSourceError::Backend(_))
        ));
        fs::remove_file(root.join("tun_flags")).expect("remove symlink loop");
        fs::remove_dir_all(root).expect("remove tunnel fixture");
    }
}
