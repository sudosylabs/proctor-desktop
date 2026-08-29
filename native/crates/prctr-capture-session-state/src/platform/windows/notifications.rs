use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::mpsc::{SyncSender, TrySendError};
use std::sync::{Mutex, TryLockError};
use std::time::Instant;

use prctr_native_source_runtime::{SOURCE_CLEANUP_DEADLINE, poison_native_source_process};

use super::EventWakeup;
use crate::CaptureSessionError;

pub(super) struct NotificationState {
    sender: Mutex<Option<SyncSender<EventWakeup>>>,
    dropped_wakeups: AtomicU64,
    closed: AtomicBool,
    callbacks_in_flight: AtomicU64,
}

impl NotificationState {
    pub(super) fn new(sender: SyncSender<EventWakeup>) -> Self {
        Self {
            sender: Mutex::new(Some(sender)),
            dropped_wakeups: AtomicU64::new(0),
            closed: AtomicBool::new(false),
            callbacks_in_flight: AtomicU64::new(0),
        }
    }

    /// Callback-safe wakeup delivery: this path never waits for a lock or
    /// queue capacity. Any unrepresentable transition is counted exactly.
    pub(super) fn notify_transition(&self) {
        let _callback = CallbackGuard::enter(&self.callbacks_in_flight);
        if self.closed.load(Ordering::SeqCst) {
            return;
        }
        let sender = match self.sender.try_lock() {
            Ok(sender) => sender,
            Err(TryLockError::WouldBlock | TryLockError::Poisoned(_)) => {
                self.dropped_wakeups.fetch_add(1, Ordering::SeqCst);
                return;
            }
        };
        let Some(sender) = sender.as_ref() else {
            // This callback crossed the fence after observing the open state.
            // The fence waits for this guard before taking the final count.
            self.dropped_wakeups.fetch_add(1, Ordering::SeqCst);
            return;
        };
        if let Err(TrySendError::Full(_) | TrySendError::Disconnected(_)) =
            sender.try_send(EventWakeup::Transition)
        {
            self.dropped_wakeups.fetch_add(1, Ordering::SeqCst);
        }
    }

    /// Closes callback ingress and waits only outside native callbacks for all
    /// pre-fence callback bodies to retire.
    pub(super) fn fence(&self) -> Result<(), CaptureSessionError> {
        self.closed.store(true, Ordering::SeqCst);
        *self
            .sender
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner) = None;
        let started = Instant::now();
        while self.callbacks_in_flight.load(Ordering::SeqCst) != 0 {
            if started.elapsed() >= SOURCE_CLEANUP_DEADLINE {
                poison_native_source_process();
                return Err(CaptureSessionError::Cleanup(
                    "Windows WTS callbacks did not retire before the cleanup deadline; native utility restart is required".to_owned(),
                ));
            }
            std::thread::yield_now();
        }
        Ok(())
    }

    pub(super) fn take_dropped(&self) -> u64 {
        self.dropped_wakeups.swap(0, Ordering::SeqCst)
    }
}

struct CallbackGuard<'a> {
    callbacks_in_flight: &'a AtomicU64,
}

impl<'a> CallbackGuard<'a> {
    fn enter(callbacks_in_flight: &'a AtomicU64) -> Self {
        callbacks_in_flight.fetch_add(1, Ordering::SeqCst);
        Self {
            callbacks_in_flight,
        }
    }
}

impl Drop for CallbackGuard<'_> {
    fn drop(&mut self) {
        self.callbacks_in_flight.fetch_sub(1, Ordering::SeqCst);
    }
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;
    use std::sync::mpsc;
    use std::thread;
    use std::time::{Duration, Instant};

    use super::*;

    #[test]
    fn fence_waits_for_prefence_callback_before_final_loss_count() {
        let (event_sender, _event_receiver) = mpsc::sync_channel(2);
        let state = Arc::new(NotificationState::new(event_sender));
        let (entered_sender, entered_receiver) = mpsc::sync_channel(1);
        let (release_sender, release_receiver) = mpsc::sync_channel(1);
        let callback_state = Arc::clone(&state);
        let callback = thread::spawn(move || {
            let _guard = CallbackGuard::enter(&callback_state.callbacks_in_flight);
            assert!(!callback_state.closed.load(Ordering::SeqCst));
            entered_sender.send(()).expect("callback entered");
            release_receiver.recv().expect("callback released");
            callback_state
                .dropped_wakeups
                .fetch_add(1, Ordering::SeqCst);
        });
        entered_receiver.recv().expect("callback is in flight");

        let fence_state = Arc::clone(&state);
        let (fenced_sender, fenced_receiver) = mpsc::sync_channel(1);
        let fence = thread::spawn(move || {
            fenced_sender
                .send(fence_state.fence())
                .expect("return fence result");
        });
        let closed_deadline = Instant::now() + Duration::from_secs(1);
        while !state.closed.load(Ordering::SeqCst) && Instant::now() < closed_deadline {
            thread::yield_now();
        }
        assert!(state.closed.load(Ordering::SeqCst));
        assert!(matches!(
            fenced_receiver.recv_timeout(Duration::from_millis(20)),
            Err(mpsc::RecvTimeoutError::Timeout)
        ));
        release_sender.send(()).expect("release callback");
        callback.join().expect("callback finishes");
        fenced_receiver
            .recv_timeout(Duration::from_secs(1))
            .expect("fence finishes")
            .expect("fence succeeds");
        fence.join().expect("fence thread finishes");

        assert_eq!(state.take_dropped(), 1);
        state.notify_transition();
        assert_eq!(state.take_dropped(), 0);
    }
}
