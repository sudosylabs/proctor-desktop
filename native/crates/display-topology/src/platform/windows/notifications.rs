use std::ffi::c_void;
use std::mem;
use std::ptr;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::mpsc::{SyncSender, TrySendError};
use std::sync::{Arc, Mutex, TryLockError};

use windows_sys::Win32::Devices::DeviceAndDriverInstallation::{
    CM_NOTIFY_ACTION, CM_NOTIFY_ACTION_DEVICEINTERFACEARRIVAL,
    CM_NOTIFY_ACTION_DEVICEINTERFACEREMOVAL, CM_NOTIFY_EVENT_DATA, CM_NOTIFY_FILTER,
    CM_NOTIFY_FILTER_0, CM_NOTIFY_FILTER_0_0, CM_NOTIFY_FILTER_TYPE_DEVICEINTERFACE,
    CM_Register_Notification, CM_Unregister_Notification, CR_SUCCESS, HCMNOTIFICATION,
};
use windows_sys::Win32::Devices::Display::GUID_DEVINTERFACE_MONITOR;
use windows_sys::Win32::Foundation::ERROR_SUCCESS;

use super::{EventWakeup, poison_watcher};
use crate::{DisplayTopologyError, cleanup_with_deadline};

pub(super) struct NotificationState {
    sender: Mutex<Option<SyncSender<EventWakeup>>>,
    dropped_wakeups: AtomicU64,
}

impl NotificationState {
    pub(super) fn new(sender: SyncSender<EventWakeup>) -> Self {
        Self {
            sender: Mutex::new(Some(sender)),
            dropped_wakeups: AtomicU64::new(0),
        }
    }

    pub(super) fn notify_transition(&self) {
        let sender = match self.sender.try_lock() {
            Ok(sender) => sender,
            Err(TryLockError::WouldBlock | TryLockError::Poisoned(_)) => {
                self.dropped_wakeups.fetch_add(1, Ordering::AcqRel);
                return;
            }
        };
        let Some(sender) = sender.as_ref() else {
            return;
        };
        if let Err(TrySendError::Full(_) | TrySendError::Disconnected(_)) =
            sender.try_send(EventWakeup::Transition)
        {
            self.dropped_wakeups.fetch_add(1, Ordering::AcqRel);
        }
    }

    pub(super) fn fence(&self) {
        *lock(&self.sender) = None;
    }

    pub(super) fn take_dropped(&self) -> u64 {
        self.dropped_wakeups.swap(0, Ordering::AcqRel)
    }
}

pub(super) struct MonitorNotifications {
    // Windows models this registration token as a pointer, but it is an
    // opaque process-local value: Rust never dereferences it. Keeping the
    // address avoids making subscription ownership inherit raw-pointer
    // thread-affinity that the Configuration Manager API does not impose.
    handle: usize,
    state: Arc<NotificationState>,
}

impl MonitorNotifications {
    pub(super) fn register(state: Arc<NotificationState>) -> Result<Self, DisplayTopologyError> {
        let filter = CM_NOTIFY_FILTER {
            cbSize: u32::try_from(mem::size_of::<CM_NOTIFY_FILTER>()).unwrap_or(u32::MAX),
            FilterType: CM_NOTIFY_FILTER_TYPE_DEVICEINTERFACE,
            u: CM_NOTIFY_FILTER_0 {
                DeviceInterface: CM_NOTIFY_FILTER_0_0 {
                    ClassGuid: GUID_DEVINTERFACE_MONITOR,
                },
            },
            ..CM_NOTIFY_FILTER::default()
        };
        let mut handle: HCMNOTIFICATION = ptr::null_mut();
        // SAFETY: filter is correctly sized, the Arc keeps the callback context
        // alive until successful unregistration, and the callback matches the ABI.
        let result = unsafe {
            CM_Register_Notification(
                &raw const filter,
                Arc::as_ptr(&state).cast::<c_void>(),
                Some(monitor_notification_callback),
                &raw mut handle,
            )
        };
        if result != CR_SUCCESS {
            return Err(DisplayTopologyError::Backend(format!(
                "CM_Register_Notification(monitor) failed with CONFIGRET {result}"
            )));
        }
        Ok(Self {
            handle: handle as usize,
            state,
        })
    }

    pub(super) fn unregister(&mut self) -> Result<(), DisplayTopologyError> {
        if self.handle == 0 {
            return Ok(());
        }
        let handle_address = mem::take(&mut self.handle);
        let callback_state = Arc::clone(&self.state);
        let result = cleanup_with_deadline(
            "display-callback-remove-windows",
            "Windows monitor callback removal",
            move || {
                // SAFETY: the address is the exact handle returned by
                // CM_Register_Notification and has not previously been unregistered.
                let handle = handle_address as HCMNOTIFICATION;
                let result = unsafe { CM_Unregister_Notification(handle) };
                drop(callback_state);
                if result == CR_SUCCESS {
                    Ok(())
                } else {
                    Err(DisplayTopologyError::Cleanup(format!(
                        "CM_Unregister_Notification(monitor) failed with CONFIGRET {result}"
                    )))
                }
            },
        );
        if result.is_err() {
            poison_watcher();
            // The OS may still call the registered callback. Keep one bounded
            // Arc alive until the poisoned utility process is restarted.
            mem::forget(Arc::clone(&self.state));
        }
        result
    }

    pub(super) fn state(&self) -> &Arc<NotificationState> {
        &self.state
    }
}

impl Drop for MonitorNotifications {
    fn drop(&mut self) {
        let _ = self.unregister();
    }
}

unsafe extern "system" fn monitor_notification_callback(
    _notification: HCMNOTIFICATION,
    context: *const c_void,
    action: CM_NOTIFY_ACTION,
    _event_data: *const CM_NOTIFY_EVENT_DATA,
    _event_data_size: u32,
) -> u32 {
    if matches!(
        action,
        CM_NOTIFY_ACTION_DEVICEINTERFACEARRIVAL | CM_NOTIFY_ACTION_DEVICEINTERFACEREMOVAL
    ) {
        // SAFETY: registration supplies Arc-backed NotificationState storage;
        // successful unregistration fences callbacks before the last Arc drops.
        if let Some(state) = unsafe { context.cast::<NotificationState>().as_ref() } {
            state.notify_transition();
        }
    }
    ERROR_SUCCESS
}

fn lock<T>(mutex: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    mutex
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
}
