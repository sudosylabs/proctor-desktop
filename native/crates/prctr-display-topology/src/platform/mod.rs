#[cfg(target_os = "macos")]
mod macos;

#[cfg(target_os = "linux")]
mod polling;

#[cfg(any(target_os = "linux", test))]
mod linux;

#[cfg(target_os = "windows")]
mod windows;

#[cfg(target_os = "macos")]
pub use macos::MacOsDisplayTopologyBackend;

#[cfg(target_os = "linux")]
pub use linux::LinuxDisplayTopologyBackend;

#[cfg(target_os = "windows")]
pub use windows::WindowsDisplayTopologyBackend;

#[cfg(any(target_os = "macos", target_os = "windows", test))]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum EventWakeup {
    Transition,
}

#[cfg(any(target_os = "macos", target_os = "windows", test))]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum EventWorkerMode {
    #[cfg(target_os = "macos")]
    NotificationTransitions { idle_wait: Duration },
    #[cfg(target_os = "windows")]
    NotificationWithPollingFallback { poll_interval: Duration },
}

#[cfg(any(target_os = "macos", target_os = "windows", test))]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum EventTimeoutAction {
    #[cfg(target_os = "macos")]
    Wait,
    #[cfg(target_os = "windows")]
    RefreshTopology,
}

#[cfg(any(target_os = "macos", target_os = "windows", test))]
impl EventTimeoutAction {
    fn should_refresh(self) -> bool {
        match self {
            #[cfg(target_os = "macos")]
            Self::Wait => false,
            #[cfg(target_os = "windows")]
            Self::RefreshTopology => true,
        }
    }
}

#[cfg(any(target_os = "macos", target_os = "windows", test))]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
struct EventWaitPolicy {
    interval: Duration,
    on_timeout: EventTimeoutAction,
}

#[cfg(any(target_os = "macos", target_os = "windows", test))]
impl EventWorkerMode {
    fn wait_policy(self) -> EventWaitPolicy {
        match self {
            #[cfg(target_os = "macos")]
            Self::NotificationTransitions { idle_wait } => EventWaitPolicy {
                interval: idle_wait,
                on_timeout: EventTimeoutAction::Wait,
            },
            #[cfg(target_os = "windows")]
            Self::NotificationWithPollingFallback { poll_interval } => EventWaitPolicy {
                interval: poll_interval,
                on_timeout: EventTimeoutAction::RefreshTopology,
            },
        }
    }
}

#[cfg(any(target_os = "macos", target_os = "windows", test))]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
struct EventWorkerConfig {
    mode: EventWorkerMode,
    thread_name: &'static str,
    backend_name: &'static str,
}

#[cfg(any(target_os = "macos", target_os = "windows", test))]
fn start_event_worker<F, D, C>(
    emitter: &DisplayTopologyEmitter,
    receiver: Receiver<EventWakeup>,
    take_dropped_wakeups: D,
    fence_input: C,
    shutdown: Arc<AtomicBool>,
    config: EventWorkerConfig,
    snapshot: F,
) -> Result<DeadlineThread, DisplayTopologyError>
where
    F: Fn() -> Result<DisplayTopologySnapshot, DisplayTopologyError> + Send + 'static,
    D: Fn() -> u64 + Send + 'static,
    C: Fn() + Send + 'static,
{
    let worker_emitter = emitter.clone();
    DeadlineThread::spawn(config.thread_name, move || {
        let wait_policy = config.mode.wait_policy();
        let result = panic::catch_unwind(AssertUnwindSafe(|| {
            loop {
                let dropped =
                    exact_overflowed_wakeups(&receiver, &take_dropped_wakeups, &fence_input);
                if dropped > 0 {
                    worker_emitter.report_missing_transitions(dropped);
                    break;
                }
                match receiver.recv_timeout(wait_policy.interval) {
                    Ok(EventWakeup::Transition) => worker_emitter.emit_transition(snapshot()),
                    Err(RecvTimeoutError::Timeout) => {
                        if shutdown.load(Ordering::Acquire) {
                            break;
                        }
                        if wait_policy.on_timeout.should_refresh() {
                            worker_emitter.emit(snapshot());
                        }
                    }
                    Err(RecvTimeoutError::Disconnected) => {
                        if !shutdown.load(Ordering::Acquire) {
                            worker_emitter.fail(DisplayTopologyError::Backend(format!(
                                "{} display notification channel disconnected unexpectedly",
                                config.backend_name
                            )));
                        }
                        break;
                    }
                }
            }
        }));
        if result.is_err() {
            worker_emitter.fail(DisplayTopologyError::Backend(format!(
                "{} display worker panicked",
                config.backend_name
            )));
        }
    })
    .map_err(|error| {
        DisplayTopologyError::Backend(format!(
            "cannot start {} display worker: {error}",
            config.backend_name
        ))
    })
}

#[cfg(any(target_os = "macos", target_os = "windows", test))]
fn exact_overflowed_wakeups<T, D, C>(
    receiver: &Receiver<T>,
    take_dropped_wakeups: &D,
    fence_input: &C,
) -> u64
where
    D: Fn() -> u64,
    C: Fn(),
{
    let dropped = take_dropped_wakeups();
    if dropped == 0 {
        return 0;
    }
    fence_input();
    dropped
        .saturating_add(take_dropped_wakeups())
        .saturating_add(u64::try_from(receiver.try_iter().count()).unwrap_or(u64::MAX))
}

#[cfg(any(target_os = "macos", target_os = "windows", test))]
use std::panic::{self, AssertUnwindSafe};
#[cfg(any(target_os = "macos", target_os = "windows", test))]
use std::sync::Arc;
#[cfg(test)]
use std::sync::atomic::AtomicU64;
#[cfg(any(target_os = "macos", target_os = "windows", test))]
use std::sync::atomic::{AtomicBool, Ordering};
#[cfg(any(target_os = "macos", target_os = "windows", test))]
use std::sync::mpsc::{Receiver, RecvTimeoutError};
#[cfg(any(target_os = "macos", target_os = "windows", test))]
use std::time::Duration;

#[cfg(any(target_os = "macos", target_os = "windows", test))]
use prctr_native_protocol::DisplayTopologySnapshot;
#[cfg(any(target_os = "macos", target_os = "windows", test))]
use prctr_native_source_runtime::DeadlineThread;

#[cfg(any(target_os = "macos", target_os = "windows", test))]
use crate::{DisplayTopologyEmitter, DisplayTopologyError};

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::mpsc;

    #[test]
    fn overflow_accounts_for_queued_and_rejected_wakeups() {
        let (sender, receiver) = mpsc::sync_channel(2);
        sender
            .try_send(EventWakeup::Transition)
            .expect("first queued wakeup");
        sender
            .try_send(EventWakeup::Transition)
            .expect("second queued wakeup");
        let dropped = AtomicU64::new(3);
        let fenced = AtomicBool::new(false);

        let missing =
            exact_overflowed_wakeups(&receiver, &|| dropped.swap(0, Ordering::AcqRel), &|| {
                fenced.store(true, Ordering::Release);
            });

        assert_eq!(missing, 5);
        assert!(fenced.load(Ordering::Acquire));
        assert!(receiver.try_recv().is_err());
    }
}
