mod snapshot;
mod unavailable;

#[cfg(target_os = "linux")]
mod linux;
#[cfg(target_os = "macos")]
#[allow(unsafe_code)]
mod macos;
#[cfg(target_os = "macos")]
mod macos_lifecycle;
#[cfg(target_os = "windows")]
#[allow(unsafe_code)]
mod windows;

#[cfg(target_os = "linux")]
pub use linux::LinuxProcessApplicationBackend;
#[cfg(target_os = "macos")]
pub use macos::MacOsProcessApplicationBackend;
#[cfg(target_os = "macos")]
pub use macos_lifecycle::{
    MacOsCandidateAuditSession, MacOsIdentityResolution, MacOsLifecycleCheckpoint,
    MacOsLifecycleClose, MacOsLifecycleDrain, MacOsLifecycleEvent, MacOsLifecycleEventFeed,
    MacOsLifecycleFailure, MacOsLifecycleInput, MacOsLifecycleSink, MacOsLifecycleSubscription,
    MacOsLifecycleTerminal, MacOsLifecycleTimeOrigin, MacOsProcessAccountClass, MacOsProcessFact,
    MacOsProcessInventory, MacOsProcessInventoryCollector, MacOsProcessKey, MacOsProcessLifecycle,
};
pub use unavailable::UnavailableProcessApplicationSubscription;
#[cfg(target_os = "windows")]
pub use windows::WindowsProcessApplicationBackend;
