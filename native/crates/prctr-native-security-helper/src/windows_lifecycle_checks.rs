//! Admission of completed SDK results: cleanup and absolute bounds take priority.
use std::time::Instant;

#[derive(Debug, Eq, PartialEq)]
pub(super) enum TrustResult {
    Approved,
    Rejected,
    CleanupFailed,
}
pub(super) const fn trust_result(verification: i32, cleanup: i32) -> TrustResult {
    if cleanup != 0 {
        TrustResult::CleanupFailed
    } else if verification != 0 {
        TrustResult::Rejected
    } else {
        TrustResult::Approved
    }
}
pub(super) fn termination_receipt(
    exited: bool,
    active: u32,
    observed_at: Instant,
    deadline: Instant,
) -> Result<bool, ()> {
    if observed_at >= deadline {
        Err(())
    } else {
        Ok(exited && active == 0)
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;
    #[test]
    fn cleanup_failure_wins_over_approved_or_rejected_signature() {
        assert_eq!(trust_result(0, -1), TrustResult::CleanupFailed);
        assert_eq!(trust_result(-1, -1), TrustResult::CleanupFailed);
        assert_eq!(trust_result(-1, 0), TrustResult::Rejected);
        assert_eq!(trust_result(0, 0), TrustResult::Approved);
    }
    #[test]
    fn completed_job_receipt_after_deadline_never_proves_cleanup() {
        let deadline = Instant::now();
        assert_eq!(termination_receipt(true, 0, deadline, deadline), Err(()));
        assert_eq!(
            termination_receipt(true, 0, deadline + Duration::from_nanos(1), deadline),
            Err(())
        );
        assert_eq!(
            termination_receipt(true, 0, deadline, deadline + Duration::from_secs(1)),
            Ok(true)
        );
        assert_eq!(
            termination_receipt(false, 0, deadline, deadline + Duration::from_secs(1)),
            Ok(false)
        );
        assert_eq!(
            termination_receipt(true, 1, deadline, deadline + Duration::from_secs(1)),
            Ok(false)
        );
    }
}
