//! Safe wrappers over OS APIs. The only native crate allowed `unsafe`: every block states why it is
//! sound, and every wrapper returns owned, validated data.
#![deny(
    unsafe_op_in_unsafe_fn,
    clippy::undocumented_unsafe_blocks,
    clippy::multiple_unsafe_ops_per_block
)]
#![allow(unsafe_code)]

use std::fmt;

#[cfg(target_os = "linux")]
pub mod linux;
#[cfg(target_os = "macos")]
pub mod macos;
#[cfg(target_os = "windows")]
pub mod windows;

/// An OS call failed. Only a bounded operation name and numeric status cross this boundary.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct OsError {
    pub operation: &'static str,
    pub status: i64,
}

impl fmt::Display for OsError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            formatter,
            "{} failed with status {}",
            self.operation, self.status
        )
    }
}

impl std::error::Error for OsError {}

/// What the OS says a display target is.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum RawKind {
    /// A laptop panel.
    BuiltIn,
    /// A physical screen on a direct connector.
    External,
    /// A physical screen behind a software display driver (for example a USB dock).
    IndirectExternal,
    /// A software display with no screen behind it.
    Virtual,
    /// A wireless target (Miracast).
    Wireless,
    /// The OS gave too little information to tell a physical screen from a virtual or wireless one.
    Unclassified,
}

/// One display as the OS reports it, before classification into facts. Identifiers are
/// process-local and never leave the agent.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RawDisplay {
    pub id: u64,
    pub kind: RawKind,
    /// Drawing a desktop now.
    pub active: bool,
    pub main: bool,
    pub asleep: bool,
    /// The display whose image this one shows, if it is a mirror.
    pub mirror_of: Option<u64>,
}

/// Every display, and whether the platform can see mirroring at all.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RawTopology {
    pub displays: Vec<RawDisplay>,
    /// `false` where the platform cannot confirm mirroring (Linux sysfs).
    pub mirroring_known: bool,
}

/// At most this many displays are read; more is reported as an error, never truncated.
pub const MAX_DISPLAYS: usize = 32;
