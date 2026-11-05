mod classification;

#[cfg(target_os = "linux")]
mod linux;
#[cfg(target_os = "macos")]
mod macos;
#[cfg(target_os = "windows")]
#[allow(unsafe_code)]
mod windows;

#[cfg(target_os = "linux")]
pub use linux::PlatformVirtualizationBackend;
#[cfg(target_os = "macos")]
pub use macos::PlatformVirtualizationBackend;
#[cfg(target_os = "windows")]
pub use windows::PlatformVirtualizationBackend;
