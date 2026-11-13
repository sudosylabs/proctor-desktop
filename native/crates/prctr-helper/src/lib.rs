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

#[cfg(target_os = "macos")]
pub mod macos;
#[cfg(target_os = "windows")]
pub mod windows;

#[cfg(any(target_os = "windows", target_os = "macos"))]
fn os_start(raw: prctr_os::helper::ProcessStart) -> processes::RawStart {
    processes::RawStart {
        pid: raw.pid,
        parent: raw.parent,
        session: raw.session,
        created: raw.created,
    }
}

#[cfg(any(target_os = "windows", target_os = "macos"))]
fn os_session(raw: prctr_os::helper::SessionInfo) -> sessions::RawSessionInfo {
    use prctr_os::helper::Attachment;
    use prctr_protocol::helper::SessionState;
    sessions::RawSessionInfo {
        id: raw.id,
        has_user: raw.has_user,
        remote: raw.remote,
        locked: raw.locked,
        state: match raw.attachment {
            Attachment::Active => SessionState::Active,
            Attachment::Disconnected => SessionState::Disconnected,
            Attachment::Other => SessionState::Other,
        },
    }
}

#[cfg(any(target_os = "windows", target_os = "macos"))]
fn os_identity(raw: prctr_os::RawIdentity) -> prctr_protocol::helper::HelperIdentity {
    use prctr_protocol::{helper::HelperIdentity, scalars::CodeText};
    match raw {
        prctr_os::RawIdentity::MacOs {
            signing_identifier,
            team_id,
            apple,
        } => {
            let Ok(signing_identifier) = CodeText::new(signing_identifier) else {
                return HelperIdentity::Unavailable;
            };
            let Ok(team_id) = team_id.map(CodeText::new).transpose() else {
                return HelperIdentity::Unavailable;
            };
            HelperIdentity::MacOs {
                signing_identifier,
                team_id,
                apple,
            }
        }
        prctr_os::RawIdentity::Windows {
            publisher,
            original_file_name,
        } => {
            let (Ok(publisher), Ok(original_file_name)) =
                (CodeText::new(publisher), CodeText::new(original_file_name))
            else {
                return HelperIdentity::Unavailable;
            };
            HelperIdentity::Windows {
                publisher,
                original_file_name,
            }
        }
        prctr_os::RawIdentity::Unsigned => HelperIdentity::Unsigned,
        _ => HelperIdentity::Unavailable,
    }
}
