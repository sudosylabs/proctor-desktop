use std::collections::BTreeMap;
use std::ffi::{CStr, c_void};
use std::hash::{Hash, Hasher};
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
            "macos-network-configuration",
            Duration::from_millis(500),
            move || query_state(&query_tracker, selection),
        )
        .open_with_initial_backend_fallback(
            emitter,
            "macos-network-unavailable",
            NetworkConfigurationWire::unavailable_state(),
        )
    }
}

fn query_state(
    tracker: &Mutex<NetworkStateTracker>,
    selection: NetworkConfigurationSelection,
) -> Result<NetworkConfigurationState, PassiveStateSourceError> {
    let system_proxy = if selection.contains(NetworkConfigurationCategory::SystemProxyState) {
        query_system_proxy()?
    } else {
        NetworkActivityState::Unknown
    };
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
                system_proxy,
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
            system_proxy,
            NetworkActivityState::Unknown,
            selection
                .contains(NetworkConfigurationCategory::RouteChange)
                .then_some(route_hasher.finish()),
            interfaces,
        )
}

#[link(name = "SystemConfiguration", kind = "framework")]
unsafe extern "C" {
    fn SCDynamicStoreCopyProxies(store: *const c_void) -> *const c_void;
    static kSCPropNetProxiesHTTPEnable: *const c_void;
    static kSCPropNetProxiesHTTPSEnable: *const c_void;
    static kSCPropNetProxiesFTPEnable: *const c_void;
    static kSCPropNetProxiesGopherEnable: *const c_void;
    static kSCPropNetProxiesRTSPEnable: *const c_void;
    static kSCPropNetProxiesSOCKSEnable: *const c_void;
    static kSCPropNetProxiesProxyAutoConfigEnable: *const c_void;
    static kSCPropNetProxiesProxyAutoDiscoveryEnable: *const c_void;
}

#[link(name = "CoreFoundation", kind = "framework")]
unsafe extern "C" {
    fn CFRelease(value: *const c_void);
    fn CFGetTypeID(value: *const c_void) -> usize;
    fn CFDictionaryGetTypeID() -> usize;
    fn CFDictionaryGetCount(dictionary: *const c_void) -> isize;
    fn CFDictionaryGetValue(dictionary: *const c_void, key: *const c_void) -> *const c_void;
    fn CFNumberGetTypeID() -> usize;
    fn CFNumberGetValue(number: *const c_void, kind: isize, value: *mut c_void) -> bool;
}

// Read only numeric enable flags. Proxy addresses, PAC URLs, credentials,
// exception lists and interface names are neither decoded nor retained.
fn query_system_proxy() -> Result<NetworkActivityState, PassiveStateSourceError> {
    // SAFETY: NULL asks SystemConfiguration for the current process's default
    // store. The Copy result is owned here and released on every path.
    let dictionary = unsafe { SCDynamicStoreCopyProxies(std::ptr::null()) };
    if dictionary.is_null() {
        return Err(PassiveStateSourceError::Backend(
            "macOS system-proxy state is unavailable".to_owned(),
        ));
    }
    let dictionary = ProxyDictionary(dictionary);
    // SAFETY: a live CF object may be inspected for its type before dictionary access.
    if unsafe { CFGetTypeID(dictionary.0) != CFDictionaryGetTypeID() } {
        return Err(proxy_protocol_failure());
    }
    // A future platform response cannot cause unbounded traversal. No keys are enumerated.
    let count = unsafe { CFDictionaryGetCount(dictionary.0) };
    if !(0..=256).contains(&count) {
        return Err(PassiveStateSourceError::InventoryOverflow(
            "macOS proxy dictionary exceeds the source bound".to_owned(),
        ));
    }
    let mut flags = [0_i32; 8];
    // SAFETY: these are constant CFString objects supplied by SystemConfiguration.
    let keys = unsafe {
        [
            kSCPropNetProxiesHTTPEnable,
            kSCPropNetProxiesHTTPSEnable,
            kSCPropNetProxiesFTPEnable,
            kSCPropNetProxiesGopherEnable,
            kSCPropNetProxiesRTSPEnable,
            kSCPropNetProxiesSOCKSEnable,
            kSCPropNetProxiesProxyAutoConfigEnable,
            kSCPropNetProxiesProxyAutoDiscoveryEnable,
        ]
    };
    for (index, key) in keys.into_iter().enumerate() {
        // SAFETY: dictionary and constant key remain live. Missing enable keys mean disabled.
        let value = unsafe { CFDictionaryGetValue(dictionary.0, key) };
        if value.is_null() {
            continue;
        }
        // SAFETY: only a verified CFNumber is decoded into one fixed i32. Type 3
        // is kCFNumberSInt32Type as defined by CoreFoundation.
        if unsafe {
            CFGetTypeID(value) != CFNumberGetTypeID()
                || !CFNumberGetValue(value, 3, (&raw mut flags[index]).cast())
        } {
            return Err(proxy_protocol_failure());
        }
    }
    proxy_state_from_flags(flags)
}

fn proxy_state_from_flags(
    flags: [i32; 8],
) -> Result<NetworkActivityState, PassiveStateSourceError> {
    if flags.iter().any(|flag| !matches!(flag, 0 | 1)) {
        return Err(proxy_protocol_failure());
    }
    Ok(if flags.contains(&1) {
        NetworkActivityState::Active
    } else {
        NetworkActivityState::Inactive
    })
}

fn proxy_protocol_failure() -> PassiveStateSourceError {
    PassiveStateSourceError::Protocol(ProtocolViolation::Schema(ProtocolValidationError {
        type_name: "MacOsNetworkConfigurationAdapter",
        field: "system_proxy",
        rule: "bounded numeric system proxy enable flags",
    }))
}

struct ProxyDictionary(*const c_void);

impl Drop for ProxyDictionary {
    fn drop(&mut self) {
        // SAFETY: owns the single +1 reference returned by SCDynamicStoreCopyProxies.
        unsafe { CFRelease(self.0) };
    }
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
    fn proxy_flags_include_automatic_configuration_without_reading_url_values() {
        assert_eq!(
            proxy_state_from_flags([0; 8]).expect("disabled"),
            NetworkActivityState::Inactive
        );
        for selected in 0..8 {
            let mut flags = [0; 8];
            flags[selected] = 1;
            assert_eq!(
                proxy_state_from_flags(flags).expect("enabled"),
                NetworkActivityState::Active
            );
        }
        assert!(matches!(
            proxy_state_from_flags([2; 8]),
            Err(PassiveStateSourceError::Protocol(_))
        ));
    }

    #[test]
    fn system_proxy_selection_does_not_collect_interface_topology() {
        let selection =
            NetworkConfigurationSelection::new(&[NetworkConfigurationCategory::SystemProxyState])
                .expect("proxy-only selection");
        // Actual macOS query; ordinary service unavailability stays explicit.
        match query_state(&Mutex::new(NetworkStateTracker::default()), selection) {
            Ok(state) => {
                assert_ne!(state.system_proxy, NetworkActivityState::Unknown);
                assert_eq!(state.managed_vpn, NetworkActivityState::Unknown);
                assert!(state.tunnel_interfaces.is_empty());
                assert_eq!(state.route_generation, 0);
            }
            Err(PassiveStateSourceError::Backend(_)) => {}
            Err(error) => panic!("unexpected proxy query failure: {error}"),
        }
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
