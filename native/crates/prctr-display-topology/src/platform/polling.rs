use std::panic::{self, AssertUnwindSafe};
use std::sync::{Arc, Condvar, Mutex};
use std::time::Duration;

use prctr_native_protocol::DisplayTopologySnapshot;
use prctr_native_source_runtime::DeadlineThread;

use crate::{
    DisplayTopologyEmitter, DisplayTopologyError, DisplayTopologySubscription,
    final_snapshot_with_deadline, finish_native_thread,
};

pub struct PollingSubscription {
    stopped: Arc<(Mutex<bool>, Condvar)>,
    thread: Option<DeadlineThread>,
    snapshot: Arc<dyn Fn() -> Result<DisplayTopologySnapshot, DisplayTopologyError> + Send + Sync>,
    final_result: Option<Result<DisplayTopologySnapshot, DisplayTopologyError>>,
}

impl PollingSubscription {
    pub(super) fn start<F>(
        emitter: DisplayTopologyEmitter,
        interval: Duration,
        snapshot: F,
    ) -> Result<Self, DisplayTopologyError>
    where
        F: Fn() -> Result<DisplayTopologySnapshot, DisplayTopologyError> + Send + Sync + 'static,
    {
        let stopped = Arc::new((Mutex::new(false), Condvar::new()));
        let thread_stopped = Arc::clone(&stopped);
        let worker_emitter = emitter.clone();
        let snapshot: Arc<
            dyn Fn() -> Result<DisplayTopologySnapshot, DisplayTopologyError> + Send + Sync,
        > = Arc::new(snapshot);
        let worker_snapshot = Arc::clone(&snapshot);
        let thread = DeadlineThread::spawn("prctr-display-topology-polling", move || {
            let result = panic::catch_unwind(AssertUnwindSafe(|| {
                loop {
                    let (lock, wake) = &*thread_stopped;
                    let guard = lock
                        .lock()
                        .unwrap_or_else(std::sync::PoisonError::into_inner);
                    let (guard, _) = wake
                        .wait_timeout_while(guard, interval, |stopped| !*stopped)
                        .unwrap_or_else(std::sync::PoisonError::into_inner);
                    if *guard {
                        break;
                    }
                    drop(guard);
                    worker_emitter.emit(worker_snapshot());
                }
            }));
            if result.is_err() {
                worker_emitter.fail(DisplayTopologyError::Backend(
                    "display polling worker panicked".to_owned(),
                ));
            }
        })
        .map_err(|error| {
            DisplayTopologyError::Backend(format!("cannot start display polling worker: {error}"))
        })?;
        Ok(Self {
            stopped,
            thread: Some(thread),
            snapshot,
            final_result: None,
        })
    }

    pub(super) fn stop_resources(&mut self) -> Result<(), DisplayTopologyError> {
        let (lock, wake) = &*self.stopped;
        *lock
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner) = true;
        wake.notify_all();
        if let Some(mut thread) = self.thread.take() {
            finish_native_thread(&mut thread, "display polling worker")?;
        }
        Ok(())
    }
}

impl DisplayTopologySubscription for PollingSubscription {
    fn stop(&mut self) -> Result<DisplayTopologySnapshot, DisplayTopologyError> {
        if let Some(result) = &self.final_result {
            return result.clone();
        }
        let result = (|| {
            self.stop_resources()?;
            let snapshot = Arc::clone(&self.snapshot);
            final_snapshot_with_deadline(
                "prctr-display-topology-final-poll",
                "display polling",
                move || snapshot(),
            )
        })();
        self.final_result = Some(result.clone());
        result
    }
}

impl Drop for PollingSubscription {
    fn drop(&mut self) {
        let _ = DisplayTopologySubscription::stop(self);
    }
}
