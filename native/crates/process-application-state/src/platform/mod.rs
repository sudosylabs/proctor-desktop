mod snapshot;
mod unavailable;

#[cfg(target_os = "linux")]
mod linux;
#[cfg(target_os = "macos")]
#[allow(unsafe_code)]
mod macos;
#[cfg(target_os = "macos")]
mod macos_audit_token;
#[cfg(target_os = "macos")]
mod macos_endpoint_security;
#[cfg(target_os = "macos")]
#[allow(unsafe_code)]
mod macos_inventory;
#[cfg(target_os = "macos")]
pub use macos_endpoint_security::{
    EndpointSecurityBootstrapRegistrar, EndpointSecurityEventFeed, EndpointSecuritySubscription,
};
#[cfg(target_os = "macos")]
mod macos_lifecycle;
#[cfg(target_os = "macos")]
pub use macos_inventory::MacOsAuditProcessInventory;
#[cfg(target_os = "windows")]
#[allow(unsafe_code)]
mod windows;
#[cfg(target_os = "windows")]
mod windows_etw;
#[cfg(target_os = "windows")]
pub use windows_etw::{
    WindowsEtwDrain, WindowsEtwFailure, WindowsEtwProcessEvent, WindowsEtwProcessFeed,
    WindowsProcessLifetime,
};

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

#[cfg(any(target_os = "windows", test))]
mod windows_etw_core;

#[cfg(target_os = "windows")]
mod windows_inventory;
#[cfg(any(target_os = "windows", test))]
mod windows_lifecycle;
#[cfg(target_os = "windows")]
pub use windows_inventory::{WindowsPinnedProcessInventory, WindowsPinnedProcessScope};
#[cfg(target_os = "windows")]
pub use windows_lifecycle::{
    UnavailableWindowsPrefixBarrier, WindowsCandidateSession, WindowsCompletePrefixBarrier,
    WindowsEnrichedProcessEvent, WindowsInventoryCapture, WindowsInventoryFact,
    WindowsLifecycleEvent, WindowsLifecycleFailure, WindowsLifecycleSnapshot,
    WindowsPrefixCheckpoint, WindowsProcessAccount, WindowsProcessReconciler,
    WindowsProcessScopeBackend, WindowsScopeDrain, WindowsScopeEnricher,
};

#[cfg(target_os = "macos")]
mod macos_executable_identity;
