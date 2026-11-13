//! OS interruptions that end every capability's stream: sleep, screen lock and user switch. A
//! watcher samples the OS every second and reports transitions; the agent then marks every stream
//! as a gap and re-reads every source. Resuming, unlocking and switching back are not
//! interruptions: the fresh states after them say what is true.
//! Contract: `docs/architecture/native-capabilities.md`, "interruptions".

use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::thread::{self, JoinHandle};
use std::time::Duration;

use prctr_protocol::facts::InterruptionKind;

/// How often the OS is sampled.
pub const SAMPLE_INTERVAL: Duration = Duration::from_secs(1);
/// Suspended time that grows by at least this much between two samples is a sleep.
pub const SLEEP_THRESHOLD_NS: u64 = 2_000_000_000;

/// One reading. `None` where the platform cannot tell.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Sample {
    /// Time spent suspended since boot.
    pub suspended_ns: Option<u64>,
    /// The agent's session owns the physical console.
    pub on_console: Option<bool>,
    pub locked: Option<bool>,
}

/// Turns consecutive samples into interruptions. The first sample is the starting state, never
/// an interruption.
#[derive(Debug, Default)]
pub struct Detector {
    previous: Option<Sample>,
}

impl Detector {
    pub fn observe(&mut self, now: Sample) -> Vec<InterruptionKind> {
        let Some(before) = self.previous.replace(now) else {
            return Vec::new();
        };
        let mut found = Vec::new();
        if let (Some(before), Some(now)) = (before.suspended_ns, now.suspended_ns)
            && now.saturating_sub(before) >= SLEEP_THRESHOLD_NS
        {
            found.push(InterruptionKind::Sleep);
        }
        if before.locked == Some(false) && now.locked == Some(true) {
            found.push(InterruptionKind::ScreenLock);
        }
        if before.on_console == Some(true) && now.on_console == Some(false) {
            found.push(InterruptionKind::UserSwitch);
        }
        found
    }
}

/// One sample of this machine.
#[must_use]
pub fn sample() -> Sample {
    #[cfg(target_os = "macos")]
    let (suspended_ns, session) = (prctr_os::macos::suspended_ns(), prctr_os::macos::session());
    #[cfg(target_os = "windows")]
    let (suspended_ns, session) = (
        prctr_os::windows::suspended_ns(),
        prctr_os::windows::session(),
    );
    #[cfg(target_os = "linux")]
    let (suspended_ns, session) = (prctr_os::linux::suspended_ns(), prctr_os::linux::session());
    #[cfg(any(target_os = "macos", target_os = "windows", target_os = "linux"))]
    return Sample {
        suspended_ns,
        on_console: session.on_console,
        locked: session.locked,
    };
    #[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
    Sample::default()
}

/// A running watcher; dropping it stops the thread.
pub struct Watcher {
    stop: Arc<AtomicBool>,
    thread: Option<JoinHandle<()>>,
}

impl Watcher {
    /// Samples with `read` every [`SAMPLE_INTERVAL`] and calls `report` for each interruption.
    ///
    /// # Errors
    /// When the thread cannot be started.
    pub fn start(
        mut read: impl FnMut() -> Sample + Send + 'static,
        report: impl Fn(InterruptionKind) + Send + 'static,
    ) -> std::io::Result<Self> {
        let stop = Arc::new(AtomicBool::new(false));
        let thread_stop = Arc::clone(&stop);
        let thread = thread::Builder::new()
            .name("prctr-interruptions".to_owned())
            .spawn(move || {
                let mut detector = Detector::default();
                detector.observe(read());
                while !thread_stop.load(Ordering::Acquire) {
                    thread::park_timeout(SAMPLE_INTERVAL);
                    if thread_stop.load(Ordering::Acquire) {
                        return;
                    }
                    for kind in detector.observe(read()) {
                        report(kind);
                    }
                }
            })?;
        Ok(Self {
            stop,
            thread: Some(thread),
        })
    }
}

impl Drop for Watcher {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::Release);
        if let Some(thread) = self.thread.take() {
            thread.thread().unpark();
            let _ = thread.join();
        }
    }
}

#[cfg(test)]
mod tests {
    use std::sync::Mutex;
    use std::sync::mpsc;

    use super::*;

    fn at(suspended_ns: u64, on_console: bool, locked: bool) -> Sample {
        Sample {
            suspended_ns: Some(suspended_ns),
            on_console: Some(on_console),
            locked: Some(locked),
        }
    }

    #[test]
    fn the_first_sample_is_the_starting_state() {
        let mut detector = Detector::default();
        assert!(
            detector.observe(at(0, false, true)).is_empty(),
            "already locked at start"
        );
    }

    #[test]
    fn grown_suspended_time_is_a_sleep_and_small_drift_is_not() {
        let mut detector = Detector::default();
        detector.observe(at(1_000, true, false));
        assert!(
            detector
                .observe(at(1_000 + SLEEP_THRESHOLD_NS - 1, true, false))
                .is_empty()
        );
        assert_eq!(
            detector.observe(at(10 * SLEEP_THRESHOLD_NS, true, false)),
            vec![InterruptionKind::Sleep]
        );
    }

    #[test]
    fn locking_and_switching_away_interrupt_and_coming_back_does_not() {
        let mut detector = Detector::default();
        detector.observe(at(0, true, false));
        assert_eq!(
            detector.observe(at(0, true, true)),
            vec![InterruptionKind::ScreenLock]
        );
        assert!(
            detector.observe(at(0, true, false)).is_empty(),
            "unlocking is not one"
        );
        assert_eq!(
            detector.observe(at(0, false, false)),
            vec![InterruptionKind::UserSwitch]
        );
        assert!(
            detector.observe(at(0, true, false)).is_empty(),
            "switching back is not one"
        );
    }

    #[test]
    fn a_sleep_that_ends_locked_reports_both() {
        let mut detector = Detector::default();
        detector.observe(at(0, true, false));
        assert_eq!(
            detector.observe(at(60 * SLEEP_THRESHOLD_NS, true, true)),
            vec![InterruptionKind::Sleep, InterruptionKind::ScreenLock]
        );
    }

    #[test]
    fn unknown_readings_never_interrupt() {
        let mut detector = Detector::default();
        detector.observe(Sample::default());
        assert!(detector.observe(at(u64::MAX, false, true)).is_empty());
        assert!(detector.observe(Sample::default()).is_empty());
    }

    #[test]
    fn the_watcher_reports_what_the_detector_finds_and_stops_when_dropped() {
        let samples = Arc::new(Mutex::new(vec![at(0, true, true), at(0, true, false)]));
        let reader = Arc::clone(&samples);
        let (sender, receiver) = mpsc::channel();
        let watcher = Watcher::start(
            move || {
                reader
                    .lock()
                    .map(|mut queue| queue.pop())
                    .ok()
                    .flatten()
                    .unwrap_or(at(0, true, true))
            },
            move |kind| {
                let _ = sender.send(kind);
            },
        )
        .expect("starts");
        assert_eq!(
            receiver.recv_timeout(Duration::from_secs(5)),
            Ok(InterruptionKind::ScreenLock)
        );
        drop(watcher);
    }

    /// Real OS: this machine's clocks and session are readable.
    #[cfg(any(target_os = "macos", target_os = "windows"))]
    #[test]
    fn this_machine_can_be_sampled() {
        let first = sample();
        assert!(
            first.suspended_ns.is_some(),
            "the suspended clock is readable"
        );
        assert!(first.on_console.is_some(), "console ownership is readable");
        let (Some(before), Some(after)) = (first.suspended_ns, sample().suspended_ns) else {
            panic!("the suspended clock stays readable");
        };
        // The two clocks are read one after the other, so the difference jitters by the time
        // between the reads; it never goes back by more than that.
        assert!(
            after + 1_000_000 >= before,
            "suspended time does not go back"
        );
    }
}
