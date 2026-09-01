use std::collections::BTreeMap;
use std::fmt;
use std::marker::PhantomData;
use std::rc::Rc;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex, TryLockError, mpsc};
use std::thread::{self, ThreadId};
use std::time::Instant;

use prctr_native_protocol::{
    MAX_PROTOCOL_SAFE_INTEGER, ProcessApplicationCertainty, ProcessApplicationCoverage,
    ProcessApplicationEvent, ProcessApplicationEventKind, ProcessApplicationProcess,
    ProcessApplicationScope, ProcessApplicationState, ProcessExecutableIdentity,
    ProcessExecutableIdentityStatus, ProtocolValidatable,
};
use prctr_native_source_runtime::{
    ensure_native_source_process_usable, poison_native_source_process,
};

const MAX_RAW_INVENTORY: usize = 4_096;
const MAX_CURRENT_PROCESSES: usize = 256;
const MAX_SESSION_IDENTITIES: usize = 2_048;
const MAX_OBSERVED_PROCESS_KEYS: usize = 4_096;
const MIN_QUEUE_CAPACITY: u16 = 2;
const MAX_QUEUE_CAPACITY: u16 = 1_024;
const INGRESS_TERMINAL_RESERVED: u64 = 1;
const INGRESS_TERMINAL_TAG_MASK: u64 = 0b111;
const INGRESS_TERMINAL_NATIVE_LOSS: u64 = 0b010;
const INGRESS_TERMINAL_QUEUE_OVERFLOW: u64 = 0b011;
const INGRESS_TERMINAL_PERMISSION_LOST: u64 = 0b100;
const INGRESS_TERMINAL_BACKEND: u64 = 0b101;
const INGRESS_TERMINAL_PROTOCOL: u64 = 0b110;

/// Stable native identity for one macOS process lifetime.
///
/// The PID is never sufficient by itself. This key stays inside the native
/// source and is converted to an opaque source-session identifier before a
/// fact can cross the source boundary.
#[derive(Clone, Copy, Eq, Ord, PartialEq, PartialOrd)]
pub struct MacOsProcessKey {
    process_id: i32,
    start_time_seconds: u64,
    start_time_microseconds: u32,
}

impl MacOsProcessKey {
    /// Constructs a validated PID-plus-start-time process key.
    #[must_use]
    pub const fn new(
        process_id: i32,
        start_time_seconds: u64,
        start_time_microseconds: u32,
    ) -> Option<Self> {
        if process_id <= 0
            || (start_time_seconds == 0 && start_time_microseconds == 0)
            || start_time_microseconds >= 1_000_000
        {
            None
        } else {
            Some(Self {
                process_id,
                start_time_seconds,
                start_time_microseconds,
            })
        }
    }
}

/// Audit-session identity derived by a future authenticated macOS transport.
///
/// This value is deliberately absent from the helper wire. A caller may create
/// it only after verifying the local peer and reading that peer's audit token.
#[derive(Clone, Copy, Eq, PartialEq)]
pub struct MacOsCandidateAuditSession {
    audit_session_id: u32,
    audit_user_id: u32,
}

impl MacOsCandidateAuditSession {
    /// Constructs local candidate context from an already verified peer audit token.
    #[must_use]
    pub const fn from_verified_peer(audit_session_id: u32, audit_user_id: u32) -> Option<Self> {
        if audit_session_id == 0 || audit_session_id == u32::MAX || audit_user_id == u32::MAX {
            None
        } else {
            Some(Self {
                audit_session_id,
                audit_user_id,
            })
        }
    }
}

/// Bounded account classification supplied by the future native adapter.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum MacOsProcessAccountClass {
    Human,
    SystemOrService,
    Unknown,
}

/// Owned, content-free process fact copied out of a native callback or inventory.
#[derive(Clone, Copy, Eq, PartialEq)]
pub struct MacOsProcessFact {
    key: MacOsProcessKey,
    execution_generation: u32,
    audit_session_id: u32,
    audit_user_id: u32,
    account_class: MacOsProcessAccountClass,
}

impl MacOsProcessFact {
    /// Constructs one bounded process fact without paths, arguments, or environment data.
    #[must_use]
    pub const fn new(
        key: MacOsProcessKey,
        execution_generation: u32,
        audit_session_id: u32,
        audit_user_id: u32,
        account_class: MacOsProcessAccountClass,
    ) -> Self {
        Self {
            key,
            execution_generation,
            audit_session_id,
            audit_user_id,
            account_class,
        }
    }

    const fn belongs_to(self, candidate: MacOsCandidateAuditSession) -> bool {
        matches!(self.account_class, MacOsProcessAccountClass::Human)
            && self.matches_candidate_identity(candidate)
    }

    const fn has_ambiguous_candidate_scope(self, candidate: MacOsCandidateAuditSession) -> bool {
        matches!(self.account_class, MacOsProcessAccountClass::Unknown)
            && self.matches_candidate_identity(candidate)
    }

    const fn matches_candidate_identity(self, candidate: MacOsCandidateAuditSession) -> bool {
        self.audit_session_id == candidate.audit_session_id
            && self.audit_user_id == candidate.audit_user_id
    }
}

/// One bounded result from asynchronous executable-identity resolution.
#[derive(Clone, Eq, PartialEq)]
pub struct MacOsIdentityResolution {
    key: MacOsProcessKey,
    execution_generation: u32,
    identity: ProcessExecutableIdentity,
}

impl MacOsIdentityResolution {
    /// Binds a resolved identity to the exact process lifetime and exec generation.
    ///
    /// # Errors
    ///
    /// Returns protocol failure before queueing an invalid or still-pending identity.
    pub fn new(
        key: MacOsProcessKey,
        execution_generation: u32,
        identity: ProcessExecutableIdentity,
    ) -> Result<Self, MacOsLifecycleFailure> {
        identity
            .validate_protocol()
            .map_err(|_error| MacOsLifecycleFailure::Protocol)?;
        if !is_macos_identity_shape(&identity) {
            return Err(MacOsLifecycleFailure::Protocol);
        }
        Ok(Self {
            key,
            execution_generation,
            identity,
        })
    }
}

fn is_macos_identity_shape(identity: &ProcessExecutableIdentity) -> bool {
    match identity.status {
        ProcessExecutableIdentityStatus::Pending => false,
        ProcessExecutableIdentityStatus::Unavailable
        | ProcessExecutableIdentityStatus::Unsigned => true,
        ProcessExecutableIdentityStatus::Verified => {
            identity.signing_id.is_some()
                && identity.team_id.is_some()
                && identity.designated_requirement.is_some()
                && identity.bundle_id.is_some()
                && identity.version.is_some()
                && identity.signer_chain_id.is_none()
                && identity.publisher_id.is_none()
                && identity.product_id.is_none()
                && identity.package_id.is_none()
        }
    }
}

/// Owned inputs accepted by the FFI-free macOS lifecycle core.
#[derive(Clone, Eq, PartialEq)]
pub enum MacOsLifecycleInput {
    Fork(MacOsProcessFact),
    Exec(MacOsProcessFact),
    Exit(MacOsProcessFact),
    IdentityResolved(Box<MacOsIdentityResolution>),
    NativeEventLoss(u64),
    PermissionLost,
    BackendInvalidated,
}

/// Terminal failure categories preserved before helper-protocol translation.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum MacOsLifecycleFailure {
    NativeEventLoss(u64),
    QueueOverflow(u64),
    PermissionLost,
    InventoryOverflow,
    Backend,
    Cleanup,
    Protocol,
}

impl fmt::Display for MacOsLifecycleFailure {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::NativeEventLoss(_) => {
                formatter.write_str("macOS native process events were lost")
            }
            Self::QueueOverflow(_) => {
                formatter.write_str("macOS process callback queue overflowed")
            }
            Self::PermissionLost => {
                formatter.write_str("macOS process lifecycle permission was lost")
            }
            Self::InventoryOverflow => {
                formatter.write_str("macOS process inventory exceeded its bound")
            }
            Self::Backend => formatter.write_str("macOS process lifecycle backend failed"),
            Self::Cleanup => formatter.write_str("macOS process lifecycle cleanup failed"),
            Self::Protocol => formatter.write_str("macOS process lifecycle fact was incoherent"),
        }
    }
}

impl std::error::Error for MacOsLifecycleFailure {}

/// Shared process-local origin for lifecycle event timestamps.
///
/// The helper bridge captures this before opening the native source and gives
/// the same opaque origin to the lifecycle core. That keeps bootstrap work and
/// callback timestamps in one clock domain without exposing a wall clock.
#[derive(Clone)]
pub struct MacOsLifecycleTimeOrigin {
    instant: Instant,
}

impl MacOsLifecycleTimeOrigin {
    /// Captures a fresh process-local monotonic origin.
    #[must_use]
    pub fn capture() -> Self {
        Self {
            instant: Instant::now(),
        }
    }

    /// Returns bounded nanoseconds elapsed since this origin.
    #[must_use]
    pub fn elapsed_ns(&self) -> u64 {
        u64::try_from(self.instant.elapsed().as_nanos())
            .unwrap_or(MAX_PROTOCOL_SAFE_INTEGER)
            .min(MAX_PROTOCOL_SAFE_INTEGER)
    }
}

struct IngressStatus {
    origin: MacOsLifecycleTimeOrigin,
    accepting: AtomicBool,
    next_sequence: Mutex<u64>,
    committed_sequence: AtomicU64,
    live_sinks: AtomicU64,
    terminal_word: AtomicU64,
    terminal_monotonic_time_ns: AtomicU64,
}

#[derive(Clone)]
struct TimedLifecycleFailure {
    failure: MacOsLifecycleFailure,
    monotonic_time_ns: u64,
    ingress_boundary_sequence: Option<u64>,
}

impl IngressStatus {
    fn new(origin: MacOsLifecycleTimeOrigin) -> Self {
        Self {
            origin,
            accepting: AtomicBool::new(true),
            next_sequence: Mutex::new(0),
            committed_sequence: AtomicU64::new(0),
            live_sinks: AtomicU64::new(1),
            terminal_word: AtomicU64::new(0),
            terminal_monotonic_time_ns: AtomicU64::new(0),
        }
    }

    fn monotonic_time_ns(&self) -> u64 {
        self.origin.elapsed_ns()
    }

    fn latch_terminal(&self, failure: MacOsLifecycleFailure) {
        let terminal_word = encode_ingress_terminal(&failure);
        self.accepting.store(false, Ordering::Release);
        if self
            .terminal_word
            .compare_exchange(
                0,
                INGRESS_TERMINAL_RESERVED,
                Ordering::AcqRel,
                Ordering::Acquire,
            )
            .is_ok()
        {
            self.terminal_monotonic_time_ns
                .store(self.monotonic_time_ns(), Ordering::Relaxed);
            self.terminal_word.store(terminal_word, Ordering::Release);
        }
    }

    fn terminal(&self) -> Option<TimedLifecycleFailure> {
        let mut word = self.terminal_word.load(Ordering::Acquire);
        if word == 0 {
            return None;
        }
        let boundary_sequence = match self.next_sequence.lock() {
            Ok(_next_sequence) => self.committed_sequence.load(Ordering::Acquire),
            Err(_poisoned) => {
                return Some(TimedLifecycleFailure {
                    failure: MacOsLifecycleFailure::Protocol,
                    monotonic_time_ns: self.monotonic_time_ns(),
                    ingress_boundary_sequence: Some(
                        self.committed_sequence.load(Ordering::Acquire),
                    ),
                });
            }
        };
        word = self.terminal_word.load(Ordering::Acquire);
        while word == INGRESS_TERMINAL_RESERVED {
            std::hint::spin_loop();
            word = self.terminal_word.load(Ordering::Acquire);
        }
        (word != 0).then(|| TimedLifecycleFailure {
            failure: decode_ingress_terminal(word),
            monotonic_time_ns: self.terminal_monotonic_time_ns.load(Ordering::Acquire),
            ingress_boundary_sequence: Some(boundary_sequence),
        })
    }
}

fn encode_ingress_terminal(failure: &MacOsLifecycleFailure) -> u64 {
    match failure {
        MacOsLifecycleFailure::NativeEventLoss(count)
            if (1..=MAX_PROTOCOL_SAFE_INTEGER).contains(count) =>
        {
            (*count << 3) | INGRESS_TERMINAL_NATIVE_LOSS
        }
        MacOsLifecycleFailure::QueueOverflow(count)
            if (1..=MAX_PROTOCOL_SAFE_INTEGER).contains(count) =>
        {
            (*count << 3) | INGRESS_TERMINAL_QUEUE_OVERFLOW
        }
        MacOsLifecycleFailure::PermissionLost => INGRESS_TERMINAL_PERMISSION_LOST,
        MacOsLifecycleFailure::Backend => INGRESS_TERMINAL_BACKEND,
        MacOsLifecycleFailure::NativeEventLoss(_)
        | MacOsLifecycleFailure::QueueOverflow(_)
        | MacOsLifecycleFailure::InventoryOverflow
        | MacOsLifecycleFailure::Cleanup
        | MacOsLifecycleFailure::Protocol => INGRESS_TERMINAL_PROTOCOL,
    }
}

fn decode_ingress_terminal(word: u64) -> MacOsLifecycleFailure {
    let count = word >> 3;
    match word & INGRESS_TERMINAL_TAG_MASK {
        INGRESS_TERMINAL_NATIVE_LOSS => MacOsLifecycleFailure::NativeEventLoss(count),
        INGRESS_TERMINAL_QUEUE_OVERFLOW => MacOsLifecycleFailure::QueueOverflow(count),
        INGRESS_TERMINAL_PERMISSION_LOST => MacOsLifecycleFailure::PermissionLost,
        INGRESS_TERMINAL_BACKEND => MacOsLifecycleFailure::Backend,
        _ => MacOsLifecycleFailure::Protocol,
    }
}

struct IngressEnvelope {
    sequence: u64,
    monotonic_time_ns: u64,
    input: MacOsLifecycleInput,
}

/// Cloneable, nonblocking callback ingress for the future native feed.
pub struct MacOsLifecycleSink {
    sender: mpsc::SyncSender<IngressEnvelope>,
    status: Arc<IngressStatus>,
}

impl Clone for MacOsLifecycleSink {
    fn clone(&self) -> Self {
        if self
            .status
            .live_sinks
            .fetch_update(Ordering::AcqRel, Ordering::Acquire, |count| {
                count.checked_add(1)
            })
            .is_err()
        {
            self.status.latch_terminal(MacOsLifecycleFailure::Protocol);
        }
        Self {
            sender: self.sender.clone(),
            status: Arc::clone(&self.status),
        }
    }
}

impl Drop for MacOsLifecycleSink {
    fn drop(&mut self) {
        if self
            .status
            .live_sinks
            .fetch_update(Ordering::AcqRel, Ordering::Acquire, |count| {
                count.checked_sub(1)
            })
            .is_err()
        {
            self.status.latch_terminal(MacOsLifecycleFailure::Protocol);
        }
    }
}

impl MacOsLifecycleSink {
    /// Attempts to enqueue one bounded fact without waiting.
    ///
    /// A full queue records exact local loss out-of-band so terminal failure
    /// remains observable even when no queue slot is available.
    pub fn submit(&self, input: MacOsLifecycleInput) {
        submit_ingress(&self.sender, &self.status, input);
    }

    #[cfg(test)]
    fn test_probe(&self) -> MacOsLifecycleSinkProbe {
        MacOsLifecycleSinkProbe {
            sender: self.sender.clone(),
            status: Arc::clone(&self.status),
        }
    }

    /// Captures the committed sequence and source time under the same ingress
    /// serialization boundary used by accepted callback facts.
    ///
    /// # Errors
    ///
    /// Returns protocol failure when the ingress serialization state is poisoned.
    pub fn checkpoint(&self) -> Result<MacOsLifecycleCheckpoint, MacOsLifecycleFailure> {
        let _next_sequence = self
            .status
            .next_sequence
            .lock()
            .map_err(|_poisoned| MacOsLifecycleFailure::Protocol)?;
        Ok(MacOsLifecycleCheckpoint {
            sequence: self.status.committed_sequence.load(Ordering::Acquire),
            monotonic_time_ns: self.status.monotonic_time_ns(),
        })
    }
}

fn submit_ingress(
    sender: &mpsc::SyncSender<IngressEnvelope>,
    status: &IngressStatus,
    input: MacOsLifecycleInput,
) {
    if !status.accepting.load(Ordering::Acquire) {
        return;
    }
    match input {
        MacOsLifecycleInput::NativeEventLoss(count) => {
            status.latch_terminal(MacOsLifecycleFailure::NativeEventLoss(count));
            return;
        }
        MacOsLifecycleInput::PermissionLost => {
            status.latch_terminal(MacOsLifecycleFailure::PermissionLost);
            return;
        }
        MacOsLifecycleInput::BackendInvalidated => {
            status.latch_terminal(MacOsLifecycleFailure::Backend);
            return;
        }
        MacOsLifecycleInput::Fork(_)
        | MacOsLifecycleInput::Exec(_)
        | MacOsLifecycleInput::Exit(_)
        | MacOsLifecycleInput::IdentityResolved(_) => {}
    }
    let mut next_sequence = match status.next_sequence.try_lock() {
        Ok(next_sequence) => next_sequence,
        Err(TryLockError::WouldBlock) => {
            status.latch_terminal(MacOsLifecycleFailure::QueueOverflow(1));
            return;
        }
        Err(TryLockError::Poisoned(_)) => {
            status.latch_terminal(MacOsLifecycleFailure::Protocol);
            return;
        }
    };
    if !status.accepting.load(Ordering::Acquire) {
        return;
    }
    let Some(sequence) = next_sequence
        .checked_add(1)
        .filter(|sequence| *sequence <= MAX_PROTOCOL_SAFE_INTEGER)
    else {
        status.latch_terminal(MacOsLifecycleFailure::Protocol);
        return;
    };
    let envelope = IngressEnvelope {
        sequence,
        monotonic_time_ns: status.monotonic_time_ns(),
        input,
    };
    match sender.try_send(envelope) {
        Ok(()) => {
            *next_sequence = sequence;
            status.committed_sequence.store(sequence, Ordering::Release);
        }
        Err(mpsc::TrySendError::Full(_)) => {
            status.latch_terminal(MacOsLifecycleFailure::QueueOverflow(1));
        }
        Err(mpsc::TrySendError::Disconnected(_)) => {
            if status.accepting.load(Ordering::Acquire) {
                status.latch_terminal(MacOsLifecycleFailure::Backend);
            }
        }
    }
}

#[cfg(test)]
#[derive(Clone)]
struct MacOsLifecycleSinkProbe {
    sender: mpsc::SyncSender<IngressEnvelope>,
    status: Arc<IngressStatus>,
}

#[cfg(test)]
impl MacOsLifecycleSinkProbe {
    fn submit(&self, input: MacOsLifecycleInput) {
        submit_ingress(&self.sender, &self.status, input);
    }
}

/// Subscription owned by the same thread that opens the lifecycle core.
pub trait MacOsLifecycleSubscription {
    /// Establishes a callback-serialization barrier and returns its source checkpoint.
    ///
    /// # Errors
    ///
    /// Returns a bounded backend failure when the callback boundary cannot be proven.
    fn bootstrap_barrier(&mut self) -> Result<MacOsLifecycleCheckpoint, MacOsLifecycleFailure>;

    /// Fences and removes native callback intake and any identity-completion
    /// workers on the opening thread. Accepted identity work is resolved before
    /// this returns, or stop fails cleanup. No producer may retain a live sink
    /// when this method returns successfully.
    ///
    /// # Errors
    ///
    /// Returns cleanup failure when callback removal cannot be proved.
    fn stop(self) -> Result<(), MacOsLifecycleFailure>;
}

/// One sequence-and-time checkpoint captured in the serialized callback domain.
#[derive(Clone, Copy, Eq, PartialEq)]
pub struct MacOsLifecycleCheckpoint {
    sequence: u64,
    monotonic_time_ns: u64,
}

/// Starts notification delivery before any authoritative inventory query.
pub trait MacOsLifecycleEventFeed {
    type Subscription: MacOsLifecycleSubscription;

    /// Starts one serialized, bounded mechanical event feed. For each stable
    /// process key, the feed submits exactly one final identity resolution for
    /// the current generation before the next exec or exit. This also applies
    /// to inventory-originated pending processes. A resolver failure or
    /// deadline is reported as an operational terminal instead of releasing a
    /// later generation out of order.
    ///
    /// # Errors
    ///
    /// Returns a bounded backend or permission-related category when observation cannot start.
    /// An error also proves that no callback, worker, or other producer retains
    /// the supplied sink; an implementation that cannot prove that cleanup must
    /// return [`MacOsLifecycleFailure::Cleanup`].
    fn start(self, sink: MacOsLifecycleSink) -> Result<Self::Subscription, MacOsLifecycleFailure>;
}

/// Supplies one bounded process inventory after notification delivery starts.
pub trait MacOsProcessInventory {
    /// Pushes owned content-free process facts into the bounded collector.
    ///
    /// # Errors
    ///
    /// Returns a bounded backend or inventory category when a complete query is unavailable.
    fn snapshot(
        &mut self,
        collector: &mut MacOsProcessInventoryCollector,
    ) -> Result<(), MacOsLifecycleFailure>;
}

/// Core-owned bounded inventory collector. Platform enumeration never returns
/// an unbounded allocation across the lifecycle boundary.
pub struct MacOsProcessInventoryCollector {
    facts: Vec<MacOsProcessFact>,
}

impl MacOsProcessInventoryCollector {
    fn new() -> Self {
        Self { facts: Vec::new() }
    }

    /// Adds one fact while enforcing the raw inventory bound.
    ///
    /// # Errors
    ///
    /// Returns inventory overflow before retaining a fact beyond the bound.
    pub fn push(&mut self, fact: MacOsProcessFact) -> Result<(), MacOsLifecycleFailure> {
        if self.facts.len() >= MAX_RAW_INVENTORY {
            return Err(MacOsLifecycleFailure::InventoryOverflow);
        }
        self.facts.push(fact);
        Ok(())
    }

    fn finish(self) -> Vec<MacOsProcessFact> {
        self.facts
    }
}

/// One source-timestamped normalized process event.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct MacOsLifecycleEvent {
    pub monotonic_time_ns: u64,
    pub event: ProcessApplicationEvent,
}

/// One terminal lifecycle outcome with its source-monotonic occurrence time.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct MacOsLifecycleTerminal {
    failure: MacOsLifecycleFailure,
    monotonic_time_ns: u64,
}

impl MacOsLifecycleTerminal {
    /// Returns the bounded terminal failure category.
    #[must_use]
    pub const fn failure(&self) -> MacOsLifecycleFailure {
        self.failure
    }

    /// Returns the source-monotonic time at which the terminal outcome occurred.
    #[must_use]
    pub const fn monotonic_time_ns(&self) -> u64 {
        self.monotonic_time_ns
    }
}

/// One ordered poll result from the lifecycle core.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct MacOsLifecycleDrain {
    pub events: Vec<MacOsLifecycleEvent>,
    pub terminal: Option<MacOsLifecycleTerminal>,
}

/// Ordered close tail plus the final frame-independent mechanical state.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct MacOsLifecycleClose {
    pub drain: MacOsLifecycleDrain,
    pub final_state: ProcessApplicationState,
}

struct TrackedProcess {
    process_instance_id: String,
    execution_generation: u32,
    identity: ProcessExecutableIdentity,
}

impl TrackedProcess {
    fn protocol_process(&self) -> ProcessApplicationProcess {
        ProcessApplicationProcess {
            process_instance_id: self.process_instance_id.clone(),
            scope: ProcessApplicationScope::CandidateInteractiveSession,
            identity: self.identity.clone(),
        }
    }
}

#[derive(Default)]
struct ProcessIdentityMap {
    next_identity: u64,
    identities: BTreeMap<MacOsProcessKey, String>,
}

impl ProcessIdentityMap {
    fn identity_for(&mut self, key: MacOsProcessKey) -> Result<String, MacOsLifecycleFailure> {
        if self.identities.contains_key(&key) {
            return Err(MacOsLifecycleFailure::Protocol);
        }
        if self.identities.len() >= MAX_SESSION_IDENTITIES {
            return Err(MacOsLifecycleFailure::InventoryOverflow);
        }
        self.next_identity = self
            .next_identity
            .checked_add(1)
            .ok_or(MacOsLifecycleFailure::InventoryOverflow)?;
        let identity = format!("process-instance-{:016x}", self.next_identity);
        self.identities.insert(key, identity.clone());
        Ok(identity)
    }
}

#[derive(Clone, Copy, Eq, PartialEq)]
struct ProcessScope {
    audit_session_id: u32,
    audit_user_id: u32,
    account_class: MacOsProcessAccountClass,
}

#[derive(Clone, Copy)]
struct ObservedProcess {
    scope: ProcessScope,
    execution_generation: u32,
    retired: bool,
}

#[derive(Default)]
struct ProcessScopeHistory {
    processes: BTreeMap<MacOsProcessKey, ObservedProcess>,
}

impl ProcessScopeHistory {
    fn observe_inventory(&mut self, fact: MacOsProcessFact) -> Result<(), MacOsLifecycleFailure> {
        let observed = observed_process(fact, false);
        match self.processes.get(&fact.key) {
            Some(existing)
                if existing.scope == observed.scope
                    && existing.execution_generation == observed.execution_generation
                    && !existing.retired =>
            {
                Ok(())
            }
            Some(_) => Err(MacOsLifecycleFailure::Protocol),
            None => self.insert(fact.key, observed),
        }
    }

    fn observe_fork(
        &mut self,
        fact: MacOsProcessFact,
        bootstrap: bool,
    ) -> Result<(), MacOsLifecycleFailure> {
        let observed = observed_process(fact, false);
        match self.processes.get(&fact.key) {
            Some(existing)
                if bootstrap
                    && existing.scope == observed.scope
                    && existing.execution_generation == observed.execution_generation
                    && !existing.retired =>
            {
                Ok(())
            }
            Some(_) => Err(MacOsLifecycleFailure::Protocol),
            None => self.insert(fact.key, observed),
        }
    }

    fn observe_exec(
        &mut self,
        fact: MacOsProcessFact,
        bootstrap: bool,
    ) -> Result<(), MacOsLifecycleFailure> {
        let scope = process_scope(fact);
        let Some(existing) = self.processes.get_mut(&fact.key) else {
            return self.insert(fact.key, observed_process(fact, false));
        };
        if existing.scope != scope || existing.retired {
            return Err(MacOsLifecycleFailure::Protocol);
        }
        if bootstrap && existing.execution_generation == fact.execution_generation {
            return Ok(());
        }
        if existing.execution_generation.checked_add(1) != Some(fact.execution_generation) {
            return Err(MacOsLifecycleFailure::Backend);
        }
        existing.execution_generation = fact.execution_generation;
        Ok(())
    }

    fn observe_exit(&mut self, fact: MacOsProcessFact) -> Result<(), MacOsLifecycleFailure> {
        let scope = process_scope(fact);
        let Some(existing) = self.processes.get_mut(&fact.key) else {
            return self.insert(fact.key, observed_process(fact, true));
        };
        if existing.scope != scope
            || existing.execution_generation != fact.execution_generation
            || existing.retired
        {
            return Err(MacOsLifecycleFailure::Protocol);
        }
        existing.retired = true;
        Ok(())
    }

    fn insert(
        &mut self,
        key: MacOsProcessKey,
        observed: ObservedProcess,
    ) -> Result<(), MacOsLifecycleFailure> {
        if self.processes.len() >= MAX_OBSERVED_PROCESS_KEYS {
            return Err(MacOsLifecycleFailure::InventoryOverflow);
        }
        self.processes.insert(key, observed);
        Ok(())
    }
}

const fn process_scope(fact: MacOsProcessFact) -> ProcessScope {
    ProcessScope {
        audit_session_id: fact.audit_session_id,
        audit_user_id: fact.audit_user_id,
        account_class: fact.account_class,
    }
}

const fn observed_process(fact: MacOsProcessFact, retired: bool) -> ObservedProcess {
    ObservedProcess {
        scope: process_scope(fact),
        execution_generation: fact.execution_generation,
        retired,
    }
}

struct ProcessLifecycleModel {
    candidate: MacOsCandidateAuditSession,
    active: BTreeMap<MacOsProcessKey, TrackedProcess>,
    identities: ProcessIdentityMap,
    scope_history: ProcessScopeHistory,
}

/// FFI-free state machine for a future entitled macOS lifecycle feed.
///
/// Constructing this type proves only the in-memory lifecycle contract. The
/// existing production macOS adapter remains snapshot-only, and no platform
/// capability claim follows from this core.
pub struct MacOsProcessLifecycle<S: MacOsLifecycleSubscription> {
    receiver: mpsc::Receiver<IngressEnvelope>,
    status: Arc<IngressStatus>,
    subscription: Option<S>,
    model: ProcessLifecycleModel,
    drain_limit: usize,
    initial_monotonic_time_ns: u64,
    last_ingress_sequence: u64,
    terminal: Option<TimedLifecycleFailure>,
    pending_ingress_terminal: Option<TimedLifecycleFailure>,
    terminal_emitted: bool,
    close_state: LifecycleCloseState,
    owner_thread: ThreadId,
    not_send: PhantomData<Rc<()>>,
}

#[derive(Clone, Copy, Eq, PartialEq)]
enum LifecycleCloseState {
    Open,
    Fenced,
    Closed,
    CleanupFailed,
}

impl<S: MacOsLifecycleSubscription> MacOsProcessLifecycle<S> {
    /// Opens a feed-before-inventory lifecycle session with a race-free snapshot boundary.
    ///
    /// # Errors
    ///
    /// Returns a precise backend, overflow, loss, protocol, or cleanup category.
    pub fn open<F, I>(
        candidate: MacOsCandidateAuditSession,
        queue_capacity: u16,
        feed: F,
        inventory: I,
    ) -> Result<(ProcessApplicationState, Self), MacOsLifecycleFailure>
    where
        F: MacOsLifecycleEventFeed<Subscription = S>,
        I: MacOsProcessInventory,
    {
        Self::open_with_time_origin(
            candidate,
            queue_capacity,
            MacOsLifecycleTimeOrigin::capture(),
            feed,
            inventory,
        )
    }

    /// Opens a lifecycle session against a previously captured shared origin.
    ///
    /// The helper bridge uses this entrypoint so time spent establishing the
    /// native source remains represented in later event timestamps.
    ///
    /// # Errors
    ///
    /// Returns a precise backend, overflow, loss, protocol, or cleanup category.
    pub fn open_with_time_origin<F, I>(
        candidate: MacOsCandidateAuditSession,
        queue_capacity: u16,
        time_origin: MacOsLifecycleTimeOrigin,
        feed: F,
        mut inventory: I,
    ) -> Result<(ProcessApplicationState, Self), MacOsLifecycleFailure>
    where
        F: MacOsLifecycleEventFeed<Subscription = S>,
        I: MacOsProcessInventory,
    {
        ensure_native_source_process_usable().map_err(|_error| MacOsLifecycleFailure::Cleanup)?;
        if !(MIN_QUEUE_CAPACITY..=MAX_QUEUE_CAPACITY).contains(&queue_capacity) {
            return Err(MacOsLifecycleFailure::Protocol);
        }
        let (sender, receiver) = mpsc::sync_channel(usize::from(queue_capacity));
        let status = Arc::new(IngressStatus::new(time_origin));
        let sink = MacOsLifecycleSink {
            sender,
            status: Arc::clone(&status),
        };
        let mut subscription = match feed.start(sink) {
            Ok(subscription) => subscription,
            Err(error) => {
                status.accepting.store(false, Ordering::Release);
                if error == MacOsLifecycleFailure::Cleanup
                    || status.live_sinks.load(Ordering::Acquire) != 0
                {
                    poison_native_source_process();
                    return Err(MacOsLifecycleFailure::Cleanup);
                }
                return Err(error);
            }
        };
        let mut collector = MacOsProcessInventoryCollector::new();
        let inventory = match inventory.snapshot(&mut collector) {
            Ok(()) => collector.finish(),
            Err(error) => return Err(rollback_open(subscription, &status, error)),
        };
        let bootstrap =
            match prepare_bootstrap(candidate, inventory, &receiver, &status, &mut subscription) {
                Ok(bootstrap) => bootstrap,
                Err(error) => return Err(rollback_open(subscription, &status, error)),
            };
        let initial_state = match bootstrap.model.state() {
            Ok(state) => state,
            Err(error) => return Err(rollback_open(subscription, &status, error)),
        };
        if ensure_native_source_process_usable().is_err() {
            return Err(rollback_open(
                subscription,
                &status,
                MacOsLifecycleFailure::Cleanup,
            ));
        }
        Ok((
            initial_state,
            Self {
                receiver,
                status,
                subscription: Some(subscription),
                model: bootstrap.model,
                drain_limit: usize::from(queue_capacity),
                initial_monotonic_time_ns: bootstrap.snapshot_monotonic_time_ns,
                last_ingress_sequence: bootstrap.last_ingress_sequence,
                terminal: None,
                pending_ingress_terminal: None,
                terminal_emitted: false,
                close_state: LifecycleCloseState::Open,
                owner_thread: thread::current().id(),
                not_send: PhantomData,
            },
        ))
    }

    /// Drains the currently accepted ordered transitions without blocking.
    #[must_use]
    pub fn drain(&mut self) -> MacOsLifecycleDrain {
        self.drain_internal()
    }

    /// Returns the source checkpoint represented by snapshot zero.
    #[must_use]
    pub const fn initial_monotonic_time_ns(&self) -> u64 {
        self.initial_monotonic_time_ns
    }

    /// Fences intake, stops the feed on its opening thread, and returns the close tail.
    ///
    /// # Errors
    ///
    /// Returns cleanup failure when the callback boundary cannot be established.
    pub fn close(&mut self) -> Result<MacOsLifecycleClose, MacOsLifecycleFailure> {
        match self.close_state {
            LifecycleCloseState::CleanupFailed | LifecycleCloseState::Fenced => {
                return Err(MacOsLifecycleFailure::Cleanup);
            }
            LifecycleCloseState::Closed => {
                return Ok(MacOsLifecycleClose {
                    drain: MacOsLifecycleDrain {
                        events: Vec::new(),
                        terminal: None,
                    },
                    final_state: self.final_state()?,
                });
            }
            LifecycleCloseState::Open => {}
        }
        if thread::current().id() != self.owner_thread {
            return Err(MacOsLifecycleFailure::Cleanup);
        }
        if self.status.live_sinks.load(Ordering::Acquire) == 0 {
            self.status.latch_terminal(MacOsLifecycleFailure::Backend);
        }
        let stopped = match self.subscription.take() {
            Some(subscription) => subscription.stop().is_ok(),
            None => false,
        };
        if !stopped || self.status.live_sinks.load(Ordering::Acquire) != 0 {
            self.status.accepting.store(false, Ordering::Release);
            self.close_state = LifecycleCloseState::CleanupFailed;
            poison_native_source_process();
            return Err(MacOsLifecycleFailure::Cleanup);
        }
        self.status.accepting.store(false, Ordering::Release);
        self.close_state = LifecycleCloseState::Fenced;
        let mut drain = self.drain_internal();
        if self.terminal.is_none() && self.model.has_pending_identity() {
            self.set_terminal(
                MacOsLifecycleFailure::Backend,
                self.status.monotonic_time_ns(),
            );
            let terminal_drain = self.drain_internal();
            drain.events.extend(terminal_drain.events);
            drain.terminal = terminal_drain.terminal;
        }
        self.close_state = LifecycleCloseState::Closed;
        Ok(MacOsLifecycleClose {
            drain,
            final_state: self.final_state()?,
        })
    }

    fn drain_internal(&mut self) -> MacOsLifecycleDrain {
        let mut events = Vec::new();
        if self.terminal.is_none() {
            let mut ingress_terminal = self
                .pending_ingress_terminal
                .take()
                .or_else(|| self.status.terminal());
            let ingress_boundary = ingress_terminal
                .as_ref()
                .and_then(|terminal| terminal.ingress_boundary_sequence);
            for _ in 0..self.drain_limit {
                if ingress_boundary == Some(self.last_ingress_sequence) {
                    break;
                }
                let envelope = match self.receiver.try_recv() {
                    Ok(envelope) => Some(envelope),
                    Err(mpsc::TryRecvError::Empty) => None,
                    Err(mpsc::TryRecvError::Disconnected) => {
                        if ingress_terminal.is_none() {
                            ingress_terminal = self.status.terminal();
                        }
                        if self.close_state == LifecycleCloseState::Open
                            && ingress_terminal.is_none()
                        {
                            self.set_terminal(
                                MacOsLifecycleFailure::Backend,
                                self.status.monotonic_time_ns(),
                            );
                        }
                        None
                    }
                };
                let Some(envelope) = envelope else {
                    break;
                };
                let Some(expected) = self.last_ingress_sequence.checked_add(1) else {
                    self.set_terminal(MacOsLifecycleFailure::Protocol, envelope.monotonic_time_ns);
                    break;
                };
                if envelope.sequence != expected {
                    self.set_terminal(MacOsLifecycleFailure::Protocol, envelope.monotonic_time_ns);
                    break;
                }
                self.last_ingress_sequence = envelope.sequence;
                match self.model.apply_live_input(envelope.input) {
                    Ok(Some(event)) => events.push(MacOsLifecycleEvent {
                        monotonic_time_ns: envelope.monotonic_time_ns,
                        event,
                    }),
                    Ok(None) => {}
                    Err(error) => {
                        self.set_terminal(error, envelope.monotonic_time_ns);
                        break;
                    }
                }
            }
            if self.terminal.is_none() {
                if let Some(mut terminal) = ingress_terminal {
                    if terminal.ingress_boundary_sequence == Some(self.last_ingress_sequence) {
                        if let Some(last_event) = events.last() {
                            terminal.monotonic_time_ns =
                                terminal.monotonic_time_ns.max(last_event.monotonic_time_ns);
                        }
                        self.terminal = Some(terminal);
                    } else {
                        self.set_terminal(
                            MacOsLifecycleFailure::Protocol,
                            terminal.monotonic_time_ns,
                        );
                    }
                } else if let Some(mut terminal) = self.status.terminal() {
                    // The terminal raced this poll. Its serialized accepted
                    // tail is drained before the terminal is emitted next time.
                    if let Some(last_event) = events.last() {
                        terminal.monotonic_time_ns =
                            terminal.monotonic_time_ns.max(last_event.monotonic_time_ns);
                    }
                    self.pending_ingress_terminal = Some(terminal);
                }
            }
        }
        let terminal = if self.terminal_emitted {
            None
        } else {
            self.terminal_emitted = self.terminal.is_some();
            self.terminal.clone()
        };
        MacOsLifecycleDrain {
            events,
            terminal: terminal.map(|terminal| MacOsLifecycleTerminal {
                failure: terminal.failure,
                monotonic_time_ns: terminal.monotonic_time_ns,
            }),
        }
    }

    fn set_terminal(&mut self, failure: MacOsLifecycleFailure, monotonic_time_ns: u64) {
        self.status.accepting.store(false, Ordering::Release);
        self.terminal.get_or_insert(TimedLifecycleFailure {
            failure,
            monotonic_time_ns,
            ingress_boundary_sequence: None,
        });
    }

    fn final_state(&self) -> Result<ProcessApplicationState, MacOsLifecycleFailure> {
        let mut state = self.model.state()?;
        if self.terminal.is_some()
            || self.pending_ingress_terminal.is_some()
            || self.status.terminal().is_some()
        {
            state.certainty = ProcessApplicationCertainty::Partial;
        }
        state
            .validate()
            .map_err(|_error| MacOsLifecycleFailure::Protocol)?;
        Ok(state)
    }
}

impl<S: MacOsLifecycleSubscription> Drop for MacOsProcessLifecycle<S> {
    fn drop(&mut self) {
        let stopped = match self.subscription.take() {
            Some(subscription) => subscription.stop().is_ok(),
            None => true,
        };
        if !stopped || self.status.live_sinks.load(Ordering::Acquire) != 0 {
            poison_native_source_process();
        }
        self.status.accepting.store(false, Ordering::Release);
        if self.close_state == LifecycleCloseState::Open {
            self.close_state = LifecycleCloseState::Fenced;
        }
    }
}

fn rollback_open<S: MacOsLifecycleSubscription>(
    subscription: S,
    status: &IngressStatus,
    primary: MacOsLifecycleFailure,
) -> MacOsLifecycleFailure {
    let stopped = subscription.stop().is_ok();
    status.accepting.store(false, Ordering::Release);
    if stopped
        && status.live_sinks.load(Ordering::Acquire) == 0
        && primary != MacOsLifecycleFailure::Cleanup
    {
        primary
    } else {
        poison_native_source_process();
        MacOsLifecycleFailure::Cleanup
    }
}

struct BootstrapState {
    model: ProcessLifecycleModel,
    last_ingress_sequence: u64,
    snapshot_monotonic_time_ns: u64,
}

fn prepare_bootstrap<S: MacOsLifecycleSubscription>(
    candidate: MacOsCandidateAuditSession,
    inventory: Vec<MacOsProcessFact>,
    receiver: &mpsc::Receiver<IngressEnvelope>,
    status: &IngressStatus,
    subscription: &mut S,
) -> Result<BootstrapState, MacOsLifecycleFailure> {
    let checkpoint = subscription.bootstrap_barrier()?;
    if checkpoint.sequence > status.committed_sequence.load(Ordering::Acquire) {
        return Err(MacOsLifecycleFailure::Backend);
    }
    if status.live_sinks.load(Ordering::Acquire) == 0 {
        return Err(MacOsLifecycleFailure::Backend);
    }
    if let Some(failure) = take_ingress_failure(status) {
        return Err(failure);
    }
    let mut model = ProcessLifecycleModel::new(candidate);
    model.seed_inventory(inventory)?;
    let last_ingress_sequence =
        consume_bootstrap_events(checkpoint.sequence, receiver, &mut model)?;
    if let Some(failure) = take_ingress_failure(status) {
        return Err(failure);
    }
    Ok(BootstrapState {
        model,
        last_ingress_sequence,
        snapshot_monotonic_time_ns: checkpoint.monotonic_time_ns,
    })
}

fn consume_bootstrap_events(
    boundary: u64,
    receiver: &mpsc::Receiver<IngressEnvelope>,
    model: &mut ProcessLifecycleModel,
) -> Result<u64, MacOsLifecycleFailure> {
    let mut last_ingress_sequence = 0_u64;
    while last_ingress_sequence < boundary {
        let Ok(envelope) = receiver.try_recv() else {
            return Err(MacOsLifecycleFailure::Backend);
        };
        let expected = last_ingress_sequence
            .checked_add(1)
            .ok_or(MacOsLifecycleFailure::Protocol)?;
        if envelope.sequence != expected {
            return Err(MacOsLifecycleFailure::QueueOverflow(
                envelope.sequence.saturating_sub(expected).max(1),
            ));
        }
        last_ingress_sequence = envelope.sequence;
        model.apply_bootstrap_input(envelope.input)?;
    }
    if last_ingress_sequence < boundary {
        return Err(MacOsLifecycleFailure::Backend);
    }
    Ok(last_ingress_sequence)
}

fn take_ingress_failure(status: &IngressStatus) -> Option<MacOsLifecycleFailure> {
    status.terminal().map(|terminal| terminal.failure)
}

impl ProcessLifecycleModel {
    fn new(candidate: MacOsCandidateAuditSession) -> Self {
        Self {
            candidate,
            active: BTreeMap::new(),
            identities: ProcessIdentityMap::default(),
            scope_history: ProcessScopeHistory::default(),
        }
    }

    fn seed_inventory(
        &mut self,
        inventory: Vec<MacOsProcessFact>,
    ) -> Result<(), MacOsLifecycleFailure> {
        let candidate = self.candidate;
        for fact in inventory {
            validate_candidate_audit_scope(candidate, fact)?;
            self.scope_history.observe_inventory(fact)?;
            if fact.has_ambiguous_candidate_scope(candidate) {
                return Err(MacOsLifecycleFailure::Backend);
            }
            if !fact.belongs_to(candidate) {
                continue;
            }
            if let Some(existing) = self.active.get(&fact.key) {
                if existing.execution_generation == fact.execution_generation {
                    continue;
                }
                return Err(MacOsLifecycleFailure::Protocol);
            }
            self.insert_process(fact)?;
        }
        Ok(())
    }

    fn apply_bootstrap_input(
        &mut self,
        input: MacOsLifecycleInput,
    ) -> Result<(), MacOsLifecycleFailure> {
        let candidate = self.candidate;
        match input {
            MacOsLifecycleInput::Fork(fact) => {
                validate_candidate_audit_scope(candidate, fact)?;
                self.scope_history.observe_fork(fact, true)?;
                if fact.has_ambiguous_candidate_scope(candidate) {
                    return Err(MacOsLifecycleFailure::Backend);
                }
                if !fact.belongs_to(candidate) {
                    if self.active.contains_key(&fact.key) {
                        return Err(MacOsLifecycleFailure::Protocol);
                    }
                    return Ok(());
                }
                if let Some(existing) = self.active.get_mut(&fact.key) {
                    if fact.execution_generation != existing.execution_generation {
                        return Err(MacOsLifecycleFailure::Protocol);
                    }
                } else {
                    self.insert_process(fact)?;
                }
            }
            MacOsLifecycleInput::Exec(fact) => {
                validate_candidate_audit_scope(candidate, fact)?;
                self.scope_history.observe_exec(fact, true)?;
                if fact.has_ambiguous_candidate_scope(candidate) {
                    return Err(MacOsLifecycleFailure::Backend);
                }
                if !fact.belongs_to(candidate) {
                    if self.active.contains_key(&fact.key) {
                        return Err(MacOsLifecycleFailure::Protocol);
                    }
                    return Ok(());
                }
                if let Some(existing) = self.active.get_mut(&fact.key) {
                    if fact.execution_generation == existing.execution_generation {
                        return Ok(());
                    }
                    if existing.identity.status == ProcessExecutableIdentityStatus::Pending {
                        return Err(MacOsLifecycleFailure::Backend);
                    }
                    if existing.execution_generation.checked_add(1)
                        != Some(fact.execution_generation)
                    {
                        return Err(MacOsLifecycleFailure::Backend);
                    }
                    existing.execution_generation = fact.execution_generation;
                    existing.identity = pending_identity();
                } else {
                    self.insert_process(fact)?;
                }
            }
            MacOsLifecycleInput::Exit(fact) => {
                validate_candidate_audit_scope(candidate, fact)?;
                self.scope_history.observe_exit(fact)?;
                let _ = self.remove_process(fact)?;
            }
            MacOsLifecycleInput::IdentityResolved(resolution) => {
                self.apply_identity_resolution(*resolution)?;
            }
            MacOsLifecycleInput::NativeEventLoss(count) => return Err(native_event_loss(count)),
            MacOsLifecycleInput::PermissionLost => {
                return Err(MacOsLifecycleFailure::PermissionLost);
            }
            MacOsLifecycleInput::BackendInvalidated => {
                return Err(MacOsLifecycleFailure::Backend);
            }
        }
        Ok(())
    }

    fn apply_live_input(
        &mut self,
        input: MacOsLifecycleInput,
    ) -> Result<Option<ProcessApplicationEvent>, MacOsLifecycleFailure> {
        let candidate = self.candidate;
        match input {
            MacOsLifecycleInput::Fork(fact) => {
                validate_candidate_audit_scope(candidate, fact)?;
                self.scope_history.observe_fork(fact, false)?;
                if fact.has_ambiguous_candidate_scope(candidate) {
                    return Err(MacOsLifecycleFailure::Backend);
                }
                if !fact.belongs_to(candidate) {
                    return if self.active.contains_key(&fact.key) {
                        Err(MacOsLifecycleFailure::Protocol)
                    } else {
                        Ok(None)
                    };
                }
                if self.active.contains_key(&fact.key) {
                    return Err(MacOsLifecycleFailure::Protocol);
                }
                let process = self.insert_process(fact)?;
                Ok(Some(process_event(
                    ProcessApplicationEventKind::Started,
                    process,
                )?))
            }
            MacOsLifecycleInput::Exec(fact) => {
                validate_candidate_audit_scope(candidate, fact)?;
                self.scope_history.observe_exec(fact, false)?;
                if fact.has_ambiguous_candidate_scope(candidate) {
                    return Err(MacOsLifecycleFailure::Backend);
                }
                if !fact.belongs_to(candidate) {
                    return if self.active.contains_key(&fact.key) {
                        Err(MacOsLifecycleFailure::Protocol)
                    } else {
                        Ok(None)
                    };
                }
                let process = {
                    let existing = match self.active.get_mut(&fact.key) {
                        Some(existing) => existing,
                        None if self.identities.identities.contains_key(&fact.key) => {
                            return Err(MacOsLifecycleFailure::Protocol);
                        }
                        None => return Err(MacOsLifecycleFailure::Backend),
                    };
                    if existing.execution_generation == fact.execution_generation {
                        return Err(MacOsLifecycleFailure::Protocol);
                    }
                    if existing.identity.status == ProcessExecutableIdentityStatus::Pending {
                        return Err(MacOsLifecycleFailure::Backend);
                    }
                    if existing.execution_generation.checked_add(1)
                        != Some(fact.execution_generation)
                    {
                        return Err(MacOsLifecycleFailure::Backend);
                    }
                    existing.execution_generation = fact.execution_generation;
                    existing.identity = pending_identity();
                    existing.protocol_process()
                };
                Ok(Some(process_event(
                    ProcessApplicationEventKind::IdentityChanged,
                    process,
                )?))
            }
            MacOsLifecycleInput::Exit(fact) => {
                validate_candidate_audit_scope(candidate, fact)?;
                self.scope_history.observe_exit(fact)?;
                let Some(process) = self.remove_process(fact)? else {
                    return Ok(None);
                };
                Ok(Some(ProcessApplicationEvent {
                    kind: ProcessApplicationEventKind::Exited,
                    process_instance_id: Some(process.process_instance_id),
                    process: None,
                    state: None,
                }))
            }
            MacOsLifecycleInput::IdentityResolved(resolution) => {
                let key = resolution.key;
                self.apply_identity_resolution(*resolution)?;
                let process = self
                    .active
                    .get(&key)
                    .ok_or(MacOsLifecycleFailure::Backend)?
                    .protocol_process();
                Ok(Some(process_event(
                    ProcessApplicationEventKind::IdentityChanged,
                    process,
                )?))
            }
            MacOsLifecycleInput::NativeEventLoss(count) => Err(native_event_loss(count)),
            MacOsLifecycleInput::PermissionLost => Err(MacOsLifecycleFailure::PermissionLost),
            MacOsLifecycleInput::BackendInvalidated => Err(MacOsLifecycleFailure::Backend),
        }
    }

    fn has_pending_identity(&self) -> bool {
        self.active
            .values()
            .any(|process| process.identity.status == ProcessExecutableIdentityStatus::Pending)
    }
}

const fn native_event_loss(count: u64) -> MacOsLifecycleFailure {
    if count == 0 || count > MAX_PROTOCOL_SAFE_INTEGER {
        MacOsLifecycleFailure::Protocol
    } else {
        MacOsLifecycleFailure::NativeEventLoss(count)
    }
}

const fn validate_candidate_audit_scope(
    candidate: MacOsCandidateAuditSession,
    fact: MacOsProcessFact,
) -> Result<(), MacOsLifecycleFailure> {
    if fact.audit_session_id == candidate.audit_session_id
        && fact.audit_user_id != candidate.audit_user_id
    {
        Err(MacOsLifecycleFailure::Backend)
    } else {
        Ok(())
    }
}

impl ProcessLifecycleModel {
    fn remove_process(
        &mut self,
        fact: MacOsProcessFact,
    ) -> Result<Option<TrackedProcess>, MacOsLifecycleFailure> {
        let candidate = self.candidate;
        if fact.has_ambiguous_candidate_scope(candidate) {
            return Err(MacOsLifecycleFailure::Backend);
        }
        if !fact.belongs_to(candidate) {
            if self.active.contains_key(&fact.key) {
                return Err(MacOsLifecycleFailure::Protocol);
            }
            return Ok(None);
        }
        let process = self
            .active
            .get(&fact.key)
            .ok_or(MacOsLifecycleFailure::Backend)?;
        if process.execution_generation != fact.execution_generation {
            return Err(MacOsLifecycleFailure::Backend);
        }
        if process.identity.status == ProcessExecutableIdentityStatus::Pending {
            return Err(MacOsLifecycleFailure::Backend);
        }
        self.active
            .remove(&fact.key)
            .map(Some)
            .ok_or(MacOsLifecycleFailure::Backend)
    }

    fn insert_process(
        &mut self,
        fact: MacOsProcessFact,
    ) -> Result<ProcessApplicationProcess, MacOsLifecycleFailure> {
        if self.active.len() >= MAX_CURRENT_PROCESSES {
            return Err(MacOsLifecycleFailure::InventoryOverflow);
        }
        let process = TrackedProcess {
            process_instance_id: self.identities.identity_for(fact.key)?,
            execution_generation: fact.execution_generation,
            identity: pending_identity(),
        };
        let protocol_process = process.protocol_process();
        self.active.insert(fact.key, process);
        Ok(protocol_process)
    }

    fn apply_identity_resolution(
        &mut self,
        resolution: MacOsIdentityResolution,
    ) -> Result<(), MacOsLifecycleFailure> {
        resolution
            .identity
            .validate_protocol()
            .map_err(|_error| MacOsLifecycleFailure::Protocol)?;
        if resolution.identity.status == ProcessExecutableIdentityStatus::Pending {
            return Err(MacOsLifecycleFailure::Protocol);
        }
        let process = self
            .active
            .get_mut(&resolution.key)
            .ok_or(MacOsLifecycleFailure::Protocol)?;
        if process.execution_generation != resolution.execution_generation {
            return Err(MacOsLifecycleFailure::Protocol);
        }
        if process.identity.status != ProcessExecutableIdentityStatus::Pending {
            return Err(MacOsLifecycleFailure::Protocol);
        }
        process.identity = resolution.identity;
        Ok(())
    }
}

fn process_event(
    kind: ProcessApplicationEventKind,
    process: ProcessApplicationProcess,
) -> Result<ProcessApplicationEvent, MacOsLifecycleFailure> {
    let event = ProcessApplicationEvent {
        kind,
        process_instance_id: Some(process.process_instance_id.clone()),
        process: Some(process),
        state: None,
    };
    event
        .validate()
        .map_err(|_error| MacOsLifecycleFailure::Protocol)?;
    Ok(event)
}

impl ProcessLifecycleModel {
    fn state(&self) -> Result<ProcessApplicationState, MacOsLifecycleFailure> {
        let mut processes = self
            .active
            .values()
            .map(TrackedProcess::protocol_process)
            .collect::<Vec<_>>();
        processes.sort_by(|left, right| left.process_instance_id.cmp(&right.process_instance_id));
        let state = ProcessApplicationState {
            coverage: ProcessApplicationCoverage::FullLifecycle,
            certainty: ProcessApplicationCertainty::Complete,
            processes,
        };
        state
            .validate()
            .map_err(|_error| MacOsLifecycleFailure::Protocol)?;
        Ok(state)
    }
}

const fn pending_identity() -> ProcessExecutableIdentity {
    ProcessExecutableIdentity {
        status: ProcessExecutableIdentityStatus::Pending,
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
    use std::process::Command;
    use std::sync::{Arc, Barrier, Mutex};

    use super::*;

    const CANDIDATE_SESSION: u32 = 41;
    const CANDIDATE_USER: u32 = 501;

    struct ScriptedFeed {
        start_inputs: Vec<MacOsLifecycleInput>,
        barrier_inputs: Vec<MacOsLifecycleInput>,
        stop_inputs: Vec<MacOsLifecycleInput>,
        shared_sink: Arc<Mutex<Option<MacOsLifecycleSinkProbe>>>,
        stop_thread: Arc<Mutex<Option<ThreadId>>>,
    }

    struct ScriptedSubscription {
        barrier_inputs: Vec<MacOsLifecycleInput>,
        stop_inputs: Vec<MacOsLifecycleInput>,
        sink: MacOsLifecycleSink,
        stop_thread: Arc<Mutex<Option<ThreadId>>>,
    }

    type ScriptedSource = MacOsProcessLifecycle<ScriptedSubscription>;
    type ScriptedOpen = Result<
        (
            ProcessApplicationState,
            ScriptedSource,
            Arc<Mutex<Option<MacOsLifecycleSinkProbe>>>,
            Arc<Mutex<Option<ThreadId>>>,
        ),
        MacOsLifecycleFailure,
    >;

    impl MacOsLifecycleEventFeed for ScriptedFeed {
        type Subscription = ScriptedSubscription;

        fn start(
            self,
            sink: MacOsLifecycleSink,
        ) -> Result<Self::Subscription, MacOsLifecycleFailure> {
            for input in self.start_inputs {
                sink.submit(input);
            }
            *self.shared_sink.lock().expect("shared sink") = Some(sink.test_probe());
            Ok(ScriptedSubscription {
                barrier_inputs: self.barrier_inputs,
                stop_inputs: self.stop_inputs,
                sink,
                stop_thread: self.stop_thread,
            })
        }
    }

    impl MacOsLifecycleSubscription for ScriptedSubscription {
        fn bootstrap_barrier(&mut self) -> Result<MacOsLifecycleCheckpoint, MacOsLifecycleFailure> {
            for input in self.barrier_inputs.drain(..) {
                self.sink.submit(input);
            }
            self.sink.checkpoint()
        }

        fn stop(self) -> Result<(), MacOsLifecycleFailure> {
            for input in self.stop_inputs {
                self.sink.submit(input);
            }
            *self.stop_thread.lock().expect("stop thread") = Some(thread::current().id());
            Ok(())
        }
    }

    struct ScriptedInventory {
        facts: Vec<MacOsProcessFact>,
        during_query: Vec<MacOsLifecycleInput>,
        shared_sink: Arc<Mutex<Option<MacOsLifecycleSinkProbe>>>,
    }

    struct EmptyInventory;

    struct DroppingFeed;

    struct ExternallyOwnedFeed {
        sink: Arc<Mutex<Option<MacOsLifecycleSink>>>,
    }

    struct ExternallyOwnedSubscription {
        sink: Arc<Mutex<Option<MacOsLifecycleSink>>>,
    }

    struct RetainingFeed {
        sink: Arc<Mutex<Option<MacOsLifecycleSink>>>,
    }

    struct RetainingSubscription {
        sink: Arc<Mutex<Option<MacOsLifecycleSink>>>,
    }

    struct DroppingSubscription {
        checkpoint: MacOsLifecycleCheckpoint,
    }

    impl MacOsLifecycleEventFeed for DroppingFeed {
        type Subscription = DroppingSubscription;

        fn start(
            self,
            sink: MacOsLifecycleSink,
        ) -> Result<Self::Subscription, MacOsLifecycleFailure> {
            let checkpoint = sink.checkpoint()?;
            drop(sink);
            Ok(DroppingSubscription { checkpoint })
        }
    }

    impl MacOsLifecycleSubscription for DroppingSubscription {
        fn bootstrap_barrier(&mut self) -> Result<MacOsLifecycleCheckpoint, MacOsLifecycleFailure> {
            Ok(self.checkpoint)
        }

        fn stop(self) -> Result<(), MacOsLifecycleFailure> {
            Ok(())
        }
    }

    impl MacOsLifecycleEventFeed for ExternallyOwnedFeed {
        type Subscription = ExternallyOwnedSubscription;

        fn start(
            self,
            sink: MacOsLifecycleSink,
        ) -> Result<Self::Subscription, MacOsLifecycleFailure> {
            *self.sink.lock().expect("external sink") = Some(sink);
            Ok(ExternallyOwnedSubscription { sink: self.sink })
        }
    }

    impl MacOsLifecycleSubscription for ExternallyOwnedSubscription {
        fn bootstrap_barrier(&mut self) -> Result<MacOsLifecycleCheckpoint, MacOsLifecycleFailure> {
            self.sink
                .lock()
                .expect("external sink")
                .as_ref()
                .ok_or(MacOsLifecycleFailure::Backend)?
                .checkpoint()
        }

        fn stop(self) -> Result<(), MacOsLifecycleFailure> {
            drop(self.sink.lock().expect("external sink").take());
            Ok(())
        }
    }

    impl MacOsLifecycleEventFeed for RetainingFeed {
        type Subscription = RetainingSubscription;

        fn start(
            self,
            sink: MacOsLifecycleSink,
        ) -> Result<Self::Subscription, MacOsLifecycleFailure> {
            *self.sink.lock().expect("retained sink") = Some(sink);
            Ok(RetainingSubscription { sink: self.sink })
        }
    }

    impl MacOsLifecycleSubscription for RetainingSubscription {
        fn bootstrap_barrier(&mut self) -> Result<MacOsLifecycleCheckpoint, MacOsLifecycleFailure> {
            self.sink
                .lock()
                .expect("retained sink")
                .as_ref()
                .ok_or(MacOsLifecycleFailure::Backend)?
                .checkpoint()
        }

        fn stop(self) -> Result<(), MacOsLifecycleFailure> {
            Ok(())
        }
    }

    impl MacOsProcessInventory for EmptyInventory {
        fn snapshot(
            &mut self,
            _collector: &mut MacOsProcessInventoryCollector,
        ) -> Result<(), MacOsLifecycleFailure> {
            Ok(())
        }
    }

    impl MacOsProcessInventory for ScriptedInventory {
        fn snapshot(
            &mut self,
            collector: &mut MacOsProcessInventoryCollector,
        ) -> Result<(), MacOsLifecycleFailure> {
            let sink = self
                .shared_sink
                .lock()
                .expect("shared sink")
                .clone()
                .expect("feed starts before inventory");
            for input in self.during_query.drain(..) {
                sink.submit(input);
            }
            for fact in &self.facts {
                collector.push(*fact)?;
            }
            Ok(())
        }
    }

    fn candidate() -> MacOsCandidateAuditSession {
        MacOsCandidateAuditSession::from_verified_peer(CANDIDATE_SESSION, CANDIDATE_USER)
            .expect("candidate audit session")
    }

    fn key(pid: i32, start: u64) -> MacOsProcessKey {
        MacOsProcessKey::new(pid, start, 0).expect("process key")
    }

    fn fact(key: MacOsProcessKey, generation: u32) -> MacOsProcessFact {
        MacOsProcessFact::new(
            key,
            generation,
            CANDIDATE_SESSION,
            CANDIDATE_USER,
            MacOsProcessAccountClass::Human,
        )
    }

    fn other_session_fact(key: MacOsProcessKey) -> MacOsProcessFact {
        MacOsProcessFact::new(
            key,
            1,
            CANDIDATE_SESSION + 1,
            CANDIDATE_USER,
            MacOsProcessAccountClass::Human,
        )
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

    fn unsigned_identity() -> ProcessExecutableIdentity {
        ProcessExecutableIdentity {
            status: ProcessExecutableIdentityStatus::Unsigned,
            signer_chain_id: None,
            publisher_id: None,
            product_id: None,
            signing_id: None,
            team_id: None,
            designated_requirement: None,
            bundle_id: None,
            package_id: None,
            version: None,
            digest_sha256: Some("a".repeat(64)),
        }
    }

    fn terminal_failure(drain: &MacOsLifecycleDrain) -> Option<MacOsLifecycleFailure> {
        drain.terminal.as_ref().map(|terminal| terminal.failure)
    }

    fn open(
        queue_capacity: u16,
        start_inputs: Vec<MacOsLifecycleInput>,
        during_query: Vec<MacOsLifecycleInput>,
        barrier_inputs: Vec<MacOsLifecycleInput>,
        inventory: Vec<MacOsProcessFact>,
    ) -> ScriptedOpen {
        let shared_sink = Arc::new(Mutex::new(None));
        let stop_thread = Arc::new(Mutex::new(None));
        let feed = ScriptedFeed {
            start_inputs,
            barrier_inputs,
            stop_inputs: Vec::new(),
            shared_sink: Arc::clone(&shared_sink),
            stop_thread: Arc::clone(&stop_thread),
        };
        let inventory = ScriptedInventory {
            facts: inventory,
            during_query,
            shared_sink: Arc::clone(&shared_sink),
        };
        MacOsProcessLifecycle::open(candidate(), queue_capacity, feed, inventory)
            .map(|(state, source)| (state, source, shared_sink, stop_thread))
    }

    #[test]
    fn feed_is_live_before_inventory_and_bootstrap_events_join_snapshot_zero() {
        let child = fact(key(101, 10), 1);
        let (state, mut source, _, _) = open(
            8,
            vec![MacOsLifecycleInput::Fork(child)],
            Vec::new(),
            Vec::new(),
            Vec::new(),
        )
        .expect("source opens");
        assert_eq!(state.processes.len(), 1);
        assert!(source.drain().events.is_empty());
        source.close().expect("source closes");
    }

    #[test]
    fn inventory_and_buffered_fork_reconcile_idempotently() {
        let child = fact(key(102, 11), 1);
        let (state, mut source, _, _) = open(
            8,
            Vec::new(),
            vec![MacOsLifecycleInput::Fork(child)],
            Vec::new(),
            vec![child],
        )
        .expect("source opens");
        assert_eq!(state.processes.len(), 1);
        source.close().expect("source closes");
    }

    #[test]
    fn irreconcilable_inventory_and_buffered_exec_generations_fail_closed() {
        let process_key = key(113, 19);
        let result = open(
            8,
            Vec::new(),
            vec![MacOsLifecycleInput::Exec(fact(process_key, 1))],
            Vec::new(),
            vec![fact(process_key, 2)],
        );
        assert!(matches!(result, Err(MacOsLifecycleFailure::Backend)));
    }

    #[test]
    fn inventory_keeps_only_the_verified_candidate_audit_session() {
        let candidate_process = fact(key(103, 12), 1);
        let other_process = other_session_fact(key(104, 12));
        let system_process = MacOsProcessFact::new(
            key(105, 12),
            1,
            CANDIDATE_SESSION,
            CANDIDATE_USER,
            MacOsProcessAccountClass::SystemOrService,
        );
        let (state, mut source, _, _) = open(
            8,
            Vec::new(),
            Vec::new(),
            Vec::new(),
            vec![candidate_process, other_process, system_process],
        )
        .expect("source opens");
        assert_eq!(state.processes.len(), 1);
        source.close().expect("source closes");
    }

    #[test]
    fn inventory_rejects_conflicting_scope_for_one_stable_process_key() {
        let process_key = key(118, 22);
        for inventory in [
            vec![fact(process_key, 1), other_session_fact(process_key)],
            vec![other_session_fact(process_key), fact(process_key, 1)],
        ] {
            let result = open(8, Vec::new(), Vec::new(), Vec::new(), inventory);
            assert!(matches!(result, Err(MacOsLifecycleFailure::Protocol)));
        }
    }

    #[test]
    fn inventory_and_buffered_fork_cannot_flip_one_process_scope() {
        let process_key = key(120, 24);
        for (inventory, buffered) in [
            (
                vec![other_session_fact(process_key)],
                MacOsLifecycleInput::Fork(fact(process_key, 1)),
            ),
            (
                vec![fact(process_key, 1)],
                MacOsLifecycleInput::Fork(other_session_fact(process_key)),
            ),
        ] {
            let result = open(8, Vec::new(), Vec::new(), vec![buffered], inventory);
            assert!(matches!(result, Err(MacOsLifecycleFailure::Protocol)));
        }
    }

    #[test]
    fn ambiguous_process_in_candidate_audit_session_blocks_complete_snapshot() {
        let ambiguous = MacOsProcessFact::new(
            key(117, 21),
            1,
            CANDIDATE_SESSION,
            CANDIDATE_USER,
            MacOsProcessAccountClass::Unknown,
        );
        let result = open(8, Vec::new(), Vec::new(), Vec::new(), vec![ambiguous]);
        assert!(matches!(result, Err(MacOsLifecycleFailure::Backend)));
    }

    #[test]
    fn candidate_audit_session_with_a_different_user_blocks_complete_snapshot() {
        let contradictory = MacOsProcessFact::new(
            key(121, 25),
            1,
            CANDIDATE_SESSION,
            CANDIDATE_USER + 1,
            MacOsProcessAccountClass::Human,
        );
        let result = open(8, Vec::new(), Vec::new(), Vec::new(), vec![contradictory]);
        assert!(matches!(result, Err(MacOsLifecycleFailure::Backend)));
    }

    #[test]
    fn exec_preserves_process_instance_after_each_generation_is_resolved() {
        let process_key = key(106, 13);
        let initial = fact(process_key, 1);
        let (state, mut source, shared_sink, _) =
            open(8, Vec::new(), Vec::new(), Vec::new(), vec![initial]).expect("source opens");
        let instance_id = state.processes[0].process_instance_id.clone();
        let sink = shared_sink
            .lock()
            .expect("shared sink")
            .clone()
            .expect("sink");
        sink.submit(MacOsLifecycleInput::IdentityResolved(Box::new(
            MacOsIdentityResolution::new(process_key, 1, unavailable_identity())
                .expect("bounded identity"),
        )));
        let initial_resolution = source.drain();
        assert_eq!(initial_resolution.events.len(), 1);

        sink.submit(MacOsLifecycleInput::Exec(fact(process_key, 2)));
        let drain = source.drain();
        assert_eq!(drain.events.len(), 1);
        assert_eq!(
            drain.events[0].event.kind,
            ProcessApplicationEventKind::IdentityChanged
        );
        assert_eq!(
            drain.events[0].event.process_instance_id.as_deref(),
            Some(instance_id.as_str())
        );
        assert_eq!(
            drain.events[0]
                .event
                .process
                .as_ref()
                .expect("process")
                .identity
                .status,
            ProcessExecutableIdentityStatus::Pending
        );

        sink.submit(MacOsLifecycleInput::IdentityResolved(Box::new(
            MacOsIdentityResolution::new(process_key, 2, unavailable_identity())
                .expect("bounded identity"),
        )));
        let resolved = source.drain();
        assert_eq!(resolved.events.len(), 1);
        assert_eq!(
            resolved.events[0]
                .event
                .process
                .as_ref()
                .expect("process")
                .identity
                .status,
            ProcessExecutableIdentityStatus::Unavailable
        );
        source.close().expect("source closes");
    }

    #[test]
    fn duplicate_final_identity_resolution_is_a_protocol_failure() {
        let process_key = key(122, 26);
        let (.., mut source, shared_sink, _) = open(
            8,
            Vec::new(),
            Vec::new(),
            Vec::new(),
            vec![fact(process_key, 1)],
        )
        .expect("source opens");
        let sink = shared_sink
            .lock()
            .expect("shared sink")
            .clone()
            .expect("sink");
        let resolution = MacOsLifecycleInput::IdentityResolved(Box::new(
            MacOsIdentityResolution::new(process_key, 1, unavailable_identity())
                .expect("bounded identity"),
        ));
        sink.submit(resolution.clone());
        assert_eq!(source.drain().events.len(), 1);
        sink.submit(resolution);
        assert_eq!(
            terminal_failure(&source.drain()),
            Some(MacOsLifecycleFailure::Protocol)
        );
        source.close().expect("source closes");
    }

    #[test]
    fn pid_reuse_gets_a_distinct_opaque_process_identity() {
        let first_key = key(107, 14);
        let second_key = key(107, 15);
        let (state, mut source, shared_sink, _) = open(
            8,
            Vec::new(),
            Vec::new(),
            Vec::new(),
            vec![fact(first_key, 1)],
        )
        .expect("source opens");
        let first_identity = state.processes[0].process_instance_id.clone();
        let sink = shared_sink
            .lock()
            .expect("shared sink")
            .clone()
            .expect("sink");
        sink.submit(MacOsLifecycleInput::IdentityResolved(Box::new(
            MacOsIdentityResolution::new(first_key, 1, unavailable_identity())
                .expect("bounded identity"),
        )));
        assert_eq!(source.drain().events.len(), 1);
        sink.submit(MacOsLifecycleInput::Exit(fact(first_key, 1)));
        sink.submit(MacOsLifecycleInput::Fork(fact(second_key, 1)));
        let drain = source.drain();
        assert_eq!(drain.events.len(), 2);
        let second_identity = drain.events[1]
            .event
            .process
            .as_ref()
            .expect("new process")
            .process_instance_id
            .clone();
        assert_ne!(first_identity, second_identity);
        source.close().expect("source closes");
    }

    #[test]
    fn retired_process_key_cannot_be_resurrected_by_stale_fork_or_exec() {
        let process_key = key(119, 23);
        for stale in [
            MacOsLifecycleInput::Fork(fact(process_key, 1)),
            MacOsLifecycleInput::Exec(fact(process_key, 2)),
        ] {
            let (.., mut source, shared_sink, _) =
                open(8, Vec::new(), Vec::new(), Vec::new(), Vec::new()).expect("source opens");
            let sink = shared_sink
                .lock()
                .expect("shared sink")
                .clone()
                .expect("sink");
            sink.submit(MacOsLifecycleInput::Fork(fact(process_key, 1)));
            assert_eq!(source.drain().events.len(), 1);
            sink.submit(MacOsLifecycleInput::IdentityResolved(Box::new(
                MacOsIdentityResolution::new(process_key, 1, unavailable_identity())
                    .expect("bounded identity"),
            )));
            assert_eq!(source.drain().events.len(), 1);
            sink.submit(MacOsLifecycleInput::Exit(fact(process_key, 1)));
            assert_eq!(source.drain().events.len(), 1);
            sink.submit(stale);
            assert_eq!(
                terminal_failure(&source.drain()),
                Some(MacOsLifecycleFailure::Protocol)
            );
            source.close().expect("source closes");
        }
    }

    #[test]
    fn default_audit_session_and_pid_only_keys_are_rejected() {
        assert!(MacOsCandidateAuditSession::from_verified_peer(0, CANDIDATE_USER).is_none());
        assert!(MacOsCandidateAuditSession::from_verified_peer(u32::MAX, CANDIDATE_USER).is_none());
        assert!(MacOsProcessKey::new(42, 0, 0).is_none());
        assert!(MacOsProcessKey::new(42, 1, 0).is_some());
    }

    #[test]
    fn identity_resolution_rejects_verified_foreign_platform_shapes() {
        let process_key = key(42, 1);
        let windows_identity = ProcessExecutableIdentity {
            status: ProcessExecutableIdentityStatus::Verified,
            signer_chain_id: Some("chain".to_owned()),
            publisher_id: Some("publisher".to_owned()),
            product_id: Some("product".to_owned()),
            signing_id: None,
            team_id: None,
            designated_requirement: None,
            bundle_id: None,
            package_id: None,
            version: Some("1".to_owned()),
            digest_sha256: None,
        };
        let linux_identity = ProcessExecutableIdentity {
            status: ProcessExecutableIdentityStatus::Verified,
            signer_chain_id: None,
            publisher_id: None,
            product_id: None,
            signing_id: None,
            team_id: None,
            designated_requirement: None,
            bundle_id: None,
            package_id: Some("package".to_owned()),
            version: Some("1".to_owned()),
            digest_sha256: Some("a".repeat(64)),
        };
        assert!(matches!(
            MacOsIdentityResolution::new(process_key, 1, windows_identity),
            Err(MacOsLifecycleFailure::Protocol)
        ));
        assert!(matches!(
            MacOsIdentityResolution::new(process_key, 1, linux_identity),
            Err(MacOsLifecycleFailure::Protocol)
        ));
    }

    #[test]
    fn bounded_inventory_collector_rejects_the_first_excess_fact() {
        let mut collector = MacOsProcessInventoryCollector::new();
        for process_id in 1..=MAX_RAW_INVENTORY {
            collector
                .push(fact(key(i32::try_from(process_id).expect("pid"), 1), 1))
                .expect("bounded fact");
        }
        assert!(matches!(
            collector.push(fact(key(5_000, 1), 1)),
            Err(MacOsLifecycleFailure::InventoryOverflow)
        ));
    }

    #[test]
    fn callback_channel_disappearance_prevents_complete_open() {
        let result = MacOsProcessLifecycle::open(candidate(), 8, DroppingFeed, EmptyInventory);
        assert!(matches!(result, Err(MacOsLifecycleFailure::Backend)));
    }

    #[test]
    fn producer_disappearance_before_close_is_a_partial_backend_terminal() {
        let sink = Arc::new(Mutex::new(None));
        let (_, mut source) = MacOsProcessLifecycle::open(
            candidate(),
            8,
            ExternallyOwnedFeed {
                sink: Arc::clone(&sink),
            },
            EmptyInventory,
        )
        .expect("source opens");
        drop(sink.lock().expect("external sink").take());

        let closed = source.close().expect("source closes");
        assert_eq!(
            terminal_failure(&closed.drain),
            Some(MacOsLifecycleFailure::Backend)
        );
        assert_eq!(
            closed.final_state.certainty,
            ProcessApplicationCertainty::Partial
        );
    }

    #[test]
    fn successful_stop_that_retains_a_counted_sink_is_cleanup_and_poisons_the_utility() {
        const CHILD_ENV: &str = "PRCTR_RETAINED_MACOS_LIFECYCLE_SINK_CHILD";
        const TEST_NAME: &str = concat!(
            "platform::macos_lifecycle::tests::",
            "successful_stop_that_retains_a_counted_sink_is_cleanup_and_poisons_the_utility"
        );

        if std::env::var_os(CHILD_ENV).is_none() {
            let status = Command::new(std::env::current_exe().expect("current test executable"))
                .args(["--exact", TEST_NAME, "--nocapture"])
                .env(CHILD_ENV, "1")
                .status()
                .expect("isolated poison test starts");
            assert!(status.success(), "isolated poison test failed");
            return;
        }

        let retained_sink = Arc::new(Mutex::new(None));
        let (_, mut source) = MacOsProcessLifecycle::open(
            candidate(),
            8,
            RetainingFeed {
                sink: Arc::clone(&retained_sink),
            },
            EmptyInventory,
        )
        .expect("source opens");

        assert!(matches!(
            source.close(),
            Err(MacOsLifecycleFailure::Cleanup)
        ));
        assert!(ensure_native_source_process_usable().is_err());
        drop(retained_sink.lock().expect("retained sink").take());
        drop(source);
    }

    #[test]
    fn terminal_loss_precedes_channel_disconnection_fallback() {
        let sink = Arc::new(Mutex::new(None));
        let (_, mut source) = MacOsProcessLifecycle::open(
            candidate(),
            8,
            ExternallyOwnedFeed {
                sink: Arc::clone(&sink),
            },
            EmptyInventory,
        )
        .expect("source opens");
        let terminal_sink = sink.lock().expect("external sink").take().expect("sink");
        terminal_sink.submit(MacOsLifecycleInput::NativeEventLoss(2));
        drop(terminal_sink);

        assert_eq!(
            terminal_failure(&source.drain()),
            Some(MacOsLifecycleFailure::NativeEventLoss(2))
        );
        source.close().expect("source closes");
    }

    #[test]
    fn ingress_contention_is_nonblocking_and_reports_an_exact_gap() {
        let (.., mut source, shared_sink, _) =
            open(4, Vec::new(), Vec::new(), Vec::new(), Vec::new()).expect("source opens");
        let sink = shared_sink
            .lock()
            .expect("shared sink")
            .clone()
            .expect("sink");
        let held_sequence = sink.status.next_sequence.lock().expect("sequence lock");
        let competing_sink = sink.clone();
        thread::spawn(move || {
            competing_sink.submit(MacOsLifecycleInput::Fork(fact(key(401, 30), 1)));
        })
        .join()
        .expect("producer joins");
        drop(held_sequence);
        assert_eq!(
            terminal_failure(&source.drain()),
            Some(MacOsLifecycleFailure::QueueOverflow(1))
        );
        source.close().expect("source closes");
    }

    #[test]
    fn zero_or_unrepresentable_native_loss_is_protocol_failure() {
        for count in [0, MAX_PROTOCOL_SAFE_INTEGER + 1] {
            let (.., mut source, shared_sink, _) =
                open(4, Vec::new(), Vec::new(), Vec::new(), Vec::new()).expect("source opens");
            let sink = shared_sink
                .lock()
                .expect("shared sink")
                .clone()
                .expect("sink");
            sink.submit(MacOsLifecycleInput::NativeEventLoss(count));
            assert_eq!(
                terminal_failure(&source.drain()),
                Some(MacOsLifecycleFailure::Protocol)
            );
            source.close().expect("source closes");
        }
    }

    #[test]
    fn concurrent_operational_losses_latch_one_exact_non_protocol_terminal() {
        let (.., mut source, shared_sink, _) =
            open(4, Vec::new(), Vec::new(), Vec::new(), Vec::new()).expect("source opens");
        let sink = shared_sink
            .lock()
            .expect("shared sink")
            .clone()
            .expect("sink");
        let barrier = Arc::new(Barrier::new(3));
        let native_status = Arc::clone(&sink.status);
        let native_barrier = Arc::clone(&barrier);
        let native = thread::spawn(move || {
            native_barrier.wait();
            native_status.latch_terminal(MacOsLifecycleFailure::NativeEventLoss(2));
        });
        let queue_status = Arc::clone(&sink.status);
        let queue_barrier = Arc::clone(&barrier);
        let queue = thread::spawn(move || {
            queue_barrier.wait();
            queue_status.latch_terminal(MacOsLifecycleFailure::QueueOverflow(1));
        });
        barrier.wait();
        native.join().expect("native loss producer joins");
        queue.join().expect("queue loss producer joins");
        let drain = source.drain();
        assert!(matches!(
            terminal_failure(&drain),
            Some(
                MacOsLifecycleFailure::NativeEventLoss(2) | MacOsLifecycleFailure::QueueOverflow(1)
            )
        ));
        assert!(drain.terminal.is_some());
        assert!(terminal_failure(&source.drain()).is_none());
        source.close().expect("source closes");
    }

    #[test]
    fn terminal_barrier_preserves_an_inflight_accepted_event_before_failure() {
        let (.., mut source, shared_sink, _) =
            open(4, Vec::new(), Vec::new(), Vec::new(), Vec::new()).expect("source opens");
        let sink = shared_sink
            .lock()
            .expect("shared sink")
            .clone()
            .expect("sink");
        let status = Arc::clone(&sink.status);
        let sender = sink.sender.clone();
        let entered = Arc::new(Barrier::new(2));
        let release = Arc::new(Barrier::new(2));
        let producer_status = Arc::clone(&status);
        let producer_entered = Arc::clone(&entered);
        let producer_release = Arc::clone(&release);
        let producer = thread::spawn(move || {
            let mut sequence = producer_status.next_sequence.lock().expect("sequence lock");
            assert!(producer_status.accepting.load(Ordering::Acquire));
            producer_entered.wait();
            producer_release.wait();
            let next = sequence.checked_add(1).expect("next sequence");
            sender
                .try_send(IngressEnvelope {
                    sequence: next,
                    monotonic_time_ns: producer_status.monotonic_time_ns(),
                    input: MacOsLifecycleInput::Fork(fact(key(408, 37), 1)),
                })
                .expect("accepted event");
            *sequence = next;
            producer_status
                .committed_sequence
                .store(next, Ordering::Release);
        });
        entered.wait();
        status.latch_terminal(MacOsLifecycleFailure::NativeEventLoss(1));
        release.wait();

        let drain = source.drain();
        producer.join().expect("producer joins");
        assert_eq!(drain.events.len(), 1);
        assert_eq!(
            terminal_failure(&drain),
            Some(MacOsLifecycleFailure::NativeEventLoss(1))
        );
        assert!(
            drain
                .terminal
                .as_ref()
                .expect("terminal outcome")
                .monotonic_time_ns
                >= drain.events[0].monotonic_time_ns
        );
        source.close().expect("source closes");
    }

    #[test]
    fn permission_and_backend_invalidation_are_out_of_band_terminal_inputs() {
        for (input, expected) in [
            (
                MacOsLifecycleInput::PermissionLost,
                MacOsLifecycleFailure::PermissionLost,
            ),
            (
                MacOsLifecycleInput::BackendInvalidated,
                MacOsLifecycleFailure::Backend,
            ),
        ] {
            let (.., mut source, shared_sink, _) =
                open(4, Vec::new(), Vec::new(), Vec::new(), Vec::new()).expect("source opens");
            let sink = shared_sink
                .lock()
                .expect("shared sink")
                .clone()
                .expect("sink");
            sink.submit(input);
            assert_eq!(terminal_failure(&source.drain()), Some(expected));
            source.close().expect("source closes");
        }
    }

    #[test]
    fn stop_fences_callbacks_before_closing_ingress_and_returns_the_tail() {
        let shared_sink = Arc::new(Mutex::new(None));
        let stop_thread = Arc::new(Mutex::new(None));
        let closing_fact = fact(key(402, 31), 1);
        let feed = ScriptedFeed {
            start_inputs: Vec::new(),
            barrier_inputs: Vec::new(),
            stop_inputs: vec![MacOsLifecycleInput::Fork(closing_fact)],
            shared_sink: Arc::clone(&shared_sink),
            stop_thread,
        };
        let inventory = ScriptedInventory {
            facts: Vec::new(),
            during_query: Vec::new(),
            shared_sink,
        };
        let (_, mut source) =
            MacOsProcessLifecycle::open(candidate(), 4, feed, inventory).expect("source opens");
        let closed = source.close().expect("source closes");
        assert!(matches!(
            closed.drain.events.as_slice(),
            [MacOsLifecycleEvent {
                event: ProcessApplicationEvent {
                    kind: ProcessApplicationEventKind::Started,
                    ..
                },
                ..
            }]
        ));
        assert_eq!(closed.final_state.processes.len(), 1);
    }

    #[test]
    fn unresolved_exec_or_exit_and_conflicting_identity_fail_closed() {
        let process_key = key(403, 32);
        let (.., mut pending_source, pending_sink, _) = open(
            8,
            Vec::new(),
            Vec::new(),
            Vec::new(),
            vec![fact(process_key, 1)],
        )
        .expect("pending source opens");
        pending_sink
            .lock()
            .expect("pending sink")
            .clone()
            .expect("sink")
            .submit(MacOsLifecycleInput::Exit(fact(process_key, 1)));
        assert_eq!(
            terminal_failure(&pending_source.drain()),
            Some(MacOsLifecycleFailure::Backend)
        );
        pending_source.close().expect("pending source closes");

        let (.., mut pending_exec_source, pending_exec_sink, _) = open(
            8,
            Vec::new(),
            Vec::new(),
            Vec::new(),
            vec![fact(process_key, 1)],
        )
        .expect("pending exec source opens");
        pending_exec_sink
            .lock()
            .expect("pending exec sink")
            .clone()
            .expect("sink")
            .submit(MacOsLifecycleInput::Exec(fact(process_key, 2)));
        assert_eq!(
            terminal_failure(&pending_exec_source.drain()),
            Some(MacOsLifecycleFailure::Backend)
        );
        pending_exec_source
            .close()
            .expect("pending exec source closes");

        let (.., mut source, shared_sink, _) = open(
            8,
            Vec::new(),
            Vec::new(),
            Vec::new(),
            vec![fact(process_key, 1)],
        )
        .expect("source opens");
        let sink = shared_sink
            .lock()
            .expect("shared sink")
            .clone()
            .expect("sink");
        sink.submit(MacOsLifecycleInput::IdentityResolved(Box::new(
            MacOsIdentityResolution::new(process_key, 1, unavailable_identity())
                .expect("bounded identity"),
        )));
        assert_eq!(source.drain().events.len(), 1);
        sink.submit(MacOsLifecycleInput::IdentityResolved(Box::new(
            MacOsIdentityResolution::new(process_key, 1, unsigned_identity())
                .expect("bounded identity"),
        )));
        assert_eq!(
            terminal_failure(&source.drain()),
            Some(MacOsLifecycleFailure::Protocol)
        );
        source.close().expect("source closes");
    }

    #[test]
    fn close_reports_pending_identity_work_as_an_operational_terminal() {
        let process_key = key(409, 38);
        let (.., mut source, _, _) = open(
            8,
            Vec::new(),
            Vec::new(),
            Vec::new(),
            vec![fact(process_key, 1)],
        )
        .expect("source opens");
        let closed = source.close().expect("source closes");
        assert_eq!(
            terminal_failure(&closed.drain),
            Some(MacOsLifecycleFailure::Backend)
        );
        assert!(closed.drain.terminal.is_some());
        assert_eq!(
            closed.final_state.certainty,
            ProcessApplicationCertainty::Partial
        );
    }

    #[test]
    fn duplicate_fork_unknown_exit_and_exec_generation_jump_fail_closed() {
        let duplicate_key = key(404, 33);
        let (.., mut duplicate_source, duplicate_sink, _) =
            open(8, Vec::new(), Vec::new(), Vec::new(), Vec::new())
                .expect("duplicate source opens");
        let sink = duplicate_sink
            .lock()
            .expect("duplicate sink")
            .clone()
            .expect("sink");
        sink.submit(MacOsLifecycleInput::Fork(fact(duplicate_key, 1)));
        assert_eq!(duplicate_source.drain().events.len(), 1);
        sink.submit(MacOsLifecycleInput::Fork(fact(duplicate_key, 1)));
        assert_eq!(
            terminal_failure(&duplicate_source.drain()),
            Some(MacOsLifecycleFailure::Protocol)
        );
        duplicate_source.close().expect("duplicate source closes");

        let (.., mut unknown_exit_source, unknown_exit_sink, _) =
            open(8, Vec::new(), Vec::new(), Vec::new(), Vec::new()).expect("exit source opens");
        unknown_exit_sink
            .lock()
            .expect("exit sink")
            .clone()
            .expect("sink")
            .submit(MacOsLifecycleInput::Exit(fact(key(405, 34), 1)));
        assert_eq!(
            terminal_failure(&unknown_exit_source.drain()),
            Some(MacOsLifecycleFailure::Backend)
        );
        unknown_exit_source.close().expect("exit source closes");

        let jump_key = key(406, 35);
        let (.., mut jump_source, jump_sink, _) = open(
            8,
            Vec::new(),
            Vec::new(),
            Vec::new(),
            vec![fact(jump_key, 1)],
        )
        .expect("jump source opens");
        let sink = jump_sink.lock().expect("jump sink").clone().expect("sink");
        sink.submit(MacOsLifecycleInput::IdentityResolved(Box::new(
            MacOsIdentityResolution::new(jump_key, 1, unavailable_identity())
                .expect("bounded identity"),
        )));
        assert_eq!(jump_source.drain().events.len(), 1);
        sink.submit(MacOsLifecycleInput::Exec(fact(jump_key, 3)));
        assert_eq!(
            terminal_failure(&jump_source.drain()),
            Some(MacOsLifecycleFailure::Backend)
        );
        jump_source.close().expect("jump source closes");
    }

    #[test]
    fn live_fork_rejects_conflicting_scope_for_an_active_process_key() {
        let process_key = key(407, 36);
        let (.., mut source, shared_sink, _) =
            open(8, Vec::new(), Vec::new(), Vec::new(), Vec::new()).expect("source opens");
        let sink = shared_sink
            .lock()
            .expect("shared sink")
            .clone()
            .expect("sink");
        sink.submit(MacOsLifecycleInput::Fork(fact(process_key, 1)));
        assert_eq!(source.drain().events.len(), 1);
        sink.submit(MacOsLifecycleInput::Fork(other_session_fact(process_key)));
        assert_eq!(
            terminal_failure(&source.drain()),
            Some(MacOsLifecycleFailure::Protocol)
        );
        source.close().expect("source closes");
    }

    #[test]
    fn retired_candidate_key_rejects_a_later_noncandidate_scope() {
        let process_key = key(410, 39);
        let (.., mut source, shared_sink, _) =
            open(8, Vec::new(), Vec::new(), Vec::new(), Vec::new()).expect("source opens");
        let sink = shared_sink
            .lock()
            .expect("shared sink")
            .clone()
            .expect("sink");
        sink.submit(MacOsLifecycleInput::Fork(fact(process_key, 1)));
        assert_eq!(source.drain().events.len(), 1);
        sink.submit(MacOsLifecycleInput::IdentityResolved(Box::new(
            MacOsIdentityResolution::new(process_key, 1, unavailable_identity())
                .expect("bounded identity"),
        )));
        assert_eq!(source.drain().events.len(), 1);
        sink.submit(MacOsLifecycleInput::Exit(fact(process_key, 1)));
        assert_eq!(source.drain().events.len(), 1);
        sink.submit(MacOsLifecycleInput::Fork(other_session_fact(process_key)));
        assert_eq!(
            terminal_failure(&source.drain()),
            Some(MacOsLifecycleFailure::Protocol)
        );
        source.close().expect("source closes");
    }

    #[test]
    fn native_loss_during_bootstrap_fails_without_a_snapshot() {
        let result = open(
            8,
            Vec::new(),
            vec![MacOsLifecycleInput::NativeEventLoss(3)],
            Vec::new(),
            Vec::new(),
        );
        assert!(matches!(
            result,
            Err(MacOsLifecycleFailure::NativeEventLoss(3))
        ));
    }

    #[test]
    fn callback_queue_overflow_during_bootstrap_is_terminal() {
        let result = open(
            2,
            Vec::new(),
            vec![
                MacOsLifecycleInput::Fork(fact(key(108, 16), 1)),
                MacOsLifecycleInput::Fork(fact(key(109, 16), 1)),
                MacOsLifecycleInput::Fork(fact(key(110, 16), 1)),
            ],
            Vec::new(),
            Vec::new(),
        );
        assert!(matches!(
            result,
            Err(MacOsLifecycleFailure::QueueOverflow(1))
        ));
    }

    #[test]
    fn live_loss_is_reported_once_and_latches_callback_intake() {
        let (.., mut source, shared_sink, _) =
            open(4, Vec::new(), Vec::new(), Vec::new(), Vec::new()).expect("source opens");
        let sink = shared_sink
            .lock()
            .expect("shared sink")
            .clone()
            .expect("sink");
        sink.submit(MacOsLifecycleInput::NativeEventLoss(2));
        assert_eq!(
            terminal_failure(&source.drain()),
            Some(MacOsLifecycleFailure::NativeEventLoss(2))
        );
        assert_eq!(terminal_failure(&source.drain()), None);
        sink.submit(MacOsLifecycleInput::Fork(fact(key(111, 17), 1)));
        assert!(source.drain().events.is_empty());
        let closed = source.close().expect("failed source still closes");
        assert_eq!(terminal_failure(&closed.drain), None);
        assert_eq!(
            closed.final_state.certainty,
            ProcessApplicationCertainty::Partial
        );
    }

    #[test]
    fn live_queue_overflow_preserves_the_accepted_tail_and_reports_exact_loss_once() {
        let (.., mut source, shared_sink, _) =
            open(2, Vec::new(), Vec::new(), Vec::new(), Vec::new()).expect("source opens");
        let sink = shared_sink
            .lock()
            .expect("shared sink")
            .clone()
            .expect("sink");
        sink.submit(MacOsLifecycleInput::Fork(fact(key(114, 20), 1)));
        sink.submit(MacOsLifecycleInput::Fork(fact(key(115, 20), 1)));
        sink.submit(MacOsLifecycleInput::Fork(fact(key(116, 20), 1)));
        let drain = source.drain();
        assert_eq!(drain.events.len(), 2);
        assert_eq!(
            terminal_failure(&drain),
            Some(MacOsLifecycleFailure::QueueOverflow(1))
        );
        assert_eq!(terminal_failure(&source.drain()), None);
        source.close().expect("source closes");
    }

    #[test]
    fn close_fences_late_callbacks_and_stops_on_the_opening_thread() {
        let opening_thread = thread::current().id();
        let (.., mut source, shared_sink, stop_thread) =
            open(4, Vec::new(), Vec::new(), Vec::new(), Vec::new()).expect("source opens");
        let sink = shared_sink
            .lock()
            .expect("shared sink")
            .clone()
            .expect("sink");
        let closed = source.close().expect("source closes");
        assert!(closed.drain.events.is_empty());
        assert_eq!(
            *stop_thread.lock().expect("stop thread"),
            Some(opening_thread)
        );
        sink.submit(MacOsLifecycleInput::Fork(fact(key(112, 18), 1)));
        assert!(source.drain().events.is_empty());
    }
}
