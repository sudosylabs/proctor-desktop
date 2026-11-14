//! Cameras and microphones: present, permitted, ready, and whether another application captures
//! from one. No frame or sample is ever captured and no device is opened. Device names, models and
//! the other application stay in the agent.
//! Contract: `docs/architecture/native-capability-families.md`, "Camera" and "Microphone".

use std::collections::{BTreeMap, BTreeSet};
use std::sync::Arc;
use std::time::Duration;

use prctr_core::{
    CapabilityDescriptor, FieldKind, FieldSpec, FieldValue, Observation, Sink, Source, SourceError,
};
use prctr_os::{RawMedia, RawMediaPermission};
use prctr_protocol::facts::{Certainty, Envelope, Health, Permission};
use prctr_protocol::scalars::Identifier;
use schemars::JsonSchema;
use serde::Serialize;

use crate::poller::Poller;

pub const POLL_INTERVAL: Duration = Duration::from_secs(1);
pub const STABILITY_MS: u64 = 2_000;
pub const CHANGE_ADDED: &str = "device_added";
pub const CHANGE_REMOVED: &str = "device_removed";
pub const CHANGE_PERMISSION: &str = "permission_changed";
pub const CHANGE_READINESS: &str = "readiness_changed";
pub const CHANGE_USE: &str = "use_changed";
const MAX_DEVICES: u64 = 64;

/// Which media capability a source observes.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Kind {
    Camera,
    Microphone,
}

impl Kind {
    #[must_use]
    pub const fn capability(self) -> &'static str {
        match self {
            Self::Camera => "camera",
            Self::Microphone => "microphone",
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum Coverage {
    ReadinessAndUse,
    /// Devices and readiness are read; other-application use is not readable here.
    ReadinessOnly,
    Unavailable,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum Readiness {
    Ready,
    NotReady,
    Unknown,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum Known {
    Yes,
    No,
    Unknown,
}

/// The camera state. The permission is in the envelope.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct CameraState {
    pub coverage: Coverage,
    pub physical_devices: u64,
    /// Software cameras, and cameras that cannot be classified. They never make the camera ready.
    pub virtual_devices: u64,
    /// A physical camera is connected and not suspended, and the permission is granted.
    pub ready: Readiness,
    pub in_use_by_other_app: Known,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct CameraSummary {
    pub physical_devices: u64,
    pub virtual_devices: u64,
}

/// The microphone state. The permission is in the envelope.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct MicrophoneState {
    pub coverage: Coverage,
    pub devices: u64,
    /// A microphone is available and the permission is granted.
    pub ready: Readiness,
    pub in_use_by_other_app: Known,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct MicrophoneSummary {
    pub devices: u64,
}

fn id(text: &str) -> Identifier {
    Identifier::new(text).expect("media identifier is valid")
}

fn field(kind: Kind, name: &str) -> Identifier {
    id(&format!("{}.{name}", kind.capability()))
}

#[must_use]
pub fn descriptor(kind: Kind) -> CapabilityDescriptor {
    let symbol = |name: &str, values: &[&str]| FieldSpec {
        name: field(kind, name),
        kind: FieldKind::Symbol {
            values: values.iter().map(|value| id(value)).collect(),
        },
    };
    let count = |name: &str| FieldSpec {
        name: field(kind, name),
        kind: FieldKind::Count { max: MAX_DEVICES },
    };
    let mut fields = match kind {
        Kind::Camera => vec![
            count("summary.physical_devices"),
            count("summary.virtual_devices"),
        ],
        Kind::Microphone => vec![count("summary.devices")],
    };
    fields.push(symbol("ready", &["ready", "not_ready"]));
    fields.push(symbol("in_use_by_other_app", &["yes", "no"]));
    CapabilityDescriptor {
        id: id(kind.capability()),
        sensitive: false,
        stability_ms: STABILITY_MS,
        categories: Vec::new(),
        fields,
        reasons: vec![
            field(kind, "not_ready"),
            field(kind, "in_use_by_other_app"),
            field(kind, "virtual_device"),
        ],
        app_conditions: false,
        permission_prompt: true,
    }
}

const fn permission(raw: RawMediaPermission) -> Permission {
    match raw {
        RawMediaPermission::NotDetermined => Permission::NotDetermined,
        RawMediaPermission::Granted => Permission::Granted,
        RawMediaPermission::Denied => Permission::Denied,
        RawMediaPermission::Restricted => Permission::Restricted,
        RawMediaPermission::Unavailable => Permission::Unavailable,
    }
}

/// Per-session memory of the previous read, for change kinds.
#[derive(Debug, Default)]
pub struct Tracking {
    previous: Option<(BTreeSet<u64>, Permission, Readiness, Known)>,
}

impl Tracking {
    /// The facts for one read.
    pub fn classify(&mut self, kind: Kind, raw: &RawMedia) -> Observation {
        let permission = permission(raw.permission);
        let devices = raw.devices.as_deref();
        let usable = |physical_only: bool| {
            devices.map(|devices| {
                let candidates: Vec<_> = devices
                    .iter()
                    .filter(|device| device.physical || !physical_only)
                    .collect();
                if candidates
                    .iter()
                    .any(|device| device.available == Some(true))
                {
                    Some(true)
                } else if candidates.iter().any(|device| device.available.is_none()) {
                    None
                } else {
                    Some(false)
                }
            })
        };
        let available = usable(kind == Kind::Camera).flatten();
        let ready = match (devices, permission, available) {
            (Some(_), Permission::Granted, Some(true)) => Readiness::Ready,
            (None, _, _) | (Some(_), Permission::Granted, None) => Readiness::Unknown,
            (Some(_), _, _) => Readiness::NotReady,
        };
        let in_use = match raw.in_use_by_other {
            Some(true) => Known::Yes,
            Some(false) => Known::No,
            None => Known::Unknown,
        };
        let coverage = match (devices, raw.in_use_by_other) {
            (None, _) => Coverage::Unavailable,
            (Some(_), Some(_)) => Coverage::ReadinessAndUse,
            (Some(_), None) => Coverage::ReadinessOnly,
        };
        let all = devices.unwrap_or_default();
        let physical = all.iter().filter(|device| device.physical).count() as u64;
        let total = (all.len() as u64).min(MAX_DEVICES);
        let physical = physical.min(MAX_DEVICES);
        let (state, summary) = match kind {
            Kind::Camera => (
                serde_json::to_value(CameraState {
                    coverage,
                    physical_devices: physical,
                    virtual_devices: total - physical,
                    ready,
                    in_use_by_other_app: in_use,
                }),
                serde_json::to_value(CameraSummary {
                    physical_devices: physical,
                    virtual_devices: total - physical,
                }),
            ),
            Kind::Microphone => (
                serde_json::to_value(MicrophoneState {
                    coverage,
                    devices: total,
                    ready,
                    in_use_by_other_app: in_use,
                }),
                serde_json::to_value(MicrophoneSummary { devices: total }),
            ),
        };
        let fields = rule_fields(kind, devices.is_some(), physical, total, ready, in_use);
        let keys: BTreeSet<u64> = all.iter().map(|device| device.key).collect();
        let changes = self.changes(&keys, permission, ready, in_use);
        let (health, certainty) = match coverage {
            Coverage::ReadinessAndUse => (Health::Healthy, Certainty::Complete),
            Coverage::ReadinessOnly => (Health::Degraded, Certainty::Partial),
            Coverage::Unavailable => (Health::Unsupported, Certainty::Unknown),
        };
        Observation {
            envelope: Envelope {
                permission,
                health,
                certainty,
            },
            state: state.unwrap_or_default(),
            summary: summary.unwrap_or_default(),
            fields,
            apps: None,
            changes,
        }
    }

    fn changes(
        &mut self,
        keys: &BTreeSet<u64>,
        permission: Permission,
        ready: Readiness,
        in_use: Known,
    ) -> Vec<Identifier> {
        let mut changes = Vec::new();
        if let Some((before, before_permission, before_ready, before_use)) = self
            .previous
            .replace((keys.clone(), permission, ready, in_use))
        {
            for (happened, change) in [
                (keys.difference(&before).next().is_some(), CHANGE_ADDED),
                (before.difference(keys).next().is_some(), CHANGE_REMOVED),
                (before_permission != permission, CHANGE_PERMISSION),
                (before_ready != ready, CHANGE_READINESS),
                (before_use != in_use, CHANGE_USE),
            ] {
                if happened {
                    changes.push(id(change));
                }
            }
        }
        changes
    }
}

/// The rule fields; an unknown value has no field, so a rule on it is unknown rather than not met.
fn rule_fields(
    kind: Kind,
    listed: bool,
    physical: u64,
    total: u64,
    ready: Readiness,
    in_use: Known,
) -> BTreeMap<Identifier, FieldValue> {
    let mut fields = BTreeMap::new();
    if listed {
        match kind {
            Kind::Camera => {
                fields.insert(
                    field(kind, "summary.physical_devices"),
                    FieldValue::Number(physical),
                );
                fields.insert(
                    field(kind, "summary.virtual_devices"),
                    FieldValue::Number(total - physical),
                );
            }
            Kind::Microphone => {
                fields.insert(field(kind, "summary.devices"), FieldValue::Number(total));
            }
        }
    }
    match ready {
        Readiness::Ready => fields.insert(field(kind, "ready"), FieldValue::Symbol(id("ready"))),
        Readiness::NotReady => {
            fields.insert(field(kind, "ready"), FieldValue::Symbol(id("not_ready")))
        }
        Readiness::Unknown => None,
    };
    match in_use {
        Known::Yes => fields.insert(
            field(kind, "in_use_by_other_app"),
            FieldValue::Symbol(id("yes")),
        ),
        Known::No => fields.insert(
            field(kind, "in_use_by_other_app"),
            FieldValue::Symbol(id("no")),
        ),
        Known::Unknown => None,
    };
    fields
}

/// One read of `kind` on this platform.
#[must_use]
pub fn read(kind: Kind) -> RawMedia {
    #[cfg(target_os = "macos")]
    return match kind {
        Kind::Camera => prctr_os::macos::cameras(),
        Kind::Microphone => prctr_os::macos::microphones(),
    };
    #[cfg(target_os = "windows")]
    return match kind {
        Kind::Camera => prctr_os::windows::cameras(),
        Kind::Microphone => prctr_os::windows::microphones(),
    };
    #[cfg(target_os = "linux")]
    return match kind {
        Kind::Camera => prctr_os::linux::cameras(),
        Kind::Microphone => prctr_os::linux::microphones(),
    };
}

/// A camera or microphone source.
pub struct MediaSource {
    kind: Kind,
    tracking: Tracking,
    poller: Option<Poller>,
    sink: Option<Sink>,
}

impl MediaSource {
    #[must_use]
    pub fn new(kind: Kind) -> Self {
        Self {
            kind,
            tracking: Tracking::default(),
            poller: None,
            sink: None,
        }
    }
}

impl Source for MediaSource {
    fn descriptor(&self) -> CapabilityDescriptor {
        descriptor(self.kind)
    }

    fn start(
        &mut self,
        _categories: &[Identifier],
        sink: Sink,
    ) -> Result<Observation, SourceError> {
        self.stop();
        let kind = self.kind;
        self.poller = Some(Poller::start(
            match kind {
                Kind::Camera => "prctr-camera",
                Kind::Microphone => "prctr-microphone",
            },
            POLL_INTERVAL,
            read(kind),
            move || read(kind),
            Arc::clone(&sink),
        )?);
        self.sink = Some(sink);
        Ok(self.current())
    }

    fn current(&mut self) -> Observation {
        let raw = read(self.kind);
        self.tracking.classify(self.kind, &raw)
    }

    fn stop(&mut self) {
        self.sink = None;
        if let Some(poller) = self.poller.take() {
            poller.stop();
        }
    }

    /// Shows the OS prompt when the permission is not determined and returns the permission now;
    /// the answer arrives later as a change. Only macOS has a prompt: Windows and Linux permissions
    /// are changed in the OS settings.
    fn request_permission(&mut self) -> Result<Permission, SourceError> {
        #[cfg(target_os = "macos")]
        {
            let current = permission(read(self.kind).permission);
            if current == Permission::NotDetermined {
                let sink = self.sink.clone();
                prctr_os::macos::request_access(
                    match self.kind {
                        Kind::Camera => prctr_os::macos::MediaKind::Camera,
                        Kind::Microphone => prctr_os::macos::MediaKind::Microphone,
                    },
                    move || {
                        if let Some(sink) = &sink {
                            sink(prctr_core::SourceEvent::Changed);
                        }
                    },
                );
            }
            Ok(current)
        }
        #[cfg(not(target_os = "macos"))]
        {
            Err(SourceError {
                reason: "no permission prompt on this platform",
            })
        }
    }
}

impl Drop for MediaSource {
    fn drop(&mut self) {
        self.stop();
    }
}

#[cfg(test)]
#[path = "media_tests.rs"]
mod tests;
