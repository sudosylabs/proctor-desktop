//! The session engine: one readiness → participation session at a time. Deterministic: every
//! input carries its own monotonic time, and fresh instance identities come from the caller.

use std::collections::BTreeMap;
use std::fmt;

use prctr_protocol::facts::{Fact, FactRef, Gap, GapReason, InterruptionKind, Reset};
use prctr_protocol::messages::Notification;
use prctr_protocol::rules::{LocalEffect, Mode, Policy, Rule, RuleStatus, Status, UnknownCause};
use prctr_protocol::scalars::{Count, Identifier, OpaqueId};

use crate::evaluate::{Outcome, View, evaluate};
use crate::observation::Observation;
use crate::policy::{PolicyError, ValidPolicy};
use crate::registry::Registry;

/// Above this many unacknowledged notifications, ordinary facts are withheld and only the newest
/// state per capability is kept. Rules, gaps, resets and interruptions always pass.
pub const MAX_UNACKNOWLEDGED: u64 = 256;

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum CoreError {
    /// The request does not fit the current session phase.
    WrongPhase,
    InvalidPolicy(PolicyError),
    /// The capability is not activated in this session.
    UnknownCapability(Identifier),
    /// The initial states do not match the activations exactly.
    InitialStatesMismatch,
    /// A capability has not delivered a fresh complete state since a gap or interruption.
    NotReady(Identifier),
}

impl fmt::Display for CoreError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(formatter, "{self:?}")
    }
}

impl std::error::Error for CoreError {}

/// One capability's first state when a session opens.
#[derive(Clone, Debug)]
pub struct InitialState {
    pub capability: Identifier,
    pub source_instance_id: OpaqueId,
    pub observation: Observation,
}

/// Something that happened while a session is open.
#[derive(Clone, Debug)]
pub enum Input {
    /// A complete state from a capability.
    Observed {
        capability: Identifier,
        observation: Observation,
        at_ms: u64,
    },
    /// The adapter lost this many events.
    EventsLost {
        capability: Identifier,
        count: u64,
        at_ms: u64,
    },
    /// The capability restarted under a new instance, with its first state.
    Restarted {
        capability: Identifier,
        source_instance_id: OpaqueId,
        observation: Observation,
        at_ms: u64,
    },
    /// Sleep, screen lock or user switch: every capability needs a fresh complete state.
    Interrupted { kind: InterruptionKind, at_ms: u64 },
    /// Time passed; lets rules finish their recovery stability wait.
    Tick { at_ms: u64 },
    /// Electron main received every notification up to this message number.
    Acknowledged { up_to: u64 },
}

/// A notification with its connection-wide message number.
#[derive(Clone, Debug, PartialEq)]
pub struct Numbered {
    pub message_number: Count,
    pub notification: Notification,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Phase {
    Readiness,
    /// After `begin_participation`, before the server's answer.
    Binding,
    Participation,
}

struct Stream {
    instance: OpaqueId,
    sequence: Count,
    observation: Observation,
    captured_at_ms: u64,
    gap: bool,
    /// The first withheld sequence, while flow control holds facts back.
    withheld_from: Option<Count>,
}

struct Tracker {
    rule: usize,
    reported: Option<(Status, Option<UnknownCause>)>,
    met_since: Option<u64>,
}

struct Session {
    policy: ValidPolicy,
    phase: Phase,
    streams: BTreeMap<Identifier, Stream>,
    trackers: Vec<Tracker>,
    contained: bool,
}

/// The engine. Create one per agent; it holds at most one session.
pub struct Engine {
    registry: Registry,
    session: Option<Session>,
    last_message: u64,
    acknowledged: u64,
}

impl Engine {
    #[must_use]
    pub const fn new(registry: Registry) -> Self {
        Self {
            registry,
            session: None,
            last_message: 0,
            acknowledged: 0,
        }
    }

    #[must_use]
    pub const fn registry(&self) -> &Registry {
        &self.registry
    }

    #[must_use]
    pub const fn is_open(&self) -> bool {
        self.session.is_some()
    }

    /// The capabilities the open session activated; empty when no session is open.
    #[must_use]
    pub fn activated(&self) -> Vec<Identifier> {
        self.session.as_ref().map_or_else(Vec::new, |session| {
            session
                .policy
                .activations()
                .iter()
                .map(|activation| activation.capability.clone())
                .collect()
        })
    }

    /// The rules with application conditions, for the process capability's on-device matcher.
    #[must_use]
    pub fn app_rules(&self) -> Vec<Rule> {
        self.session.as_ref().map_or_else(Vec::new, |session| {
            session
                .policy
                .rules()
                .iter()
                .filter(|rule| contains_app_condition(&rule.requirement))
                .cloned()
                .collect()
        })
    }

    /// Opens the readiness session with one initial state per activation, each at sequence 0.
    /// The first evaluation of every readiness rule sets its status directly.
    ///
    /// # Errors
    /// Refuses an invalid policy, initial states that do not match the activations, or a second
    /// session.
    pub fn open_readiness(
        &mut self,
        policy: Policy,
        initial: Vec<InitialState>,
        at_ms: u64,
    ) -> Result<(Vec<Fact>, Vec<RuleStatus>), CoreError> {
        if self.session.is_some() {
            return Err(CoreError::WrongPhase);
        }
        let policy = ValidPolicy::new(policy, &self.registry).map_err(CoreError::InvalidPolicy)?;
        let mut streams = BTreeMap::new();
        for state in initial {
            let known = policy
                .activations()
                .iter()
                .any(|activation| activation.capability == state.capability);
            if !known || streams.contains_key(&state.capability) {
                return Err(CoreError::InitialStatesMismatch);
            }
            streams.insert(
                state.capability,
                Stream {
                    instance: state.source_instance_id,
                    sequence: Count::ZERO,
                    observation: state.observation,
                    captured_at_ms: at_ms,
                    gap: false,
                    withheld_from: None,
                },
            );
        }
        if streams.len() != policy.activations().len() {
            return Err(CoreError::InitialStatesMismatch);
        }
        let mut session = Session {
            policy,
            phase: Phase::Readiness,
            streams,
            trackers: Vec::new(),
            contained: false,
        };
        session.select_trackers();
        let statuses = session.evaluate_all(&self.registry, at_ms);
        let facts = session.facts();
        self.session = Some(session);
        Ok((facts, statuses))
    }

    /// Applies one input and returns the notifications it produces, numbered.
    ///
    /// # Errors
    /// Refuses input for a capability outside the session, or any input without a session
    /// (except acknowledgements).
    pub fn handle(&mut self, input: Input) -> Result<Vec<Numbered>, CoreError> {
        if let Input::Acknowledged { up_to } = input {
            self.acknowledged = self.acknowledged.max(up_to.min(self.last_message));
            return Ok(self.release_withheld());
        }
        let registry = &self.registry;
        let session = self.session.as_mut().ok_or(CoreError::WrongPhase)?;
        let mut out: Vec<Notification> = Vec::new();
        let mut facts: Vec<(Identifier, Fact)> = Vec::new();
        let at_ms = match input {
            Input::Observed {
                capability,
                observation,
                at_ms,
            } => {
                let stream = session.stream_mut(&capability)?;
                let changed = stream.gap || !stream.observation.same_state(&observation);
                if changed {
                    stream.sequence = stream.sequence.next();
                    stream.observation = observation;
                    stream.captured_at_ms = at_ms;
                    stream.gap = false;
                    facts.push((capability.clone(), stream.fact(&capability)));
                }
                at_ms
            }
            Input::EventsLost {
                capability,
                count,
                at_ms,
            } => {
                let stream = session.stream_mut(&capability)?;
                if count > 0 {
                    let first = stream.sequence.next();
                    stream.sequence = stream.sequence.saturating_add(count);
                    stream.gap = true;
                    out.push(Notification::Gap {
                        gap: Gap {
                            capability: capability.clone(),
                            source_instance_id: stream.instance.clone(),
                            first_sequence: first,
                            last_sequence: stream.sequence,
                            reason: GapReason::SourceLoss,
                        },
                    });
                }
                at_ms
            }
            Input::Restarted {
                capability,
                source_instance_id,
                observation,
                at_ms,
            } => {
                let stream = session.stream_mut(&capability)?;
                out.push(Notification::Reset {
                    reset: Reset {
                        capability: capability.clone(),
                        previous_source_instance_id: stream.instance.clone(),
                        previous_sequence: stream.sequence,
                        source_instance_id: source_instance_id.clone(),
                    },
                });
                stream.instance = source_instance_id;
                stream.sequence = Count::ZERO;
                stream.observation = observation;
                stream.captured_at_ms = at_ms;
                stream.gap = false;
                stream.withheld_from = None;
                facts.push((capability.clone(), stream.fact(&capability)));
                at_ms
            }
            Input::Interrupted { kind, at_ms } => {
                for stream in session.streams.values_mut() {
                    stream.gap = true;
                }
                out.push(Notification::Interruption { interruption: kind });
                at_ms
            }
            Input::Tick { at_ms } => at_ms,
            // Handled before the session lookup.
            Input::Acknowledged { .. } => return Ok(Vec::new()),
        };
        let statuses = session.evaluate_all(registry, at_ms);
        let mut numbered = Vec::new();
        for notification in out {
            numbered.push(self.number(notification));
        }
        for (capability, fact) in facts {
            if let Some(message) = self.emit_fact(&capability, fact) {
                numbered.push(message);
            }
        }
        if !statuses.is_empty() {
            numbered.push(self.number(Notification::Rules { statuses }));
        }
        Ok(numbered)
    }

    /// The binding check at Start: every capability must have a fresh complete state. Returns the
    /// current facts and the readiness rule statuses.
    ///
    /// # Errors
    /// Refuses outside readiness, or while a capability awaits a fresh state.
    pub fn begin_participation(&mut self) -> Result<(Vec<Fact>, Vec<RuleStatus>), CoreError> {
        let session = self.session.as_mut().ok_or(CoreError::WrongPhase)?;
        if session.phase != Phase::Readiness {
            return Err(CoreError::WrongPhase);
        }
        if let Some((capability, _)) = session.streams.iter().find(|(_, stream)| stream.gap) {
            return Err(CoreError::NotReady(capability.clone()));
        }
        session.phase = Phase::Binding;
        Ok((session.facts(), session.current_statuses()))
    }

    /// The server admitted the candidate. Participation rules start; containment applies from now.
    ///
    /// # Errors
    /// Refuses unless the binding check is in progress.
    pub fn confirm_participation(&mut self, at_ms: u64) -> Result<Vec<RuleStatus>, CoreError> {
        let registry = &self.registry;
        let session = self.session.as_mut().ok_or(CoreError::WrongPhase)?;
        if session.phase != Phase::Binding {
            return Err(CoreError::WrongPhase);
        }
        session.phase = Phase::Participation;
        session.select_trackers();
        session.evaluate_all(registry, at_ms);
        Ok(session.current_statuses())
    }

    /// Admission was refused or timed out: back to readiness, same session.
    ///
    /// # Errors
    /// Refuses unless the binding check is in progress.
    pub fn abandon_participation(&mut self) -> Result<Vec<RuleStatus>, CoreError> {
        let session = self.session.as_mut().ok_or(CoreError::WrongPhase)?;
        if session.phase != Phase::Binding {
            return Err(CoreError::WrongPhase);
        }
        session.phase = Phase::Readiness;
        Ok(session.current_statuses())
    }

    /// Ends the session and returns the final facts and statuses.
    ///
    /// # Errors
    /// Refuses without a session.
    pub fn close(&mut self) -> Result<(Vec<Fact>, Vec<RuleStatus>), CoreError> {
        let session = self.session.take().ok_or(CoreError::WrongPhase)?;
        Ok((session.facts(), session.current_statuses()))
    }

    /// The current status of every rule active in this phase.
    #[must_use]
    pub fn statuses(&self) -> Vec<RuleStatus> {
        self.session
            .as_ref()
            .map_or_else(Vec::new, Session::current_statuses)
    }

    /// Whether the candidate window is contained now.
    #[must_use]
    pub fn contained(&self) -> bool {
        self.session
            .as_ref()
            .is_some_and(|session| session.contained)
    }

    /// When the next recovery wait ends, so the caller can send a `Tick` then.
    #[must_use]
    pub fn next_deadline(&self) -> Option<u64> {
        let session = self.session.as_ref()?;
        session
            .trackers
            .iter()
            .filter_map(|tracker| {
                let since = tracker.met_since?;
                let rule = &session.policy.rules()[tracker.rule];
                let stability = self.registry.capability(&rule.capability)?.stability_ms;
                Some(since.saturating_add(stability))
            })
            .min()
    }

    /// Numbers a notification the agent itself originates (heartbeat, fatal), in the same sequence
    /// as the engine's own. These are never withheld by flow control.
    pub fn notify(&mut self, notification: Notification) -> Numbered {
        self.number(notification)
    }

    fn number(&mut self, notification: Notification) -> Numbered {
        self.last_message += 1;
        Numbered {
            message_number: Count::new(self.last_message).unwrap_or(Count::ZERO),
            notification,
        }
    }

    fn outstanding(&self) -> u64 {
        self.last_message - self.acknowledged
    }

    fn emit_fact(&mut self, capability: &Identifier, fact: Fact) -> Option<Numbered> {
        if self.outstanding() >= MAX_UNACKNOWLEDGED {
            if let Some(stream) = self
                .session
                .as_mut()
                .and_then(|session| session.streams.get_mut(capability))
            {
                stream.withheld_from.get_or_insert(fact.sequence);
            }
            return None;
        }
        Some(self.number(Notification::Fact { fact }))
    }

    fn release_withheld(&mut self) -> Vec<Numbered> {
        let mut released = Vec::new();
        let pending: Vec<(Identifier, Option<Gap>, Fact)> = match self.session.as_mut() {
            None => Vec::new(),
            Some(session) => session
                .streams
                .iter_mut()
                .filter_map(|(capability, stream)| {
                    let first = stream.withheld_from.take()?;
                    let gap = (first < stream.sequence).then(|| Gap {
                        capability: capability.clone(),
                        source_instance_id: stream.instance.clone(),
                        first_sequence: first,
                        last_sequence: Count::new(stream.sequence.get() - 1).unwrap_or(first),
                        reason: GapReason::FlowControl,
                    });
                    Some((capability.clone(), gap, stream.fact(capability)))
                })
                .collect(),
        };
        for (capability, gap, fact) in pending {
            if self.outstanding() >= MAX_UNACKNOWLEDGED {
                if let Some(stream) = self
                    .session
                    .as_mut()
                    .and_then(|session| session.streams.get_mut(&capability))
                {
                    let first = gap.as_ref().map_or(fact.sequence, |gap| gap.first_sequence);
                    stream.withheld_from = Some(first);
                }
                continue;
            }
            if let Some(gap) = gap {
                released.push(self.number(Notification::Gap { gap }));
            }
            released.push(self.number(Notification::Fact { fact }));
        }
        released
    }
}

impl Stream {
    fn fact(&self, capability: &Identifier) -> Fact {
        Fact {
            capability: capability.clone(),
            source_instance_id: self.instance.clone(),
            sequence: self.sequence,
            captured_at_ms: Count::new(self.captured_at_ms).unwrap_or(Count::ZERO),
            envelope: self.observation.envelope,
            state: self.observation.state.clone(),
            summary: self.observation.summary.clone(),
            changes: self.observation.changes.clone(),
        }
    }

    fn fact_ref(&self, capability: &Identifier) -> FactRef {
        FactRef {
            capability: capability.clone(),
            source_instance_id: self.instance.clone(),
            sequence: self.sequence,
        }
    }
}

impl Session {
    fn stream_mut(&mut self, capability: &Identifier) -> Result<&mut Stream, CoreError> {
        self.streams
            .get_mut(capability)
            .ok_or_else(|| CoreError::UnknownCapability(capability.clone()))
    }

    fn facts(&self) -> Vec<Fact> {
        self.streams
            .iter()
            .map(|(capability, stream)| stream.fact(capability))
            .collect()
    }

    /// Keeps the trackers of rules still active in this phase and adds new ones.
    fn select_trackers(&mut self) {
        let participation = self.phase == Phase::Participation;
        let mut next = Vec::new();
        for (index, rule) in self.policy.rules().iter().enumerate() {
            let active = if participation {
                rule.phase.applies_to_participation()
            } else {
                rule.phase.applies_to_readiness()
            };
            if !active {
                continue;
            }
            let existing = self
                .trackers
                .iter()
                .position(|tracker| tracker.rule == index);
            next.push(existing.map_or(
                Tracker {
                    rule: index,
                    reported: None,
                    met_since: None,
                },
                |position| Tracker {
                    rule: index,
                    reported: self.trackers[position].reported,
                    met_since: self.trackers[position].met_since,
                },
            ));
        }
        self.trackers = next;
    }

    /// Re-evaluates every active rule. Returns the statuses that changed (all of them on the
    /// first call), with the containment effect when containment flipped.
    fn evaluate_all(&mut self, registry: &Registry, at_ms: u64) -> Vec<RuleStatus> {
        let mut changed = Vec::new();
        for position in 0..self.trackers.len() {
            let rule = &self.policy.rules()[self.trackers[position].rule];
            let stream = self.streams.get(&rule.capability);
            let outcome = evaluate(
                &rule.requirement,
                &rule.rule_id,
                View {
                    observation: stream.map(|stream| &stream.observation),
                    gap: stream.is_some_and(|stream| stream.gap),
                },
            );
            let stability = registry
                .capability(&rule.capability)
                .map_or(0, |descriptor| descriptor.stability_ms);
            if self.trackers[position].update(outcome, at_ms, stability) {
                changed.push(position);
            }
        }
        let contained = self.phase == Phase::Participation
            && self.trackers.iter().any(|tracker| {
                self.policy.rules()[tracker.rule].mode == Mode::Enforce
                    && tracker
                        .reported
                        .is_some_and(|(status, _)| status != Status::Met)
            });
        let effect = match (self.contained, contained) {
            (false, true) => LocalEffect::Contained,
            (true, false) => LocalEffect::Released,
            _ => LocalEffect::None,
        };
        self.contained = contained;
        changed
            .into_iter()
            .map(|position| self.status_of(position, effect))
            .collect()
    }

    fn status_of(&self, position: usize, effect: LocalEffect) -> RuleStatus {
        let tracker = &self.trackers[position];
        let rule = &self.policy.rules()[tracker.rule];
        let (status, unknown_cause) = tracker
            .reported
            .unwrap_or((Status::Unknown, Some(UnknownCause::Unavailable)));
        RuleStatus {
            rule_id: rule.rule_id.clone(),
            status,
            unknown_cause,
            cause: self
                .streams
                .get(&rule.capability)
                .map(|stream| stream.fact_ref(&rule.capability)),
            local_effect: effect,
        }
    }

    fn current_statuses(&self) -> Vec<RuleStatus> {
        (0..self.trackers.len())
            .map(|position| self.status_of(position, LocalEffect::None))
            .collect()
    }
}

impl Tracker {
    /// Applies one evaluation. The first sets the status directly; afterwards a move to met waits
    /// for the stability time, while any other move is immediate. Returns whether the reported
    /// status or cause changed.
    fn update(&mut self, outcome: Outcome, at_ms: u64, stability_ms: u64) -> bool {
        let next = (outcome.status(), outcome.unknown_cause());
        let Some(current) = self.reported else {
            self.reported = Some(next);
            return true;
        };
        if outcome == Outcome::Met {
            if current.0 == Status::Met {
                self.met_since = None;
                return false;
            }
            let since = *self.met_since.get_or_insert(at_ms);
            if at_ms.saturating_sub(since) >= stability_ms {
                self.met_since = None;
                self.reported = Some(next);
                return true;
            }
            return false;
        }
        self.met_since = None;
        if current == next {
            return false;
        }
        self.reported = Some(next);
        true
    }
}

fn contains_app_condition(condition: &prctr_protocol::rules::Condition) -> bool {
    use prctr_protocol::rules::Condition;
    match condition {
        Condition::AppsAbsent { .. } | Condition::AppsOnly { .. } => true,
        Condition::Compare(_) => false,
        Condition::All { conditions } | Condition::Any { conditions } => {
            conditions.iter().any(contains_app_condition)
        }
        Condition::Not { condition } => contains_app_condition(condition),
    }
}

#[cfg(test)]
#[path = "engine_tests.rs"]
mod tests;
