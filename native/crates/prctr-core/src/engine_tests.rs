use std::collections::BTreeMap;

use serde_json::json;

use prctr_protocol::facts::{Certainty, Envelope, Health, InterruptionKind, Permission};
use prctr_protocol::messages::Notification;
use prctr_protocol::rules::{LocalEffect, Policy, Status};
use prctr_protocol::scalars::{Identifier, OpaqueId};

use super::{CoreError, Engine, InitialState, Input};
use crate::observation::Observation;
use crate::vectors::{STABILITY_MS, VectorState, example_registry};

const COMPLETE: Envelope = Envelope {
    permission: Permission::Granted,
    health: Health::Healthy,
    certainty: Certainty::Complete,
};

fn id(text: &str) -> Identifier {
    Identifier::new(text).expect("valid identifier")
}

fn state(envelope: Envelope, count: u64) -> Observation {
    VectorState {
        envelope,
        fields: BTreeMap::from([("example.count".to_owned(), json!(count))]),
        apps: None,
    }
    .observation()
}

fn single_display_policy(mode: &str) -> Policy {
    serde_json::from_value(json!({
        "activations": [{ "capability": "example", "categories": [] }],
        "rules": [{
            "rule_id": "one",
            "capability": "example",
            "mode": mode,
            "phase": "both",
            "reason": "example.reason",
            "requirement": { "Compare": { "field": "example.count", "op": "eq", "value": 1 } }
        }]
    }))
    .expect("policy parses")
}

fn opened(mode: &str, count: u64) -> Engine {
    let mut engine = Engine::new(example_registry());
    engine
        .open_readiness(
            single_display_policy(mode),
            vec![InitialState {
                capability: id("example"),
                source_instance_id: OpaqueId::new("instance0001").expect("valid"),
                observation: state(COMPLETE, count),
            }],
            0,
        )
        .expect("opens");
    engine
}

fn observe(engine: &mut Engine, count: u64, at_ms: u64) -> Vec<super::Numbered> {
    engine
        .handle(Input::Observed {
            capability: id("example"),
            observation: state(COMPLETE, count),
            at_ms,
        })
        .expect("applies")
}

fn rule_effects(messages: &[super::Numbered]) -> Vec<(Status, LocalEffect)> {
    messages
        .iter()
        .filter_map(|message| match &message.notification {
            Notification::Rules { statuses } => Some(
                statuses
                    .iter()
                    .map(|status| (status.status, status.local_effect)),
            ),
            _ => None,
        })
        .flatten()
        .collect()
}

#[test]
fn containment_starts_only_in_participation_and_is_reported_on_the_flip() {
    let mut engine = opened("enforce", 1);
    let readiness = observe(&mut engine, 2, 10);
    assert_eq!(
        rule_effects(&readiness),
        vec![(Status::NotMet, LocalEffect::None)],
        "readiness never contains"
    );
    observe(&mut engine, 1, 20);
    engine
        .handle(Input::Tick {
            at_ms: 20 + STABILITY_MS,
        })
        .expect("ticks");
    engine.begin_participation().expect("begins");
    engine.confirm_participation(1_100).expect("confirms");
    assert!(!engine.contained());
    let violated = observe(&mut engine, 2, 1_200);
    assert_eq!(
        rule_effects(&violated),
        vec![(Status::NotMet, LocalEffect::Contained)]
    );
    assert!(engine.contained());
    observe(&mut engine, 1, 1_300);
    let released = engine
        .handle(Input::Tick {
            at_ms: 1_300 + STABILITY_MS,
        })
        .expect("ticks");
    assert_eq!(
        rule_effects(&released),
        vec![(Status::Met, LocalEffect::Released)]
    );
    assert!(!engine.contained());
}

#[test]
fn an_observe_rule_never_contains() {
    let mut engine = opened("observe", 1);
    engine.begin_participation().expect("begins");
    engine.confirm_participation(10).expect("confirms");
    let violated = observe(&mut engine, 2, 20);
    assert_eq!(
        rule_effects(&violated),
        vec![(Status::NotMet, LocalEffect::None)]
    );
    assert!(!engine.contained());
}

#[test]
fn participation_requests_out_of_order_are_refused() {
    let mut engine = opened("enforce", 1);
    assert_eq!(engine.confirm_participation(0), Err(CoreError::WrongPhase));
    assert_eq!(engine.abandon_participation(), Err(CoreError::WrongPhase));
    engine.begin_participation().expect("begins");
    assert_eq!(engine.begin_participation(), Err(CoreError::WrongPhase));
    engine
        .abandon_participation()
        .expect("abandons back to readiness");
    engine.begin_participation().expect("begins again");
}

#[test]
fn a_second_session_and_unknown_capabilities_are_refused() {
    let mut engine = opened("enforce", 1);
    assert_eq!(
        engine.open_readiness(single_display_policy("enforce"), Vec::new(), 0),
        Err(CoreError::WrongPhase)
    );
    let unknown = engine.handle(Input::EventsLost {
        capability: id("apps"),
        count: 1,
        at_ms: 1,
    });
    assert_eq!(unknown, Err(CoreError::UnknownCapability(id("apps"))));
}

#[test]
fn initial_states_must_match_the_activations_exactly() {
    let mut engine = Engine::new(example_registry());
    assert_eq!(
        engine.open_readiness(single_display_policy("enforce"), Vec::new(), 0),
        Err(CoreError::InitialStatesMismatch)
    );
    assert!(!engine.is_open());
}

#[test]
fn closing_returns_final_states_and_allows_a_new_session() {
    let mut engine = opened("enforce", 1);
    let (facts, statuses) = engine.close().expect("closes");
    assert_eq!(facts.len(), 1);
    assert_eq!(statuses.len(), 1);
    assert!(!engine.is_open());
    assert!(engine.close().is_err());
}

#[test]
fn the_next_deadline_is_the_end_of_the_recovery_wait() {
    let mut engine = opened("enforce", 2);
    assert_eq!(engine.next_deadline(), None);
    observe(&mut engine, 1, 100);
    assert_eq!(engine.next_deadline(), Some(100 + STABILITY_MS));
}

#[derive(Clone, Debug)]
enum Action {
    Observe { count: u64, partial: bool },
    Lose(u64),
    Interrupt,
    Tick,
    Acknowledge,
}

/// A small deterministic generator (xorshift64*), so every sequence is reproducible from its seed.
struct Sequence(u64);

impl Sequence {
    fn next(&mut self, below: u64) -> u64 {
        self.0 ^= self.0 >> 12;
        self.0 ^= self.0 << 25;
        self.0 ^= self.0 >> 27;
        self.0.wrapping_mul(0x2545_F491_4F6C_DD1D) % below
    }

    fn action(&mut self) -> Action {
        match self.next(9) {
            0..=3 => Action::Observe {
                count: self.next(4),
                partial: self.next(2) == 1,
            },
            4 => Action::Lose(1 + self.next(4)),
            5 => Action::Interrupt,
            6 | 7 => Action::Tick,
            _ => Action::Acknowledge,
        }
    }
}

#[test]
fn sequences_increase_gaps_are_exact_and_partial_facts_never_meet_a_rule() {
    for seed in 1..=500_u64 {
        let mut generator = Sequence(seed.wrapping_mul(0x9E37_79B9_7F4A_7C15) | 1);
        let length = 1 + generator.next(300);
        let actions: Vec<Action> = (0..length).map(|_| generator.action()).collect();
        assert_invariants(seed, actions);
    }
}

fn assert_invariants(seed: u64, actions: Vec<Action>) {
    {
        let mut engine = opened("enforce", 1);
        let mut last_sequence = 0_u64;
        let mut last_message = 0_u64;
        let mut partial = false;
        for (step, action) in actions.into_iter().enumerate() {
            let at_ms = (u64::try_from(step).unwrap_or(0) + 1) * 300;
            let input = match action {
                Action::Observe {
                    count,
                    partial: is_partial,
                } => {
                    partial = is_partial;
                    let envelope = if is_partial {
                        Envelope {
                            certainty: Certainty::Partial,
                            health: Health::Degraded,
                            ..COMPLETE
                        }
                    } else {
                        COMPLETE
                    };
                    Input::Observed {
                        capability: id("example"),
                        observation: state(envelope, count),
                        at_ms,
                    }
                }
                Action::Lose(count) => Input::EventsLost {
                    capability: id("example"),
                    count,
                    at_ms,
                },
                Action::Interrupt => Input::Interrupted {
                    kind: InterruptionKind::Sleep,
                    at_ms,
                },
                Action::Tick => Input::Tick { at_ms },
                Action::Acknowledge => Input::Acknowledged {
                    up_to: last_message,
                },
            };
            for message in engine.handle(input).expect("applies") {
                assert!(
                    message.message_number.get() > last_message,
                    "seed {seed}: message numbers increase"
                );
                last_message = message.message_number.get();
                match message.notification {
                    Notification::Fact { fact } => {
                        assert!(
                            fact.sequence.get() > last_sequence,
                            "seed {seed}: fact sequences increase"
                        );
                        last_sequence = fact.sequence.get();
                    }
                    Notification::Gap { gap } => {
                        assert_eq!(
                            gap.first_sequence.get(),
                            last_sequence + 1,
                            "seed {seed}: a gap starts right after the last fact"
                        );
                        assert!(gap.last_sequence >= gap.first_sequence, "seed {seed}");
                        last_sequence = gap.last_sequence.get();
                    }
                    _ => {}
                }
            }
            if partial {
                for status in engine.statuses() {
                    assert_ne!(
                        status.status,
                        Status::Met,
                        "seed {seed}: a partial state never meets a rule"
                    );
                }
            }
        }
    }
}
