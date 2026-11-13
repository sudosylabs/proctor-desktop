//! The candidate's interactive OS session. With the privileged helper it sees every session, lock
//! and remote attachment (full coverage); without a helper on this platform it reads the
//! unprivileged per-platform sources and reports `snapshot_only` coverage with partial certainty.
//! Contract: `docs/architecture/native-capability-families.md`, "Interactive session".

use std::sync::Arc;
use std::time::Duration;

use prctr_core::{
    CapabilityDescriptor, FieldKind, FieldSpec, FieldValue, Observation, Sink, Source, SourceError,
    SourceEvent,
};
use prctr_os::RawSession;
use prctr_protocol::facts::{Certainty, Envelope, Health, Permission};
use prctr_protocol::helper::{HelperSessions, SessionState};
use prctr_protocol::rules::{
    Compare, CompareOp, Condition, Mode, Rule, RulePhase, RuleValue, Scalar,
};
use prctr_protocol::scalars::{Count, Identifier};
use schemars::JsonSchema;
use serde::Serialize;

use crate::helper::{ComponentStatus, HelperChange, HelperClient};
use crate::poller::Poller;

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
    /// The privileged component this capability needs on Windows and macOS.
    pub component: ComponentStatus,
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
        component: ComponentStatus::Unsupported,
    };
    observe(
        &state,
        Envelope {
            permission: Permission::Granted,
            health: Health::Degraded,
            certainty: Certainty::Partial,
        },
    )
}

/// The facts from the privileged helper's report: every session is seen, so certainty is complete.
#[must_use]
pub fn classify_helper(report: &HelperSessions) -> Observation {
    let own = report
        .sessions
        .iter()
        .find(|session| session.id == report.own);
    let console_owner = match report.console {
        Some(console) if console == report.own => ConsoleOwner::Candidate,
        Some(console) => {
            let human = report
                .sessions
                .iter()
                .any(|session| session.id == console && session.has_user);
            if human {
                ConsoleOwner::OtherHuman
            } else {
                ConsoleOwner::None
            }
        }
        None => ConsoleOwner::None,
    };
    let lock = match own.and_then(|session| session.locked) {
        Some(true) => Lock::Locked,
        Some(false) => Lock::Unlocked,
        None => Lock::Unknown,
    };
    let remote_attachment = match own {
        Some(session) if session.remote => RemoteAttachment::Present,
        Some(_) => RemoteAttachment::Absent,
        None => RemoteAttachment::Unknown,
    };
    let others = report
        .sessions
        .iter()
        .filter(|session| {
            session.id != report.own && session.has_user && session.state != SessionState::Other
        })
        .count();
    let state = InteractiveSessionState {
        coverage: Coverage::FullLifecycle,
        console_owner,
        lock,
        remote_attachment,
        other_human_sessions: Some(
            u64::try_from(others)
                .unwrap_or(MAX_SESSIONS)
                .min(MAX_SESSIONS),
        ),
        component: ComponentStatus::Running,
    };
    observe(
        &state,
        Envelope {
            permission: Permission::Granted,
            health: Health::Healthy,
            certainty: Certainty::Complete,
        },
    )
}

/// The facts when the privileged component is needed but not serving.
#[must_use]
pub fn unavailable(component: ComponentStatus) -> Observation {
    let state = InteractiveSessionState {
        coverage: Coverage::Unavailable,
        console_owner: ConsoleOwner::Unknown,
        lock: Lock::Unknown,
        remote_attachment: RemoteAttachment::Unknown,
        other_human_sessions: None,
        component,
    };
    observe(
        &state,
        Envelope {
            permission: component.permission(),
            health: if component.expected_running() {
                Health::Failed
            } else {
                Health::Unsupported
            },
            certainty: Certainty::Unknown,
        },
    )
}

fn observe(state: &InteractiveSessionState, envelope: Envelope) -> Observation {
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
        envelope,
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

/// How often a disconnected helper is retried while the capability runs.
const RECONNECT: Duration = Duration::from_secs(2);

/// The interactive session source. With the privileged helper it follows the helper's session
/// reports; without one it reconciles the unprivileged read every [`POLL_INTERVAL`].
pub struct InteractiveSessionSource {
    read: fn() -> RawSession,
    poller: Option<Poller>,
    helper: Option<Arc<HelperClient>>,
    listening: Option<u64>,
}

impl InteractiveSessionSource {
    #[must_use]
    pub fn new() -> Self {
        Self::with_helper(None)
    }

    /// A source that reads the privileged helper when `helper` is set.
    #[must_use]
    pub fn with_helper(helper: Option<Arc<HelperClient>>) -> Self {
        Self {
            read,
            poller: None,
            helper,
            listening: None,
        }
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

    fn start(
        &mut self,
        _categories: &[Identifier],
        sink: Sink,
    ) -> Result<Observation, SourceError> {
        self.stop();
        if let Some(helper) = self.helper.clone() {
            let wake = Arc::clone(&sink);
            self.listening = Some(helper.listen(move |change| {
                if matches!(change, HelperChange::Sessions | HelperChange::Disconnected) {
                    wake(SourceEvent::Changed);
                }
            }));
            let first = helper.want(None, Some(true));
            let retry = Arc::clone(&helper);
            self.poller = Some(Poller::start(
                "prctr-session-helper",
                RECONNECT,
                first,
                move || retry.view().connected || retry.want(None, Some(true)),
                sink,
            )?);
            return Ok(self.current());
        }
        let read = self.read;
        self.poller = Some(Poller::start(
            "prctr-session",
            POLL_INTERVAL,
            read(),
            read,
            sink,
        )?);
        Ok(self.current())
    }

    fn current(&mut self) -> Observation {
        let Some(helper) = self.helper.as_ref() else {
            return classify((self.read)());
        };
        let view = helper.view();
        match view.sessions.as_ref() {
            Some(report) if view.connected => classify_helper(report),
            _ if view.connected => unavailable(ComponentStatus::Running),
            _ => unavailable(helper.status()),
        }
    }

    fn stop(&mut self) {
        if let Some(poller) = self.poller.take() {
            poller.stop();
        }
        if let (Some(helper), Some(key)) = (self.helper.as_ref(), self.listening.take()) {
            helper.unlisten(key);
            let _ = helper.want(None, Some(false));
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
            applications: Vec::new(),
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
            applications: Vec::new(),
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

    fn report(
        console: Option<u64>,
        sessions: &[(u64, bool, bool, Option<bool>)],
    ) -> HelperSessions {
        use prctr_protocol::helper::HelperSession;
        let count = |value: u64| Count::new(value).expect("small");
        HelperSessions {
            console: console.map(count),
            own: count(1),
            sessions: sessions
                .iter()
                .map(|(id, has_user, remote, locked)| HelperSession {
                    id: count(*id),
                    state: SessionState::Active,
                    has_user: *has_user,
                    remote: *remote,
                    locked: *locked,
                })
                .collect(),
        }
    }

    fn baseline_of(observation: Observation) -> (Status, Option<UnknownCause>) {
        let mut engine = Engine::new(Registry {
            capabilities: vec![descriptor()],
            baseline_rules: vec![baseline_rule()],
            applications: Vec::new(),
        });
        let (_, statuses) = engine
            .open_readiness(
                policy(),
                vec![InitialState {
                    capability: id(CAPABILITY),
                    source_instance_id: OpaqueId::new("session00001").expect("valid"),
                    observation,
                }],
                0,
            )
            .expect("baseline policy is valid");
        (statuses[0].status, statuses[0].unknown_cause)
    }

    #[test]
    fn the_helpers_full_report_meets_the_session_baseline_when_alone() {
        let alone = classify_helper(&report(Some(1), &[(1, true, false, Some(false))]));
        assert_eq!(alone.state["coverage"], "full_lifecycle");
        assert_eq!(baseline_of(alone), (Status::Met, None));
    }

    #[test]
    fn another_person_on_the_console_a_remote_session_or_a_second_login_breaks_the_baseline() {
        let other_console = classify_helper(&report(
            Some(2),
            &[(1, true, false, Some(false)), (2, true, false, Some(false))],
        ));
        assert_eq!(other_console.state["console_owner"], "other_human");
        assert_eq!(other_console.state["other_human_sessions"], 1);
        assert_eq!(baseline_of(other_console).0, Status::NotMet);
        let remote = classify_helper(&report(None, &[(1, true, true, Some(false))]));
        assert_eq!(remote.state["remote_attachment"], "present");
        assert_eq!(remote.state["console_owner"], "none");
        assert_eq!(baseline_of(remote).0, Status::NotMet);
    }

    #[test]
    fn a_missing_component_leaves_the_baseline_unknown() {
        let missing = unavailable(ComponentStatus::NotInstalled);
        assert_eq!(missing.state["component"], "not_installed");
        assert_eq!(missing.envelope.permission, Permission::Unavailable);
        assert_eq!(baseline_of(missing).0, Status::Unknown);
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
