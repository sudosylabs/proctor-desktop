//! The reconciliation loop most sources share: read the OS every interval and wake the agent when
//! the reading changes. Readings are compared, never forwarded: the agent asks the source for the
//! full state, so a lost wake-up costs nothing.

use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::thread::{self, JoinHandle};
use std::time::Duration;

use prctr_core::{Sink, SourceError, SourceEvent};

/// A running loop; stopping it is prompt and waits for the thread to end.
pub struct Poller {
    stop: Arc<AtomicBool>,
    thread: JoinHandle<()>,
}

impl Poller {
    /// Starts reading every `interval`. `first` is the reading taken before the loop starts, so a
    /// change between it and the first loop iteration is still seen.
    ///
    /// # Errors
    /// When the thread cannot be started.
    pub fn start<T, F>(
        name: &str,
        interval: Duration,
        first: T,
        mut read: F,
        sink: Sink,
    ) -> Result<Self, SourceError>
    where
        T: PartialEq + Send + 'static,
        F: FnMut() -> T + Send + 'static,
    {
        let stop = Arc::new(AtomicBool::new(false));
        let thread_stop = Arc::clone(&stop);
        let thread = thread::Builder::new()
            .name(name.to_owned())
            .spawn(move || {
                let mut last = first;
                while !thread_stop.load(Ordering::Acquire) {
                    thread::park_timeout(interval);
                    if thread_stop.load(Ordering::Acquire) {
                        return;
                    }
                    let now = read();
                    if now != last {
                        last = now;
                        sink(SourceEvent::Changed);
                    }
                }
            })
            .map_err(|_| SourceError {
                reason: "cannot start a capability poller",
            })?;
        Ok(Self { stop, thread })
    }

    pub fn stop(self) {
        self.stop.store(true, Ordering::Release);
        self.thread.thread().unpark();
        let _ = self.thread.join();
    }
}

#[cfg(test)]
mod tests {
    use std::sync::atomic::AtomicU64;
    use std::sync::mpsc;

    use super::*;

    #[test]
    fn a_changed_reading_wakes_the_agent_and_an_unchanged_one_does_not() {
        let value = Arc::new(AtomicU64::new(1));
        let reader = Arc::clone(&value);
        let (sender, receiver) = mpsc::channel();
        let sink: Sink = Arc::new(move |event| {
            let _ = sender.send(matches!(event, SourceEvent::Changed));
        });
        let poller = Poller::start(
            "test-poller",
            Duration::from_millis(5),
            1_u64,
            move || reader.load(Ordering::Acquire),
            sink,
        )
        .expect("starts");
        assert!(
            receiver.recv_timeout(Duration::from_millis(60)).is_err(),
            "no change, no wake-up"
        );
        value.store(2, Ordering::Release);
        assert_eq!(receiver.recv_timeout(Duration::from_secs(2)), Ok(true));
        poller.stop();
    }
}
