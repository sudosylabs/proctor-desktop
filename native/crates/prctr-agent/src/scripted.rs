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

    fn start(
        &mut self,
        _categories: &[Identifier],
        sink: Sink,
    ) -> Result<Observation, SourceError> {
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
            "interrupt" => {
                let kind = serde_json::from_value(value.clone()).map_err(|_| invalid)?;
                self.notify(SourceEvent::Interrupted(kind));
            }
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

/// Synthetic frames at the recording rate in real time, so tests drive the real recorder.
struct SyntheticFrames {
    next: std::time::Instant,
}

impl prctr_recorder::FrameSource for SyntheticFrames {
    fn next_frame(
        &mut self,
        timeout: std::time::Duration,
    ) -> Result<Option<prctr_recorder::Frame>, String> {
        let now = std::time::Instant::now();
        let wait = self.next.saturating_duration_since(now);
        if wait > timeout {
            std::thread::sleep(timeout);
            return Ok(None);
        }
        std::thread::sleep(wait);
        self.next +=
            std::time::Duration::from_millis(1_000 / u64::from(prctr_recorder::platform::FPS));
        Ok(Some(prctr_recorder::Frame {
            width: 2,
            height: 2,
            stride: 8,
            bgra: vec![0x22; 16],
            captured_ms: crate::recording::now_ms(),
            display: prctr_recorder::Rect {
                x: 0.0,
                y: 0.0,
                width: 2.0,
                height: 2.0,
            },
        }))
    }
}

/// Passes frames through as tiny H.264-shaped samples.
struct PassThrough;

impl prctr_recorder::Encoder for PassThrough {
    fn encode(
        &mut self,
        frame: &prctr_recorder::Frame,
        keyframe: bool,
    ) -> Result<Vec<prctr_recorder::EncodedSample>, String> {
        let nal = if keyframe { 0x65 } else { 0x41 };
        Ok(vec![prctr_recorder::EncodedSample {
            data: vec![0, 0, 0, 2, nal, frame.bgra[0]],
            keyframe,
        }])
    }

    fn format(&self) -> Option<prctr_recorder::StreamFormat> {
        Some(prctr_recorder::StreamFormat {
            width: 2,
            height: 2,
            sps: vec![0x67, 0x42, 0, 0x0A],
            pps: vec![0x68, 0xCE],
        })
    }
}

pub fn recorder_setup() -> crate::recording::RecorderSetup {
    crate::recording::RecorderSetup {
        backend: Box::new(|| {
            let source: Box<dyn prctr_recorder::FrameSource> = Box::new(SyntheticFrames {
                next: std::time::Instant::now(),
            });
            let encoder: Box<dyn prctr_recorder::Encoder> = Box::new(PassThrough);
            Some((source, encoder))
        }),
        placeholder: std::sync::Arc::new(|| None),
    }
}
