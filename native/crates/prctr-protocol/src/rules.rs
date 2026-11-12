//! Rules the server compiles and the agent evaluates. Semantics: `docs/architecture/native-rules.md`.

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

use crate::facts::FactRef;
use crate::scalars::{Count, Identifier};

pub const MAX_RULES: usize = 64;
pub const MAX_COMPARISONS_PER_RULE: usize = 16;
pub const MAX_DEPTH: usize = 3;
pub const MAX_CATALOG_APP_IDS: usize = 256;
pub const MAX_ACTIVATIONS: usize = 32;
pub const MAX_CATEGORIES: usize = 16;

/// Which capabilities run, with the sub-categories they may query.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct Activation {
    pub capability: Identifier,
    pub categories: Vec<Identifier>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum Mode {
    Enforce,
    Observe,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum RulePhase {
    Readiness,
    Participation,
    Both,
}

impl RulePhase {
    #[must_use]
    pub const fn applies_to_readiness(self) -> bool {
        matches!(self, Self::Readiness | Self::Both)
    }

    #[must_use]
    pub const fn applies_to_participation(self) -> bool {
        matches!(self, Self::Participation | Self::Both)
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum CompareOp {
    Eq,
    Ne,
    Lt,
    Le,
    Gt,
    Ge,
    In,
    NotIn,
}

/// One value a field can hold: a count or one of the field's enum values.
#[derive(
    Clone, Debug, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize, JsonSchema,
)]
#[serde(untagged)]
pub enum Scalar {
    Number(Count),
    Symbol(Identifier),
}

/// The right-hand side of a comparison: one scalar, or a set for `in` / `not_in`.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(untagged)]
pub enum RuleValue {
    One(Scalar),
    Set(Vec<Scalar>),
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct Compare {
    pub field: Identifier,
    pub op: CompareOp,
    pub value: RuleValue,
}

/// A requirement. Serialized externally tagged: `{ "Compare": { … } }`, `{ "All": { "conditions": [ … ] } }`.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub enum Condition {
    Compare(Compare),
    All {
        conditions: Vec<Condition>,
    },
    Any {
        conditions: Vec<Condition>,
    },
    Not {
        condition: Box<Condition>,
    },
    /// Blocklist: none of these catalog applications running.
    AppsAbsent {
        catalog_app_ids: Vec<Identifier>,
    },
    /// Allowlist: nothing outside these catalog applications and the OS-essential set.
    AppsOnly {
        catalog_app_ids: Vec<Identifier>,
    },
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct Rule {
    pub rule_id: Identifier,
    pub capability: Identifier,
    pub mode: Mode,
    pub phase: RulePhase,
    pub reason: Identifier,
    pub requirement: Condition,
}

/// What the server sends at activation.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct Policy {
    pub activations: Vec<Activation>,
    pub rules: Vec<Rule>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum Status {
    Met,
    NotMet,
    Unknown,
}

/// Why a rule is unknown. When several apply, the first in this order is reported.
#[derive(
    Clone, Copy, Debug, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize, JsonSchema,
)]
#[serde(rename_all = "snake_case")]
pub enum UnknownCause {
    /// No state yet, the field is missing, or no application match was reported for the rule.
    Unavailable,
    /// Events were lost and no fresh complete state has arrived since.
    Gap,
    /// The capability is unsupported, failed or stopped.
    Unhealthy,
    /// The capability's permission is not granted.
    Permission,
    /// The capability's certainty is not complete.
    Partial,
    /// A new process is still being identified.
    Checking,
}

/// What Electron main did to the candidate window as a result of this change.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum LocalEffect {
    Contained,
    Released,
    None,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct RuleStatus {
    pub rule_id: Identifier,
    pub status: Status,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub unknown_cause: Option<UnknownCause>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cause: Option<FactRef>,
    pub local_effect: LocalEffect,
}
