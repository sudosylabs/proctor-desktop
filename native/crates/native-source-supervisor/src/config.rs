//! Validated supervisor configuration and the restart backoff schedule.

use std::fmt;
use std::time::Duration;

use native_protocol::{ProtocolValidatable, SourceOpenRequest};

const REQUIRED_RESTART_ATTEMPTS: u8 = 1;
const MAX_RESTART_BACKOFF: Duration = Duration::from_secs(60);

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct RestartPolicy {
    pub(crate) maximum_attempts: u8,
    initial_backoff: Duration,
    maximum_backoff: Duration,
}

impl RestartPolicy {
    /// Creates the bounded process-local source restart policy.
    ///
    /// # Errors
    ///
    /// Returns a configuration error unless exactly one automatic restart is
    /// requested, or for a zero, inverted, or excessive backoff.
    pub fn new(
        maximum_attempts: u8,
        initial_backoff: Duration,
        maximum_backoff: Duration,
    ) -> Result<Self, SupervisorConfigError> {
        if maximum_attempts != REQUIRED_RESTART_ATTEMPTS {
            return Err(SupervisorConfigError::InvalidRestartAttempts);
        }
        if initial_backoff.is_zero()
            || initial_backoff > maximum_backoff
            || maximum_backoff > MAX_RESTART_BACKOFF
        {
            return Err(SupervisorConfigError::InvalidRestartBackoff);
        }
        Ok(Self {
            maximum_attempts,
            initial_backoff,
            maximum_backoff,
        })
    }

    /// Delay before the next restart: doubles with each attempt already made,
    /// capped at the policy maximum.
    pub(crate) fn backoff_after(self, attempts_made: u8) -> Duration {
        let multiplier = 1_u32
            .checked_shl(u32::from(attempts_made))
            .unwrap_or(u32::MAX);
        self.initial_backoff
            .saturating_mul(multiplier)
            .min(self.maximum_backoff)
    }
}

impl Default for RestartPolicy {
    fn default() -> Self {
        Self {
            maximum_attempts: REQUIRED_RESTART_ATTEMPTS,
            initial_backoff: Duration::from_millis(250),
            maximum_backoff: Duration::from_secs(4),
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SupervisorConfig {
    pub(crate) collection_session_id: String,
    pub(crate) queue_capacity: u16,
    pub(crate) restart_policy: RestartPolicy,
}

impl SupervisorConfig {
    /// Validates the capability-neutral collection identifier and source bounds.
    ///
    /// # Errors
    ///
    /// Returns [`SupervisorConfigError::InvalidSourceRequest`] when the
    /// identifier or queue capacity violates the shared source protocol.
    pub fn new(
        collection_session_id: String,
        queue_capacity: u16,
        restart_policy: RestartPolicy,
    ) -> Result<Self, SupervisorConfigError> {
        SourceOpenRequest {
            collection_session_id: collection_session_id.clone(),
            queue_capacity,
        }
        .validate_protocol()
        .map_err(|_error| SupervisorConfigError::InvalidSourceRequest)?;
        Ok(Self {
            collection_session_id,
            queue_capacity,
            restart_policy,
        })
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum SupervisorConfigError {
    InvalidSourceRequest,
    InvalidRestartAttempts,
    InvalidRestartBackoff,
}

impl fmt::Display for SupervisorConfigError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(match self {
            Self::InvalidSourceRequest => "source request is outside the bounded native protocol",
            Self::InvalidRestartAttempts => "restart attempts must be exactly one",
            Self::InvalidRestartBackoff => {
                "restart backoff must be ordered, nonzero, and no longer than one minute"
            }
        })
    }
}

impl std::error::Error for SupervisorConfigError {}
