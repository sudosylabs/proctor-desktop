mod core_graphics;
#[allow(unsafe_code)]
mod notifications;
#[allow(unsafe_code)]
mod topology_query;

use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc;
use std::time::Duration;

use prctr_native_protocol::{DisplayTopologySnapshot, PermissionState, PlatformFamily};
use prctr_native_source_runtime::DeadlineThread;

use self::notifications::MacDisplayNotifications;
use self::topology_query::enumerate_topology;
use super::{EventWakeup, EventWorkerConfig, EventWorkerMode};
use crate::{
    DisplayTopologyBackend, DisplayTopologyEmitter, DisplayTopologyError,
    DisplayTopologySubscription, OpenedDisplayTopologyBackend, OpenedSourceHealth,
    final_snapshot_with_deadline, finish_native_thread, prefer_cleanup_error,
};

pub struct MacOsDisplayTopologyBackend;

impl DisplayTopologyBackend for MacOsDisplayTopologyBackend {
    type Subscription = MacOsDisplaySubscription;

    fn open(
        self,
        emitter: DisplayTopologyEmitter,
    ) -> Result<OpenedDisplayTopologyBackend<Self::Subscription>, DisplayTopologyError> {
        let (sender, receiver) = mpsc::sync_channel(emitter.queue_capacity());
        let shutdown = Arc::new(AtomicBool::new(false));
        let mut notifications = MacDisplayNotifications::register(sender)?;
        let callback_hub = notifications.hub();
        let mut worker = match super::start_event_worker(
            &emitter,
            receiver,
            move || callback_hub.take_dropped(),
            move || callback_hub.fence(),
            Arc::clone(&shutdown),
            EventWorkerConfig {
                mode: EventWorkerMode::NotificationTransitions {
                    idle_wait: Duration::from_millis(50),
                },
                thread_name: "prctr-display-topology-macos",
                backend_name: "CoreGraphics",
            },
            enumerate_topology,
        ) {
            Ok(worker) => worker,
            Err(error) => {
                return Err(prefer_cleanup_error(error, notifications.unregister()));
            }
        };
        let initial_topology = match enumerate_topology() {
            Ok(topology) => topology,
            Err(error) => {
                shutdown.store(true, Ordering::Release);
                let notification_result = notifications.unregister();
                let worker_result = finish_worker(&mut worker);
                return Err(prefer_cleanup_error(
                    error,
                    notification_result.and(worker_result),
                ));
            }
        };
        Ok(OpenedDisplayTopologyBackend {
            platform: PlatformFamily::Macos,
            permission: PermissionState::Granted,
            health: OpenedSourceHealth::from(initial_topology.certainty),
            adapter_version: "core-graphics-v1",
            initial_topology,
            subscription: MacOsDisplaySubscription {
                notifications,
                shutdown,
                worker: Some(worker),
                final_result: None,
            },
        })
    }
}

pub struct MacOsDisplaySubscription {
    notifications: MacDisplayNotifications,
    shutdown: Arc<AtomicBool>,
    worker: Option<DeadlineThread>,
    final_result: Option<Result<DisplayTopologySnapshot, DisplayTopologyError>>,
}

impl DisplayTopologySubscription for MacOsDisplaySubscription {
    fn stop(&mut self) -> Result<DisplayTopologySnapshot, DisplayTopologyError> {
        if let Some(result) = &self.final_result {
            return result.clone();
        }
        let result = (|| {
            self.shutdown.store(true, Ordering::Release);
            self.notifications.hub().fence();
            let notification_result = self.notifications.unregister();
            let worker_result = self
                .worker
                .take()
                .map_or(Ok(()), |mut worker| finish_worker(&mut worker));
            notification_result.and(worker_result)?;
            final_snapshot_with_deadline(
                "prctr-display-topology-final-macos",
                "CoreGraphics",
                enumerate_topology,
            )
        })();
        self.final_result = Some(result.clone());
        result
    }
}

impl Drop for MacOsDisplaySubscription {
    fn drop(&mut self) {
        let _ = DisplayTopologySubscription::stop(self);
    }
}

fn finish_worker(worker: &mut DeadlineThread) -> Result<(), DisplayTopologyError> {
    finish_native_thread(worker, "CoreGraphics display worker")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::assert_adapter_baseline_conformance;

    #[test]
    fn real_core_graphics_source_passes_baseline_conformance() {
        assert_adapter_baseline_conformance(MacOsDisplayTopologyBackend, PlatformFamily::Macos);
    }
}
