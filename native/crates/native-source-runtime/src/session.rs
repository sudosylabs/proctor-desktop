//! Capability-neutral source session: buffers input during opening, sequences
//! observations, and records resets, loss, and terminal failure.

use std::collections::{VecDeque, hash_map::RandomState};
use std::hash::{BuildHasher, Hash, Hasher};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, LazyLock, Mutex};
use std::time::Instant;

use native_protocol::{
    MAX_PROTOCOL_SAFE_INTEGER, ProtocolValidatable, ProtocolViolation, SequenceGap, SourceHealth,
    SourceReset, SourceTimestamp,
};

use crate::queue::{BoundedObservationQueue, QueueError, SequencedObservation};

static INSTANCE_COUNTER: AtomicU64 = AtomicU64::new(1);
static INSTANCE_ENTROPY: LazyLock<RandomState> = LazyLock::new(RandomState::new);

#[derive(Debug)]
pub struct SourceClock {
    started_at: Instant,
}

impl SourceClock {
    #[must_use]
    pub fn start() -> Self {
        Self {
            started_at: Instant::now(),
        }
    }

    #[must_use]
    pub fn now(&self) -> SourceTimestamp {
        let monotonic_time_ns = bounded_protocol_integer(self.started_at.elapsed().as_nanos());
        SourceTimestamp { monotonic_time_ns }
    }
}

pub(crate) fn bounded_protocol_integer(value: u128) -> u64 {
    u64::try_from(value)
        .unwrap_or(MAX_PROTOCOL_SAFE_INTEGER)
        .min(MAX_PROTOCOL_SAFE_INTEGER)
}

pub trait SourceModel: Send + Sync + 'static {
    type State: Clone + Eq + Send + 'static;
    type Input: Send + 'static;
    type Observation: Send + 'static;
    type Error: Clone + Send + 'static;

    /// Validates one capability state before it becomes source authority.
    ///
    /// # Errors
    ///
    /// Returns a capability error when the state violates its protocol.
    fn validate_state(state: &Self::State) -> Result<(), Self::Error>;
    fn health(state: &Self::State) -> SourceHealth;
    /// Applies one typed input against the preceding accepted state.
    ///
    /// # Errors
    ///
    /// Returns a capability error when the input cannot form a valid fact.
    fn apply(
        previous: Option<&Self::State>,
        input: Self::Input,
    ) -> Result<SourceStateChange<Self::State, Self::Observation>, Self::Error>;
    fn final_observation(state: Self::State) -> Self::Observation;
    fn queue_error(error: QueueError) -> Self::Error;
    fn overflow_error() -> Self::Error;
}

pub enum SourceStateChange<S, O> {
    Ignore,
    Observe { state: Option<S>, observation: O },
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum SourceSessionFact<O> {
    Observation(O),
    Reset(String),
}

pub struct SourceSessionDrain<O, E> {
    pub source_instance_id: String,
    pub health: SourceHealth,
    pub facts: Vec<SequencedObservation<SourceSessionFact<O>>>,
    pub terminal_error: Option<E>,
}

pub struct SourceSessionMetadata {
    pub source_instance_id: String,
    pub health: SourceHealth,
    pub observed_at: SourceTimestamp,
}

pub struct SourceResetPlan {
    pub(crate) missing_count: u64,
    pub(crate) reason: String,
}

impl SourceResetPlan {
    /// Creates a reset boundary only when its synthetic first sequence, gap,
    /// and reason fit the shared wire protocol.
    ///
    /// # Errors
    ///
    /// Returns a protocol violation when the boundary cannot be represented.
    pub fn new(missing_count: u64, reason: String) -> Result<Self, ProtocolViolation> {
        let sequence = missing_count.saturating_add(1);
        SourceReset {
            source_instance_id: "reset-validation".to_owned(),
            sequence,
            observed_at: SourceTimestamp {
                monotonic_time_ns: 0,
            },
            gap: (missing_count > 0).then_some(SequenceGap {
                first_missing: 1,
                last_missing: missing_count,
            }),
            reason: reason.clone(),
        }
        .validate_protocol()
        .map_err(ProtocolViolation::from)?;
        Ok(Self {
            missing_count,
            reason,
        })
    }
}

struct PendingInput<I> {
    input: I,
    observed_at: SourceTimestamp,
}

enum PendingOpenFact<I> {
    Input(PendingInput<I>),
    Missing(u64),
}

struct SourceSessionState<M: SourceModel> {
    clock: SourceClock,
    source_instance_id: String,
    opening: bool,
    accepting: bool,
    last_state: Option<M::State>,
    pending_before_snapshot: VecDeque<PendingOpenFact<M::Input>>,
    dropped_opening_prefix: u64,
    health: SourceHealth,
    facts: BoundedObservationQueue<SourceSessionFact<M::Observation>>,
    terminal_error: Option<M::Error>,
}

pub struct SourceSession<M: SourceModel> {
    state: Arc<Mutex<SourceSessionState<M>>>,
}

impl<M: SourceModel> Clone for SourceSession<M> {
    fn clone(&self) -> Self {
        Self {
            state: Arc::clone(&self.state),
        }
    }
}

impl<M: SourceModel> SourceSession<M> {
    /// Creates one capability-neutral race-free source session.
    ///
    /// # Errors
    ///
    /// Returns the capability's queue error when the capacity is invalid.
    pub fn new(capacity: usize) -> Result<Self, M::Error> {
        Ok(Self {
            state: Arc::new(Mutex::new(SourceSessionState {
                clock: SourceClock::start(),
                source_instance_id: fresh_source_instance_id(),
                opening: true,
                accepting: true,
                last_state: None,
                pending_before_snapshot: VecDeque::with_capacity(capacity),
                dropped_opening_prefix: 0,
                health: SourceHealth::Starting,
                facts: BoundedObservationQueue::new(capacity).map_err(M::queue_error)?,
                terminal_error: None,
            })),
        })
    }

    pub fn submit(&self, input: M::Input) {
        let mut state = lock_source_session(&self.state);
        if !accepts_source_input(&state) {
            return;
        }
        let observed_at = state.clock.now();
        if state.opening {
            push_pending_open_fact(
                &mut state,
                PendingOpenFact::Input(PendingInput { input, observed_at }),
            );
            return;
        }
        apply_source_input::<M>(&mut state, input, observed_at);
    }

    /// Establishes sequence zero, applies an optional restart reset, then
    /// releases every event retained during the opening handshake.
    ///
    /// # Errors
    ///
    /// Returns a validation or queue failure from the capability model.
    pub fn finish_open(
        &self,
        initial_state: M::State,
        initial_health: SourceHealth,
        reset: Option<SourceResetPlan>,
    ) -> Result<SourceSessionMetadata, M::Error> {
        M::validate_state(&initial_state)?;
        let mut state = lock_source_session(&self.state);
        state.opening = false;
        if state.terminal_error.is_none() {
            state.health = initial_health;
        }
        state.last_state = Some(initial_state.clone());
        let snapshot_metadata = SourceSessionMetadata {
            source_instance_id: state.source_instance_id.clone(),
            health: state.health,
            observed_at: state.clock.now(),
        };
        if reset.is_some() {
            let replay_capacity = state.facts.capacity().saturating_sub(1);
            while pending_open_output_bound(
                &state.pending_before_snapshot,
                state.dropped_opening_prefix,
            ) > replay_capacity
            {
                if !replace_first_pending_input_with_loss(&mut state.pending_before_snapshot) {
                    break;
                }
            }
        }
        if let Some(reset) = reset {
            record_source_reset::<M>(&mut state, reset)?;
        }
        let dropped_prefix = state.dropped_opening_prefix;
        state.dropped_opening_prefix = 0;
        let mut had_missing = dropped_prefix > 0;
        let mut emitted_after_last_missing = false;
        if dropped_prefix > 0 {
            state
                .facts
                .record_missing(dropped_prefix)
                .map_err(M::queue_error)?;
        }
        while let Some(pending) = state.pending_before_snapshot.pop_front() {
            match pending {
                PendingOpenFact::Input(pending) => {
                    let before = state.facts.len();
                    let observed_at = SourceTimestamp {
                        monotonic_time_ns: pending
                            .observed_at
                            .monotonic_time_ns
                            .max(snapshot_metadata.observed_at.monotonic_time_ns),
                    };
                    apply_source_input::<M>(&mut state, pending.input, observed_at);
                    if state.facts.len() > before {
                        emitted_after_last_missing = true;
                    }
                    if state.terminal_error.is_some() {
                        break;
                    }
                }
                PendingOpenFact::Missing(count) => {
                    state.facts.record_missing(count).map_err(M::queue_error)?;
                    had_missing = true;
                    emitted_after_last_missing = false;
                }
            }
        }
        if had_missing && !emitted_after_last_missing {
            let observed_at = state.clock.now();
            push_source_observation::<M>(
                &mut state,
                M::final_observation(initial_state),
                observed_at,
            );
        }
        if had_missing {
            fail_source_session(&mut state, M::overflow_error());
        }
        Ok(snapshot_metadata)
    }

    #[must_use]
    pub fn metadata(&self) -> SourceSessionMetadata {
        let state = lock_source_session(&self.state);
        SourceSessionMetadata {
            source_instance_id: state.source_instance_id.clone(),
            health: state.health,
            observed_at: state.clock.now(),
        }
    }

    #[must_use]
    pub fn drain(&self) -> SourceSessionDrain<M::Observation, M::Error> {
        let mut state = lock_source_session(&self.state);
        SourceSessionDrain {
            source_instance_id: state.source_instance_id.clone(),
            health: state.health,
            facts: state.facts.drain(),
            terminal_error: state.terminal_error.clone(),
        }
    }

    #[must_use]
    pub fn last_state(&self) -> Option<M::State> {
        lock_source_session(&self.state).last_state.clone()
    }

    pub fn report_missing(&self, count: u64) {
        if count == 0 {
            return;
        }
        let mut state = lock_source_session(&self.state);
        if state.facts.is_stopped() || state.terminal_error.is_some() {
            return;
        }
        if state.opening {
            push_pending_open_fact(&mut state, PendingOpenFact::Missing(count));
            return;
        }
        if let Err(error) = state.facts.record_missing(count) {
            fail_source_session(&mut state, M::queue_error(error));
            return;
        }
        if let Some(last_state) = state.last_state.clone() {
            let observed_at = state.clock.now();
            push_source_observation::<M>(&mut state, M::final_observation(last_state), observed_at);
        }
        fail_source_session(&mut state, M::overflow_error());
    }

    pub fn fail(&self, error: M::Error) {
        let mut state = lock_source_session(&self.state);
        if !state.facts.is_stopped() {
            fail_source_session(&mut state, error);
        }
    }

    pub fn begin_stop(&self) {
        let mut state = lock_source_session(&self.state);
        if !state.facts.is_stopped() {
            state.accepting = false;
        }
    }

    pub fn finish_stop(&self, final_state: Result<M::State, M::Error>) {
        let mut state = lock_source_session(&self.state);
        if state.facts.is_stopped() {
            return;
        }
        match final_state {
            Ok(final_state) => {
                if let Err(error) = M::validate_state(&final_state) {
                    fail_source_session(&mut state, error);
                } else {
                    state.last_state = Some(final_state.clone());
                    let observed_at = state.clock.now();
                    push_source_observation::<M>(
                        &mut state,
                        M::final_observation(final_state),
                        observed_at,
                    );
                }
            }
            Err(error) => fail_source_session(&mut state, error),
        }
        if state.terminal_error.is_none() {
            state.health = SourceHealth::Stopped;
        }
    }

    pub fn dispose(&self) {
        let mut state = lock_source_session(&self.state);
        state.facts.stop();
        state.pending_before_snapshot.clear();
    }

    #[must_use]
    pub fn health(&self) -> SourceHealth {
        lock_source_session(&self.state).health
    }

    #[must_use]
    pub fn queue_capacity(&self) -> usize {
        lock_source_session(&self.state).facts.capacity()
    }
}

fn push_pending_open_fact<M: SourceModel>(
    state: &mut SourceSessionState<M>,
    fact: PendingOpenFact<M::Input>,
) {
    match fact {
        PendingOpenFact::Missing(count) => {
            if let Some(PendingOpenFact::Missing(tail)) = state.pending_before_snapshot.back_mut() {
                *tail = tail.saturating_add(count);
                return;
            }
            push_bounded_pending_open_fact(state, PendingOpenFact::Missing(count));
        }
        PendingOpenFact::Input(input) => {
            push_bounded_pending_open_fact(state, PendingOpenFact::Input(input));
        }
    }
}

fn push_bounded_pending_open_fact<M: SourceModel>(
    state: &mut SourceSessionState<M>,
    fact: PendingOpenFact<M::Input>,
) {
    if state.pending_before_snapshot.len() == state.facts.capacity()
        && let Some(dropped) = state.pending_before_snapshot.pop_front()
    {
        let dropped_count = match dropped {
            PendingOpenFact::Input(_) => 1,
            PendingOpenFact::Missing(count) => count,
        };
        state.dropped_opening_prefix = state.dropped_opening_prefix.saturating_add(dropped_count);
    }
    state.pending_before_snapshot.push_back(fact);
}

fn pending_open_output_bound<I>(
    pending: &VecDeque<PendingOpenFact<I>>,
    dropped_prefix: u64,
) -> usize {
    let mut inputs_before_last_missing = 0_usize;
    let mut inputs_after_last_missing = 0_usize;
    let mut saw_missing = dropped_prefix > 0;
    for fact in pending {
        match fact {
            PendingOpenFact::Input(_) if saw_missing => inputs_after_last_missing += 1,
            PendingOpenFact::Input(_) => inputs_before_last_missing += 1,
            PendingOpenFact::Missing(_) => {
                inputs_before_last_missing += inputs_after_last_missing;
                inputs_after_last_missing = 0;
                saw_missing = true;
            }
        }
    }
    if saw_missing {
        inputs_before_last_missing + inputs_after_last_missing.max(1)
    } else {
        inputs_before_last_missing
    }
}

fn replace_first_pending_input_with_loss<I>(pending: &mut VecDeque<PendingOpenFact<I>>) -> bool {
    if let Some(fact) = pending
        .iter_mut()
        .find(|fact| matches!(fact, PendingOpenFact::Input(_)))
    {
        *fact = PendingOpenFact::Missing(1);
        true
    } else {
        false
    }
}

fn accepts_source_input<M: SourceModel>(state: &SourceSessionState<M>) -> bool {
    !state.facts.is_stopped() && state.accepting && state.terminal_error.is_none()
}

fn apply_source_input<M: SourceModel>(
    state: &mut SourceSessionState<M>,
    input: M::Input,
    observed_at: SourceTimestamp,
) {
    match M::apply(state.last_state.as_ref(), input) {
        Ok(SourceStateChange::Ignore) => {}
        Ok(SourceStateChange::Observe {
            state: next_state,
            observation,
        }) => {
            if let Some(next_state) = next_state {
                state.health = M::health(&next_state);
                state.last_state = Some(next_state);
            }
            push_source_observation::<M>(state, observation, observed_at);
        }
        Err(error) => fail_source_session(state, error),
    }
}

fn push_source_observation<M: SourceModel>(
    state: &mut SourceSessionState<M>,
    observation: M::Observation,
    observed_at: SourceTimestamp,
) {
    match state
        .facts
        .push(observed_at, SourceSessionFact::Observation(observation))
    {
        Ok(outcome) if outcome.dropped.is_some() => {
            fail_source_session(state, M::overflow_error());
        }
        Ok(_) => {}
        Err(error) => fail_source_session(state, M::queue_error(error)),
    }
}

fn record_source_reset<M: SourceModel>(
    state: &mut SourceSessionState<M>,
    reset: SourceResetPlan,
) -> Result<(), M::Error> {
    let observed_at = state.clock.now();
    state
        .facts
        .record_missing(reset.missing_count)
        .map_err(M::queue_error)?;
    match state
        .facts
        .push(observed_at, SourceSessionFact::Reset(reset.reason))
    {
        Ok(outcome) if outcome.dropped.is_some() => {
            fail_source_session(state, M::overflow_error());
        }
        Ok(_) => {}
        Err(error) => return Err(M::queue_error(error)),
    }
    Ok(())
}

fn fail_source_session<M: SourceModel>(state: &mut SourceSessionState<M>, error: M::Error) {
    state.health = SourceHealth::Failed;
    if state.terminal_error.is_none() {
        state.terminal_error = Some(error);
    }
}

fn lock_source_session<M: SourceModel>(
    mutex: &Mutex<SourceSessionState<M>>,
) -> std::sync::MutexGuard<'_, SourceSessionState<M>> {
    mutex
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
}

#[must_use]
pub fn fresh_source_instance_id() -> String {
    let counter = INSTANCE_COUNTER.fetch_add(1, Ordering::Relaxed);
    let generated_at = Instant::now();
    let hash_part = |domain: u8| {
        let mut hasher = INSTANCE_ENTROPY.build_hasher();
        domain.hash(&mut hasher);
        counter.hash(&mut hasher);
        generated_at.hash(&mut hasher);
        hasher.finish()
    };
    // The boundary identifier is deliberately opaque: source-local counters,
    // process identifiers, and native handles must never appear in clear text.
    format!(
        "{high:016x}{middle:016x}{low:016x}",
        high = hash_part(0),
        middle = hash_part(1),
        low = hash_part(2),
    )
}
