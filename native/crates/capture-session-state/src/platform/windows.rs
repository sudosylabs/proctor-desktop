#[allow(unsafe_code)]
mod metrics;
mod notifications;
#[allow(unsafe_code)]
mod session_watcher;

use std::panic::{self, AssertUnwindSafe};
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{self, Receiver};

use native_protocol::{
    CaptureSessionActivity, CaptureSessionCertainty, CaptureSessionSignal, CaptureSessionState,
    CaptureSessionSupport, PermissionState, PlatformFamily,
};
use native_source_runtime::{
    DeadlineThread, SOURCE_CLEANUP_DEADLINE, poison_native_source_process,
};

use self::metrics::{NativeRemoteSessionStatus, native_remote_session_status};
use self::notifications::NotificationState;
use self::session_watcher::SessionWatcher;
use crate::{
    CaptureSessionBackend, CaptureSessionEmitter, CaptureSessionError, CaptureSessionSubscription,
    OpenedCaptureSessionBackend,
};

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum EventWakeup {
    Transition,
}

pub struct WindowsCaptureSessionBackend;

pub struct WindowsCaptureSessionSubscription {
    notifications: Arc<NotificationState>,
    shutdown: Arc<AtomicBool>,
    watcher: SessionWatcher,
    worker: DeadlineThread,
}

impl CaptureSessionBackend for WindowsCaptureSessionBackend {
    type Subscription = WindowsCaptureSessionSubscription;

    fn open(
        self,
        emitter: CaptureSessionEmitter,
    ) -> Result<OpenedCaptureSessionBackend<Self::Subscription>, CaptureSessionError> {
        let (sender, receiver) = mpsc::sync_channel(emitter.queue_capacity());
        let notifications = Arc::new(NotificationState::new(sender));
        let shutdown = Arc::new(AtomicBool::new(false));
        let worker = start_event_worker(
            &emitter,
            receiver,
            Arc::clone(&notifications),
            Arc::clone(&shutdown),
        )?;
        let watcher = match SessionWatcher::start(
            Arc::clone(&notifications),
            Arc::clone(&shutdown),
            &emitter,
        ) {
            Ok(watcher) => watcher,
            Err(primary) => {
                shutdown.store(true, Ordering::Release);
                let fence = notifications.fence();
                let cleanup = finish_worker(worker);
                return Err(fence.err().or_else(|| cleanup.err()).unwrap_or(primary));
            }
        };

        Ok(OpenedCaptureSessionBackend {
            platform: PlatformFamily::Windows,
            permission: PermissionState::Granted,
            adapter_version: "wts-session-notify",
            // WTS observation is already active, so transitions concurrent
            // with this query are retained by the source opening queue.
            initial_state: query_state(),
            subscription: WindowsCaptureSessionSubscription {
                notifications,
                shutdown,
                watcher,
                worker,
            },
        })
    }
}

impl CaptureSessionSubscription for WindowsCaptureSessionSubscription {
    fn stop(mut self) -> Result<CaptureSessionState, CaptureSessionError> {
        self.shutdown.store(true, Ordering::Release);
        // Close the nonblocking ingress first. The watcher context may remain
        // live while native unregistration completes, but it can no longer
        // submit an observation.
        let fence_result = self.notifications.fence();
        let watcher_result = self.watcher.stop();
        let worker_result = finish_worker(self.worker);
        fence_result.and(watcher_result).and(worker_result)?;
        Ok(query_state())
    }
}

fn start_event_worker(
    emitter: &CaptureSessionEmitter,
    receiver: Receiver<EventWakeup>,
    notifications: Arc<NotificationState>,
    shutdown: Arc<AtomicBool>,
) -> Result<DeadlineThread, CaptureSessionError> {
    let worker_emitter = emitter.clone();
    DeadlineThread::spawn("capture-session-events", move || {
        let result = panic::catch_unwind(AssertUnwindSafe(|| {
            loop {
                match exact_overflowed_wakeups(&receiver, &notifications) {
                    Ok(0) => {}
                    Ok(missing) => {
                        worker_emitter.report_missing_transitions(missing);
                        break;
                    }
                    Err(error) => {
                        worker_emitter.fail(error);
                        break;
                    }
                }
                match receiver.recv() {
                    Ok(EventWakeup::Transition) => {
                        // WTS events are wakeups, not authority. Query current
                        // mechanical state for each event while preserving the
                        // ordered fact even when it equals the previous query.
                        worker_emitter.observe_transition(Ok(query_state()));
                    }
                    Err(_) => {
                        match final_missing_wakeups(&receiver, &notifications) {
                            Ok(0) if !shutdown.load(Ordering::Acquire) => {
                                worker_emitter.fail(CaptureSessionError::Backend(
                                    "Windows WTS notification channel disconnected unexpectedly"
                                        .to_owned(),
                                ));
                            }
                            Ok(0) => {}
                            Ok(missing) => {
                                worker_emitter.report_missing_transitions(missing);
                            }
                            Err(error) => worker_emitter.fail(error),
                        }
                        break;
                    }
                }
            }
        }));
        if result.is_err() {
            worker_emitter.fail(CaptureSessionError::Backend(
                "Windows capture-session event worker panicked".to_owned(),
            ));
        }
    })
    .map_err(|error| {
        CaptureSessionError::Backend(format!(
            "cannot start Windows capture-session event worker: {error}"
        ))
    })
}

fn exact_overflowed_wakeups(
    receiver: &Receiver<EventWakeup>,
    notifications: &NotificationState,
) -> Result<u64, CaptureSessionError> {
    let dropped = notifications.take_dropped();
    if dropped == 0 {
        return Ok(0);
    }
    notifications.fence()?;
    Ok(dropped
        .saturating_add(notifications.take_dropped())
        .saturating_add(u64::try_from(receiver.try_iter().count()).unwrap_or(u64::MAX)))
}

fn final_missing_wakeups(
    receiver: &Receiver<EventWakeup>,
    notifications: &NotificationState,
) -> Result<u64, CaptureSessionError> {
    notifications.fence()?;
    Ok(notifications
        .take_dropped()
        .saturating_add(u64::try_from(receiver.try_iter().count()).unwrap_or(u64::MAX)))
}

fn finish_worker(mut worker: DeadlineThread) -> Result<(), CaptureSessionError> {
    worker.finish(SOURCE_CLEANUP_DEADLINE).map_err(|error| {
        poison_native_source_process();
        CaptureSessionError::Cleanup(format!(
            "Windows capture-session event worker {error}; native utility restart is required"
        ))
    })
}

fn query_state() -> CaptureSessionState {
    let native_remote_session = match native_remote_session_status() {
        NativeRemoteSessionStatus::Known(active) => CaptureSessionSignal {
            support: CaptureSessionSupport::Supported,
            activity: if active {
                CaptureSessionActivity::Active
            } else {
                CaptureSessionActivity::Inactive
            },
            certainty: CaptureSessionCertainty::Complete,
        },
        NativeRemoteSessionStatus::Indeterminate => CaptureSessionSignal {
            support: CaptureSessionSupport::Supported,
            activity: CaptureSessionActivity::Unknown,
            certainty: CaptureSessionCertainty::Partial,
        },
    };
    CaptureSessionState {
        screen_capture: unsupported_signal(),
        native_remote_session,
    }
}

fn unsupported_signal() -> CaptureSessionSignal {
    CaptureSessionSignal {
        support: CaptureSessionSupport::Unsupported,
        activity: CaptureSessionActivity::Unknown,
        certainty: CaptureSessionCertainty::Unknown,
    }
}

#[cfg(test)]
mod tests {
    use std::thread;
    use std::time::{Duration, Instant};

    use native_protocol::{ProtocolValidatable, SourceHealth, SourceOpenRequest};

    use super::*;
    use crate::CaptureSessionSource;

    fn request() -> SourceOpenRequest {
        SourceOpenRequest {
            collection_session_id: "windows-wts-conformance".to_owned(),
            queue_capacity: 8,
        }
    }

    #[test]
    fn real_wts_wakeups_preserve_back_to_back_transition_order() {
        let mut source = CaptureSessionSource::open(&request(), WindowsCaptureSessionBackend)
            .expect("Windows WTS source opens");
        let subscription = source.subscription.as_ref().expect("live subscription");
        subscription
            .watcher
            .simulate_session_change()
            .expect("first WTS message posts");
        subscription
            .watcher
            .simulate_session_change()
            .expect("second WTS message posts");

        let deadline = Instant::now() + Duration::from_secs(2);
        let mut observations = Vec::new();
        while observations.len() < 2 && Instant::now() < deadline {
            observations.extend(source.drain().observations);
            if observations.len() < 2 {
                thread::sleep(Duration::from_millis(5));
            }
        }
        assert_eq!(observations.len(), 2);
        assert_eq!(observations[0].sequence, 1);
        assert_eq!(observations[1].sequence, 2);
        for observation in &observations {
            observation
                .validate_protocol()
                .expect("WTS observation follows protocol");
        }
        assert_eq!(source.stop().health, SourceHealth::Stopped);
    }
}
