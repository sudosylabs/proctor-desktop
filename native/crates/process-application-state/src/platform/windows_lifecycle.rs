//! Bounded Windows process inventory and lifecycle reconciliation mechanics.
//! A successful complete-prefix barrier is an injected native proof, not a
//! timestamp heuristic. No production implementation of that proof exists yet.
#![cfg_attr(not(target_os = "windows"), allow(dead_code))]

use super::windows_etw_core::{WindowsEtwProcessEvent, WindowsProcessLifetime};
use native_protocol::{
    MAX_PROTOCOL_SAFE_INTEGER, ProcessApplicationCertainty, ProcessApplicationCoverage,
    ProcessApplicationEvent, ProcessApplicationEventKind, ProcessApplicationProcess,
    ProcessApplicationScope, ProcessApplicationState, ProcessExecutableIdentity,
    ProcessExecutableIdentityStatus,
};
use std::time::Instant;

pub const WINDOWS_MAX_INVENTORY: usize = 4096;
const MAX_CURRENT_CANDIDATE_PROCESSES: usize = 256;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum WindowsLifecycleFailure {
    Backend,
    Permission,
    InventoryOverflow,
    Protocol,
    MissingBarrier,
    Deadline,
    Cleanup,
}

/// Session context may originate only from the authenticated caller's pinned
/// process token. The helper's own Session 0 is never a candidate context.
#[derive(Clone, Copy, Eq, PartialEq)]
pub struct WindowsCandidateSession {
    session_id: u32,
    authentication_id: u64,
}
impl WindowsCandidateSession {
    pub(super) const fn session_id(self) -> u32 {
        self.session_id
    }

    pub(super) const fn authentication_id(self) -> u64 {
        self.authentication_id
    }

    #[must_use]
    pub const fn from_verified_peer(session_id: u32, authentication_id: u64) -> Option<Self> {
        if session_id == 0 || session_id == u32::MAX || authentication_id == 0 {
            None
        } else {
            Some(Self {
                session_id,
                authentication_id,
            })
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum WindowsProcessAccount {
    UserSpace,
    SystemService,
}

#[derive(Clone, Copy)]
pub struct WindowsInventoryFact {
    pub lifetime: WindowsProcessLifetime,
    pub session_id: u32,
    pub account: WindowsProcessAccount,
}

/// The raw feed never supplies account authorization. Only an exact-lifetime
/// token query may construct an enriched start; exits use retained lifetime history.
pub struct WindowsEnrichedProcessEvent {
    event: WindowsEtwProcessEvent,
    account: Option<WindowsProcessAccount>,
}

/// SDK calls run on a supervised service control owner, never the ETW callback.
/// Implementations must pin the native process, prove creation/session/token
/// stability, clear transient identity buffers and finish native cleanup before
/// returning. The service enforces the absolute deadline for blocked SDK calls.
pub trait WindowsProcessScopeBackend {
    /// Revalidate the authenticated candidate's current WTS logon generation.
    /// # Errors
    /// Replacement, missing token, deadline or cleanup failure fences the source.
    fn check_logon(&mut self, deadline: Instant) -> Result<(), WindowsLifecycleFailure>;
    /// Bind a start to its exact live process lifetime and primary token.
    /// # Errors
    /// Exited/reused/inaccessible processes never receive an inferred scope.
    fn prove_start(
        &mut self,
        event: &WindowsEtwProcessEvent,
        deadline: Instant,
    ) -> Result<WindowsInventoryFact, WindowsLifecycleFailure>;
}

pub struct WindowsScopeDrain {
    pub events: Vec<WindowsEnrichedProcessEvent>,
    pub failure: Option<WindowsLifecycleFailure>,
}

/// Bounded sequential enrichment preserves accepted input order. Any unprovable
/// start or changed authenticated logon terminally fences this generation. The
/// successfully proved prefix is returned with that failure, never discarded.
pub struct WindowsScopeEnricher<B> {
    backend: B,
    capacity: usize,
    failed: bool,
}
impl<B: WindowsProcessScopeBackend> WindowsScopeEnricher<B> {
    /// # Errors
    /// Rejects unbounded capacity before any native query.
    pub fn new(backend: B, capacity: usize) -> Result<Self, WindowsLifecycleFailure> {
        if !(1..=WINDOWS_MAX_INVENTORY).contains(&capacity) {
            return Err(WindowsLifecycleFailure::Protocol);
        }
        Ok(Self {
            backend,
            capacity,
            failed: false,
        })
    }

    pub fn enrich(
        &mut self,
        events: Vec<WindowsEtwProcessEvent>,
        deadline: Instant,
    ) -> WindowsScopeDrain {
        let mut output = Vec::new();
        let result = (|| {
            if self.failed {
                return Err(WindowsLifecycleFailure::Backend);
            }
            if events.len() > self.capacity {
                return Err(WindowsLifecycleFailure::InventoryOverflow);
            }
            Self::check_boundary(deadline)?;
            self.backend.check_logon(deadline)?;
            for event in events {
                Self::check_boundary(deadline)?;
                validate_lifetime(event.lifetime)?;
                if event.qpc_timestamp < 0
                    || event.started != event.session_id.is_some()
                    || event.session_id == Some(u32::MAX)
                {
                    return Err(WindowsLifecycleFailure::Protocol);
                }
                let account = if event.started {
                    let fact = self.backend.prove_start(&event, deadline)?;
                    if fact.lifetime != event.lifetime || Some(fact.session_id) != event.session_id
                    {
                        return Err(WindowsLifecycleFailure::Backend);
                    }
                    Some(fact.account)
                } else {
                    None
                };
                Self::check_boundary(deadline)?;
                self.backend.check_logon(deadline)?;
                Self::check_boundary(deadline)?;
                output.push(WindowsEnrichedProcessEvent { event, account });
            }
            Self::check_boundary(deadline)
        })();
        if result.is_err() {
            self.failed = true;
        }
        WindowsScopeDrain {
            events: output,
            failure: result.err(),
        }
    }

    fn check_boundary(deadline: Instant) -> Result<(), WindowsLifecycleFailure> {
        if Instant::now() >= deadline {
            Err(WindowsLifecycleFailure::Deadline)
        } else {
            Ok(())
        }
    }
}

/// A bounded capture, not an assertion that its changing OS processes were
/// simultaneous. The lifecycle owner reconciles it with buffered notifications.
pub struct WindowsInventoryCapture {
    start_qpc: i64,
    end_qpc: i64,
    facts: Vec<WindowsInventoryFact>,
    finished: bool,
    failed: bool,
}
impl WindowsInventoryCapture {
    /// Starts the bounded collector before the native inventory query.
    /// # Errors
    /// Rejects invalid clock values.
    pub fn begin(start_qpc: i64) -> Result<Self, WindowsLifecycleFailure> {
        if start_qpc < 0 {
            return Err(WindowsLifecycleFailure::Protocol);
        }
        Ok(Self {
            start_qpc,
            end_qpc: start_qpc,
            facts: Vec::new(),
            finished: false,
            failed: false,
        })
    }
    /// Appends one pinned-handle fact; duplicate PIDs or oversized inventories
    /// fail rather than truncating a supposedly complete capture.
    /// # Errors
    /// Returns protocol or inventory-overflow failure.
    pub fn push(&mut self, fact: WindowsInventoryFact) -> Result<(), WindowsLifecycleFailure> {
        let result = self.push_inner(fact);
        if result.is_err() {
            self.failed = true;
        }
        result
    }
    fn push_inner(&mut self, fact: WindowsInventoryFact) -> Result<(), WindowsLifecycleFailure> {
        if self.finished || self.failed {
            return Err(WindowsLifecycleFailure::Protocol);
        }
        validate_lifetime(fact.lifetime)?;
        if fact.session_id == u32::MAX
            || self
                .facts
                .iter()
                .any(|old| old.lifetime.process_id == fact.lifetime.process_id)
        {
            return Err(WindowsLifecycleFailure::Protocol);
        }
        if self.facts.len() >= WINDOWS_MAX_INVENTORY {
            return Err(WindowsLifecycleFailure::InventoryOverflow);
        }
        self.facts.push(fact);
        Ok(())
    }
    /// Finishes only after all native handle cleanup is proved.
    /// # Errors
    /// Rejects a clock regression.
    pub fn finish(mut self, end_qpc: i64) -> Result<Self, WindowsLifecycleFailure> {
        if self.finished || self.failed || end_qpc < self.start_qpc {
            return Err(WindowsLifecycleFailure::Protocol);
        }
        self.end_qpc = end_qpc;
        self.finished = true;
        Ok(self)
    }
}
impl Drop for WindowsInventoryCapture {
    fn drop(&mut self) {
        for fact in &mut self.facts {
            erase_fact(fact);
        }
    }
}

/// Acknowledges an exact accepted ingress prefix after inventory. Implementors
/// must prove subscription before capture, provider ordering/publication and
/// zero loss through the returned boundary, not merely observe
/// a later timestamp or a successful flush call. The supplied sequence is local
/// ingress order; it is not an ETW-native sequence or a public evidence sequence.
pub trait WindowsCompletePrefixBarrier {
    /// # Errors
    /// Quiet, unsupported, unproved, expired or lost boundaries fail closed.
    fn complete_prefix_after(
        &mut self,
        inventory_end_qpc: i64,
        accepted_sequence: u64,
        deadline: Instant,
    ) -> Result<WindowsPrefixCheckpoint, WindowsLifecycleFailure>;
}

pub struct WindowsPrefixCheckpoint {
    pub ingress_sequence: u64,
    pub after_qpc: i64,
}

/// Current production default: Windows ETW has no admitted complete-prefix proof.
pub struct UnavailableWindowsPrefixBarrier;
impl WindowsCompletePrefixBarrier for UnavailableWindowsPrefixBarrier {
    fn complete_prefix_after(
        &mut self,
        _inventory_end_qpc: i64,
        _accepted_sequence: u64,
        _deadline: Instant,
    ) -> Result<WindowsPrefixCheckpoint, WindowsLifecycleFailure> {
        Err(WindowsLifecycleFailure::MissingBarrier)
    }
}

pub struct WindowsLifecycleSnapshot {
    pub ingress_sequence: u64,
    pub after_qpc: i64,
    pub state: ProcessApplicationState,
}
pub struct WindowsLifecycleEvent {
    pub ingress_sequence: u64,
    pub qpc_timestamp: i64,
    pub event: ProcessApplicationEvent,
}

struct TrackedLifetime {
    fact: WindowsInventoryFact,
    scope_known: bool,
    active: bool,
    saw_start: bool,
    ordinal: u64,
}
#[derive(Clone, Copy, Eq, PartialEq)]
enum Phase {
    Bootstrap,
    Live,
    Failed,
    Closed,
}

/// Reconciles independent current-state and lifetime history. Tombstones remain
/// bounded for the session and detect reuse/replay without ever correlating PID
/// alone. Executable identity remains explicitly unavailable.
pub struct WindowsProcessReconciler {
    candidate: WindowsCandidateSession,
    capture_start: i64,
    capture_end: i64,
    last_qpc: Option<i64>,
    sequence: u64,
    history: Vec<TrackedLifetime>,
    phase: Phase,
}
impl WindowsProcessReconciler {
    /// Seeds captured state while preserving a separate history for queued events.
    /// # Errors
    /// Rejects invalid capture, scope or capacity.
    pub fn new(
        candidate: WindowsCandidateSession,
        capture: WindowsInventoryCapture,
    ) -> Result<Self, WindowsLifecycleFailure> {
        if !capture.finished || capture.failed {
            return Err(WindowsLifecycleFailure::Protocol);
        }
        let mut owner = Self {
            candidate,
            capture_start: capture.start_qpc,
            capture_end: capture.end_qpc,
            last_qpc: None,
            sequence: 0,
            history: Vec::new(),
            phase: Phase::Bootstrap,
        };
        for fact in &capture.facts {
            owner.insert(*fact, true, true, false)?;
        }
        drop(capture);
        owner.check_current_bound()?;
        Ok(owner)
    }

    /// Fences publication after transport loss, native failure, or owner teardown.
    /// A fresh source generation is required; this owner cannot be restarted.
    pub fn invalidate(&mut self) {
        self.phase = Phase::Failed;
    }

    /// Consumes exactly the next accepted ingress event. During bootstrap, the
    /// events alter history/current state without publishing live observations.
    /// # Errors
    /// Gaps, replay, contradictory lifetime/scope or capacity terminally fence it.
    pub fn ingest(
        &mut self,
        sequence: u64,
        enriched: &WindowsEnrichedProcessEvent,
    ) -> Result<Option<WindowsLifecycleEvent>, WindowsLifecycleFailure> {
        let result = self.ingest_inner(sequence, &enriched.event, enriched.account);
        if result.is_err() {
            self.phase = Phase::Failed;
        }
        result
    }

    fn ingest_inner(
        &mut self,
        sequence: u64,
        event: &WindowsEtwProcessEvent,
        account: Option<WindowsProcessAccount>,
    ) -> Result<Option<WindowsLifecycleEvent>, WindowsLifecycleFailure> {
        if !matches!(self.phase, Phase::Bootstrap | Phase::Live) {
            return Err(WindowsLifecycleFailure::Backend);
        }
        if sequence > MAX_PROTOCOL_SAFE_INTEGER
            || self.sequence.checked_add(1) != Some(sequence)
            || event.qpc_timestamp < 0
            || self.last_qpc.is_some_and(|last| event.qpc_timestamp < last)
        {
            return Err(WindowsLifecycleFailure::Protocol);
        }
        validate_lifetime(event.lifetime)?;
        let output = if event.started {
            self.start(event, account.ok_or(WindowsLifecycleFailure::Protocol)?)?
        } else {
            if account.is_some() {
                return Err(WindowsLifecycleFailure::Protocol);
            }
            self.stop(event)?
        };
        self.sequence = sequence;
        self.last_qpc = Some(event.qpc_timestamp);
        Ok(output.map(|event_output| WindowsLifecycleEvent {
            ingress_sequence: sequence,
            qpc_timestamp: event.qpc_timestamp,
            event: event_output,
        }))
    }

    fn start(
        &mut self,
        event: &WindowsEtwProcessEvent,
        account: WindowsProcessAccount,
    ) -> Result<Option<ProcessApplicationEvent>, WindowsLifecycleFailure> {
        let session_id = event
            .session_id
            .filter(|id| *id != u32::MAX)
            .ok_or(WindowsLifecycleFailure::Backend)?;
        let existing = self
            .history
            .iter()
            .position(|known| known.fact.lifetime == event.lifetime);
        let index = if let Some(index) = existing {
            let known = &mut self.history[index];
            // Only an inventory-covered first Start can be replayed into the
            // bootstrap overlay. A tombstone or a second Start is contradictory.
            if self.phase != Phase::Bootstrap
                || !known.scope_known
                || !known.active
                || known.saw_start
                || known.fact.session_id != session_id
                || known.fact.account != account
            {
                return Err(WindowsLifecycleFailure::Backend);
            }
            known.saw_start = true;
            index
        } else {
            if self.phase == Phase::Live
                && self.history.iter().any(|known| {
                    known.active && known.fact.lifetime.process_id == event.lifetime.process_id
                })
            {
                return Err(WindowsLifecycleFailure::Backend);
            }
            self.insert(
                WindowsInventoryFact {
                    lifetime: event.lifetime,
                    session_id,
                    account,
                },
                true,
                true,
                true,
            )?
        };
        if self.phase == Phase::Live {
            self.check_current_bound()?;
        }
        if self.phase == Phase::Live
            && session_id == self.candidate.session_id
            && account == WindowsProcessAccount::UserSpace
        {
            let process = Self::project(&self.history[index]);
            Ok(Some(ProcessApplicationEvent {
                capture_delay_ns: None,
                kind: ProcessApplicationEventKind::Started,
                process_instance_id: Some(process.process_instance_id.clone()),
                process: Some(process),
                state: None,
            }))
        } else {
            Ok(None)
        }
    }

    fn stop(
        &mut self,
        event: &WindowsEtwProcessEvent,
    ) -> Result<Option<ProcessApplicationEvent>, WindowsLifecycleFailure> {
        if event.session_id.is_some() {
            return Err(WindowsLifecycleFailure::Protocol);
        }
        let Some(index) = self
            .history
            .iter()
            .position(|known| known.fact.lifetime == event.lifetime)
        else {
            // A stop predating capture may refer to a process already gone when
            // inventory began. Retain its tombstone, never infer scope from PID.
            if self.phase != Phase::Bootstrap || event.qpc_timestamp > self.capture_start {
                return Err(WindowsLifecycleFailure::Backend);
            }
            self.insert(
                WindowsInventoryFact {
                    lifetime: event.lifetime,
                    session_id: 0,
                    account: WindowsProcessAccount::SystemService,
                },
                false,
                false,
                false,
            )?;
            return Ok(None);
        };
        let known = &mut self.history[index];
        if !known.active
            || (self.phase == Phase::Bootstrap
                && !known.saw_start
                && event.qpc_timestamp < self.capture_start)
        {
            return Err(WindowsLifecycleFailure::Backend);
        }
        known.active = false;
        if self.phase == Phase::Live
            && known.fact.session_id == self.candidate.session_id
            && known.fact.account == WindowsProcessAccount::UserSpace
        {
            Ok(Some(ProcessApplicationEvent {
                capture_delay_ns: None,
                kind: ProcessApplicationEventKind::Exited,
                process_instance_id: Some(opaque_id(known.ordinal)),
                process: None,
                state: None,
            }))
        } else {
            Ok(None)
        }
    }

    fn insert(
        &mut self,
        fact: WindowsInventoryFact,
        scope_known: bool,
        active: bool,
        saw_start: bool,
    ) -> Result<usize, WindowsLifecycleFailure> {
        if self.history.len() >= WINDOWS_MAX_INVENTORY {
            return Err(WindowsLifecycleFailure::InventoryOverflow);
        }
        let index = self.history.len();
        self.history.push(TrackedLifetime {
            fact,
            scope_known,
            active,
            saw_start,
            ordinal: u64::try_from(index).map_err(|_| WindowsLifecycleFailure::Protocol)? + 1,
        });
        Ok(index)
    }

    fn check_current_bound(&self) -> Result<(), WindowsLifecycleFailure> {
        if self
            .history
            .iter()
            .filter(|known| {
                known.active
                    && known.fact.session_id == self.candidate.session_id
                    && known.fact.account == WindowsProcessAccount::UserSpace
            })
            .count()
            > MAX_CURRENT_CANDIDATE_PROCESSES
        {
            return Err(WindowsLifecycleFailure::InventoryOverflow);
        }
        Ok(())
    }

    /// Publishes only an independently proved exact boundary. A rejected barrier
    /// terminally fences this owner; no later retry can resurrect this generation.
    /// # Errors
    /// Missing proof, mismatched checkpoint, expired deadline or conflicting
    /// current lifetimes never yields complete state.
    pub fn publish_initial(
        &mut self,
        barrier: &mut impl WindowsCompletePrefixBarrier,
        deadline: Instant,
    ) -> Result<WindowsLifecycleSnapshot, WindowsLifecycleFailure> {
        let result = self.publish_inner(barrier, deadline);
        if result.is_err() {
            self.phase = Phase::Failed;
        }
        result
    }
    fn publish_inner(
        &mut self,
        barrier: &mut impl WindowsCompletePrefixBarrier,
        deadline: Instant,
    ) -> Result<WindowsLifecycleSnapshot, WindowsLifecycleFailure> {
        if self.phase != Phase::Bootstrap {
            return Err(WindowsLifecycleFailure::Backend);
        }
        if Instant::now() >= deadline {
            return Err(WindowsLifecycleFailure::Deadline);
        }
        let checkpoint =
            barrier.complete_prefix_after(self.capture_end, self.sequence, deadline)?;
        if Instant::now() >= deadline {
            return Err(WindowsLifecycleFailure::Deadline);
        }
        if checkpoint.ingress_sequence != self.sequence
            || checkpoint.after_qpc <= self.capture_end
            || self
                .last_qpc
                .is_some_and(|last| checkpoint.after_qpc < last)
        {
            return Err(WindowsLifecycleFailure::MissingBarrier);
        }
        self.check_current_bound()?;
        for (index, known) in self.history.iter().enumerate() {
            if known.active
                && self.history[..index].iter().any(|other| {
                    other.active && other.fact.lifetime.process_id == known.fact.lifetime.process_id
                })
            {
                return Err(WindowsLifecycleFailure::Backend);
            }
        }
        let state = ProcessApplicationState {
            coverage: ProcessApplicationCoverage::FullLifecycle,
            certainty: ProcessApplicationCertainty::Complete,
            processes: self
                .history
                .iter()
                .filter(|known| {
                    known.active
                        && known.fact.session_id == self.candidate.session_id
                        && known.fact.account == WindowsProcessAccount::UserSpace
                })
                .map(Self::project)
                .collect(),
        };
        self.last_qpc = Some(checkpoint.after_qpc);
        self.phase = Phase::Live;
        Ok(WindowsLifecycleSnapshot {
            ingress_sequence: self.sequence,
            after_qpc: checkpoint.after_qpc,
            state,
        })
    }
    fn project(known: &TrackedLifetime) -> ProcessApplicationProcess {
        ProcessApplicationProcess {
            process_instance_id: opaque_id(known.ordinal),
            scope: ProcessApplicationScope::CandidateInteractiveSession,
            identity: unavailable_identity(),
        }
    }
    /// Fences this owner and erases its bounded raw identity storage.
    pub fn close(&mut self) {
        self.phase = Phase::Closed;
        for known in &mut self.history {
            erase_fact(&mut known.fact);
        }
        self.history.clear();
    }
}
impl Drop for WindowsProcessReconciler {
    fn drop(&mut self) {
        self.close();
    }
}

fn opaque_id(ordinal: u64) -> String {
    format!("process-instance-{ordinal:016x}")
}
fn validate_lifetime(lifetime: WindowsProcessLifetime) -> Result<(), WindowsLifecycleFailure> {
    if lifetime.process_id == 0 || lifetime.creation_file_time == 0 {
        Err(WindowsLifecycleFailure::Protocol)
    } else {
        Ok(())
    }
}
#[allow(unsafe_code)]
fn erase_fact(fact: &mut WindowsInventoryFact) {
    // SAFETY: each scalar is initialized exclusive storage; volatile writes
    // prevent optimization removing the source-owned raw buffer erasure.
    unsafe {
        std::ptr::write_volatile(&raw mut fact.lifetime.process_id, 0);
        std::ptr::write_volatile(&raw mut fact.lifetime.creation_file_time, 0);
        std::ptr::write_volatile(&raw mut fact.session_id, 0);
    }
}
fn unavailable_identity() -> ProcessExecutableIdentity {
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
    use super::*;
    use std::time::Duration;

    struct ScriptedScope {
        proofs: std::collections::VecDeque<Result<WindowsInventoryFact, WindowsLifecycleFailure>>,
        checks: usize,
        fail_check: Option<usize>,
    }
    impl WindowsProcessScopeBackend for ScriptedScope {
        fn check_logon(&mut self, _: Instant) -> Result<(), WindowsLifecycleFailure> {
            self.checks += 1;
            if self.fail_check == Some(self.checks) {
                Err(WindowsLifecycleFailure::Backend)
            } else {
                Ok(())
            }
        }
        fn prove_start(
            &mut self,
            _: &WindowsEtwProcessEvent,
            _: Instant,
        ) -> Result<WindowsInventoryFact, WindowsLifecycleFailure> {
            self.proofs
                .pop_front()
                .expect("one exact native query per start")
        }
    }
    fn enricher(
        proofs: Vec<Result<WindowsInventoryFact, WindowsLifecycleFailure>>,
        fail_check: Option<usize>,
    ) -> WindowsScopeEnricher<ScriptedScope> {
        WindowsScopeEnricher::new(
            ScriptedScope {
                proofs: proofs.into(),
                checks: 0,
                fail_check,
            },
            4,
        )
        .unwrap()
    }

    #[test]
    fn scope_enrichment_preserves_proved_prefix_and_fences_unprovable_next_start() {
        let first = fact(20, 1000, 7);
        let second = fact(21, 2000, 7);
        let mut scope = enricher(
            vec![Ok(first), Err(WindowsLifecycleFailure::Permission)],
            None,
        );
        let batch = scope.enrich(
            vec![
                event(first, true, 310).event,
                event(first, false, 320).event,
                event(second, true, 330).event,
            ],
            deadline(),
        );
        assert_eq!(batch.events.len(), 2);
        assert_eq!(batch.failure, Some(WindowsLifecycleFailure::Permission));
        let mut reducer = owner(&[]);
        initial(&mut reducer);
        for (index, event) in batch.events.iter().enumerate() {
            reducer.ingest(index as u64 + 1, event).unwrap();
        }
        assert!(reducer.history.iter().all(|known| !known.active));
        assert_eq!(
            scope.enrich(Vec::new(), deadline()).failure,
            Some(WindowsLifecycleFailure::Backend)
        );
    }

    #[test]
    fn scope_enrichment_rejects_reused_pid_and_contradictory_token_session() {
        let expected = fact(20, 1000, 7);
        for observed in [fact(20, 2000, 7), fact(20, 1000, 8)] {
            let mut scope = enricher(vec![Ok(observed)], None);
            let batch = scope.enrich(vec![event(expected, true, 310).event], deadline());
            assert!(batch.events.is_empty());
            assert_eq!(batch.failure, Some(WindowsLifecycleFailure::Backend));
        }
    }

    #[test]
    fn logon_replacement_during_token_query_cannot_publish_enriched_start() {
        let process = fact(20, 1000, 7);
        let mut scope = enricher(vec![Ok(process)], Some(2));
        let batch = scope.enrich(vec![event(process, true, 310).event], deadline());
        assert!(batch.events.is_empty());
        assert_eq!(batch.failure, Some(WindowsLifecycleFailure::Backend));
        assert_eq!(scope.backend.checks, 2);
        assert!(WindowsCandidateSession::from_verified_peer(7, 0).is_none());
        assert!(
            WindowsCandidateSession::from_verified_peer(7, 123)
                != WindowsCandidateSession::from_verified_peer(7, 124)
        );
    }

    #[test]
    fn native_service_account_scope_stays_outside_application_matching() {
        let mut process = fact(20, 1000, 7);
        process.account = WindowsProcessAccount::SystemService;
        let mut scope = enricher(vec![Ok(process)], None);
        let batch = scope.enrich(
            vec![
                event(process, true, 310).event,
                event(process, false, 320).event,
            ],
            deadline(),
        );
        assert!(batch.failure.is_none());
        let mut reducer = owner(&[]);
        initial(&mut reducer);
        for (index, event) in batch.events.iter().enumerate() {
            assert!(reducer.ingest(index as u64 + 1, event).unwrap().is_none());
        }
        assert!(reducer.history.iter().all(|known| !known.active));
    }

    #[test]
    fn scope_owner_rejects_oversize_and_expired_work_before_native_calls() {
        let mut scope = enricher(Vec::new(), None);
        let batch = scope.enrich(Vec::new(), Instant::now());
        assert_eq!(batch.failure, Some(WindowsLifecycleFailure::Deadline));
        assert_eq!(scope.backend.checks, 0);
        let mut scope = enricher(Vec::new(), None);
        let batch = scope.enrich(
            (0..5)
                .map(|index| event(fact(index + 1, 1000, 7), true, 310).event)
                .collect(),
            deadline(),
        );
        assert_eq!(
            batch.failure,
            Some(WindowsLifecycleFailure::InventoryOverflow)
        );
        assert_eq!(scope.backend.checks, 0);
    }

    struct ModelBarrier;
    impl WindowsCompletePrefixBarrier for ModelBarrier {
        fn complete_prefix_after(
            &mut self,
            end: i64,
            sequence: u64,
            _deadline: Instant,
        ) -> Result<WindowsPrefixCheckpoint, WindowsLifecycleFailure> {
            // Model-only proof: native ETW ordering is deliberately not inferred.
            Ok(WindowsPrefixCheckpoint {
                ingress_sequence: sequence,
                after_qpc: end + 100,
            })
        }
    }
    fn deadline() -> Instant {
        Instant::now() + Duration::from_secs(1)
    }
    fn fact(pid: u32, creation: u64, session: u32) -> WindowsInventoryFact {
        WindowsInventoryFact {
            lifetime: WindowsProcessLifetime {
                process_id: pid,
                creation_file_time: creation,
            },
            session_id: session,
            account: WindowsProcessAccount::UserSpace,
        }
    }
    fn event(fact: WindowsInventoryFact, start: bool, time: i64) -> WindowsEnrichedProcessEvent {
        WindowsEnrichedProcessEvent {
            account: start.then_some(fact.account),
            event: WindowsEtwProcessEvent {
                lifetime: fact.lifetime,
                session_id: start.then_some(fact.session_id),
                started: start,
                qpc_timestamp: time,
            },
        }
    }
    fn capture(facts: &[WindowsInventoryFact]) -> WindowsInventoryCapture {
        let mut capture = WindowsInventoryCapture::begin(100).unwrap();
        for fact in facts {
            capture.push(*fact).unwrap();
        }
        capture.finish(200).unwrap()
    }
    fn owner(facts: &[WindowsInventoryFact]) -> WindowsProcessReconciler {
        WindowsProcessReconciler::new(
            WindowsCandidateSession::from_verified_peer(7, 123).unwrap(),
            capture(facts),
        )
        .unwrap()
    }
    fn initial(owner: &mut WindowsProcessReconciler) -> WindowsLifecycleSnapshot {
        owner
            .publish_initial(&mut ModelBarrier, deadline())
            .unwrap()
    }

    #[test]
    fn production_barrier_never_publishes_complete_or_resurrects_generation() {
        let mut owner = owner(&[fact(20, 1000, 7)]);
        assert!(matches!(
            owner.publish_initial(&mut UnavailableWindowsPrefixBarrier, deadline()),
            Err(WindowsLifecycleFailure::MissingBarrier)
        ));
        assert!(matches!(
            owner.publish_initial(&mut ModelBarrier, deadline()),
            Err(WindowsLifecycleFailure::Backend)
        ));
    }

    #[test]
    fn inventory_covered_start_is_deduplicated_and_identity_stays_unavailable() {
        let process = fact(20, 1000, 7);
        let mut owner = owner(&[process, fact(30, 2000, 8)]);
        assert!(
            owner
                .ingest(1, &event(process, true, 90))
                .unwrap()
                .is_none()
        );
        let snapshot = initial(&mut owner);
        assert_eq!(snapshot.ingress_sequence, 1);
        assert_eq!(snapshot.state.processes.len(), 1);
        assert_eq!(
            snapshot.state.processes[0].identity.status,
            ProcessExecutableIdentityStatus::Unavailable
        );
        assert_eq!(
            snapshot.state.processes[0].process_instance_id,
            "process-instance-0000000000000001"
        );
        assert!(owner.ingest(2, &event(process, true, 310)).is_err());
    }

    #[test]
    fn short_lived_bootstrap_process_remains_tombstoned_after_empty_initial_state() {
        let process = fact(20, 1000, 7);
        let mut owner = owner(&[]);
        owner.ingest(1, &event(process, true, 110)).unwrap();
        owner.ingest(2, &event(process, false, 120)).unwrap();
        assert!(initial(&mut owner).state.processes.is_empty());
        assert!(owner.ingest(3, &event(process, true, 310)).is_err());
    }

    #[test]
    fn live_start_and_exit_have_one_opaque_lifetime_identity() {
        let process = fact(20, 1000, 7);
        let mut owner = owner(&[]);
        initial(&mut owner);
        let start = owner
            .ingest(1, &event(process, true, 310))
            .unwrap()
            .unwrap();
        let stop = owner
            .ingest(2, &event(process, false, 320))
            .unwrap()
            .unwrap();
        assert_eq!(start.event.kind, ProcessApplicationEventKind::Started);
        assert_eq!(stop.event.kind, ProcessApplicationEventKind::Exited);
        assert_eq!(
            start.event.process_instance_id,
            stop.event.process_instance_id
        );
        assert_eq!(
            start.event.process.unwrap().identity.status,
            ProcessExecutableIdentityStatus::Unavailable
        );
        assert!(stop.event.process.is_none());
    }

    #[test]
    fn pid_reuse_keeps_bootstrap_history_separate_from_later_captured_lifetime() {
        let old = fact(20, 1000, 7);
        let current = fact(20, 2000, 7);
        let mut owner = owner(&[current]);
        owner.ingest(1, &event(old, true, 90)).unwrap();
        owner.ingest(2, &event(old, false, 110)).unwrap();
        owner.ingest(3, &event(current, true, 120)).unwrap();
        let snapshot = initial(&mut owner);
        assert_eq!(snapshot.state.processes.len(), 1);
        let exit = owner
            .ingest(4, &event(current, false, 310))
            .unwrap()
            .unwrap();
        assert_eq!(
            exit.event.process_instance_id.as_deref(),
            Some(snapshot.state.processes[0].process_instance_id.as_str())
        );
        let next = fact(20, 3000, 7);
        let started = owner.ingest(5, &event(next, true, 320)).unwrap().unwrap();
        assert_ne!(
            started.event.process_instance_id,
            exit.event.process_instance_id
        );
    }

    #[test]
    fn unknown_stop_is_allowed_only_before_capture_and_never_gets_pid_inferred_scope() {
        let old = fact(20, 1000, 7);
        let mut before = owner(&[fact(20, 2000, 8)]);
        before.ingest(1, &event(old, false, 90)).unwrap();
        assert!(initial(&mut before).state.processes.is_empty());
        let mut during = owner(&[]);
        assert!(during.ingest(1, &event(old, false, 101)).is_err());
        let mut live = owner(&[]);
        initial(&mut live);
        assert!(live.ingest(1, &event(old, false, 310)).is_err());
        let mut contradiction = owner(&[old]);
        assert!(contradiction.ingest(1, &event(old, false, 90)).is_err());
    }

    #[test]
    fn source_loss_sequence_gap_clock_regression_and_scope_mismatch_fence_owner() {
        let process = fact(20, 1000, 7);
        let mut lost = owner(&[]);
        lost.invalidate();
        assert!(lost.publish_initial(&mut ModelBarrier, deadline()).is_err());
        assert!(lost.ingest(1, &event(process, true, 110)).is_err());
        let mut gap = owner(&[]);
        assert!(matches!(
            gap.ingest(2, &event(process, true, 110)),
            Err(WindowsLifecycleFailure::Protocol)
        ));
        let mut clock = owner(&[]);
        clock.ingest(1, &event(process, true, 110)).unwrap();
        assert!(matches!(
            clock.ingest(2, &event(process, false, 109)),
            Err(WindowsLifecycleFailure::Protocol)
        ));
        let mut scope = owner(&[process]);
        assert!(
            scope
                .ingest(1, &event(fact(20, 1000, 8), true, 110))
                .is_err()
        );
    }

    #[test]
    fn invalid_checkpoint_and_expired_deadline_never_publish() {
        struct WrongCheckpoint;
        impl WindowsCompletePrefixBarrier for WrongCheckpoint {
            fn complete_prefix_after(
                &mut self,
                end: i64,
                sequence: u64,
                _: Instant,
            ) -> Result<WindowsPrefixCheckpoint, WindowsLifecycleFailure> {
                Ok(WindowsPrefixCheckpoint {
                    ingress_sequence: sequence + 1,
                    after_qpc: end + 1,
                })
            }
        }
        let mut wrong = owner(&[]);
        assert!(matches!(
            wrong.publish_initial(&mut WrongCheckpoint, deadline()),
            Err(WindowsLifecycleFailure::MissingBarrier)
        ));
        let mut late = owner(&[]);
        assert!(matches!(
            late.publish_initial(&mut ModelBarrier, Instant::now()),
            Err(WindowsLifecycleFailure::Deadline)
        ));
    }

    #[test]
    fn late_event_before_a_proved_snapshot_boundary_is_rejected() {
        let mut owner = owner(&[]);
        let snapshot = initial(&mut owner);
        assert!(matches!(
            owner.ingest(1, &event(fact(20, 1000, 7), true, snapshot.after_qpc - 1)),
            Err(WindowsLifecycleFailure::Protocol)
        ));
    }

    #[test]
    fn capture_requires_finished_valid_bounded_unique_lifetimes() {
        let candidate = WindowsCandidateSession::from_verified_peer(7, 123).unwrap();
        assert!(WindowsCandidateSession::from_verified_peer(0, 123).is_none());
        assert!(
            WindowsProcessReconciler::new(candidate, WindowsInventoryCapture::begin(100).unwrap())
                .is_err()
        );
        let mut capture = WindowsInventoryCapture::begin(100).unwrap();
        assert!(capture.push(fact(0, 1000, 7)).is_err());
        assert!(capture.push(fact(1, 1000, 7)).is_err());
        assert!(capture.finish(200).is_err());
        let mut capture = WindowsInventoryCapture::begin(100).unwrap();
        assert!(capture.push(fact(1, 0, 7)).is_err());
        let mut capture = WindowsInventoryCapture::begin(100).unwrap();
        capture.push(fact(1, 1000, 7)).unwrap();
        assert!(capture.push(fact(1, 2000, 7)).is_err());
        let mut capture = WindowsInventoryCapture::begin(100).unwrap();
        for pid in 1..=4096 {
            capture.push(fact(pid, 1000, 8)).unwrap();
        }
        assert!(matches!(
            capture.push(fact(4097, 1000, 8)),
            Err(WindowsLifecycleFailure::InventoryOverflow)
        ));
        assert!(capture.finish(200).is_err());
        let mut finished = WindowsInventoryCapture::begin(100)
            .unwrap()
            .finish(200)
            .unwrap();
        assert!(finished.push(fact(4098, 1000, 8)).is_err());
    }

    #[test]
    fn simultaneous_reused_pid_and_oversized_candidate_state_fail_closed() {
        let mut reused = owner(&[fact(20, 1000, 7)]);
        reused
            .ingest(1, &event(fact(20, 2000, 7), true, 110))
            .unwrap();
        assert!(
            reused
                .publish_initial(&mut ModelBarrier, deadline())
                .is_err()
        );
        let facts: Vec<_> = (1..=257).map(|pid| fact(pid, 1000, 7)).collect();
        assert!(matches!(
            WindowsProcessReconciler::new(
                WindowsCandidateSession::from_verified_peer(7, 123).unwrap(),
                capture(&facts)
            ),
            Err(WindowsLifecycleFailure::InventoryOverflow)
        ));
    }
}
