//! The generic conformance suite. Every capability runs it through its fake, so the lifecycle
//! guarantees hold for all of them without each capability re-testing them.

use prctr_protocol::facts::{GapReason, InterruptionKind};
use prctr_protocol::messages::Notification;
use prctr_protocol::rules::{Activation, Policy};
use prctr_protocol::scalars::{Count, Identifier, OpaqueId};

use crate::engine::{Engine, InitialState, Input, MAX_UNACKNOWLEDGED, Numbered};
use crate::observation::Observation;
use crate::registry::{CapabilityDescriptor, Registry};

fn instance(number: u32) -> OpaqueId {
    OpaqueId::new(format!("conformance{number:04}")).expect("valid instance id")
}

fn open(descriptor: &CapabilityDescriptor, first: &Observation) -> Engine {
    let registry = Registry {
        capabilities: vec![descriptor.clone()],
        baseline_rules: Vec::new(),
    };
    let mut engine = Engine::new(registry);
    let policy = Policy {
        activations: vec![Activation {
            capability: descriptor.id.clone(),
            categories: descriptor.categories.clone(),
        }],
        rules: Vec::new(),
    };
    let (facts, _) = engine
        .open_readiness(
            policy,
            vec![InitialState {
                capability: descriptor.id.clone(),
                source_instance_id: instance(1),
                observation: first.clone(),
            }],
            0,
        )
        .expect("a conformance session opens");
    assert_eq!(facts.len(), 1, "activation returns one complete state");
    assert_eq!(
        facts[0].sequence,
        Count::ZERO,
        "activation starts at sequence 0"
    );
    engine
}

fn facts(numbered: &[Numbered]) -> Vec<&prctr_protocol::facts::Fact> {
    numbered
        .iter()
        .filter_map(|message| match &message.notification {
            Notification::Fact { fact } => Some(fact),
            _ => None,
        })
        .collect()
}

/// Asserts the lifecycle guarantees for one capability, given two different valid states of it
/// (as its fake would produce them).
///
/// # Panics
/// Panics with a description of the first guarantee that does not hold.
pub fn assert_capability_conformance(
    descriptor: &CapabilityDescriptor,
    first: &Observation,
    second: &Observation,
) {
    assert!(
        !first.same_state(second),
        "conformance needs two different states"
    );
    let capability = descriptor.id.clone();
    let observed = |observation: &Observation, at_ms| Input::Observed {
        capability: capability.clone(),
        observation: observation.clone(),
        at_ms,
    };

    // An identical state produces no fact; a different one produces the next sequence.
    let mut engine = open(descriptor, first);
    let same = engine.handle(observed(first, 1)).expect("applies");
    assert!(
        facts(&same).is_empty(),
        "an identical state produces no fact"
    );
    let changed = engine.handle(observed(second, 2)).expect("applies");
    let changed = facts(&changed);
    assert_eq!(changed.len(), 1, "a different state produces one fact");
    assert_eq!(
        changed[0].sequence.get(),
        1,
        "the next fact has the next sequence"
    );
    assert_eq!(
        changed[0].state, second.state,
        "the fact carries the complete new state"
    );

    // Lost events produce an exact gap, and the next state is delivered even if identical.
    let lost = engine
        .handle(Input::EventsLost {
            capability: capability.clone(),
            count: 3,
            at_ms: 3,
        })
        .expect("applies");
    let gap = lost
        .iter()
        .find_map(|message| match &message.notification {
            Notification::Gap { gap } => Some(gap.clone()),
            _ => None,
        })
        .expect("lost events produce a gap");
    assert_eq!(
        (gap.first_sequence.get(), gap.last_sequence.get()),
        (2, 4),
        "the gap names the exact missing range"
    );
    assert_eq!(gap.reason, GapReason::SourceLoss);
    let fresh = engine.handle(observed(second, 4)).expect("applies");
    assert_eq!(
        facts(&fresh).len(),
        1,
        "after a gap, a fresh state is delivered even when unchanged"
    );
    assert_eq!(facts(&fresh)[0].sequence.get(), 5);

    // A restart produces a reset naming the old instance, then sequence 0 of the new one.
    let restarted = engine
        .handle(Input::Restarted {
            capability: capability.clone(),
            source_instance_id: instance(2),
            observation: first.clone(),
            at_ms: 5,
        })
        .expect("applies");
    let reset = restarted
        .iter()
        .find_map(|message| match &message.notification {
            Notification::Reset { reset } => Some(reset.clone()),
            _ => None,
        })
        .expect("a restart produces a reset");
    assert_eq!(reset.previous_source_instance_id, instance(1));
    assert_eq!(reset.previous_sequence.get(), 5);
    assert_eq!(reset.source_instance_id, instance(2));
    let after = facts(&restarted);
    assert_eq!(after.len(), 1);
    assert_eq!(
        (after[0].sequence, &after[0].source_instance_id),
        (Count::ZERO, &instance(2))
    );

    // An interruption forces a fresh state before Start is allowed.
    engine
        .handle(Input::Interrupted {
            kind: InterruptionKind::ScreenLock,
            at_ms: 6,
        })
        .expect("applies");
    assert!(
        engine.begin_participation().is_err(),
        "Start is refused until a fresh state arrives"
    );
    engine.handle(observed(first, 7)).expect("applies");
    assert!(
        engine.begin_participation().is_ok(),
        "Start succeeds after a fresh state"
    );

    assert_flow_control(descriptor, first, second);
}

/// Over the acknowledgement limit, facts are withheld; once acknowledged, the newest state is sent
/// with a flow-control gap for the states in between.
fn assert_flow_control(
    descriptor: &CapabilityDescriptor,
    first: &Observation,
    second: &Observation,
) {
    let capability: Identifier = descriptor.id.clone();
    let mut engine = open(descriptor, first);
    let mut last_number = 0;
    let mut sent = 0;
    let states = [second, first];
    for step in 0..(MAX_UNACKNOWLEDGED + 3) {
        let observation = states[usize::try_from(step % 2).unwrap_or(0)];
        let out = engine
            .handle(Input::Observed {
                capability: capability.clone(),
                observation: observation.clone(),
                at_ms: step + 1,
            })
            .expect("applies");
        sent += facts(&out).len();
        if let Some(message) = out.last() {
            last_number = message.message_number.get();
        }
    }
    let sent = u64::try_from(sent).unwrap_or(u64::MAX);
    assert_eq!(
        sent, MAX_UNACKNOWLEDGED,
        "facts stop at the acknowledgement limit"
    );
    let released = engine
        .handle(Input::Acknowledged { up_to: last_number })
        .expect("applies");
    let gap = released
        .iter()
        .find_map(|message| match &message.notification {
            Notification::Gap { gap } => Some(gap.clone()),
            _ => None,
        });
    let gap = gap.expect("withheld states are reported as a flow-control gap");
    assert_eq!(gap.reason, GapReason::FlowControl);
    let newest = facts(&released);
    assert_eq!(
        newest.len(),
        1,
        "only the newest state is sent after the gap"
    );
    assert_eq!(
        newest[0].sequence.get(),
        gap.last_sequence.get() + 1,
        "the newest state follows the gap"
    );
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::vectors::{VectorState, example_registry};
    use prctr_protocol::facts::{Certainty, Envelope, Health, Permission};
    use serde_json::json;
    use std::collections::BTreeMap;

    fn example_state(count: u64) -> Observation {
        VectorState {
            envelope: Envelope {
                permission: Permission::Granted,
                health: Health::Healthy,
                certainty: Certainty::Complete,
            },
            fields: BTreeMap::from([("example.count".to_owned(), json!(count))]),
            apps: None,
        }
        .observation()
    }

    #[test]
    fn the_example_capability_passes_the_conformance_suite() {
        let registry = example_registry();
        assert_capability_conformance(
            &registry.capabilities[0],
            &example_state(1),
            &example_state(2),
        );
    }
}
