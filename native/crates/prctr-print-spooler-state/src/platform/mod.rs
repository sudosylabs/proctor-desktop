#[cfg(any(target_os = "linux", target_os = "macos"))]
mod unavailable;
#[cfg(target_os = "windows")]
#[allow(unsafe_code)]
mod windows;

#[cfg(any(target_os = "linux", target_os = "macos"))]
pub use unavailable::PlatformPrintSpoolerBackend;
#[cfg(target_os = "windows")]
pub use windows::PlatformPrintSpoolerBackend;
