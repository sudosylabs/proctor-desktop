//! The candidate's interactive OS session, from the unprivileged per-platform sources. Full
//! coverage (every session, every lock and remote attachment) needs the privileged components;
//! until they exist this capability reports `snapshot_only` coverage with partial certainty.
//! Contract: `docs/architecture/native-capability-families.md`, "Interactive session".

use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::thread::{self, JoinHandle};
use std::time::Duration;

use prctr_core::{
    CapabilityDescriptor, FieldKind, FieldSpec, FieldValue, Observation, Sink, Source, SourceError,
    SourceEvent,
};
use prctr_os::RawSession;
use prctr_protocol::facts::{Certainty, Envelope, Health, Permission};
use prctr_protocol::rules::{
    Compare, CompareOp, Condition, Mode, Rule, RulePhase, RuleValue, Scalar,
};
use prctr_protocol::scalars::{Count, Identifier};
use schemars::JsonSchema;
use serde::Serialize;

pub const CAPABILITY: &str = "interactive_session";
pub const POLL_INTERVAL: Duration = Duration::from_secs(1);
pub const STABILITY_MS: u64 = 2_000;
pub const REASON_SESSION: &str = "interactive_session.single_session_required";
const MAX_SESSIONS: u64 = 1_024;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum Coverage {
    FullLifecycle,
    SnapshotOnly,
    Unavailable,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum ConsoleOwner {
    Candidate,
    OtherHuman,
    None,
    Unknown,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum Lock {
    Unlocked,
    Locked,
    Unknown,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum RemoteAttachment {
    Absent,
    Present,
    Unknown,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct InteractiveSessionState {
    pub coverage: Coverage,
    pub console_owner: ConsoleOwner,
    pub lock: Lock,
    pub remote_attachment: RemoteAttachment,
    /// `None` when the platform cannot count other sessions.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub other_human_sessions: Option<u64>,
}

impl ConsoleOwner {
    const fn text(self) -> &'static str {
        match self {
            Self::Candidate => "candidate",
            Self::OtherHuman => "other_human",
            Self::None => "none",
            Self::Unknown => "unknown",
        }
    }
}

impl Lock {
    const fn text(self) -> &'static str {
        match self {
            Self::Unlocked => "unlocked",
            Self::Locked => "locked",
            Self::Unknown => "unknown",
        }
    }
}

impl RemoteAttachment {
    const fn text(self) -> &'static str {
        match self {
            Self::Absent => "absent",
            Self::Present => "present",
            Self::Unknown => "unknown",
        }
    }
}

/// The facts for one raw session read. Unprivileged reads are always `snapshot_only` and partial.
#[must_use]
pub fn classify(raw: RawSession) -> Observation {
    let state = InteractiveSessionState {
        coverage: Coverage::SnapshotOnly,
        console_owner: match raw.on_console {
            Some(true) => ConsoleOwner::Candidate,
            // Another session holds the console, or none does; without the privileged component the
            // two cannot be told apart.
            Some(false) => ConsoleOwner::OtherHuman,
            None => ConsoleOwner::Unknown,
        },
        lock: match raw.locked {
            Some(true) => Lock::Locked,
            Some(false) => Lock::Unlocked,
            None => Lock::Unknown,
        },
        remote_attachment: match raw.remote {
            Some(true) => RemoteAttachment::Present,
            Some(false) => RemoteAttachment::Absent,
            None => RemoteAttachment::Unknown,
        },
        other_human_sessions: raw
            .other_human_sessions
            .map(|count| count.min(MAX_SESSIONS)),
    };
    let symbol = |name: &str, value: &str| (id(name), FieldValue::Symbol(id(value)));
    let mut fields: std::collections::BTreeMap<Identifier, FieldValue> = [
        symbol(
            "interactive_session.console_owner",
            state.console_owner.text(),
        ),
        symbol("interactive_session.lock", state.lock.text()),
        symbol(
            "interactive_session.remote_attachment",
            state.remote_attachment.text(),
        ),
    ]
    .into_iter()
    .collect();
    if let Some(count) = state.other_human_sessions {
        fields.insert(
            id("interactive_session.other_human_sessions"),
            FieldValue::Number(count),
        );
    }
    Observation {
        envelope: Envelope {
            permission: Permission::Granted,
            health: Health::Degraded,
            certainty: Certainty::Partial,
        },
        state: serde_json::to_value(state).unwrap_or_default(),
        summary: serde_json::json!({}),
        fields,
        apps: None,
        changes: Vec::new(),
    }
}

fn id(text: &str) -> Identifier {
    Identifier::new(text).expect("interactive session identifier is valid")
}

#[must_use]
pub fn descriptor() -> CapabilityDescriptor {
    let symbol = |name: &str, values: &[&str]| FieldSpec {
        name: id(name),
        kind: FieldKind::Symbol {
            values: values.iter().map(|value| id(value)).collect(),
        },
    };
    CapabilityDescriptor {
        id: id(CAPABILITY),
        sensitive: true,
        stability_ms: STABILITY_MS,
        categories: Vec::new(),
        fields: vec![
            symbol(
                "interactive_session.console_owner",
                &["candidate", "other_human", "none", "unknown"],
            ),
            symbol(
                "interactive_session.lock",
                &["unlocked", "locked", "unknown"],
            ),
            symbol(
                "interactive_session.remote_attachment",
                &["absent", "present", "unknown"],
            ),
            FieldSpec {
                name: id("interactive_session.other_human_sessions"),
                kind: FieldKind::Count { max: MAX_SESSIONS },
            },
        ],
        reasons: vec![id(REASON_SESSION)],
        app_conditions: false,
        permission_prompt: false,
    }
}

/// `baseline.session`: the candidate owns the console, unlocked, with no remote attachment and no
/// other human session. Unknown until full coverage exists.
///
/// # Panics
/// Never: every identifier and count in it is a valid constant.
#[must_use]
pub fn baseline_rule() -> Rule {
    let symbol = |field: &str, value: &str| {
        Condition::Compare(Compare {
            field: id(field),
            op: CompareOp::Eq,
            value: RuleValue::One(Scalar::Symbol(id(value))),
        })
    };
    Rule {
        rule_id: id("baseline.session"),
        capability: id(CAPABILITY),
        mode: Mode::Enforce,
        phase: RulePhase::Both,
        reason: id(REASON_SESSION),
        requirement: Condition::All {
            conditions: vec![
                symbol("interactive_session.console_owner", "candidate"),
                symbol("interactive_session.lock", "unlocked"),
                symbol("interactive_session.remote_attachment", "absent"),
                Condition::Compare(Compare {
                    field: id("interactive_session.other_human_sessions"),
                    op: CompareOp::Eq,
                    value: RuleValue::One(Scalar::Number(Count::ZERO)),
                }),
            ],
        },
    }
}

/// The platform read this build uses.
fn read() -> RawSession {
    #[cfg(target_os = "macos")]
    return prctr_os::macos::session();
    #[cfg(target_os = "windows")]
    return prctr_os::windows::session();
    #[cfg(target_os = "linux")]
    return prctr_os::linux::session();
    #[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
    RawSession::default()
}

struct Poller {
    stop: Arc<AtomicBool>,
    thread: JoinHandle<()>,
}

/// The interactive session source: reconciles the session state every [`POLL_INTERVAL`].
pub struct InteractiveSessionSource {
    read: fn() -> RawSession,
    poller: Option<Poller>,
}

impl InteractiveSessionSource {
    #[must_use]
    pub fn new() -> Self {
        Self { read, poller: None }
    }
}

impl Default for InteractiveSessionSource {
    fn default() -> Self {
        Self::new()
    }
}

impl Source for InteractiveSessionSource {
    fn descriptor(&self) -> CapabilityDescriptor {
        descriptor()
    }

    fn start(&mut self, sink: Sink) -> Result<Observation, SourceError> {
        self.stop();
        let stop = Arc::new(AtomicBool::new(false));
        let thread_stop = Arc::clone(&stop);
        let read = self.read;
        let mut last = read();
        let thread = thread::Builder::new()
            .name("prctr-session".to_owned())
            .spawn(move || {
                while !thread_stop.load(Ordering::Acquire) {
                    thread::park_timeout(POLL_INTERVAL);
                    if thread_stop.load(Ordering::Acquire) {
                        return;
                    }
                    let now = read();
                    if now != last {
                        last = now;
                        sink(SourceEvent::Changed);
                    }
                }
            })
            .map_err(|_| SourceError {
                reason: "cannot start the session poller",
            })?;
        self.poller = Some(Poller { stop, thread });
        Ok(self.current())
    }

    fn current(&mut self) -> Observation {
        classify((self.read)())
    }

    fn stop(&mut self) {
        if let Some(poller) = self.poller.take() {
            poller.stop.store(true, Ordering::Release);
            poller.thread.thread().unpark();
            let _ = poller.thread.join();
        }
    }
}

impl Drop for InteractiveSessionSource {
    fn drop(&mut self) {
        self.stop();
    }
}

#[cfg(test)]
mod tests {
    use prctr_core::{Engine, InitialState, Registry, ValidPolicy};
    use prctr_protocol::rules::{Activation, Policy, Status, UnknownCause};
    use prctr_protocol::scalars::OpaqueId;

    use super::*;

    fn alone() -> RawSession {
        RawSession {
            on_console: Some(true),
            locked: Some(false),
            remote: Some(false),
            other_human_sessions: Some(0),
        }
    }

    fn policy() -> Policy {
        Policy {
            activations: vec![Activation {
                capability: id(CAPABILITY),
                categories: Vec::new(),
            }],
            rules: vec![baseline_rule()],
        }
    }

    fn baseline(raw: RawSession) -> (Status, Option<UnknownCause>) {
        let mut engine = Engine::new(Registry {
            capabilities: vec![descriptor()],
            baseline_rules: vec![baseline_rule()],
        });
        let (_, statuses) = engine
            .open_readiness(
                policy(),
                vec![InitialState {
                    capability: id(CAPABILITY),
                    source_instance_id: OpaqueId::new("session00001").expect("valid"),
                    observation: classify(raw),
                }],
                0,
            )
            .expect("baseline policy is valid");
        (statuses[0].status, statuses[0].unknown_cause)
    }

    #[test]
    fn a_snapshot_never_meets_the_session_baseline_without_full_coverage() {
        assert_eq!(
            baseline(alone()),
            (Status::Unknown, Some(UnknownCause::Partial))
        );
        assert_eq!(classify(alone()).state["coverage"], "snapshot_only");
    }

    #[test]
    fn each_platform_unknown_is_reported_as_unknown_not_guessed() {
        let observation = classify(RawSession::default());
        assert_eq!(observation.state["console_owner"], "unknown");
        assert_eq!(observation.state["lock"], "unknown");
        assert_eq!(observation.state["remote_attachment"], "unknown");
        assert!(observation.state.get("other_human_sessions").is_none());
        assert!(
            !observation
                .fields
                .contains_key(&id("interactive_session.other_human_sessions")),
            "a missing count is an unavailable field, never zero"
        );
    }

    #[test]
    fn a_lock_a_remote_session_and_another_user_are_each_reported() {
        let observation = classify(RawSession {
            on_console: Some(false),
            locked: Some(true),
            remote: Some(true),
            other_human_sessions: Some(2),
        });
        assert_eq!(observation.state["console_owner"], "other_human");
        assert_eq!(observation.state["lock"], "locked");
        assert_eq!(observation.state["remote_attachment"], "present");
        assert_eq!(observation.state["other_human_sessions"], 2);
    }

    #[test]
    fn the_baseline_rule_only_uses_registered_fields_and_values() {
        let registry = Registry {
            capabilities: vec![descriptor()],
            baseline_rules: vec![baseline_rule()],
        };
        assert!(ValidPolicy::new(policy(), &registry).is_ok());
    }

    #[test]
    fn interactive_session_passes_the_core_conformance_suite() {
        let mut locked = alone();
        locked.locked = Some(true);
        prctr_core::testing::assert_capability_conformance(
            &descriptor(),
            &classify(alone()),
            &classify(locked),
        );
    }

    /// Real OS: the session of the process running the tests is readable and consistent.
    #[cfg(target_os = "macos")]
    #[test]
    fn macos_reads_this_users_session() {
        let raw = prctr_os::macos::session();
        assert!(raw.on_console.is_some(), "the window server answered");
        assert_eq!(
            raw.locked,
            Some(false),
            "the screen running the tests is unlocked"
        );
        assert!(raw.other_human_sessions.is_some(), "utmpx was read");
        assert_eq!(read(), read(), "two consecutive reads agree");
    }
}
