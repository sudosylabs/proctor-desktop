//! Deadline-bounded worker threads and the process-wide poison fence that
//! stops new sources from opening once a worker cannot be proved to have exited.

use std::fmt;
use std::io;
use std::panic::{self, AssertUnwindSafe};
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{self, Receiver};
use std::thread;
use std::time::{Duration, Instant};

static NATIVE_SOURCE_PROCESS_POISONED: AtomicBool = AtomicBool::new(false);

/// How long any source gets to prove that its privileged input has stopped.
pub const SOURCE_CLEANUP_DEADLINE: Duration = Duration::from_millis(500);

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ThreadFinishError {
    Panicked,
    TimedOut,
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

pub(crate) fn run_bounded_source_stop_with<T, E, F, M, P>(
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

pub(crate) fn collect_bounded_task_result<T>(
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
