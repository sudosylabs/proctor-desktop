//! Policy validation against the registry. A policy that passes can only reference registered
//! capabilities, fields, values and reasons, within the bounds in `native-rules.md`.

use std::collections::BTreeSet;
use std::fmt;

use prctr_protocol::rules::{
    Activation, CompareOp, Condition, MAX_ACTIVATIONS, MAX_CATALOG_APP_IDS, MAX_CATEGORIES,
    MAX_COMPARISONS_PER_RULE, MAX_DEPTH, MAX_RULES, Policy, Rule, RuleValue, Scalar,
};
use prctr_protocol::scalars::Identifier;

use crate::registry::{CapabilityDescriptor, FieldKind, Registry};

/// Why a policy was refused. The first problem found is reported.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum PolicyError {
    TooManyActivations,
    DuplicateActivation(Identifier),
    UnknownCapability(Identifier),
    InvalidCategories(Identifier),
    TooManyRules,
    DuplicateRule(Identifier),
    CapabilityNotActivated(Identifier),
    UnknownReason(Identifier),
    UnknownField(Identifier),
    InvalidComparison(Identifier),
    EmptyGroup(Identifier),
    TooDeep(Identifier),
    TooManyComparisons(Identifier),
    InvalidAppCondition(Identifier),
    MissingBaselineRule(Identifier),
}

impl fmt::Display for PolicyError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(formatter, "{self:?}")
    }
}

impl std::error::Error for PolicyError {}

/// A policy that passed validation.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ValidPolicy {
    activations: Vec<Activation>,
    rules: Vec<Rule>,
}

impl ValidPolicy {
    /// # Errors
    /// Returns the first problem found, in a fixed order: activations, then rules in order.
    pub fn new(policy: Policy, registry: &Registry) -> Result<Self, PolicyError> {
        check_activations(&policy.activations, registry)?;
        check_rules(&policy, registry)?;
        for baseline in &registry.baseline_rules {
            if !policy.rules.contains(baseline) {
                return Err(PolicyError::MissingBaselineRule(baseline.rule_id.clone()));
            }
        }
        Ok(Self {
            activations: policy.activations,
            rules: policy.rules,
        })
    }

    #[must_use]
    pub fn activations(&self) -> &[Activation] {
        &self.activations
    }

    #[must_use]
    pub fn rules(&self) -> &[Rule] {
        &self.rules
    }
}

fn check_activations(activations: &[Activation], registry: &Registry) -> Result<(), PolicyError> {
    if activations.len() > MAX_ACTIVATIONS {
        return Err(PolicyError::TooManyActivations);
    }
    let mut seen = BTreeSet::new();
    for activation in activations {
        if !seen.insert(&activation.capability) {
            return Err(PolicyError::DuplicateActivation(
                activation.capability.clone(),
            ));
        }
        let descriptor = registry
            .capability(&activation.capability)
            .ok_or_else(|| PolicyError::UnknownCapability(activation.capability.clone()))?;
        let unique: BTreeSet<_> = activation.categories.iter().collect();
        let valid = unique.len() == activation.categories.len()
            && activation.categories.len() <= MAX_CATEGORIES
            && activation
                .categories
                .iter()
                .all(|category| descriptor.categories.contains(category))
            && (descriptor.categories.is_empty() == activation.categories.is_empty());
        if !valid {
            return Err(PolicyError::InvalidCategories(
                activation.capability.clone(),
            ));
        }
    }
    Ok(())
}

fn check_rules(policy: &Policy, registry: &Registry) -> Result<(), PolicyError> {
    if policy.rules.len() > MAX_RULES {
        return Err(PolicyError::TooManyRules);
    }
    let mut seen = BTreeSet::new();
    for rule in &policy.rules {
        let id = &rule.rule_id;
        if !seen.insert(id) {
            return Err(PolicyError::DuplicateRule(id.clone()));
        }
        if !policy
            .activations
            .iter()
            .any(|activation| activation.capability == rule.capability)
        {
            return Err(PolicyError::CapabilityNotActivated(id.clone()));
        }
        // check_activations refused unregistered capabilities, and the rule's is activated.
        let descriptor = registry
            .capability(&rule.capability)
            .expect("an activated capability is registered");
        if !descriptor.reasons.contains(&rule.reason) {
            return Err(PolicyError::UnknownReason(id.clone()));
        }
        let mut shape = Shape::default();
        check_condition(&rule.requirement, 1, descriptor, id, &mut shape, registry)?;
        if shape.comparisons > MAX_COMPARISONS_PER_RULE {
            return Err(PolicyError::TooManyComparisons(id.clone()));
        }
        if shape.app_conditions > 1 {
            return Err(PolicyError::InvalidAppCondition(id.clone()));
        }
    }
    Ok(())
}

#[derive(Default)]
struct Shape {
    comparisons: usize,
    app_conditions: usize,
}

fn check_condition(
    condition: &Condition,
    depth: usize,
    descriptor: &CapabilityDescriptor,
    rule: &Identifier,
    shape: &mut Shape,
    registry: &Registry,
) -> Result<(), PolicyError> {
    if depth > MAX_DEPTH {
        return Err(PolicyError::TooDeep(rule.clone()));
    }
    match condition {
        Condition::Compare(compare) => {
            shape.comparisons += 1;
            let field = descriptor
                .field(&compare.field)
                .ok_or_else(|| PolicyError::UnknownField(rule.clone()))?;
            if !comparison_fits(&field.kind, compare.op, &compare.value) {
                return Err(PolicyError::InvalidComparison(rule.clone()));
            }
            Ok(())
        }
        Condition::All { conditions } | Condition::Any { conditions } => {
            if conditions.is_empty() {
                return Err(PolicyError::EmptyGroup(rule.clone()));
            }
            conditions.iter().try_for_each(|inner| {
                check_condition(inner, depth + 1, descriptor, rule, shape, registry)
            })
        }
        Condition::Not { condition } => {
            check_condition(condition, depth + 1, descriptor, rule, shape, registry)
        }
        Condition::AppsAbsent { catalog_app_ids } | Condition::AppsOnly { catalog_app_ids } => {
            shape.comparisons += 1;
            shape.app_conditions += 1;
            let unique: BTreeSet<_> = catalog_app_ids.iter().collect();
            let valid = descriptor.app_conditions
                && unique.len() == catalog_app_ids.len()
                && catalog_app_ids.len() <= MAX_CATALOG_APP_IDS
                && (matches!(condition, Condition::AppsOnly { .. }) || !catalog_app_ids.is_empty())
                && catalog_app_ids.iter().all(|app| {
                    registry.application(app).is_some_and(|application| {
                        application.allowable || matches!(condition, Condition::AppsAbsent { .. })
                    })
                });
            if valid {
                Ok(())
            } else {
                Err(PolicyError::InvalidAppCondition(rule.clone()))
            }
        }
    }
}

fn comparison_fits(kind: &FieldKind, op: CompareOp, value: &RuleValue) -> bool {
    let scalar_fits = |scalar: &Scalar| match (kind, scalar) {
        (FieldKind::Count { max }, Scalar::Number(number)) => number.get() <= *max,
        (FieldKind::Symbol { values }, Scalar::Symbol(symbol)) => values.contains(symbol),
        _ => false,
    };
    match (op, value) {
        (CompareOp::In | CompareOp::NotIn, RuleValue::Set(set)) => {
            let unique: BTreeSet<_> = set.iter().collect();
            !set.is_empty() && unique.len() == set.len() && set.iter().all(scalar_fits)
        }
        (CompareOp::Eq | CompareOp::Ne, RuleValue::One(scalar)) => scalar_fits(scalar),
        (CompareOp::Lt | CompareOp::Le | CompareOp::Gt | CompareOp::Ge, RuleValue::One(scalar)) => {
            matches!(kind, FieldKind::Count { .. }) && scalar_fits(scalar)
        }
        _ => false,
    }
}
