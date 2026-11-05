use std::ffi::{CStr, c_void};
use std::hash::{Hash, Hasher};
use std::mem;
use std::ptr;
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
    poison_native_source_process,
};
use windows_sys::Win32::Foundation::{ERROR_BUFFER_OVERFLOW, GlobalFree, NO_ERROR};
use windows_sys::Win32::NetworkManagement::IpHelper::{
    GAA_FLAG_SKIP_ANYCAST, GAA_FLAG_SKIP_DNS_INFO, GAA_FLAG_SKIP_DNS_SERVER,
    GAA_FLAG_SKIP_MULTICAST, GAA_FLAG_SKIP_UNICAST, GetAdaptersAddresses, IF_TYPE_PPP,
    IF_TYPE_TUNNEL, IP_ADAPTER_ADDRESSES_LH,
};
use windows_sys::Win32::NetworkManagement::Ndis::IfOperStatusUp;
use windows_sys::Win32::Networking::WinHttp::{
    WINHTTP_CURRENT_USER_IE_PROXY_CONFIG, WinHttpGetIEProxyConfigForCurrentUser,
};
use windows_sys::Win32::Networking::WinSock::AF_UNSPEC;

use super::identity::{NetworkStateTracker, RawTunnelInterface};

const MAX_ADAPTER_BYTES: u32 = 4 * 1024 * 1024;
const MAX_RAW_ADAPTERS: usize = 4_096;
const MAX_NATIVE_NAME_BYTES: usize = 1_024;

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
            PlatformFamily::Windows,
            PermissionState::Granted,
            "windows-network-topology-v1",
            Duration::from_millis(500),
            move || query_state(&query_tracker, selection),
        )
        .open_with_initial_backend_fallback(
            emitter,
            "windows-network-unavailable-v1",
            NetworkConfigurationWire::unavailable_state(),
        )
    }
}

fn query_state(
    tracker: &Mutex<NetworkStateTracker>,
    selection: NetworkConfigurationSelection,
) -> Result<NetworkConfigurationState, PassiveStateSourceError> {
    let mut route_topology = Vec::new();
    let mut interfaces = Vec::new();
    if selection.requires_topology() {
        let inventory = AdapterInventory::query()?;
        for adapter in inventory.records()? {
            if adapter.OperStatus != IfOperStatusUp {
                continue;
            }
            let stable_key = bounded_c_string(adapter.AdapterName, MAX_NATIVE_NAME_BYTES)?;
            if selection.contains(NetworkConfigurationCategory::RouteChange) {
                route_topology.push((
                    stable_key.clone(),
                    adapter.IfType,
                    adapter.Ipv4Metric,
                    adapter.Ipv6Metric,
                ));
            }
            if selection.contains(NetworkConfigurationCategory::TunnelInterfaceState)
                && matches!(adapter.IfType, IF_TYPE_PPP | IF_TYPE_TUNNEL)
            {
                interfaces.push(RawTunnelInterface {
                    stable_key,
                    class: if adapter.IfType == IF_TYPE_PPP {
                        NetworkTunnelClass::PointToPoint
                    } else {
                        NetworkTunnelClass::PacketTunnel
                    },
                });
            }
        }
    }
    route_topology.sort_unstable();
    let mut route_hasher = StableHasher::default();
    if selection.contains(NetworkConfigurationCategory::RouteChange) {
        route_topology.hash(&mut route_hasher);
    }
    tracker
        .lock()
        .map_err(|_poisoned| {
            PassiveStateSourceError::Backend(
                "Windows network state tracker lock was poisoned".to_owned(),
            )
        })?
        .state(
            NetworkConfigurationCoverage::PartialConfiguration,
            NetworkConfigurationCertainty::Partial,
            if selection.contains(NetworkConfigurationCategory::SystemProxyState) {
                query_system_proxy()?
            } else {
                NetworkActivityState::Unknown
            },
            NetworkActivityState::Unknown,
            selection
                .contains(NetworkConfigurationCategory::RouteChange)
                .then_some(route_hasher.finish()),
            interfaces,
        )
}

fn query_system_proxy() -> Result<NetworkActivityState, PassiveStateSourceError> {
    let mut config = WINHTTP_CURRENT_USER_IE_PROXY_CONFIG::default();
    // SAFETY: config is a valid output record; any allocated strings are freed
    // immediately without inspecting their contents.
    if unsafe { WinHttpGetIEProxyConfigForCurrentUser(&raw mut config) } == 0 {
        return Ok(NetworkActivityState::Unknown);
    }
    let active = config.fAutoDetect != 0
        || !config.lpszAutoConfigUrl.is_null()
        || !config.lpszProxy.is_null();
    release_proxy_allocations(
        [
            config.lpszAutoConfigUrl,
            config.lpszProxy,
            config.lpszProxyBypass,
        ],
        free_global_allocation,
    )?;
    Ok(if active {
        NetworkActivityState::Active
    } else {
        NetworkActivityState::Inactive
    })
}

type ProxyAllocationReleaser = unsafe fn(*mut u16) -> *mut c_void;

fn release_proxy_allocations(
    allocations: [*mut u16; 3],
    release: ProxyAllocationReleaser,
) -> Result<(), PassiveStateSourceError> {
    let mut failed = false;
    for allocation in allocations {
        if allocation.is_null() {
            continue;
        }
        // SAFETY: callers provide only independently owned GlobalAlloc
        // pointers, and every non-null allocation is attempted exactly once.
        failed |= !unsafe { release(allocation) }.is_null();
    }
    if failed {
        poison_native_source_process();
        Err(PassiveStateSourceError::Cleanup(
            "Windows proxy configuration allocation release failed".to_owned(),
        ))
    } else {
        Ok(())
    }
}

unsafe fn free_global_allocation(allocation: *mut u16) -> *mut c_void {
    // SAFETY: callers transfer an allocation returned by WinHTTP/GlobalAlloc.
    unsafe { GlobalFree(allocation.cast()) }
}

fn bounded_c_string(pointer: *const u8, maximum: usize) -> Result<String, PassiveStateSourceError> {
    if pointer.is_null() {
        return Err(PassiveStateSourceError::Backend(
            "Windows returned a tunnel adapter without an internal key".to_owned(),
        ));
    }
    let mut length = 0_usize;
    while length <= maximum {
        // SAFETY: the explicit maximum bounds the scan of the documented
        // NUL-terminated AdapterName member.
        if unsafe { *pointer.add(length) } == 0 {
            // SAFETY: the bounded scan established a complete C string.
            let value = unsafe { CStr::from_ptr(pointer.cast()) };
            return value.to_str().map(str::to_owned).map_err(|_error| {
                PassiveStateSourceError::Protocol(ProtocolViolation::Schema(
                    ProtocolValidationError {
                        type_name: "WindowsNetworkConfigurationAdapter",
                        field: "adapter_name",
                        rule: "valid UTF-8 bounded adapter identifier",
                    },
                ))
            });
        }
        length += 1;
    }
    Err(PassiveStateSourceError::InventoryOverflow(
        "Windows tunnel-adapter internal key exceeds the source bound".to_owned(),
    ))
}

struct AdapterInventory {
    buffer: AlignedBuffer,
}

impl AdapterInventory {
    fn query() -> Result<Self, PassiveStateSourceError> {
        let flags = GAA_FLAG_SKIP_UNICAST
            | GAA_FLAG_SKIP_ANYCAST
            | GAA_FLAG_SKIP_MULTICAST
            | GAA_FLAG_SKIP_DNS_SERVER
            | GAA_FLAG_SKIP_DNS_INFO;
        let mut bytes = 0_u32;
        // SAFETY: documented sizing call with null storage.
        let sizing = unsafe {
            GetAdaptersAddresses(
                u32::from(AF_UNSPEC),
                flags,
                ptr::null(),
                ptr::null_mut(),
                &raw mut bytes,
            )
        };
        if sizing != ERROR_BUFFER_OVERFLOW || bytes == 0 {
            return Err(PassiveStateSourceError::Backend(
                "Windows network-adapter inventory size is unavailable".to_owned(),
            ));
        }
        if bytes > MAX_ADAPTER_BYTES {
            return Err(PassiveStateSourceError::InventoryOverflow(
                "Windows network-adapter inventory size exceeds the source bound".to_owned(),
            ));
        }
        let mut buffer = AlignedBuffer::new(bytes)?;
        let head = buffer.as_mut_ptr::<IP_ADAPTER_ADDRESSES_LH>();
        // SAFETY: head points to bytes writable with pointer alignment and the
        // size parameter is bounded to the allocated storage.
        let result = unsafe {
            GetAdaptersAddresses(
                u32::from(AF_UNSPEC),
                flags,
                ptr::null(),
                head,
                &raw mut bytes,
            )
        };
        validate_completed_adapter_query(result, bytes)?;
        Ok(Self { buffer })
    }

    fn records(&self) -> Result<Vec<&IP_ADAPTER_ADDRESSES_LH>, PassiveStateSourceError> {
        let mut records = Vec::new();
        let mut cursor = self.buffer.as_ptr::<IP_ADAPTER_ADDRESSES_LH>();
        while !cursor.is_null() {
            if records.len() >= MAX_RAW_ADAPTERS {
                return Err(PassiveStateSourceError::InventoryOverflow(
                    "Windows network-adapter inventory exceeds the source bound".to_owned(),
                ));
            }
            // SAFETY: cursor belongs to the linked list initialized inside the
            // still-live aligned buffer owned by self.
            let record = unsafe { &*cursor };
            records.push(record);
            cursor = record.Next;
        }
        Ok(records)
    }
}

fn validate_completed_adapter_query(
    result: u32,
    bytes: u32,
) -> Result<(), PassiveStateSourceError> {
    if result == ERROR_BUFFER_OVERFLOW || bytes > MAX_ADAPTER_BYTES {
        return Err(PassiveStateSourceError::InventoryOverflow(
            "Windows network-adapter inventory changed beyond the source bound".to_owned(),
        ));
    }
    if result != NO_ERROR {
        return Err(PassiveStateSourceError::Backend(
            "Windows network-adapter inventory query failed".to_owned(),
        ));
    }
    Ok(())
}

struct AlignedBuffer {
    words: Vec<usize>,
}

impl AlignedBuffer {
    fn new(bytes: u32) -> Result<Self, PassiveStateSourceError> {
        let bytes = usize::try_from(bytes).map_err(|_error| {
            PassiveStateSourceError::InventoryOverflow(
                "Windows network buffer exceeds the source bound".to_owned(),
            )
        })?;
        Ok(Self {
            words: vec![0; bytes.div_ceil(mem::size_of::<usize>())],
        })
    }

    fn as_mut_ptr<T>(&mut self) -> *mut T {
        self.words.as_mut_ptr().cast()
    }

    fn as_ptr<T>(&self) -> *mut T {
        self.words.as_ptr().cast_mut().cast()
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
    use std::sync::atomic::{AtomicUsize, Ordering};

    use super::*;

    static RELEASE_CALLS: AtomicUsize = AtomicUsize::new(0);

    unsafe fn fail_second_release(_allocation: *mut u16) -> *mut c_void {
        let call = RELEASE_CALLS.fetch_add(1, Ordering::SeqCst);
        if call == 1 {
            std::ptr::dangling_mut()
        } else {
            ptr::null_mut()
        }
    }

    #[test]
    fn second_adapter_query_overflow_remains_a_boundedness_failure() {
        assert!(matches!(
            validate_completed_adapter_query(ERROR_BUFFER_OVERFLOW, 1024),
            Err(PassiveStateSourceError::InventoryOverflow(_))
        ));
        assert!(matches!(
            validate_completed_adapter_query(NO_ERROR, MAX_ADAPTER_BYTES + 1),
            Err(PassiveStateSourceError::InventoryOverflow(_))
        ));
    }

    #[test]
    fn proxy_release_attempts_every_allocation_and_reports_cleanup_failure() {
        RELEASE_CALLS.store(0, Ordering::SeqCst);
        let allocations = [std::ptr::dangling_mut(); 3];
        assert!(matches!(
            release_proxy_allocations(allocations, fail_second_release),
            Err(PassiveStateSourceError::Cleanup(_))
        ));
        assert_eq!(RELEASE_CALLS.load(Ordering::SeqCst), 3);
    }

    #[test]
    fn malformed_adapter_identifier_is_a_terminal_protocol_result() {
        let malformed = [0xff_u8, 0];
        assert!(matches!(
            bounded_c_string(malformed.as_ptr(), malformed.len()),
            Err(PassiveStateSourceError::Protocol(_))
        ));
    }
}
