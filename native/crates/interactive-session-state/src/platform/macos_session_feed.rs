//! Native-only ES notification feed. It intentionally has no `snapshot` method:
//! Apple's discretionary LoginWindow/remote events do not establish the initial
//! all-human-session census, audit/graphical correlation or initial lock state.
//! Remains outside the production helper factory until that authority exists.

#![allow(unsafe_code)]

use super::macos_session_events::{
    MacOsSessionFeedDrain, MacOsSessionFeedFailure, RawSessionFact, SessionIngress,
};
use native_source_runtime::{
    DeadlineThread, ensure_native_source_process_usable, poison_native_source_process,
};
use std::ffi::c_void;
use std::panic::{AssertUnwindSafe, catch_unwind};
use std::ptr::NonNull;
use std::sync::{Arc, mpsc};
use std::time::{Duration, Instant};

unsafe extern "C" {
    fn prctr_session_es_open(
        context: *mut c_void,
        callback: unsafe extern "C" fn(*mut c_void, *const RawSessionFact),
        result: *mut *mut c_void,
    ) -> i32;
    fn prctr_session_es_close(subscription: *mut c_void) -> i32;
}

/// A fixed passive notification subscription, owned by the killable native helper.
/// No permission prompt, daemon registration or system audit mutation occurs.
pub struct MacOsSessionEventFeed {
    ingress: Arc<SessionIngress>,
    stop: Option<mpsc::SyncSender<()>>,
    worker: DeadlineThread,
    closed: bool,
}

/// Final accepted prefix plus explicit proof that native callbacks were removed.
pub struct MacOsSessionFeedClose {
    pub drain: MacOsSessionFeedDrain,
    pub closed_input_boundary: bool,
}

trait SessionClient {
    fn close(&mut self) -> Result<(), MacOsSessionFeedFailure>;
}

impl MacOsSessionEventFeed {
    /// Opens the fixed ES userspace event set on a deadline-owned worker.
    /// Requires a privileged, ES-entitled, permitted helper on macOS 13+.
    ///
    /// # Errors
    /// Returns explicit setup, permission, protocol or cleanup failure. An SDK
    /// call exceeding its deadline poisons the host for process replacement.
    pub fn open(capacity: usize, deadline: Instant) -> Result<Self, MacOsSessionFeedFailure> {
        Self::open_with(capacity, deadline, NativeClient::open)
    }

    fn open_with<C: SessionClient + 'static>(
        capacity: usize,
        deadline: Instant,
        opener: impl FnOnce(Arc<SessionIngress>) -> Result<C, MacOsSessionFeedFailure> + Send + 'static,
    ) -> Result<Self, MacOsSessionFeedFailure> {
        ensure_native_source_process_usable().map_err(|_| MacOsSessionFeedFailure::Cleanup)?;
        if Instant::now() >= deadline {
            return Err(MacOsSessionFeedFailure::Backend);
        }
        let ingress = Arc::new(SessionIngress::new(capacity)?);
        let (ready, readiness) = mpsc::sync_channel(1);
        let (stop, stopping) = mpsc::sync_channel(1);
        let worker_ingress = Arc::clone(&ingress);
        let worker = DeadlineThread::spawn("prctr-es-session-source", move || {
            let result = catch_unwind(AssertUnwindSafe(|| {
                match opener(Arc::clone(&worker_ingress)) {
                    Ok(mut client) => {
                        if ready.send(Ok(())).is_ok() {
                            let _ = stopping.recv();
                        }
                        worker_ingress.fence();
                        if client.close().is_err() {
                            worker_ingress.fail(MacOsSessionFeedFailure::Cleanup, 0);
                            poison_native_source_process();
                        }
                    }
                    Err(error) => {
                        worker_ingress.fail(error, 0);
                        if error == MacOsSessionFeedFailure::Cleanup {
                            poison_native_source_process();
                        }
                        let _ = ready.send(Err(error));
                    }
                }
            }));
            if result.is_err() {
                worker_ingress.fail(MacOsSessionFeedFailure::Cleanup, 0);
                poison_native_source_process();
            }
        })
        .map_err(|_| MacOsSessionFeedFailure::Backend)?;
        let mut source = Self {
            ingress,
            stop: Some(stop),
            worker,
            closed: false,
        };
        let opened_result =
            readiness.recv_timeout(deadline.saturating_duration_since(Instant::now()));
        if let Ok(Ok(())) = opened_result
            && Instant::now() < deadline
            && ensure_native_source_process_usable().is_ok()
        {
            return Ok(source);
        }
        // Dropping the stop sender also closes a late successfully opened client.
        let closed = source.close(deadline);
        if !closed.closed_input_boundary {
            return Err(MacOsSessionFeedFailure::Cleanup);
        }
        match opened_result {
            Ok(Err(error)) => Err(error),
            _ => Err(MacOsSessionFeedFailure::Backend),
        }
    }

    /// Whether an accepted notification or explicit feed failure is pending.
    #[must_use]
    pub fn has_pending_input(&self) -> bool {
        self.ingress.has_pending_input()
    }

    /// Returns an ordered bounded prefix without blocking an ES callback.
    #[must_use]
    pub fn drain(&self) -> MacOsSessionFeedDrain {
        self.ingress.drain()
    }

    /// Fences intake, removes the native subscription and observes actual worker
    /// exit within the absolute budget. An unproved boundary requires host exit.
    #[must_use]
    pub fn close(&mut self, deadline: Instant) -> MacOsSessionFeedClose {
        self.ingress.fence();
        self.stop.take();
        if !self.closed {
            if self
                .worker
                .finish(deadline.saturating_duration_since(Instant::now()))
                .is_ok()
            {
                self.closed = true;
            } else {
                self.ingress.fail(MacOsSessionFeedFailure::Cleanup, 0);
                poison_native_source_process();
            }
        }
        let drain = self.ingress.drain();
        MacOsSessionFeedClose {
            closed_input_boundary: self.closed
                && drain.failure != Some(MacOsSessionFeedFailure::Cleanup),
            drain,
        }
    }
}
impl Drop for MacOsSessionEventFeed {
    fn drop(&mut self) {
        if self.stop.is_some() {
            let _ = self.close(Instant::now() + Duration::from_millis(500));
        }
    }
}

struct NativeClient {
    native: Option<NonNull<c_void>>,
    callback: Option<Arc<SessionIngress>>,
}
impl NativeClient {
    fn open(ingress: Arc<SessionIngress>) -> Result<Self, MacOsSessionFeedFailure> {
        let callback = ingress;
        let mut native = std::ptr::null_mut();
        // SAFETY: Arc allocation is stable until SDK deletion fences all callbacks.
        let result = unsafe {
            prctr_session_es_open(
                Arc::as_ptr(&callback).cast_mut().cast(),
                receive,
                &raw mut native,
            )
        };
        if result != 0 {
            if result == 3 {
                let _retained = Arc::into_raw(callback);
                poison_native_source_process();
                return Err(MacOsSessionFeedFailure::Cleanup);
            }
            return Err(if result == 1 {
                MacOsSessionFeedFailure::Permission
            } else {
                MacOsSessionFeedFailure::Backend
            });
        }
        let Some(native) = NonNull::new(native) else {
            let _retained = Arc::into_raw(callback);
            poison_native_source_process();
            return Err(MacOsSessionFeedFailure::Cleanup);
        };
        Ok(Self {
            native: Some(native),
            callback: Some(callback),
        })
    }
}
impl SessionClient for NativeClient {
    fn close(&mut self) -> Result<(), MacOsSessionFeedFailure> {
        let Some(native) = self.native.take() else {
            return Ok(());
        };
        // SAFETY: only the owner thread calls ES. Rust context survives deletion.
        if unsafe { prctr_session_es_close(native.as_ptr()) } != 0 {
            if let Some(callback) = self.callback.take() {
                let _retained = Arc::into_raw(callback);
            }
            poison_native_source_process();
            return Err(MacOsSessionFeedFailure::Cleanup);
        }
        self.callback.take();
        Ok(())
    }
}
impl Drop for NativeClient {
    fn drop(&mut self) {
        let _ = self.close();
    }
}
unsafe extern "C" fn receive(context: *mut c_void, fact: *const RawSessionFact) {
    if context.is_null() {
        return;
    }
    // SAFETY: native owner retains this immutable Arc allocation through ES deletion.
    let ingress = unsafe { &*context.cast::<SessionIngress>() };
    if fact.is_null() {
        ingress.fail(MacOsSessionFeedFailure::Protocol, 0);
        return;
    }
    let captured_at = Instant::now();
    let result = catch_unwind(AssertUnwindSafe(|| {
        // SAFETY: C callback borrows one fixed-size copied fact for this call.
        ingress.receive(unsafe { &*fact }, captured_at);
    }));
    if result.is_err() {
        ingress.fail(MacOsSessionFeedFailure::Protocol, 0);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    struct FakeClient {
        closed: mpsc::SyncSender<()>,
    }
    impl SessionClient for FakeClient {
        fn close(&mut self) -> Result<(), MacOsSessionFeedFailure> {
            self.closed.send(()).unwrap();
            Ok(())
        }
    }
    #[test]
    fn owner_closes_client_and_rejects_late_input_with_idempotent_proof() {
        let (closed, received) = mpsc::sync_channel(1);
        let mut source = MacOsSessionEventFeed::open_with(
            2,
            Instant::now() + Duration::from_secs(1),
            move |_| Ok(FakeClient { closed }),
        )
        .unwrap();
        assert!(!source.has_pending_input());
        assert!(
            source
                .close(Instant::now() + Duration::from_secs(1))
                .closed_input_boundary
        );
        received.recv_timeout(Duration::from_secs(1)).unwrap();
        assert!(source.close(Instant::now()).closed_input_boundary);
    }
    #[test]
    fn rejects_invalid_budget_before_native_open() {
        for capacity in [0, 1025] {
            let result = MacOsSessionEventFeed::open_with::<FakeClient>(
                capacity,
                Instant::now() + Duration::from_secs(1),
                |_| panic!("must not open"),
            );
            assert!(matches!(result, Err(MacOsSessionFeedFailure::Protocol)));
        }
        assert!(matches!(
            MacOsSessionEventFeed::open_with::<FakeClient>(2, Instant::now(), |_| panic!(
                "expired"
            )),
            Err(MacOsSessionFeedFailure::Backend)
        ));
    }
    #[test]
    fn permission_failure_closes_worker_without_claiming_any_snapshot() {
        let result = MacOsSessionEventFeed::open_with::<FakeClient>(
            2,
            Instant::now() + Duration::from_secs(1),
            |_| Err(MacOsSessionFeedFailure::Permission),
        );
        assert!(matches!(result, Err(MacOsSessionFeedFailure::Permission)));
    }
    fn isolated(name: &str, marker: &str) -> bool {
        if std::env::var_os(marker).is_some() {
            return false;
        }
        let status = std::process::Command::new(std::env::current_exe().unwrap())
            .args(["--exact", name])
            .env(marker, "1")
            .status()
            .unwrap();
        assert!(status.success());
        true
    }
    #[test]
    fn late_open_is_owned_until_client_closes_and_poison_remains() {
        if isolated(
            "platform::macos_session_feed::tests::late_open_is_owned_until_client_closes_and_poison_remains",
            "PRCTR_TEST_SESSION_LATE_OPEN",
        ) {
            return;
        }
        let (release, waiting) = mpsc::sync_channel(1);
        let (closed, observed) = mpsc::sync_channel(1);
        let result = MacOsSessionEventFeed::open_with(
            2,
            Instant::now() + Duration::from_millis(25),
            move |_| {
                waiting.recv().unwrap();
                Ok(FakeClient { closed })
            },
        );
        assert!(matches!(result, Err(MacOsSessionFeedFailure::Cleanup)));
        assert!(ensure_native_source_process_usable().is_err());
        release.send(()).unwrap();
        observed.recv_timeout(Duration::from_secs(3)).unwrap();
    }
    struct BlockedClose {
        entered: mpsc::SyncSender<()>,
        release: mpsc::Receiver<()>,
    }
    impl SessionClient for BlockedClose {
        fn close(&mut self) -> Result<(), MacOsSessionFeedFailure> {
            self.entered.send(()).unwrap();
            self.release.recv().unwrap();
            Ok(())
        }
    }
    #[test]
    fn close_deadline_preserves_tail_and_never_returns_clean_after_timeout() {
        if isolated(
            "platform::macos_session_feed::tests::close_deadline_preserves_tail_and_never_returns_clean_after_timeout",
            "PRCTR_TEST_SESSION_CLOSE_TIMEOUT",
        ) {
            return;
        }
        let (entered, observed) = mpsc::sync_channel(1);
        let (release, waiting) = mpsc::sync_channel(1);
        let mut source = MacOsSessionEventFeed::open_with(
            2,
            Instant::now() + Duration::from_secs(1),
            move |ingress| {
                ingress.receive(
                    &RawSessionFact {
                        global_sequence: 10,
                        type_sequence: 8,
                        mach_time: 1,
                        graphical_session_id: 9,
                        kind: 3,
                        succeeded: 1,
                        reserved: 0,
                    },
                    Instant::now(),
                );
                Ok(BlockedClose {
                    entered,
                    release: waiting,
                })
            },
        )
        .unwrap();
        let closed = source.close(Instant::now() + Duration::from_millis(25));
        assert!(!closed.closed_input_boundary);
        assert_eq!(closed.drain.events.len(), 1);
        assert_eq!(closed.drain.failure, Some(MacOsSessionFeedFailure::Cleanup));
        assert!(ensure_native_source_process_usable().is_err());
        observed.recv_timeout(Duration::from_secs(3)).unwrap();
        release.send(()).unwrap();
        let final_close = source.close(Instant::now() + Duration::from_secs(3));
        assert!(!final_close.closed_input_boundary);
        assert!(final_close.drain.events.is_empty());
        assert!(source.worker.is_finished());
    }
}
