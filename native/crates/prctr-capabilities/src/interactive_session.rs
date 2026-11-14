//! The candidate's interactive OS session, polled from the unprivileged per-platform sources every
//! [`POLL_INTERVAL`]. A field the platform reports is complete; a field it cannot see is left out
//! of the rule fields, so a rule naming it is unknown rather than guessed.
//! Contract: `docs/architecture/native-capability-families.md`, "Interactive session".

use std::time::Duration;

use prctr_core::{
    CapabilityDescriptor, FieldKind, FieldSpec, FieldValue, Observation, Sink, Source, SourceError,
};
use prctr_os::RawSession;
use prctr_protocol::facts::{Certainty, Envelope, Health, Permission};
use prctr_protocol::rules::{
    Compare, CompareOp, Condition, Mode, Rule, RulePhase, RuleValue, Scalar,
};
use prctr_protocol::scalars::{Count, Identifier};
use schemars::JsonSchema;
use serde::Serialize;

use crate::poller::Poller;

pub const CAPABILITY: &str = "interactive_session";
pub const POLL_INTERVAL: Duration = Duration::from_secs(1);
pub const STABILITY_MS: u64 = 2_000;
pub const REASON_SESSION: &str = "interactive_session.single_session_required";
const MAX_SESSIONS: u64 = 1_024;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum Coverage {
    /// Read every [`POLL_INTERVAL`]: a change shorter than one interval can go unseen.
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
    /// `unknown` where the platform cannot see remote attachment unprivileged (macOS screen
    /// sharing).
    pub remote_attachment: RemoteAttachment,
    /// `None` when the platform cannot count other sessions.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub other_human_sessions: Option<u64>,
}

impl ConsoleOwner {
    const fn known(self) -> Option<&'static str> {
        match self {
            Self::Candidate => Some("candidate"),
            Self::OtherHuman => Some("other_human"),
            Self::None => Some("none"),
            Self::Unknown => None,
        }
    }
}

impl Lock {
    const fn known(self) -> Option<&'static str> {
        match self {
            Self::Unlocked => Some("unlocked"),
            Self::Locked => Some("locked"),
            Self::Unknown => None,
        }
    }
}

impl RemoteAttachment {
    const fn known(self) -> Option<&'static str> {
        match self {
            Self::Absent => Some("absent"),
            Self::Present => Some("present"),
            Self::Unknown => None,
        }
    }
}

/// The facts for one session read. What the platform reports is complete; what it cannot see is
/// absent from the rule fields. A read that reports nothing is unavailable.
#[must_use]
pub fn classify(raw: RawSession) -> Observation {
    let state = InteractiveSessionState {
        coverage: if raw == RawSession::default() {
            Coverage::Unavailable
        } else {
            Coverage::SnapshotOnly
        },
        console_owner: match raw.on_console {
            Some(true) => ConsoleOwner::Candidate,
            // Another session holds the console.
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
    let envelope = if state.coverage == Coverage::Unavailable {
        Envelope {
            permission: Permission::Granted,
            health: Health::Unsupported,
            certainty: Certainty::Unknown,
        }
    } else {
        Envelope {
            permission: Permission::Granted,
            health: Health::Healthy,
            certainty: Certainty::Complete,
        }
    };
    observe(&state, envelope)
}

fn observe(state: &InteractiveSessionState, envelope: Envelope) -> Observation {
    let mut fields: std::collections::BTreeMap<Identifier, FieldValue> =
        std::collections::BTreeMap::new();
    let mut symbol = |name: &str, value: Option<&str>| {
        if let Some(value) = value {
            fields.insert(id(name), FieldValue::Symbol(id(value)));
        }
    };
    symbol(
        "interactive_session.console_owner",
        state.console_owner.known(),
    );
    symbol("interactive_session.lock", state.lock.known());
    symbol(
        "interactive_session.remote_attachment",
        state.remote_attachment.known(),
    );
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

/// `baseline.session`: the candidate owns the console, unlocked, with no other human session.
/// These are the fields every supported platform reports unprivileged. Remote attachment is not
/// part of the baseline, because macOS cannot see screen sharing unprivileged; an exam that needs
/// it adds its own rule on `interactive_session.remote_attachment`.
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
}

/// The interactive session source: reconciles the session state every [`POLL_INTERVAL`].
pub struct InteractiveSessionSource {
    poller: Option<Poller>,
}

impl InteractiveSessionSource {
    #[must_use]
    pub fn new() -> Self {
        Self { poller: None }
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
        classify(read())
    }

    fn stop(&mut self) {
        if let Some(poller) = self.poller.take() {
            poller.stop();
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

    fn policy(rules: Vec<Rule>) -> Policy {
        Policy {
            activations: vec![Activation {
                capability: id(CAPABILITY),
                categories: Vec::new(),
            }],
            rules,
        }
    }

    fn evaluate(rule: Rule, raw: RawSession) -> (Status, Option<UnknownCause>) {
        let mut engine = Engine::new(Registry {
            capabilities: vec![descriptor()],
            baseline_rules: vec![baseline_rule()],
            applications: Vec::new(),
        });
        // The engine requires every policy to carry the registry's baseline rules. A rule under
        // test that is the baseline itself is not added twice; its status is read from index 0.
        let rule_id = rule.rule_id.clone();
        let mut rules = vec![baseline_rule()];
        if rule_id != baseline_rule().rule_id {
            rules.push(rule);
        }
        let index = rules
            .iter()
            .position(|candidate| candidate.rule_id == rule_id)
            .expect("the rule under test is in the policy");
        let (_, statuses) = engine
            .open_readiness(
                policy(rules),
                vec![InitialState {
                    capability: id(CAPABILITY),
                    source_instance_id: OpaqueId::new("session00001").expect("valid"),
                    observation: classify(raw),
                }],
                0,
            )
            .expect("policy is valid");
        (statuses[index].status, statuses[index].unknown_cause)
    }

    fn baseline(raw: RawSession) -> (Status, Option<UnknownCause>) {
        evaluate(baseline_rule(), raw)
    }

    /// An exam's own rule on remote attachment.
    fn no_remote() -> Rule {
        Rule {
            rule_id: id("session.no_remote"),
            capability: id(CAPABILITY),
            mode: Mode::Enforce,
            phase: RulePhase::Both,
            reason: id(REASON_SESSION),
            requirement: Condition::Compare(Compare {
                field: id("interactive_session.remote_attachment"),
                op: CompareOp::Eq,
                value: RuleValue::One(Scalar::Symbol(id("absent"))),
            }),
        }
    }

    #[test]
    fn a_lone_unlocked_candidate_meets_the_session_baseline() {
        assert_eq!(baseline(alone()), (Status::Met, None));
        let observation = classify(alone());
        assert_eq!(observation.state["coverage"], "snapshot_only");
        assert_eq!(observation.envelope.certainty, Certainty::Complete);
    }

    #[test]
    fn a_lock_another_session_or_another_console_owner_breaks_the_baseline() {
        let mut locked = alone();
        locked.locked = Some(true);
        assert_eq!(baseline(locked).0, Status::NotMet);
        let mut other = alone();
        other.other_human_sessions = Some(1);
        assert_eq!(baseline(other).0, Status::NotMet);
        let mut away = alone();
        away.on_console = Some(false);
        assert_eq!(baseline(away).0, Status::NotMet);
    }

    #[test]
    fn unseen_remote_attachment_leaves_the_baseline_met_and_its_own_rule_unknown() {
        let mut macos = alone();
        macos.remote = None;
        assert_eq!(baseline(macos).0, Status::Met);
        assert_eq!(
            evaluate(no_remote(), macos),
            (Status::Unknown, Some(UnknownCause::Unavailable))
        );
        assert_eq!(classify(macos).state["remote_attachment"], "unknown");
        let mut remote = alone();
        remote.remote = Some(true);
        assert_eq!(evaluate(no_remote(), remote).0, Status::NotMet);
    }

    #[test]
    fn each_platform_unknown_is_left_out_of_the_rule_fields_not_guessed() {
        let mut partial = alone();
        partial.locked = None;
        partial.other_human_sessions = None;
        let observation = classify(partial);
        assert_eq!(observation.state["lock"], "unknown");
        assert!(observation.state.get("other_human_sessions").is_none());
        assert!(
            !observation
                .fields
                .contains_key(&id("interactive_session.lock"))
        );
        assert!(
            !observation
                .fields
                .contains_key(&id("interactive_session.other_human_sessions")),
            "a missing count is an unavailable field, never zero"
        );
        assert_eq!(
            baseline(partial),
            (Status::Unknown, Some(UnknownCause::Unavailable))
        );
    }

    #[test]
    fn a_read_that_reports_nothing_is_unavailable() {
        let observation = classify(RawSession::default());
        assert_eq!(observation.state["coverage"], "unavailable");
        assert_eq!(observation.envelope.health, Health::Unsupported);
        assert_eq!(baseline(RawSession::default()).0, Status::Unknown);
    }

    #[test]
    fn the_baseline_rule_only_uses_registered_fields_and_values() {
        let registry = Registry {
            capabilities: vec![descriptor()],
            baseline_rules: vec![baseline_rule()],
            applications: Vec::new(),
        };
        assert!(ValidPolicy::new(policy(vec![baseline_rule()]), &registry).is_ok());
        assert!(ValidPolicy::new(policy(vec![baseline_rule(), no_remote()]), &registry).is_ok());
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
        // The console owner and other-session fields depend on the machine, so the baseline's
        // status is not asserted here; the unit tests above cover its logic.
    }
}
