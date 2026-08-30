#![deny(unsafe_code)]

#[cfg(any(target_os = "macos", target_os = "windows"))]
use std::{collections::BTreeMap, io, time::Instant};

#[cfg(any(target_os = "macos", target_os = "windows"))]
use prctr_native_helper_protocol::{
    HELPER_PROTOCOL_VERSION, HelperClientMessage, HelperClientMessageKind, HelperEventClass,
    HelperHandshake, HelperKind, HelperServerMessage, HelperServerMessageKind, HelperSourceKind,
    HelperSourceOpen, HelperSourceSnapshot, validate_helper_source_close,
    validate_helper_source_open,
};
#[cfg(any(target_os = "macos", target_os = "windows"))]
use prctr_native_protocol::{
    InteractiveConsoleOwnership, InteractiveLockState, InteractiveRemoteAttachment,
    InteractiveSessionCertainty, InteractiveSessionCoverage, InteractiveSessionState,
    ProcessApplicationCertainty, ProcessApplicationCoverage, ProcessApplicationState,
    ProtocolValidatable,
};
use prctr_native_security_helper::HelperTransportError;
#[cfg(any(target_os = "macos", target_os = "windows"))]
use prctr_native_security_helper::{
    HELPER_BUILD_ID, read_frame, read_json_frame, write_json_frame,
};

#[cfg(any(target_os = "macos", target_os = "windows"))]
struct OpenSource {
    kind: HelperSourceKind,
    schema_version: u16,
}

fn main() {
    let code = match run() {
        Ok(()) => 0,
        Err(error) => {
            let _ = error;
            70
        }
    };
    std::process::exit(code);
}

fn run() -> Result<(), HelperTransportError> {
    platform_run()
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
fn platform_run() -> Result<(), HelperTransportError> {
    Err(HelperTransportError::UnsupportedPlatform)
}

#[cfg(any(target_os = "macos", target_os = "windows"))]
fn platform_run() -> Result<(), HelperTransportError> {
    let kind = platform_helper_kind();
    let mut input = io::stdin().lock();
    let mut output = io::stdout().lock();
    let nonce = String::from_utf8(read_frame(&mut input)?).map_err(|_error| {
        HelperTransportError::Protocol(
            prctr_native_helper_protocol::HelperProtocolError::ChannelNonce,
        )
    })?;
    let capabilities = vec![
        HelperSourceKind::ProcessApplication,
        HelperSourceKind::InteractiveSession,
    ];
    write_json_frame(
        &mut output,
        &HelperHandshake {
            protocol_version: HELPER_PROTOCOL_VERSION,
            channel_nonce: nonce.clone(),
            helper_kind: kind,
            helper_build_id: HELPER_BUILD_ID.to_owned(),
            capabilities: capabilities.clone(),
        },
    )?;

    let started = Instant::now();
    let mut sources = BTreeMap::<String, OpenSource>::new();
    loop {
        let message: HelperClientMessage = match read_json_frame(&mut input) {
            Ok(message) => message,
            Err(HelperTransportError::Io(error))
                if error.kind() == io::ErrorKind::UnexpectedEof && sources.is_empty() =>
            {
                return Ok(());
            }
            Err(error) => return Err(error),
        };
        message.validate_protocol()?;
        match message.kind {
            HelperClientMessageKind::Open => {
                let request = message.open.ok_or({
                    HelperTransportError::Protocol(
                        prctr_native_helper_protocol::HelperProtocolError::Lifecycle,
                    )
                })?;
                validate_helper_source_open(&request, &nonce)?;
                if !source_open_slot_available(&sources, &request, capabilities.len()) {
                    return Err(HelperTransportError::Protocol(
                        prctr_native_helper_protocol::HelperProtocolError::Lifecycle,
                    ));
                }
                let snapshot = unavailable_snapshot(&request, &nonce, started.elapsed().as_nanos());
                sources.insert(
                    request.helper_source_instance_id.clone(),
                    OpenSource {
                        kind: request.source_kind,
                        schema_version: request.schema_version,
                    },
                );
                write_json_frame(&mut output, &snapshot_message(snapshot))?;
            }
            HelperClientMessageKind::Close => {
                let request = message.close.ok_or({
                    HelperTransportError::Protocol(
                        prctr_native_helper_protocol::HelperProtocolError::Lifecycle,
                    )
                })?;
                validate_helper_source_close(&request, &nonce)?;
                let source = sources.remove(&request.helper_source_instance_id).ok_or(
                    HelperTransportError::Protocol(
                        prctr_native_helper_protocol::HelperProtocolError::Lifecycle,
                    ),
                )?;
                let open = HelperSourceOpen {
                    protocol_version: HELPER_PROTOCOL_VERSION,
                    channel_nonce: nonce.clone(),
                    helper_source_instance_id: request.helper_source_instance_id,
                    source_kind: source.kind,
                    schema_version: source.schema_version,
                    queue_capacity: 2,
                    event_classes: event_classes(source.kind),
                };
                write_json_frame(
                    &mut output,
                    &snapshot_message(unavailable_snapshot(
                        &open,
                        &nonce,
                        started.elapsed().as_nanos(),
                    )),
                )?;
            }
        }
    }
}

#[cfg(any(target_os = "macos", target_os = "windows"))]
const fn snapshot_message(snapshot: HelperSourceSnapshot) -> HelperServerMessage {
    HelperServerMessage {
        kind: HelperServerMessageKind::Snapshot,
        snapshot: Some(snapshot),
        observation: None,
        failure: None,
    }
}

#[cfg(any(target_os = "macos", target_os = "windows"))]
fn source_open_slot_available(
    sources: &BTreeMap<String, OpenSource>,
    request: &HelperSourceOpen,
    capability_count: usize,
) -> bool {
    sources.len() < capability_count
        && !sources.contains_key(&request.helper_source_instance_id)
        && !sources
            .values()
            .any(|source| source.kind == request.source_kind)
}

#[cfg(all(test, any(target_os = "macos", target_os = "windows")))]
mod tests {
    use super::*;

    #[test]
    fn active_sources_are_bounded_to_one_instance_per_capability() {
        let mut sources = BTreeMap::new();
        sources.insert(
            "process-source-0001".to_owned(),
            OpenSource {
                kind: HelperSourceKind::ProcessApplication,
                schema_version: 1,
            },
        );
        let duplicate_kind = HelperSourceOpen {
            protocol_version: HELPER_PROTOCOL_VERSION,
            channel_nonce: "1".repeat(64),
            helper_source_instance_id: "process-source-0002".to_owned(),
            source_kind: HelperSourceKind::ProcessApplication,
            schema_version: 1,
            queue_capacity: 8,
            event_classes: vec![HelperEventClass::ProcessLifecycle],
        };
        assert!(!source_open_slot_available(&sources, &duplicate_kind, 2));
        let session = HelperSourceOpen {
            helper_source_instance_id: "session-source-0001".to_owned(),
            source_kind: HelperSourceKind::InteractiveSession,
            event_classes: vec![HelperEventClass::InteractiveSessionLifecycle],
            ..duplicate_kind
        };
        assert!(source_open_slot_available(&sources, &session, 2));
        sources.insert(
            "session-source-0001".to_owned(),
            OpenSource {
                kind: HelperSourceKind::InteractiveSession,
                schema_version: 1,
            },
        );
        assert_eq!(sources.len(), 2);
        let another = HelperSourceOpen {
            helper_source_instance_id: "session-source-0002".to_owned(),
            ..session
        };
        assert!(!source_open_slot_available(&sources, &another, 2));
    }
}

#[cfg(any(target_os = "macos", target_os = "windows"))]
fn unavailable_snapshot(
    request: &HelperSourceOpen,
    nonce: &str,
    monotonic_time_ns: u128,
) -> HelperSourceSnapshot {
    let monotonic_time_ns = u64::try_from(monotonic_time_ns)
        .unwrap_or(9_007_199_254_740_991)
        .min(9_007_199_254_740_991);
    HelperSourceSnapshot {
        protocol_version: HELPER_PROTOCOL_VERSION,
        channel_nonce: nonce.to_owned(),
        helper_source_instance_id: request.helper_source_instance_id.clone(),
        source_kind: request.source_kind,
        schema_version: request.schema_version,
        last_sequence: 0,
        monotonic_time_ns,
        process_state: matches!(request.source_kind, HelperSourceKind::ProcessApplication).then(
            || ProcessApplicationState {
                coverage: ProcessApplicationCoverage::Unavailable,
                certainty: ProcessApplicationCertainty::Unknown,
                processes: Vec::new(),
            },
        ),
        interactive_session_state: matches!(
            request.source_kind,
            HelperSourceKind::InteractiveSession
        )
        .then(|| InteractiveSessionState {
            coverage: InteractiveSessionCoverage::Unavailable,
            certainty: InteractiveSessionCertainty::Unknown,
            console_ownership: InteractiveConsoleOwnership::Unknown,
            lock_state: InteractiveLockState::Unknown,
            remote_attachment: InteractiveRemoteAttachment::Unknown,
            other_human_session_count: 0,
        }),
    }
}

#[cfg(any(target_os = "macos", target_os = "windows"))]
fn event_classes(kind: HelperSourceKind) -> Vec<HelperEventClass> {
    match kind {
        HelperSourceKind::ProcessApplication => vec![HelperEventClass::ProcessLifecycle],
        HelperSourceKind::InteractiveSession => {
            vec![HelperEventClass::InteractiveSessionLifecycle]
        }
    }
}

#[cfg(any(target_os = "macos", target_os = "windows"))]
const fn platform_helper_kind() -> HelperKind {
    #[cfg(target_os = "windows")]
    {
        HelperKind::WindowsSecurityService
    }
    #[cfg(target_os = "macos")]
    {
        HelperKind::MacosEndpointSecurityHelper
    }
}
