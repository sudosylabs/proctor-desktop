//! Accept may remain idle indefinitely, but cancellation and completion ownership
//! always have bounded, actual-join acknowledgements (including thread TLS).
use crate::{
    FrameWorker, HELPER_TERMINATION_DEADLINE, HelperTransportError, poison_helper_utility,
};
use std::sync::mpsc;
use std::time::{Duration, Instant};

pub(super) fn accept_owned<T: Send + 'static>(
    task: impl FnOnce() -> Result<T, HelperTransportError> + Send + 'static,
    cancel: impl Fn() + Send + 'static,
    stopping: impl Fn() -> bool,
    deadline: Option<Instant>,
) -> Result<T, HelperTransportError> {
    let (sender, receiver) = mpsc::sync_channel(1);
    let mut worker = FrameWorker::spawn("prctr-service-accept", move || {
        // A late accepted value remains owned by the channel or SendError and is
        // dropped there; it cannot escape a stopped admission generation.
        let _ = sender.send(task());
    })?;
    let mut cancellation = Some(cancel);
    let outcome = loop {
        if stopping() {
            break Err(HelperTransportError::ConnectionFenced);
        }
        if deadline.is_some_and(|deadline| Instant::now() >= deadline) {
            break Err(HelperTransportError::DeadlineExceeded);
        }
        match receiver.recv_timeout(Duration::from_millis(5)) {
            Ok(result) => break result,
            Err(mpsc::RecvTimeoutError::Timeout) => {}
            Err(mpsc::RecvTimeoutError::Disconnected) => {
                break Err(HelperTransportError::ConnectionFenced);
            }
        }
    };
    // Cancellation and the actual join share one cleanup budget. A slow cancel
    // cannot buy its worker a second termination interval.
    let cleanup_deadline = Instant::now() + HELPER_TERMINATION_DEADLINE;
    if outcome.is_err() {
        cancel_owned(&mut cancellation, cleanup_deadline)?;
    }
    // Even successful SDK completion cannot bypass its owner/TLS join or permit
    // a stop/absolute deadline observed while that owner was unwinding.
    let join_deadline = deadline
        .filter(|deadline| *deadline > Instant::now())
        .map_or_else(
            || cleanup_deadline,
            |deadline| deadline.min(cleanup_deadline),
        );
    if worker.finish(join_deadline).is_err() || Instant::now() >= join_deadline {
        let _ = cancel_owned(&mut cancellation, cleanup_deadline);
        poison_helper_utility();
        return Err(HelperTransportError::UtilityPoisoned);
    }
    if stopping() {
        cancel_owned(&mut cancellation, cleanup_deadline)?;
        return Err(HelperTransportError::ConnectionFenced);
    }
    if deadline.is_some_and(|deadline| Instant::now() >= deadline) {
        cancel_owned(&mut cancellation, cleanup_deadline)?;
        return Err(HelperTransportError::DeadlineExceeded);
    }
    outcome
}

fn cancel_owned<C: Fn() + Send + 'static>(
    cancel: &mut Option<C>,
    deadline: Instant,
) -> Result<(), HelperTransportError> {
    if let Some(cancel) = cancel.take() {
        crate::run_startup_task("prctr-service-accept-cancel", deadline, move || {
            cancel();
            Ok(())
        })?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
    };

    #[test]
    fn quiet_accept_cancels_and_joins_before_returning_stop() {
        let (entered, waiting) = mpsc::sync_channel(1);
        let (release, blocked) = mpsc::sync_channel(1);
        let stopped = Arc::new(AtomicBool::new(false));
        let observed = Arc::clone(&stopped);
        let result = accept_owned(
            move || {
                entered.send(()).expect("entered");
                blocked.recv().expect("cancel");
                Ok(())
            },
            move || {
                let _ = release.try_send(());
            },
            || {
                if waiting.try_recv().is_ok() {
                    observed.store(true, Ordering::Release);
                }
                observed.load(Ordering::Acquire)
            },
            None,
        );
        assert!(matches!(
            result,
            Err(HelperTransportError::ConnectionFenced)
        ));
        assert!(stopped.load(Ordering::Acquire));
    }

    #[test]
    fn stopped_accept_never_admits_already_completed_value() {
        struct Owned(Arc<AtomicBool>);
        impl Drop for Owned {
            fn drop(&mut self) {
                self.0.store(true, Ordering::Release);
            }
        }
        let dropped = Arc::new(AtomicBool::new(false));
        let owned = Arc::clone(&dropped);
        let result = accept_owned(move || Ok(Owned(owned)), || {}, || true, None);
        assert!(matches!(
            result,
            Err(HelperTransportError::ConnectionFenced)
        ));
        assert!(dropped.load(Ordering::Acquire));
    }

    #[test]
    fn already_expired_accept_never_admits_success() {
        assert!(matches!(
            accept_owned(|| Ok(()), || {}, || false, Some(Instant::now())),
            Err(HelperTransportError::DeadlineExceeded)
        ));
    }

    #[test]
    fn stalled_service_owner_and_cancel_poison_without_hanging_shutdown() {
        use std::process::{Command, Stdio};
        use std::thread;

        const SCENARIO: &str = "PRCTR_TEST_STALLED_SERVICE_OWNER";
        if let Ok(scenario) = std::env::var(SCENARIO) {
            let (entered, waiting) = mpsc::sync_channel(1);
            let (release, blocked) = mpsc::sync_channel(1);
            let stall_cancel = scenario == "cancel";
            let started = Instant::now();
            let result = accept_owned(
                move || {
                    entered.send(()).expect("owner entered");
                    // The cancellation branch releases the owner, then itself
                    // stalls. The other branch models an SDK ignoring cancel.
                    if !stall_cancel {
                        loop {
                            thread::park();
                        }
                    }
                    blocked.recv().expect("owner released");
                    Ok(())
                },
                move || {
                    if stall_cancel {
                        release.try_send(()).expect("release owner");
                        loop {
                            thread::park();
                        }
                    }
                },
                || waiting.try_recv().is_ok(),
                None,
            );
            assert!(result.is_err());
            assert!(crate::ensure_helper_utility_usable().is_err());
            assert!(started.elapsed() < Duration::from_secs(2));
            return;
        }

        // Poison is permanent for a process. Exercise real stuck threads in
        // children so the rest of the helper tests cannot reuse their state.
        for scenario in ["owner", "cancel"] {
            let mut child = Command::new(std::env::current_exe().expect("test executable"))
                .args([
                    "--exact",
                    "service_accept::tests::stalled_service_owner_and_cancel_poison_without_hanging_shutdown",
                    "--nocapture",
                ])
                .env(SCENARIO, scenario)
                .stdin(Stdio::null())
                .stdout(Stdio::null())
                .spawn()
                .expect("isolated stalled owner");
            let deadline = Instant::now() + Duration::from_secs(5);
            let status = loop {
                match child.try_wait().expect("child status") {
                    Some(status) => break Some(status),
                    None if Instant::now() < deadline => thread::sleep(Duration::from_millis(5)),
                    None => break None,
                }
            };
            if status.is_none() {
                let _ = child.kill();
                let _ = child.wait();
            }
            assert!(
                status.is_some_and(|status| status.success()),
                "{scenario} cleanup hung or failed"
            );
        }
    }
}
