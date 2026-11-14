//! Wire types between Electron main and the native agent: the shared fact envelope, rules,
//! rule statuses, messages and framing. These Rust types are the one authority; the JSON Schema
//! and TypeScript are generated from them.
#![forbid(unsafe_code)]

pub mod facts;
pub mod frame;
pub mod messages;
pub mod recording;
pub mod rules;
pub mod scalars;

use schemars::generate::SchemaSettings;

/// The JSON Schema of the main ↔ agent protocol: `MainMessage` and `AgentMessage` with every type
/// they reach under `$defs`. Deterministic, so it can be committed and checked for drift.
#[must_use]
pub fn agent_protocol_schema() -> serde_json::Value {
    let generator = SchemaSettings::draft2020_12().into_generator();
    let mut generator = generator;
    let main = generator.subschema_for::<messages::MainMessage>();
    let agent = generator.subschema_for::<messages::AgentMessage>();
    let definitions = generator.take_definitions(true);
    serde_json::json!({
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "$id": "prctr-agent-protocol.schema.json",
        "title": "Proctor native agent protocol",
        "oneOf": [main, agent],
        "$defs": definitions,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_schema_defines_both_directions_and_the_policy() {
        let schema = agent_protocol_schema();
        let definitions = schema["$defs"].as_object().expect("definitions object");
        for name in [
            "MainMessage",
            "AgentMessage",
            "Policy",
            "Condition",
            "Fact",
            "RuleStatus",
        ] {
            assert!(definitions.contains_key(name), "missing {name}");
        }
    }

    #[test]
    fn the_schema_is_identical_on_every_generation() {
        assert_eq!(agent_protocol_schema(), agent_protocol_schema());
    }

    #[test]
    fn a_condition_parses_in_its_documented_shape_and_refuses_unknown_fields() {
        let valid = r#"{ "All": { "conditions": [
            { "Compare": { "field": "display.summary.active_physical", "op": "eq", "value": 1 } },
            { "Compare": { "field": "display.kind", "op": "in", "value": ["physical"] } }
        ] } }"#;
        assert!(serde_json::from_str::<rules::Condition>(valid).is_ok());
        let extra = r#"{ "All": { "conditions": [], "extra": 1 } }"#;
        assert!(serde_json::from_str::<rules::Condition>(extra).is_err());
        let unknown_variant = r#"{ "Xor": { "conditions": [] } }"#;
        assert!(serde_json::from_str::<rules::Condition>(unknown_variant).is_err());
    }
}
