mod platform;

use std::fmt;

use native_protocol::{
    PermissionState, PlatformFamily, ProcessApplicationDrain, ProcessApplicationEvent,
    ProcessApplicationEventKind, ProcessApplicationObservation, ProcessApplicationSourceSnapshot,
    ProcessApplicationState, ProcessExecutableIdentityStatus, ProtocolValidatable,
    ProtocolViolation, SourceFailureCode, SourceHealth, SourceOpenRequest, SourceReset,
};
use native_source_runtime::{
    BoundedTaskError, QueueError, SourceResetPlan, SourceSession, SourceSessionFact,
    SourceSessionMetadata, SourceStateChange, SourceStateMachine,
    ensure_native_source_process_usable, prefer_boundary_error, run_bounded_source_stop,
};

#[cfg(target_os = "linux")]
pub use platform::LinuxProcessApplicationBackend;
pub use platform::UnavailableProcessApplicationSubscription;
#[cfg(target_os = "macos")]
pub use platform::{
    EndpointSecurityBootstrapRegistrar, EndpointSecurityEventFeed, EndpointSecuritySubscription,
    MacOsAuditProcessInventory, MacOsCandidateAuditSession, MacOsIdentityResolution,
    MacOsLifecycleCheckpoint, MacOsLifecycleClose, MacOsLifecycleDrain, MacOsLifecycleEvent,
    MacOsLifecycleEventFeed, MacOsLifecycleFailure, MacOsLifecycleInput, MacOsLifecycleSink,
    MacOsLifecycleSubscription, MacOsLifecycleTerminal, MacOsLifecycleTimeOrigin,
    MacOsProcessAccountClass, MacOsProcessApplicationBackend, MacOsProcessFact,
    MacOsProcessInventory, MacOsProcessInventoryCollector, MacOsProcessKey, MacOsProcessLifecycle,
};
#[cfg(target_os = "windows")]
pub use platform::{
    WindowsEtwDrain, WindowsEtwFailure, WindowsEtwProcessEvent, WindowsEtwProcessFeed,
    WindowsProcessApplicationBackend, WindowsProcessLifetime,
};

pub const SOURCE_VERSION: &str = env!("CARGO_PKG_VERSION");

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum ProcessApplicationError {
    Backend(String),
    Cleanup(String),
    InventoryOverflow(String),
    Protocol(ProtocolViolation),
    Queue(QueueError),
    QueueOverflow,
}

impl ProcessApplicationError {
    #[must_use]
    pub const fn failure_code(&self) -> SourceFailureCode {
        match self {
            Self::Backend(_) => SourceFailureCode::Backend,
            Self::Cleanup(_) => SourceFailureCode::Cleanup,
            Self::InventoryOverflow(_) => SourceFailureCode::InventoryOverflow,
            Self::Protocol(_) => SourceFailureCode::Protocol,
            Self::Queue(_) => SourceFailureCode::Queue,
            Self::QueueOverflow => SourceFailureCode::QueueOverflow,
        }
    }

    /// Only ordinary platform discovery failure may degrade an initial probe
    /// to explicit unavailable coverage. Inventory and lifecycle failures are
    /// terminal and retain their precise failure codes.
    #[must_use]
    pub const fn allows_initial_unavailable_fallback(&self) -> bool {
        matches!(self, Self::Backend(_))
    }
}

impl fmt::Display for ProcessApplicationError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Backend(reason) => {
                write!(formatter, "process/application backend failed: {reason}")
            }
            Self::Cleanup(reason) => {
                write!(formatter, "process/application cleanup failed: {reason}")
            }
            Self::InventoryOverflow(reason) => {
                write!(
                    formatter,
                    "process/application inventory exceeded its bound: {reason}"
                )
            }
            Self::Protocol(error) => {
                write!(formatter, "process/application protocol violation: {error}")
            }
            Self::Queue(error) => write!(formatter, "process/application queue failed: {error}"),
            Self::QueueOverflow => {
                formatter.write_str("process/application source queue overflowed")
            }
        }
    }
}

impl std::error::Error for ProcessApplicationError {}

impl From<ProtocolViolation> for ProcessApplicationError {
    fn from(error: ProtocolViolation) -> Self {
        Self::Protocol(error)
    }
}

impl From<QueueError> for ProcessApplicationError {
    fn from(error: QueueError) -> Self {
        Self::Queue(error)
    }
}

pub trait ProcessApplicationSubscription: Send + 'static {
    /// Fences further observations and returns one final complete mechanical state.
    ///
    /// # Errors
    ///
    /// Returns a cleanup or backend error when a closed-input boundary cannot be established.
    fn stop(self) -> Result<ProcessApplicationState, ProcessApplicationError>;
}

pub trait ProcessApplicationBackend {
    type Subscription: ProcessApplicationSubscription;

    /// Starts lifecycle observation before taking the initial inventory.
    ///
    /// # Errors
    ///
    /// Returns a backend error when a bounded race-free source cannot be established.
    fn open(
        self,
        emitter: ProcessApplicationEmitter,
    ) -> Result<OpenedProcessApplicationBackend<Self::Subscription>, ProcessApplicationError>;
}

pub struct OpenedProcessApplicationBackend<S> {
    pub platform: PlatformFamily,
    pub permission: PermissionState,
    pub adapter_version: &'static str,
    pub initial_state: ProcessApplicationState,
    pub subscription: S,
}

#[derive(Clone)]
pub struct ProcessApplicationEmitter {
    session: SourceSession<ProcessApplicationModel>,
}

struct ProcessApplicationModel;

enum ProcessApplicationInput {
    Transition(Box<ProcessApplicationEvent>),
    Reconcile(ProcessApplicationState),
}

impl SourceStateMachine for ProcessApplicationModel {
    type State = ProcessApplicationState;
    type Input = ProcessApplicationInput;
    type Observation = ProcessApplicationEvent;
    type Error = ProcessApplicationError;

    fn validate_state(state: &Self::State) -> Result<(), Self::Error> {
        state.validate().map_err(Into::into)
    }

    fn health(state: &Self::State) -> SourceHealth {
        health_for(state)
    }

    fn apply(
        previous: Option<&Self::State>,
        input: Self::Input,
    ) -> Result<SourceStateChange<Self::State, Self::Observation>, Self::Error> {
        match input {
            ProcessApplicationInput::Reconcile(state) => {
                state.validate()?;
                if previous == Some(&state) {
                    return Ok(SourceStateChange::Ignore);
                }
                Ok(SourceStateChange::Observe {
                    state: Some(state.clone()),
                    observation: reconciled_event(state),
                })
            }
            ProcessApplicationInput::Transition(event) => {
                event.validate()?;
                let mut state = previous.cloned().ok_or_else(|| {
                    ProcessApplicationError::Backend(
                        "process transition arrived without an initial inventory".to_owned(),
                    )
                })?;
                apply_transition(&mut state, &event)?;
                state.validate()?;
                Ok(SourceStateChange::Observe {
                    state: Some(state),
                    observation: *event,
                })
            }
        }
    }

    fn final_observation(state: Self::State) -> Self::Observation {
        reconciled_event(state)
    }

    fn queue_error(error: QueueError) -> Self::Error {
        ProcessApplicationError::Queue(error)
    }

    fn overflow_error() -> Self::Error {
        ProcessApplicationError::QueueOverflow
    }
}

impl ProcessApplicationEmitter {
    fn new(queue_capacity: usize) -> Result<Self, ProcessApplicationError> {
        Ok(Self {
            session: SourceSession::new(queue_capacity)?,
        })
    }

    /// Enqueues one bounded lifecycle transition from the owning adapter.
    pub fn observe_transition(&self, event: ProcessApplicationEvent) {
        self.session
            .submit(ProcessApplicationInput::Transition(Box::new(event)));
    }

    /// Enqueues one complete inventory reconciliation from the owning adapter.
    pub fn reconcile(&self, state: ProcessApplicationState) {
        self.session
            .submit(ProcessApplicationInput::Reconcile(state));
    }

    /// Marks this source generation failed with a bounded capability error.
    pub fn fail(&self, error: ProcessApplicationError) {
        self.session.fail(error);
    }

    /// Records an exact count of lifecycle transitions lost before delivery.
    pub fn report_missing_transitions(&self, count: u64) {
        self.session.report_missing(count);
    }

    #[must_use]
    /// Returns the fixed capacity an adapter must use for callback ingress.
    pub fn queue_capacity(&self) -> usize {
        self.session.queue_capacity()
    }

    fn finish_open(
        &self,
        state: ProcessApplicationState,
        reset: Option<SourceResetPlan>,
    ) -> Result<SourceSessionMetadata, ProcessApplicationError> {
        let health = health_for(&state);
        self.session.finish_open(state, health, reset)
    }

    fn snapshot(
        platform: PlatformFamily,
        permission: PermissionState,
        adapter_version: &str,
        state: ProcessApplicationState,
        metadata: SourceSessionMetadata,
    ) -> Result<ProcessApplicationSourceSnapshot, ProcessApplicationError> {
        let snapshot = ProcessApplicationSourceSnapshot {
            source_instance_id: metadata.source_instance_id,
            source_version: SOURCE_VERSION.to_owned(),
            adapter_version: adapter_version.to_owned(),
            platform,
            permission,
            health: metadata.health,
            sequence: 0,
            observed_at: metadata.observed_at,
            state,
        };
        snapshot
            .validate_protocol()
            .map_err(ProtocolViolation::from)?;
        Ok(snapshot)
    }

    fn drain(&self) -> ProcessApplicationDrain {
        let session_drain = self.session.drain();
        let source_instance_id = session_drain.source_instance_id.clone();
        let discarded = discarded_fact_range(&session_drain.facts);
        let mut observations = Vec::new();
        let mut resets = Vec::new();
        for fact in session_drain.facts {
            match fact.payload {
                SourceSessionFact::Observation(event) => {
                    let observation = ProcessApplicationObservation {
                        source_instance_id: source_instance_id.clone(),
                        sequence: fact.sequence,
                        observed_at: fact.observed_at,
                        gap: fact.gap,
                        event,
                    };
                    if let Err(error) = observation.validate_protocol() {
                        return self.failed_drain(source_instance_id, discarded, error);
                    }
                    observations.push(observation);
                }
                SourceSessionFact::Reset(reason) => {
                    let reset = SourceReset {
                        source_instance_id: source_instance_id.clone(),
                        sequence: fact.sequence,
                        observed_at: fact.observed_at,
                        gap: fact.gap,
                        reason,
                    };
                    if let Err(error) = reset.validate_protocol() {
                        return self.failed_drain(source_instance_id, discarded, error);
                    }
                    resets.push(reset);
                }
            }
        }
        let drain = ProcessApplicationDrain {
            source_instance_id,
            health: session_drain.health,
            observations,
            resets,
            terminal_error: session_drain
                .terminal_error
                .as_ref()
                .map(ProcessApplicationError::failure_code),
        };
        if let Err(error) = drain.validate_protocol() {
            return self.failed_drain(self.session.metadata().source_instance_id, discarded, error);
        }
        drain
    }

    fn failed_drain(
        &self,
        source_instance_id: String,
        discarded: Option<native_protocol::SequenceGap>,
        error: native_protocol::ProtocolValidationError,
    ) -> ProcessApplicationDrain {
        self.session
            .fail(ProcessApplicationError::Protocol(error.into()));
        let terminal = self.session.drain();
        let observations = discarded
            .and_then(|gap| {
                let sequence = gap.last_missing.checked_add(1)?;
                let state = self.session.last_state()?;
                Some(ProcessApplicationObservation {
                    source_instance_id: source_instance_id.clone(),
                    sequence,
                    observed_at: self.session.metadata().observed_at,
                    gap: Some(gap),
                    event: reconciled_event(state),
                })
            })
            .filter(|observation| observation.validate_protocol().is_ok())
            .into_iter()
            .collect();
        ProcessApplicationDrain {
            source_instance_id,
            health: terminal.health,
            observations,
            resets: Vec::new(),
            terminal_error: terminal
                .terminal_error
                .as_ref()
                .map(ProcessApplicationError::failure_code),
        }
    }
}

fn discarded_fact_range<T>(
    facts: &[native_source_runtime::SequencedObservation<T>],
) -> Option<native_protocol::SequenceGap> {
    let first = facts.first()?;
    let last = facts.last()?;
    Some(native_protocol::SequenceGap {
        first_missing: first
            .gap
            .as_ref()
            .map_or(first.sequence, |gap| gap.first_missing),
        last_missing: last.sequence,
    })
}

pub struct ProcessApplicationSource<S: ProcessApplicationSubscription> {
    emitter: ProcessApplicationEmitter,
    snapshot: ProcessApplicationSourceSnapshot,
    subscription: Option<S>,
}

impl<S: ProcessApplicationSubscription> ProcessApplicationSource<S> {
    /// Opens one race-free passive process/application source.
    ///
    /// # Errors
    ///
    /// Returns a validation, backend, queue, or cleanup error.
    pub fn open<B>(request: &SourceOpenRequest, backend: B) -> Result<Self, ProcessApplicationError>
    where
        B: ProcessApplicationBackend<Subscription = S>,
    {
        Self::open_internal(request, backend, None)
    }

    /// Opens a replacement source and records a supervised restart fence.
    ///
    /// # Errors
    ///
    /// Returns a validation, backend, queue, reset, or cleanup error.
    pub fn open_after_reset<B>(
        request: &SourceOpenRequest,
        backend: B,
        missing_count: u64,
        reason: String,
    ) -> Result<Self, ProcessApplicationError>
    where
        B: ProcessApplicationBackend<Subscription = S>,
    {
        let reset = SourceResetPlan::new(missing_count, reason)?;
        Self::open_internal(request, backend, Some(reset))
    }

    fn open_internal<B>(
        request: &SourceOpenRequest,
        backend: B,
        reset: Option<SourceResetPlan>,
    ) -> Result<Self, ProcessApplicationError>
    where
        B: ProcessApplicationBackend<Subscription = S>,
    {
        request.validate()?;
        ensure_native_source_process_usable()
            .map_err(|error| ProcessApplicationError::Cleanup(error.to_string()))?;
        let emitter = ProcessApplicationEmitter::new(usize::from(request.queue_capacity))?;
        let opened = backend.open(emitter.clone())?;
        let initial_state = opened.initial_state.clone();
        let subscription = opened.subscription;
        let snapshot_metadata = match emitter.finish_open(opened.initial_state, reset) {
            Ok(metadata) => metadata,
            Err(error) => return Err(rollback_subscription(error, subscription)),
        };
        let snapshot = match ProcessApplicationEmitter::snapshot(
            opened.platform,
            opened.permission,
            opened.adapter_version,
            initial_state,
            snapshot_metadata,
        ) {
            Ok(snapshot) => snapshot,
            Err(error) => return Err(rollback_subscription(error, subscription)),
        };
        Ok(Self {
            emitter,
            snapshot,
            subscription: Some(subscription),
        })
    }

    #[must_use]
    pub fn snapshot(&self) -> &ProcessApplicationSourceSnapshot {
        &self.snapshot
    }

    pub fn drain(&self) -> ProcessApplicationDrain {
        self.emitter.drain()
    }

    #[must_use]
    pub fn health(&self) -> SourceHealth {
        self.emitter.session.health()
    }

    #[must_use]
    pub fn stop(&mut self) -> ProcessApplicationDrain {
        if let Some(subscription) = self.subscription.take() {
            let final_state = stop_subscription(subscription);
            self.emitter.session.begin_stop();
            self.emitter.session.finish_stop(final_state);
        }
        let drain = self.emitter.drain();
        self.emitter.session.dispose();
        drain
    }
}

impl<S: ProcessApplicationSubscription> Drop for ProcessApplicationSource<S> {
    fn drop(&mut self) {
        let _ = self.stop();
    }
}

fn apply_transition(
    state: &mut ProcessApplicationState,
    event: &ProcessApplicationEvent,
) -> Result<(), ProcessApplicationError> {
    match event.kind {
        ProcessApplicationEventKind::Started => {
            let process = event.process.clone().ok_or_else(incoherent_transition)?;
            if state
                .processes
                .iter()
                .any(|existing| existing.process_instance_id == process.process_instance_id)
            {
                return Err(incoherent_transition());
            }
            state.processes.push(process);
        }
        ProcessApplicationEventKind::IdentityChanged => {
            let process = event.process.clone().ok_or_else(incoherent_transition)?;
            let existing = state
                .processes
                .iter_mut()
                .find(|existing| existing.process_instance_id == process.process_instance_id)
                .ok_or_else(incoherent_transition)?;
            *existing = process;
        }
        ProcessApplicationEventKind::Exited => {
            let process_instance_id = event
                .process_instance_id
                .as_ref()
                .ok_or_else(incoherent_transition)?;
            let previous_length = state.processes.len();
            state
                .processes
                .retain(|process| &process.process_instance_id != process_instance_id);
            if state.processes.len() == previous_length {
                return Err(incoherent_transition());
            }
        }
        ProcessApplicationEventKind::Reconciled => {
            return Err(incoherent_transition());
        }
    }
    Ok(())
}

fn incoherent_transition() -> ProcessApplicationError {
    ProcessApplicationError::Backend(
        "process transition is inconsistent with the current inventory".to_owned(),
    )
}

fn reconciled_event(state: ProcessApplicationState) -> ProcessApplicationEvent {
    ProcessApplicationEvent {
        capture_delay_ns: None,
        kind: ProcessApplicationEventKind::Reconciled,
        process_instance_id: None,
        process: None,
        state: Some(state),
    }
}

fn health_for(state: &ProcessApplicationState) -> SourceHealth {
    use native_protocol::{ProcessApplicationCertainty, ProcessApplicationCoverage};

    if !matches!(state.coverage, ProcessApplicationCoverage::FullLifecycle)
        || !matches!(state.certainty, ProcessApplicationCertainty::Complete)
        || state.processes.iter().any(|process| {
            matches!(
                process.identity.status,
                ProcessExecutableIdentityStatus::Pending
                    | ProcessExecutableIdentityStatus::Unavailable
            )
        })
    {
        SourceHealth::Degraded
    } else {
        SourceHealth::Healthy
    }
}

fn rollback_subscription<S: ProcessApplicationSubscription>(
    primary: ProcessApplicationError,
    subscription: S,
) -> ProcessApplicationError {
    prefer_boundary_error(primary, stop_subscription(subscription))
}

fn stop_subscription<S: ProcessApplicationSubscription>(
    subscription: S,
) -> Result<ProcessApplicationState, ProcessApplicationError> {
    run_bounded_source_stop(
        "process-application-stop",
        move || subscription.stop(),
        bounded_cleanup_error,
    )
}

fn bounded_cleanup_error(error: BoundedTaskError) -> ProcessApplicationError {
    ProcessApplicationError::Cleanup(format!(
        "observer shutdown {error}; native utility restart is required"
    ))
}

#[cfg(target_os = "windows")]
pub use platform::{
    UnavailableWindowsPrefixBarrier, WindowsCandidateSession, WindowsCompletePrefixBarrier,
    WindowsEnrichedProcessEvent, WindowsInventoryCapture, WindowsInventoryFact,
    WindowsLifecycleEvent, WindowsLifecycleFailure, WindowsLifecycleSnapshot,
    WindowsPinnedProcessInventory, WindowsPinnedProcessScope, WindowsPrefixCheckpoint,
    WindowsProcessAccount, WindowsProcessReconciler, WindowsProcessScopeBackend, WindowsScopeDrain,
    WindowsScopeEnricher,
};

#[cfg(test)]
mod tests {
    use super::*;
    use native_protocol::{
        ProcessApplicationCertainty, ProcessApplicationCoverage, ProcessApplicationProcess,
        ProcessApplicationScope, ProcessExecutableIdentity,
    };

    struct FakeBackend {
        initial: ProcessApplicationState,
        during_open: Vec<ProcessApplicationEvent>,
        final_state: ProcessApplicationState,
    }

    struct FakeSubscription(ProcessApplicationState);

    impl ProcessApplicationSubscription for FakeSubscription {
        fn stop(self) -> Result<ProcessApplicationState, ProcessApplicationError> {
            Ok(self.0)
        }
    }

    impl ProcessApplicationBackend for FakeBackend {
        type Subscription = FakeSubscription;

        fn open(
            self,
            emitter: ProcessApplicationEmitter,
        ) -> Result<OpenedProcessApplicationBackend<Self::Subscription>, ProcessApplicationError>
        {
            for event in self.during_open {
                emitter.observe_transition(event);
            }
            Ok(OpenedProcessApplicationBackend {
                platform: PlatformFamily::Linux,
                permission: PermissionState::Granted,
                adapter_version: "fake-process",
                initial_state: self.initial,
                subscription: FakeSubscription(self.final_state),
            })
        }
    }

    fn pending_process(id: &str) -> ProcessApplicationProcess {
        ProcessApplicationProcess {
            process_instance_id: id.to_owned(),
            scope: ProcessApplicationScope::CandidateInteractiveSession,
            identity: ProcessExecutableIdentity {
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
            },
        }
    }

    fn state(processes: Vec<ProcessApplicationProcess>) -> ProcessApplicationState {
        ProcessApplicationState {
            coverage: ProcessApplicationCoverage::FullLifecycle,
            certainty: ProcessApplicationCertainty::Complete,
            processes,
        }
    }

    #[test]
    fn only_backend_probe_failures_may_degrade_to_unavailable_coverage() {
        assert!(
            ProcessApplicationError::Backend("missing service".to_owned())
                .allows_initial_unavailable_fallback()
        );
        assert!(
            !ProcessApplicationError::InventoryOverflow("bounded inventory".to_owned())
                .allows_initial_unavailable_fallback()
        );
        assert!(
            !ProcessApplicationError::Cleanup("unproved fence".to_owned())
                .allows_initial_unavailable_fallback()
        );
    }

    fn event(
        kind: ProcessApplicationEventKind,
        process: Option<ProcessApplicationProcess>,
    ) -> ProcessApplicationEvent {
        ProcessApplicationEvent {
            capture_delay_ns: None,
            kind,
            process_instance_id: process
                .as_ref()
                .map(|process| process.process_instance_id.clone()),
            process,
            state: None,
        }
    }

    fn request() -> SourceOpenRequest {
        SourceOpenRequest {
            collection_session_id: "process-application-0001".to_owned(),
            queue_capacity: 8,
        }
    }

    #[test]
    fn transition_during_open_is_delivered_strictly_after_snapshot_zero() {
        let process = pending_process("process-instance-0001");
        let backend = FakeBackend {
            initial: state(Vec::new()),
            during_open: vec![event(
                ProcessApplicationEventKind::Started,
                Some(process.clone()),
            )],
            final_state: state(vec![process]),
        };
        let mut source = ProcessApplicationSource::open(&request(), backend).expect("source opens");
        assert_eq!(source.snapshot().sequence, 0);
        assert!(source.snapshot().state.processes.is_empty());
        let drain = source.drain();
        assert_eq!(drain.observations.len(), 1);
        assert_eq!(drain.observations[0].sequence, 1);
        assert_eq!(
            drain.observations[0].event.kind,
            ProcessApplicationEventKind::Started
        );
        assert_eq!(source.stop().health, SourceHealth::Stopped);
    }

    #[test]
    fn duplicate_start_fails_instead_of_hiding_a_lifecycle_gap() {
        let process = pending_process("process-instance-0001");
        let backend = FakeBackend {
            initial: state(vec![process.clone()]),
            during_open: vec![event(
                ProcessApplicationEventKind::Started,
                Some(process.clone()),
            )],
            final_state: state(vec![process]),
        };
        let source = ProcessApplicationSource::open(&request(), backend).expect("source opens");
        let drain = source.drain();
        assert_eq!(drain.health, SourceHealth::Failed);
        assert_eq!(drain.terminal_error, Some(SourceFailureCode::Backend));
    }

    #[test]
    fn platform_adapter_reports_truthful_snapshot_or_unavailable_coverage() {
        #[cfg(target_os = "linux")]
        let backend = LinuxProcessApplicationBackend;
        #[cfg(target_os = "macos")]
        let backend = MacOsProcessApplicationBackend;
        #[cfg(target_os = "windows")]
        let backend = WindowsProcessApplicationBackend;

        let mut source = ProcessApplicationSource::open(&request(), backend).expect("source opens");
        assert_eq!(source.snapshot().health, SourceHealth::Degraded);
        match source.snapshot().state.coverage {
            ProcessApplicationCoverage::SnapshotOnly => {
                assert_eq!(source.snapshot().permission, PermissionState::Granted);
            }
            ProcessApplicationCoverage::Unavailable => {
                assert_eq!(source.snapshot().permission, PermissionState::Unavailable);
            }
            ProcessApplicationCoverage::FullLifecycle => {
                panic!("snapshot adapter must not claim full lifecycle coverage");
            }
        }
        assert_eq!(source.stop().health, SourceHealth::Stopped);
    }
}
