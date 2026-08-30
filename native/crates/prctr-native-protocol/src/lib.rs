#![forbid(unsafe_code)]

#[path = "candidate_window.generated.rs"]
mod candidate_window_generated;
#[path = "capture_session.generated.rs"]
mod capture_session_generated;
#[path = "clipboard.generated.rs"]
mod clipboard_generated;
#[path = "generated.rs"]
mod generated;
#[path = "interactive_session.generated.rs"]
mod interactive_session_generated;
#[path = "media_device.generated.rs"]
mod media_device_generated;
#[path = "native_helper.generated.rs"]
mod native_helper_generated;
#[path = "network_configuration.generated.rs"]
mod network_configuration_generated;
#[path = "print_spooler.generated.rs"]
mod print_spooler_generated;
#[path = "process_application.generated.rs"]
mod process_application_generated;
#[path = "removable_storage.generated.rs"]
mod removable_storage_generated;
#[path = "virtualization.generated.rs"]
mod virtualization_generated;

use std::fmt;

use serde::{Deserialize, Deserializer, Serializer};

pub use candidate_window_generated::*;
pub use capture_session_generated::*;
pub use clipboard_generated::*;
pub use generated::*;
pub use interactive_session_generated::*;
pub use media_device_generated::*;
pub use native_helper_generated::*;
pub use network_configuration_generated::*;
pub use print_spooler_generated::*;
pub use process_application_generated::*;
pub use removable_storage_generated::*;
pub use virtualization_generated::*;

#[allow(clippy::trivially_copy_pass_by_ref)] // Serde's serialize_with ABI requires a reference.
pub(crate) fn serialize_protocol_safe_u64<S>(value: &u64, serializer: S) -> Result<S::Ok, S::Error>
where
    S: Serializer,
{
    if *value > MAX_PROTOCOL_SAFE_INTEGER {
        return Err(serde::ser::Error::custom(
            "integer exceeds the protocol safe-integer maximum",
        ));
    }
    let wire_value = i64::try_from(*value).map_err(serde::ser::Error::custom)?;
    serializer.serialize_i64(wire_value)
}

pub(crate) fn deserialize_protocol_safe_u64<'de, D>(deserializer: D) -> Result<u64, D::Error>
where
    D: Deserializer<'de>,
{
    let wire_value = i64::deserialize(deserializer)?;
    let value = u64::try_from(wire_value).map_err(serde::de::Error::custom)?;
    if value > MAX_PROTOCOL_SAFE_INTEGER {
        return Err(serde::de::Error::custom(
            "integer exceeds the protocol safe-integer maximum",
        ));
    }
    Ok(value)
}

// Serde's `serialize_with` ABI passes `&T`; for an optional protocol field that
// necessarily makes this parameter `&Option<u64>` rather than `Option<&u64>`.
#[allow(clippy::ref_option)]
pub(crate) fn serialize_protocol_safe_optional_u64<S>(
    value: &Option<u64>,
    serializer: S,
) -> Result<S::Ok, S::Error>
where
    S: Serializer,
{
    match value {
        Some(value) => serialize_protocol_safe_u64(value, serializer),
        None => serializer.serialize_none(),
    }
}

pub(crate) fn deserialize_protocol_safe_optional_u64<'de, D>(
    deserializer: D,
) -> Result<Option<u64>, D::Error>
where
    D: Deserializer<'de>,
{
    let wire_value = Option::<i64>::deserialize(deserializer)?;
    wire_value
        .map(|wire_value| {
            let value = u64::try_from(wire_value).map_err(serde::de::Error::custom)?;
            if value > MAX_PROTOCOL_SAFE_INTEGER {
                return Err(serde::de::Error::custom(
                    "integer exceeds the protocol safe-integer maximum",
                ));
            }
            Ok(value)
        })
        .transpose()
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum ProtocolViolation {
    Schema(ProtocolValidationError),
    SchemaVersion { requested: u16, supported: u16 },
}

impl fmt::Display for ProtocolViolation {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Schema(error) => write!(formatter, "wire schema violation: {error}"),
            Self::SchemaVersion {
                requested,
                supported,
            } => write!(
                formatter,
                "requested schema version {requested} is incompatible with supported version {supported}"
            ),
        }
    }
}

impl std::error::Error for ProtocolViolation {}

impl From<ProtocolValidationError> for ProtocolViolation {
    fn from(error: ProtocolValidationError) -> Self {
        Self::Schema(error)
    }
}

impl SourceOpenRequest {
    /// Validates the bounded source-open request.
    ///
    /// # Errors
    ///
    /// Returns a protocol violation when the identifier, schema version, or
    /// queue capacity is outside the declared wire bounds.
    pub fn validate(&self) -> Result<(), ProtocolViolation> {
        self.validate_for(DISPLAY_TOPOLOGY_SCHEMA_VERSION)
    }

    /// Validates this request for the `CandidateWindow`-state schema.
    ///
    /// # Errors
    ///
    /// Returns a protocol violation when the request is outside the shared
    /// bounds or requests an incompatible `CandidateWindow` schema version.
    pub fn validate_candidate_window(&self) -> Result<(), ProtocolViolation> {
        self.validate_for(CANDIDATE_WINDOW_SCHEMA_VERSION)
    }

    /// Validates this request for the capture and native-session schema.
    ///
    /// # Errors
    ///
    /// Returns a protocol violation when the request is outside the shared
    /// bounds or requests an incompatible capture-session schema version.
    pub fn validate_capture_session(&self) -> Result<(), ProtocolViolation> {
        self.validate_for(CAPTURE_SESSION_SCHEMA_VERSION)
    }

    /// Validates this request for the process/application schema.
    ///
    /// # Errors
    ///
    /// Returns a protocol violation when the request is outside the shared
    /// bounds or requests an incompatible process/application schema version.
    pub fn validate_process_application(&self) -> Result<(), ProtocolViolation> {
        self.validate_for(PROCESS_APPLICATION_SCHEMA_VERSION)
    }

    /// Validates this request against one generated capability schema version.
    ///
    /// # Errors
    ///
    /// Returns a protocol violation when shared bounds fail or the requested
    /// schema version differs from the capability's supported version.
    pub fn validate_for_schema_version(&self, supported: u16) -> Result<(), ProtocolViolation> {
        self.validate_protocol()?;
        if self.requested_schema_version != supported {
            return Err(ProtocolViolation::SchemaVersion {
                requested: self.requested_schema_version,
                supported,
            });
        }
        Ok(())
    }

    fn validate_for(&self, supported: u16) -> Result<(), ProtocolViolation> {
        self.validate_for_schema_version(supported)
    }
}

impl DisplayTopologySnapshot {
    /// Validates target bounds, identity uniqueness, and mirror references.
    ///
    /// # Errors
    ///
    /// Returns a protocol violation when the topology cannot be represented by
    /// the bounded display-topology protocol.
    pub fn validate(&self) -> Result<(), ProtocolViolation> {
        self.validate_protocol()?;
        Ok(())
    }
}

impl CandidateWindowState {
    /// Validates bounds and the mechanical coherence of one `CandidateWindow` state.
    ///
    /// # Errors
    ///
    /// Returns a protocol violation when the state cannot be represented by
    /// the bounded `CandidateWindow` protocol.
    pub fn validate(&self) -> Result<(), ProtocolViolation> {
        self.validate_protocol()?;
        Ok(())
    }
}

impl CaptureSessionState {
    /// Validates bounded, mechanically coherent capture and session facts.
    ///
    /// # Errors
    ///
    /// Returns a protocol violation when a signal overstates its support or certainty.
    pub fn validate(&self) -> Result<(), ProtocolViolation> {
        self.validate_protocol()?;
        Ok(())
    }
}

impl ProcessApplicationState {
    /// Validates bounded coverage, identity, and inventory facts.
    ///
    /// # Errors
    ///
    /// Returns a protocol violation when the inventory overstates coverage,
    /// repeats process identity, or carries an incoherent executable identity.
    pub fn validate(&self) -> Result<(), ProtocolViolation> {
        self.validate_protocol()?;
        Ok(())
    }
}

impl ProcessApplicationEvent {
    /// Validates one bounded transition-oriented process fact.
    ///
    /// # Errors
    ///
    /// Returns a protocol violation when the payload does not match its event
    /// kind or process-instance identity.
    pub fn validate(&self) -> Result<(), ProtocolViolation> {
        self.validate_protocol()?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn request_rejects_incompatible_schema() {
        let request = SourceOpenRequest {
            collection_session_id: "collection-session-0001".to_owned(),
            requested_schema_version: 2,
            queue_capacity: 16,
        };
        assert_eq!(
            request.validate(),
            Err(ProtocolViolation::SchemaVersion {
                requested: 2,
                supported: 1
            })
        );
    }

    #[test]
    fn topology_rejects_unknown_mirror_primary() {
        let topology = DisplayTopologySnapshot {
            certainty: TopologyCertainty::Complete,
            targets: vec![DisplayTarget {
                target_id: "display-1".to_owned(),
                active: true,
                primary_state: DisplayPrimaryState::Primary,
                builtin: true,
                power_state: DisplayPowerState::Awake,
                kind: DisplayTargetKind::Physical,
                mirror_primary_id: Some("missing-display".to_owned()),
                pixel_width: 1920,
                pixel_height: 1080,
            }],
        };
        assert!(matches!(
            topology.validate(),
            Err(ProtocolViolation::Schema(ProtocolValidationError {
                type_name: "DisplayTopologySnapshot",
                field: "targets",
                ..
            }))
        ));
    }

    #[test]
    fn request_length_counts_unicode_code_points_instead_of_utf8_bytes() {
        let request = SourceOpenRequest {
            collection_session_id: "🦀🦀🦀🦀🦀🦀🦀🦀".to_owned(),
            requested_schema_version: DISPLAY_TOPOLOGY_SCHEMA_VERSION,
            queue_capacity: 16,
        };
        assert!(matches!(
            request.validate(),
            Err(ProtocolViolation::Schema(_))
        ));
    }

    #[test]
    fn generated_validation_rejects_nested_wire_bounds() {
        let topology = DisplayTopologySnapshot {
            certainty: TopologyCertainty::Complete,
            targets: vec![DisplayTarget {
                target_id: "x".repeat(129),
                active: true,
                primary_state: DisplayPrimaryState::Primary,
                builtin: true,
                power_state: DisplayPowerState::Awake,
                kind: DisplayTargetKind::Physical,
                mirror_primary_id: None,
                pixel_width: 262_145,
                pixel_height: 1080,
            }],
        };
        assert!(matches!(
            topology.validate(),
            Err(ProtocolViolation::Schema(ProtocolValidationError {
                type_name: "DisplayTarget",
                field: "target_id",
                ..
            }))
        ));
    }

    #[test]
    fn capture_session_signal_cannot_overstate_unsupported_coverage() {
        let state = CaptureSessionState {
            screen_capture: CaptureSessionSignal {
                support: CaptureSessionSupport::Unsupported,
                activity: CaptureSessionActivity::Active,
                certainty: CaptureSessionCertainty::Complete,
            },
            native_remote_session: CaptureSessionSignal {
                support: CaptureSessionSupport::Supported,
                activity: CaptureSessionActivity::Inactive,
                certainty: CaptureSessionCertainty::Complete,
            },
        };
        assert!(matches!(
            state.validate(),
            Err(ProtocolViolation::Schema(ProtocolValidationError {
                type_name: "CaptureSessionSignal",
                field: "support",
                ..
            }))
        ));
    }

    #[test]
    fn generated_validation_covers_reset_and_safe_integer_bounds() {
        let reset = SourceReset {
            source_instance_id: "source-instance-0001".to_owned(),
            sequence: 9_007_199_254_740_992,
            observed_at: SourceTimestamp {
                monotonic_time_ns: 1,
            },
            gap: None,
            reason: "x".repeat(129),
        };
        assert!(matches!(
            reset.validate_protocol(),
            Err(ProtocolValidationError {
                type_name: "SourceReset",
                field: "sequence",
                ..
            })
        ));
        assert!(matches!(
            SequenceGap {
                first_missing: 4,
                last_missing: 3,
            }
            .validate_protocol(),
            Err(ProtocolValidationError {
                type_name: "SequenceGap",
                field: "last_missing",
                ..
            })
        ));
    }

    #[test]
    fn generated_drain_validation_rejects_cross_instance_and_unordered_facts() {
        let observation = |source_instance_id: &str, sequence| DisplayTopologyObservation {
            source_instance_id: source_instance_id.to_owned(),
            sequence,
            observed_at: SourceTimestamp {
                monotonic_time_ns: sequence,
            },
            gap: None,
            topology: DisplayTopologySnapshot {
                certainty: TopologyCertainty::Complete,
                targets: Vec::new(),
            },
        };
        let invalid_source = DisplayTopologyDrain {
            source_instance_id: "source-instance-0001".to_owned(),
            observations: vec![observation("different-instance", 1)],
            resets: Vec::new(),
            health: SourceHealth::Healthy,
            terminal_error: None,
        };
        assert!(matches!(
            invalid_source.validate_protocol(),
            Err(ProtocolValidationError {
                type_name: "DisplayTopologyDrain",
                field: "source_instance_id",
                ..
            })
        ));

        let unordered = DisplayTopologyDrain {
            source_instance_id: "source-instance-0001".to_owned(),
            observations: vec![
                observation("source-instance-0001", 2),
                observation("source-instance-0001", 1),
            ],
            resets: Vec::new(),
            health: SourceHealth::Healthy,
            terminal_error: None,
        };
        assert!(matches!(
            unordered.validate_protocol(),
            Err(ProtocolValidationError {
                type_name: "DisplayTopologyDrain",
                field: "observations",
                ..
            })
        ));

        let unexplained_gap = DisplayTopologyDrain {
            source_instance_id: "source-instance-0001".to_owned(),
            observations: vec![
                observation("source-instance-0001", 1),
                observation("source-instance-0001", 3),
            ],
            resets: Vec::new(),
            health: SourceHealth::Healthy,
            terminal_error: None,
        };
        assert!(matches!(
            unexplained_gap.validate_protocol(),
            Err(ProtocolValidationError {
                type_name: "DisplayTopologyDrain",
                field: "observations",
                ..
            })
        ));
    }

    #[test]
    fn candidate_window_state_rejects_contradictory_absence_facts() {
        let state = CandidateWindowState {
            certainty: CandidateWindowCertainty::Complete,
            presence: CandidateWindowPresence::Absent,
            focus: CandidateWindowFocus::Focused,
            visibility: CandidateWindowVisibility::Visible,
            placement: CandidateWindowPlacement::Maximized,
            bounds: Some(CandidateWindowBounds {
                x: 0,
                y: 0,
                width: 1920,
                height: 1080,
            }),
            display_target_id: Some("display-1".to_owned()),
        };

        assert!(matches!(
            state.validate(),
            Err(ProtocolViolation::Schema(ProtocolValidationError {
                type_name: "CandidateWindowState",
                field: "presence",
                ..
            }))
        ));
    }

    #[test]
    fn candidate_window_drain_rejects_cross_instance_observations() {
        let event = CandidateWindowEvent {
            window: CandidateWindowState {
                certainty: CandidateWindowCertainty::Complete,
                presence: CandidateWindowPresence::Present,
                focus: CandidateWindowFocus::NotFocused,
                visibility: CandidateWindowVisibility::Visible,
                placement: CandidateWindowPlacement::Maximized,
                bounds: Some(CandidateWindowBounds {
                    x: 0,
                    y: 0,
                    width: 1920,
                    height: 1080,
                }),
                display_target_id: Some("display-1".to_owned()),
            },
            close_attempts_since_previous: 0,
        };
        let drain = CandidateWindowDrain {
            source_instance_id: "source-instance-0001".to_owned(),
            health: SourceHealth::Healthy,
            observations: vec![CandidateWindowObservation {
                source_instance_id: "different-instance".to_owned(),
                sequence: 1,
                observed_at: SourceTimestamp {
                    monotonic_time_ns: 1,
                },
                gap: None,
                event,
            }],
            resets: Vec::new(),
            terminal_error: None,
        };

        assert!(matches!(
            drain.validate_protocol(),
            Err(ProtocolValidationError {
                type_name: "CandidateWindowDrain",
                field: "source_instance_id",
                ..
            })
        ));
    }
}
