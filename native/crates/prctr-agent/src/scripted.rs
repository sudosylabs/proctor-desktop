//! A test-only capability, compiled only with the `scripted-capabilities` feature. Electron-main
//! tests drive it through host events to cause changes, losses, failures, panics and hangs.

use std::collections::BTreeMap;

use prctr_core::{
    CapabilityDescriptor, FieldKind, FieldSpec, FieldValue, Observation, Sink, Source, SourceError,
    SourceEvent,
};
use prctr_protocol::facts::{Certainty, Envelope, Health, Permission};
use prctr_protocol::scalars::Identifier;
use serde_json::{Value, json};

pub const STABILITY_MS: u64 = 200;

fn id(text: &str) -> Identifier {
    Identifier::new(text).expect("scripted identifier is valid")
}

pub struct Scripted {
    count: u64,
    health: Health,
    sink: Option<Sink>,
}

impl Scripted {
    #[must_use]
    pub const fn new() -> Self {
        Self {
            count: 1,
            health: Health::Healthy,
            sink: None,
        }
    }

    fn notify(&self, event: SourceEvent) {
        if let Some(sink) = &self.sink {
            sink(event);
        }
    }
}

impl Source for Scripted {
    fn descriptor(&self) -> CapabilityDescriptor {
        CapabilityDescriptor {
            id: id("scripted"),
            sensitive: false,
            stability_ms: STABILITY_MS,
            categories: Vec::new(),
            fields: vec![FieldSpec {
                name: id("scripted.count"),
                kind: FieldKind::Count { max: 1_000 },
            }],
            reasons: vec![id("scripted.reason")],
            app_conditions: false,
            permission_prompt: false,
        }
    }

    fn start(&mut self, sink: Sink) -> Result<Observation, SourceError> {
        self.sink = Some(sink);
        Ok(self.current())
    }

    fn current(&mut self) -> Observation {
        let certainty = if self.health == Health::Healthy {
            Certainty::Complete
        } else {
            Certainty::Unknown
        };
        Observation {
            envelope: Envelope {
                permission: Permission::Granted,
                health: self.health,
                certainty,
            },
            state: json!({ "count": self.count }),
            summary: json!({ "count": self.count }),
            fields: BTreeMap::from([(id("scripted.count"), FieldValue::Number(self.count))]),
            apps: None,
            changes: Vec::new(),
        }
    }

    fn stop(&mut self) {
        self.sink = None;
    }

    fn host_event(&mut self, event: &Value) -> Result<(), SourceError> {
        let invalid = SourceError {
            reason: "invalid scripted event",
        };
        let object = event
            .as_object()
            .filter(|object| object.len() == 1)
            .ok_or(invalid.clone())?;
        let (command, value) = object.iter().next().ok_or(invalid.clone())?;
        match command.as_str() {
            "set" => {
                self.count = value
                    .as_u64()
                    .filter(|count| *count <= 1_000)
                    .ok_or(invalid)?;
                self.notify(SourceEvent::Changed);
            }
            "lose" => self.notify(SourceEvent::Lost(value.as_u64().ok_or(invalid)?)),
            "fail" => {
                self.health = Health::Failed;
                self.notify(SourceEvent::Changed);
            }
            "panic" => panic!("scripted panic"),
            "hang" => loop {
                std::thread::park();
            },
            _ => return Err(invalid),
        }
        Ok(())
    }
}
