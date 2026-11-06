//! Full-state passive sources: a capability supplies wire conversions and a
//! backend, and this module owns opening, sequencing, draining, and stopping.

use std::fmt;
use std::marker::PhantomData;
use std::time::Duration;

use native_protocol::{
    PermissionState, PlatformFamily, ProtocolValidatable, ProtocolValidationError,
    ProtocolViolation, SequenceGap, SourceFailureCode, SourceHealth, SourceOpenRequest,
    SourceReset,
};

use crate::deadline::{
    SOURCE_CLEANUP_DEADLINE, ensure_native_source_process_usable, poison_native_source_process,
    prefer_boundary_error, run_bounded_source_stop_with,
};
use crate::passive_backends::POLL_QUERY_BUDGET;
use crate::queue::{QueueError, SequencedObservation};
use crate::session::{
    SourceModel, SourceResetPlan, SourceSession, SourceSessionFact, SourceSessionMetadata,
    SourceStateChange,
};

/// Deadline for stopping any passive-state subscription: the ordinary cleanup
/// deadline plus room for a polling source's in-flight and final queries.
const PASSIVE_STATE_STOP_DEADLINE: Duration = SOURCE_CLEANUP_DEADLINE
    .saturating_add(POLL_QUERY_BUDGET)
    .saturating_add(POLL_QUERY_BUDGET);

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum PassiveStateSourceError {
    Backend(String),
    Cleanup(String),
    InventoryOverflow(String),
    Protocol(ProtocolViolation),
    Queue(QueueError),
    QueueOverflow,
}

impl PassiveStateSourceError {
    #[must_use]
    pub const fn failure_code(&self) -> SourceFailureCode {
        match self {
            Self::Backend(_) => SourceFailureCode::Backend,
            Self::Cleanup(_) => SourceFailureCode::Cleanup,
            Self::InventoryOverflow(_) => SourceFailureCode::InventoryOverflow,
            Self::Protocol(_) => SourceFailureCode::Protocol,
            Self::Queue(_) => SourceFailureCode::Queue,
            Self::QueueOverflow => SourceFailureCode::QueueOverflow,
        }
    }

    /// Only an ordinary backend discovery failure may become an explicit
    /// unavailable snapshot during an initial platform probe. Boundedness,
    /// protocol, queue, and cleanup failures must remain terminal.
    #[must_use]
    pub const fn allows_initial_unavailable_fallback(&self) -> bool {
        matches!(self, Self::Backend(_))
    }
}

impl fmt::Display for PassiveStateSourceError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Backend(reason) => write!(formatter, "native state backend failed: {reason}"),
            Self::Cleanup(reason) => write!(formatter, "native state cleanup failed: {reason}"),
            Self::InventoryOverflow(reason) => {
                write!(
                    formatter,
                    "native state inventory exceeded its bound: {reason}"
                )
            }
            Self::Protocol(error) => write!(formatter, "native state protocol violation: {error}"),
            Self::Queue(error) => write!(formatter, "native state queue failed: {error}"),
            Self::QueueOverflow => formatter.write_str("native state source queue overflowed"),
        }
    }
}

impl std::error::Error for PassiveStateSourceError {}

impl From<ProtocolViolation> for PassiveStateSourceError {
    fn from(error: ProtocolViolation) -> Self {
        Self::Protocol(error)
    }
}

impl From<QueueError> for PassiveStateSourceError {
    fn from(error: QueueError) -> Self {
        Self::Queue(error)
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum PassiveStateEventKind {
    Changed,
    Reconciled,
}

/// Capability-owned mapping between shared lifecycle mechanics and generated wire types.
pub trait PassiveStateWire: Send + Sync + 'static {
    type State: Clone + Eq + ProtocolValidatable + Send + 'static;
    type Event: Clone + Eq + ProtocolValidatable + Send + 'static;
    type Snapshot: Clone + Eq + ProtocolValidatable + Send + 'static;
    type Observation: Clone + Eq + ProtocolValidatable + Send + 'static;
    type Drain: Clone + Eq + ProtocolValidatable + Send + 'static;

    const SOURCE_VERSION: &'static str;
    const STOP_THREAD_NAME: &'static str;

    fn health(state: &Self::State) -> SourceHealth;
    fn unavailable_state() -> Self::State;
    fn event(kind: PassiveStateEventKind, state: Self::State) -> Self::Event;
    fn snapshot(
        metadata: SourceSessionMetadata,
        platform: PlatformFamily,
        permission: PermissionState,
        adapter_version: &str,
        state: Self::State,
    ) -> Self::Snapshot;
    fn observation(
        source_instance_id: String,
        fact: SequencedObservation<Self::Event>,
    ) -> Self::Observation;
    fn drain(
        source_instance_id: String,
        health: SourceHealth,
        observations: Vec<Self::Observation>,
        resets: Vec<SourceReset>,
        terminal_error: Option<SourceFailureCode>,
    ) -> Self::Drain;
}

pub(crate) enum PassiveStateInput<W: PassiveStateWire> {
    State(PassiveStateEventKind, W::State),
}

pub(crate) struct PassiveStateModel<W: PassiveStateWire>(PhantomData<W>);

impl<W: PassiveStateWire> SourceModel for PassiveStateModel<W> {
    type State = W::State;
    type Input = PassiveStateInput<W>;
    type Observation = W::Event;
    type Error = PassiveStateSourceError;

    fn validate_state(state: &Self::State) -> Result<(), Self::Error> {
        state
            .validate_protocol()
            .map_err(ProtocolViolation::from)
            .map_err(Into::into)
    }

    fn health(state: &Self::State) -> SourceHealth {
        W::health(state)
    }

    fn apply(
        previous: Option<&Self::State>,
        input: Self::Input,
    ) -> Result<SourceStateChange<Self::State, Self::Observation>, Self::Error> {
        let PassiveStateInput::State(kind, state) = input;
        Self::validate_state(&state)?;
        if previous == Some(&state) {
            return Ok(SourceStateChange::Ignore);
        }
        Ok(SourceStateChange::Observe {
            state: Some(state.clone()),
            observation: W::event(kind, state),
        })
    }

    fn final_observation(state: Self::State) -> Self::Observation {
        W::event(PassiveStateEventKind::Reconciled, state)
    }

    fn queue_error(error: QueueError) -> Self::Error {
        error.into()
    }

    fn overflow_error() -> Self::Error {
        PassiveStateSourceError::QueueOverflow
    }
}

pub struct PassiveStateEmitter<W: PassiveStateWire> {
    pub(crate) session: SourceSession<PassiveStateModel<W>>,
}

impl<W: PassiveStateWire> Clone for PassiveStateEmitter<W> {
    fn clone(&self) -> Self {
        Self {
            session: self.session.clone(),
        }
    }
}

impl<W: PassiveStateWire> PassiveStateEmitter<W> {
    pub(crate) fn new(queue_capacity: usize) -> Result<Self, PassiveStateSourceError> {
        Ok(Self {
            session: SourceSession::new(queue_capacity)?,
        })
    }

    pub fn observe(&self, state: W::State) {
        self.session.submit(PassiveStateInput::State(
            PassiveStateEventKind::Changed,
            state,
        ));
    }

    pub fn reconcile(&self, state: W::State) {
        self.session.submit(PassiveStateInput::State(
            PassiveStateEventKind::Reconciled,
            state,
        ));
    }

    pub fn fail(&self, error: PassiveStateSourceError) {
        self.session.fail(error);
    }

    pub fn report_missing(&self, count: u64) {
        self.session.report_missing(count);
    }

    #[must_use]
    pub fn queue_capacity(&self) -> usize {
        self.session.queue_capacity()
    }
}

pub trait PassiveStateSubscription<W: PassiveStateWire>: Send + 'static {
    /// Fences callbacks and returns one final complete state.
    ///
    /// # Errors
    ///
    /// Returns an error when the closed-input boundary cannot be established.
    fn stop(self) -> Result<W::State, PassiveStateSourceError>;
}

pub trait PassiveStateBackend<W: PassiveStateWire> {
    type Subscription: PassiveStateSubscription<W>;

    /// Starts observation before constructing the initial state.
    ///
    /// # Errors
    ///
    /// Returns an error when a race-free bounded source cannot be established.
    fn open(
        self,
        emitter: PassiveStateEmitter<W>,
    ) -> Result<OpenedPassiveStateBackend<W, Self::Subscription>, PassiveStateSourceError>;

    /// Starts observation with the opaque collection context that remains
    /// stable across replacement source generations in one Attempt.
    /// Backends that do not need Attempt-scoped correlation use `open`.
    ///
    /// # Errors
    ///
    /// Returns an error when a race-free bounded source cannot be established.
    fn open_with_context(
        self,
        request: &SourceOpenRequest,
        emitter: PassiveStateEmitter<W>,
    ) -> Result<OpenedPassiveStateBackend<W, Self::Subscription>, PassiveStateSourceError>
    where
        Self: Sized,
    {
        let _ = request;
        self.open(emitter)
    }
}

pub struct OpenedPassiveStateBackend<W: PassiveStateWire, S> {
    pub platform: PlatformFamily,
    pub permission: PermissionState,
    pub adapter_version: &'static str,
    pub initial_state: W::State,
    pub subscription: S,
}

pub struct PassiveStateSource<W: PassiveStateWire, S: PassiveStateSubscription<W>> {
    emitter: PassiveStateEmitter<W>,
    snapshot: W::Snapshot,
    subscription: Option<S>,
}

impl<W: PassiveStateWire, S: PassiveStateSubscription<W>> PassiveStateSource<W, S> {
    /// Opens one passive full-state source.
    ///
    /// # Errors
    ///
    /// Returns a schema, backend, queue, or cleanup failure.
    pub fn open<B>(request: &SourceOpenRequest, backend: B) -> Result<Self, PassiveStateSourceError>
    where
        B: PassiveStateBackend<W, Subscription = S>,
    {
        Self::open_internal(request, backend, None)
    }

    /// Opens a replacement source behind one explicit reset boundary.
    ///
    /// # Errors
    ///
    /// Returns a schema, backend, queue, reset, or cleanup failure.
    pub fn open_after_reset<B>(
        request: &SourceOpenRequest,
        backend: B,
        missing_count: u64,
        reason: String,
    ) -> Result<Self, PassiveStateSourceError>
    where
        B: PassiveStateBackend<W, Subscription = S>,
    {
        Self::open_internal(
            request,
            backend,
            Some(SourceResetPlan::new(missing_count, reason)?),
        )
    }

    fn open_internal<B>(
        request: &SourceOpenRequest,
        backend: B,
        reset: Option<SourceResetPlan>,
    ) -> Result<Self, PassiveStateSourceError>
    where
        B: PassiveStateBackend<W, Subscription = S>,
    {
        request.validate()?;
        ensure_native_source_process_usable()
            .map_err(|error| PassiveStateSourceError::Cleanup(error.to_string()))?;
        let emitter = PassiveStateEmitter::new(usize::from(request.queue_capacity))?;
        let opened = backend.open_with_context(request, emitter.clone())?;
        let initial_state = opened.initial_state.clone();
        let subscription = opened.subscription;
        let snapshot_metadata = match emitter.session.finish_open(
            opened.initial_state,
            W::health(&initial_state),
            reset,
        ) {
            Ok(metadata) => metadata,
            Err(error) => return Err(passive_state_rollback::<W, S>(error, subscription)),
        };
        let snapshot = W::snapshot(
            snapshot_metadata,
            opened.platform,
            opened.permission,
            opened.adapter_version,
            initial_state,
        );
        if let Err(error) = snapshot.validate_protocol() {
            return Err(passive_state_rollback::<W, S>(
                PassiveStateSourceError::Protocol(error.into()),
                subscription,
            ));
        }
        Ok(Self {
            emitter,
            snapshot,
            subscription: Some(subscription),
        })
    }

    #[must_use]
    pub fn snapshot(&self) -> &W::Snapshot {
        &self.snapshot
    }

    #[must_use]
    pub fn health(&self) -> SourceHealth {
        self.emitter.session.health()
    }

    pub fn drain(&self) -> W::Drain {
        passive_state_drain::<W>(&self.emitter.session)
    }

    #[must_use]
    pub fn stop(&mut self) -> W::Drain {
        if let Some(subscription) = self.subscription.take() {
            let final_state = passive_state_stop_subscription::<W, S>(subscription);
            self.emitter.session.begin_stop();
            self.emitter.session.finish_stop(final_state);
        }
        let drain = passive_state_drain::<W>(&self.emitter.session);
        self.emitter.session.dispose();
        drain
    }
}

impl<W: PassiveStateWire, S: PassiveStateSubscription<W>> Drop for PassiveStateSource<W, S> {
    fn drop(&mut self) {
        let _ = self.stop();
    }
}

pub(crate) fn passive_state_drain<W: PassiveStateWire>(
    session: &SourceSession<PassiveStateModel<W>>,
) -> W::Drain {
    let session_drain = session.drain();
    let source_instance_id = session_drain.source_instance_id.clone();
    let discarded = discarded_fact_range(&session_drain.facts);
    let mut observations = Vec::new();
    let mut resets = Vec::new();
    for fact in session_drain.facts {
        match fact.payload {
            SourceSessionFact::Observation(event) => {
                let observation = W::observation(
                    source_instance_id.clone(),
                    SequencedObservation {
                        sequence: fact.sequence,
                        observed_at: fact.observed_at,
                        gap: fact.gap,
                        payload: event,
                    },
                );
                if let Err(error) = observation.validate_protocol() {
                    return failed_passive_state_drain::<W>(
                        session,
                        source_instance_id,
                        discarded,
                        error,
                    );
                }
                observations.push(observation);
            }
            SourceSessionFact::Reset(reason) => {
                let reset = SourceReset {
                    source_instance_id: source_instance_id.clone(),
                    sequence: fact.sequence,
                    observed_at: fact.observed_at,
                    gap: fact.gap,
                    reason,
                };
                if let Err(error) = reset.validate_protocol() {
                    return failed_passive_state_drain::<W>(
                        session,
                        source_instance_id,
                        discarded,
                        error,
                    );
                }
                resets.push(reset);
            }
        }
    }
    let terminal_error = session_drain
        .terminal_error
        .as_ref()
        .map(PassiveStateSourceError::failure_code);
    let drain = W::drain(
        source_instance_id,
        session_drain.health,
        observations,
        resets,
        terminal_error,
    );
    if let Err(error) = drain.validate_protocol() {
        return failed_passive_state_drain::<W>(
            session,
            session.metadata().source_instance_id,
            discarded,
            error,
        );
    }
    drain
}

fn discarded_fact_range<T>(facts: &[SequencedObservation<T>]) -> Option<SequenceGap> {
    let first = facts.first()?;
    let last = facts.last()?;
    Some(SequenceGap {
        first_missing: first
            .gap
            .as_ref()
            .map_or(first.sequence, |gap| gap.first_missing),
        last_missing: last.sequence,
    })
}

fn failed_passive_state_drain<W: PassiveStateWire>(
    session: &SourceSession<PassiveStateModel<W>>,
    source_instance_id: String,
    discarded: Option<SequenceGap>,
    error: ProtocolValidationError,
) -> W::Drain {
    session.fail(PassiveStateSourceError::Protocol(error.into()));
    let terminal = session.drain();
    let observations = discarded
        .and_then(|gap| {
            let sequence = gap.last_missing.checked_add(1)?;
            let state = session.last_state()?;
            Some(W::observation(
                source_instance_id.clone(),
                SequencedObservation {
                    sequence,
                    observed_at: session.metadata().observed_at,
                    gap: Some(gap),
                    payload: W::event(PassiveStateEventKind::Reconciled, state),
                },
            ))
        })
        .filter(|observation| observation.validate_protocol().is_ok())
        .into_iter()
        .collect();
    W::drain(
        source_instance_id,
        terminal.health,
        observations,
        Vec::new(),
        terminal
            .terminal_error
            .as_ref()
            .map(PassiveStateSourceError::failure_code),
    )
}

fn passive_state_rollback<W, S>(
    primary: PassiveStateSourceError,
    subscription: S,
) -> PassiveStateSourceError
where
    W: PassiveStateWire,
    S: PassiveStateSubscription<W>,
{
    prefer_boundary_error(
        primary,
        passive_state_stop_subscription::<W, S>(subscription),
    )
}

pub(crate) fn passive_state_stop_subscription<W, S>(
    subscription: S,
) -> Result<W::State, PassiveStateSourceError>
where
    W: PassiveStateWire,
    S: PassiveStateSubscription<W>,
{
    run_bounded_source_stop_with(
        W::STOP_THREAD_NAME,
        PASSIVE_STATE_STOP_DEADLINE,
        move || subscription.stop(),
        |error| {
            PassiveStateSourceError::Cleanup(format!(
                "observer shutdown {error}; native utility restart is required"
            ))
        },
        &poison_native_source_process,
    )
}
