use super::SERVICE_NAME;
use crate::platform::Control;
use std::ffi::OsString;
use std::sync::{
    Mutex, OnceLock,
    mpsc::{self, Receiver},
};
use std::time::Duration;
use windows_service::{
    define_windows_service,
    service::{
        ServiceControl, ServiceControlAccept, ServiceExitCode, ServiceState, ServiceStatus,
        ServiceType,
    },
    service_control_handler::{self, ServiceControlHandlerResult},
    service_dispatcher,
};

pub struct ServiceContext {
    controls: Receiver<Control>,
}
impl ServiceContext {
    #[must_use]
    pub const fn controls(&self) -> &Receiver<Control> {
        &self.controls
    }
}
/// The helper's body; `false` when it ended because of a failure.
type Run = Box<dyn FnOnce(ServiceContext) -> bool + Send>;
static RUN: OnceLock<Mutex<Option<Run>>> = OnceLock::new();
define_windows_service!(ffi_main, service_main);
fn service_main(_arguments: Vec<OsString>) {
    let Some(run) = RUN.get().and_then(|slot| slot.lock().ok()?.take()) else {
        return;
    };
    let (sender, controls) = mpsc::channel();
    let Ok(status) = service_control_handler::register(SERVICE_NAME, move |control| {
        let event = match control {
            ServiceControl::Stop | ServiceControl::Shutdown => Control::Stop,
            ServiceControl::SessionChange(_) => Control::SessionChanged,
            ServiceControl::Interrogate => return ServiceControlHandlerResult::NoError,
            _ => return ServiceControlHandlerResult::NotImplemented,
        };
        let _ = sender.send(event);
        ServiceControlHandlerResult::NoError
    }) else {
        return;
    };
    let report = |state, accepted, exit_code| {
        status.set_service_status(ServiceStatus {
            service_type: ServiceType::OWN_PROCESS,
            current_state: state,
            controls_accepted: accepted,
            exit_code,
            checkpoint: 0,
            wait_hint: Duration::ZERO,
            process_id: None,
        })
    };
    let succeeded = report(
        ServiceState::Running,
        ServiceControlAccept::STOP
            | ServiceControlAccept::SHUTDOWN
            | ServiceControlAccept::SESSION_CHANGE,
        ServiceExitCode::Win32(0),
    )
    .is_ok()
        && run(ServiceContext { controls });
    // A failure is reported as a service-specific exit code, so the service manager's recovery
    // actions apply; a requested stop is a clean exit.
    let exit = if succeeded {
        ServiceExitCode::Win32(0)
    } else {
        ServiceExitCode::ServiceSpecific(1)
    };
    let _ = report(ServiceState::Stopped, ServiceControlAccept::empty(), exit);
}

/// Dispatches through SCM, or runs the same core for privileged console tests.
/// # Errors
/// Returns SCM dispatch or console-control initialization failure.
pub fn windows_service_main(
    run: impl FnOnce(ServiceContext) -> bool + Send + 'static,
) -> windows_service::Result<()> {
    if std::env::args_os().any(|arg| arg == "--console") {
        let (sender, controls) = mpsc::channel();
        let shutdown =
            prctr_os::windows::helper::console_stop().map_err(windows_service::Error::Winapi)?;
        std::thread::Builder::new()
            .name("prctr-helper-console-stop".into())
            .spawn(move || {
                let _ = shutdown.recv();
                let _ = sender.send(Control::Stop);
            })
            .map_err(windows_service::Error::Winapi)?;
        return if run(ServiceContext { controls }) {
            Ok(())
        } else {
            Err(windows_service::Error::Winapi(std::io::Error::other(
                "the helper failed",
            )))
        };
    }
    if RUN.set(Mutex::new(Some(Box::new(run)))).is_err() {
        return Err(windows_service::Error::Winapi(
            std::io::ErrorKind::AlreadyExists.into(),
        ));
    }
    service_dispatcher::start(SERVICE_NAME, ffi_main)
}
