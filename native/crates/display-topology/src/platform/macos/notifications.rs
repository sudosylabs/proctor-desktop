use std::ffi::c_void;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::mpsc::{SyncSender, TrySendError};
use std::sync::{Mutex, OnceLock, TryLockError};

use super::EventWakeup;
use super::core_graphics::{CG_ERROR_SUCCESS, CGDirectDisplayId, CGError};
use crate::{DisplayTopologyError, cleanup_with_deadline};

type CGDisplayChangeSummaryFlags = u32;
type ReconfigurationCallback =
    unsafe extern "C" fn(CGDirectDisplayId, CGDisplayChangeSummaryFlags, *mut c_void);

const CG_DISPLAY_BEGIN_CONFIGURATION_FLAG: CGDisplayChangeSummaryFlags = 1;
static CALLBACK_HUB: OnceLock<CallbackHub> = OnceLock::new();

#[link(name = "CoreGraphics", kind = "framework")]
unsafe extern "C" {
    fn CGDisplayRegisterReconfigurationCallback(
        callback: ReconfigurationCallback,
        user_info: *mut c_void,
    ) -> CGError;
    fn CGDisplayRemoveReconfigurationCallback(
        callback: ReconfigurationCallback,
        user_info: *mut c_void,
    ) -> CGError;
}

pub(super) struct MacDisplayNotifications {
    hub: &'static CallbackHub,
    registered: bool,
}

impl MacDisplayNotifications {
    pub(super) fn register(sender: SyncSender<EventWakeup>) -> Result<Self, DisplayTopologyError> {
        let hub = callback_hub();
        hub.install(sender)?;
        // SAFETY: hub_pointer refers to process-lifetime OnceLock storage, and
        // the callback accepts the declared CoreGraphics ABI.
        let result = unsafe {
            CGDisplayRegisterReconfigurationCallback(display_reconfigured, hub.pointer())
        };
        if result != CG_ERROR_SUCCESS {
            hub.uninstall(true);
            return Err(DisplayTopologyError::Backend(format!(
                "CoreGraphics could not register display reconfiguration callback (CGError {result})"
            )));
        }
        Ok(Self {
            hub,
            registered: true,
        })
    }

    pub(super) fn unregister(&mut self) -> Result<(), DisplayTopologyError> {
        if !self.registered {
            return Ok(());
        }
        self.registered = false;
        let hub = self.hub;
        cleanup_with_deadline(
            "display-callback-remove-macos",
            "CoreGraphics display callback removal",
            move || {
                // SAFETY: pointer and callback match the successful registration and
                // the process-lifetime hub remains valid even if removal fails.
                let result = unsafe {
                    CGDisplayRemoveReconfigurationCallback(display_reconfigured, hub.pointer())
                };
                hub.uninstall(result == CG_ERROR_SUCCESS);
                if result == CG_ERROR_SUCCESS {
                    Ok(())
                } else {
                    Err(DisplayTopologyError::Cleanup(format!(
                        "CoreGraphics could not remove display reconfiguration callback (CGError {result})"
                    )))
                }
            },
        )
    }

    pub(super) fn hub(&self) -> &'static CallbackHub {
        self.hub
    }
}

impl Drop for MacDisplayNotifications {
    fn drop(&mut self) {
        let _ = self.unregister();
    }
}

pub(super) struct CallbackHub {
    state: Mutex<CallbackHubState>,
    dropped_wakeups: AtomicU64,
}

struct CallbackHubState {
    sender: Option<SyncSender<EventWakeup>>,
    poisoned: bool,
}

impl CallbackHub {
    fn new() -> Self {
        Self {
            state: Mutex::new(CallbackHubState {
                sender: None,
                poisoned: false,
            }),
            dropped_wakeups: AtomicU64::new(0),
        }
    }

    fn install(&self, sender: SyncSender<EventWakeup>) -> Result<(), DisplayTopologyError> {
        let mut state = lock(&self.state);
        if state.poisoned {
            return Err(DisplayTopologyError::Backend(
                "CoreGraphics callback removal previously failed; source cannot be reopened safely"
                    .to_owned(),
            ));
        }
        if state.sender.is_some() {
            return Err(DisplayTopologyError::Backend(
                "a CoreGraphics display source is already active".to_owned(),
            ));
        }
        state.sender = Some(sender);
        self.dropped_wakeups.store(0, Ordering::Release);
        Ok(())
    }

    fn uninstall(&self, removed: bool) {
        let mut state = lock(&self.state);
        state.sender = None;
        state.poisoned |= !removed;
    }

    pub(super) fn fence(&self) {
        lock(&self.state).sender = None;
    }

    pub(super) fn take_dropped(&self) -> u64 {
        self.dropped_wakeups.swap(0, Ordering::AcqRel)
    }

    fn notify(&self) {
        let state = match self.state.try_lock() {
            Ok(state) => state,
            Err(TryLockError::WouldBlock | TryLockError::Poisoned(_)) => {
                self.dropped_wakeups.fetch_add(1, Ordering::AcqRel);
                return;
            }
        };
        let Some(sender) = state.sender.as_ref() else {
            return;
        };
        if let Err(TrySendError::Full(_) | TrySendError::Disconnected(_)) =
            sender.try_send(EventWakeup::Transition)
        {
            self.dropped_wakeups.fetch_add(1, Ordering::AcqRel);
        }
    }

    fn pointer(&self) -> *mut c_void {
        std::ptr::from_ref(self).cast_mut().cast::<c_void>()
    }
}

unsafe extern "C" fn display_reconfigured(
    _display: CGDirectDisplayId,
    flags: CGDisplayChangeSummaryFlags,
    user_info: *mut c_void,
) {
    if flags & CG_DISPLAY_BEGIN_CONFIGURATION_FLAG != 0 {
        return;
    }
    // SAFETY: registration supplies a non-null pointer to process-lifetime
    // CallbackHub storage. A defensive null check handles foreign misuse.
    if let Some(hub) = unsafe { user_info.cast::<CallbackHub>().as_ref() } {
        hub.notify();
    }
}

fn callback_hub() -> &'static CallbackHub {
    CALLBACK_HUB.get_or_init(CallbackHub::new)
}

fn lock<T>(mutex: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    mutex
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
}
