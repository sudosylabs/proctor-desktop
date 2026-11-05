#[allow(unsafe_code)]
mod notifications;
#[allow(unsafe_code)]
mod topology_query;
#[allow(unsafe_code)]
mod window_watcher;

use std::sync::Arc;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::mpsc;
use std::time::Duration;

use native_protocol::{DisplayTopologySnapshot, PermissionState, PlatformFamily};
use native_source_runtime::DeadlineThread;

use self::notifications::{MonitorNotifications, NotificationState};
use self::topology_query::enumerate_topology;
use self::window_watcher::WindowWatcher;
use super::{EventWakeup, EventWorkerConfig, EventWorkerMode};
use crate::{
    DisplayTopologyBackend, DisplayTopologyEmitter, DisplayTopologyError,
    DisplayTopologySubscription, OpenedDisplayTopologyBackend, OpenedSourceHealth,
    final_snapshot_with_deadline, finish_native_thread, prefer_cleanup_error,
};

static WINDOW_CLASS_COUNTER: AtomicU64 = AtomicU64::new(1);
static WINDOW_WATCHER_POISONED: AtomicBool = AtomicBool::new(false);

pub struct WindowsDisplayTopologyBackend;

impl DisplayTopologyBackend for WindowsDisplayTopologyBackend {
    type Subscription = WindowsDisplaySubscription;

    fn open(
        self,
        emitter: DisplayTopologyEmitter,
    ) -> Result<OpenedDisplayTopologyBackend<Self::Subscription>, DisplayTopologyError> {
        let mut subscription = WindowsDisplaySubscription::start(&emitter)?;
        let initial_topology = match enumerate_topology() {
            Ok(topology) => topology,
            Err(error) => {
                return Err(prefer_cleanup_error(error, subscription.stop_resources()));
            }
        };
        let health = OpenedSourceHealth::from(initial_topology.certainty);
        Ok(OpenedDisplayTopologyBackend {
            platform: PlatformFamily::Windows,
            permission: PermissionState::Granted,
            health,
            adapter_version: "windows-ccd",
            initial_topology,
            subscription,
        })
    }
}

pub struct WindowsDisplaySubscription {
    notifications: MonitorNotifications,
    window_watcher: WindowWatcher,
    shutdown: Arc<AtomicBool>,
    worker_thread: Option<DeadlineThread>,
    final_result: Option<Result<DisplayTopologySnapshot, DisplayTopologyError>>,
}

impl WindowsDisplaySubscription {
    fn start(emitter: &DisplayTopologyEmitter) -> Result<Self, DisplayTopologyError> {
        if watcher_is_poisoned() {
            return Err(DisplayTopologyError::Backend(
                "a previous Windows display watcher could not be released safely".to_owned(),
            ));
        }
        let shutdown = Arc::new(AtomicBool::new(false));
        let (event_sender, event_receiver) = mpsc::sync_channel(emitter.queue_capacity());
        let notification_state = Arc::new(NotificationState::new(event_sender));
        let worker_notification_state = Arc::clone(&notification_state);
        let fence_notification_state = Arc::clone(&notification_state);
        let mut worker_thread = super::start_event_worker(
            emitter,
            event_receiver,
            move || worker_notification_state.take_dropped(),
            move || fence_notification_state.fence(),
            Arc::clone(&shutdown),
            EventWorkerConfig {
                mode: EventWorkerMode::NotificationWithPollingFallback {
                    poll_interval: Duration::from_millis(250),
                },
                thread_name: "display-topology-windows",
                backend_name: "Windows",
            },
            enumerate_topology,
        )?;
        let mut notifications =
            match MonitorNotifications::register(Arc::clone(&notification_state)) {
                Ok(notifications) => notifications,
                Err(error) => {
                    shutdown.store(true, Ordering::Release);
                    notification_state.fence();
                    finish_worker(&mut worker_thread)?;
                    return Err(error);
                }
            };
        let window_watcher =
            match WindowWatcher::start(notification_state, emitter, Arc::clone(&shutdown)) {
                Ok(watcher) => watcher,
                Err(error) => {
                    shutdown.store(true, Ordering::Release);
                    notifications.state().fence();
                    let notification_result = notifications.unregister();
                    let worker_result = finish_worker(&mut worker_thread);
                    notification_result.and(worker_result)?;
                    return Err(error);
                }
            };
        Ok(Self {
            notifications,
            window_watcher,
            shutdown,
            worker_thread: Some(worker_thread),
            final_result: None,
        })
    }

    fn stop_resources(&mut self) -> Result<(), DisplayTopologyError> {
        self.shutdown.store(true, Ordering::Release);
        self.notifications.state().fence();
        let notification_result = self.notifications.unregister();
        let window_result = self.window_watcher.stop();
        let worker_result = self
            .worker_thread
            .take()
            .map_or(Ok(()), |mut thread| finish_worker(&mut thread));
        notification_result.and(window_result).and(worker_result)
    }
}

impl DisplayTopologySubscription for WindowsDisplaySubscription {
    fn stop(&mut self) -> Result<DisplayTopologySnapshot, DisplayTopologyError> {
        if let Some(result) = &self.final_result {
            return result.clone();
        }
        let result = (|| {
            self.stop_resources()?;
            final_snapshot_with_deadline(
                "display-topology-final-windows",
                "Windows CCD",
                enumerate_topology,
            )
        })();
        self.final_result = Some(result.clone());
        result
    }
}

impl Drop for WindowsDisplaySubscription {
    fn drop(&mut self) {
        let _ = DisplayTopologySubscription::stop(self);
    }
}

fn finish_worker(thread: &mut DeadlineThread) -> Result<(), DisplayTopologyError> {
    finish_native_thread(thread, "Windows display worker")
}

fn watcher_is_poisoned() -> bool {
    WINDOW_WATCHER_POISONED.load(Ordering::Acquire)
}

fn poison_watcher() {
    WINDOW_WATCHER_POISONED.store(true, Ordering::Release);
}

fn next_window_class_name() -> Vec<u16> {
    let unique = WINDOW_CLASS_COUNTER.fetch_add(1, Ordering::Relaxed);
    format!("ProctorDisplayTopology-{}-{unique}\0", std::process::id())
        .encode_utf16()
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::assert_adapter_baseline_conformance;

    #[test]
    fn real_ccd_source_passes_baseline_conformance() {
        assert_adapter_baseline_conformance(WindowsDisplayTopologyBackend, PlatformFamily::Windows);
    }
}
