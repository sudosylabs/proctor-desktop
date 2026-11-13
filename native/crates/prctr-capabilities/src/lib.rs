//! Every native capability, one module each. Adding a capability is adding its module and one
//! entry in [`sources`] and [`registry`].
#![forbid(unsafe_code)]

pub mod candidate_window;
pub mod catalog;
pub mod clipboard;
pub mod display;
pub mod interactive_session;
pub mod interruptions;
pub mod media;
pub mod network;
mod poller;
pub mod printing;
pub mod process_application;
pub mod removable_storage;
pub mod virtualization;

use prctr_core::{Registry, Source};
use serde_json::{Value, json};

/// A fresh source for every registered capability.
#[must_use]
pub fn sources() -> Vec<Box<dyn Source>> {
    vec![
        Box::new(display::DisplaySource::new()),
        Box::new(candidate_window::CandidateWindowSource::new()),
        Box::new(interactive_session::InteractiveSessionSource::new()),
        Box::new(clipboard::ClipboardSource::new()),
        Box::new(virtualization::VirtualizationSource),
        Box::new(network::NetworkSource::new()),
        Box::new(removable_storage::RemovableStorageSource::new()),
        Box::new(printing::PrintingSource::new()),
        Box::new(media::MediaSource::new(media::Kind::Camera)),
        Box::new(media::MediaSource::new(media::Kind::Microphone)),
        Box::new(process_application::ProcessSource::new()),
    ]
}

/// The registry the agent and the server share: descriptors and the release-owned baseline rules.
#[must_use]
pub fn registry() -> Registry {
    Registry {
        capabilities: vec![
            display::descriptor(),
            candidate_window::descriptor(),
            interactive_session::descriptor(),
            clipboard::descriptor(),
            virtualization::descriptor(),
            network::descriptor(),
            removable_storage::descriptor(),
            printing::descriptor(),
            media::descriptor(media::Kind::Camera),
            media::descriptor(media::Kind::Microphone),
            process_application::descriptor(),
        ],
        baseline_rules: vec![
            display::baseline_rule(),
            candidate_window::baseline_rule(),
            interactive_session::baseline_rule(),
        ],
        applications: catalog::registered(),
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
            },
            interactive_session::CAPABILITY: {
                "state": schema(schemars::schema_for!(interactive_session::InteractiveSessionState)),
                "summary": { "type": "object", "additionalProperties": false, "properties": {} },
            },
            clipboard::CAPABILITY: {
                "state": schema(schemars::schema_for!(clipboard::ClipboardState)),
                "summary": { "type": "object", "additionalProperties": false, "properties": {} },
            },
            virtualization::CAPABILITY: {
                "state": schema(schemars::schema_for!(virtualization::VirtualizationState)),
                "summary": { "type": "object", "additionalProperties": false, "properties": {} },
            },
            network::CAPABILITY: {
                "state": schema(schemars::schema_for!(network::NetworkState)),
                "summary": schema(schemars::schema_for!(network::NetworkSummary)),
            },
            removable_storage::CAPABILITY: {
                "state": schema(schemars::schema_for!(removable_storage::StorageState)),
                "summary": schema(schemars::schema_for!(removable_storage::StorageSummary)),
            },
            printing::CAPABILITY: {
                "state": schema(schemars::schema_for!(printing::PrintState)),
                "summary": schema(schemars::schema_for!(printing::PrintSummary)),
            },
            "camera": {
                "state": schema(schemars::schema_for!(media::CameraState)),
                "summary": schema(schemars::schema_for!(media::CameraSummary)),
            },
            "microphone": {
                "state": schema(schemars::schema_for!(media::MicrophoneState)),
                "summary": schema(schemars::schema_for!(media::MicrophoneSummary)),
            },
            process_application::CAPABILITY: {
                "state": schema(schemars::schema_for!(process_application::ProcessState)),
                "summary": schema(schemars::schema_for!(process_application::ProcessSummary)),
            }
        }
    })
}

#[cfg(test)]
mod tests {
    #[test]
    fn no_registered_rule_field_is_an_envelope_member() {
        for descriptor in super::registry().capabilities {
            prctr_core::testing::assert_rule_fields_are_not_envelope(&descriptor);
        }
    }
}
