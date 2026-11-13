use std::cell::Cell;

use prctr_protocol::rules::{Mode, RulePhase};

use super::*;

fn app(id: &str) -> Classified {
    Classified::App(
        catalog::APPS
            .iter()
            .find(|app| app.id == id)
            .expect("in the catalog"),
    )
}

fn seen(classified: Classified) -> Seen {
    Seen {
        own: false,
        classified,
    }
}

fn set(ids: &[&str]) -> BTreeSet<String> {
    ids.iter().map(|id| (*id).to_owned()).collect()
}

fn process(pid: u32, parent: u32) -> RawProcess {
    RawProcess {
        instance: u64::from(pid) * 1_000,
        pid,
        parent,
    }
}

#[test]
fn a_blocklist_names_the_catalog_applications_it_found() {
    let rules = vec![(
        "no_remote".to_owned(),
        AppCondition::Absent(set(&["teamviewer", "zoom"])),
    )];
    let matches = match_rules(
        &rules,
        &[
            seen(app("zoom")),
            seen(app("google_chrome")),
            seen(Classified::Unidentified),
        ],
    );
    assert_eq!(
        matches,
        vec![RuleMatch {
            rule_id: "no_remote".to_owned(),
            matched: true,
            catalog_app_ids: vec!["zoom".to_owned()],
        }]
    );
    let clean = match_rules(
        &rules,
        &[seen(app("google_chrome")), seen(Classified::Unidentified)],
    );
    assert!(
        !clean[0].matched,
        "an unidentified process never matches a blocklist"
    );
}

#[test]
fn an_allowlist_tolerates_the_os_and_proctor_and_nothing_else() {
    let rules = vec![(
        "only_code".to_owned(),
        AppCondition::Only(set(&["visual_studio_code"])),
    )];
    let met = match_rules(
        &rules,
        &[
            seen(app("visual_studio_code")),
            seen(Classified::OsEssential),
            Seen {
                own: true,
                classified: Classified::Unidentified,
            },
        ],
    );
    assert!(!met[0].matched);
    assert!(
        met[0].catalog_app_ids.is_empty(),
        "an allowlist names nothing"
    );
    for outsider in [
        app("google_chrome"),
        Classified::Unlisted,
        Classified::Unidentified,
    ] {
        let violated = match_rules(&rules, &[seen(app("visual_studio_code")), seen(outsider)]);
        assert!(violated[0].matched, "{outsider:?}");
        assert!(violated[0].catalog_app_ids.is_empty());
    }
}

#[test]
fn proctor_is_its_root_and_descendants_and_a_child_of_an_allowed_app_is_not() {
    let processes = [
        process(100, 1),
        process(101, 100),
        process(102, 101),
        process(200, 1),
        process(201, 200),
    ];
    let own = own_processes(&processes, 100);
    assert_eq!(own, BTreeSet::from([100, 101, 102]));
    assert!(
        !own.contains(&201),
        "a process started by another application is judged on its own"
    );
}

#[test]
fn a_parent_loop_ends_without_hanging() {
    let processes = [process(5, 6), process(6, 5)];
    assert!(own_processes(&processes, 100).is_empty());
}

#[test]
fn each_instance_is_identified_once_and_forgotten_when_gone() {
    let calls = Cell::new(0);
    let identity = |_pid| {
        calls.set(calls.get() + 1);
        RawIdentity::Unsigned
    };
    let mut inventory = Inventory::default();
    inventory.observe(&[process(1, 0), process(2, 0)], 0, identity);
    inventory.observe(&[process(1, 0), process(2, 0)], 0, identity);
    assert_eq!(calls.get(), 2, "known instances are not read again");
    inventory.observe(&[process(1, 0)], 0, identity);
    inventory.observe(&[process(1, 0), process(2, 0)], 0, identity);
    assert_eq!(calls.get(), 3, "a returning number is read again");
}

#[test]
fn rules_without_an_app_condition_are_ignored_and_nested_ones_are_found() {
    let nested = Condition::Not {
        condition: Box::new(Condition::All {
            conditions: vec![Condition::AppsAbsent {
                catalog_app_ids: vec![id("discord")],
            }],
        }),
    };
    assert_eq!(
        app_condition(&nested),
        Some(AppCondition::Absent(set(&["discord"])))
    );
}

#[test]
fn snapshots_are_partial_and_a_changed_match_is_a_change() {
    let mut tracking = Tracking::default();
    let clean = vec![RuleMatch {
        rule_id: "r".to_owned(),
        matched: false,
        catalog_app_ids: Vec::new(),
    }];
    let first = tracking.classify(Some(clean.clone()), Coverage::SnapshotOnly);
    assert_eq!(first.envelope.certainty, Certainty::Partial);
    assert!(first.changes.is_empty());
    assert!(!first.apps.expect("matches").violated[&id("r")]);
    assert!(
        tracking
            .classify(Some(clean.clone()), Coverage::SnapshotOnly)
            .changes
            .is_empty()
    );
    let mut found = clean;
    found[0].matched = true;
    assert_eq!(
        tracking
            .classify(Some(found), Coverage::SnapshotOnly)
            .changes,
        vec![id(CHANGE_MATCHES)]
    );
    let lost = tracking.classify(None, Coverage::SnapshotOnly);
    assert_eq!(lost.state["coverage"], "unavailable");
    assert!(lost.apps.is_none());
}

#[test]
fn a_full_lifecycle_violation_is_not_met_through_the_engine() {
    use prctr_core::{Engine, InitialState, Input, RegisteredApplication, Registry};
    use prctr_protocol::rules::{Activation, Policy, Status};
    use prctr_protocol::scalars::OpaqueId;

    let rule = Rule {
        rule_id: id("no_zoom"),
        capability: id(CAPABILITY),
        mode: Mode::Enforce,
        phase: RulePhase::Both,
        reason: id(REASON_BLOCKED),
        requirement: Condition::AppsAbsent {
            catalog_app_ids: vec![id("zoom")],
        },
    };
    let mut engine = Engine::new(Registry {
        capabilities: vec![descriptor()],
        baseline_rules: Vec::new(),
        applications: catalog::registered(),
    });
    let mut tracking = Tracking::default();
    let clean = vec![RuleMatch {
        rule_id: "no_zoom".to_owned(),
        matched: false,
        catalog_app_ids: Vec::new(),
    }];
    let (_, statuses) = engine
        .open_readiness(
            Policy {
                activations: vec![Activation {
                    capability: id(CAPABILITY),
                    categories: Vec::new(),
                }],
                rules: vec![rule],
            },
            vec![InitialState {
                capability: id(CAPABILITY),
                source_instance_id: OpaqueId::new("process0001").expect("valid"),
                observation: tracking.classify(Some(clean), Coverage::FullLifecycle),
            }],
            0,
        )
        .expect("opens");
    assert_eq!(statuses[0].status, Status::Met);
    let found = vec![RuleMatch {
        rule_id: "no_zoom".to_owned(),
        matched: true,
        catalog_app_ids: vec!["zoom".to_owned()],
    }];
    let numbered = engine
        .handle(Input::Observed {
            capability: id(CAPABILITY),
            observation: tracking.classify(Some(found), Coverage::FullLifecycle),
            at_ms: 10,
        })
        .expect("applies");
    assert!(
        numbered
            .iter()
            .any(|message| format!("{message:?}").contains("NotMet")),
        "the found application violates the rule at once"
    );
    let _ = RegisteredApplication {
        id: id("zoom"),
        allowable: false,
    };
}

#[test]
fn process_application_passes_the_core_conformance_suite() {
    let mut tracking = Tracking::default();
    let clean = tracking.classify(Some(Vec::new()), Coverage::SnapshotOnly);
    let gone = tracking.classify(None, Coverage::SnapshotOnly);
    prctr_core::testing::assert_capability_conformance(&descriptor(), &clean, &gone);
}

/// Real OS: this account's processes are listed and their identities read; the matcher finds no
/// process outside an allowlist that names nothing, because this machine runs applications.
#[cfg(target_os = "macos")]
#[test]
fn this_machine_lists_and_identifies_its_processes() {
    let mut reader = Matcher {
        rules: vec![(
            "only_nothing".to_owned(),
            AppCondition::Only(BTreeSet::new()),
        )],
        ..Matcher::default()
    };
    let matches = reader.read().expect("processes are listed");
    assert!(
        matches[0].matched,
        "a working machine runs applications outside an empty allowlist"
    );
}
