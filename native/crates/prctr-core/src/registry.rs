//! What each capability declares: its rule fields, reasons, categories and stability time. The
//! core knows capabilities only through these descriptors, so adding one never changes the core.

use serde::Serialize;

use prctr_protocol::rules::Rule;
use prctr_protocol::scalars::Identifier;

/// The type of a registered rule field.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum FieldKind {
    /// A non-negative count no larger than `max`.
    Count { max: u64 },
    /// One of a closed set of values.
    Symbol { values: Vec<Identifier> },
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct FieldSpec {
    pub name: Identifier,
    #[serde(flatten)]
    pub kind: FieldKind,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct CapabilityDescriptor {
    pub id: Identifier,
    /// Readable only inside a session for a sitting, never by an open query.
    pub sensitive: bool,
    /// How long facts must stay met before a rule recovers to met.
    pub stability_ms: u64,
    /// Sub-categories an activation must select from; empty when the capability has none.
    pub categories: Vec<Identifier>,
    pub fields: Vec<FieldSpec>,
    pub reasons: Vec<Identifier>,
    /// Whether rules on this capability may use `AppsAbsent` / `AppsOnly`.
    pub app_conditions: bool,
    /// Whether the OS has a permission prompt the overview can show.
    pub permission_prompt: bool,
}

impl CapabilityDescriptor {
    #[must_use]
    pub fn field(&self, name: &Identifier) -> Option<&FieldSpec> {
        self.fields.iter().find(|field| &field.name == name)
    }
}

/// Every registered capability, plus the release-owned baseline rules.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize)]
pub struct Registry {
    pub capabilities: Vec<CapabilityDescriptor>,
    pub baseline_rules: Vec<Rule>,
}

impl Registry {
    #[must_use]
    pub fn capability(&self, id: &Identifier) -> Option<&CapabilityDescriptor> {
        self.capabilities
            .iter()
            .find(|capability| &capability.id == id)
    }
}
