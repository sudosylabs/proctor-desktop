#![deny(unsafe_code)]

#[cfg(any(target_os = "macos", target_os = "windows"))]
use std::io;

#[cfg(any(target_os = "macos", target_os = "windows"))]
use prctr_native_helper_protocol::HelperKind;
use prctr_native_security_helper::HelperTransportError;

#[cfg(any(target_os = "macos", target_os = "windows"))]
mod helper_server;

fn main() {
    let code = match run() {
        Ok(()) => 0,
        Err(error) => {
            let _ = error;
            70
        }
    };
    std::process::exit(code);
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
