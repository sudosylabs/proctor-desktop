use std::collections::{BTreeMap, BTreeSet};

use native_protocol::{
    NetworkActivityState, NetworkConfigurationCertainty, NetworkConfigurationCoverage,
    NetworkConfigurationState, NetworkTunnelClass, NetworkTunnelInterface,
};
use native_source_runtime::PassiveStateSourceError;

const MAX_TUNNEL_INTERFACES: usize = 32;
const MAX_SESSION_IDENTITIES: usize = 256;

pub(super) struct RawTunnelInterface {
    pub stable_key: String,
    pub class: NetworkTunnelClass,
}

#[derive(Default)]
pub(super) struct NetworkStateTracker {
    next_identity: u64,
    identities: BTreeMap<String, String>,
    route_signature: Option<u64>,
    route_generation: u64,
}

impl NetworkStateTracker {
    pub fn state(
        &mut self,
        coverage: NetworkConfigurationCoverage,
        certainty: NetworkConfigurationCertainty,
        system_proxy: NetworkActivityState,
        managed_vpn: NetworkActivityState,
        route_signature: Option<u64>,
        mut interfaces: Vec<RawTunnelInterface>,
    ) -> Result<NetworkConfigurationState, PassiveStateSourceError> {
        interfaces.sort_by(|left, right| left.stable_key.cmp(&right.stable_key));
        if interfaces.len() > MAX_TUNNEL_INTERFACES {
            return Err(PassiveStateSourceError::InventoryOverflow(
                "network tunnel-interface inventory exceeds the protocol bound".to_owned(),
            ));
        }
        let mut keys = BTreeSet::new();
        let mut tunnel_interfaces = Vec::with_capacity(interfaces.len());
        for interface in interfaces {
            if !keys.insert(interface.stable_key.clone()) {
                return Err(PassiveStateSourceError::Backend(
                    "network inventory contains a duplicate native interface".to_owned(),
                ));
            }
            let interface_instance_id = self.identity(&interface.stable_key)?;
            tunnel_interfaces.push(NetworkTunnelInterface {
                interface_instance_id,
                class: interface.class,
            });
        }
        if let Some(route_signature) = route_signature
            && self.route_signature != Some(route_signature)
        {
            self.route_generation = self.route_generation.saturating_add(1);
            self.route_signature = Some(route_signature);
        }
        Ok(NetworkConfigurationState {
            coverage,
            certainty,
            system_proxy,
            managed_vpn,
            tunnel_interfaces,
            route_generation: self.route_generation,
        })
    }

    fn identity(&mut self, stable_key: &str) -> Result<String, PassiveStateSourceError> {
        if let Some(identity) = self.identities.get(stable_key) {
            return Ok(identity.clone());
        }
        if self.identities.len() >= MAX_SESSION_IDENTITIES {
            return Err(PassiveStateSourceError::InventoryOverflow(
                "network session identity map is exhausted".to_owned(),
            ));
        }
        self.next_identity = self.next_identity.checked_add(1).ok_or_else(|| {
            PassiveStateSourceError::InventoryOverflow(
                "network session identity counter overflowed".to_owned(),
            )
        })?;
        let identity = format!("network-interface-{:016x}", self.next_identity);
        self.identities
            .insert(stable_key.to_owned(), identity.clone());
        Ok(identity)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn source_session_identity_exhaustion_is_an_inventory_overflow() {
        let mut tracker = NetworkStateTracker::default();
        for index in 0..MAX_SESSION_IDENTITIES {
            tracker
                .identity(&format!("native-{index}"))
                .expect("bounded identity");
        }
        assert!(matches!(
            tracker.identity("one-too-many"),
            Err(PassiveStateSourceError::InventoryOverflow(_))
        ));
    }

    #[test]
    fn source_ids_are_opaque_and_route_generation_changes_only_with_signature() {
        let mut tracker = NetworkStateTracker::default();
        let first = tracker
            .state(
                NetworkConfigurationCoverage::PartialConfiguration,
                NetworkConfigurationCertainty::Partial,
                NetworkActivityState::Unknown,
                NetworkActivityState::Unknown,
                Some(41),
                vec![raw("private-utun-name")],
            )
            .expect("first state");
        let same = tracker
            .state(
                NetworkConfigurationCoverage::PartialConfiguration,
                NetworkConfigurationCertainty::Partial,
                NetworkActivityState::Unknown,
                NetworkActivityState::Unknown,
                Some(41),
                vec![raw("private-utun-name")],
            )
            .expect("same state");
        let changed = tracker
            .state(
                NetworkConfigurationCoverage::PartialConfiguration,
                NetworkConfigurationCertainty::Partial,
                NetworkActivityState::Unknown,
                NetworkActivityState::Unknown,
                Some(42),
                vec![raw("private-utun-name")],
            )
            .expect("changed state");
        assert_eq!(first, same);
        assert!(changed.route_generation > same.route_generation);
        assert!(
            !first.tunnel_interfaces[0]
                .interface_instance_id
                .contains("utun")
        );
    }

    fn raw(stable_key: &str) -> RawTunnelInterface {
        RawTunnelInterface {
            stable_key: stable_key.to_owned(),
            class: NetworkTunnelClass::PacketTunnel,
        }
    }
}
