//! Every native capability, one module each. Adding a capability is adding its module and one
//! entry in [`sources`] and [`registry`].
#![forbid(unsafe_code)]

pub mod candidate_window;
pub mod display;

use prctr_core::{Registry, Source};
use serde_json::{Value, json};

/// A fresh source for every registered capability.
#[must_use]
pub fn sources() -> Vec<Box<dyn Source>> {
    vec![
        Box::new(display::DisplaySource::new()),
        Box::new(candidate_window::CandidateWindowSource::new()),
    ]
}

/// The registry the agent and the server share: descriptors and the release-owned baseline rules.
#[must_use]
pub fn registry() -> Registry {
    Registry {
        capabilities: vec![display::descriptor(), candidate_window::descriptor()],
        baseline_rules: vec![display::baseline_rule(), candidate_window::baseline_rule()],
    }
}

/// The published registry artifact: the registry plus each capability's state and summary schema.
#[must_use]
pub fn registry_json() -> Value {
    let schema = |value: schemars::Schema| serde_json::to_value(value).unwrap_or_default();
    json!({
        "description": "Proctor native capability registry: capabilities, typed rule fields, reasons, baseline rules and fact schemas, generated from the Rust types.",
        "registry": registry(),
        "fact_schemas": {
            display::CAPABILITY: {
                "state": schema(schemars::schema_for!(display::DisplayState)),
                "summary": schema(schemars::schema_for!(display::DisplaySummary)),
            },
            candidate_window::CAPABILITY: {
                "state": schema(schemars::schema_for!(candidate_window::CandidateWindowState)),
                "summary": { "type": "object", "additionalProperties": false, "properties": {} },
            }
        }
    })
}
