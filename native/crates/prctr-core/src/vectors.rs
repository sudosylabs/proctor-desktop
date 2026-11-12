//! Rule conformance vectors: hand-written cases with the statuses the rule semantics require.
//! The core's tests run every case through the engine; `prctr-xtask` publishes them as
//! `conformance/rules.json` so the server's evaluator passes the same cases.

use std::collections::BTreeMap;

use serde_json::{Value, json};

use prctr_protocol::facts::{Certainty, Envelope, Health, Permission};
use prctr_protocol::rules::{Policy, Status, UnknownCause};
use prctr_protocol::scalars::{Identifier, OpaqueId};

use crate::engine::{Engine, InitialState, Input};
use crate::observation::{AppMatches, FieldValue, Observation};
use crate::registry::{CapabilityDescriptor, FieldKind, FieldSpec, Registry};

/// Stability time of the example capabilities.
pub const STABILITY_MS: u64 = 1_000;

fn id(text: &str) -> Identifier {
    Identifier::new(text).unwrap_or_else(|_| panic!("vector identifier {text} is valid"))
}

/// Two synthetic capabilities: `example` with a count and a symbol field, and `apps` with
/// application conditions.
#[must_use]
pub fn example_registry() -> Registry {
    Registry {
        capabilities: vec![
            CapabilityDescriptor {
                id: id("example"),
                sensitive: false,
                stability_ms: STABILITY_MS,
                categories: Vec::new(),
                fields: vec![
                    FieldSpec {
                        name: id("example.count"),
                        kind: FieldKind::Count { max: 32 },
                    },
                    FieldSpec {
                        name: id("example.mode"),
                        kind: FieldKind::Symbol {
                            values: vec![id("on"), id("off")],
                        },
                    },
                ],
                reasons: vec![id("example.reason")],
                app_conditions: false,
                permission_prompt: false,
            },
            CapabilityDescriptor {
                id: id("apps"),
                sensitive: true,
                stability_ms: STABILITY_MS,
                categories: Vec::new(),
                fields: Vec::new(),
                reasons: vec![id("apps.reason")],
                app_conditions: true,
                permission_prompt: false,
            },
        ],
        baseline_rules: Vec::new(),
    }
}

/// The facts a vector step reports for one capability. JSON form:
/// `{ "envelope": {…}, "fields": { name: number | symbol }, "apps": { "checking": n, "violated": { rule: bool } } }`.
#[derive(Clone, Debug)]
pub struct VectorState {
    pub envelope: Envelope,
    pub fields: BTreeMap<String, Value>,
    pub apps: Option<(u64, BTreeMap<String, bool>)>,
}

impl VectorState {
    fn json(&self) -> Value {
        let mut value = json!({ "envelope": self.envelope, "fields": self.fields });
        if let Some((checking, violated)) = &self.apps {
            value["apps"] = json!({ "checking": checking, "violated": violated });
        }
        value
    }

    /// The observation the engine sees. Its wire state is the vector state itself, so two vector
    /// states are the same machine state exactly when their JSON is equal.
    #[must_use]
    pub fn observation(&self) -> Observation {
        let fields = self
            .fields
            .iter()
            .map(|(name, value)| {
                let value = match value {
                    Value::Number(number) => FieldValue::Number(number.as_u64().unwrap_or(0)),
                    Value::String(symbol) => FieldValue::Symbol(id(symbol)),
                    _ => FieldValue::Number(0),
                };
                (id(name), value)
            })
            .collect();
        let apps = self.apps.as_ref().map(|(checking, violated)| AppMatches {
            checking: *checking,
            violated: violated
                .iter()
                .map(|(rule, value)| (id(rule), *value))
                .collect(),
        });
        Observation {
            envelope: self.envelope,
            state: self.json(),
            summary: json!({}),
            fields,
            apps,
            changes: Vec::new(),
        }
    }
}

/// One step of a case.
#[derive(Clone, Debug)]
pub enum Step {
    /// Open readiness with one state per activated capability.
    Open(BTreeMap<String, VectorState>),
    Observe(String, VectorState),
    EventsLost(String, u64),
    Interrupted,
    Tick,
    Begin,
    Confirm,
}

/// The status a rule must have after a step.
#[derive(Clone, Debug)]
pub struct Expect {
    pub rule_id: &'static str,
    pub status: Status,
    pub unknown_cause: Option<UnknownCause>,
}

#[derive(Clone, Debug)]
pub struct Case {
    pub name: &'static str,
    pub policy: Value,
    /// `(time in ms, step, expected statuses after it)`.
    pub steps: Vec<(u64, Step, Vec<Expect>)>,
}

/// A policy the evaluator must refuse.
#[derive(Clone, Debug)]
pub struct Refusal {
    pub name: &'static str,
    pub policy: Value,
}

const fn met(rule_id: &'static str) -> Expect {
    Expect {
        rule_id,
        status: Status::Met,
        unknown_cause: None,
    }
}

const fn not_met(rule_id: &'static str) -> Expect {
    Expect {
        rule_id,
        status: Status::NotMet,
        unknown_cause: None,
    }
}

const fn unknown(rule_id: &'static str, cause: UnknownCause) -> Expect {
    Expect {
        rule_id,
        status: Status::Unknown,
        unknown_cause: Some(cause),
    }
}

const COMPLETE: Envelope = Envelope {
    permission: Permission::Granted,
    health: Health::Healthy,
    certainty: Certainty::Complete,
};

fn example(envelope: Envelope, count: Option<u64>, mode: Option<&str>) -> VectorState {
    let mut fields = BTreeMap::new();
    if let Some(count) = count {
        fields.insert("example.count".to_owned(), json!(count));
    }
    if let Some(mode) = mode {
        fields.insert("example.mode".to_owned(), json!(mode));
    }
    VectorState {
        envelope,
        fields,
        apps: None,
    }
}

fn apps(envelope: Envelope, checking: u64, violated: &[(&str, bool)]) -> VectorState {
    VectorState {
        envelope,
        fields: BTreeMap::new(),
        apps: Some((
            checking,
            violated
                .iter()
                .map(|(rule, value)| ((*rule).to_owned(), *value))
                .collect(),
        )),
    }
}

fn open(states: &[(&str, VectorState)]) -> Step {
    Step::Open(
        states
            .iter()
            .map(|(capability, state)| ((*capability).to_owned(), state.clone()))
            .collect(),
    )
}

fn observe(capability: &str, state: VectorState) -> Step {
    Step::Observe(capability.to_owned(), state)
}

fn rule(rule_id: &str, capability: &str, mode: &str, phase: &str, requirement: &Value) -> Value {
    json!({
        "rule_id": rule_id,
        "capability": capability,
        "mode": mode,
        "phase": phase,
        "reason": format!("{capability}.reason"),
        "requirement": requirement,
    })
}

fn compare(field: &str, op: &str, value: &Value) -> Value {
    json!({ "Compare": { "field": field, "op": op, "value": value } })
}

fn policy(capabilities: &[&str], rules: &[Value]) -> Value {
    json!({
        "activations": capabilities.iter().map(|capability| json!({ "capability": capability, "categories": [] })).collect::<Vec<_>>(),
        "rules": rules,
    })
}

fn envelope(health: Health, permission: Permission, certainty: Certainty) -> Envelope {
    Envelope {
        permission,
        health,
        certainty,
    }
}

/// Every evaluation case.
#[must_use]
#[allow(clippy::too_many_lines)]
pub fn cases() -> Vec<Case> {
    let one = compare("example.count", "eq", &json!(1));
    let mode_on = compare("example.mode", "in", &json!(["on"]));
    vec![
        Case {
            name: "first_evaluation_sets_the_status_without_waiting",
            policy: policy(
                &["example"],
                &[rule("r", "example", "enforce", "both", &one)],
            ),
            steps: vec![(
                0,
                open(&[("example", example(COMPLETE, Some(1), Some("on")))]),
                vec![met("r")],
            )],
        },
        Case {
            name: "count_comparisons",
            policy: policy(
                &["example"],
                &[
                    rule("eq", "example", "enforce", "both", &one),
                    rule(
                        "lt",
                        "example",
                        "enforce",
                        "both",
                        &compare("example.count", "lt", &json!(2)),
                    ),
                    rule(
                        "ge",
                        "example",
                        "enforce",
                        "both",
                        &compare("example.count", "ge", &json!(3)),
                    ),
                    rule(
                        "in",
                        "example",
                        "enforce",
                        "both",
                        &compare("example.count", "in", &json!([0, 2])),
                    ),
                    rule(
                        "not_in",
                        "example",
                        "enforce",
                        "both",
                        &compare("example.count", "not_in", &json!([0, 2])),
                    ),
                ],
            ),
            steps: vec![(
                0,
                open(&[("example", example(COMPLETE, Some(2), None))]),
                vec![
                    not_met("eq"),
                    not_met("lt"),
                    not_met("ge"),
                    met("in"),
                    not_met("not_in"),
                ],
            )],
        },
        Case {
            name: "a_missing_field_is_unavailable",
            policy: policy(
                &["example"],
                &[rule("r", "example", "enforce", "both", &mode_on)],
            ),
            steps: vec![(
                0,
                open(&[("example", example(COMPLETE, Some(1), None))]),
                vec![unknown("r", UnknownCause::Unavailable)],
            )],
        },
        Case {
            name: "partial_certainty_is_unknown_partial_never_not_met",
            policy: policy(
                &["example"],
                &[rule("r", "example", "enforce", "both", &one)],
            ),
            steps: vec![(
                0,
                open(&[(
                    "example",
                    example(
                        envelope(Health::Degraded, Permission::Granted, Certainty::Partial),
                        Some(2),
                        None,
                    ),
                )]),
                vec![unknown("r", UnknownCause::Partial)],
            )],
        },
        Case {
            name: "envelope_causes_report_the_first_in_order",
            policy: policy(
                &["example"],
                &[rule("r", "example", "enforce", "both", &one)],
            ),
            steps: vec![
                (
                    0,
                    open(&[(
                        "example",
                        example(
                            envelope(Health::Failed, Permission::Denied, Certainty::Partial),
                            Some(1),
                            None,
                        ),
                    )]),
                    vec![unknown("r", UnknownCause::Unhealthy)],
                ),
                (
                    10,
                    observe(
                        "example",
                        example(
                            envelope(Health::Healthy, Permission::Denied, Certainty::Partial),
                            Some(1),
                            None,
                        ),
                    ),
                    vec![unknown("r", UnknownCause::Permission)],
                ),
                (
                    20,
                    observe(
                        "example",
                        example(
                            envelope(Health::Degraded, Permission::Granted, Certainty::Partial),
                            Some(1),
                            None,
                        ),
                    ),
                    vec![unknown("r", UnknownCause::Partial)],
                ),
            ],
        },
        Case {
            name: "unknown_and_not_met_combine_by_kleene_logic",
            policy: policy(
                &["example"],
                &[
                    rule(
                        "all_not_met_wins",
                        "example",
                        "enforce",
                        "both",
                        &json!({ "All": { "conditions": [mode_on, compare("example.count", "eq", &json!(9))] } }),
                    ),
                    rule(
                        "all_unknown",
                        "example",
                        "enforce",
                        "both",
                        &json!({ "All": { "conditions": [one, mode_on] } }),
                    ),
                    rule(
                        "any_met_wins",
                        "example",
                        "enforce",
                        "both",
                        &json!({ "Any": { "conditions": [mode_on, one] } }),
                    ),
                    rule(
                        "any_unknown",
                        "example",
                        "enforce",
                        "both",
                        &json!({ "Any": { "conditions": [compare("example.count", "eq", &json!(9)), mode_on] } }),
                    ),
                    rule(
                        "not_unknown",
                        "example",
                        "enforce",
                        "both",
                        &json!({ "Not": { "condition": mode_on } }),
                    ),
                    rule(
                        "not_met",
                        "example",
                        "enforce",
                        "both",
                        &json!({ "Not": { "condition": one } }),
                    ),
                ],
            ),
            steps: vec![(
                0,
                open(&[("example", example(COMPLETE, Some(1), None))]),
                vec![
                    not_met("all_not_met_wins"),
                    unknown("all_unknown", UnknownCause::Unavailable),
                    met("any_met_wins"),
                    unknown("any_unknown", UnknownCause::Unavailable),
                    unknown("not_unknown", UnknownCause::Unavailable),
                    not_met("not_met"),
                ],
            )],
        },
        Case {
            name: "recovery_waits_for_the_stability_time_violation_is_immediate",
            policy: policy(
                &["example"],
                &[rule("r", "example", "enforce", "both", &one)],
            ),
            steps: vec![
                (
                    0,
                    open(&[("example", example(COMPLETE, Some(2), None))]),
                    vec![not_met("r")],
                ),
                (
                    100,
                    observe("example", example(COMPLETE, Some(1), None)),
                    vec![not_met("r")],
                ),
                (100 + STABILITY_MS - 1, Step::Tick, vec![not_met("r")]),
                (100 + STABILITY_MS, Step::Tick, vec![met("r")]),
                (
                    100 + STABILITY_MS + 1,
                    observe("example", example(COMPLETE, Some(2), None)),
                    vec![not_met("r")],
                ),
            ],
        },
        Case {
            name: "a_relapse_during_the_wait_restarts_it",
            policy: policy(
                &["example"],
                &[rule("r", "example", "enforce", "both", &one)],
            ),
            steps: vec![
                (
                    0,
                    open(&[("example", example(COMPLETE, Some(2), None))]),
                    vec![not_met("r")],
                ),
                (
                    100,
                    observe("example", example(COMPLETE, Some(1), None)),
                    vec![not_met("r")],
                ),
                (
                    500,
                    observe("example", example(COMPLETE, Some(2), None)),
                    vec![not_met("r")],
                ),
                (
                    600,
                    observe("example", example(COMPLETE, Some(1), None)),
                    vec![not_met("r")],
                ),
                (100 + STABILITY_MS, Step::Tick, vec![not_met("r")]),
                (600 + STABILITY_MS, Step::Tick, vec![met("r")]),
            ],
        },
        Case {
            name: "a_gap_is_unknown_until_a_fresh_state_then_recovery_waits",
            policy: policy(
                &["example"],
                &[rule("r", "example", "enforce", "both", &one)],
            ),
            steps: vec![
                (
                    0,
                    open(&[("example", example(COMPLETE, Some(1), None))]),
                    vec![met("r")],
                ),
                (
                    10,
                    Step::EventsLost("example".to_owned(), 3),
                    vec![unknown("r", UnknownCause::Gap)],
                ),
                (
                    20,
                    observe("example", example(COMPLETE, Some(1), None)),
                    vec![unknown("r", UnknownCause::Gap)],
                ),
                (20 + STABILITY_MS, Step::Tick, vec![met("r")]),
            ],
        },
        Case {
            name: "an_interruption_makes_every_rule_unknown_gap",
            policy: policy(
                &["example"],
                &[rule("r", "example", "enforce", "both", &one)],
            ),
            steps: vec![
                (
                    0,
                    open(&[("example", example(COMPLETE, Some(1), None))]),
                    vec![met("r")],
                ),
                (10, Step::Interrupted, vec![unknown("r", UnknownCause::Gap)]),
            ],
        },
        Case {
            name: "app_conditions_report_no_match_first_then_the_envelope_then_checking",
            policy: policy(
                &["apps"],
                &[
                    rule(
                        "blocked",
                        "apps",
                        "enforce",
                        "both",
                        &json!({ "AppsAbsent": { "catalog_app_ids": ["teamviewer"] } }),
                    ),
                    rule(
                        "allowed",
                        "apps",
                        "enforce",
                        "both",
                        &json!({ "AppsOnly": { "catalog_app_ids": ["editor"] } }),
                    ),
                ],
            ),
            steps: vec![
                (
                    0,
                    open(&[(
                        "apps",
                        apps(
                            envelope(Health::Failed, Permission::Denied, Certainty::Partial),
                            2,
                            &[("allowed", false)],
                        ),
                    )]),
                    vec![
                        unknown("blocked", UnknownCause::Unavailable),
                        unknown("allowed", UnknownCause::Unhealthy),
                    ],
                ),
                (
                    10,
                    observe(
                        "apps",
                        apps(
                            envelope(Health::Degraded, Permission::Granted, Certainty::Partial),
                            2,
                            &[("blocked", false), ("allowed", false)],
                        ),
                    ),
                    vec![
                        unknown("blocked", UnknownCause::Partial),
                        unknown("allowed", UnknownCause::Partial),
                    ],
                ),
                (
                    20,
                    observe(
                        "apps",
                        apps(COMPLETE, 2, &[("blocked", false), ("allowed", false)]),
                    ),
                    vec![
                        unknown("blocked", UnknownCause::Checking),
                        unknown("allowed", UnknownCause::Checking),
                    ],
                ),
                (
                    30,
                    observe(
                        "apps",
                        apps(COMPLETE, 0, &[("blocked", true), ("allowed", false)]),
                    ),
                    vec![
                        not_met("blocked"),
                        unknown("allowed", UnknownCause::Checking),
                    ],
                ),
                (
                    30 + STABILITY_MS,
                    Step::Tick,
                    vec![not_met("blocked"), met("allowed")],
                ),
            ],
        },
        Case {
            name: "phases_select_which_rules_are_evaluated",
            policy: policy(
                &["example"],
                &[
                    rule("ready_only", "example", "enforce", "readiness", &one),
                    rule("exam_only", "example", "observe", "participation", &one),
                ],
            ),
            steps: vec![
                (
                    0,
                    open(&[("example", example(COMPLETE, Some(1), None))]),
                    vec![met("ready_only")],
                ),
                (10, Step::Begin, vec![met("ready_only")]),
                (20, Step::Confirm, vec![met("exam_only")]),
            ],
        },
    ]
}

/// Policies the evaluator must refuse before any capability starts.
#[must_use]
pub fn refusals() -> Vec<Refusal> {
    let one = compare("example.count", "eq", &json!(1));
    let deep = json!({ "Not": { "condition": { "Not": { "condition": { "Not": { "condition": one } } } } } });
    vec![
        Refusal {
            name: "depth_four_is_refused",
            policy: policy(
                &["example"],
                &[rule("r", "example", "enforce", "both", &deep)],
            ),
        },
        Refusal {
            name: "an_envelope_field_is_not_a_rule_field",
            policy: policy(
                &["example"],
                &[rule(
                    "r",
                    "example",
                    "enforce",
                    "both",
                    &compare("example.certainty", "eq", &json!("complete")),
                )],
            ),
        },
        Refusal {
            name: "two_app_conditions_in_one_rule_are_refused",
            policy: policy(
                &["apps"],
                &[rule(
                    "r",
                    "apps",
                    "enforce",
                    "both",
                    &json!({ "All": { "conditions": [
                        { "AppsAbsent": { "catalog_app_ids": ["a"] } },
                        { "AppsOnly": { "catalog_app_ids": ["b"] } }
                    ] } }),
                )],
            ),
        },
        Refusal {
            name: "an_app_condition_on_a_capability_without_them_is_refused",
            policy: policy(
                &["example"],
                &[rule(
                    "r",
                    "example",
                    "enforce",
                    "both",
                    &json!({ "AppsAbsent": { "catalog_app_ids": ["a"] } }),
                )],
            ),
        },
        Refusal {
            name: "a_value_outside_the_field_type_is_refused",
            policy: policy(
                &["example"],
                &[rule(
                    "r",
                    "example",
                    "enforce",
                    "both",
                    &compare("example.mode", "eq", &json!("sideways")),
                )],
            ),
        },
        Refusal {
            name: "an_ordering_comparison_on_a_symbol_is_refused",
            policy: policy(
                &["example"],
                &[rule(
                    "r",
                    "example",
                    "enforce",
                    "both",
                    &compare("example.mode", "lt", &json!("on")),
                )],
            ),
        },
        Refusal {
            name: "a_rule_on_a_capability_that_is_not_activated_is_refused",
            policy: policy(&["apps"], &[rule("r", "example", "enforce", "both", &one)]),
        },
        Refusal {
            name: "an_empty_group_is_refused",
            policy: policy(
                &["example"],
                &[rule(
                    "r",
                    "example",
                    "enforce",
                    "both",
                    &json!({ "All": { "conditions": [] } }),
                )],
            ),
        },
    ]
}

/// The statuses after each step, as `(rule_id, status, cause)`, from running `case` through the
/// engine. Rules not listed in a step's expectations are not compared.
///
/// # Panics
/// Panics when the case itself is malformed (an invalid policy, or an unknown capability).
#[must_use]
pub fn run(case: &Case) -> Vec<BTreeMap<String, (Status, Option<UnknownCause>)>> {
    let mut engine = Engine::new(example_registry());
    let policy: Policy = serde_json::from_value(case.policy.clone()).expect("vector policy parses");
    let mut results = Vec::new();
    let mut pending_policy = Some(policy);
    let mut instance = 0_u32;
    let mut current = BTreeMap::new();
    for (at_ms, step, _) in &case.steps {
        match step {
            Step::Open(states) => {
                let initial = states
                    .iter()
                    .map(|(capability, state)| {
                        instance += 1;
                        InitialState {
                            capability: id(capability),
                            source_instance_id: OpaqueId::new(format!("instance{instance:04}"))
                                .expect("valid id"),
                            observation: state.observation(),
                        }
                    })
                    .collect();
                let (_, statuses) = engine
                    .open_readiness(
                        pending_policy.take().expect("one open per case"),
                        initial,
                        *at_ms,
                    )
                    .expect("vector opens");
                for status in statuses {
                    current.insert(
                        status.rule_id.to_string(),
                        (status.status, status.unknown_cause),
                    );
                }
            }
            Step::Begin => {
                let (_, statuses) = engine.begin_participation().expect("vector begins");
                current = statuses
                    .into_iter()
                    .map(|status| {
                        (
                            status.rule_id.to_string(),
                            (status.status, status.unknown_cause),
                        )
                    })
                    .collect();
            }
            Step::Confirm => {
                let statuses = engine
                    .confirm_participation(*at_ms)
                    .expect("vector confirms");
                current = statuses
                    .into_iter()
                    .map(|status| {
                        (
                            status.rule_id.to_string(),
                            (status.status, status.unknown_cause),
                        )
                    })
                    .collect();
            }
            other => {
                let input = match other {
                    Step::Observe(capability, state) => Input::Observed {
                        capability: id(capability),
                        observation: state.observation(),
                        at_ms: *at_ms,
                    },
                    Step::EventsLost(capability, count) => Input::EventsLost {
                        capability: id(capability),
                        count: *count,
                        at_ms: *at_ms,
                    },
                    Step::Interrupted => Input::Interrupted {
                        kind: prctr_protocol::facts::InterruptionKind::Sleep,
                        at_ms: *at_ms,
                    },
                    _ => Input::Tick { at_ms: *at_ms },
                };
                engine.handle(input).expect("vector input applies");
                for status in engine.statuses() {
                    current.insert(
                        status.rule_id.to_string(),
                        (status.status, status.unknown_cause),
                    );
                }
            }
        }
        results.push(current.clone());
    }
    results
}

/// The published vectors: the example registry, every case with its expectations, and the
/// policies that must be refused.
#[must_use]
pub fn rule_vectors_json() -> Value {
    let step_json = |step: &Step| match step {
        Step::Open(states) => {
            json!({ "open": states.iter().map(|(capability, state)| (capability.clone(), state.json())).collect::<serde_json::Map<_, _>>() })
        }
        Step::Observe(capability, state) => {
            json!({ "observe": { "capability": capability, "state": state.json() } })
        }
        Step::EventsLost(capability, count) => {
            json!({ "events_lost": { "capability": capability, "count": count } })
        }
        Step::Interrupted => json!({ "interrupted": {} }),
        Step::Tick => json!({ "tick": {} }),
        Step::Begin => json!({ "begin_participation": {} }),
        Step::Confirm => json!({ "confirm_participation": {} }),
    };
    let cases: Vec<Value> = cases()
        .iter()
        .map(|case| {
            json!({
                "name": case.name,
                "policy": case.policy,
                "steps": case.steps.iter().map(|(at_ms, step, expect)| json!({
                    "at_ms": at_ms,
                    "input": step_json(step),
                    "expect": expect.iter().map(|expect| {
                        let mut value = json!({ "rule_id": expect.rule_id, "status": expect.status });
                        if let Some(cause) = expect.unknown_cause {
                            value["unknown_cause"] = json!(cause);
                        }
                        value
                    }).collect::<Vec<_>>(),
                })).collect::<Vec<_>>(),
            })
        })
        .collect();
    json!({
        "description": "Proctor native rule conformance vectors. Each case opens readiness with the given states and applies the inputs in order; after each step the listed rules must have exactly the given status and unknown cause. Every refusal policy must be refused.",
        "registry": example_registry(),
        "cases": cases,
        "refusals": refusals().iter().map(|refusal| json!({ "name": refusal.name, "policy": refusal.policy })).collect::<Vec<_>>(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::policy::ValidPolicy;

    #[test]
    fn every_case_produces_its_expected_statuses() {
        for case in cases() {
            let results = run(&case);
            for (index, (_, _, expectations)) in case.steps.iter().enumerate() {
                for expect in expectations {
                    assert_eq!(
                        results[index].get(expect.rule_id),
                        Some(&(expect.status, expect.unknown_cause)),
                        "case {} step {index} rule {}",
                        case.name,
                        expect.rule_id
                    );
                }
            }
        }
    }

    #[test]
    fn every_refusal_policy_is_refused() {
        let registry = example_registry();
        for refusal in refusals() {
            let parsed: Result<Policy, _> = serde_json::from_value(refusal.policy.clone());
            let refused =
                parsed.map_or(true, |policy| ValidPolicy::new(policy, &registry).is_err());
            assert!(refused, "{} was accepted", refusal.name);
        }
    }

    #[test]
    fn every_case_policy_is_valid() {
        let registry = example_registry();
        for case in cases() {
            let policy: Policy = serde_json::from_value(case.policy.clone()).expect("parses");
            assert!(ValidPolicy::new(policy, &registry).is_ok(), "{}", case.name);
        }
    }
}
