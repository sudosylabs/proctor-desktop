//! Network configuration: system proxy, OS-managed VPN, tunnel interfaces and route changes.
//! Configuration only: traffic, addresses, names and proxy hosts are never read. Only the
//! sub-categories the activation selects are queried.
//! Contract: `docs/architecture/native-capability-families.md`, "Network configuration".

use std::collections::BTreeMap;
use std::time::Duration;

use prctr_core::{
    CapabilityDescriptor, FieldKind, FieldSpec, FieldValue, Observation, Sink, Source, SourceError,
};
use prctr_os::{RawProxy, RawTunnel, RawTunnelClass};
use prctr_protocol::facts::{Certainty, Envelope, Health, Permission};
use prctr_protocol::scalars::Identifier;
use schemars::JsonSchema;
use serde::Serialize;

use crate::poller::Poller;

pub const CAPABILITY: &str = "network";
pub const POLL_INTERVAL: Duration = Duration::from_secs(1);
pub const STABILITY_MS: u64 = 3_000;
pub const CATEGORY_PROXY: &str = "system_proxy";
pub const CATEGORY_VPN: &str = "managed_vpn";
pub const CATEGORY_TUNNELS: &str = "tunnel_interfaces";
pub const CATEGORY_ROUTES: &str = "route_change";
const MAX_TUNNELS: u64 = 256;
const MAX_ROUTE_GENERATION: u64 = 1_000_000_000;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum Proxy {
    None,
    Manual,
    AutomaticConfig,
    AutoDetect,
    Unknown,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum ManagedVpn {
    Inactive,
    Active,
    Unknown,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum TunnelClass {
    PointToPoint,
    PacketTunnel,
    VirtualEthernet,
    ManagedVpn,
    Other,
}

/// One active tunnel. `interface_id` is opaque and stable within one agent session.
#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct Tunnel {
    pub interface_id: String,
    pub class: TunnelClass,
}

/// Only selected sub-categories appear; an unselected one is absent, not empty.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct NetworkState {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub system_proxy: Option<Proxy>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub managed_vpn: Option<ManagedVpn>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tunnels: Option<Vec<Tunnel>>,
    /// Rises each time the routing table changes. A route change alone is never a violation.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub route_generation: Option<u64>,
}

/// Tunnel counts by class, derived only from `tunnels`.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct NetworkSummary {
    pub tunnels_total: u64,
    pub point_to_point: u64,
    pub packet_tunnel: u64,
    pub virtual_ethernet: u64,
    pub managed_vpn_tunnels: u64,
}

impl NetworkSummary {
    #[must_use]
    pub fn of(tunnels: &[Tunnel]) -> Self {
        let count = |class| {
            tunnels
                .iter()
                .filter(|tunnel| tunnel.class == class)
                .count() as u64
        };
        Self {
            tunnels_total: tunnels.len() as u64,
            point_to_point: count(TunnelClass::PointToPoint),
            packet_tunnel: count(TunnelClass::PacketTunnel),
            virtual_ethernet: count(TunnelClass::VirtualEthernet),
            managed_vpn_tunnels: count(TunnelClass::ManagedVpn),
        }
    }

    fn fields(self) -> [(&'static str, u64); 5] {
        [
            ("network.summary.tunnels_total", self.tunnels_total),
            ("network.summary.point_to_point", self.point_to_point),
            ("network.summary.packet_tunnel", self.packet_tunnel),
            ("network.summary.virtual_ethernet", self.virtual_ethernet),
            (
                "network.summary.managed_vpn_tunnels",
                self.managed_vpn_tunnels,
            ),
        ]
    }
}

fn id(text: &str) -> Identifier {
    Identifier::new(text).expect("network identifier is valid")
}

#[must_use]
pub fn descriptor() -> CapabilityDescriptor {
    let symbol = |name: &str, values: &[&str]| FieldSpec {
        name: id(name),
        kind: FieldKind::Symbol {
            values: values.iter().map(|value| id(value)).collect(),
        },
    };
    let mut fields = vec![
        symbol(
            "network.system_proxy",
            &[
                "none",
                "manual",
                "automatic_config",
                "auto_detect",
                "unknown",
            ],
        ),
        symbol("network.managed_vpn", &["inactive", "active", "unknown"]),
        FieldSpec {
            name: id("network.route_generation"),
            kind: FieldKind::Count {
                max: MAX_ROUTE_GENERATION,
            },
        },
    ];
    fields.extend(
        NetworkSummary::default()
            .fields()
            .iter()
            .map(|(name, _)| FieldSpec {
                name: id(name),
                kind: FieldKind::Count { max: MAX_TUNNELS },
            }),
    );
    CapabilityDescriptor {
        id: id(CAPABILITY),
        sensitive: true,
        stability_ms: STABILITY_MS,
        categories: [
            CATEGORY_PROXY,
            CATEGORY_VPN,
            CATEGORY_TUNNELS,
            CATEGORY_ROUTES,
        ]
        .into_iter()
        .map(id)
        .collect(),
        fields,
        reasons: vec![
            id("network.proxy_detected"),
            id("network.vpn_detected"),
            id("network.tunnel_detected"),
        ],
        app_conditions: false,
        permission_prompt: false,
    }
}

/// Which sub-categories to read.
#[allow(clippy::struct_excessive_bools)] // Four independent category switches, not a state machine.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Selection {
    pub proxy: bool,
    pub vpn: bool,
    pub tunnels: bool,
    pub routes: bool,
}

impl Selection {
    #[must_use]
    pub fn of(categories: &[Identifier]) -> Self {
        let has = |name: &str| categories.iter().any(|category| category.as_str() == name);
        Self {
            proxy: has(CATEGORY_PROXY),
            vpn: has(CATEGORY_VPN),
            tunnels: has(CATEGORY_TUNNELS),
            routes: has(CATEGORY_ROUTES),
        }
    }
}

/// One read of the selected sub-categories. `None` inside a selected category means the platform
/// could not tell.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct RawNetwork {
    pub proxy: Option<Option<RawProxy>>,
    pub vpn: Option<Option<bool>>,
    pub tunnels: Option<Option<Vec<RawTunnel>>>,
    pub routes: Option<Option<u64>>,
}

/// Reads only what `selection` names.
#[must_use]
pub fn read(selection: Selection) -> RawNetwork {
    RawNetwork {
        proxy: selection.proxy.then(platform::proxy),
        vpn: selection.vpn.then(platform::vpn),
        tunnels: selection.tunnels.then(|| {
            platform::tunnels().map(|mut tunnels| {
                tunnels.sort();
                tunnels
            })
        }),
        routes: selection.routes.then(platform::routes),
    }
}

mod platform {
    use prctr_os::{RawProxy, RawTunnel};

    #[cfg(target_os = "macos")]
    pub fn proxy() -> Option<RawProxy> {
        prctr_os::macos::system_proxy()
    }
    #[cfg(target_os = "windows")]
    pub fn proxy() -> Option<RawProxy> {
        prctr_os::windows::system_proxy()
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    pub fn proxy() -> Option<RawProxy> {
        None
    }

    #[cfg(target_os = "windows")]
    pub fn vpn() -> Option<bool> {
        prctr_os::windows::managed_vpn()
    }
    #[cfg(not(target_os = "windows"))]
    pub fn vpn() -> Option<bool> {
        None
    }

    #[cfg(target_os = "macos")]
    pub fn tunnels() -> Option<Vec<RawTunnel>> {
        prctr_os::macos::tunnels()
    }
    #[cfg(target_os = "windows")]
    pub fn tunnels() -> Option<Vec<RawTunnel>> {
        prctr_os::windows::tunnels()
    }
    #[cfg(target_os = "linux")]
    pub fn tunnels() -> Option<Vec<RawTunnel>> {
        prctr_os::linux::tunnels()
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
    pub fn tunnels() -> Option<Vec<RawTunnel>> {
        None
    }

    #[cfg(target_os = "macos")]
    pub fn routes() -> Option<u64> {
        prctr_os::macos::route_fingerprint()
    }
    #[cfg(target_os = "windows")]
    pub fn routes() -> Option<u64> {
        prctr_os::windows::route_fingerprint()
    }
    #[cfg(target_os = "linux")]
    pub fn routes() -> Option<u64> {
        prctr_os::linux::route_fingerprint()
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
    pub fn routes() -> Option<u64> {
        None
    }
}

/// Per-session memory: opaque tunnel identities and the route generation.
#[derive(Debug, Default)]
pub struct Tracking {
    tunnel_ids: BTreeMap<u64, String>,
    last_routes: Option<u64>,
    route_generation: u64,
}

impl Tracking {
    fn tunnel_id(&mut self, key: u64) -> String {
        let next = self.tunnel_ids.len() + 1;
        self.tunnel_ids
            .entry(key)
            .or_insert_with(|| format!("tunnel{next:04}"))
            .clone()
    }

    /// The facts for one read.
    pub fn classify(&mut self, raw: &RawNetwork) -> Observation {
        let mut complete = true;
        let mut known = |value: bool| {
            complete &= value;
        };
        let system_proxy = raw.proxy.map(|proxy| {
            known(proxy.is_some());
            match proxy {
                Some(RawProxy::None) => Proxy::None,
                Some(RawProxy::Manual) => Proxy::Manual,
                Some(RawProxy::AutomaticConfig) => Proxy::AutomaticConfig,
                Some(RawProxy::AutoDetect) => Proxy::AutoDetect,
                None => Proxy::Unknown,
            }
        });
        let managed_vpn = raw.vpn.map(|vpn| {
            known(vpn.is_some());
            match vpn {
                Some(true) => ManagedVpn::Active,
                Some(false) => ManagedVpn::Inactive,
                None => ManagedVpn::Unknown,
            }
        });
        let tunnels = raw.tunnels.as_ref().map(|tunnels| {
            known(tunnels.is_some());
            tunnels
                .as_deref()
                .unwrap_or_default()
                .iter()
                .map(|tunnel| Tunnel {
                    interface_id: self.tunnel_id(tunnel.key),
                    class: match tunnel.class {
                        RawTunnelClass::PointToPoint => TunnelClass::PointToPoint,
                        RawTunnelClass::PacketTunnel => TunnelClass::PacketTunnel,
                        RawTunnelClass::VirtualEthernet => TunnelClass::VirtualEthernet,
                        RawTunnelClass::ManagedVpn => TunnelClass::ManagedVpn,
                        RawTunnelClass::Other => TunnelClass::Other,
                    },
                })
                .collect::<Vec<_>>()
        });
        let route_generation = raw.routes.map(|routes| {
            known(routes.is_some());
            if let Some(fingerprint) = routes {
                if self.last_routes.is_some_and(|last| last != fingerprint) {
                    self.route_generation = (self.route_generation + 1).min(MAX_ROUTE_GENERATION);
                }
                self.last_routes = Some(fingerprint);
            }
            self.route_generation
        });
        let tunnels_known = raw.tunnels.as_ref().is_some_and(Option::is_some);
        let routes_known = raw.routes.is_some_and(|routes| routes.is_some());
        let state = NetworkState {
            system_proxy,
            managed_vpn,
            tunnels,
            route_generation,
        };
        let summary = state.tunnels.as_deref().map(NetworkSummary::of);
        let fields = rule_fields(&state, summary, tunnels_known, routes_known);
        Observation {
            envelope: Envelope {
                permission: Permission::Granted,
                health: if complete {
                    Health::Healthy
                } else {
                    Health::Degraded
                },
                certainty: if complete {
                    Certainty::Complete
                } else {
                    Certainty::Partial
                },
            },
            state: serde_json::to_value(&state).unwrap_or_default(),
            summary: serde_json::to_value(summary.unwrap_or_default()).unwrap_or_default(),
            fields,
            apps: None,
            changes: Vec::new(),
        }
    }
}

/// The rule fields for one state; a category that could not be read has no field.
fn rule_fields(
    state: &NetworkState,
    summary: Option<NetworkSummary>,
    tunnels_known: bool,
    routes_known: bool,
) -> BTreeMap<Identifier, FieldValue> {
    let mut fields: BTreeMap<Identifier, FieldValue> = BTreeMap::new();
    if let Some(proxy) = state.system_proxy {
        fields.insert(
            id("network.system_proxy"),
            FieldValue::Symbol(id(proxy_text(proxy))),
        );
    }
    if let Some(vpn) = state.managed_vpn {
        fields.insert(
            id("network.managed_vpn"),
            FieldValue::Symbol(id(vpn_text(vpn))),
        );
    }
    if let (Some(summary), true) = (summary, tunnels_known) {
        for (name, value) in summary.fields() {
            fields.insert(id(name), FieldValue::Number(value));
        }
    }
    if let (Some(generation), true) = (state.route_generation, routes_known) {
        fields.insert(
            id("network.route_generation"),
            FieldValue::Number(generation),
        );
    }
    fields
}

const fn proxy_text(proxy: Proxy) -> &'static str {
    match proxy {
        Proxy::None => "none",
        Proxy::Manual => "manual",
        Proxy::AutomaticConfig => "automatic_config",
        Proxy::AutoDetect => "auto_detect",
        Proxy::Unknown => "unknown",
    }
}

const fn vpn_text(vpn: ManagedVpn) -> &'static str {
    match vpn {
        ManagedVpn::Inactive => "inactive",
        ManagedVpn::Active => "active",
        ManagedVpn::Unknown => "unknown",
    }
}

/// The network configuration source.
pub struct NetworkSource {
    selection: Selection,
    tracking: Tracking,
    poller: Option<Poller>,
}

impl NetworkSource {
    #[must_use]
    pub fn new() -> Self {
        Self {
            selection: Selection::default(),
            tracking: Tracking::default(),
            poller: None,
        }
    }
}

impl Default for NetworkSource {
    fn default() -> Self {
        Self::new()
    }
}

impl Source for NetworkSource {
    fn descriptor(&self) -> CapabilityDescriptor {
        descriptor()
    }

    fn start(&mut self, categories: &[Identifier], sink: Sink) -> Result<Observation, SourceError> {
        self.stop();
        self.selection = Selection::of(categories);
        let selection = self.selection;
        let first = read(selection);
        self.poller = Some(Poller::start(
            "prctr-network",
            POLL_INTERVAL,
            first,
            move || read(selection),
            sink,
        )?);
        Ok(self.current())
    }

    fn current(&mut self) -> Observation {
        let raw = read(self.selection);
        self.tracking.classify(&raw)
    }

    fn stop(&mut self) {
        if let Some(poller) = self.poller.take() {
            poller.stop();
        }
    }
}

impl Drop for NetworkSource {
    fn drop(&mut self) {
        self.stop();
    }
}

#[cfg(test)]
#[path = "network_tests.rs"]
mod tests;
