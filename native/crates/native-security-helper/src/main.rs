#![deny(unsafe_code)]

#[cfg(any(target_os = "macos", target_os = "windows"))]
use std::io;

#[cfg(any(target_os = "macos", target_os = "windows"))]
use native_helper_protocol::HelperKind;
use native_security_helper::HelperTransportError;

#[cfg(any(target_os = "macos", target_os = "windows"))]
mod helper_server;

#[cfg(target_os = "windows")]
mod windows_service_server;

#[cfg(target_os = "macos")]
mod service_server;
#[cfg(target_os = "macos")]
mod service_worker;

fn main() {
    let code = match run() {
        Ok(()) => 0,
        Err(error) => {
            report_failure(&error);
            70
        }
    };
    std::process::exit(code);
}

/// Writes only the static failure category; error details never leave the helper.
fn report_failure(error: &HelperTransportError) {
    use std::io::Write as _;
    // A service worker's fd 2 is the supervisor's private guard channel, not a log.
    if std::env::args_os()
        .nth(1)
        .is_some_and(|mode| mode == "--service-worker")
    {
        return;
    }
    let _ignored = writeln!(std::io::stderr().lock(), "native-security-helper: {error}");
}

fn run() -> Result<(), HelperTransportError> {
    platform_run()
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
fn platform_run() -> Result<(), HelperTransportError> {
    Err(HelperTransportError::UnsupportedPlatform)
}

#[cfg(any(target_os = "macos", target_os = "windows"))]
fn platform_run() -> Result<(), HelperTransportError> {
    let arguments = std::env::args_os().skip(1).collect::<Vec<_>>();
    #[cfg(target_os = "macos")]
    match arguments.as_slice() {
        [mode] if mode == "--service-worker" => return service_worker::run(),
        [mode] if mode == "--service" => {
            let configuration = native_security_helper::packaged_macos_service_configuration()?;
            native_security_helper::require_macos_service_privilege()?;
            let (control, observation) =
                native_security_helper::activated_macos_service_listeners()?;
            return service_server::run_macos_service(
                control,
                observation,
                service_server::ServiceConfiguration {
                    worker: configuration.worker,
                    client_designated_requirement: configuration.client_designated_requirement,
                },
            );
        }
        _ => {}
    }
    #[cfg(target_os = "windows")]
    if matches!(arguments.as_slice(), [mode] if mode == "--service") {
        let (root, manifest) = native_security_helper::packaged_windows_service_configuration()?;
        return windows_service_server::run(root, manifest);
    }
    if !arguments.is_empty() {
        return Err(HelperTransportError::ConnectionFenced);
    }
    helper_server::run_helper_server(
        io::stdin(),
        io::stdout().lock(),
        platform_helper_kind(),
        helper_server::PlatformHelperSourceFactory::new(),
    )
}

#[cfg(any(target_os = "macos", target_os = "windows"))]
const fn platform_helper_kind() -> HelperKind {
    #[cfg(target_os = "windows")]
    {
        HelperKind::WindowsSecurityService
    }
    #[cfg(target_os = "macos")]
    {
        HelperKind::MacosEndpointSecurityHelper
    }
}
