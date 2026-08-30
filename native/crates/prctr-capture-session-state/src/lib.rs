mod platform;

use std::fmt;

use prctr_native_protocol::{
    CAPTURE_SESSION_SCHEMA_VERSION, CaptureSessionCertainty, CaptureSessionDrain,
    CaptureSessionObservation, CaptureSessionSourceSnapshot, CaptureSessionState,
    CaptureSessionSupport, PermissionState, PlatformFamily, ProtocolValidatable, ProtocolViolation,
    SourceFailureCode, SourceHealth, SourceOpenRequest, SourceReset,
};
use prctr_native_source_runtime::{
    BoundedTaskError, QueueError, SourceModel, SourceResetPlan, SourceSession, SourceSessionFact,
    SourceSessionMetadata, SourceStateChange, ensure_native_source_process_usable,
    prefer_boundary_error, run_bounded_source_stop,
};

#[cfg(target_os = "linux")]
pub use platform::LinuxCaptureSessionBackend;
#[cfg(target_os = "macos")]
pub use platform::MacOsCaptureSessionBackend;
#[cfg(any(target_os = "linux", target_os = "macos"))]
#[doc(hidden)]
pub use platform::StaticCoverageSubscription;
#[cfg(target_os = "windows")]
pub use platform::WindowsCaptureSessionBackend;

pub const SOURCE_VERSION: &str = env!("CARGO_PKG_VERSION");

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum CaptureSessionError {
    Backend(String),
    Cleanup(String),
    Protocol(ProtocolViolation),
    Queue(QueueError),
    QueueOverflow,
}

impl CaptureSessionError {
    /// Projects the capability error onto the bounded native protocol category.
    #[must_use]
    pub const fn failure_code(&self) -> SourceFailureCode {
        match self {
            Self::Backend(_) => SourceFailureCode::Backend,
            Self::Cleanup(_) => SourceFailureCode::Cleanup,
            Self::Protocol(_) => SourceFailureCode::Protocol,
            Self::Queue(_) => SourceFailureCode::Queue,
            Self::QueueOverflow => SourceFailureCode::QueueOverflow,
        }
    }
}

impl fmt::Display for CaptureSessionError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Backend(reason) => write!(formatter, "capture-session backend failed: {reason}"),
            Self::Cleanup(reason) => write!(formatter, "capture-session cleanup failed: {reason}"),
            Self::Protocol(error) => {
                write!(formatter, "capture-session protocol violation: {error}")
            }
            Self::Queue(error) => write!(formatter, "capture-session queue failed: {error}"),
            Self::QueueOverflow => formatter.write_str("capture-session source queue overflowed"),
        }
    }
}

impl std::error::Error for CaptureSessionError {}

impl From<ProtocolViolation> for CaptureSessionError {
    fn from(error: ProtocolViolation) -> Self {
        Self::Protocol(error)
    }
}

impl From<QueueError> for CaptureSessionError {
    fn from(error: QueueError) -> Self {
        Self::Queue(error)
    }
}

/// Owns one passive OS observation registration or polling worker.
pub trait CaptureSessionSubscription: Send + 'static {
    /// Fences further observations and returns a fresh final mechanical state.
    ///
    /// # Errors
    ///
    /// Returns a cleanup or backend error when a closed-input boundary cannot be established.
    fn stop(self) -> Result<CaptureSessionState, CaptureSessionError>;
}

pub trait CaptureSessionBackend {
    type Subscription: CaptureSessionSubscription;

    /// Starts observation before taking the initial state, avoiding a snapshot/subscription race.
    ///
    /// # Errors
    ///
    /// Returns a backend error when the source cannot establish a bounded observation session.
    fn open(
        self,
        emitter: CaptureSessionEmitter,
    ) -> Result<OpenedCaptureSessionBackend<Self::Subscription>, CaptureSessionError>;
}

pub struct OpenedCaptureSessionBackend<S> {
    pub platform: PlatformFamily,
    pub permission: PermissionState,
    pub adapter_version: &'static str,
    pub initial_state: CaptureSessionState,
    pub subscription: S,
}

#[derive(Clone)]
pub struct CaptureSessionEmitter {
    session: SourceSession<CaptureSessionModel>,
}

struct CaptureSessionModel;

enum CaptureSessionInput {
    #[cfg_attr(not(test), allow(dead_code))]
    Refresh(Result<CaptureSessionState, CaptureSessionError>),
    #[cfg(any(target_os = "windows", test))]
    Transition(Result<CaptureSessionState, CaptureSessionError>),
}

impl SourceModel for CaptureSessionModel {
    type State = CaptureSessionState;
    type Input = CaptureSessionInput;
    type Observation = CaptureSessionState;
    type Error = CaptureSessionError;

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
        let (state, preserve_duplicate) = match input {
            CaptureSessionInput::Refresh(state) => (state?, false),
            #[cfg(any(target_os = "windows", test))]
            CaptureSessionInput::Transition(state) => (state?, true),
        };
        state.validate()?;
        if !preserve_duplicate && previous == Some(&state) {
            return Ok(SourceStateChange::Ignore);
        }
        Ok(SourceStateChange::Observe {
            state: Some(state.clone()),
            observation: state,
        })
    }

    fn final_observation(state: Self::State) -> Self::Observation {
        state
    }

    fn queue_error(error: QueueError) -> Self::Error {
        CaptureSessionError::Queue(error)
    }

    fn overflow_error() -> Self::Error {
        CaptureSessionError::QueueOverflow
    }
}

impl CaptureSessionEmitter {
    fn new(queue_capacity: usize) -> Result<Self, CaptureSessionError> {
        Ok(Self {
            session: SourceSession::new(queue_capacity)?,
        })
    }

    #[cfg(test)]
    pub(crate) fn observe(&self, state: Result<CaptureSessionState, CaptureSessionError>) {
        self.session.submit(CaptureSessionInput::Refresh(state));
    }

    /// Records an OS transition wakeup. A listener-backed transition remains
    /// observable even when a fresh query equals the preceding state.
    #[cfg(any(target_os = "windows", test))]
    pub(crate) fn observe_transition(
        &self,
        state: Result<CaptureSessionState, CaptureSessionError>,
    ) {
        self.session.submit(CaptureSessionInput::Transition(state));
    }

    #[cfg(target_os = "windows")]
    pub(crate) fn fail(&self, error: CaptureSessionError) {
        self.session.fail(error);
    }

    #[cfg(target_os = "windows")]
    pub(crate) fn report_missing_transitions(&self, count: u64) {
        self.session.report_missing(count);
    }

    #[cfg(target_os = "windows")]
    #[must_use]
    pub(crate) fn queue_capacity(&self) -> usize {
        self.session.queue_capacity()
    }

    fn finish_open(
        &self,
        state: CaptureSessionState,
        reset: Option<SourceResetPlan>,
    ) -> Result<SourceSessionMetadata, CaptureSessionError> {
        let health = health_for(&state);
        self.session.finish_open(state, health, reset)
    }

    fn snapshot(
        platform: PlatformFamily,
        permission: PermissionState,
        adapter_version: &str,
        state: CaptureSessionState,
        metadata: SourceSessionMetadata,
    ) -> Result<CaptureSessionSourceSnapshot, CaptureSessionError> {
        let snapshot = CaptureSessionSourceSnapshot {
            source_instance_id: metadata.source_instance_id,
            source_version: SOURCE_VERSION.to_owned(),
            adapter_version: adapter_version.to_owned(),
            schema_version: CAPTURE_SESSION_SCHEMA_VERSION,
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

    fn drain(&self) -> CaptureSessionDrain {
        let session_drain = self.session.drain();
        let source_instance_id = session_drain.source_instance_id;
        let mut observations = Vec::new();
        let mut resets = Vec::new();
        for fact in session_drain.facts {
            match fact.payload {
                SourceSessionFact::Observation(state) => {
                    let observation = CaptureSessionObservation {
                        source_instance_id: source_instance_id.clone(),
                        sequence: fact.sequence,
                        observed_at: fact.observed_at,
                        gap: fact.gap,
                        state,
                    };
                    if let Err(error) = observation.validate_protocol() {
                        self.session
                            .fail(CaptureSessionError::Protocol(error.into()));
                        break;
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
                        self.session
                            .fail(CaptureSessionError::Protocol(error.into()));
                        break;
                    }
                    resets.push(reset);
                }
            }
        }
        let mut drain = CaptureSessionDrain {
            source_instance_id,
            health: session_drain.health,
            observations,
            resets,
            terminal_error: session_drain
                .terminal_error
                .as_ref()
                .map(CaptureSessionError::failure_code),
        };
        if let Err(error) = drain.validate_protocol() {
            self.session
                .fail(CaptureSessionError::Protocol(error.into()));
            let terminal = self.session.drain();
            drain.observations.clear();
            drain.resets.clear();
            drain.health = terminal.health;
            drain.terminal_error = terminal
                .terminal_error
                .as_ref()
                .map(CaptureSessionError::failure_code);
        }
        drain
    }
}

pub struct CaptureSessionSource<S: CaptureSessionSubscription> {
    emitter: CaptureSessionEmitter,
    snapshot: CaptureSessionSourceSnapshot,
    subscription: Option<S>,
}

impl<S: CaptureSessionSubscription> CaptureSessionSource<S> {
    /// Opens one race-free passive capture/session observation source.
    ///
    /// # Errors
    ///
    /// Returns a validation, backend, queue, or cleanup error.
    pub fn open<B>(request: &SourceOpenRequest, backend: B) -> Result<Self, CaptureSessionError>
    where
        B: CaptureSessionBackend<Subscription = S>,
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
    ) -> Result<Self, CaptureSessionError>
    where
        B: CaptureSessionBackend<Subscription = S>,
    {
        let reset = SourceResetPlan::new(missing_count, reason)?;
        Self::open_internal(request, backend, Some(reset))
    }

    fn open_internal<B>(
        request: &SourceOpenRequest,
        backend: B,
        reset: Option<SourceResetPlan>,
    ) -> Result<Self, CaptureSessionError>
    where
        B: CaptureSessionBackend<Subscription = S>,
    {
        request.validate_capture_session()?;
        ensure_native_source_process_usable()
            .map_err(|error| CaptureSessionError::Cleanup(error.to_string()))?;
        let emitter = CaptureSessionEmitter::new(usize::from(request.queue_capacity))?;
        let opened = backend.open(emitter.clone())?;
        let initial_state = opened.initial_state.clone();
        let subscription = opened.subscription;
        let snapshot_metadata = match emitter.finish_open(opened.initial_state, reset) {
            Ok(metadata) => metadata,
            Err(error) => return Err(rollback_subscription(error, subscription)),
        };
        let snapshot = match CaptureSessionEmitter::snapshot(
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
    pub fn snapshot(&self) -> &CaptureSessionSourceSnapshot {
        &self.snapshot
    }

    pub fn drain(&self) -> CaptureSessionDrain {
        self.emitter.drain()
    }

    #[must_use]
    pub fn health(&self) -> SourceHealth {
        self.emitter.session.health()
    }

    /// Fences input, obtains the final state behind a hard deadline, and drains the source.
    pub fn stop(&mut self) -> CaptureSessionDrain {
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

impl<S: CaptureSessionSubscription> Drop for CaptureSessionSource<S> {
    fn drop(&mut self) {
        let _ = self.stop();
    }
}

fn health_for(state: &CaptureSessionState) -> SourceHealth {
    let incomplete_supported_signal = [&state.screen_capture, &state.native_remote_session]
        .into_iter()
        .any(|signal| {
            matches!(signal.support, CaptureSessionSupport::Supported)
                && !matches!(signal.certainty, CaptureSessionCertainty::Complete)
        });
    if incomplete_supported_signal {
        SourceHealth::Degraded
    } else {
        SourceHealth::Healthy
    }
}

fn rollback_subscription<S: CaptureSessionSubscription>(
    primary: CaptureSessionError,
    subscription: S,
) -> CaptureSessionError {
    prefer_boundary_error(primary, stop_subscription(subscription))
}

fn stop_subscription<S: CaptureSessionSubscription>(
    subscription: S,
) -> Result<CaptureSessionState, CaptureSessionError> {
    run_bounded_source_stop(
        "prctr-capture-session-stop",
        move || subscription.stop(),
        bounded_cleanup_error,
    )
}

fn bounded_cleanup_error(error: BoundedTaskError) -> CaptureSessionError {
    CaptureSessionError::Cleanup(format!(
        "observer shutdown {error}; native utility restart is required"
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    use prctr_native_protocol::{CaptureSessionActivity, CaptureSessionSignal, SequenceGap};

    struct FakeBackend {
        initial: CaptureSessionState,
        during_open: Vec<CaptureSessionState>,
        final_state: CaptureSessionState,
    }

    struct FakeSubscription(CaptureSessionState);

    impl CaptureSessionSubscription for FakeSubscription {
        fn stop(self) -> Result<CaptureSessionState, CaptureSessionError> {
            Ok(self.0)
        }
    }

    impl CaptureSessionBackend for FakeBackend {
        type Subscription = FakeSubscription;

        fn open(
            self,
            emitter: CaptureSessionEmitter,
        ) -> Result<OpenedCaptureSessionBackend<Self::Subscription>, CaptureSessionError> {
            for state in self.during_open {
                emitter.observe(Ok(state));
            }
            Ok(OpenedCaptureSessionBackend {
                platform: PlatformFamily::Linux,
                permission: PermissionState::Granted,
                adapter_version: "fake-v1",
                initial_state: self.initial,
                subscription: FakeSubscription(self.final_state),
            })
        }
    }

    fn supported(activity: CaptureSessionActivity) -> CaptureSessionSignal {
        CaptureSessionSignal {
            support: CaptureSessionSupport::Supported,
            activity,
            certainty: CaptureSessionCertainty::Complete,
        }
    }

    fn unsupported() -> CaptureSessionSignal {
        CaptureSessionSignal {
            support: CaptureSessionSupport::Unsupported,
            activity: CaptureSessionActivity::Unknown,
            certainty: CaptureSessionCertainty::Unknown,
        }
    }

    fn state(activity: CaptureSessionActivity) -> CaptureSessionState {
        CaptureSessionState {
            screen_capture: unsupported(),
            native_remote_session: supported(activity),
        }
    }

    fn request(capacity: u16) -> SourceOpenRequest {
        SourceOpenRequest {
            collection_session_id: "capture-session-0001".to_owned(),
            requested_schema_version: CAPTURE_SESSION_SCHEMA_VERSION,
            queue_capacity: capacity,
        }
    }

    /// Shared black-box contract for every real platform adapter. It uses only
    /// the public source lifecycle and wire validation surfaces.
    fn assert_adapter_baseline_conformance<B>(
        backend: B,
        expected_platform: PlatformFamily,
        expected_permission: PermissionState,
        expected_screen_support: CaptureSessionSupport,
        expected_remote_support: CaptureSessionSupport,
    ) where
        B: CaptureSessionBackend,
    {
        let mut source = CaptureSessionSource::<B::Subscription>::open(&request(8), backend)
            .expect("real adapter opens");
        let snapshot = source.snapshot();
        snapshot
            .validate_protocol()
            .expect("snapshot follows capture/session protocol");
        assert_eq!(snapshot.platform, expected_platform);
        assert_eq!(snapshot.permission, expected_permission);
        assert!(!snapshot.adapter_version.is_empty());
        assert_eq!(
            snapshot.state.screen_capture.support,
            expected_screen_support
        );
        assert_eq!(
            snapshot.state.native_remote_session.support,
            expected_remote_support
        );
        assert!(matches!(
            source.health(),
            SourceHealth::Healthy | SourceHealth::Degraded
        ));

        let opened_drain = source.drain();
        opened_drain
            .validate_protocol()
            .expect("empty opened drain follows protocol");
        assert!(opened_drain.observations.is_empty());
        assert!(opened_drain.resets.is_empty());
        assert_eq!(opened_drain.terminal_error, None);

        let stopped = source.stop();
        stopped
            .validate_protocol()
            .expect("stopped drain follows protocol");
        assert_eq!(stopped.health, SourceHealth::Stopped);
        assert_eq!(stopped.terminal_error, None);
        assert_eq!(stopped.observations.len(), 1);
        assert_eq!(stopped.observations[0].sequence, 1);
        stopped.observations[0]
            .validate_protocol()
            .expect("final observation follows protocol");

        let repeated_stop = source.stop();
        repeated_stop
            .validate_protocol()
            .expect("repeated stop remains protocol-valid");
        assert_eq!(repeated_stop.health, SourceHealth::Stopped);
        assert!(repeated_stop.observations.is_empty());
        assert!(repeated_stop.resets.is_empty());
    }

    #[test]
    fn registration_precedes_initial_state_without_losing_transition() {
        let inactive = state(CaptureSessionActivity::Inactive);
        let active = state(CaptureSessionActivity::Active);
        let source = CaptureSessionSource::<FakeSubscription>::open(
            &request(8),
            FakeBackend {
                initial: inactive.clone(),
                during_open: vec![active.clone()],
                final_state: active.clone(),
            },
        )
        .expect("source opens");

        assert_eq!(source.snapshot().state, inactive);
        assert_eq!(source.drain().observations[0].state, active);
    }

    #[test]
    fn duplicate_polls_are_coalesced() {
        let inactive = state(CaptureSessionActivity::Inactive);
        let source = CaptureSessionSource::<FakeSubscription>::open(
            &request(8),
            FakeBackend {
                initial: inactive.clone(),
                during_open: Vec::new(),
                final_state: inactive.clone(),
            },
        )
        .expect("source opens");
        source.emitter.observe(Ok(inactive));
        assert!(source.drain().observations.is_empty());
    }

    #[test]
    fn explicit_transition_is_preserved_when_state_is_unchanged() {
        let inactive = state(CaptureSessionActivity::Inactive);
        let source = CaptureSessionSource::<FakeSubscription>::open(
            &request(8),
            FakeBackend {
                initial: inactive.clone(),
                during_open: Vec::new(),
                final_state: inactive.clone(),
            },
        )
        .expect("source opens");
        source.emitter.observe_transition(Ok(inactive));
        assert_eq!(source.drain().observations.len(), 1);
    }

    #[test]
    fn queue_overflow_is_terminal_and_preserves_the_gap() {
        let source = CaptureSessionSource::<FakeSubscription>::open(
            &request(2),
            FakeBackend {
                initial: state(CaptureSessionActivity::Inactive),
                during_open: vec![
                    state(CaptureSessionActivity::Active),
                    state(CaptureSessionActivity::Inactive),
                    state(CaptureSessionActivity::Active),
                ],
                final_state: state(CaptureSessionActivity::Active),
            },
        )
        .expect("source opens in terminal state");
        let drain = source.drain();
        assert_eq!(drain.health, SourceHealth::Failed);
        assert_eq!(drain.terminal_error, Some(SourceFailureCode::QueueOverflow));
        assert_eq!(
            drain.observations[0].gap,
            Some(SequenceGap {
                first_missing: 1,
                last_missing: 1,
            })
        );
    }

    #[test]
    fn supervised_restart_emits_reset_before_observations() {
        let active = state(CaptureSessionActivity::Active);
        let source = CaptureSessionSource::<FakeSubscription>::open_after_reset(
            &request(8),
            FakeBackend {
                initial: active.clone(),
                during_open: Vec::new(),
                final_state: active,
            },
            2,
            "adapter restarted".to_owned(),
        )
        .expect("source reopens");
        let drain = source.drain();
        assert_eq!(drain.resets.len(), 1);
        assert_eq!(drain.resets[0].sequence, 3);
        assert_eq!(
            drain.resets[0].gap.as_ref().map(|gap| gap.first_missing),
            Some(1)
        );
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn macos_adapter_passes_shared_baseline_conformance() {
        assert_adapter_baseline_conformance(
            MacOsCaptureSessionBackend,
            PlatformFamily::Macos,
            PermissionState::Unavailable,
            CaptureSessionSupport::Unsupported,
            CaptureSessionSupport::Unsupported,
        );
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn linux_adapter_passes_shared_baseline_conformance() {
        assert_adapter_baseline_conformance(
            LinuxCaptureSessionBackend,
            PlatformFamily::Linux,
            PermissionState::Unavailable,
            CaptureSessionSupport::Unsupported,
            CaptureSessionSupport::Unsupported,
        );
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn windows_adapter_passes_shared_baseline_conformance() {
        assert_adapter_baseline_conformance(
            WindowsCaptureSessionBackend,
            PlatformFamily::Windows,
            PermissionState::Granted,
            CaptureSessionSupport::Unsupported,
            CaptureSessionSupport::Supported,
        );
    }
}
