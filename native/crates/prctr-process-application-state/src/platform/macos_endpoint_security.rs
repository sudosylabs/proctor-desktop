//! Real, content-minimized Endpoint Security NOTIFY ingress.
//!
//! Bootstrap waits for a passive notification generated strictly after the
//! inventory boundary. Start first waits for a natural callback to establish
//! counters before inventory is allowed to begin. Apple documents delivery in system-occurrence order; a
//! contiguous callback beyond that boundary establishes the captured ingress
//! checkpoint. A quiet stream or an event gap fails startup instead of inventing
//! completeness or creating an artificial host process.
//! Entitlement, root and Full Disk Access remain runtime requirements; no prompt
//! or host mutation is performed by this passive source.
//!
//! `es_delete_client` is a synchronous SDK call without a timeout. This adapter
//! belongs in the separately killable helper, whose broker enforces an absolute
//! request/cleanup deadline and observes process termination. The SDK call alone
//! does not establish a bounded shutdown guarantee.

#![allow(unsafe_code)]

use std::ffi::c_void;
use std::panic::{AssertUnwindSafe, catch_unwind};
use std::ptr::NonNull;
use std::sync::{Arc, Mutex, mpsc};
use std::time::{Duration, Instant};

use prctr_native_protocol::{ProcessExecutableIdentity, ProcessExecutableIdentityStatus};
use prctr_native_source_runtime::poison_native_source_process;

use super::macos_audit_token::OwnedAuditToken;
use super::macos_executable_identity::{IdentityIngress, IdentityWorker};
use super::macos_lifecycle::{
    MacOsCandidateAuditSession, MacOsIdentityResolution, MacOsLifecycleCheckpoint,
    MacOsLifecycleEventFeed, MacOsLifecycleFailure, MacOsLifecycleInput, MacOsLifecycleSink,
    MacOsLifecycleSubscription, MacOsProcessAccountClass, MacOsProcessFact, MacOsProcessKey,
};

/// Fixed-size fields copied while an ES callback owns the source message.
/// Layout is shared only with the sibling C ABI shim, never the helper wire.
#[repr(C)]
struct RawFact {
    global_sequence: u64,
    type_sequence: u64,
    mach_time: u64,
    start_seconds: i64,
    start_microseconds: i64,
    process_id: i32,
    execution_generation: u32,
    audit_session_id: u32,
    audit_user_id: u32,
    kind: u32,
    audit_token: [u32; 8],
}

unsafe extern "C" {
    fn prctr_es_open(
        context: *mut c_void,
        callback: unsafe extern "C" fn(*mut c_void, *const RawFact),
        result: *mut *mut c_void,
    ) -> i32;
    fn prctr_es_close(subscription: *mut c_void) -> i32;
    fn prctr_es_clock_now() -> u64;
}

/// One passive ES client restricted to fork, exec and exit notifications.
pub struct EndpointSecurityEventFeed {
    candidate: MacOsCandidateAuditSession,
    bootstrap_deadline: Instant,
    registrar: EndpointSecurityBootstrapRegistrar,
}

impl EndpointSecurityEventFeed {
    /// Accepts only audit context established from an authenticated local peer.
    #[must_use]
    pub fn new(candidate: MacOsCandidateAuditSession, bootstrap_deadline: Instant) -> Self {
        Self {
            candidate,
            bootstrap_deadline,
            registrar: EndpointSecurityBootstrapRegistrar {
                sink: Arc::new(Mutex::new(None)),
                bootstrap_deadline,
            },
        }
    }

    /// Shares exact inventory token registrations with the privileged inventory
    /// adapter. It cannot subscribe to additional OS event classes.
    #[must_use]
    pub fn bootstrap_registrar(&self) -> EndpointSecurityBootstrapRegistrar {
        self.registrar.clone()
    }
}

/// Inventory-to-callback identity completion seam, fenced when the ES source closes.
#[derive(Clone)]
pub struct EndpointSecurityBootstrapRegistrar {
    sink: Arc<Mutex<Option<IdentityIngress>>>,
    bootstrap_deadline: Instant,
}

impl EndpointSecurityBootstrapRegistrar {
    /// Register a kernel-captured inventory token before the bootstrap cut.
    /// No signature query is performed by the inventory or OS callback.
    pub(super) fn resolve_inventory_identity(
        &self,
        key: MacOsProcessKey,
        execution_generation: u32,
        token: Option<OwnedAuditToken>,
    ) -> Result<(), MacOsLifecycleFailure> {
        let registration = self
            .sink
            .lock()
            .map_err(|_| MacOsLifecycleFailure::Protocol)?;
        registration
            .as_ref()
            .ok_or(MacOsLifecycleFailure::Backend)?
            .inventory(key, execution_generation, token)
    }

    pub(super) const fn bootstrap_deadline(&self) -> Instant {
        self.bootstrap_deadline
    }

    fn clear(&self) {
        // Poison never permits another producer; recover the value only to drop
        // the retained sink, not to resume registration.
        match self.sink.lock() {
            Ok(mut sink) => {
                sink.take();
            }
            Err(poisoned) => {
                poisoned.into_inner().take();
            }
        }
    }
}

struct BarrierRequest {
    after_mach_time: u64,
    reply: mpsc::SyncSender<Result<MacOsLifecycleCheckpoint, MacOsLifecycleFailure>>,
}

struct CallbackState {
    sink: MacOsLifecycleSink,
    mapper: Mutex<EventMapper>,
    barrier: Mutex<Option<BarrierRequest>>,
    first_callback: Mutex<Option<mpsc::SyncSender<()>>>,
    identities: Option<IdentityIngress>,
}

/// Opening-thread owner. The native handle and Rust callback context are freed
/// together only after ES confirms client deletion. Neither is `Send`.
pub struct EndpointSecuritySubscription {
    native: Option<NonNull<c_void>>,
    callback: Option<Box<CallbackState>>,
    bootstrap_deadline: Instant,
    registrar: EndpointSecurityBootstrapRegistrar,
    barrier_requested: bool,
    identity_worker: Option<IdentityWorker>,
}

impl MacOsLifecycleEventFeed for EndpointSecurityEventFeed {
    type Subscription = EndpointSecuritySubscription;

    fn start(self, sink: MacOsLifecycleSink) -> Result<Self::Subscription, MacOsLifecycleFailure> {
        if Instant::now() >= self.bootstrap_deadline {
            return Err(MacOsLifecycleFailure::Backend);
        }
        let identity_worker = IdentityWorker::start(sink.clone())?;
        *self
            .registrar
            .sink
            .lock()
            .map_err(|_| MacOsLifecycleFailure::Protocol)? = Some(identity_worker.ingress());
        let (first_reply, first_receive) = mpsc::sync_channel(1);
        let mut callback = Box::new(CallbackState {
            sink,
            mapper: Mutex::new(EventMapper::new(self.candidate)),
            barrier: Mutex::new(None),
            first_callback: Mutex::new(Some(first_reply)),
            identities: Some(identity_worker.ingress()),
        });
        let mut native = std::ptr::null_mut();
        // SAFETY: the Box address is stable until successful ES deletion. The C
        // shim copies its block and calls only the fixed ABI callback below.
        let result =
            unsafe { prctr_es_open((&raw mut *callback).cast(), receive_fact, &raw mut native) };
        if result != 0 {
            self.registrar.clear();
            if result == 3 {
                // Cleanup was not proved. Retain callback storage until the
                // poisoned helper process is killed, avoiding a callback UAF.
                let _retained = Box::into_raw(callback);
                poison_native_source_process();
                return Err(MacOsLifecycleFailure::Cleanup);
            }
            return Err(if result == 1 {
                MacOsLifecycleFailure::PermissionLost
            } else {
                MacOsLifecycleFailure::Backend
            });
        }
        let Some(native) = NonNull::new(native) else {
            self.registrar.clear();
            let _retained = Box::into_raw(callback);
            poison_native_source_process();
            return Err(MacOsLifecycleFailure::Cleanup);
        };
        let mut subscription = EndpointSecuritySubscription {
            native: Some(native),
            callback: Some(callback),
            bootstrap_deadline: self.bootstrap_deadline,
            registrar: self.registrar,
            barrier_requested: false,
            identity_worker: Some(identity_worker),
        };
        let remaining = subscription
            .bootstrap_deadline
            .saturating_duration_since(Instant::now())
            .min(Duration::from_secs(1));
        if remaining.is_zero() || first_receive.recv_timeout(remaining).is_err() {
            subscription.close()?;
            return Err(MacOsLifecycleFailure::Backend);
        }
        Ok(subscription)
    }
}

impl EndpointSecuritySubscription {
    fn close(&mut self) -> Result<(), MacOsLifecycleFailure> {
        self.registrar.clear();
        let Some(native) = self.native.take() else {
            return Ok(());
        };
        // SAFETY: the owner is !Send, holds exclusive access to this client and
        // no callback calls another es_* API. Native deletion fences intake.
        let result = unsafe { prctr_es_close(native.as_ptr()) };
        if result != 0 {
            if let Some(callback) = self.callback.take() {
                let _retained = Box::into_raw(callback);
            }
            poison_native_source_process();
            return Err(MacOsLifecycleFailure::Cleanup);
        }
        self.callback.take();
        self.identity_worker
            .as_mut()
            .map_or(Ok(()), IdentityWorker::close)
    }
}

impl MacOsLifecycleSubscription for EndpointSecuritySubscription {
    fn bootstrap_barrier(&mut self) -> Result<MacOsLifecycleCheckpoint, MacOsLifecycleFailure> {
        if self.barrier_requested {
            return Err(MacOsLifecycleFailure::Protocol);
        }
        self.barrier_requested = true;
        self.registrar.clear();
        let callback = self
            .callback
            .as_ref()
            .ok_or(MacOsLifecycleFailure::Backend)?;
        await_callback_boundary(callback, self.bootstrap_deadline)
    }

    fn stop(mut self) -> Result<(), MacOsLifecycleFailure> {
        self.close()
    }
}

fn await_callback_boundary(
    callback: &CallbackState,
    deadline: Instant,
) -> Result<MacOsLifecycleCheckpoint, MacOsLifecycleFailure> {
    let timeout = deadline
        .saturating_duration_since(Instant::now())
        .min(Duration::from_secs(1));
    if timeout.is_zero() {
        return Err(MacOsLifecycleFailure::Backend);
    }
    // SAFETY: pure process clock read, same tick domain as ES mach_time.
    let after_mach_time = unsafe { prctr_es_clock_now() };
    let (reply, receive) = mpsc::sync_channel(1);
    *callback
        .barrier
        .lock()
        .map_err(|_| MacOsLifecycleFailure::Protocol)? = Some(BarrierRequest {
        after_mach_time,
        reply,
    });
    let result = receive
        .recv_timeout(timeout)
        .map_err(|_| MacOsLifecycleFailure::Backend);
    callback
        .barrier
        .lock()
        .map_err(|_| MacOsLifecycleFailure::Protocol)?
        .take();
    result?
}

impl Drop for EndpointSecuritySubscription {
    fn drop(&mut self) {
        let _closed = self.close();
    }
}

unsafe extern "C" fn receive_fact(context: *mut c_void, raw: *const RawFact) {
    // SAFETY: the C shim owns a live message, passes an initialized stack fact,
    // and retains context until successful client deletion. No references escape.
    let (state, raw) = unsafe { (&*context.cast::<CallbackState>(), &*raw) };
    let outcome = catch_unwind(AssertUnwindSafe(|| {
        let Ok(mut mapper) = state.mapper.try_lock() else {
            state.sink.submit(MacOsLifecycleInput::BackendInvalidated);
            return;
        };
        match mapper.decode(raw) {
            Ok(decoded) => {
                state.sink.submit(decoded.event);
                if let Some(identities) = &state.identities {
                    if let Some((key, generation, exited)) = decoded.identity_job {
                        let token =
                            (!exited).then(|| OwnedAuditToken::copy_from_kernel(&raw.audit_token));
                        if identities.observe(key, generation, token, exited).is_err() {
                            state.sink.submit(MacOsLifecycleInput::BackendInvalidated);
                            return;
                        }
                    }
                } else if let Some(identity) = decoded.identity {
                    // Deterministic callback fixtures have no native SDK worker.
                    state
                        .sink
                        .submit(MacOsLifecycleInput::IdentityResolved(Box::new(identity)));
                }
                let Ok(mut first_callback) = state.first_callback.try_lock() else {
                    state.sink.submit(MacOsLifecycleInput::BackendInvalidated);
                    return;
                };
                if let Some(reply) = first_callback.take() {
                    let _sent = reply.try_send(());
                }
                let Ok(mut barrier) = state.barrier.try_lock() else {
                    state.sink.submit(MacOsLifecycleInput::BackendInvalidated);
                    return;
                };
                if barrier
                    .as_ref()
                    .is_some_and(|request| raw.mach_time > request.after_mach_time)
                    && let Some(request) = barrier.take()
                {
                    let checkpoint = match state
                        .identities
                        .as_ref()
                        .map(IdentityIngress::activate)
                        .transpose()
                    {
                        Ok(_) => state.sink.checkpoint(),
                        Err(error) => {
                            state.sink.submit(MacOsLifecycleInput::BackendInvalidated);
                            Err(error)
                        }
                    };
                    let _sent = request.reply.try_send(checkpoint);
                }
            }
            Err(MacOsLifecycleFailure::NativeEventLoss(count)) => {
                state
                    .sink
                    .submit(MacOsLifecycleInput::NativeEventLoss(count));
            }
            Err(_) => state.sink.submit(MacOsLifecycleInput::BackendInvalidated),
        }
    }));
    if outcome.is_err() {
        state.sink.submit(MacOsLifecycleInput::BackendInvalidated);
    }
}

struct DecodedEvent {
    event: MacOsLifecycleInput,
    identity: Option<MacOsIdentityResolution>,
    identity_job: Option<(MacOsProcessKey, u32, bool)>,
}

struct EventMapper {
    candidate: MacOsCandidateAuditSession,
    global_sequence: Option<u64>,
    type_sequences: [Option<u64>; 3],
    mach_time: Option<u64>,
    failed: bool,
}

impl EventMapper {
    const fn new(candidate: MacOsCandidateAuditSession) -> Self {
        Self {
            candidate,
            global_sequence: None,
            type_sequences: [None; 3],
            mach_time: None,
            failed: false,
        }
    }

    fn decode(&mut self, raw: &RawFact) -> Result<DecodedEvent, MacOsLifecycleFailure> {
        if self.failed {
            return Err(MacOsLifecycleFailure::Backend);
        }
        let result = self.decode_current(raw);
        if result.is_err() {
            self.failed = true;
        }
        result
    }

    fn decode_current(&mut self, raw: &RawFact) -> Result<DecodedEvent, MacOsLifecycleFailure> {
        let index = match raw.kind {
            1 => 0,
            2 => 1,
            3 => 2,
            _ => return Err(MacOsLifecycleFailure::Protocol),
        };
        // Start cannot return before the first callback. Thus this baseline
        // predates inventory and both its exact global continuity and the
        // per-type continuity must hold through the later bootstrap boundary.
        if self
            .mach_time
            .is_some_and(|previous| raw.mach_time < previous)
        {
            return Err(MacOsLifecycleFailure::Protocol);
        }
        check_sequence(self.global_sequence, raw.global_sequence)?;
        check_sequence(self.type_sequences[index], raw.type_sequence)?;
        let seconds =
            u64::try_from(raw.start_seconds).map_err(|_| MacOsLifecycleFailure::Protocol)?;
        let microseconds =
            u32::try_from(raw.start_microseconds).map_err(|_| MacOsLifecycleFailure::Protocol)?;
        let key = MacOsProcessKey::new(raw.process_id, seconds, microseconds)
            .ok_or(MacOsLifecycleFailure::Protocol)?;
        let account = self
            .candidate
            .classify_process(raw.audit_session_id, raw.audit_user_id);
        let fact = MacOsProcessFact::new(
            key,
            raw.execution_generation,
            raw.audit_session_id,
            raw.audit_user_id,
            account,
        );
        let event = match raw.kind {
            1 => MacOsLifecycleInput::Fork(fact),
            2 => MacOsLifecycleInput::Exec(fact),
            _ => MacOsLifecycleInput::Exit(fact),
        };
        // Pure mapper fixtures resolve unavailable. The real callback instead
        // hands the exact kernel token to the separately owned signing worker;
        // partial ES signing fields never establish Verified identity.
        let identity = if raw.kind == 3 || !matches!(account, MacOsProcessAccountClass::Human) {
            None
        } else {
            Some(MacOsIdentityResolution::new(
                key,
                raw.execution_generation,
                unavailable_identity(),
            )?)
        };
        self.mach_time = Some(raw.mach_time);
        self.global_sequence = Some(raw.global_sequence);
        self.type_sequences[index] = Some(raw.type_sequence);
        let identity_job = matches!(account, MacOsProcessAccountClass::Human).then_some((
            key,
            raw.execution_generation,
            raw.kind == 3,
        ));
        Ok(DecodedEvent {
            event,
            identity,
            identity_job,
        })
    }
}

fn check_sequence(previous: Option<u64>, current: u64) -> Result<(), MacOsLifecycleFailure> {
    let expected = match previous {
        Some(previous) => previous
            .checked_add(1)
            .ok_or(MacOsLifecycleFailure::Protocol)?,
        None => return Ok(()),
    };
    if current < expected {
        return Err(MacOsLifecycleFailure::Protocol);
    }
    if current > expected {
        let count = current - expected;
        if count > prctr_native_protocol::MAX_PROTOCOL_SAFE_INTEGER {
            return Err(MacOsLifecycleFailure::Protocol);
        }
        return Err(MacOsLifecycleFailure::NativeEventLoss(count));
    }
    Ok(())
}

const fn unavailable_identity() -> ProcessExecutableIdentity {
    ProcessExecutableIdentity {
        status: ProcessExecutableIdentityStatus::Unavailable,
        signer_chain_id: None,
        publisher_id: None,
        product_id: None,
        signing_id: None,
        team_id: None,
        designated_requirement: None,
        bundle_id: None,
        package_id: None,
        version: None,
        digest_sha256: None,
    }
}

#[cfg(test)]
mod tests {
    use super::super::macos_lifecycle::{
        MacOsProcessInventory, MacOsProcessInventoryCollector, MacOsProcessLifecycle,
    };
    use super::*;

    struct EmptyInventory;
    impl MacOsProcessInventory for EmptyInventory {
        fn snapshot(
            &mut self,
            _collector: &mut MacOsProcessInventoryCollector,
        ) -> Result<(), MacOsLifecycleFailure> {
            Ok(())
        }
    }

    struct CallbackTestFeed {
        post_boundary: bool,
        loss: bool,
    }
    struct CallbackTestSubscription {
        state: CallbackState,
        post_boundary: bool,
        loss: bool,
    }

    impl MacOsLifecycleEventFeed for CallbackTestFeed {
        type Subscription = CallbackTestSubscription;
        fn start(
            self,
            sink: MacOsLifecycleSink,
        ) -> Result<Self::Subscription, MacOsLifecycleFailure> {
            let state = CallbackState {
                sink,
                mapper: Mutex::new(mapper()),
                barrier: Mutex::new(None),
                first_callback: Mutex::new(None),
                identities: None,
            };
            let mut baseline = fact(1, 100, 20);
            // SAFETY: pure clock read; receive_fact borrows two initialized
            // values synchronously and retains neither pointer.
            unsafe {
                baseline.mach_time = prctr_es_clock_now();
                receive_fact((&raw const state).cast_mut().cast(), &raw const baseline);
            }
            Ok(CallbackTestSubscription {
                state,
                post_boundary: self.post_boundary,
                loss: self.loss,
            })
        }
    }

    impl MacOsLifecycleSubscription for CallbackTestSubscription {
        fn bootstrap_barrier(&mut self) -> Result<MacOsLifecycleCheckpoint, MacOsLifecycleFailure> {
            let deadline = Instant::now() + Duration::from_millis(100);
            std::thread::scope(|scope| {
                let state = &self.state;
                let post_boundary = self.post_boundary;
                let loss = self.loss;
                scope.spawn(move || {
                    let boundary = loop {
                        if let Some(request) = state.barrier.lock().expect("barrier lock").as_ref()
                        {
                            break request.after_mach_time;
                        }
                        assert!(Instant::now() < deadline, "barrier must be installed");
                        std::thread::yield_now();
                    };
                    let mut old = fact(2, 101, 8);
                    old.execution_generation = 3;
                    old.mach_time = boundary;
                    // SAFETY: scoped thread cannot outlive the borrowed state;
                    // callbacks are invoked serially and no pointer is retained.
                    unsafe {
                        receive_fact(std::ptr::from_ref(state).cast_mut().cast(), &raw const old);
                    }
                    assert!(
                        state.barrier.lock().expect("barrier lock").is_some(),
                        "equal/older OS events must not establish the checkpoint"
                    );
                    if post_boundary {
                        let mut next = fact(2, if loss { 104 } else { 102 }, 9);
                        next.execution_generation = 4;
                        next.mach_time = boundary + 1;
                        // SAFETY: same scoped synchronous callback lifetime.
                        unsafe {
                            receive_fact(
                                std::ptr::from_ref(state).cast_mut().cast(),
                                &raw const next,
                            );
                        }
                    }
                });
                await_callback_boundary(&self.state, deadline)
            })
        }
        fn stop(self) -> Result<(), MacOsLifecycleFailure> {
            Ok(())
        }
    }

    #[test]
    fn contiguous_post_inventory_callback_establishes_real_ingress_boundary() {
        let candidate = MacOsCandidateAuditSession::from_verified_peer(42, 501).expect("candidate");
        let (initial, mut source) = MacOsProcessLifecycle::open(
            candidate,
            16,
            CallbackTestFeed {
                post_boundary: true,
                loss: false,
            },
            EmptyInventory,
        )
        .expect("bounded passive barrier");
        assert_eq!(initial.processes.len(), 1);
        assert_eq!(
            initial.processes[0].identity.status,
            ProcessExecutableIdentityStatus::Unavailable
        );
        source.close().expect("callback owner closes");
    }

    #[test]
    fn quiet_or_gapped_stream_never_publishes_initial_completeness() {
        for (post_boundary, loss) in [(false, false), (true, true)] {
            let candidate =
                MacOsCandidateAuditSession::from_verified_peer(42, 501).expect("candidate");
            assert!(
                MacOsProcessLifecycle::open(
                    candidate,
                    16,
                    CallbackTestFeed {
                        post_boundary,
                        loss
                    },
                    EmptyInventory
                )
                .is_err()
            );
        }
    }

    fn mapper() -> EventMapper {
        EventMapper::new(
            MacOsCandidateAuditSession::from_verified_peer(42, 501)
                .expect("verified audit context"),
        )
    }

    fn fact(kind: u32, global: u64, per_type: u64) -> RawFact {
        RawFact {
            global_sequence: global,
            type_sequence: per_type,
            mach_time: global,
            start_seconds: 17,
            start_microseconds: 200,
            process_id: 123,
            execution_generation: 2,
            audit_session_id: 42,
            audit_user_id: 501,
            kind,
            audit_token: [0; 8],
        }
    }

    #[test]
    fn fork_exec_exit_have_separate_type_sequences_and_exact_generation() {
        let mut mapper = mapper();
        let fork = mapper.decode(&fact(1, 0, 0)).expect("fork");
        assert!(matches!(fork.event, MacOsLifecycleInput::Fork(_)));
        let expected = MacOsIdentityResolution::new(
            MacOsProcessKey::new(123, 17, 200).expect("key"),
            2,
            unavailable_identity(),
        )
        .expect("identity");
        assert!(fork.identity == Some(expected));
        assert!(matches!(
            mapper.decode(&fact(2, 1, 0)).expect("exec").event,
            MacOsLifecycleInput::Exec(_)
        ));
        let exit = mapper.decode(&fact(3, 2, 0)).expect("exit");
        assert!(matches!(exit.event, MacOsLifecycleInput::Exit(_)));
        assert!(exit.identity.is_none());
    }

    #[test]
    fn native_global_loss_is_exact_and_terminal() {
        let mut mapper = mapper();
        mapper.decode(&fact(1, 0, 0)).expect("baseline");
        assert!(matches!(
            mapper.decode(&fact(2, 4, 0)),
            Err(MacOsLifecycleFailure::NativeEventLoss(3))
        ));
        assert!(matches!(
            mapper.decode(&fact(2, 5, 1)),
            Err(MacOsLifecycleFailure::Backend)
        ));
    }

    #[test]
    fn per_type_loss_and_counter_replay_are_rejected() {
        let mut missing = mapper();
        missing.decode(&fact(1, 0, 0)).expect("baseline");
        assert!(matches!(
            missing.decode(&fact(1, 1, 4)),
            Err(MacOsLifecycleFailure::NativeEventLoss(3))
        ));
        for next in [0, 1] {
            let mut repeated = mapper();
            repeated.decode(&fact(1, 0, 0)).expect("baseline");
            repeated.decode(&fact(1, 1, 1)).expect("next");
            assert!(matches!(
                repeated.decode(&fact(1, next, 2)),
                Err(MacOsLifecycleFailure::Protocol)
            ));
        }
    }

    #[test]
    fn unsupported_message_shape_and_invalid_process_lifetime_fail_closed() {
        assert_eq!(std::mem::size_of::<RawFact>(), 96);
        let mut invalid = vec![fact(0, 0, 0)];
        let mut negative = fact(1, 0, 0);
        negative.start_seconds = -1;
        invalid.push(negative);
        let mut micros = fact(1, 0, 0);
        micros.start_microseconds = 1_000_000;
        invalid.push(micros);
        let mut pid = fact(1, 0, 0);
        pid.process_id = 0;
        invalid.push(pid);
        for raw in invalid {
            assert!(matches!(
                mapper().decode(&raw),
                Err(MacOsLifecycleFailure::Protocol)
            ));
        }
    }

    #[test]
    fn baseline_never_becomes_a_bootstrap_proof() {
        let mut subscription = EndpointSecuritySubscription {
            native: None,
            callback: None,
            bootstrap_deadline: Instant::now(),
            registrar: EndpointSecurityBootstrapRegistrar {
                sink: Arc::new(Mutex::new(None)),
                bootstrap_deadline: Instant::now(),
            },
            barrier_requested: false,
            identity_worker: None,
        };
        assert!(matches!(
            subscription.bootstrap_barrier(),
            Err(MacOsLifecycleFailure::Backend)
        ));
        subscription.stop().expect("empty close");
    }
}
