mod identity;

#[cfg(target_os = "linux")]
mod linux;
#[cfg(target_os = "macos")]
#[allow(unsafe_code)]
mod macos;
#[cfg(target_os = "windows")]
#[allow(unsafe_code)]
mod windows;

#[cfg(target_os = "linux")]
pub use linux::PlatformRemovableStorageBackend;
#[cfg(target_os = "macos")]
pub use macos::PlatformRemovableStorageBackend;
#[cfg(target_os = "windows")]
pub use windows::PlatformRemovableStorageBackend;
