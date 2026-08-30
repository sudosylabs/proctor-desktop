use std::collections::BTreeMap;
use std::ffi::CStr;
use std::hash::{Hash, Hasher};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use crate::{
    NetworkConfigurationCategory, NetworkConfigurationSelection, NetworkConfigurationWire,
};
use prctr_native_protocol::{
    NetworkActivityState, NetworkConfigurationCertainty, NetworkConfigurationCoverage,
    NetworkConfigurationState, NetworkTunnelClass, PermissionState, PlatformFamily,
    ProtocolValidationError, ProtocolViolation,
};
use prctr_native_source_runtime::{
    InitialFallbackPollingSubscription, OpenedPassiveStateBackend, PassiveStateBackend,
    PassiveStateEmitter, PassiveStateSourceError, PassiveStateWire, PollingPassiveStateBackend,
};

use super::identity::{NetworkStateTracker, RawTunnelInterface};

const MAX_RAW_INTERFACES: usize = 4_096;

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
            PlatformFamily::Macos,
            PermissionState::Granted,
            "macos-network-topology-v1",
            Duration::from_millis(500),
            move || query_state(&query_tracker, selection),
        )
        .open_with_initial_backend_fallback(
            emitter,
            "macos-network-unavailable-v1",
            NetworkConfigurationWire::unavailable_state(),
        )
    }
}

fn query_state(
    tracker: &Mutex<NetworkStateTracker>,
    selection: NetworkConfigurationSelection,
) -> Result<NetworkConfigurationState, PassiveStateSourceError> {
    if !selection.requires_topology() {
        return tracker
            .lock()
            .map_err(|_poisoned| {
                PassiveStateSourceError::Backend(
                    "macOS network state tracker lock was poisoned".to_owned(),
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
    let mut head = std::ptr::null_mut();
    // SAFETY: getifaddrs initializes one linked-list head which is released by
    // freeifaddrs below. No returned address or interface name is emitted.
    if unsafe { libc::getifaddrs(&raw mut head) } != 0 || head.is_null() {
        return Err(PassiveStateSourceError::Backend(
            "macOS network-interface inventory is unavailable".to_owned(),
        ));
    }
    let inventory = InterfaceInventory(head);
    let mut cursor = inventory.0;
    let mut scanned = 0_usize;
    let mut active_interfaces = BTreeMap::new();
    while !cursor.is_null() {
        scanned += 1;
        if scanned > MAX_RAW_INTERFACES {
            return Err(PassiveStateSourceError::InventoryOverflow(
                "macOS network-interface inventory exceeds the source bound".to_owned(),
            ));
        }
        // SAFETY: cursor belongs to the live getifaddrs list.
        let record = unsafe { &*cursor };
        if !record.ifa_name.is_null()
            && record.ifa_flags & u32::try_from(libc::IFF_UP).unwrap_or(0) != 0
        {
            // SAFETY: ifa_name is a NUL-terminated string owned by the live list.
            let name = parse_interface_name(unsafe { CStr::from_ptr(record.ifa_name) })?;
            active_interfaces
                .entry(name.clone())
                .or_insert_with(|| classify_tunnel(&name));
        }
        cursor = record.ifa_next;
    }
    let mut route_hasher = StableHasher::default();
    let mut interfaces = Vec::new();
    for (name, class) in active_interfaces {
        if selection.contains(NetworkConfigurationCategory::RouteChange) {
            name.hash(&mut route_hasher);
        }
        if selection.contains(NetworkConfigurationCategory::TunnelInterfaceState)
            && let Some(class) = class
        {
            interfaces.push(RawTunnelInterface {
                stable_key: name,
                class,
            });
        }
    }
    tracker
        .lock()
        .map_err(|_poisoned| {
            PassiveStateSourceError::Backend(
                "macOS network state tracker lock was poisoned".to_owned(),
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

fn parse_interface_name(name: &CStr) -> Result<String, PassiveStateSourceError> {
    name.to_str().map(str::to_owned).map_err(|_error| {
        PassiveStateSourceError::Protocol(ProtocolViolation::Schema(ProtocolValidationError {
            type_name: "MacOsNetworkConfigurationAdapter",
            field: "interface_name",
            rule: "valid UTF-8 interface identifier",
        }))
    })
}

fn classify_tunnel(name: &str) -> Option<NetworkTunnelClass> {
    let lower = name.to_ascii_lowercase();
    if lower.starts_with("ppp") || lower.starts_with("ipsec") {
        Some(NetworkTunnelClass::PointToPoint)
    } else if lower.starts_with("utun") {
        Some(NetworkTunnelClass::PacketTunnel)
    } else if lower.starts_with("tun") || lower.starts_with("tap") || lower.starts_with("bridge") {
        Some(NetworkTunnelClass::VirtualEthernet)
    } else if lower.starts_with("gif") || lower.starts_with("stf") {
        Some(NetworkTunnelClass::Other)
    } else {
        None
    }
}

struct InterfaceInventory(*mut libc::ifaddrs);

impl Drop for InterfaceInventory {
    fn drop(&mut self) {
        if !self.0.is_null() {
            // SAFETY: this is the list returned by the successful getifaddrs.
            unsafe { libc::freeifaddrs(self.0) };
            self.0 = std::ptr::null_mut();
        }
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
    use super::*;

    #[test]
    fn health_only_selection_does_not_collect_or_emit_configuration_facts() {
        let selection = NetworkConfigurationSelection::new(&[
            NetworkConfigurationCategory::NetworkSourceHealth,
        ])
        .expect("health-only selection");
        let state = query_state(&Mutex::new(NetworkStateTracker::default()), selection)
            .expect("health-only query has no platform dependency");

        assert_eq!(state.system_proxy, NetworkActivityState::Unknown);
        assert_eq!(state.managed_vpn, NetworkActivityState::Unknown);
        assert!(state.tunnel_interfaces.is_empty());
        assert_eq!(state.route_generation, 0);
    }

    #[test]
    fn malformed_interface_identifier_is_a_terminal_protocol_result() {
        let malformed = CStr::from_bytes_with_nul(&[0xff, 0]).expect("C string fixture");
        assert!(matches!(
            parse_interface_name(malformed),
            Err(PassiveStateSourceError::Protocol(_))
        ));
    }
}
