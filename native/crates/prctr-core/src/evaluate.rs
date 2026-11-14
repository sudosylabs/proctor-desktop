//! Three-valued evaluation of one condition against one capability's latest state.
//! Semantics, including the order of unknown causes: `docs/architecture/native-rules.md`.

use prctr_protocol::facts::{Certainty, Permission};
use prctr_protocol::rules::{
    Compare, CompareOp, Condition, RuleValue, Scalar, Status, UnknownCause,
};
use prctr_protocol::scalars::Identifier;

use crate::observation::{FieldValue, Observation};

/// The result of evaluating a condition.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Outcome {
    Met,
    NotMet,
    Unknown(UnknownCause),
}

impl Outcome {
    #[must_use]
    pub const fn status(self) -> Status {
        match self {
            Self::Met => Status::Met,
            Self::NotMet => Status::NotMet,
            Self::Unknown(_) => Status::Unknown,
        }
    }

    #[must_use]
    pub const fn unknown_cause(self) -> Option<UnknownCause> {
        match self {
            Self::Unknown(cause) => Some(cause),
            Self::Met | Self::NotMet => None,
        }
    }

    const fn negate(self) -> Self {
        match self {
            Self::Met => Self::NotMet,
            Self::NotMet => Self::Met,
            Self::Unknown(cause) => Self::Unknown(cause),
        }
    }
}

/// What a rule can see of its capability.
#[derive(Clone, Copy, Debug)]
pub struct View<'a> {
    /// The latest complete state.
    pub observation: &'a Observation,
    /// Events were lost and no fresh complete state has arrived since.
    pub gap: bool,
}

/// Evaluates `condition` for the rule `rule_id`.
#[must_use]
pub fn evaluate(condition: &Condition, rule_id: &Identifier, view: View<'_>) -> Outcome {
    match condition {
        Condition::Compare(compare) => evaluate_compare(compare, view),
        Condition::All { conditions } => combine(conditions, rule_id, view, Outcome::NotMet),
        Condition::Any { conditions } => combine(conditions, rule_id, view, Outcome::Met),
        Condition::Not { condition } => evaluate(condition, rule_id, view).negate(),
        Condition::AppsAbsent { .. } | Condition::AppsOnly { .. } => evaluate_apps(rule_id, view),
    }
}

/// `All` (decisive = not met) and `Any` (decisive = met): a decisive operand wins; otherwise the
/// first unknown operand's cause; otherwise the non-decisive outcome.
fn combine(
    conditions: &[Condition],
    rule_id: &Identifier,
    view: View<'_>,
    decisive: Outcome,
) -> Outcome {
    let mut first_unknown = None;
    for condition in conditions {
        let outcome = evaluate(condition, rule_id, view);
        if outcome == decisive {
            return decisive;
        }
        if first_unknown.is_none() && matches!(outcome, Outcome::Unknown(_)) {
            first_unknown = Some(outcome);
        }
    }
    first_unknown.unwrap_or_else(|| decisive.negate())
}

/// The envelope check shared by every leaf, after the leaf's own availability check.
fn envelope_cause(observation: &Observation, gap: bool) -> Option<UnknownCause> {
    let envelope = observation.envelope;
    if gap {
        Some(UnknownCause::Gap)
    } else if !envelope.health.is_running() {
        Some(UnknownCause::Unhealthy)
    } else if envelope.permission != Permission::Granted {
        Some(UnknownCause::Permission)
    } else if envelope.certainty != Certainty::Complete {
        Some(UnknownCause::Partial)
    } else {
        None
    }
}

fn evaluate_compare(compare: &Compare, view: View<'_>) -> Outcome {
    let observation = view.observation;
    let Some(actual) = observation.fields.get(&compare.field) else {
        return Outcome::Unknown(UnknownCause::Unavailable);
    };
    if let Some(cause) = envelope_cause(observation, view.gap) {
        return Outcome::Unknown(cause);
    }
    match holds(actual, compare.op, &compare.value) {
        Some(true) => Outcome::Met,
        Some(false) => Outcome::NotMet,
        None => Outcome::Unknown(UnknownCause::Unavailable),
    }
}

fn evaluate_apps(rule_id: &Identifier, view: View<'_>) -> Outcome {
    let observation = view.observation;
    let Some(apps) = &observation.apps else {
        return Outcome::Unknown(UnknownCause::Unavailable);
    };
    let Some(violated) = apps.violated.get(rule_id) else {
        return Outcome::Unknown(UnknownCause::Unavailable);
    };
    if let Some(cause) = envelope_cause(observation, view.gap) {
        return Outcome::Unknown(cause);
    }
    if apps.checking > 0 {
        return Outcome::Unknown(UnknownCause::Checking);
    }
    if *violated {
        Outcome::NotMet
    } else {
        Outcome::Met
    }
}

/// `None` when the value's type does not match the field's (refused by validation, so only a
/// defensive case).
fn holds(actual: &FieldValue, op: CompareOp, expected: &RuleValue) -> Option<bool> {
    match (op, expected) {
        (CompareOp::In, RuleValue::Set(set)) => {
            Some(set.iter().any(|scalar| same(actual, scalar) == Some(true)))
        }
        (CompareOp::NotIn, RuleValue::Set(set)) => {
            Some(set.iter().all(|scalar| same(actual, scalar) == Some(false)))
        }
        (CompareOp::Eq, RuleValue::One(scalar)) => same(actual, scalar),
        (CompareOp::Ne, RuleValue::One(scalar)) => same(actual, scalar).map(|equal| !equal),
        (
            CompareOp::Lt | CompareOp::Le | CompareOp::Gt | CompareOp::Ge,
            RuleValue::One(Scalar::Number(limit)),
        ) => {
            let FieldValue::Number(value) = actual else {
                return None;
            };
            let limit = limit.get();
            Some(match op {
                CompareOp::Lt => *value < limit,
                CompareOp::Le => *value <= limit,
                CompareOp::Gt => *value > limit,
                _ => *value >= limit,
            })
        }
        _ => None,
    }
}

fn same(actual: &FieldValue, scalar: &Scalar) -> Option<bool> {
    match (actual, scalar) {
        (FieldValue::Number(value), Scalar::Number(number)) => Some(*value == number.get()),
        (FieldValue::Symbol(value), Scalar::Symbol(symbol)) => Some(value == symbol),
        _ => None,
    }
}
