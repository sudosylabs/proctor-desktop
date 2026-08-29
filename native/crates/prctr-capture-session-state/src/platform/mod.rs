#[cfg(any(target_os = "linux", target_os = "macos"))]
mod static_coverage;

#[cfg(any(target_os = "linux", target_os = "macos"))]
pub use static_coverage::StaticCoverageSubscription;

#[cfg(target_os = "linux")]
mod linux;
#[cfg(target_os = "macos")]
mod macos;
#[cfg(target_os = "windows")]
mod windows;

#[cfg(target_os = "linux")]
pub use linux::LinuxCaptureSessionBackend;
#[cfg(target_os = "macos")]
pub use macos::MacOsCaptureSessionBackend;
#[cfg(target_os = "windows")]
pub use windows::WindowsCaptureSessionBackend;
