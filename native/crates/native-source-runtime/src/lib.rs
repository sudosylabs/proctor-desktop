#![forbid(unsafe_code)]

use std::collections::{VecDeque, hash_map::RandomState};
use std::fmt;
use std::fs::File;
use std::hash::{BuildHasher, Hash, Hasher};
use std::io::{self, Read};
use std::marker::PhantomData;
use std::panic::{self, AssertUnwindSafe};
use std::path::Path;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::mpsc::{self, Receiver};
use std::sync::{Arc, LazyLock, Mutex};
use std::thread;
use std::time::Duration;
use std::time::Instant;

use native_protocol::{
    MAX_PROTOCOL_SAFE_INTEGER, PermissionState, PlatformFamily, ProtocolValidatable,
    ProtocolValidationError, ProtocolViolation, SequenceGap, SourceFailureCode, SourceHealth,
    SourceOpenRequest, SourceReset, SourceTimestamp,
};

static INSTANCE_COUNTER: AtomicU64 = AtomicU64::new(1);
static INSTANCE_ENTROPY: LazyLock<RandomState> = LazyLock::new(RandomState::new);
static NATIVE_SOURCE_PROCESS_POISONED: AtomicBool = AtomicBool::new(false);

pub const SOURCE_CLEANUP_DEADLINE: Duration = Duration::from_millis(500);

#[derive(Debug)]
pub enum BoundedFileReadError {
    Io(io::Error),
    Overflow { max_bytes: usize },
    InvalidUtf8,
}

impl fmt::Display for BoundedFileReadError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Io(error) => write!(formatter, "file read failed: {error}"),
            Self::Overflow { max_bytes } => {
                write!(formatter, "file exceeds its {max_bytes}-byte bound")
            }
            Self::InvalidUtf8 => formatter.write_str("file is not valid UTF-8"),
        }
    }
}

impl std::error::Error for BoundedFileReadError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            Self::Io(error) => Some(error),
            Self::Overflow { .. } | Self::InvalidUtf8 => None,
        }
    }
}

/// Reads at most one byte beyond a fixed file boundary without trusting file metadata.
///
/// # Errors
///
/// Returns [`BoundedFileReadError::Io`] when the file cannot be opened or read,
/// or [`BoundedFileReadError::Overflow`] when actual content exceeds `max_bytes`.
pub fn read_bounded_file(path: &Path, max_bytes: usize) -> Result<Vec<u8>, BoundedFileReadError> {
    let file = File::open(path).map_err(BoundedFileReadError::Io)?;
    read_bounded(file, max_bytes)
}

/// Reads a fixed-size UTF-8 platform record without trusting file metadata.
///
/// # Errors
///
/// Returns the bounded byte-reader failures or
/// [`BoundedFileReadError::InvalidUtf8`] for malformed text.
pub fn read_bounded_utf8_file(
    path: &Path,
    max_bytes: usize,
) -> Result<String, BoundedFileReadError> {
    String::from_utf8(read_bounded_file(path, max_bytes)?)
        .map_err(|_error| BoundedFileReadError::InvalidUtf8)
}

fn read_bounded(reader: impl Read, max_bytes: usize) -> Result<Vec<u8>, BoundedFileReadError> {
    let read_limit = max_bytes
        .checked_add(1)
        .ok_or(BoundedFileReadError::Overflow { max_bytes })?;
    let mut bytes = Vec::new();
    reader
        .take(u64::try_from(read_limit).unwrap_or(u64::MAX))
        .read_to_end(&mut bytes)
        .map_err(BoundedFileReadError::Io)?;
    if bytes.len() > max_bytes {
        return Err(BoundedFileReadError::Overflow { max_bytes });
    }
    Ok(bytes)
}

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
    completion: Receiver<Result<(), ThreadFinishError>>,
    joined: Arc<AtomicBool>,
    observed: Option<Result<(), ThreadFinishError>>,
}

impl DeadlineThread {
    /// Starts a resource-owning worker and establishes its join owner before
    /// releasing the task. Completion means actual OS join, including TLS drops.
    ///
    /// # Errors
    /// Returns a thread-creation error. Failure to create the join owner fences
    /// this process and never releases the task to perform native work.
    pub fn spawn<F>(name: &str, task: F) -> Result<Self, io::Error>
    where
        F: FnOnce() + Send + 'static,
    {
        let (release, gate) = mpsc::sync_channel(1);
        let worker = thread::Builder::new()
            .name(name.to_owned())
            .spawn(move || {
                if gate.recv().is_ok() {
                    task();
                }
            })?;
        let (sender, completion) = mpsc::sync_channel(1);
        let joined = Arc::new(AtomicBool::new(false));
        let observed_join = Arc::clone(&joined);
        if let Err(error) = thread::Builder::new()
            .name("source-join".to_owned())
            .spawn(move || {
                let result = worker.join().map_err(|_| ThreadFinishError::Panicked);
                observed_join.store(true, Ordering::Release);
                let _ = sender.send(result);
            })
        {
            poison_native_source_process();
            return Err(error);
        }
        release.send(()).map_err(|_| {
            poison_native_source_process();
            io::Error::other("native source worker release failed")
        })?;
        Ok(Self {
            completion,
            joined,
            observed: None,
        })
    }

    /// Tests the actual OS join receipt without blocking or consuming it.
    #[must_use]
    pub fn is_finished(&self) -> bool {
        self.joined.load(Ordering::Acquire)
    }

    /// Waits at most `timeout` for proof that the resource-owning thread exited.
    /// The caller never joins the waiter. A timeout preserves the receipt so a
    /// later cleanup check cannot mistake an abandoned handle for proved exit.
    ///
    /// # Errors
    /// Returns [`ThreadFinishError::TimedOut`] at the deadline or
    /// [`ThreadFinishError::Panicked`] after an unwinding worker exits.
    pub fn finish(&mut self, timeout: Duration) -> Result<(), ThreadFinishError> {
        if let Some(result) = self.observed {
            return result;
        }
        let result = match self.completion.recv_timeout(timeout) {
            Ok(result) => result,
            Err(mpsc::RecvTimeoutError::Disconnected) => Err(ThreadFinishError::Panicked),
            Err(mpsc::RecvTimeoutError::Timeout) => return Err(ThreadFinishError::TimedOut),
        };
        self.observed = Some(result);
        result
    }
}

/// Runs one owned task behind a hard wait deadline.
///
/// A separate owner acknowledges the actual OS join, including thread-local
/// cleanup. A timeout returns without joining the waiter so the privileged
/// caller can fail closed and replace its process instead of blocking.
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
    let worker = DeadlineThread::spawn(thread_name, move || {
        let result = panic::catch_unwind(AssertUnwindSafe(task));
        let _ = result_sender.send(result);
    })
    .map_err(|_error| BoundedTaskError::CannotStart)?;
    collect_bounded_task_result(worker, &result_receiver, started, deadline)
}

fn collect_bounded_task_result<T>(
    mut worker: DeadlineThread,
    result_receiver: &Receiver<thread::Result<T>>,
    started: Instant,
    deadline: Duration,
) -> Result<T, BoundedTaskError> {
    // Thread creation and actual-join acknowledgement share the original budget.
    // recv_timeout(0) may still deliver queued data: that is not a timely receipt.
    if started.elapsed() >= deadline {
        let _ = worker.finish(Duration::ZERO);
        return Err(BoundedTaskError::TimedOut);
    }
    let result = match result_receiver.recv_timeout(deadline.saturating_sub(started.elapsed())) {
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
    if started.elapsed() >= deadline {
        return Err(BoundedTaskError::TimedOut);
    }
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
        let monotonic_time_ns = bounded_protocol_integer(self.started_at.elapsed().as_nanos());
        SourceTimestamp { monotonic_time_ns }
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
    last_observed_at_ns: u64,
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
            last_observed_at_ns: 0,
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
        mut observed_at: SourceTimestamp,
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
        observed_at.monotonic_time_ns = observed_at.monotonic_time_ns.max(self.last_observed_at_ns);
        self.last_observed_at_ns = observed_at.monotonic_time_ns;
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

/// Shared failure vocabulary for bounded full-state native observation sources.
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

    const SCHEMA_VERSION: u16;
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

enum PassiveStateInput<W: PassiveStateWire> {
    State(PassiveStateEventKind, W::State),
}

struct PassiveStateModel<W: PassiveStateWire>(PhantomData<W>);

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
    session: SourceSession<PassiveStateModel<W>>,
}

impl<W: PassiveStateWire> Clone for PassiveStateEmitter<W> {
    fn clone(&self) -> Self {
        Self {
            session: self.session.clone(),
        }
    }
}

impl<W: PassiveStateWire> PassiveStateEmitter<W> {
    fn new(queue_capacity: usize) -> Result<Self, PassiveStateSourceError> {
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

pub struct UnavailablePassiveStateBackend<W: PassiveStateWire> {
    platform: PlatformFamily,
    adapter_version: &'static str,
    wire: PhantomData<W>,
}

/// A passive source whose complete mechanical state is immutable for the life
/// of the utility process. Capability crates must use this only for facts that
/// cannot transition without restarting that process (for example, the current
/// guest/root virtualization classification).
pub struct StaticPassiveStateBackend<W: PassiveStateWire> {
    platform: PlatformFamily,
    permission: PermissionState,
    adapter_version: &'static str,
    state: W::State,
}

impl<W: PassiveStateWire> StaticPassiveStateBackend<W> {
    #[must_use]
    pub const fn new(
        platform: PlatformFamily,
        permission: PermissionState,
        adapter_version: &'static str,
        state: W::State,
    ) -> Self {
        Self {
            platform,
            permission,
            adapter_version,
            state,
        }
    }
}

pub struct StaticPassiveStateSubscription<W: PassiveStateWire> {
    final_state: W::State,
}

/// Shared bounded reconciliation polling for adapters whose declared coverage
/// is snapshot-only. It coalesces equal states and never upgrades polling into
/// a notification/lifecycle claim.
type PassiveStateQuery<W> =
    dyn Fn() -> Result<<W as PassiveStateWire>::State, PassiveStateSourceError> + Send + Sync;

pub struct PollingPassiveStateBackend<W: PassiveStateWire> {
    platform: PlatformFamily,
    permission: PermissionState,
    adapter_version: &'static str,
    interval: Duration,
    query: Arc<PassiveStateQuery<W>>,
    wire: PhantomData<W>,
}

#[derive(Clone, Copy)]
enum PollingWorkerCommand {
    Start,
    Stop,
}

impl<W: PassiveStateWire> PollingPassiveStateBackend<W> {
    #[must_use]
    pub fn new<Q>(
        platform: PlatformFamily,
        permission: PermissionState,
        adapter_version: &'static str,
        interval: Duration,
        query: Q,
    ) -> Self
    where
        Q: Fn() -> Result<W::State, PassiveStateSourceError> + Send + Sync + 'static,
    {
        Self {
            platform,
            permission,
            adapter_version,
            interval,
            query: Arc::new(query),
            wire: PhantomData,
        }
    }

    /// Starts reconciliation before the authoritative initial query and
    /// degrades only an ordinary query-time backend discovery failure to the
    /// supplied explicit unavailable state. Worker startup and every other
    /// error category remain terminal.
    ///
    /// # Errors
    ///
    /// Returns a setup, boundedness, query, or cleanup failure.
    pub fn open_with_initial_backend_fallback(
        self,
        emitter: PassiveStateEmitter<W>,
        fallback_adapter_version: &'static str,
        fallback_state: W::State,
    ) -> Result<
        OpenedPassiveStateBackend<W, InitialFallbackPollingSubscription<W>>,
        PassiveStateSourceError,
    > {
        let (stop_sender, mut worker) = self.start_worker(emitter.clone())?;
        match (self.query)() {
            Ok(initial_state) => {
                release_poll_worker(&stop_sender, &mut worker)?;
                Ok(OpenedPassiveStateBackend {
                    platform: self.platform,
                    permission: self.permission,
                    adapter_version: self.adapter_version,
                    initial_state,
                    subscription: InitialFallbackPollingSubscription::Polling(
                        PollingPassiveStateSubscription::<W> {
                            stop_sender,
                            worker,
                            query: self.query,
                            wire: PhantomData,
                        },
                    ),
                })
            }
            Err(error) if error.allows_initial_unavailable_fallback() => {
                stop_opening_poll_worker(&stop_sender, &mut worker)?;
                let opened = StaticPassiveStateBackend::new(
                    self.platform,
                    PermissionState::Unavailable,
                    fallback_adapter_version,
                    fallback_state,
                )
                .open(emitter)?;
                Ok(OpenedPassiveStateBackend {
                    platform: opened.platform,
                    permission: opened.permission,
                    adapter_version: opened.adapter_version,
                    initial_state: opened.initial_state,
                    subscription: InitialFallbackPollingSubscription::Static(opened.subscription),
                })
            }
            Err(error) => Err(prefer_boundary_error(
                error,
                stop_opening_poll_worker(&stop_sender, &mut worker),
            )),
        }
    }

    fn start_worker(
        &self,
        emitter: PassiveStateEmitter<W>,
    ) -> Result<(mpsc::SyncSender<PollingWorkerCommand>, DeadlineThread), PassiveStateSourceError>
    {
        if self.interval.is_zero() || self.interval > Duration::from_secs(60) {
            return Err(PassiveStateSourceError::Backend(
                "polling interval is outside the bounded source range".to_owned(),
            ));
        }
        // Capacity two guarantees an immediate Stop can follow Start even if
        // the newly spawned worker has not consumed the release command yet.
        let (control_sender, control_receiver) = mpsc::sync_channel(2);
        let worker_query = Arc::clone(&self.query);
        let worker_emitter = emitter;
        let interval = self.interval;
        let worker = DeadlineThread::spawn(W::STOP_THREAD_NAME, move || {
            let result = panic::catch_unwind(AssertUnwindSafe(|| {
                match control_receiver.recv() {
                    Ok(PollingWorkerCommand::Start) => {}
                    Ok(PollingWorkerCommand::Stop) | Err(_) => return,
                }
                loop {
                    match control_receiver.recv_timeout(interval) {
                        Ok(PollingWorkerCommand::Stop)
                        | Err(mpsc::RecvTimeoutError::Disconnected) => break,
                        Ok(PollingWorkerCommand::Start) => {}
                        Err(mpsc::RecvTimeoutError::Timeout) => match worker_query() {
                            Ok(state) => worker_emitter.observe(state),
                            Err(error) => {
                                worker_emitter.fail(error);
                                break;
                            }
                        },
                    }
                }
            }));
            if result.is_err() {
                worker_emitter.fail(PassiveStateSourceError::Backend(
                    "polling source worker panicked".to_owned(),
                ));
            }
        })
        .map_err(|error| {
            PassiveStateSourceError::Backend(format!("cannot start polling source worker: {error}"))
        })?;
        Ok((control_sender, worker))
    }
}

pub enum InitialFallbackPollingSubscription<W: PassiveStateWire> {
    Polling(PollingPassiveStateSubscription<W>),
    Static(StaticPassiveStateSubscription<W>),
}

impl<W: PassiveStateWire> PassiveStateSubscription<W> for InitialFallbackPollingSubscription<W> {
    fn stop(self) -> Result<W::State, PassiveStateSourceError> {
        match self {
            Self::Polling(subscription) => subscription.stop(),
            Self::Static(subscription) => subscription.stop(),
        }
    }
}

pub struct PollingPassiveStateSubscription<W: PassiveStateWire> {
    stop_sender: mpsc::SyncSender<PollingWorkerCommand>,
    worker: DeadlineThread,
    query: Arc<PassiveStateQuery<W>>,
    wire: PhantomData<W>,
}

impl<W: PassiveStateWire> PassiveStateSubscription<W> for PollingPassiveStateSubscription<W> {
    fn stop(mut self) -> Result<W::State, PassiveStateSourceError> {
        let _ = self.stop_sender.try_send(PollingWorkerCommand::Stop);
        self.worker
            .finish(Duration::from_millis(400))
            .map_err(|error| {
                poison_native_source_process();
                PassiveStateSourceError::Cleanup(format!(
                    "polling source worker {error}; native utility restart is required"
                ))
            })?;
        (self.query)()
    }
}

impl<W: PassiveStateWire> PassiveStateBackend<W> for PollingPassiveStateBackend<W> {
    type Subscription = PollingPassiveStateSubscription<W>;

    fn open(
        self,
        emitter: PassiveStateEmitter<W>,
    ) -> Result<OpenedPassiveStateBackend<W, Self::Subscription>, PassiveStateSourceError> {
        let (stop_sender, mut worker) = self.start_worker(emitter)?;
        let initial_state = match (self.query)() {
            Ok(state) => state,
            Err(primary) => {
                return Err(prefer_boundary_error(
                    primary,
                    stop_opening_poll_worker(&stop_sender, &mut worker),
                ));
            }
        };
        release_poll_worker(&stop_sender, &mut worker)?;
        Ok(OpenedPassiveStateBackend {
            platform: self.platform,
            permission: self.permission,
            adapter_version: self.adapter_version,
            initial_state,
            subscription: PollingPassiveStateSubscription::<W> {
                stop_sender,
                worker,
                query: self.query,
                wire: PhantomData,
            },
        })
    }
}

fn stop_opening_poll_worker(
    stop_sender: &mpsc::SyncSender<PollingWorkerCommand>,
    worker: &mut DeadlineThread,
) -> Result<(), PassiveStateSourceError> {
    let _ = stop_sender.try_send(PollingWorkerCommand::Stop);
    worker.finish(Duration::from_millis(400)).map_err(|error| {
        poison_native_source_process();
        PassiveStateSourceError::Cleanup(format!(
            "polling source rollback {error}; native utility restart is required"
        ))
    })
}

fn release_poll_worker(
    control_sender: &mpsc::SyncSender<PollingWorkerCommand>,
    worker: &mut DeadlineThread,
) -> Result<(), PassiveStateSourceError> {
    control_sender
        .try_send(PollingWorkerCommand::Start)
        .map_err(|error| {
            let primary = PassiveStateSourceError::Backend(format!(
                "cannot release polling source worker: {error}"
            ));
            prefer_boundary_error(primary, stop_opening_poll_worker(control_sender, worker))
        })
}

impl<W: PassiveStateWire> PassiveStateSubscription<W> for StaticPassiveStateSubscription<W> {
    fn stop(self) -> Result<W::State, PassiveStateSourceError> {
        Ok(self.final_state)
    }
}

impl<W: PassiveStateWire> PassiveStateBackend<W> for StaticPassiveStateBackend<W> {
    type Subscription = StaticPassiveStateSubscription<W>;

    fn open(
        self,
        _emitter: PassiveStateEmitter<W>,
    ) -> Result<OpenedPassiveStateBackend<W, Self::Subscription>, PassiveStateSourceError> {
        Ok(OpenedPassiveStateBackend {
            platform: self.platform,
            permission: self.permission,
            adapter_version: self.adapter_version,
            initial_state: self.state.clone(),
            subscription: StaticPassiveStateSubscription {
                final_state: self.state,
            },
        })
    }
}

impl<W: PassiveStateWire> UnavailablePassiveStateBackend<W> {
    #[must_use]
    pub const fn new(platform: PlatformFamily, adapter_version: &'static str) -> Self {
        Self {
            platform,
            adapter_version,
            wire: PhantomData,
        }
    }
}

pub struct UnavailablePassiveStateSubscription<W: PassiveStateWire> {
    final_state: W::State,
}

impl<W: PassiveStateWire> PassiveStateSubscription<W> for UnavailablePassiveStateSubscription<W> {
    fn stop(self) -> Result<W::State, PassiveStateSourceError> {
        Ok(self.final_state)
    }
}

impl<W: PassiveStateWire> PassiveStateBackend<W> for UnavailablePassiveStateBackend<W> {
    type Subscription = UnavailablePassiveStateSubscription<W>;

    fn open(
        self,
        _emitter: PassiveStateEmitter<W>,
    ) -> Result<OpenedPassiveStateBackend<W, Self::Subscription>, PassiveStateSourceError> {
        let state = W::unavailable_state();
        Ok(OpenedPassiveStateBackend {
            platform: self.platform,
            permission: PermissionState::Unavailable,
            adapter_version: self.adapter_version,
            initial_state: state.clone(),
            subscription: UnavailablePassiveStateSubscription { final_state: state },
        })
    }
}

fn passive_state_drain<W: PassiveStateWire>(
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

fn passive_state_stop_subscription<W, S>(
    subscription: S,
) -> Result<W::State, PassiveStateSourceError>
where
    W: PassiveStateWire,
    S: PassiveStateSubscription<W>,
{
    run_bounded_source_stop(
        W::STOP_THREAD_NAME,
        move || subscription.stop(),
        |error| {
            PassiveStateSourceError::Cleanup(format!(
                "observer shutdown {error}; native utility restart is required"
            ))
        },
    )
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
mod tests;
