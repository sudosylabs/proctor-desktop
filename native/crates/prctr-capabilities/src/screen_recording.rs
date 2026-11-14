//! Whether the screen evidence recorder could record: the OS screen-capture permission (macOS
//! Screen Recording), in the envelope, and the free disk space on the volume that holds the app's
//! data. The recorder itself is not a capability: it collects content, not facts.
//! Contract: `docs/architecture/native-capability-families.md`, "Screen recording".

use std::collections::BTreeMap;
use std::path::PathBuf;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use prctr_core::{
    CapabilityDescriptor, FieldKind, FieldSpec, FieldValue, Observation, Sink, Source, SourceError,
    SourceEvent,
};
use prctr_protocol::facts::{Certainty, Envelope, Health, Permission};
use prctr_protocol::scalars::Identifier;
use schemars::JsonSchema;
use serde::Serialize;

use crate::poller::Poller;

pub const CAPABILITY: &str = "screen_recording";
pub const POLL_INTERVAL: Duration = Duration::from_secs(5);
pub const REASON_NOT_PERMITTED: &str = "screen_recording.not_permitted";
pub const REASON_LOW_DISK: &str = "screen_recording.low_disk_space";
const MIB: u64 = 1024 * 1024;
const MAX_MIB: u64 = 1 << 30;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct ScreenRecordingState {
    /// Free space for this account on the app's data volume; absent when unreadable.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub free_space_mib: Option<u64>,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct ScreenRecordingSummary {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub free_space_mib: Option<u64>,
}

fn id(text: &str) -> Identifier {
    Identifier::new(text).expect("screen recording identifier is valid")
}

#[must_use]
pub fn descriptor() -> CapabilityDescriptor {
    CapabilityDescriptor {
        id: id(CAPABILITY),
        sensitive: false,
        stability_ms: 0,
        categories: Vec::new(),
        fields: vec![FieldSpec {
            name: id("screen_recording.summary.free_space_mib"),
            kind: FieldKind::Count { max: MAX_MIB },
        }],
        reasons: vec![id(REASON_NOT_PERMITTED), id(REASON_LOW_DISK)],
        app_conditions: false,
        permission_prompt: true,
    }
}

/// One read.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct RawRecording {
    pub supported: bool,
    pub allowed: bool,
    /// The candidate was asked and capture is still not allowed.
    pub refused: bool,
    pub free_bytes: Option<u64>,
}

#[must_use]
pub fn classify(raw: RawRecording) -> Observation {
    let free_space_mib = raw.free_bytes.map(|bytes| (bytes / MIB).min(MAX_MIB));
    let permission = match (raw.allowed, raw.refused) {
        (true, _) => Permission::Granted,
        (false, true) => Permission::Denied,
        (false, false) => Permission::NotDetermined,
    };
    let (health, certainty) = if !raw.supported {
        (Health::Unsupported, Certainty::Unknown)
    } else if free_space_mib.is_some() {
        (Health::Healthy, Certainty::Complete)
    } else {
        (Health::Degraded, Certainty::Partial)
    };
    Observation {
        envelope: Envelope {
            permission: if raw.supported {
                permission
            } else {
                Permission::Unavailable
            },
            health,
            certainty,
        },
        state: serde_json::to_value(ScreenRecordingState { free_space_mib }).unwrap_or_default(),
        summary: serde_json::to_value(ScreenRecordingSummary { free_space_mib })
            .unwrap_or_default(),
        fields: free_space_mib
            .filter(|_| raw.supported)
            .map(|mib| {
                (
                    id("screen_recording.summary.free_space_mib"),
                    FieldValue::Number(mib),
                )
            })
            .into_iter()
            .collect::<BTreeMap<_, _>>(),
        apps: None,
        changes: Vec::new(),
    }
}

/// The volume that holds the app's data: the account's home directory.
fn data_volume() -> Option<PathBuf> {
    std::env::var_os(if cfg!(windows) { "USERPROFILE" } else { "HOME" }).map(PathBuf::from)
}

fn read(refused: bool) -> RawRecording {
    let supported = cfg!(any(target_os = "macos", target_os = "windows"));
    let allowed = prctr_os::screen_capture_allowed();
    RawRecording {
        supported,
        allowed,
        refused: refused && !allowed,
        free_bytes: data_volume().and_then(|path| prctr_os::free_space(&path)),
    }
}

/// The screen recording readiness source.
pub struct ScreenRecordingSource {
    refused: Arc<AtomicBool>,
    poller: Option<Poller>,
    sink: Option<Sink>,
}

impl ScreenRecordingSource {
    #[must_use]
    pub fn new() -> Self {
        Self {
            refused: Arc::new(AtomicBool::new(false)),
            poller: None,
            sink: None,
        }
    }
}

impl Default for ScreenRecordingSource {
    fn default() -> Self {
        Self::new()
    }
}

impl Source for ScreenRecordingSource {
    fn descriptor(&self) -> CapabilityDescriptor {
        descriptor()
    }

    fn start(
        &mut self,
        _categories: &[Identifier],
        sink: Sink,
    ) -> Result<Observation, SourceError> {
        self.stop();
        let refused = Arc::clone(&self.refused);
        let first = read(refused.load(Ordering::Acquire));
        // Free space changes by bytes all the time; a wake-up is needed only per MiB.
        let mib = |raw: RawRecording| {
            (
                raw.allowed,
                raw.refused,
                raw.free_bytes.map(|bytes| bytes / MIB),
            )
        };
        self.poller = Some(Poller::start(
            "prctr-screen-recording",
            POLL_INTERVAL,
            mib(first),
            move || mib(read(refused.load(Ordering::Acquire))),
            Arc::clone(&sink),
        )?);
        self.sink = Some(sink);
        Ok(self.current())
    }

    fn current(&mut self) -> Observation {
        classify(read(self.refused.load(Ordering::Acquire)))
    }

    fn stop(&mut self) {
        if let Some(poller) = self.poller.take() {
            poller.stop();
        }
        self.sink = None;
    }

    /// Shows the macOS Screen Recording prompt once. macOS applies the answer after a relaunch, so
    /// the permission reads as denied until then if the candidate has not allowed it.
    fn request_permission(&mut self) -> Result<Permission, SourceError> {
        if !cfg!(target_os = "macos") {
            return Err(SourceError {
                reason: "no screen recording prompt on this platform",
            });
        }
        let allowed = prctr_os::request_screen_capture();
        self.refused.store(!allowed, Ordering::Release);
        if let Some(sink) = &self.sink {
            sink(SourceEvent::Changed);
        }
        Ok(if allowed {
            Permission::Granted
        } else {
            Permission::Denied
        })
    }
}

impl Drop for ScreenRecordingSource {
    fn drop(&mut self) {
        self.stop();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn raw(allowed: bool, refused: bool, free_bytes: Option<u64>) -> RawRecording {
        RawRecording {
            supported: true,
            allowed,
            refused,
            free_bytes,
        }
    }

    #[test]
    fn free_space_is_a_rule_field_in_mebibytes() {
        let observation = classify(raw(true, false, Some(5 * MIB + 7)));
        assert_eq!(observation.state["free_space_mib"], 5);
        assert_eq!(
            observation.fields[&id("screen_recording.summary.free_space_mib")],
            FieldValue::Number(5)
        );
        assert_eq!(observation.envelope.permission, Permission::Granted);
    }

    #[test]
    fn the_permission_is_not_determined_until_refused() {
        assert_eq!(
            classify(raw(false, false, Some(1))).envelope.permission,
            Permission::NotDetermined
        );
        assert_eq!(
            classify(raw(false, true, Some(1))).envelope.permission,
            Permission::Denied
        );
    }

    #[test]
    fn unreadable_space_is_partial_and_has_no_field() {
        let observation = classify(raw(true, false, None));
        assert_eq!(observation.envelope.certainty, Certainty::Partial);
        assert!(observation.fields.is_empty());
    }

    #[test]
    fn screen_recording_passes_the_core_conformance_suite() {
        prctr_core::testing::assert_capability_conformance(
            &descriptor(),
            &classify(raw(true, false, Some(10 * MIB))),
            &classify(raw(true, false, Some(20 * MIB))),
        );
    }

    /// Real OS: the home volume's free space is readable.
    #[cfg(any(target_os = "macos", target_os = "windows"))]
    #[test]
    fn this_machine_reports_free_space() {
        let observation = classify(read(false));
        assert!(
            observation.state["free_space_mib"]
                .as_u64()
                .is_some_and(|mib| mib > 0)
        );
    }
}
