//! Host clipboard changes: a counter only. Observe-only by contract: a change cannot prove what the
//! candidate did, so there is no baseline rule. Content, formats and owner are never read.
//! Contract: `docs/architecture/native-capability-families.md`, "Clipboard".

use std::time::Duration;

use prctr_core::{
    CapabilityDescriptor, FieldKind, FieldSpec, FieldValue, Observation, Sink, Source, SourceError,
};
use prctr_protocol::facts::{Certainty, Envelope, Health, Permission};
use prctr_protocol::scalars::Identifier;
use schemars::JsonSchema;
use serde::Serialize;

use crate::poller::Poller;

pub const CAPABILITY: &str = "clipboard";
/// Polling the counter this often catches every change as a counter delta.
pub const POLL_INTERVAL: Duration = Duration::from_millis(250);
pub const STABILITY_MS: u64 = 0;
pub const REASON_CHANGED: &str = "clipboard.changed";
const MAX_CHANGES: u64 = 1_000_000_000;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum Coverage {
    CounterPolling,
    Unavailable,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct ClipboardState {
    pub coverage: Coverage,
    /// Host clipboard changes since this capability was activated.
    pub changes: u64,
}

fn id(text: &str) -> Identifier {
    Identifier::new(text).expect("clipboard identifier is valid")
}

#[must_use]
pub fn descriptor() -> CapabilityDescriptor {
    CapabilityDescriptor {
        id: id(CAPABILITY),
        sensitive: false,
        stability_ms: STABILITY_MS,
        categories: Vec::new(),
        fields: vec![FieldSpec {
            name: id("clipboard.changes"),
            kind: FieldKind::Count { max: MAX_CHANGES },
        }],
        reasons: vec![id(REASON_CHANGED)],
        app_conditions: false,
        permission_prompt: false,
    }
}

/// The facts for one counter reading against the reading at activation.
#[must_use]
pub fn classify(counter: Option<u64>, at_activation: Option<u64>) -> Observation {
    let (coverage, changes, envelope) = match (counter, at_activation) {
        (Some(now), Some(start)) => (
            Coverage::CounterPolling,
            Some(now.saturating_sub(start).min(MAX_CHANGES)),
            Envelope {
                permission: Permission::Granted,
                health: Health::Healthy,
                certainty: Certainty::Complete,
            },
        ),
        _ => (
            Coverage::Unavailable,
            None,
            Envelope {
                permission: Permission::Granted,
                health: Health::Unsupported,
                certainty: Certainty::Unknown,
            },
        ),
    };
    let state = ClipboardState {
        coverage,
        changes: changes.unwrap_or(0),
    };
    Observation {
        envelope,
        state: serde_json::to_value(state).unwrap_or_default(),
        summary: serde_json::json!({}),
        fields: changes
            .map(|value| (id("clipboard.changes"), FieldValue::Number(value)))
            .into_iter()
            .collect(),
        apps: None,
        changes: Vec::new(),
    }
}

fn read() -> Option<u64> {
    #[cfg(target_os = "macos")]
    return prctr_os::macos::clipboard_change_count();
    #[cfg(target_os = "windows")]
    return prctr_os::windows::clipboard_change_count();
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    None
}

/// The clipboard source.
pub struct ClipboardSource {
    at_activation: Option<u64>,
    poller: Option<Poller>,
}

impl ClipboardSource {
    #[must_use]
    pub fn new() -> Self {
        Self {
            at_activation: None,
            poller: None,
        }
    }
}

impl Default for ClipboardSource {
    fn default() -> Self {
        Self::new()
    }
}

impl Source for ClipboardSource {
    fn descriptor(&self) -> CapabilityDescriptor {
        descriptor()
    }

    fn start(
        &mut self,
        _categories: &[Identifier],
        sink: Sink,
    ) -> Result<Observation, SourceError> {
        self.stop();
        let first = read();
        self.at_activation = first;
        self.poller = Some(Poller::start(
            "prctr-clipboard",
            POLL_INTERVAL,
            first,
            read,
            sink,
        )?);
        Ok(self.current())
    }

    fn current(&mut self) -> Observation {
        let start = self.at_activation.or_else(read);
        classify(read(), start)
    }

    fn stop(&mut self) {
        if let Some(poller) = self.poller.take() {
            poller.stop();
        }
    }
}

impl Drop for ClipboardSource {
    fn drop(&mut self) {
        self.stop();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn changes_are_counted_from_activation() {
        let observation = classify(Some(107), Some(100));
        assert_eq!(observation.state["changes"], 7);
        assert_eq!(observation.envelope.certainty, Certainty::Complete);
    }

    #[test]
    fn an_unavailable_counter_reports_no_count_rather_than_zero() {
        let observation = classify(None, None);
        assert_eq!(observation.state["coverage"], "unavailable");
        assert_eq!(observation.envelope.health, Health::Unsupported);
        assert!(
            observation.fields.is_empty(),
            "the count is unavailable, never zero"
        );
    }

    #[test]
    fn clipboard_passes_the_core_conformance_suite() {
        prctr_core::testing::assert_capability_conformance(
            &descriptor(),
            &classify(Some(1), Some(1)),
            &classify(Some(2), Some(1)),
        );
    }

    /// Real OS: writing to the pasteboard raises the counter by exactly the number of writes. It
    /// replaces the clipboard, so it runs only when `PRCTR_ALLOW_CLIPBOARD_WRITE` is set (CI sets it),
    /// and puts the previous text back afterwards.
    #[cfg(target_os = "macos")]
    #[test]
    fn macos_counts_each_pasteboard_write() {
        fn write(text: &str) {
            let status = std::process::Command::new("/usr/bin/pbcopy")
                .stdin(std::process::Stdio::piped())
                .spawn()
                .and_then(|mut child| {
                    use std::io::Write as _;
                    child
                        .stdin
                        .take()
                        .map(|mut stdin| stdin.write_all(text.as_bytes()));
                    child.wait()
                })
                .expect("pbcopy runs");
            assert!(status.success());
        }
        if std::env::var_os("PRCTR_ALLOW_CLIPBOARD_WRITE").is_none() {
            return;
        }
        let previous = std::process::Command::new("/usr/bin/pbpaste")
            .output()
            .map(|output| String::from_utf8_lossy(&output.stdout).into_owned())
            .unwrap_or_default();
        let before = read().expect("the pasteboard answers");
        write("proctor clipboard test one");
        write("proctor clipboard test two");
        let after = read().expect("the pasteboard answers");
        write(&previous);
        assert_eq!(after - before, 2, "two writes, two changes");
    }
}
