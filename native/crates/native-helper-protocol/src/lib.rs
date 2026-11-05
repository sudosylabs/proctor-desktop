#![forbid(unsafe_code)]

use std::fmt;

use native_protocol::ProtocolValidatable;
pub use native_protocol::{
    HelperClientMessage, HelperClientMessageKind, HelperEventClass, HelperFailureCode,
    HelperHandshake, HelperKind, HelperObservation, HelperServerMessage, HelperServerMessageKind,
    HelperSourceClose, HelperSourceFailure, HelperSourceKind, HelperSourceOpen,
    HelperSourceSnapshot,
};

pub const MAX_HELPER_FRAME_BYTES: usize = 65_536;
const MAX_HELPER_IDENTIFIER_LENGTH: usize = 64;
const MIN_HELPER_IDENTIFIER_LENGTH: usize = 16;

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct VerifiedHelperPeer {
    pub helper_kind: HelperKind,
    pub helper_build_id: String,
    pub capabilities: Vec<HelperSourceKind>,
}

/// An OS-verified helper peer bound to one fresh private channel and its exact
/// negotiated source set.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct VerifiedHelperChannel {
    peer: VerifiedHelperPeer,
    channel_nonce: String,
    capabilities: Vec<HelperSourceKind>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum HelperProtocolError {
    FrameSize,
    ChannelNonce,
    Identifier,
    PeerIdentity,
    CapabilitySet,
    SourceConfiguration,
    Snapshot,
    Observation,
    Failure,
    Sequence,
    MonotonicTime,
    Lifecycle,
}

impl fmt::Display for HelperProtocolError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(match self {
            Self::FrameSize => "helper frame is outside the fixed size boundary",
            Self::ChannelNonce => "helper channel nonce is invalid or stale",
            Self::Identifier => "helper identifier is outside the bounded format",
            Self::PeerIdentity => "helper peer identity does not match the verified executable",
            Self::CapabilitySet => "helper capability set is invalid",
            Self::SourceConfiguration => "helper source configuration is invalid",
            Self::Snapshot => "helper source snapshot violates its bounded source protocol",
            Self::Observation => "helper observation violates its bounded source protocol",
            Self::Failure => "helper source failure violates its bounded source protocol",
            Self::Sequence => "helper source sequence is not contiguous",
            Self::MonotonicTime => "helper source monotonic time moved backwards",
            Self::Lifecycle => "helper source message is invalid in the current lifecycle phase",
        })
    }
}

impl std::error::Error for HelperProtocolError {}

/// Validates a transport frame before deserialization or allocation of nested payloads.
///
/// # Errors
///
/// Returns [`HelperProtocolError::FrameSize`] for an empty or oversized frame.
pub const fn validate_helper_frame_size(length: usize) -> Result<(), HelperProtocolError> {
    if length == 0 || length > MAX_HELPER_FRAME_BYTES {
        Err(HelperProtocolError::FrameSize)
    } else {
        Ok(())
    }
}

/// Binds a helper-reported handshake to the OS-verified peer and fresh broker nonce.
///
/// # Errors
///
/// Returns a bounded protocol category when nonce, executable identity,
/// or capability declarations do not match.
fn validate_helper_handshake(
    handshake: &HelperHandshake,
    peer: &VerifiedHelperPeer,
    expected_channel_nonce: &str,
) -> Result<(), HelperProtocolError> {
    validate_nonce(&handshake.channel_nonce, expected_channel_nonce)?;
    if !is_identifier(&handshake.helper_build_id)
        || handshake.helper_kind != peer.helper_kind
        || handshake.helper_build_id != peer.helper_build_id
    {
        return Err(HelperProtocolError::PeerIdentity);
    }
    if handshake.validate_protocol().is_err() || handshake.capabilities != peer.capabilities {
        return Err(HelperProtocolError::CapabilitySet);
    }
    Ok(())
}

/// Binds a validated handshake to the OS-verified peer, nonce, and exact source
/// capabilities. Only this returned value can create a helper source fence.
///
/// # Errors
///
/// Returns a bounded protocol category when the handshake differs from the
/// verified executable or the broker-selected capability set.
pub fn bind_verified_helper_channel(
    handshake: &HelperHandshake,
    peer: &VerifiedHelperPeer,
    expected_channel_nonce: &str,
) -> Result<VerifiedHelperChannel, HelperProtocolError> {
    validate_helper_handshake(handshake, peer, expected_channel_nonce)?;
    Ok(VerifiedHelperChannel {
        peer: peer.clone(),
        channel_nonce: expected_channel_nonce.to_owned(),
        capabilities: handshake.capabilities.clone(),
    })
}

impl VerifiedHelperChannel {
    /// Returns the private native channel binding for source lifecycle requests.
    /// This value belongs to the trusted broker and is never a renderer DTO.
    #[must_use]
    pub fn channel_nonce(&self) -> &str {
        &self.channel_nonce
    }
    #[must_use]
    pub const fn peer(&self) -> &VerifiedHelperPeer {
        &self.peer
    }

    /// Creates the only admitted source fence after checking that the source
    /// was negotiated for this verified channel.
    ///
    /// # Errors
    ///
    /// Returns [`HelperProtocolError::CapabilitySet`] for a source outside the
    /// negotiated set, or a source-configuration error for malformed input.
    pub fn open_source(
        &self,
        request: &HelperSourceOpen,
    ) -> Result<HelperSourceFence, HelperProtocolError> {
        if !self.capabilities.contains(&request.source_kind) {
            return Err(HelperProtocolError::CapabilitySet);
        }
        HelperSourceFence::new(request, &self.channel_nonce)
    }

    /// Validates a close request against this verified channel before a caller
    /// clones or serializes any request-owned string.
    ///
    /// # Errors
    ///
    /// Returns a bounded protocol category for a stale channel or invalid source identity.
    pub fn validate_source_close(
        &self,
        request: &HelperSourceClose,
    ) -> Result<(), HelperProtocolError> {
        validate_helper_source_close(request, &self.channel_nonce)
    }
}

/// Validates policy-blind operational source configuration.
///
/// # Errors
///
/// Returns a bounded protocol category for stale channels, invalid limits, or
/// event classes that do not belong to the requested source.
pub fn validate_helper_source_open(
    request: &HelperSourceOpen,
    expected_channel_nonce: &str,
) -> Result<(), HelperProtocolError> {
    validate_nonce(&request.channel_nonce, expected_channel_nonce)?;
    if !is_identifier(&request.helper_source_instance_id) || request.validate_protocol().is_err() {
        return Err(HelperProtocolError::SourceConfiguration);
    }
    Ok(())
}

/// Validates a close request against the active private channel.
///
/// # Errors
///
/// Returns a bounded protocol category for a stale channel or invalid source identity.
pub fn validate_helper_source_close(
    request: &HelperSourceClose,
    expected_channel_nonce: &str,
) -> Result<(), HelperProtocolError> {
    validate_nonce(&request.channel_nonce, expected_channel_nonce)?;
    if !is_identifier(&request.helper_source_instance_id) || request.validate_protocol().is_err() {
        return Err(HelperProtocolError::Identifier);
    }
    Ok(())
}

/// Validates a complete helper source snapshot against its active source binding.
///
/// # Errors
///
/// Returns a bounded protocol category for a stale channel, mismatched source,
/// or incoherent source-specific state.
pub fn validate_helper_source_snapshot(
    snapshot: &HelperSourceSnapshot,
    expected_channel_nonce: &str,
    expected_source_instance_id: &str,
    expected_source_kind: HelperSourceKind,
) -> Result<(), HelperProtocolError> {
    validate_nonce(&snapshot.channel_nonce, expected_channel_nonce)?;
    if snapshot.helper_source_instance_id != expected_source_instance_id
        || !is_identifier(&snapshot.helper_source_instance_id)
    {
        return Err(HelperProtocolError::Identifier);
    }
    if snapshot.source_kind != expected_source_kind || snapshot.validate_protocol().is_err() {
        return Err(HelperProtocolError::Snapshot);
    }
    Ok(())
}

/// Validates a normalized helper fact without accepting paths, policy, or identity context.
///
/// # Errors
///
/// Returns a bounded protocol category for invalid ordering, source identity,
/// channel binding, or generated fact shape.
pub fn validate_helper_observation(
    observation: &HelperObservation,
    expected_channel_nonce: &str,
    expected_source_instance_id: &str,
    expected_source_kind: HelperSourceKind,
) -> Result<(), HelperProtocolError> {
    validate_nonce(&observation.channel_nonce, expected_channel_nonce)?;
    if observation.helper_source_instance_id != expected_source_instance_id
        || !is_identifier(&observation.helper_source_instance_id)
    {
        return Err(HelperProtocolError::Identifier);
    }
    if observation.source_kind != expected_source_kind {
        return Err(HelperProtocolError::Observation);
    }
    observation
        .validate_protocol()
        .map_err(|_error| HelperProtocolError::Observation)
}

/// Validates one terminal helper source failure against its active source binding.
///
/// # Errors
///
/// Returns a bounded protocol category for a stale channel, mismatched source,
/// invalid loss accounting, or malformed failure payload.
pub fn validate_helper_source_failure(
    failure: &HelperSourceFailure,
    expected_channel_nonce: &str,
    expected_source_instance_id: &str,
    expected_source_kind: HelperSourceKind,
) -> Result<(), HelperProtocolError> {
    validate_nonce(&failure.channel_nonce, expected_channel_nonce)?;
    if failure.helper_source_instance_id != expected_source_instance_id
        || !is_identifier(&failure.helper_source_instance_id)
    {
        return Err(HelperProtocolError::Identifier);
    }
    if failure.source_kind != expected_source_kind || failure.validate_protocol().is_err() {
        return Err(HelperProtocolError::Failure);
    }
    Ok(())
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum HelperSourcePhase {
    AwaitingInitialSnapshot,
    Active,
    Failed,
    Closed,
}

/// Fences one helper source's identity, ordering, and monotonic timeline.
///
/// Transport implementations keep this state in the unprivileged utility side;
/// the helper cannot reset it by sending a different source identifier.
pub struct HelperSourceFence {
    channel_nonce: String,
    source_instance_id: String,
    source_kind: HelperSourceKind,
    last_sequence: u64,
    last_monotonic_time_ns: u64,
    phase: HelperSourcePhase,
}

impl HelperSourceFence {
    /// Creates a source fence from a validated open request.
    ///
    /// # Errors
    ///
    /// Returns a bounded protocol category when the open request is invalid or
    /// is not bound to the expected private channel.
    fn new(
        request: &HelperSourceOpen,
        expected_channel_nonce: &str,
    ) -> Result<Self, HelperProtocolError> {
        validate_helper_source_open(request, expected_channel_nonce)?;
        Ok(Self {
            channel_nonce: expected_channel_nonce.to_owned(),
            source_instance_id: request.helper_source_instance_id.clone(),
            source_kind: request.source_kind,
            last_sequence: 0,
            last_monotonic_time_ns: 0,
            phase: HelperSourcePhase::AwaitingInitialSnapshot,
        })
    }

    /// Accepts the race-free sequence-zero snapshot that completes source open.
    ///
    /// # Errors
    ///
    /// Returns an ordering, lifecycle, time, identity, schema, or payload error.
    pub fn accept_initial_snapshot(
        &mut self,
        snapshot: &HelperSourceSnapshot,
    ) -> Result<(), HelperProtocolError> {
        if self.phase != HelperSourcePhase::AwaitingInitialSnapshot {
            return Err(HelperProtocolError::Lifecycle);
        }
        self.validate_snapshot(snapshot)?;
        if snapshot.last_sequence != 0 {
            return Err(HelperProtocolError::Sequence);
        }
        self.last_monotonic_time_ns = snapshot.monotonic_time_ns;
        self.phase = HelperSourcePhase::Active;
        Ok(())
    }

    /// Accepts a terminal source failure produced while the authoritative
    /// sequence-zero inventory is still being constructed.
    ///
    /// # Errors
    ///
    /// Returns an ordering, lifecycle, time, identity, or payload error.
    pub fn accept_initial_failure(
        &mut self,
        failure: &HelperSourceFailure,
    ) -> Result<(), HelperProtocolError> {
        if self.phase != HelperSourcePhase::AwaitingInitialSnapshot {
            return Err(HelperProtocolError::Lifecycle);
        }
        validate_helper_source_failure(
            failure,
            &self.channel_nonce,
            &self.source_instance_id,
            self.source_kind,
        )?;
        if failure.last_sequence != 0 {
            return Err(HelperProtocolError::Sequence);
        }
        self.ensure_monotonic(failure.monotonic_time_ns)?;
        self.last_monotonic_time_ns = failure.monotonic_time_ns;
        self.phase = HelperSourcePhase::Failed;
        Ok(())
    }

    /// Accepts exactly the next source observation.
    ///
    /// # Errors
    ///
    /// Returns an ordering, lifecycle, time, identity, or payload error.
    pub fn accept_observation(
        &mut self,
        observation: &HelperObservation,
    ) -> Result<(), HelperProtocolError> {
        if self.phase != HelperSourcePhase::Active {
            return Err(HelperProtocolError::Lifecycle);
        }
        validate_helper_observation(
            observation,
            &self.channel_nonce,
            &self.source_instance_id,
            self.source_kind,
        )?;
        let expected_sequence = self
            .last_sequence
            .checked_add(1)
            .ok_or(HelperProtocolError::Sequence)?;
        if observation.sequence != expected_sequence {
            return Err(HelperProtocolError::Sequence);
        }
        self.advance(observation.sequence, observation.monotonic_time_ns)
    }

    /// Accepts one terminal operational failure from the helper.
    ///
    /// # Errors
    ///
    /// Returns an ordering, lifecycle, time, identity, or payload error.
    pub fn accept_failure(
        &mut self,
        failure: &HelperSourceFailure,
    ) -> Result<(), HelperProtocolError> {
        if self.phase != HelperSourcePhase::Active {
            return Err(HelperProtocolError::Lifecycle);
        }
        validate_helper_source_failure(
            failure,
            &self.channel_nonce,
            &self.source_instance_id,
            self.source_kind,
        )?;
        if failure.last_sequence != self.last_sequence {
            return Err(HelperProtocolError::Sequence);
        }
        self.ensure_monotonic(failure.monotonic_time_ns)?;
        self.last_monotonic_time_ns = failure.monotonic_time_ns;
        self.phase = HelperSourcePhase::Failed;
        Ok(())
    }

    /// Accepts a cleanup or source-protocol failure returned while an explicit
    /// close is fencing native callback intake. A close failure may follow an
    /// earlier operational failure, but it never advances the source sequence.
    ///
    /// # Errors
    ///
    /// Returns an ordering, lifecycle, time, identity, or payload error.
    pub fn accept_close_failure(
        &mut self,
        failure: &HelperSourceFailure,
    ) -> Result<(), HelperProtocolError> {
        if !matches!(
            self.phase,
            HelperSourcePhase::Active | HelperSourcePhase::Failed
        ) {
            return Err(HelperProtocolError::Lifecycle);
        }
        validate_helper_source_failure(
            failure,
            &self.channel_nonce,
            &self.source_instance_id,
            self.source_kind,
        )?;
        if !matches!(
            failure.failure_code,
            HelperFailureCode::Cleanup | HelperFailureCode::Protocol
        ) {
            return Err(HelperProtocolError::Lifecycle);
        }
        if failure.last_sequence != self.last_sequence {
            return Err(HelperProtocolError::Sequence);
        }
        self.ensure_monotonic(failure.monotonic_time_ns)?;
        self.last_monotonic_time_ns = failure.monotonic_time_ns;
        self.phase = HelperSourcePhase::Failed;
        Ok(())
    }

    /// Accepts the final complete snapshot after callback intake is fenced.
    ///
    /// # Errors
    ///
    /// Returns an ordering, lifecycle, time, identity, schema, or payload error.
    pub fn accept_final_snapshot(
        &mut self,
        snapshot: &HelperSourceSnapshot,
    ) -> Result<(), HelperProtocolError> {
        if !matches!(
            self.phase,
            HelperSourcePhase::Active | HelperSourcePhase::Failed
        ) {
            return Err(HelperProtocolError::Lifecycle);
        }
        self.validate_snapshot(snapshot)?;
        if snapshot.last_sequence != self.last_sequence {
            return Err(HelperProtocolError::Sequence);
        }
        self.ensure_monotonic(snapshot.monotonic_time_ns)?;
        self.last_monotonic_time_ns = snapshot.monotonic_time_ns;
        self.phase = HelperSourcePhase::Closed;
        Ok(())
    }

    fn validate_snapshot(
        &self,
        snapshot: &HelperSourceSnapshot,
    ) -> Result<(), HelperProtocolError> {
        validate_helper_source_snapshot(
            snapshot,
            &self.channel_nonce,
            &self.source_instance_id,
            self.source_kind,
        )
    }

    fn advance(
        &mut self,
        sequence: u64,
        monotonic_time_ns: u64,
    ) -> Result<(), HelperProtocolError> {
        self.ensure_monotonic(monotonic_time_ns)?;
        self.last_sequence = sequence;
        self.last_monotonic_time_ns = monotonic_time_ns;
        Ok(())
    }

    fn ensure_monotonic(&self, monotonic_time_ns: u64) -> Result<(), HelperProtocolError> {
        if monotonic_time_ns < self.last_monotonic_time_ns {
            Err(HelperProtocolError::MonotonicTime)
        } else {
            Ok(())
        }
    }
}

fn validate_nonce(
    channel_nonce: &str,
    expected_channel_nonce: &str,
) -> Result<(), HelperProtocolError> {
    if !is_channel_nonce(channel_nonce) || channel_nonce != expected_channel_nonce {
        return Err(HelperProtocolError::ChannelNonce);
    }
    Ok(())
}

fn is_channel_nonce(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase())
}

fn is_identifier(value: &str) -> bool {
    (MIN_HELPER_IDENTIFIER_LENGTH..=MAX_HELPER_IDENTIFIER_LENGTH).contains(&value.len())
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'_' | b'-'))
}

#[cfg(test)]
mod tests {
    use super::*;
    use native_protocol::{
        InteractiveConsoleOwnership, InteractiveLockState, InteractiveRemoteAttachment,
        InteractiveSessionCertainty, InteractiveSessionCoverage, InteractiveSessionEvent,
        InteractiveSessionEventKind, InteractiveSessionState,
    };

    const NONCE: &str = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

    #[test]
    fn handshake_is_bound_to_verified_peer_nonce_and_unique_capabilities() {
        let peer = VerifiedHelperPeer {
            helper_kind: HelperKind::MacosEndpointSecurityHelper,
            helper_build_id: "helper-build-0001".to_owned(),
            capabilities: vec![
                HelperSourceKind::ProcessApplication,
                HelperSourceKind::InteractiveSession,
            ],
        };
        let handshake = HelperHandshake {
            channel_nonce: NONCE.to_owned(),
            helper_kind: peer.helper_kind,
            helper_build_id: peer.helper_build_id.clone(),
            capabilities: vec![
                HelperSourceKind::ProcessApplication,
                HelperSourceKind::InteractiveSession,
            ],
        };
        assert!(bind_verified_helper_channel(&handshake, &peer, NONCE).is_ok());
        assert_eq!(
            bind_verified_helper_channel(
                &HelperHandshake {
                    capabilities: vec![HelperSourceKind::ProcessApplication; 2],
                    ..handshake
                },
                &peer,
                NONCE,
            ),
            Err(HelperProtocolError::CapabilitySet)
        );
    }

    #[test]
    fn source_configuration_accepts_only_fixed_classes_and_limits() {
        let request = HelperSourceOpen {
            channel_nonce: NONCE.to_owned(),
            helper_source_instance_id: "helper-source-0001".to_owned(),
            source_kind: HelperSourceKind::InteractiveSession,
            queue_capacity: 16,
            event_classes: vec![HelperEventClass::InteractiveSessionLifecycle],
        };
        assert_eq!(validate_helper_source_open(&request, NONCE), Ok(()));
        assert_eq!(
            validate_helper_source_open(
                &HelperSourceOpen {
                    event_classes: vec![HelperEventClass::ProcessIdentity],
                    ..request.clone()
                },
                NONCE,
            ),
            Err(HelperProtocolError::SourceConfiguration)
        );

        let mut process_request = HelperSourceOpen {
            source_kind: HelperSourceKind::ProcessApplication,
            event_classes: vec![
                HelperEventClass::ProcessLifecycle,
                HelperEventClass::ProcessIdentity,
            ],
            ..request
        };
        assert_eq!(validate_helper_source_open(&process_request, NONCE), Ok(()));
        process_request.event_classes.reverse();
        assert_eq!(validate_helper_source_open(&process_request, NONCE), Ok(()));
        for singleton in [
            HelperEventClass::ProcessLifecycle,
            HelperEventClass::ProcessIdentity,
        ] {
            process_request.event_classes = vec![singleton];
            assert_eq!(
                validate_helper_source_open(&process_request, NONCE),
                Err(HelperProtocolError::SourceConfiguration)
            );
        }
    }

    #[test]
    fn client_envelope_requires_one_payload_matching_its_discriminator() {
        let open = interactive_source_open();
        assert!(
            HelperClientMessage {
                kind: HelperClientMessageKind::Open,
                open: Some(open.clone()),
                close: None,
            }
            .validate_protocol()
            .is_ok()
        );
        assert!(
            HelperClientMessage {
                kind: HelperClientMessageKind::Close,
                open: Some(open),
                close: Some(HelperSourceClose {
                    channel_nonce: NONCE.to_owned(),
                    helper_source_instance_id: "helper-source-0001".to_owned(),
                }),
            }
            .validate_protocol()
            .is_err()
        );
    }

    #[test]
    fn verified_channel_rejects_an_oversized_close_nonce_before_transport() {
        let peer = VerifiedHelperPeer {
            helper_kind: HelperKind::MacosEndpointSecurityHelper,
            helper_build_id: "helper-build-0001".to_owned(),
            capabilities: vec![HelperSourceKind::ProcessApplication],
        };
        let channel = bind_verified_helper_channel(
            &HelperHandshake {
                channel_nonce: NONCE.to_owned(),
                helper_kind: peer.helper_kind,
                helper_build_id: peer.helper_build_id.clone(),
                capabilities: peer.capabilities.clone(),
            },
            &peer,
            NONCE,
        )
        .expect("verified channel");
        let request = HelperSourceClose {
            channel_nonce: "a".repeat(MAX_HELPER_FRAME_BYTES + 1),
            helper_source_instance_id: "helper-source-0001".to_owned(),
        };
        assert_eq!(
            channel.validate_source_close(&request),
            Err(HelperProtocolError::ChannelNonce)
        );
    }

    #[test]
    fn helper_observation_reuses_generated_content_free_fact_validation() {
        let source_id = "helper-source-0001";
        let observation = HelperObservation {
            channel_nonce: NONCE.to_owned(),
            helper_source_instance_id: source_id.to_owned(),
            source_kind: HelperSourceKind::InteractiveSession,
            sequence: 1,
            monotonic_time_ns: 1,
            process_event: None,
            interactive_session_event: Some(InteractiveSessionEvent {
                kind: InteractiveSessionEventKind::Changed,
                state: InteractiveSessionState {
                    coverage: InteractiveSessionCoverage::FullLifecycle,
                    certainty: InteractiveSessionCertainty::Complete,
                    console_ownership: InteractiveConsoleOwnership::Candidate,
                    lock_state: InteractiveLockState::Unlocked,
                    remote_attachment: InteractiveRemoteAttachment::Absent,
                    other_human_session_count: 0,
                },
            }),
        };
        assert_eq!(
            validate_helper_observation(
                &observation,
                NONCE,
                source_id,
                HelperSourceKind::InteractiveSession,
            ),
            Ok(())
        );
        assert_eq!(
            validate_helper_observation(
                &HelperObservation {
                    sequence: 0,
                    ..observation
                },
                NONCE,
                source_id,
                HelperSourceKind::InteractiveSession,
            ),
            Err(HelperProtocolError::Observation)
        );
    }

    #[test]
    fn source_fence_requires_snapshot_zero_and_contiguous_monotonic_observations() {
        let request = interactive_source_open();
        let channel = interactive_channel();
        let mut fence = channel.open_source(&request).expect("source fence opens");
        let initial = interactive_snapshot(0, 10);
        fence
            .accept_initial_snapshot(&initial)
            .expect("initial snapshot accepted");

        let first = interactive_observation(1, 11);
        fence
            .accept_observation(&first)
            .expect("first observation accepted");
        assert_eq!(
            fence.accept_observation(&interactive_observation(3, 12)),
            Err(HelperProtocolError::Sequence)
        );
        assert_eq!(
            fence.accept_observation(&interactive_observation(2, 9)),
            Err(HelperProtocolError::MonotonicTime)
        );
        fence
            .accept_observation(&interactive_observation(2, 12))
            .expect("second observation accepted");
        fence
            .accept_final_snapshot(&interactive_snapshot(2, 13))
            .expect("final snapshot accepted");
        assert_eq!(
            fence.accept_observation(&interactive_observation(3, 14)),
            Err(HelperProtocolError::Lifecycle)
        );
    }

    #[test]
    fn source_failure_requires_exact_loss_accounting_and_fences_observations() {
        let request = interactive_source_open();
        let channel = interactive_channel();
        let mut fence = channel.open_source(&request).expect("source fence opens");
        fence
            .accept_initial_snapshot(&interactive_snapshot(0, 1))
            .expect("initial snapshot accepted");
        let failure = HelperSourceFailure {
            channel_nonce: NONCE.to_owned(),
            helper_source_instance_id: request.helper_source_instance_id,
            source_kind: HelperSourceKind::InteractiveSession,
            failure_code: HelperFailureCode::NativeEventLoss,
            last_sequence: 0,
            lost_event_count: Some(2),
            monotonic_time_ns: 2,
        };
        fence
            .accept_failure(&failure)
            .expect("loss failure accepted");
        assert_eq!(
            fence.accept_observation(&interactive_observation(1, 3)),
            Err(HelperProtocolError::Lifecycle)
        );
        fence
            .accept_final_snapshot(&interactive_snapshot(0, 3))
            .expect("failed source can still prove final fenced state");

        assert_eq!(
            validate_helper_source_failure(
                &HelperSourceFailure {
                    lost_event_count: None,
                    ..failure.clone()
                },
                NONCE,
                "helper-source-0001",
                HelperSourceKind::InteractiveSession,
            ),
            Err(HelperProtocolError::Failure)
        );
        assert_eq!(
            validate_helper_source_failure(
                &HelperSourceFailure {
                    failure_code: HelperFailureCode::InventoryOverflow,
                    lost_event_count: None,
                    ..failure
                },
                NONCE,
                "helper-source-0001",
                HelperSourceKind::InteractiveSession,
            ),
            Ok(())
        );
    }

    #[test]
    fn close_failure_accepts_only_fatal_cleanup_outcomes_at_the_current_fence() {
        let request = interactive_source_open();
        let channel = interactive_channel();
        let mut active = channel
            .open_source(&request)
            .expect("active source fence opens");
        active
            .accept_initial_snapshot(&interactive_snapshot(0, 1))
            .expect("initial snapshot accepted");
        let cleanup = HelperSourceFailure {
            channel_nonce: NONCE.to_owned(),
            helper_source_instance_id: request.helper_source_instance_id.clone(),
            source_kind: HelperSourceKind::InteractiveSession,
            failure_code: HelperFailureCode::Cleanup,
            last_sequence: 0,
            lost_event_count: None,
            monotonic_time_ns: 2,
        };
        active
            .accept_close_failure(&cleanup)
            .expect("active cleanup failure accepted");

        let mut failed = channel
            .open_source(&request)
            .expect("failed source fence opens");
        failed
            .accept_initial_snapshot(&interactive_snapshot(0, 1))
            .expect("initial snapshot accepted");
        failed
            .accept_failure(&HelperSourceFailure {
                failure_code: HelperFailureCode::Backend,
                ..cleanup.clone()
            })
            .expect("operational failure accepted");
        failed
            .accept_close_failure(&HelperSourceFailure {
                failure_code: HelperFailureCode::Protocol,
                monotonic_time_ns: 3,
                ..cleanup.clone()
            })
            .expect("protocol failure can follow an operational failure");

        let mut rejected = channel
            .open_source(&request)
            .expect("rejection source fence opens");
        rejected
            .accept_initial_snapshot(&interactive_snapshot(0, 2))
            .expect("initial snapshot accepted");
        assert_eq!(
            rejected.accept_close_failure(&HelperSourceFailure {
                failure_code: HelperFailureCode::Backend,
                ..cleanup.clone()
            }),
            Err(HelperProtocolError::Lifecycle)
        );
        assert_eq!(
            rejected.accept_close_failure(&HelperSourceFailure {
                last_sequence: 1,
                ..cleanup.clone()
            }),
            Err(HelperProtocolError::Sequence)
        );
        assert_eq!(
            rejected.accept_close_failure(&HelperSourceFailure {
                monotonic_time_ns: 1,
                ..cleanup
            }),
            Err(HelperProtocolError::MonotonicTime)
        );
    }

    #[test]
    fn source_fence_rejects_sequence_exhaustion_without_wrapping() {
        let request = interactive_source_open();
        let channel = interactive_channel();
        let mut fence = channel.open_source(&request).expect("source fence opens");
        fence
            .accept_initial_snapshot(&interactive_snapshot(0, 1))
            .expect("initial snapshot accepted");
        fence.last_sequence = u64::MAX;
        assert_eq!(
            fence.accept_observation(&interactive_observation(1, 2)),
            Err(HelperProtocolError::Sequence)
        );
    }

    #[test]
    fn source_fence_preserves_a_terminal_failure_before_snapshot_zero() {
        let request = interactive_source_open();
        let channel = interactive_channel();
        let mut fence = channel.open_source(&request).expect("source fence opens");
        let failure = HelperSourceFailure {
            channel_nonce: NONCE.to_owned(),
            helper_source_instance_id: request.helper_source_instance_id,
            source_kind: HelperSourceKind::InteractiveSession,
            failure_code: HelperFailureCode::InventoryOverflow,
            last_sequence: 0,
            lost_event_count: None,
            monotonic_time_ns: 1,
        };
        fence
            .accept_initial_failure(&failure)
            .expect("initial inventory failure accepted");
        assert_eq!(
            fence.accept_initial_snapshot(&interactive_snapshot(0, 2)),
            Err(HelperProtocolError::Lifecycle)
        );
    }

    #[test]
    fn frame_boundary_rejects_empty_and_oversized_payloads() {
        assert_eq!(validate_helper_frame_size(1), Ok(()));
        assert_eq!(
            validate_helper_frame_size(0),
            Err(HelperProtocolError::FrameSize)
        );
        assert_eq!(
            validate_helper_frame_size(MAX_HELPER_FRAME_BYTES + 1),
            Err(HelperProtocolError::FrameSize)
        );
    }

    #[test]
    fn negotiated_channel_rejects_an_unadvertised_source() {
        let channel = interactive_channel();
        let mut request = interactive_source_open();
        request.source_kind = HelperSourceKind::ProcessApplication;
        request.event_classes = vec![HelperEventClass::ProcessLifecycle];
        assert!(matches!(
            channel.open_source(&request),
            Err(HelperProtocolError::CapabilitySet)
        ));
    }

    fn interactive_channel() -> VerifiedHelperChannel {
        let peer = VerifiedHelperPeer {
            helper_kind: HelperKind::MacosEndpointSecurityHelper,
            helper_build_id: "helper-build-0001".to_owned(),
            capabilities: vec![HelperSourceKind::InteractiveSession],
        };
        bind_verified_helper_channel(
            &HelperHandshake {
                channel_nonce: NONCE.to_owned(),
                helper_kind: peer.helper_kind,
                helper_build_id: peer.helper_build_id.clone(),
                capabilities: peer.capabilities.clone(),
            },
            &peer,
            NONCE,
        )
        .expect("verified helper channel")
    }

    fn interactive_source_open() -> HelperSourceOpen {
        HelperSourceOpen {
            channel_nonce: NONCE.to_owned(),
            helper_source_instance_id: "helper-source-0001".to_owned(),
            source_kind: HelperSourceKind::InteractiveSession,
            queue_capacity: 16,
            event_classes: vec![HelperEventClass::InteractiveSessionLifecycle],
        }
    }

    fn interactive_state() -> InteractiveSessionState {
        InteractiveSessionState {
            coverage: InteractiveSessionCoverage::FullLifecycle,
            certainty: InteractiveSessionCertainty::Complete,
            console_ownership: InteractiveConsoleOwnership::Candidate,
            lock_state: InteractiveLockState::Unlocked,
            remote_attachment: InteractiveRemoteAttachment::Absent,
            other_human_session_count: 0,
        }
    }

    fn interactive_snapshot(last_sequence: u64, monotonic_time_ns: u64) -> HelperSourceSnapshot {
        HelperSourceSnapshot {
            channel_nonce: NONCE.to_owned(),
            helper_source_instance_id: "helper-source-0001".to_owned(),
            source_kind: HelperSourceKind::InteractiveSession,
            last_sequence,
            monotonic_time_ns,
            process_state: None,
            interactive_session_state: Some(interactive_state()),
        }
    }

    fn interactive_observation(sequence: u64, monotonic_time_ns: u64) -> HelperObservation {
        HelperObservation {
            channel_nonce: NONCE.to_owned(),
            helper_source_instance_id: "helper-source-0001".to_owned(),
            source_kind: HelperSourceKind::InteractiveSession,
            sequence,
            monotonic_time_ns,
            process_event: None,
            interactive_session_event: Some(InteractiveSessionEvent {
                kind: InteractiveSessionEventKind::Changed,
                state: interactive_state(),
            }),
        }
    }
}
