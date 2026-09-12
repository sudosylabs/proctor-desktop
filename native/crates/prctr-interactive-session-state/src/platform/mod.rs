#[cfg(target_os = "linux")]
mod linux;
#[cfg(target_os = "macos")]
mod macos;
#[cfg(target_os = "windows")]
#[allow(unsafe_code)]
mod windows;

#[cfg(target_os = "linux")]
pub use linux::PlatformInteractiveSessionBackend;
#[cfg(target_os = "macos")]
pub use macos::PlatformInteractiveSessionBackend;
#[cfg(target_os = "windows")]
pub use windows::PlatformInteractiveSessionBackend;

#[cfg(target_os = "windows")]
#[allow(unsafe_code)]
mod windows_service;
#[cfg(target_os = "windows")]
pub use windows_service::{
    WindowsCandidateSession, WindowsWtsServiceDispatcher, WindowsWtsSessionDrain,
    WindowsWtsSessionEvent, WindowsWtsSessionSnapshot, WindowsWtsSessionSource,
};

#[cfg(any(target_os = "windows", test))]
#[cfg_attr(not(target_os = "windows"), allow(dead_code))]
mod windows_session_events;

#[cfg(any(target_os = "macos", test))]
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
mod macos_session_events;
#[cfg(target_os = "macos")]
mod macos_session_feed;
#[cfg(target_os = "macos")]
pub use macos_session_events::{
    MacOsGraphicalSessionId, MacOsSessionFeedDrain, MacOsSessionFeedFailure,
    MacOsSessionNotification, MacOsSessionNotificationKind,
};
#[cfg(target_os = "macos")]
pub use macos_session_feed::{MacOsSessionEventFeed, MacOsSessionFeedClose};
