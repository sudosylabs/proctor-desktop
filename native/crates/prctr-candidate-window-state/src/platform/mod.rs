mod event_backend;
#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
mod linux;
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
mod macos;
#[cfg_attr(not(target_os = "windows"), allow(dead_code))]
mod windows;

pub use event_backend::{
    CandidateWindowUtilityIngress, CandidateWindowUtilityIngressOutcome,
    CandidateWindowUtilityReceiver, candidate_window_utility_ingress,
};

#[cfg(target_os = "linux")]
pub use linux::LinuxCandidateWindowBackend;
#[cfg(target_os = "macos")]
pub use macos::MacOsCandidateWindowBackend;
#[cfg(target_os = "windows")]
pub use windows::WindowsCandidateWindowBackend;
