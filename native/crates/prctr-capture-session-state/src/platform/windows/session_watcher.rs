use std::panic::{self, AssertUnwindSafe};
use std::ptr;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::mpsc::{self, Receiver, SyncSender};
use std::sync::{Arc, Mutex};

use prctr_native_source_runtime::{
    DeadlineThread, SOURCE_CLEANUP_DEADLINE, poison_native_source_process,
};
use windows_sys::Win32::Foundation::{
    ERROR_SUCCESS, GetLastError, HMODULE, HWND, LPARAM, LRESULT, SetLastError, WPARAM,
};
use windows_sys::Win32::System::LibraryLoader::GetModuleHandleW;
use windows_sys::Win32::System::RemoteDesktop::{
    NOTIFY_FOR_THIS_SESSION, WTSRegisterSessionNotification, WTSUnRegisterSessionNotification,
};
use windows_sys::Win32::System::Threading::GetCurrentThreadId;
use windows_sys::Win32::UI::WindowsAndMessaging::{
    CreateWindowExW, DefWindowProcW, DestroyWindow, DispatchMessageW, GWLP_USERDATA, GetMessageW,
    GetWindowLongPtrW, IsWindow, MSG, PostMessageW, PostQuitMessage, PostThreadMessageW,
    RegisterClassW, SetWindowLongPtrW, TranslateMessage, UnregisterClassW, WM_APP, WM_CLOSE,
    WM_DESTROY, WM_QUIT, WM_WTSSESSION_CHANGE, WNDCLASSW, WTS_CONSOLE_CONNECT,
    WTS_CONSOLE_DISCONNECT, WTS_REMOTE_CONNECT, WTS_REMOTE_DISCONNECT, WTS_SESSION_REMOTE_CONTROL,
};

use super::notifications::NotificationState;
use crate::{CaptureSessionEmitter, CaptureSessionError};

const WM_STOP_SESSION_WATCHER: u32 = WM_APP + 2;
static NEXT_WINDOW_CLASS: AtomicU64 = AtomicU64::new(1);

pub(super) struct SessionWatcher {
    ownership: Arc<Mutex<WindowOwnership>>,
    thread_id: u32,
    thread: Option<DeadlineThread>,
    cleanup: Receiver<Result<(), CaptureSessionError>>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum WindowActivation {
    Activate,
    Cancel,
}

#[derive(Clone, Copy)]
struct WindowHandle {
    thread_id: u32,
}

#[derive(Default)]
struct WindowOwnership {
    window: Option<isize>,
}

/// Revokes published HWND ownership on every Rust exit path, including an
/// unwind before the normal WTS/window cleanup sequence can run.
struct PublishedWindow<'a> {
    ownership: &'a Mutex<WindowOwnership>,
}

impl<'a> PublishedWindow<'a> {
    fn publish(ownership: &'a Mutex<WindowOwnership>, window: HWND) -> Self {
        ownership
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .window = Some(window as isize);
        Self { ownership }
    }
}

impl Drop for PublishedWindow<'_> {
    fn drop(&mut self) {
        self.ownership
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .window = None;
    }
}

struct WindowContext {
    notifications: Arc<NotificationState>,
}

impl SessionWatcher {
    /// Creates and registers the WTS notification window before returning, so
    /// the backend can take its initial state only after transitions are live.
    pub(super) fn start(
        notifications: Arc<NotificationState>,
        shutdown: Arc<AtomicBool>,
        emitter: &CaptureSessionEmitter,
    ) -> Result<Self, CaptureSessionError> {
        let (startup_sender, startup_receiver) = mpsc::sync_channel(1);
        let (activation_sender, activation_receiver) = mpsc::sync_channel(1);
        let (cleanup_sender, cleanup_receiver) = mpsc::sync_channel(1);
        let ownership = Arc::new(Mutex::new(WindowOwnership::default()));
        let thread_ownership = Arc::clone(&ownership);
        let thread_emitter = emitter.clone();
        let mut thread = DeadlineThread::spawn("prctr-capture-session-wts", move || {
            let panic_cleanup = cleanup_sender.clone();
            let result = panic::catch_unwind(AssertUnwindSafe(|| {
                run_window_thread(
                    notifications,
                    &shutdown,
                    &thread_ownership,
                    &startup_sender,
                    &activation_receiver,
                    &cleanup_sender,
                    &thread_emitter,
                );
            }));
            if result.is_err() {
                let error = cleanup_error("Windows WTS notification thread panicked");
                thread_emitter.fail(error.clone());
                let _ = panic_cleanup.send(Err(error));
            }
        })
        .map_err(|error| {
            CaptureSessionError::Backend(format!(
                "cannot start Windows WTS notification thread: {error}"
            ))
        })?;

        let handle = match startup_receiver.recv_timeout(SOURCE_CLEANUP_DEADLINE) {
            Ok(Ok(handle)) => handle,
            Ok(Err(primary)) => {
                let _ = activation_sender.send(WindowActivation::Cancel);
                return Err(prefer_cleanup(
                    primary,
                    finish_thread(&mut thread, &cleanup_receiver),
                ));
            }
            Err(error) => {
                let _ = activation_sender.send(WindowActivation::Cancel);
                let primary = CaptureSessionError::Backend(format!(
                    "Windows WTS notification thread ended during startup: {error}"
                ));
                return Err(prefer_cleanup(
                    primary,
                    finish_thread(&mut thread, &cleanup_receiver),
                ));
            }
        };
        if activation_sender.send(WindowActivation::Activate).is_err() {
            let primary = CaptureSessionError::Backend(
                "Windows WTS notification thread ended before activation".to_owned(),
            );
            return Err(prefer_cleanup(
                primary,
                finish_thread(&mut thread, &cleanup_receiver),
            ));
        }
        Ok(Self {
            ownership,
            thread_id: handle.thread_id,
            thread: Some(thread),
            cleanup: cleanup_receiver,
        })
    }

    pub(super) fn stop(&mut self) -> Result<(), CaptureSessionError> {
        // The watcher holds this same mutex across HWND destruction. Posting
        // while holding it proves the numeric handle still belongs to us and
        // cannot have been recycled for another window.
        let signal_error = with_published_window(&self.ownership, |window| {
            // SAFETY: ownership proves this is the live HWND created by this watcher.
            let posted = unsafe { PostMessageW(window, WM_STOP_SESSION_WATCHER, 0, 0) } != 0;
            if posted {
                None
            } else {
                // SAFETY: this identifier belongs to the still-live watcher
                // thread because its unwind guard cannot clear ownership
                // until this closure releases the mutex.
                let fallback = unsafe { PostThreadMessageW(self.thread_id, WM_QUIT, 0, 0) } != 0;
                if fallback {
                    None
                } else {
                    Some(cleanup_error(
                        "Windows WTS watcher could not be signaled for shutdown",
                    ))
                }
            }
        })
        .flatten();
        let Some(mut thread) = self.thread.take() else {
            return signal_error.map_or(Ok(()), Err);
        };
        let thread_result = finish_thread(&mut thread, &self.cleanup);
        if let Some(error) = signal_error {
            thread_result?;
            Err(error)
        } else {
            thread_result
        }
    }

    #[cfg(test)]
    pub(super) fn simulate_session_change(&self) -> Result<(), CaptureSessionError> {
        let ownership = self
            .ownership
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        let Some(window) = ownership.window else {
            return Err(CaptureSessionError::Backend(
                "Windows WTS test window is no longer live".to_owned(),
            ));
        };
        // SAFETY: the test posts the real WTS message to this watcher's live
        // hidden window without manufacturing native pointers.
        if unsafe {
            PostMessageW(
                window as HWND,
                WM_WTSSESSION_CHANGE,
                WPARAM::try_from(WTS_SESSION_REMOTE_CONTROL).unwrap_or_default(),
                0,
            )
        } != 0
        {
            Ok(())
        } else {
            Err(last_backend_error("PostMessageW(WM_WTSSESSION_CHANGE)"))
        }
    }
}

fn run_window_thread(
    notifications: Arc<NotificationState>,
    shutdown: &AtomicBool,
    ownership: &Mutex<WindowOwnership>,
    startup: &SyncSender<Result<WindowHandle, CaptureSessionError>>,
    activation: &Receiver<WindowActivation>,
    cleanup: &SyncSender<Result<(), CaptureSessionError>>,
    emitter: &CaptureSessionEmitter,
) {
    let class_name = next_window_class_name();
    // SAFETY: a null module name requests the current process module.
    let instance = unsafe { GetModuleHandleW(ptr::null()) };
    if instance.is_null() {
        finish_startup(
            startup,
            cleanup,
            Err(last_backend_error("GetModuleHandleW")),
        );
        return;
    }
    let window_class = WNDCLASSW {
        lpfnWndProc: Some(window_proc),
        hInstance: instance,
        lpszClassName: class_name.as_ptr(),
        ..WNDCLASSW::default()
    };
    // SAFETY: the class name and structure remain live until unregistration.
    if unsafe { RegisterClassW(&raw const window_class) } == 0 {
        finish_startup(startup, cleanup, Err(last_backend_error("RegisterClassW")));
        return;
    }
    // SAFETY: the class is registered and optional handles are null.
    let window = unsafe {
        CreateWindowExW(
            0,
            class_name.as_ptr(),
            class_name.as_ptr(),
            0,
            0,
            0,
            0,
            0,
            ptr::null_mut(),
            ptr::null_mut(),
            instance,
            ptr::null(),
        )
    };
    if window.is_null() {
        let primary = last_backend_error("CreateWindowExW");
        let result = prefer_cleanup(primary, unregister_class(&class_name, instance));
        finish_startup(startup, cleanup, Err(result));
        return;
    }
    let context = match install_context(window, notifications) {
        Ok(context) => context,
        Err(primary) => {
            let result = prefer_cleanup(
                primary,
                destroy_window(window, ptr::null_mut())
                    .and(unregister_class(&class_name, instance)),
            );
            finish_startup(startup, cleanup, Err(result));
            return;
        }
    };
    // SAFETY: the HWND is live and remains so through explicit WTS unregistration.
    if unsafe { WTSRegisterSessionNotification(window, NOTIFY_FOR_THIS_SESSION) } == 0 {
        let primary = last_backend_error("WTSRegisterSessionNotification");
        let result = prefer_cleanup(
            primary,
            destroy_window(window, context).and(unregister_class(&class_name, instance)),
        );
        finish_startup(startup, cleanup, Err(result));
        return;
    }

    // SAFETY: called on the thread whose identifier is requested.
    let thread_id = unsafe { GetCurrentThreadId() };
    let published_window = PublishedWindow::publish(ownership, window);
    let startup_succeeded = startup.send(Ok(WindowHandle { thread_id })).is_ok();
    let activated = matches!(
        activation.recv_timeout(SOURCE_CLEANUP_DEADLINE),
        Ok(WindowActivation::Activate)
    );
    if startup_succeeded && activated {
        run_message_loop(emitter, shutdown);
    }

    // Hold ownership until destruction completes, preventing another thread
    // from posting through a stale/recycled numeric HWND.
    let cleanup_result = {
        let mut ownership = ownership
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        let result = cleanup_window(window, context, &class_name, instance);
        ownership.window = None;
        result
    };
    drop(published_window);
    if let Err(error) = &cleanup_result {
        poison_native_source_process();
        emitter.fail(error.clone());
    }
    let _ = cleanup.send(cleanup_result);
}

fn run_message_loop(emitter: &CaptureSessionEmitter, shutdown: &AtomicBool) {
    let mut message = MSG::default();
    loop {
        // SAFETY: message points to writable storage and a null HWND accepts
        // messages for the current thread.
        let result = unsafe { GetMessageW(&raw mut message, ptr::null_mut(), 0, 0) };
        if result == -1 {
            emitter.fail(last_backend_error("GetMessageW"));
            break;
        }
        if result == 0 {
            if !shutdown.load(Ordering::Acquire) {
                emitter.fail(CaptureSessionError::Backend(
                    "Windows WTS notification loop exited unexpectedly".to_owned(),
                ));
            }
            break;
        }
        if message.message == WM_STOP_SESSION_WATCHER {
            break;
        }
        // SAFETY: message was initialized by a successful GetMessageW call.
        unsafe {
            TranslateMessage(&raw const message);
            DispatchMessageW(&raw const message);
        }
    }
}

fn cleanup_window(
    window: HWND,
    context: *mut WindowContext,
    class_name: &[u16],
    instance: HMODULE,
) -> Result<(), CaptureSessionError> {
    let mut failure = None;
    // SAFETY: this thread registered this live HWND for WTS notifications.
    if unsafe { WTSUnRegisterSessionNotification(window) } == 0 {
        failure = Some(last_cleanup_error("WTSUnRegisterSessionNotification"));
    }
    record_cleanup(&mut failure, destroy_window(window, context));
    record_cleanup(&mut failure, unregister_class(class_name, instance));
    failure.map_or(Ok(()), Err)
}

fn install_context(
    window: HWND,
    notifications: Arc<NotificationState>,
) -> Result<*mut WindowContext, CaptureSessionError> {
    let pointer = Box::into_raw(Box::new(WindowContext { notifications }));
    // SAFETY: pointer remains allocated until after window destruction. Clear
    // last error because a successful first assignment also returns zero.
    let error = unsafe {
        SetLastError(ERROR_SUCCESS);
        let previous = SetWindowLongPtrW(window, GWLP_USERDATA, pointer.cast::<()>() as isize);
        (previous == 0)
            .then(|| GetLastError())
            .filter(|code| *code != ERROR_SUCCESS)
    };
    if let Some(code) = error {
        // SAFETY: the failed assignment did not transfer pointer ownership.
        unsafe { drop(Box::from_raw(pointer)) };
        return Err(CaptureSessionError::Backend(format!(
            "SetWindowLongPtrW(GWLP_USERDATA) failed with Win32 error {code}"
        )));
    }
    Ok(pointer)
}

fn destroy_window(window: HWND, context: *mut WindowContext) -> Result<(), CaptureSessionError> {
    // SAFETY: window is owned by the current notification thread.
    let destroyed = unsafe { IsWindow(window) } == 0 || unsafe { DestroyWindow(window) } != 0;
    if destroyed {
        if !context.is_null() {
            // SAFETY: the window is gone, so no future dispatch can read this
            // exact Box pointer.
            unsafe { drop(Box::from_raw(context)) };
        }
        Ok(())
    } else {
        // The live HWND can still dispatch and owns this context. Preserve the
        // allocation until the poisoned utility process is replaced.
        Err(last_cleanup_error("DestroyWindow(capture-session watcher)"))
    }
}

fn unregister_class(class_name: &[u16], instance: HMODULE) -> Result<(), CaptureSessionError> {
    // SAFETY: this thread registered the class and its name remains alive.
    if unsafe { UnregisterClassW(class_name.as_ptr(), instance) } != 0 {
        Ok(())
    } else {
        Err(last_cleanup_error(
            "UnregisterClassW(capture-session watcher)",
        ))
    }
}

unsafe extern "system" fn window_proc(
    window: HWND,
    message: u32,
    word_parameter: WPARAM,
    long_parameter: LPARAM,
) -> LRESULT {
    match message {
        WM_WTSSESSION_CHANGE
            if matches!(
                u32::try_from(word_parameter),
                Ok(WTS_CONSOLE_CONNECT
                    | WTS_CONSOLE_DISCONNECT
                    | WTS_REMOTE_CONNECT
                    | WTS_REMOTE_DISCONNECT
                    | WTS_SESSION_REMOTE_CONTROL)
            ) =>
        {
            notify_context(window);
            0
        }
        // This hidden window has no user-close lifecycle. Ignoring WM_CLOSE
        // keeps destruction inside cleanup_window, under the ownership mutex.
        WM_CLOSE => 0,
        WM_DESTROY => {
            // SAFETY: posting quit affects only this message-loop thread.
            unsafe { PostQuitMessage(0) };
            0
        }
        _ => {
            // SAFETY: forwarding unhandled messages is required by the window-proc contract.
            unsafe { DefWindowProcW(window, message, word_parameter, long_parameter) }
        }
    }
}

fn notify_context(window: HWND) {
    // SAFETY: run_window_thread stores this pointer for the entire interval in
    // which the live window can dispatch WTS messages.
    let context =
        unsafe { (GetWindowLongPtrW(window, GWLP_USERDATA) as *const WindowContext).as_ref() };
    if let Some(context) = context {
        context.notifications.notify_transition();
    }
}

fn with_published_window<T, F>(ownership: &Mutex<WindowOwnership>, operation: F) -> Option<T>
where
    F: FnOnce(HWND) -> T,
{
    let ownership = ownership
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    ownership.window.map(|window| operation(window as HWND))
}

fn finish_thread(
    thread: &mut DeadlineThread,
    cleanup: &Receiver<Result<(), CaptureSessionError>>,
) -> Result<(), CaptureSessionError> {
    thread
        .finish(SOURCE_CLEANUP_DEADLINE)
        .map_err(|error| cleanup_error(&format!("Windows WTS notification thread: {error}")))?;
    cleanup.try_recv().unwrap_or_else(|error| {
        Err(cleanup_error(&format!(
            "Windows WTS notification thread omitted its cleanup result: {error}"
        )))
    })
}

fn finish_startup(
    startup: &SyncSender<Result<WindowHandle, CaptureSessionError>>,
    cleanup: &SyncSender<Result<(), CaptureSessionError>>,
    result: Result<(), CaptureSessionError>,
) {
    match result {
        Ok(()) => {
            let error = CaptureSessionError::Backend(
                "Windows WTS notification startup ended without a window".to_owned(),
            );
            let _ = startup.send(Err(error));
            let _ = cleanup.send(Ok(()));
        }
        Err(error) => {
            let _ = startup.send(Err(error.clone()));
            let cleanup_result = if matches!(error, CaptureSessionError::Cleanup(_)) {
                poison_native_source_process();
                Err(error)
            } else {
                Ok(())
            };
            let _ = cleanup.send(cleanup_result);
        }
    }
}

fn next_window_class_name() -> Vec<u16> {
    let id = NEXT_WINDOW_CLASS.fetch_add(1, Ordering::Relaxed);
    format!("ProctorCaptureSessionWatcher-{id}")
        .encode_utf16()
        .chain(std::iter::once(0))
        .collect()
}

fn record_cleanup(
    failure: &mut Option<CaptureSessionError>,
    result: Result<(), CaptureSessionError>,
) {
    if failure.is_none() {
        *failure = result.err();
    }
}

fn prefer_cleanup(
    primary: CaptureSessionError,
    cleanup: Result<(), CaptureSessionError>,
) -> CaptureSessionError {
    cleanup.err().unwrap_or(primary)
}

fn cleanup_error(reason: &str) -> CaptureSessionError {
    poison_native_source_process();
    CaptureSessionError::Cleanup(format!("{reason}; native utility restart is required"))
}

fn last_backend_error(operation: &str) -> CaptureSessionError {
    // SAFETY: GetLastError reads the calling thread's Win32 error slot.
    let code = unsafe { GetLastError() };
    CaptureSessionError::Backend(format!("{operation} failed with Win32 error {code}"))
}

fn last_cleanup_error(operation: &str) -> CaptureSessionError {
    // SAFETY: GetLastError reads the calling thread's Win32 error slot.
    let code = unsafe { GetLastError() };
    cleanup_error(&format!("{operation} failed with Win32 error {code}"))
}

#[cfg(test)]
mod tests {
    use std::ffi::c_void;
    use std::sync::atomic::AtomicU64;

    use super::*;

    #[test]
    fn published_window_is_revoked_on_unwind_before_stop_can_signal() {
        let ownership = Mutex::new(WindowOwnership::default());
        let fake_window = std::ptr::NonNull::<u8>::dangling()
            .as_ptr()
            .cast::<c_void>();
        let unwound = panic::catch_unwind(AssertUnwindSafe(|| {
            let _published = PublishedWindow::publish(&ownership, fake_window);
            assert!(
                ownership
                    .lock()
                    .unwrap_or_else(std::sync::PoisonError::into_inner)
                    .window
                    .is_some()
            );
            panic!("deterministic watcher-thread panic");
        }));
        assert!(unwound.is_err());

        let signal_attempts = AtomicU64::new(0);
        let signaled = with_published_window(&ownership, |_window| {
            signal_attempts.fetch_add(1, Ordering::SeqCst);
        });
        assert!(signaled.is_none());
        assert_eq!(signal_attempts.load(Ordering::SeqCst), 0);
    }
}
