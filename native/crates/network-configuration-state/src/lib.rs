#![deny(unsafe_code)]

mod platform;
use native_protocol::{
    NetworkActivityState, NetworkConfigurationCertainty, NetworkConfigurationCoverage,
    NetworkConfigurationDrain, NetworkConfigurationEvent, NetworkConfigurationEventKind,
    NetworkConfigurationObservation, NetworkConfigurationSourceSnapshot, NetworkConfigurationState,
    SourceHealth,
};
use native_source_runtime::PassiveStateWire;
pub use native_source_runtime::{
    OpenedPassiveStateBackend as OpenedNetworkConfigurationBackend,
    PassiveStateBackend as NetworkConfigurationBackend,
    PassiveStateEmitter as NetworkConfigurationEmitter,
    PassiveStateSource as NetworkConfigurationSource,
    PassiveStateSourceError as NetworkConfigurationError,
    PassiveStateSubscription as NetworkConfigurationSubscription,
    UnavailablePassiveStateSubscription as UnavailableNetworkConfigurationSubscription,
};
pub use platform::PlatformNetworkConfigurationBackend;

pub struct NetworkConfigurationWire;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum NetworkConfigurationCategory {
    SystemProxyState,
    OsManagedVpnState,
    TunnelInterfaceState,
    RouteChange,
    NetworkSourceHealth,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct NetworkConfigurationSelection(u8);

impl NetworkConfigurationSelection {
    #[must_use]
    pub fn new(categories: &[NetworkConfigurationCategory]) -> Option<Self> {
        let mut bits = 0_u8;
        for category in categories {
            bits |= category.bit();
        }
        (bits != 0).then_some(Self(bits))
    }

    #[must_use]
    pub const fn all() -> Self {
        Self(0b1_1111)
    }

    #[must_use]
    pub const fn contains(self, category: NetworkConfigurationCategory) -> bool {
        self.0 & category.bit() != 0
    }

    #[must_use]
    pub const fn requires_topology(self) -> bool {
        self.contains(NetworkConfigurationCategory::TunnelInterfaceState)
            || self.contains(NetworkConfigurationCategory::RouteChange)
    }
}

impl NetworkConfigurationCategory {
    const fn bit(self) -> u8 {
        match self {
            Self::SystemProxyState => 1 << 0,
            Self::OsManagedVpnState => 1 << 1,
            Self::TunnelInterfaceState => 1 << 2,
            Self::RouteChange => 1 << 3,
            Self::NetworkSourceHealth => 1 << 4,
        }
    }
}

impl PassiveStateWire for NetworkConfigurationWire {
    type State = NetworkConfigurationState;
    type Event = NetworkConfigurationEvent;
    type Snapshot = NetworkConfigurationSourceSnapshot;
    type Observation = NetworkConfigurationObservation;
    type Drain = NetworkConfigurationDrain;
    const SOURCE_VERSION: &'static str = env!("CARGO_PKG_VERSION");
    const STOP_THREAD_NAME: &'static str = "network-configuration-stop";
    fn health(state: &Self::State) -> SourceHealth {
        if matches!(
            state.coverage,
            NetworkConfigurationCoverage::FullConfiguration
        ) && matches!(state.certainty, NetworkConfigurationCertainty::Complete)
        {
            SourceHealth::Healthy
        } else {
            SourceHealth::Degraded
        }
    }
    fn unavailable_state() -> Self::State {
        NetworkConfigurationState {
            coverage: NetworkConfigurationCoverage::Unavailable,
            certainty: NetworkConfigurationCertainty::Unknown,
            system_proxy: NetworkActivityState::Unknown,
            managed_vpn: NetworkActivityState::Unknown,
            tunnel_interfaces: Vec::new(),
            route_generation: 0,
        }
    }
    native_source_runtime::passive_state_constructors! {
        event: NetworkConfigurationEvent,
        event_kind: NetworkConfigurationEventKind,
        snapshot: NetworkConfigurationSourceSnapshot,
        observation: NetworkConfigurationObservation,
        drain: NetworkConfigurationDrain,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use native_protocol::SourceOpenRequest;

    #[test]
    fn network_selection_requires_at_least_one_mechanical_category() {
        assert!(NetworkConfigurationSelection::new(&[]).is_none());
        let selection =
            NetworkConfigurationSelection::new(&[NetworkConfigurationCategory::RouteChange])
                .expect("route selection");
        assert!(selection.contains(NetworkConfigurationCategory::RouteChange));
        assert!(!selection.contains(NetworkConfigurationCategory::SystemProxyState));
    }

    #[test]
    fn platform_boundary_reports_a_coherent_bounded_snapshot() {
        let request = SourceOpenRequest {
            collection_session_id: "network-config-session-0001".to_owned(),
            queue_capacity: 8,
        };
        let mut source = NetworkConfigurationSource::<NetworkConfigurationWire, _>::open(
            &request,
            PlatformNetworkConfigurationBackend::new(NetworkConfigurationSelection::all()),
        )
        .expect("source opens");
        assert_eq!(source.snapshot().health, SourceHealth::Degraded);
        assert!(matches!(
            source.snapshot().state.coverage,
            NetworkConfigurationCoverage::PartialConfiguration
                | NetworkConfigurationCoverage::Unavailable
        ));
        assert_eq!(source.stop().health, SourceHealth::Stopped);
    }
}
