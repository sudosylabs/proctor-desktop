//! Display topology: every connected display, classified, with a summary the baseline reads.
//! Contract: `docs/architecture/native-capability-families.md`, "Display topology".

use std::collections::BTreeMap;
use std::time::Duration;

use prctr_core::{
    CapabilityDescriptor, FieldKind, FieldSpec, FieldValue, Observation, Sink, Source, SourceError,
};
use prctr_os::{OsError, RawDisplay, RawKind, RawTopology};
use prctr_protocol::facts::{Certainty, Envelope, Health, Permission};
use prctr_protocol::rules::{
    Compare, CompareOp, Condition, Mode, Rule, RulePhase, RuleValue, Scalar,
};
use prctr_protocol::scalars::{Count, Identifier};
use schemars::JsonSchema;
use serde::Serialize;

use crate::poller::Poller;

pub const CAPABILITY: &str = "display";
/// Displays change rarely; reconciling twice a second cannot miss a change that happens in bursts.
pub const POLL_INTERVAL: Duration = Duration::from_millis(500);
pub const STABILITY_MS: u64 = 1_000;
pub const REASON_SINGLE_DISPLAY: &str = "display.single_display_required";

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum DisplayKind {
    Physical,
    Virtual,
    Wireless,
    Remote,
    Specialized,
    Unknown,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum Connection {
    Direct,
    Indirect,
    Unknown,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum Power {
    Awake,
    Asleep,
    Unknown,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum Primary {
    Primary,
    NotPrimary,
    Unknown,
}

/// One display. `target_id` is opaque and stable only within one agent session.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct DisplayTarget {
    pub target_id: String,
    pub active: bool,
    pub built_in: bool,
    pub kind: DisplayKind,
    pub connection: Connection,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mirror_of: Option<String>,
    pub power: Power,
    pub primary: Primary,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct DisplayState {
    pub targets: Vec<DisplayTarget>,
}

/// Derived only from the targets; sent with every fact.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct DisplaySummary {
    /// Physical, active and not a mirror.
    pub active_physical: u64,
    pub active_total: u64,
    /// Every connected target, including inactive, asleep and mirrored ones.
    pub connected_total: u64,
    pub mirrored: u64,
    pub r#virtual: u64,
    pub wireless: u64,
    pub remote: u64,
    pub specialized: u64,
    pub unknown_kind: u64,
}

impl DisplaySummary {
    #[must_use]
    pub fn of(state: &DisplayState) -> Self {
        let mut summary = Self::default();
        for target in &state.targets {
            summary.connected_total += 1;
            if target.active {
                summary.active_total += 1;
            }
            if target.mirror_of.is_some() {
                summary.mirrored += 1;
            }
            match target.kind {
                DisplayKind::Physical if target.active && target.mirror_of.is_none() => {
                    summary.active_physical += 1;
                }
                DisplayKind::Physical => {}
                DisplayKind::Virtual => summary.r#virtual += 1,
                DisplayKind::Wireless => summary.wireless += 1,
                DisplayKind::Remote => summary.remote += 1,
                DisplayKind::Specialized => summary.specialized += 1,
                DisplayKind::Unknown => summary.unknown_kind += 1,
            }
        }
        summary
    }

    fn fields(self) -> [(&'static str, u64); 9] {
        [
            ("display.summary.active_physical", self.active_physical),
            ("display.summary.active_total", self.active_total),
            ("display.summary.connected_total", self.connected_total),
            ("display.summary.mirrored", self.mirrored),
            ("display.summary.virtual", self.r#virtual),
            ("display.summary.wireless", self.wireless),
            ("display.summary.remote", self.remote),
            ("display.summary.specialized", self.specialized),
            ("display.summary.unknown_kind", self.unknown_kind),
        ]
    }
}

fn id(text: &str) -> Identifier {
    Identifier::new(text).expect("display identifier is valid")
}

#[must_use]
pub fn descriptor() -> CapabilityDescriptor {
    CapabilityDescriptor {
        id: id(CAPABILITY),
        sensitive: false,
        stability_ms: STABILITY_MS,
        categories: Vec::new(),
        fields: DisplaySummary::default()
            .fields()
            .iter()
            .map(|(name, _)| FieldSpec {
                name: id(name),
                kind: FieldKind::Count {
                    max: prctr_os::MAX_DISPLAYS as u64,
                },
            })
            .collect(),
        reasons: vec![id(REASON_SINGLE_DISPLAY)],
        app_conditions: false,
        permission_prompt: false,
    }
}

/// `baseline.single_display`: one connected display, which is physical and active. Partial
/// certainty makes it unknown through the envelope, never not met.
///
/// # Panics
/// Never: every identifier and count in it is a valid constant.
#[must_use]
pub fn baseline_rule() -> Rule {
    let count = |field: &str| {
        Condition::Compare(Compare {
            field: id(field),
            op: CompareOp::Eq,
            value: RuleValue::One(Scalar::Number(Count::new(1).expect("one is a count"))),
        })
    };
    Rule {
        rule_id: id("baseline.single_display"),
        capability: id(CAPABILITY),
        mode: Mode::Enforce,
        phase: RulePhase::Both,
        reason: id(REASON_SINGLE_DISPLAY),
        requirement: Condition::All {
            conditions: vec![
                count("display.summary.connected_total"),
                count("display.summary.active_physical"),
            ],
        },
    }
}

/// Assigns opaque target identities that stay stable for the agent session.
#[derive(Debug, Default)]
pub struct TargetIds {
    assigned: BTreeMap<u64, String>,
}

impl TargetIds {
    fn of(&mut self, raw: u64) -> String {
        let next = self.assigned.len() + 1;
        self.assigned
            .entry(raw)
            .or_insert_with(|| format!("target{next:04}"))
            .clone()
    }
}

/// The facts for one raw topology. Certainty is complete only when every target is classified and
/// the platform can see mirroring.
#[must_use]
pub fn classify(raw: &Result<RawTopology, OsError>, ids: &mut TargetIds) -> Observation {
    let Ok(topology) = raw else {
        return observation(
            Envelope {
                permission: Permission::Granted,
                health: Health::Failed,
                certainty: Certainty::Unknown,
            },
            &DisplayState {
                targets: Vec::new(),
            },
        );
    };
    let complete = topology.mirroring_known
        && topology
            .displays
            .iter()
            .all(|display| display.kind != RawKind::Unclassified);
    let targets = topology
        .displays
        .iter()
        .map(|display| target(display, ids))
        .collect();
    observation(
        Envelope {
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
        &DisplayState { targets },
    )
}

fn target(display: &RawDisplay, ids: &mut TargetIds) -> DisplayTarget {
    let (kind, connection) = match display.kind {
        RawKind::BuiltIn | RawKind::External => (DisplayKind::Physical, Connection::Direct),
        RawKind::IndirectExternal => (DisplayKind::Physical, Connection::Indirect),
        RawKind::Virtual => (DisplayKind::Virtual, Connection::Indirect),
        RawKind::Wireless => (DisplayKind::Wireless, Connection::Unknown),
        RawKind::Unclassified => (DisplayKind::Unknown, Connection::Unknown),
    };
    DisplayTarget {
        target_id: ids.of(display.id),
        active: display.active,
        built_in: display.kind == RawKind::BuiltIn,
        kind,
        connection,
        mirror_of: display.mirror_of.map(|mirror| ids.of(mirror)),
        power: if display.asleep {
            Power::Asleep
        } else {
            Power::Awake
        },
        primary: if display.main {
            Primary::Primary
        } else {
            Primary::Unknown
        },
    }
}

fn observation(envelope: Envelope, state: &DisplayState) -> Observation {
    let summary = DisplaySummary::of(state);
    Observation {
        envelope,
        state: serde_json::to_value(state).unwrap_or_default(),
        summary: serde_json::to_value(summary).unwrap_or_default(),
        fields: summary
            .fields()
            .iter()
            .map(|(name, value)| (id(name), FieldValue::Number(*value)))
            .collect(),
        apps: None,
        changes: Vec::new(),
    }
}

/// The platform query this build uses.
fn query() -> Result<RawTopology, OsError> {
    #[cfg(target_os = "macos")]
    return prctr_os::macos::online_displays();
    #[cfg(target_os = "windows")]
    return prctr_os::windows::display_targets();
    #[cfg(target_os = "linux")]
    return prctr_os::linux::connected_displays();
    #[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
    Err(OsError {
        operation: "display query",
        status: -1,
    })
}

/// The display topology source: reconciles the OS topology every [`POLL_INTERVAL`].
pub struct DisplaySource {
    query: fn() -> Result<RawTopology, OsError>,
    ids: TargetIds,
    poller: Option<Poller>,
}

impl DisplaySource {
    #[must_use]
    pub fn new() -> Self {
        Self::with_query(query)
    }

    /// A source over any topology query, for tests.
    #[must_use]
    pub fn with_query(query: fn() -> Result<RawTopology, OsError>) -> Self {
        Self {
            query,
            ids: TargetIds::default(),
            poller: None,
        }
    }
}

impl Default for DisplaySource {
    fn default() -> Self {
        Self::new()
    }
}

impl Source for DisplaySource {
    fn descriptor(&self) -> CapabilityDescriptor {
        descriptor()
    }

    fn start(
        &mut self,
        _categories: &[Identifier],
        sink: Sink,
    ) -> Result<Observation, SourceError> {
        self.stop();
        let query = self.query;
        self.poller = Some(Poller::start(
            "prctr-display",
            POLL_INTERVAL,
            query(),
            query,
            sink,
        )?);
        Ok(self.current())
    }

    fn current(&mut self) -> Observation {
        let raw = (self.query)();
        classify(&raw, &mut self.ids)
    }

    fn stop(&mut self) {
        if let Some(poller) = self.poller.take() {
            poller.stop();
        }
    }
}

impl Drop for DisplaySource {
    fn drop(&mut self) {
        self.stop();
    }
}

#[cfg(test)]
#[path = "display_tests.rs"]
mod tests;
