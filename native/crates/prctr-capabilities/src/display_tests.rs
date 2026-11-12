use prctr_core::{Engine, InitialState, Registry};
use prctr_os::{RawDisplay, RawKind, RawTopology};
use prctr_protocol::facts::{Certainty, Health};
use prctr_protocol::rules::{Activation, Policy, Status, UnknownCause};
use prctr_protocol::scalars::{Identifier, OpaqueId};

use super::*;

fn raw(id: u64, kind: RawKind, active: bool, mirror_of: Option<u64>) -> RawDisplay {
    RawDisplay {
        id,
        kind,
        active,
        main: id == 1,
        asleep: false,
        mirror_of,
    }
}

#[allow(clippy::unnecessary_wraps)] // Fixtures take the shape the OS query returns.
fn topology(displays: Vec<RawDisplay>) -> Result<RawTopology, prctr_os::OsError> {
    Ok(RawTopology {
        displays,
        mirroring_known: true,
    })
}

fn summary_of(observation: &Observation) -> DisplaySummary {
    serde_json::from_value::<serde_json::Value>(observation.summary.clone())
        .ok()
        .map(|value| DisplaySummary {
            active_physical: value["active_physical"].as_u64().unwrap_or(99),
            active_total: value["active_total"].as_u64().unwrap_or(99),
            connected_total: value["connected_total"].as_u64().unwrap_or(99),
            mirrored: value["mirrored"].as_u64().unwrap_or(99),
            r#virtual: value["virtual"].as_u64().unwrap_or(99),
            wireless: value["wireless"].as_u64().unwrap_or(99),
            remote: value["remote"].as_u64().unwrap_or(99),
            specialized: value["specialized"].as_u64().unwrap_or(99),
            unknown_kind: value["unknown_kind"].as_u64().unwrap_or(99),
        })
        .unwrap_or_default()
}

/// The baseline rule's status for one topology, through the real engine.
fn baseline_status(raw: &Result<RawTopology, prctr_os::OsError>) -> (Status, Option<UnknownCause>) {
    let mut engine = Engine::new(Registry {
        capabilities: vec![descriptor()],
        baseline_rules: vec![baseline_rule()],
    });
    let policy = Policy {
        activations: vec![Activation {
            capability: Identifier::new(CAPABILITY).expect("valid"),
            categories: Vec::new(),
        }],
        rules: vec![baseline_rule()],
    };
    let (_, statuses) = engine
        .open_readiness(
            policy,
            vec![InitialState {
                capability: Identifier::new(CAPABILITY).expect("valid"),
                source_instance_id: OpaqueId::new("display00001").expect("valid"),
                observation: classify(raw, &mut TargetIds::default()),
            }],
            0,
        )
        .expect("the baseline policy is valid");
    (statuses[0].status, statuses[0].unknown_cause)
}

#[test]
fn a_laptop_alone_meets_the_single_display_baseline_with_complete_certainty() {
    let laptop = topology(vec![raw(1, RawKind::BuiltIn, true, None)]);
    let observation = classify(&laptop, &mut TargetIds::default());
    assert_eq!(observation.envelope.certainty, Certainty::Complete);
    assert_eq!(observation.envelope.health, Health::Healthy);
    assert_eq!(summary_of(&observation).active_physical, 1);
    assert_eq!(baseline_status(&laptop), (Status::Met, None));
}

#[test]
fn a_laptop_with_an_external_monitor_does_not_meet_the_baseline() {
    let two = topology(vec![
        raw(1, RawKind::BuiltIn, true, None),
        raw(2, RawKind::External, true, None),
    ]);
    assert_eq!(baseline_status(&two), (Status::NotMet, None));
}

#[test]
fn a_mirrored_second_target_still_counts_as_connected() {
    let mirrored = topology(vec![
        raw(1, RawKind::BuiltIn, true, None),
        raw(2, RawKind::External, true, Some(1)),
    ]);
    let observation = classify(&mirrored, &mut TargetIds::default());
    let summary = summary_of(&observation);
    assert_eq!(
        (
            summary.connected_total,
            summary.mirrored,
            summary.active_physical
        ),
        (2, 1, 1)
    );
    assert_eq!(baseline_status(&mirrored), (Status::NotMet, None));
}

#[test]
fn a_closed_lid_with_one_external_monitor_is_a_single_display() {
    // With the lid closed the OS takes the built-in panel offline; only the external remains.
    let clamshell = topology(vec![raw(2, RawKind::External, true, None)]);
    assert_eq!(baseline_status(&clamshell), (Status::Met, None));
}

#[test]
fn a_usb_dock_monitor_is_a_physical_screen_behind_an_indirect_connection() {
    let docked = topology(vec![raw(3, RawKind::IndirectExternal, true, None)]);
    let observation = classify(&docked, &mut TargetIds::default());
    assert_eq!(observation.state["targets"][0]["kind"], "physical");
    assert_eq!(observation.state["targets"][0]["connection"], "indirect");
}

#[test]
fn a_virtual_target_is_counted_and_fails_the_baseline() {
    let with_virtual = topology(vec![
        raw(1, RawKind::BuiltIn, true, None),
        raw(4, RawKind::Virtual, true, None),
    ]);
    let observation = classify(&with_virtual, &mut TargetIds::default());
    assert_eq!(summary_of(&observation).r#virtual, 1);
    assert_eq!(baseline_status(&with_virtual), (Status::NotMet, None));
}

#[test]
fn an_unclassified_external_target_makes_the_baseline_unknown_partial_never_met() {
    let unclassified = topology(vec![raw(5, RawKind::Unclassified, true, None)]);
    let observation = classify(&unclassified, &mut TargetIds::default());
    assert_eq!(observation.envelope.certainty, Certainty::Partial);
    assert_eq!(
        baseline_status(&unclassified),
        (Status::Unknown, Some(UnknownCause::Partial))
    );
}

#[test]
fn unknown_mirroring_makes_the_topology_partial() {
    let linux = Ok(RawTopology {
        displays: vec![raw(1, RawKind::BuiltIn, true, None)],
        mirroring_known: false,
    });
    assert_eq!(
        classify(&linux, &mut TargetIds::default())
            .envelope
            .certainty,
        Certainty::Partial
    );
}

#[test]
fn an_os_failure_is_a_failed_capability_with_no_targets() {
    let failed = Err(prctr_os::OsError {
        operation: "test",
        status: 1,
    });
    let observation = classify(&failed, &mut TargetIds::default());
    assert_eq!(observation.envelope.health, Health::Failed);
    assert_eq!(
        baseline_status(&failed),
        (Status::Unknown, Some(UnknownCause::Unhealthy))
    );
}

#[test]
fn target_identities_are_opaque_and_stable_within_a_session() {
    let mut ids = TargetIds::default();
    let first = classify(
        &topology(vec![raw(77, RawKind::BuiltIn, true, None)]),
        &mut ids,
    );
    let second = classify(
        &topology(vec![
            raw(88, RawKind::External, true, None),
            raw(77, RawKind::BuiltIn, true, None),
        ]),
        &mut ids,
    );
    assert_eq!(first.state["targets"][0]["target_id"], "target0001");
    assert_eq!(second.state["targets"][1]["target_id"], "target0001");
    assert_eq!(second.state["targets"][0]["target_id"], "target0002");
}

#[test]
fn the_summary_always_matches_the_targets() {
    let kinds = [
        RawKind::BuiltIn,
        RawKind::External,
        RawKind::IndirectExternal,
        RawKind::Virtual,
        RawKind::Wireless,
        RawKind::Unclassified,
    ];
    let mut seed = 0x9E37_79B9_7F4A_7C15_u64;
    let mut next = |below: u64| {
        seed ^= seed << 13;
        seed ^= seed >> 7;
        seed ^= seed << 17;
        seed % below
    };
    for _ in 0..500 {
        let count = next(6);
        let displays: Vec<RawDisplay> = (0..count)
            .map(|index| {
                let mirror = (next(4) == 0 && index > 0).then(|| next(index));
                raw(
                    index,
                    kinds[usize::try_from(next(6)).unwrap_or(0)],
                    next(2) == 0,
                    mirror,
                )
            })
            .collect();
        let observation = classify(&topology(displays.clone()), &mut TargetIds::default());
        let summary = summary_of(&observation);
        assert_eq!(summary.connected_total, count);
        assert_eq!(
            summary.active_total,
            displays.iter().filter(|display| display.active).count() as u64
        );
        assert!(summary.active_physical <= summary.active_total);
        assert_eq!(
            summary.mirrored,
            displays
                .iter()
                .filter(|display| display.mirror_of.is_some())
                .count() as u64
        );
        assert_eq!(
            summary.unknown_kind,
            displays
                .iter()
                .filter(|display| display.kind == RawKind::Unclassified)
                .count() as u64
        );
    }
}

#[test]
fn display_topology_passes_the_core_conformance_suite() {
    let one = classify(
        &topology(vec![raw(1, RawKind::BuiltIn, true, None)]),
        &mut TargetIds::default(),
    );
    let two = classify(
        &topology(vec![
            raw(1, RawKind::BuiltIn, true, None),
            raw(2, RawKind::External, true, None),
        ]),
        &mut TargetIds::default(),
    );
    prctr_core::testing::assert_capability_conformance(&descriptor(), &one, &two);
}

#[test]
fn the_baseline_rule_only_uses_registered_fields() {
    let registry = Registry {
        capabilities: vec![descriptor()],
        baseline_rules: vec![baseline_rule()],
    };
    let policy = Policy {
        activations: vec![Activation {
            capability: Identifier::new(CAPABILITY).expect("valid"),
            categories: Vec::new(),
        }],
        rules: vec![baseline_rule()],
    };
    assert!(prctr_core::ValidPolicy::new(policy, &registry).is_ok());
}

/// Real OS: the agent's connected count matches an independent oracle (`system_profiler`), and two
/// consecutive reads agree.
#[cfg(target_os = "macos")]
#[test]
fn macos_reports_the_same_number_of_displays_as_system_profiler() {
    let mut source = DisplaySource::new();
    let first = source.current();
    let second = source.current();
    assert_eq!(first.state, second.state, "two consecutive reads agree");
    assert_ne!(
        first.envelope.health,
        Health::Failed,
        "CoreGraphics answered"
    );
    let output = std::process::Command::new("/usr/sbin/system_profiler")
        .args(["SPDisplaysDataType", "-json"])
        .output()
        .expect("system_profiler runs");
    let report: serde_json::Value =
        serde_json::from_slice(&output.stdout).expect("system_profiler JSON");
    let oracle: u64 = report["SPDisplaysDataType"].as_array().map_or(0, |gpus| {
        gpus.iter()
            .map(|gpu| gpu["spdisplays_ndrvs"].as_array().map_or(0, Vec::len) as u64)
            .sum()
    });
    assert_eq!(summary_of(&first).connected_total, oracle);
}
