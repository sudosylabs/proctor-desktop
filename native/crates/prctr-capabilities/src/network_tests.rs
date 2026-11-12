use prctr_core::{Registry, ValidPolicy};
use prctr_protocol::rules::{Activation, Policy};

use super::*;

fn tunnel(key: u64, class: RawTunnelClass) -> RawTunnel {
    RawTunnel { key, class }
}

fn all() -> Selection {
    Selection {
        proxy: true,
        vpn: true,
        tunnels: true,
        routes: true,
    }
}

#[test]
fn only_selected_categories_appear_in_the_state() {
    let mut tracking = Tracking::default();
    let raw = RawNetwork {
        proxy: Some(Some(RawProxy::Manual)),
        ..RawNetwork::default()
    };
    let observation = tracking.classify(&raw);
    assert_eq!(
        observation.state,
        serde_json::json!({ "system_proxy": "manual" })
    );
    assert_eq!(observation.fields.len(), 1);
}

#[test]
fn an_unselected_category_is_never_read() {
    let raw = read(Selection {
        proxy: false,
        vpn: false,
        tunnels: false,
        routes: false,
    });
    assert_eq!(raw, RawNetwork::default());
}

#[test]
fn a_selected_category_the_platform_cannot_read_is_unknown_and_partial() {
    let mut tracking = Tracking::default();
    let raw = RawNetwork {
        vpn: Some(None),
        tunnels: Some(None),
        ..RawNetwork::default()
    };
    let observation = tracking.classify(&raw);
    assert_eq!(observation.state["managed_vpn"], "unknown");
    assert_eq!(observation.envelope.certainty, Certainty::Partial);
    assert!(
        !observation
            .fields
            .contains_key(&id("network.summary.tunnels_total")),
        "an unread tunnel list has no count, never zero"
    );
}

#[test]
fn tunnels_get_stable_opaque_identities_and_counted_classes() {
    let mut tracking = Tracking::default();
    let first = RawNetwork {
        tunnels: Some(Some(vec![tunnel(9, RawTunnelClass::PacketTunnel)])),
        ..RawNetwork::default()
    };
    let observation = tracking.classify(&first);
    assert_eq!(
        observation.state["tunnels"][0]["interface_id"],
        "tunnel0001"
    );
    let second = RawNetwork {
        tunnels: Some(Some(vec![
            tunnel(4, RawTunnelClass::PointToPoint),
            tunnel(9, RawTunnelClass::PacketTunnel),
        ])),
        ..RawNetwork::default()
    };
    let observation = tracking.classify(&second);
    assert_eq!(
        observation.state["tunnels"][1]["interface_id"],
        "tunnel0001"
    );
    assert_eq!(observation.summary["tunnels_total"], 2);
    assert_eq!(observation.summary["point_to_point"], 1);
}

#[test]
fn the_route_generation_rises_only_when_the_routing_table_changes() {
    let mut tracking = Tracking::default();
    let routes = |fingerprint| RawNetwork {
        routes: Some(Some(fingerprint)),
        ..RawNetwork::default()
    };
    assert_eq!(tracking.classify(&routes(1)).state["route_generation"], 0);
    assert_eq!(tracking.classify(&routes(1)).state["route_generation"], 0);
    assert_eq!(tracking.classify(&routes(2)).state["route_generation"], 1);
    assert_eq!(tracking.classify(&routes(3)).state["route_generation"], 2);
}

#[test]
fn a_rule_may_only_name_registered_categories() {
    let registry = Registry {
        capabilities: vec![descriptor()],
        baseline_rules: Vec::new(),
    };
    let policy = |category: &str| Policy {
        activations: vec![Activation {
            capability: id(CAPABILITY),
            categories: vec![id(category)],
        }],
        rules: Vec::new(),
    };
    assert!(ValidPolicy::new(policy(CATEGORY_PROXY), &registry).is_ok());
    assert!(ValidPolicy::new(policy("ssid"), &registry).is_err());
}

#[test]
fn network_passes_the_core_conformance_suite() {
    let mut tracking = Tracking::default();
    let none = tracking.classify(&RawNetwork {
        proxy: Some(Some(RawProxy::None)),
        ..RawNetwork::default()
    });
    let manual = tracking.classify(&RawNetwork {
        proxy: Some(Some(RawProxy::Manual)),
        ..RawNetwork::default()
    });
    prctr_core::testing::assert_capability_conformance(&descriptor(), &none, &manual);
}

/// Real OS: every selected category this platform supports is read, and two reads agree.
#[cfg(target_os = "macos")]
#[test]
fn macos_reads_proxy_tunnels_and_routes() {
    let raw = read(all());
    assert!(
        matches!(raw.proxy, Some(Some(_))),
        "the proxy configuration is readable"
    );
    assert!(
        matches!(raw.tunnels, Some(Some(_))),
        "the interface list is readable"
    );
    assert!(
        matches!(raw.routes, Some(Some(_))),
        "the routing table is readable"
    );
    assert_eq!(
        raw.vpn,
        Some(None),
        "managed VPN state is not readable on macOS yet"
    );
    assert_eq!(read(all()).proxy, raw.proxy, "two reads agree");
}

#[cfg(not(target_os = "macos"))]
#[test]
fn every_category_can_be_selected() {
    assert_eq!(Selection::of(&descriptor().categories), all());
}
