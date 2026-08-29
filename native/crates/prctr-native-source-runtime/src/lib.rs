#![forbid(unsafe_code)]

use std::collections::VecDeque;
use std::fmt;
use std::io;
use std::panic::{self, AssertUnwindSafe};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::mpsc::{self, Receiver};
use std::sync::{Arc, Mutex};
use std::thread::{self, JoinHandle};
use std::time::Duration;
use std::time::{Instant, SystemTime, UNIX_EPOCH};

use prctr_native_protocol::{
    MAX_PROTOCOL_SAFE_INTEGER, ProtocolValidatable, ProtocolViolation, SequenceGap, SourceHealth,
    SourceReset, SourceTimestamp,
};

static INSTANCE_COUNTER: AtomicU64 = AtomicU64::new(1);
static NATIVE_SOURCE_PROCESS_POISONED: AtomicBool = AtomicBool::new(false);

pub const SOURCE_CLEANUP_DEADLINE: Duration = Duration::from_millis(500);

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SequencedObservation<T> {
    pub sequence: u64,
    pub observed_at: SourceTimestamp,
    pub gap: Option<SequenceGap>,
    pub payload: T,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct QueuePushOutcome {
    pub sequence: u64,
    pub dropped: Option<SequenceGap>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum QueueError {
    InvalidCapacity,
    Stopped,
}

impl fmt::Display for QueueError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::InvalidCapacity => formatter.write_str("queue capacity must be at least two"),
            Self::Stopped => formatter.write_str("source queue is stopped"),
        }
    }
}

impl std::error::Error for QueueError {}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ThreadFinishError {
    Panicked,
    TimedOut,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum BoundedTaskError {
    CannotStart,
    Panicked,
    TimedOut,
    Disconnected,
    WorkerPanicked,
}

impl fmt::Display for BoundedTaskError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::CannotStart => formatter.write_str("task thread could not start"),
            Self::Panicked => formatter.write_str("task panicked"),
            Self::TimedOut => formatter.write_str("task missed its deadline"),
            Self::Disconnected => formatter.write_str("task ended without returning a result"),
            Self::WorkerPanicked => formatter.write_str("task worker panicked while finishing"),
        }
    }
}

impl std::error::Error for BoundedTaskError {}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct NativeSourceProcessPoisoned;

impl fmt::Display for NativeSourceProcessPoisoned {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(
            "the native source utility is poisoned and must restart before opening another source",
        )
    }
}

impl std::error::Error for NativeSourceProcessPoisoned {}

/// Rejects new source sessions after any capability fails to fence a detached
/// privileged callback or worker in this utility process.
///
/// # Errors
///
/// Returns [`NativeSourceProcessPoisoned`] once the process-wide fence has
/// been raised. Only a process restart creates a clean observation boundary.
pub fn ensure_native_source_process_usable() -> Result<(), NativeSourceProcessPoisoned> {
    if NATIVE_SOURCE_PROCESS_POISONED.load(Ordering::Acquire) {
        return Err(NativeSourceProcessPoisoned);
    }
    Ok(())
}

/// Permanently fences all native source openings in the current utility
/// process. The supervisor must replace the process before sources can reopen.
pub fn poison_native_source_process() {
    NATIVE_SOURCE_PROCESS_POISONED.store(true, Ordering::Release);
}

/// Executes a source subscription's closed-input boundary behind the shared
/// cleanup deadline. Every returned subscription error and every bounded-task
/// failure poisons the utility process because neither proves that privileged
/// input has stopped.
///
/// `bounded_error` maps lifecycle failures into the capability's error type;
/// process fencing remains capability-neutral and cannot be weakened by an
/// adapter-specific error category.
///
/// # Errors
///
/// Returns the subscription's boundary error, or the mapped bounded-task
/// error when the stop operation cannot finish by the shared deadline.
pub fn run_bounded_source_stop<T, E, F, M>(
    thread_name: &str,
    stop: F,
    bounded_error: M,
) -> Result<T, E>
where
    T: Send + 'static,
    E: Send + 'static,
    F: FnOnce() -> Result<T, E> + Send + 'static,
    M: FnOnce(BoundedTaskError) -> E,
{
    run_bounded_source_stop_with(
        thread_name,
        SOURCE_CLEANUP_DEADLINE,
        stop,
        bounded_error,
        &poison_native_source_process,
    )
}

/// Prefers failure to establish a closed-input boundary over the operation
/// error that caused rollback. A successful boundary preserves the primary
/// failure.
pub fn prefer_boundary_error<T, E>(primary: E, boundary: Result<T, E>) -> E {
    boundary.map_or_else(|error| error, |_| primary)
}

fn run_bounded_source_stop_with<T, E, F, M, P>(
    thread_name: &str,
    deadline: Duration,
    stop: F,
    bounded_error: M,
    poison: &P,
) -> Result<T, E>
where
    T: Send + 'static,
    E: Send + 'static,
    F: FnOnce() -> Result<T, E> + Send + 'static,
    M: FnOnce(BoundedTaskError) -> E,
    P: Fn(),
{
    match run_bounded_task(thread_name, deadline, stop) {
        Ok(result) => {
            if result.is_err() {
                poison();
            }
            result
        }
        Err(error) => {
            poison();
            Err(bounded_error(error))
        }
    }
}

impl fmt::Display for ThreadFinishError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Panicked => formatter.write_str("source worker panicked"),
            Self::TimedOut => formatter.write_str("source worker missed its cleanup deadline"),
        }
    }
}

impl std::error::Error for ThreadFinishError {}

pub struct DeadlineThread {
    completion: Receiver<()>,
    handle: Option<JoinHandle<()>>,
}

impl DeadlineThread {
    /// Starts one named source-owned thread with a completion signal that is
    /// independent of joining the operating-system thread handle.
    ///
    /// # Errors
    ///
    /// Returns the operating-system thread creation error.
    pub fn spawn<F>(name: &str, task: F) -> Result<Self, io::Error>
    where
        F: FnOnce() + Send + 'static,
    {
        let (sender, completion) = mpsc::sync_channel(1);
        let handle = thread::Builder::new()
            .name(name.to_owned())
            .spawn(move || {
                task();
                let _ = sender.send(());
            })?;
        Ok(Self {
            completion,
            handle: Some(handle),
        })
    }

    /// Waits no longer than `timeout` for completion and joins only after the
    /// completion signal or channel disconnection proves the thread exited.
    /// A timeout detaches the handle so privileged cleanup can continue.
    ///
    /// # Errors
    ///
    /// Returns [`ThreadFinishError::TimedOut`] at the deadline or
    /// [`ThreadFinishError::Panicked`] after an unwinding worker exits.
    pub fn finish(&mut self, timeout: Duration) -> Result<(), ThreadFinishError> {
        let Some(handle) = self.handle.take() else {
            return Ok(());
        };
        match self.completion.recv_timeout(timeout) {
            Ok(()) | Err(mpsc::RecvTimeoutError::Disconnected) => handle
                .join()
                .map_err(|_panic_payload| ThreadFinishError::Panicked),
            Err(mpsc::RecvTimeoutError::Timeout) => Err(ThreadFinishError::TimedOut),
        }
    }
}

/// Runs one owned task behind a hard wait deadline.
///
/// The worker is joined only after its independent completion signal proves it
/// exited. A timed-out worker is detached so the privileged caller can fail
/// closed and restart its process instead of blocking indefinitely.
///
/// # Errors
///
/// Returns a bounded lifecycle error when the worker cannot start, panics,
/// disconnects, misses the deadline, or panics during its final join.
pub fn run_bounded_task<T, F>(
    thread_name: &str,
    deadline: Duration,
    task: F,
) -> Result<T, BoundedTaskError>
where
    T: Send + 'static,
    F: FnOnce() -> T + Send + 'static,
{
    let (result_sender, result_receiver) = mpsc::sync_channel(1);
    let started = Instant::now();
    let mut worker = DeadlineThread::spawn(thread_name, move || {
        let result = panic::catch_unwind(AssertUnwindSafe(task));
        let _ = result_sender.send(result);
    })
    .map_err(|_error| BoundedTaskError::CannotStart)?;
    let result = match result_receiver.recv_timeout(deadline) {
        Ok(Ok(value)) => value,
        Ok(Err(_panic_payload)) => {
            finish_bounded_worker(&mut worker, deadline.saturating_sub(started.elapsed()))?;
            return Err(BoundedTaskError::Panicked);
        }
        Err(mpsc::RecvTimeoutError::Timeout) => {
            let _ = worker.finish(Duration::ZERO);
            return Err(BoundedTaskError::TimedOut);
        }
        Err(mpsc::RecvTimeoutError::Disconnected) => {
            let _ = worker.finish(deadline.saturating_sub(started.elapsed()));
            return Err(BoundedTaskError::Disconnected);
        }
    };
    finish_bounded_worker(&mut worker, deadline.saturating_sub(started.elapsed()))?;
    Ok(result)
}

fn finish_bounded_worker(
    worker: &mut DeadlineThread,
    timeout: Duration,
) -> Result<(), BoundedTaskError> {
    match worker.finish(timeout) {
        Ok(()) => Ok(()),
        Err(ThreadFinishError::TimedOut) => Err(BoundedTaskError::TimedOut),
        Err(ThreadFinishError::Panicked) => Err(BoundedTaskError::WorkerPanicked),
    }
}

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
        let wall_time_unix_ms = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_or(0, |duration| bounded_protocol_integer(duration.as_millis()));
        let monotonic_time_ns = bounded_protocol_integer(self.started_at.elapsed().as_nanos());
        SourceTimestamp {
            wall_time_unix_ms,
            monotonic_time_ns,
        }
    }
}

fn bounded_protocol_integer(value: u128) -> u64 {
    u64::try_from(value)
        .unwrap_or(MAX_PROTOCOL_SAFE_INTEGER)
        .min(MAX_PROTOCOL_SAFE_INTEGER)
}

#[derive(Debug)]
pub struct BoundedObservationQueue<T> {
    capacity: usize,
    next_sequence: u64,
    stopped: bool,
    observations: VecDeque<SequencedObservation<T>>,
    pending_gap: Option<SequenceGap>,
}

impl<T> BoundedObservationQueue<T> {
    /// Creates a fixed-capacity ordered observation queue.
    ///
    /// # Errors
    ///
    /// Returns [`QueueError::InvalidCapacity`] when capacity is less than two,
    /// because overflow needs room for both a surviving record and a new one.
    pub fn new(capacity: usize) -> Result<Self, QueueError> {
        if capacity < 2 {
            return Err(QueueError::InvalidCapacity);
        }
        Ok(Self {
            capacity,
            next_sequence: 1,
            stopped: false,
            observations: VecDeque::with_capacity(capacity),
            pending_gap: None,
        })
    }

    /// Adds one observation and assigns its monotonic source sequence.
    ///
    /// # Errors
    ///
    /// Returns [`QueueError::Stopped`] after disposal. An invalid internal
    /// capacity is also reported defensively rather than panicking.
    pub fn push(
        &mut self,
        observed_at: SourceTimestamp,
        payload: T,
    ) -> Result<QueuePushOutcome, QueueError> {
        if self.stopped {
            return Err(QueueError::Stopped);
        }
        let sequence = self.next_sequence;
        self.next_sequence = self.next_sequence.saturating_add(1);
        let dropped = if self.observations.len() == self.capacity {
            let Some(dropped) = self.observations.pop_front() else {
                return Err(QueueError::InvalidCapacity);
            };
            let first_missing = dropped
                .gap
                .as_ref()
                .map_or(dropped.sequence, |gap| gap.first_missing);
            let last_missing = dropped.sequence;
            let Some(next) = self.observations.front_mut() else {
                return Err(QueueError::InvalidCapacity);
            };
            let dropped = merge_gap(next.gap.take(), first_missing, last_missing);
            next.gap = Some(dropped.clone());
            Some(dropped)
        } else {
            None
        };
        self.observations.push_back(SequencedObservation {
            sequence,
            observed_at,
            gap: self.pending_gap.take(),
            payload,
        });
        Ok(QueuePushOutcome { sequence, dropped })
    }

    /// Reserves source sequence numbers for facts that could not be retained.
    /// The missing range is attached to the next observation that can be
    /// delivered.
    ///
    /// # Errors
    ///
    /// Returns [`QueueError::Stopped`] after disposal.
    pub fn record_missing(&mut self, count: u64) -> Result<Option<SequenceGap>, QueueError> {
        if self.stopped {
            return Err(QueueError::Stopped);
        }
        if count == 0 {
            return Ok(None);
        }
        let first_missing = self.next_sequence;
        let last_missing = first_missing.saturating_add(count.saturating_sub(1));
        self.next_sequence = last_missing.saturating_add(1);
        let gap = merge_gap(self.pending_gap.take(), first_missing, last_missing);
        self.pending_gap = Some(gap.clone());
        Ok(Some(gap))
    }

    pub fn drain(&mut self) -> Vec<SequencedObservation<T>> {
        self.observations.drain(..).collect()
    }

    pub fn stop(&mut self) {
        self.stopped = true;
        self.observations.clear();
        self.pending_gap = None;
    }

    #[must_use]
    pub fn is_stopped(&self) -> bool {
        self.stopped
    }

    #[must_use]
    pub fn capacity(&self) -> usize {
        self.capacity
    }

    #[must_use]
    pub fn len(&self) -> usize {
        self.observations.len()
    }

    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.observations.is_empty()
    }
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
    missing_count: u64,
    reason: String,
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
                wall_time_unix_ms: 0,
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

struct SourceSessionState<M: SourceModel> {
    clock: SourceClock,
    source_instance_id: String,
    opening: bool,
    accepting: bool,
    last_state: Option<M::State>,
    pending_before_snapshot: VecDeque<PendingInput<M::Input>>,
    dropped_before_snapshot: u64,
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
                dropped_before_snapshot: 0,
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
            if state.pending_before_snapshot.len() == state.facts.capacity() {
                state.pending_before_snapshot.pop_front();
                state.dropped_before_snapshot = state.dropped_before_snapshot.saturating_add(1);
            }
            state
                .pending_before_snapshot
                .push_back(PendingInput { input, observed_at });
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
    ) -> Result<(), M::Error> {
        M::validate_state(&initial_state)?;
        let mut state = lock_source_session(&self.state);
        state.opening = false;
        if state.terminal_error.is_none() {
            state.health = initial_health;
        }
        state.last_state = Some(initial_state.clone());
        if reset.is_some() && state.pending_before_snapshot.len() == state.facts.capacity() {
            state.pending_before_snapshot.pop_front();
            state.dropped_before_snapshot = state.dropped_before_snapshot.saturating_add(1);
        }
        if let Some(reset) = reset {
            record_source_reset::<M>(&mut state, reset)?;
        }
        let dropped = state.dropped_before_snapshot;
        state.dropped_before_snapshot = 0;
        if dropped > 0 {
            state
                .facts
                .record_missing(dropped)
                .map_err(M::queue_error)?;
        }
        let mut emitted_after_gap = false;
        while let Some(pending) = state.pending_before_snapshot.pop_front() {
            let before = state.facts.len();
            apply_source_input::<M>(&mut state, pending.input, pending.observed_at);
            emitted_after_gap |= state.facts.len() > before;
            if state.terminal_error.is_some() {
                break;
            }
        }
        if dropped > 0 && !emitted_after_gap {
            let observed_at = state.clock.now();
            push_source_observation::<M>(
                &mut state,
                M::final_observation(initial_state),
                observed_at,
            );
        }
        if dropped > 0 {
            fail_source_session(&mut state, M::overflow_error());
        }
        Ok(())
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

    pub fn report_missing(&self, count: u64) {
        if count == 0 {
            return;
        }
        let mut state = lock_source_session(&self.state);
        if state.facts.is_stopped() || state.terminal_error.is_some() {
            return;
        }
        if state.opening {
            state.dropped_before_snapshot = state.dropped_before_snapshot.saturating_add(count);
        } else {
            if let Err(error) = state.facts.record_missing(count) {
                fail_source_session(&mut state, M::queue_error(error));
                return;
            }
            if let Some(last_state) = state.last_state.clone() {
                let observed_at = state.clock.now();
                push_source_observation::<M>(
                    &mut state,
                    M::final_observation(last_state),
                    observed_at,
                );
            }
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
    let wall_nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |duration| duration.as_nanos());
    format!(
        "{wall_nanos:032x}{process_id:08x}{counter:016x}",
        process_id = std::process::id()
    )
}

fn merge_gap(existing: Option<SequenceGap>, first_missing: u64, last_missing: u64) -> SequenceGap {
    existing.map_or(
        SequenceGap {
            first_missing,
            last_missing,
        },
        |gap| SequenceGap {
            first_missing: gap.first_missing.min(first_missing),
            last_missing: gap.last_missing.max(last_missing),
        },
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn timestamp(value: u64) -> SourceTimestamp {
        SourceTimestamp {
            wall_time_unix_ms: value,
            monotonic_time_ns: value,
        }
    }

    #[test]
    fn bounded_task_returns_a_completed_value() {
        assert_eq!(
            run_bounded_task("bounded-task-success", Duration::from_secs(1), || 42),
            Ok(42)
        );
    }

    #[test]
    fn bounded_task_reports_panics_without_unwinding_the_caller() {
        assert_eq!(
            run_bounded_task("bounded-task-panic", Duration::from_secs(1), || {
                panic!("worker panic")
            }),
            Err(BoundedTaskError::Panicked)
        );
    }

    #[test]
    fn bounded_task_timeout_detaches_until_the_owner_releases_it() {
        let (release_sender, release_receiver) = mpsc::sync_channel(1);
        let (finished_sender, finished_receiver) = mpsc::sync_channel(1);
        let result = run_bounded_task(
            "bounded-task-timeout",
            Duration::from_millis(20),
            move || {
                let _ = release_receiver.recv();
                let _ = finished_sender.send(());
            },
        );

        assert_eq!(result, Err(BoundedTaskError::TimedOut));
        release_sender.send(()).expect("release detached worker");
        finished_receiver
            .recv_timeout(Duration::from_secs(1))
            .expect("detached worker exits after release");
    }

    #[test]
    fn bounded_source_stop_poisons_every_returned_error_category() {
        let poisoned = AtomicBool::new(false);
        let result = run_bounded_source_stop_with(
            "bounded-source-stop-error",
            Duration::from_secs(1),
            || Err::<(), _>("backend"),
            |_| "bounded",
            &|| poisoned.store(true, Ordering::Release),
        );

        assert_eq!(result, Err("backend"));
        assert!(poisoned.load(Ordering::Acquire));
    }

    #[test]
    fn bounded_source_stop_poisons_deadline_failures_before_mapping() {
        let (release_sender, release_receiver) = mpsc::sync_channel(1);
        let poisoned = AtomicBool::new(false);
        let result = run_bounded_source_stop_with(
            "bounded-source-stop-timeout",
            Duration::from_millis(20),
            move || {
                let _ = release_receiver.recv();
                Ok::<_, &'static str>(())
            },
            |_| "bounded",
            &|| poisoned.store(true, Ordering::Release),
        );

        assert_eq!(result, Err("bounded"));
        assert!(poisoned.load(Ordering::Acquire));
        release_sender.send(()).expect("release detached stop");
    }

    #[test]
    fn boundary_failure_takes_precedence_during_rollback() {
        assert_eq!(
            prefer_boundary_error("primary", Err::<(), _>("boundary")),
            "boundary"
        );
        assert_eq!(
            prefer_boundary_error("primary", Ok::<(), &str>(())),
            "primary"
        );
    }

    #[test]
    fn overflow_reports_the_complete_missing_range() {
        let mut queue = BoundedObservationQueue::new(2).expect("valid queue");
        queue.push(timestamp(1), "one").expect("push one");
        queue.push(timestamp(2), "two").expect("push two");
        let first_overflow = queue.push(timestamp(3), "three").expect("push three");
        let second_overflow = queue.push(timestamp(4), "four").expect("push four");

        assert_eq!(
            first_overflow.dropped,
            Some(SequenceGap {
                first_missing: 1,
                last_missing: 1,
            })
        );
        assert_eq!(
            second_overflow.dropped,
            Some(SequenceGap {
                first_missing: 1,
                last_missing: 2,
            })
        );

        let drained = queue.drain();
        assert_eq!(drained.len(), 2);
        assert_eq!(drained[0].sequence, 3);
        assert_eq!(
            drained[0].gap,
            Some(SequenceGap {
                first_missing: 1,
                last_missing: 2
            })
        );
        assert_eq!(drained[1].sequence, 4);
    }

    #[test]
    fn stop_is_idempotent_and_rejects_new_input() {
        let mut queue = BoundedObservationQueue::new(2).expect("valid queue");
        queue.stop();
        queue.stop();
        assert!(queue.is_stopped());
        assert_eq!(queue.push(timestamp(1), "late"), Err(QueueError::Stopped));
    }

    #[test]
    fn instance_identifiers_are_fresh_and_bounded() {
        let first = fresh_source_instance_id();
        let second = fresh_source_instance_id();
        assert_ne!(first, second);
        assert_eq!(first.len(), 56);
        assert!(first.bytes().all(|byte| byte.is_ascii_hexdigit()));
    }

    #[test]
    fn protocol_integer_conversion_saturates_at_the_wire_bound() {
        assert_eq!(bounded_protocol_integer(42), 42);
        assert_eq!(
            bounded_protocol_integer(u128::MAX),
            MAX_PROTOCOL_SAFE_INTEGER
        );
        assert_eq!(
            bounded_protocol_integer(u128::from(MAX_PROTOCOL_SAFE_INTEGER) + 1),
            MAX_PROTOCOL_SAFE_INTEGER
        );
    }

    #[test]
    fn reset_plan_validates_the_complete_synthetic_wire_boundary() {
        let plan = SourceResetPlan::new(2, "supervised-reopen".to_owned())
            .expect("representable reset plan");
        assert_eq!(plan.missing_count, 2);
        assert_eq!(plan.reason, "supervised-reopen");
        assert!(SourceResetPlan::new(u64::MAX, "supervised-reopen".to_owned()).is_err());
    }

    #[test]
    fn deadline_thread_reports_completion_and_panic() {
        let mut completed = DeadlineThread::spawn("completed-test", || {}).expect("spawn worker");
        assert_eq!(completed.finish(Duration::from_secs(1)), Ok(()));
        assert_eq!(completed.finish(Duration::from_secs(1)), Ok(()));

        let mut panicked =
            DeadlineThread::spawn("panic-test", || panic!("expected panic")).expect("spawn worker");
        assert_eq!(
            panicked.finish(Duration::from_secs(1)),
            Err(ThreadFinishError::Panicked)
        );
    }

    #[test]
    fn deadline_thread_times_out_without_joining_a_blocked_worker() {
        let (release_sender, release_receiver) = mpsc::sync_channel(1);
        let (finished_sender, finished_receiver) = mpsc::sync_channel(1);
        let mut blocked = DeadlineThread::spawn("blocked-test", move || {
            let _ = release_receiver.recv();
            let _ = finished_sender.send(());
        })
        .expect("spawn blocked worker");

        assert_eq!(
            blocked.finish(Duration::from_millis(25)),
            Err(ThreadFinishError::TimedOut)
        );
        release_sender.send(()).expect("release detached worker");
        finished_receiver
            .recv_timeout(Duration::from_secs(1))
            .expect("detached worker exits after release");
    }
}
