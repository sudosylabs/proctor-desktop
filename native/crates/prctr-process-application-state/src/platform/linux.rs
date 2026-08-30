use std::fs;
use std::path::Path;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use prctr_native_protocol::{
    PlatformFamily, ProcessApplicationScope, ProtocolValidationError, ProtocolViolation,
};

use super::snapshot::{
    InitialFallbackSnapshotProcessSubscription, ProcessIdentityTracker,
    SnapshotPollingProcessBackend,
};
use crate::{
    OpenedProcessApplicationBackend, ProcessApplicationBackend, ProcessApplicationEmitter,
    ProcessApplicationError,
};
use prctr_native_source_runtime::{BoundedFileReadError, read_bounded_utf8_file};

const PROCESS_ROOT: &str = "/proc";
const MAX_RAW_PROCESS_ENTRIES: usize = 65_536;
const MAX_PROCESS_STATUS_BYTES: usize = 65_536;
const MAX_PROCESS_STAT_BYTES: usize = 65_536;

pub struct LinuxProcessApplicationBackend;

impl ProcessApplicationBackend for LinuxProcessApplicationBackend {
    type Subscription = InitialFallbackSnapshotProcessSubscription;

    fn open(
        self,
        emitter: ProcessApplicationEmitter,
    ) -> Result<OpenedProcessApplicationBackend<Self::Subscription>, ProcessApplicationError> {
        let tracker = Arc::new(Mutex::new(ProcessIdentityTracker::default()));
        let query_tracker = Arc::clone(&tracker);
        SnapshotPollingProcessBackend::new(
            PlatformFamily::Linux,
            "linux-proc-snapshot-v1",
            Duration::from_millis(500),
            move || query_state(&query_tracker, Path::new(PROCESS_ROOT)),
        )
        .open_with_initial_backend_fallback(emitter, "linux-proc-unavailable-v1")
    }
}

fn query_state(
    tracker: &Mutex<ProcessIdentityTracker>,
    process_root: &Path,
) -> Result<prctr_native_protocol::ProcessApplicationState, ProcessApplicationError> {
    let candidate_uid = process_uid(&process_root.join("self/status"))?;
    let entries = fs::read_dir(process_root).map_err(|error| {
        ProcessApplicationError::Backend(format!("cannot read Linux process inventory: {error}"))
    })?;
    let mut raw_keys = Vec::new();
    let mut scanned = 0_usize;
    for entry in entries {
        let entry = entry.map_err(|error| {
            ProcessApplicationError::Backend(format!(
                "cannot inspect one Linux process entry: {error}"
            ))
        })?;
        let name = entry.file_name();
        let name = name.to_string_lossy();
        if !name.bytes().all(|byte| byte.is_ascii_digit()) {
            continue;
        }
        scanned += 1;
        if scanned > MAX_RAW_PROCESS_ENTRIES {
            return Err(ProcessApplicationError::InventoryOverflow(
                "Linux process inventory exceeds the source bound".to_owned(),
            ));
        }
        let path = entry.path();
        match process_uid(&path.join("status")) {
            Ok(uid) if uid == candidate_uid => {}
            Ok(_) | Err(ProcessApplicationError::Backend(_)) => continue,
            Err(error) => return Err(error),
        }
        let stat = match read_process_file(
            &path.join("stat"),
            MAX_PROCESS_STAT_BYTES,
            "process_stat",
            "Linux process stat record",
        ) {
            Ok(stat) => stat,
            Err(ProcessApplicationError::Backend(_)) => continue,
            Err(error) => return Err(error),
        };
        let start_time = process_start_time(&stat)?;
        raw_keys.push(format!("{name}:{start_time}"));
    }
    tracker
        .lock()
        .map_err(|_poisoned| {
            ProcessApplicationError::Backend(
                "Linux process identity tracker lock was poisoned".to_owned(),
            )
        })?
        // A matching UID does not establish membership in the candidate's
        // interactive logind/seat session. Keep these facts unclassified until
        // a session-aware Linux adapter can prove that relationship.
        .snapshot_with_scope(raw_keys, ProcessApplicationScope::Unknown)
}

fn process_uid(path: &Path) -> Result<u32, ProcessApplicationError> {
    let contents = read_process_file(
        path,
        MAX_PROCESS_STATUS_BYTES,
        "candidate_uid",
        "Linux process account classification",
    )?;
    parse_process_uid(&contents)
}

fn read_process_file(
    path: &Path,
    max_bytes: usize,
    field: &'static str,
    description: &'static str,
) -> Result<String, ProcessApplicationError> {
    read_bounded_utf8_file(path, max_bytes).map_err(|error| match error {
        BoundedFileReadError::Io(error) => {
            ProcessApplicationError::Backend(format!("cannot read {description}: {error}"))
        }
        BoundedFileReadError::Overflow { .. } => ProcessApplicationError::InventoryOverflow(
            format!("{description} exceeds the source bound"),
        ),
        BoundedFileReadError::InvalidUtf8 => {
            process_protocol_error(field, "valid UTF-8 bounded proc record")
        }
    })
}

fn process_protocol_error(field: &'static str, rule: &'static str) -> ProcessApplicationError {
    ProcessApplicationError::Protocol(ProtocolViolation::Schema(ProtocolValidationError {
        type_name: "LinuxProcessApplicationAdapter",
        field,
        rule,
    }))
}

fn parse_process_uid(contents: &str) -> Result<u32, ProcessApplicationError> {
    contents
        .lines()
        .find(|line| line.starts_with("Uid:"))
        .and_then(|line| {
            line.split_ascii_whitespace()
                .nth(1)
                .and_then(|value| value.parse().ok())
        })
        .ok_or(process_protocol_error(
            "candidate_uid",
            "valid proc status UID field",
        ))
}

fn process_start_time(stat: &str) -> Result<u64, ProcessApplicationError> {
    let start_time = stat
        .rsplit_once(") ")
        .and_then(|(_, after_name)| after_name.split_ascii_whitespace().nth(19))
        .ok_or(process_protocol_error(
            "process_stat",
            "complete proc stat start-time field",
        ))?;
    start_time.parse::<u64>().map_err(|_error| {
        process_protocol_error("process_stat", "numeric proc stat start-time field")
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn proc_stat_parser_ignores_spaces_and_parentheses_inside_process_names() {
        let stat = "42 (name with ) spaces) S 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 999 20";
        assert_eq!(process_start_time(stat).expect("valid stat"), 999);
    }

    #[test]
    fn malformed_authoritative_process_uid_is_a_terminal_protocol_result() {
        assert!(matches!(
            parse_process_uid("Name:\tproctor\nUid:\tnot-a-number\n"),
            Err(ProcessApplicationError::Protocol(_))
        ));
        assert!(matches!(
            parse_process_uid("Name:\tproctor\n"),
            Err(ProcessApplicationError::Protocol(_))
        ));
        assert!(matches!(
            process_start_time("malformed"),
            Err(ProcessApplicationError::Protocol(_))
        ));
        let non_numeric_start_time =
            "42 (proctor) S 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 invalid 20";
        assert!(matches!(
            process_start_time(non_numeric_start_time),
            Err(ProcessApplicationError::Protocol(_))
        ));
    }
}
