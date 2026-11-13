//! The privileged helper's platform-neutral core: the per-connection handshake and subscription,
//! and the process table that turns raw OS process events into protocol messages. The OS-facing
//! parts (service entry, pipe, event source) live in the platform modules and feed this core.
#![forbid(unsafe_code)]

pub mod connection;
pub mod hub;
pub mod platform;
pub mod processes;
pub mod sessions;

/// The helper protocol digest this build speaks, from the committed schema.
pub const PROTOCOL_DIGEST: &str =
    include_str!("../../prctr-protocol/schema/helper-protocol.digest");

/// The helper's version, reported in `welcome`.
pub const VERSION: &str = env!("CARGO_PKG_VERSION");
