use std::panic::{self, AssertUnwindSafe};
use std::ptr;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{self, Receiver, SyncSender};

use native_source_runtime::{DeadlineThread, SOURCE_CLEANUP_DEADLINE};
use windows_sys::Win32::Foundation::{
    ERROR_SUCCESS, GetLastError, HWND, LPARAM, LRESULT, SetLastError, WPARAM,
};
use windows_sys::Win32::System::LibraryLoader::GetModuleHandleW;
use windows_sys::Win32::System::Threading::GetCurrentThreadId;
use windows_sys::Win32::UI::WindowsAndMessaging::{
    CreateWindowExW, DefWindowProcW, DestroyWindow, DispatchMessageW, GWLP_USERDATA, GetMessageW,
    GetWindowLongPtrW, IsWindow, MSG, PostMessageW, PostQuitMessage, PostThreadMessageW,
    RegisterClassW, SetWindowLongPtrW, TranslateMessage, UnregisterClassW, WM_APP, WM_CLOSE,
    WM_DESTROY, WM_DISPLAYCHANGE, WM_QUIT, WNDCLASSW,
};

use super::notifications::NotificationState;
use super::{next_window_class_name, poison_watcher};
use crate::{
    DisplayTopologyEmitter, DisplayTopologyError, finish_native_thread, prefer_cleanup_error,
};

const WM_STOP_DISPLAY_WATCHER: u32 = WM_APP + 1;

pub(super) struct WindowWatcher {
    window: isize,
    thread_id: u32,
    thread: Option<DeadlineThread>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum WindowActivation {
    Activate,
    Cancel,
}

impl WindowWatcher {
    pub(super) fn start(
        notifications: Arc<NotificationState>,
        emitter: &DisplayTopologyEmitter,
        shutdown: Arc<AtomicBool>,
    ) -> Result<Self, DisplayTopologyError> {
        let (startup_sender, startup_receiver) = mpsc::sync_channel(1);
        let (activation_sender, activation_receiver) = mpsc::sync_channel(1);
        let mut thread = start_window_thread(
            notifications,
            startup_sender,
            activation_receiver,
            emitter,
            shutdown,
        )?;
        let handle = match startup_receiver.recv_timeout(SOURCE_CLEANUP_DEADLINE) {
            Ok(Ok(handle)) => handle,
            Ok(Err(error)) => {
                let _ = activation_sender.send(WindowActivation::Cancel);
                finish_thread(&mut thread)?;
                return Err(error);
            }
            Err(error) => {
                let _ = activation_sender.send(WindowActivation::Cancel);
                finish_thread(&mut thread)?;
                return Err(DisplayTopologyError::Backend(format!(
                    "Windows display notification thread ended during startup: {error}"
                )));
            }
        };
        if activation_sender.send(WindowActivation::Activate).is_err() {
            finish_thread(&mut thread)?;
            return Err(DisplayTopologyError::Backend(
                "Windows display notification thread ended before activation".to_owned(),
            ));
        }
        Ok(Self {
            window: handle.window,
            thread_id: handle.thread_id,
            thread: Some(thread),
        })
    }

    pub(super) fn stop(&mut self) -> Result<(), DisplayTopologyError> {
        // SAFETY: window is the hidden HWND created by this watcher.
        let window_posted =
            unsafe { PostMessageW(self.window as HWND, WM_STOP_DISPLAY_WATCHER, 0, 0) } != 0;
        let mut stop_signal_failed = false;
        if !window_posted {
            // SAFETY: the id belongs to the live notification thread. WM_QUIT
            // gives it a handle-independent fallback when the HWND is stale.
            let thread_posted = unsafe { PostThreadMessageW(self.thread_id, WM_QUIT, 0, 0) } != 0;
            if !thread_posted {
                stop_signal_failed = true;
            }
        }
        if let Some(mut thread) = self.thread.take()
            && let Err(error) = finish_thread(&mut thread)
        {
            poison_watcher();
            return Err(if stop_signal_failed {
                DisplayTopologyError::Cleanup(format!(
                    "Windows watcher could not be signaled and did not finish: {error}"
                ))
            } else {
                error
            });
        }
        Ok(())
    }
}

#[derive(Clone, Copy)]
struct WindowHandle {
    window: isize,
    thread_id: u32,
}

struct WindowContext {
    notifications: Arc<NotificationState>,
}

fn start_window_thread(
    notifications: Arc<NotificationState>,
    startup: SyncSender<Result<WindowHandle, DisplayTopologyError>>,
    activation: Receiver<WindowActivation>,
    emitter: &DisplayTopologyEmitter,
    shutdown: Arc<AtomicBool>,
) -> Result<DeadlineThread, DisplayTopologyError> {
    let thread_emitter = emitter.clone();
    DeadlineThread::spawn("display-topology-window", move || {
        let result = panic::catch_unwind(AssertUnwindSafe(|| {
            run_window_thread(
                notifications,
                &startup,
                &activation,
                &thread_emitter,
                &shutdown,
            );
        }));
        if result.is_err() {
            poison_watcher();
            thread_emitter.fail(DisplayTopologyError::Backend(
                "Windows display notification thread panicked".to_owned(),
            ));
        }
    })
    .map_err(|error| {
        DisplayTopologyError::Backend(format!(
            "cannot start Windows display notification thread: {error}"
        ))
    })
}

fn run_window_thread(
    notifications: Arc<NotificationState>,
    startup: &SyncSender<Result<WindowHandle, DisplayTopologyError>>,
    activation: &Receiver<WindowActivation>,
    emitter: &DisplayTopologyEmitter,
    shutdown: &AtomicBool,
) {
    let class_name = next_window_class_name();
    // SAFETY: a null module name requests the current process module.
    let instance = unsafe { GetModuleHandleW(ptr::null()) };
    if instance.is_null() {
        let _ = startup.send(Err(last_win32_error("GetModuleHandleW")));
        return;
    }
    let window_class = WNDCLASSW {
        lpfnWndProc: Some(window_proc),
        hInstance: instance,
        lpszClassName: class_name.as_ptr(),
        ..WNDCLASSW::default()
    };
    // SAFETY: window_class and its UTF-16 class name remain alive until this
    // function unregisters the class after the message loop.
    if unsafe { RegisterClassW(&raw const window_class) } == 0 {
        let _ = startup.send(Err(last_win32_error("RegisterClassW")));
        return;
    }
    // SAFETY: the registered class is valid and all optional handles are null.
    // A non-shown top-level window receives the system WM_DISPLAYCHANGE broadcast.
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
        let error = last_win32_error("CreateWindowExW");
        let cleanup = unregister_window_class(&class_name, instance);
        let _ = startup.send(Err(prefer_cleanup_error(error, cleanup)));
        return;
    }
    let context_pointer = match install_window_context(window, notifications) {
        Ok(pointer) => pointer,
        Err(error) => {
            let window_result = destroy_window(window);
            let class_result = unregister_window_class(&class_name, instance);
            let _ = startup.send(Err(prefer_cleanup_error(
                error,
                window_result.and(class_result),
            )));
            return;
        }
    };
    // SAFETY: called on the thread whose identifier is requested.
    let thread_id = unsafe { GetCurrentThreadId() };
    let startup_succeeded = startup
        .send(Ok(WindowHandle {
            window: window as isize,
            thread_id,
        }))
        .is_ok();
    let activated = match activation.recv_timeout(SOURCE_CLEANUP_DEADLINE) {
        Ok(WindowActivation::Activate) => true,
        Ok(WindowActivation::Cancel) | Err(_) => false,
    };
    if startup_succeeded && activated {
        run_message_loop(window, emitter, shutdown);
    }
    destroy_window_and_context(window, context_pointer, emitter);
    if let Err(error) = unregister_window_class(&class_name, instance) {
        emitter.fail(error);
    }
}

fn unregister_window_class(
    class_name: &[u16],
    instance: windows_sys::Win32::Foundation::HMODULE,
) -> Result<(), DisplayTopologyError> {
    // SAFETY: this thread registered the class and calls this only while the
    // UTF-16 class name and module handle remain valid.
    if unsafe { UnregisterClassW(class_name.as_ptr(), instance) } != 0 {
        return Ok(());
    }
    poison_watcher();
    Err(DisplayTopologyError::Cleanup(
        last_win32_error("UnregisterClassW").to_string(),
    ))
}

fn install_window_context(
    window: HWND,
    notifications: Arc<NotificationState>,
) -> Result<*mut WindowContext, DisplayTopologyError> {
    let context_pointer = Box::into_raw(Box::new(WindowContext { notifications }));
    // SAFETY: context_pointer remains allocated until after the window is
    // destroyed. Clear last error because a successful first assignment also returns zero.
    let error = unsafe {
        SetLastError(ERROR_SUCCESS);
        let previous =
            SetWindowLongPtrW(window, GWLP_USERDATA, context_pointer.cast::<()>() as isize);
        (previous == 0)
            .then(|| GetLastError())
            .filter(|code| *code != ERROR_SUCCESS)
    };
    if let Some(code) = error {
        // SAFETY: the failed assignment did not transfer context_pointer.
        unsafe { drop(Box::from_raw(context_pointer)) };
        return Err(win32_error("SetWindowLongPtrW(GWLP_USERDATA)", code));
    }
    Ok(context_pointer)
}

fn destroy_window_and_context(
    window: HWND,
    context_pointer: *mut WindowContext,
    emitter: &DisplayTopologyEmitter,
) {
    match destroy_window(window) {
        Ok(()) => {
            // SAFETY: the window is gone, so no future dispatch can read the raw context.
            unsafe { drop(Box::from_raw(context_pointer)) };
        }
        Err(error) => emitter.fail(error),
    }
}

fn destroy_window(window: HWND) -> Result<(), DisplayTopologyError> {
    // SAFETY: window is owned by the current notification thread.
    if unsafe { IsWindow(window) } == 0 || unsafe { DestroyWindow(window) } != 0 {
        return Ok(());
    }
    poison_watcher();
    Err(DisplayTopologyError::Cleanup(
        last_win32_error("DestroyWindow(display watcher)").to_string(),
    ))
}

fn run_message_loop(window: HWND, emitter: &DisplayTopologyEmitter, shutdown: &AtomicBool) {
    let mut message = MSG::default();
    loop {
        // SAFETY: message points to writable storage and a null HWND accepts
        // messages for the current thread.
        let result = unsafe { GetMessageW(&raw mut message, ptr::null_mut(), 0, 0) };
        if result == -1 {
            emitter.fail(last_win32_error("GetMessageW"));
            break;
        }
        if result == 0 {
            if !shutdown.load(Ordering::Acquire) {
                emitter.fail(DisplayTopologyError::Backend(
                    "Windows display notification loop exited unexpectedly".to_owned(),
                ));
            }
            break;
        }
        if message.message == WM_STOP_DISPLAY_WATCHER {
            // SAFETY: this thread owns the live hidden window and message queue.
            unsafe {
                DestroyWindow(window);
                PostQuitMessage(0);
            }
            continue;
        }
        // SAFETY: message was initialized by a successful GetMessageW call.
        unsafe {
            TranslateMessage(&raw const message);
            DispatchMessageW(&raw const message);
        }
    }
}

unsafe extern "system" fn window_proc(
    window: HWND,
    message: u32,
    word_parameter: WPARAM,
    long_parameter: LPARAM,
) -> LRESULT {
    match message {
        WM_DISPLAYCHANGE => {
            notify_window_context(window);
            0
        }
        WM_CLOSE => {
            // SAFETY: window is the live HWND supplied by Windows to this callback.
            let _ = unsafe { DestroyWindow(window) };
            0
        }
        WM_DESTROY => {
            // SAFETY: posting quit affects only this message-loop thread.
            unsafe { PostQuitMessage(0) };
            0
        }
        _ => {
            // SAFETY: forwarding unhandled messages is the required window-proc contract.
            unsafe { DefWindowProcW(window, message, word_parameter, long_parameter) }
        }
    }
}

fn notify_window_context(window: HWND) {
    // SAFETY: run_window_thread stores a WindowContext pointer for the complete
    // interval in which messages can be dispatched.
    let context =
        unsafe { (GetWindowLongPtrW(window, GWLP_USERDATA) as *const WindowContext).as_ref() };
    let Some(context) = context else { return };
    context.notifications.notify_transition();
}

fn finish_thread(thread: &mut DeadlineThread) -> Result<(), DisplayTopologyError> {
    finish_native_thread(thread, "Windows notification thread")
}

fn win32_error(operation: &str, code: u32) -> DisplayTopologyError {
    DisplayTopologyError::Backend(format!("{operation} failed with Win32 error {code}"))
}

fn last_win32_error(operation: &str) -> DisplayTopologyError {
    // SAFETY: GetLastError reads the calling thread's Win32 error slot.
    win32_error(operation, unsafe { GetLastError() })
}
