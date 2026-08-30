use std::fs;
use std::path::Path;
use std::time::Duration;

use crate::InteractiveSessionWire;
use prctr_native_protocol::{
    InteractiveConsoleOwnership, InteractiveLockState, InteractiveRemoteAttachment,
    InteractiveSessionCertainty, InteractiveSessionCoverage, InteractiveSessionState,
    PermissionState, PlatformFamily, ProtocolValidationError, ProtocolViolation,
};
use prctr_native_source_runtime::{
    BoundedFileReadError, InitialFallbackPollingSubscription, OpenedPassiveStateBackend,
    PassiveStateBackend, PassiveStateEmitter, PassiveStateSourceError, PassiveStateWire,
    PollingPassiveStateBackend, read_bounded_utf8_file,
};

const SESSION_ROOT: &str = "/run/systemd/sessions";
const PROCESS_STATUS: &str = "/proc/self/status";
const MAX_RAW_SESSIONS: usize = 4_096;
const MAX_SESSION_FILE_BYTES: usize = 65_536;
const MAX_PROCESS_STATUS_BYTES: usize = 65_536;

pub struct PlatformInteractiveSessionBackend;

impl PassiveStateBackend<InteractiveSessionWire> for PlatformInteractiveSessionBackend {
    type Subscription = InitialFallbackPollingSubscription<InteractiveSessionWire>;

    fn open(
        self,
        emitter: PassiveStateEmitter<InteractiveSessionWire>,
    ) -> Result<
        OpenedPassiveStateBackend<InteractiveSessionWire, Self::Subscription>,
        PassiveStateSourceError,
    > {
        PollingPassiveStateBackend::new(
            PlatformFamily::Linux,
            PermissionState::Granted,
            "linux-logind-session-snapshot-v1",
            Duration::from_millis(500),
            || query_state(Path::new(SESSION_ROOT), Path::new(PROCESS_STATUS)),
        )
        .open_with_initial_backend_fallback(
            emitter,
            "linux-logind-unavailable-v1",
            InteractiveSessionWire::unavailable_state(),
        )
    }
}

fn query_state(
    session_root: &Path,
    process_status: &Path,
) -> Result<InteractiveSessionState, PassiveStateSourceError> {
    let candidate_uid = current_uid(process_status)?;
    let entries = fs::read_dir(session_root).map_err(|error| {
        PassiveStateSourceError::Backend(format!("cannot read Linux logind sessions: {error}"))
    })?;
    let mut sessions = Vec::new();
    for (index, entry) in entries.enumerate() {
        if index >= MAX_RAW_SESSIONS {
            return Err(PassiveStateSourceError::InventoryOverflow(
                "Linux logind session inventory exceeds the source bound".to_owned(),
            ));
        }
        let entry = entry.map_err(|error| {
            PassiveStateSourceError::Backend(format!(
                "cannot inspect one Linux logind session: {error}"
            ))
        })?;
        let internal_id = entry.file_name();
        let internal_id = internal_id.to_str().ok_or_else(|| {
            interactive_protocol_error("session_id", "valid UTF-8 logind identifier")
        })?;
        let contents = read_session_record(&entry.path())?;
        if let Some(session) = parse_session(internal_id, &contents)? {
            sessions.push(session);
        }
    }
    sessions.sort_by(|left, right| left.internal_id.cmp(&right.internal_id));
    let candidate_index = sessions
        .iter()
        .position(|session| session.uid == candidate_uid && session.active && !session.remote);
    let active_local_human = sessions
        .iter()
        .any(|session| session.active && !session.remote);
    let other_count = sessions
        .len()
        .saturating_sub(usize::from(candidate_index.is_some()));
    if other_count > 16 {
        return Err(PassiveStateSourceError::InventoryOverflow(
            "Linux human-session count exceeds the protocol bound".to_owned(),
        ));
    }
    let candidate_lock = candidate_index.and_then(|index| sessions[index].locked);
    Ok(InteractiveSessionState {
        coverage: InteractiveSessionCoverage::SnapshotOnly,
        certainty: InteractiveSessionCertainty::Partial,
        console_ownership: if candidate_index.is_some() {
            InteractiveConsoleOwnership::Candidate
        } else if active_local_human {
            InteractiveConsoleOwnership::OtherHuman
        } else {
            InteractiveConsoleOwnership::None
        },
        lock_state: match candidate_lock {
            Some(true) => InteractiveLockState::Locked,
            Some(false) => InteractiveLockState::Unlocked,
            None => InteractiveLockState::Unknown,
        },
        remote_attachment: if sessions.iter().any(|session| session.remote) {
            InteractiveRemoteAttachment::Present
        } else {
            InteractiveRemoteAttachment::Absent
        },
        other_human_session_count: u8::try_from(other_count).unwrap_or(u8::MAX),
    })
}

fn read_session_record(path: &Path) -> Result<String, PassiveStateSourceError> {
    read_bounded_utf8_file(path, MAX_SESSION_FILE_BYTES).map_err(|error| {
        map_linux_file_error(error, "Linux logind session record", "session_record")
    })
}

fn map_linux_file_error(
    error: BoundedFileReadError,
    description: &'static str,
    field: &'static str,
) -> PassiveStateSourceError {
    match error {
        BoundedFileReadError::Io(error) => {
            PassiveStateSourceError::Backend(format!("cannot read {description}: {error}"))
        }
        BoundedFileReadError::Overflow { .. } => PassiveStateSourceError::InventoryOverflow(
            format!("{description} exceeds the source bound"),
        ),
        BoundedFileReadError::InvalidUtf8 => {
            interactive_protocol_error(field, "valid UTF-8 bounded platform record")
        }
    }
}

fn current_uid(path: &Path) -> Result<u32, PassiveStateSourceError> {
    let contents = read_bounded_utf8_file(path, MAX_PROCESS_STATUS_BYTES).map_err(|error| {
        map_linux_file_error(
            error,
            "Linux candidate account classification",
            "candidate_uid",
        )
    })?;
    parse_current_uid(&contents)
}

fn parse_current_uid(contents: &str) -> Result<u32, PassiveStateSourceError> {
    contents
        .lines()
        .find(|line| line.starts_with("Uid:"))
        .and_then(|line| line.split_ascii_whitespace().nth(1))
        .and_then(|value| value.parse().ok())
        .ok_or_else(|| interactive_protocol_error("candidate_uid", "valid proc status UID field"))
}

fn interactive_protocol_error(field: &'static str, rule: &'static str) -> PassiveStateSourceError {
    PassiveStateSourceError::Protocol(ProtocolViolation::Schema(ProtocolValidationError {
        type_name: "LinuxInteractiveSessionAdapter",
        field,
        rule,
    }))
}

struct LogindSession {
    internal_id: String,
    uid: u32,
    active: bool,
    remote: bool,
    locked: Option<bool>,
}

fn parse_session(
    internal_id: &str,
    contents: &str,
) -> Result<Option<LogindSession>, PassiveStateSourceError> {
    let field = |key: &str| {
        contents.lines().find_map(|line| {
            line.strip_prefix(key)
                .and_then(|value| value.strip_prefix('='))
        })
    };
    let class = field("CLASS")
        .ok_or_else(|| interactive_protocol_error("class", "present logind class"))?;
    let session_type = field("TYPE")
        .ok_or_else(|| interactive_protocol_error("type", "present logind session type"))?;
    if !matches!(class, "user" | "user-early")
        || !matches!(session_type, "tty" | "x11" | "wayland" | "mir")
    {
        return Ok(None);
    }
    let uid = field("UID")
        .and_then(|value| value.parse().ok())
        .ok_or_else(|| interactive_protocol_error("uid", "valid logind UID"))?;
    let active = parse_required_binary_field(field("ACTIVE"), "active")?;
    let remote = parse_required_binary_field(field("REMOTE"), "remote")?;
    let locked = match field("LOCKED_HINT") {
        Some("1") => Some(true),
        Some("0") => Some(false),
        Some(_) => {
            return Err(interactive_protocol_error(
                "locked_hint",
                "binary logind field when present",
            ));
        }
        None => None,
    };
    Ok(Some(LogindSession {
        internal_id: internal_id.to_owned(),
        uid,
        active,
        remote,
        locked,
    }))
}

fn parse_required_binary_field(
    value: Option<&str>,
    field: &'static str,
) -> Result<bool, PassiveStateSourceError> {
    match value {
        Some("1") => Ok(true),
        Some("0") => Ok(false),
        _ => Err(interactive_protocol_error(
            field,
            "present binary logind field",
        )),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parser_keeps_only_human_interactive_session_facts() {
        let session = parse_session(
            "4",
            "UID=1000\nCLASS=user\nTYPE=wayland\nACTIVE=1\nREMOTE=0\nLOCKED_HINT=1\n",
        )
        .expect("valid session record")
        .expect("human session");
        assert_eq!(session.uid, 1000);
        assert!(session.active);
        assert!(!session.remote);
        assert_eq!(session.locked, Some(true));
        assert!(
            parse_session("1", "UID=0\nCLASS=manager\nTYPE=unspecified\n")
                .expect("valid non-human record")
                .is_none()
        );
    }

    #[test]
    fn malformed_candidate_uid_is_a_terminal_protocol_result() {
        assert!(matches!(
            parse_current_uid("Name:\tproctor\nUid:\tnot-a-number\n"),
            Err(PassiveStateSourceError::Protocol(_))
        ));
    }

    #[test]
    fn malformed_human_session_fields_are_terminal_protocol_results() {
        for record in [
            "UID=nope\nCLASS=user\nTYPE=wayland\nACTIVE=1\nREMOTE=0\n",
            "UID=1000\nCLASS=user\nTYPE=wayland\nACTIVE=maybe\nREMOTE=0\n",
            "UID=1000\nCLASS=user\nTYPE=wayland\nACTIVE=1\n",
            "UID=1000\nCLASS=user\nTYPE=wayland\nACTIVE=1\nREMOTE=0\nLOCKED_HINT=maybe\n",
        ] {
            assert!(matches!(
                parse_session("4", record),
                Err(PassiveStateSourceError::Protocol(_))
            ));
        }
    }

    #[test]
    fn bounded_file_overflow_remains_a_terminal_inventory_failure() {
        assert!(matches!(
            map_linux_file_error(
                BoundedFileReadError::Overflow {
                    max_bytes: MAX_SESSION_FILE_BYTES,
                },
                "Linux logind session record",
                "session_record",
            ),
            PassiveStateSourceError::InventoryOverflow(_)
        ));
    }
}
