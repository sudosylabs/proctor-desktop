#![forbid(unsafe_code)]

mod platform;

use std::fmt;

use native_protocol::{
    CANDIDATE_WINDOW_SCHEMA_VERSION, CandidateWindowCertainty, CandidateWindowDrain,
    CandidateWindowEvent, CandidateWindowObservation, CandidateWindowSourceSnapshot,
    CandidateWindowState, PermissionState, PlatformFamily, ProtocolValidatable, ProtocolViolation,
    SourceFailureCode, SourceHealth, SourceOpenRequest, SourceReset,
};
use native_source_runtime::{
    BoundedTaskError, QueueError, SourceModel, SourceResetPlan, SourceSession, SourceSessionFact,
    SourceSessionMetadata, SourceStateChange, ensure_native_source_process_usable,
    prefer_boundary_error, run_bounded_source_stop,
};

#[cfg(target_os = "linux")]
pub use platform::LinuxCandidateWindowBackend;
#[cfg(target_os = "macos")]
pub use platform::MacOsCandidateWindowBackend;
#[cfg(target_os = "windows")]
pub use platform::WindowsCandidateWindowBackend;
pub use platform::{
    CandidateWindowUtilityIngress, CandidateWindowUtilityIngressOutcome,
    CandidateWindowUtilityReceiver, candidate_window_utility_ingress,
};

pub const SOURCE_VERSION: &str = env!("CARGO_PKG_VERSION");

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum CandidateWindowError {
    Backend(String),
    Cleanup(String),
    Protocol(ProtocolViolation),
    Queue(QueueError),
    QueueOverflow,
}

impl CandidateWindowError {
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

impl fmt::Display for CandidateWindowError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Backend(reason) => write!(formatter, "CandidateWindow backend failed: {reason}"),
            Self::Cleanup(reason) => write!(formatter, "CandidateWindow cleanup failed: {reason}"),
            Self::Protocol(error) => {
                write!(formatter, "CandidateWindow protocol violation: {error}")
            }
            Self::Queue(error) => write!(formatter, "CandidateWindow queue failed: {error}"),
            Self::QueueOverflow => formatter.write_str("CandidateWindow source queue overflowed"),
        }
    }
}

impl std::error::Error for CandidateWindowError {}

impl From<ProtocolViolation> for CandidateWindowError {
    fn from(error: ProtocolViolation) -> Self {
        Self::Protocol(error)
    }
}

impl From<QueueError> for CandidateWindowError {
    fn from(error: QueueError) -> Self {
        Self::Queue(error)
    }
}

/// Owns the privileged listener registration associated with one source.
///
/// `stop` must fence further callbacks before taking the final state. The
/// source executes it behind a hard deadline and poisons this utility process
/// if the boundary cannot be closed safely.
pub trait CandidateWindowSubscription: Send + 'static {
    /// Fences callbacks, releases registration resources, and returns the
    /// final mechanical state at the closed-input boundary.
    ///
    /// # Errors
    ///
    /// Returns a cleanup or backend failure when the boundary cannot be
    /// established.
    fn stop(self) -> Result<CandidateWindowState, CandidateWindowError>;
}

pub trait CandidateWindowBackend {
    type Subscription: CandidateWindowSubscription;

    /// Registers privileged `CandidateWindow` listeners before returning the
    /// initial state, eliminating the snapshot/subscription race.
    ///
    /// # Errors
    ///
    /// Returns a backend error when listener registration or the initial state
    /// cannot be established.
    fn open(
        self,
        emitter: CandidateWindowEmitter,
    ) -> Result<OpenedCandidateWindowBackend<Self::Subscription>, CandidateWindowError>;
}

pub struct OpenedCandidateWindowBackend<S> {
    pub platform: PlatformFamily,
    pub permission: PermissionState,
    pub adapter_version: &'static str,
    pub initial_window: CandidateWindowState,
    pub subscription: S,
}

#[derive(Clone)]
pub struct CandidateWindowEmitter {
    session: SourceSession<CandidateWindowModel>,
}

enum CandidateWindowInput {
    State {
        window: Result<CandidateWindowState, CandidateWindowError>,
        preserve_duplicate: bool,
    },
    CloseAttempt,
}

struct CandidateWindowModel;

impl SourceModel for CandidateWindowModel {
    type State = CandidateWindowState;
    type Input = CandidateWindowInput;
    type Observation = CandidateWindowEvent;
    type Error = CandidateWindowError;

    fn validate_state(state: &Self::State) -> Result<(), Self::Error> {
        state.validate().map_err(Into::into)
    }

    fn health(state: &Self::State) -> SourceHealth {
        health_for(state.certainty)
    }

    fn apply(
        previous: Option<&Self::State>,
        input: Self::Input,
    ) -> Result<SourceStateChange<Self::State, Self::Observation>, Self::Error> {
        match input {
            CandidateWindowInput::State {
                window,
                preserve_duplicate,
            } => {
                let window = window?;
                window.validate()?;
                if !preserve_duplicate && previous == Some(&window) {
                    return Ok(SourceStateChange::Ignore);
                }
                Ok(SourceStateChange::Observe {
                    state: Some(window.clone()),
                    observation: CandidateWindowEvent {
                        window,
                        close_attempts_since_previous: 0,
                    },
                })
            }
            CandidateWindowInput::CloseAttempt => {
                let window = previous.cloned().ok_or_else(|| {
                    CandidateWindowError::Backend(
                        "close attempt arrived without an established CandidateWindow state"
                            .to_owned(),
                    )
                })?;
                Ok(SourceStateChange::Observe {
                    state: None,
                    observation: CandidateWindowEvent {
                        window,
                        close_attempts_since_previous: 1,
                    },
                })
            }
        }
    }

    fn final_observation(state: Self::State) -> Self::Observation {
        CandidateWindowEvent {
            window: state,
            close_attempts_since_previous: 0,
        }
    }

    fn queue_error(error: QueueError) -> Self::Error {
        CandidateWindowError::Queue(error)
    }

    fn overflow_error() -> Self::Error {
        CandidateWindowError::QueueOverflow
    }
}

impl CandidateWindowEmitter {
    fn new(queue_capacity: usize) -> Result<Self, CandidateWindowError> {
        Ok(Self {
            session: SourceSession::new(queue_capacity)?,
        })
    }

    /// Records a refreshed mechanical state. An unchanged refresh is
    /// coalesced because it does not prove a distinct transition.
    pub(crate) fn observe_state(&self, window: Result<CandidateWindowState, CandidateWindowError>) {
        self.session.submit(CandidateWindowInput::State {
            window,
            preserve_duplicate: false,
        });
    }

    /// Records a listener-backed transition. It remains observable even when
    /// the resulting state equals the preceding state.
    pub(crate) fn observe_transition(
        &self,
        window: Result<CandidateWindowState, CandidateWindowError>,
    ) {
        self.session.submit(CandidateWindowInput::State {
            window,
            preserve_duplicate: true,
        });
    }

    /// Records one intercepted close attempt as a passive observation.
    pub(crate) fn observe_close_attempt(&self) {
        self.session.submit(CandidateWindowInput::CloseAttempt);
    }

    pub(crate) fn report_lost_events(&self, count: u64) {
        self.session.report_missing(count);
    }

    fn finish_open(
        &self,
        initial_window: CandidateWindowState,
        reset: Option<SourceResetPlan>,
    ) -> Result<SourceSessionMetadata, CandidateWindowError> {
        let health = health_for(initial_window.certainty);
        self.session.finish_open(initial_window, health, reset)
    }

    fn source_snapshot(
        platform: PlatformFamily,
        permission: PermissionState,
        adapter_version: &str,
        window: CandidateWindowState,
        metadata: SourceSessionMetadata,
    ) -> Result<CandidateWindowSourceSnapshot, CandidateWindowError> {
        let snapshot = CandidateWindowSourceSnapshot {
            source_instance_id: metadata.source_instance_id,
            source_version: SOURCE_VERSION.to_owned(),
            adapter_version: adapter_version.to_owned(),
            schema_version: CANDIDATE_WINDOW_SCHEMA_VERSION,
            platform,
            permission,
            health: metadata.health,
            sequence: 0,
            observed_at: metadata.observed_at,
            window,
        };
        snapshot
            .validate_protocol()
            .map_err(ProtocolViolation::from)?;
        Ok(snapshot)
    }

    fn drain(&self) -> CandidateWindowDrain {
        let session_drain = self.session.drain();
        let source_instance_id = session_drain.source_instance_id;
        let mut observations = Vec::new();
        let mut resets = Vec::new();
        for fact in session_drain.facts {
            match fact.payload {
                SourceSessionFact::Observation(event) => {
                    let observation = CandidateWindowObservation {
                        source_instance_id: source_instance_id.clone(),
                        sequence: fact.sequence,
                        observed_at: fact.observed_at,
                        gap: fact.gap,
                        event,
                    };
                    if let Err(error) = observation.validate_protocol() {
                        self.session
                            .fail(CandidateWindowError::Protocol(error.into()));
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
                            .fail(CandidateWindowError::Protocol(error.into()));
                        break;
                    }
                    resets.push(reset);
                }
            }
        }
        let mut drain = CandidateWindowDrain {
            source_instance_id,
            health: session_drain.health,
            observations,
            resets,
            terminal_error: session_drain
                .terminal_error
                .as_ref()
                .map(CandidateWindowError::failure_code),
        };
        if let Err(error) = drain.validate_protocol() {
            self.session
                .fail(CandidateWindowError::Protocol(error.into()));
            let terminal = self.session.drain();
            drain.observations.clear();
            drain.resets.clear();
            drain.health = terminal.health;
            drain.terminal_error = terminal
                .terminal_error
                .as_ref()
                .map(CandidateWindowError::failure_code);
        }
        drain
    }

    fn begin_stop(&self) {
        self.session.begin_stop();
    }

    fn finish_stop(&self, final_window: Result<CandidateWindowState, CandidateWindowError>) {
        self.session.finish_stop(final_window);
    }

    fn dispose(&self) {
        self.session.dispose();
    }

    fn health(&self) -> SourceHealth {
        self.session.health()
    }

    fn queue_capacity(&self) -> usize {
        self.session.queue_capacity()
    }
}

pub struct CandidateWindowSource<S: CandidateWindowSubscription> {
    emitter: CandidateWindowEmitter,
    snapshot: CandidateWindowSourceSnapshot,
    subscription: Option<S>,
}

impl<S: CandidateWindowSubscription> CandidateWindowSource<S> {
    /// Opens one race-free `CandidateWindow` observation session.
    ///
    /// # Errors
    ///
    /// Returns an error when request validation, listener registration, or the
    /// initial mechanical state cannot be established.
    pub fn open<B>(request: &SourceOpenRequest, backend: B) -> Result<Self, CandidateWindowError>
    where
        B: CandidateWindowBackend<Subscription = S>,
    {
        Self::open_internal(request, backend, None)
    }

    /// Opens a fresh source instance after a supervised adapter restart and
    /// records the restart fence before any new observations.
    ///
    /// # Errors
    ///
    /// Returns an open, schema, queue, cleanup, or reset-reason failure.
    pub fn open_after_reset<B>(
        request: &SourceOpenRequest,
        backend: B,
        missing_count: u64,
        reason: String,
    ) -> Result<Self, CandidateWindowError>
    where
        B: CandidateWindowBackend<Subscription = S>,
    {
        let reset = SourceResetPlan::new(missing_count, reason)?;
        Self::open_internal(request, backend, Some(reset))
    }

    fn open_internal<B>(
        request: &SourceOpenRequest,
        backend: B,
        reset: Option<SourceResetPlan>,
    ) -> Result<Self, CandidateWindowError>
    where
        B: CandidateWindowBackend<Subscription = S>,
    {
        request.validate_candidate_window()?;
        ensure_native_source_process_usable()
            .map_err(|error| CandidateWindowError::Cleanup(error.to_string()))?;
        let emitter = CandidateWindowEmitter::new(usize::from(request.queue_capacity))?;
        let opened = backend.open(emitter.clone())?;
        let initial_window = opened.initial_window.clone();
        let subscription = opened.subscription;
        let snapshot_metadata = match emitter.finish_open(opened.initial_window, reset) {
            Ok(metadata) => metadata,
            Err(error) => return Err(rollback_subscription(error, subscription)),
        };
        let snapshot = match CandidateWindowEmitter::source_snapshot(
            opened.platform,
            opened.permission,
            opened.adapter_version,
            initial_window,
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
    pub fn snapshot(&self) -> &CandidateWindowSourceSnapshot {
        &self.snapshot
    }

    /// Drains currently buffered ordered window observations. Terminal health
    /// and the first terminal error remain visible in every returned batch.
    pub fn drain(&self) -> CandidateWindowDrain {
        self.emitter.drain()
    }

    #[must_use]
    pub fn health(&self) -> SourceHealth {
        self.emitter.health()
    }

    /// Fences listener input, takes a final state behind a hard deadline, and
    /// returns the final ordered batch. Repeated calls are safe.
    pub fn stop(&mut self) -> CandidateWindowDrain {
        if let Some(subscription) = self.subscription.take() {
            let final_window = stop_subscription(subscription);
            self.emitter.begin_stop();
            self.emitter.finish_stop(final_window);
        }
        let final_batch = self.emitter.drain();
        self.emitter.dispose();
        final_batch
    }
}

impl<S: CandidateWindowSubscription> Drop for CandidateWindowSource<S> {
    fn drop(&mut self) {
        let _ = self.stop();
    }
}

fn health_for(certainty: CandidateWindowCertainty) -> SourceHealth {
    match certainty {
        CandidateWindowCertainty::Complete => SourceHealth::Healthy,
        CandidateWindowCertainty::Partial | CandidateWindowCertainty::Unknown => {
            SourceHealth::Degraded
        }
    }
}

fn rollback_subscription<S: CandidateWindowSubscription>(
    primary: CandidateWindowError,
    subscription: S,
) -> CandidateWindowError {
    prefer_boundary_error(primary, stop_subscription(subscription))
}

fn stop_subscription<S: CandidateWindowSubscription>(
    subscription: S,
) -> Result<CandidateWindowState, CandidateWindowError> {
    run_bounded_source_stop(
        "candidate-window-stop",
        move || subscription.stop(),
        bounded_cleanup_error,
    )
}

fn bounded_cleanup_error(error: BoundedTaskError) -> CandidateWindowError {
    CandidateWindowError::Cleanup(format!(
        "listener shutdown {error}; native utility restart is required"
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;
    use std::sync::atomic::{AtomicBool, Ordering};

    use native_protocol::{
        CandidateWindowBounds, CandidateWindowFocus, CandidateWindowHostEvent,
        CandidateWindowHostEventKind, CandidateWindowPlacement, CandidateWindowPresence,
        CandidateWindowVisibility, MAX_CANDIDATE_WINDOW_FACTS, SequenceGap,
    };

    struct FakeBackend {
        initial: CandidateWindowState,
        during_open: Vec<CandidateWindowState>,
        close_attempts: usize,
        final_window: CandidateWindowState,
        stopped: Arc<AtomicBool>,
    }

    struct FakeSubscription {
        final_window: CandidateWindowState,
        stopped: Arc<AtomicBool>,
    }

    impl CandidateWindowSubscription for FakeSubscription {
        fn stop(self) -> Result<CandidateWindowState, CandidateWindowError> {
            self.stopped.store(true, Ordering::Release);
            Ok(self.final_window)
        }
    }

    impl CandidateWindowBackend for FakeBackend {
        type Subscription = FakeSubscription;

        fn open(
            self,
            emitter: CandidateWindowEmitter,
        ) -> Result<OpenedCandidateWindowBackend<Self::Subscription>, CandidateWindowError>
        {
            for window in self.during_open {
                emitter.observe_transition(Ok(window));
            }
            for _ in 0..self.close_attempts {
                emitter.observe_close_attempt();
            }
            Ok(OpenedCandidateWindowBackend {
                platform: PlatformFamily::Linux,
                permission: PermissionState::Granted,
                adapter_version: "fake-window",
                initial_window: self.initial,
                subscription: FakeSubscription {
                    final_window: self.final_window,
                    stopped: self.stopped,
                },
            })
        }
    }

    fn window(placement: CandidateWindowPlacement) -> CandidateWindowState {
        CandidateWindowState {
            certainty: CandidateWindowCertainty::Complete,
            presence: CandidateWindowPresence::Present,
            focus: CandidateWindowFocus::Focused,
            visibility: CandidateWindowVisibility::Visible,
            placement,
            bounds: Some(CandidateWindowBounds {
                x: 0,
                y: 0,
                width: 1920,
                height: 1080,
            }),
            display_target_id: Some("display-1".to_owned()),
        }
    }

    fn request(queue_capacity: u16) -> SourceOpenRequest {
        SourceOpenRequest {
            collection_session_id: "candidate-window-session-0001".to_owned(),
            requested_schema_version: CANDIDATE_WINDOW_SCHEMA_VERSION,
            queue_capacity,
        }
    }

    fn backend(
        initial: CandidateWindowState,
        during_open: Vec<CandidateWindowState>,
        close_attempts: usize,
        final_window: CandidateWindowState,
    ) -> FakeBackend {
        FakeBackend {
            initial,
            during_open,
            close_attempts,
            final_window,
            stopped: Arc::new(AtomicBool::new(false)),
        }
    }

    #[cfg(target_os = "macos")]
    fn utility_ingress_backend(
        initial: CandidateWindowState,
        bridge: CandidateWindowUtilityReceiver,
    ) -> MacOsCandidateWindowBackend {
        MacOsCandidateWindowBackend::new(initial, bridge)
    }

    #[cfg(target_os = "windows")]
    fn utility_ingress_backend(
        initial: CandidateWindowState,
        bridge: CandidateWindowUtilityReceiver,
    ) -> WindowsCandidateWindowBackend {
        WindowsCandidateWindowBackend::new(initial, bridge)
    }

    #[cfg(target_os = "linux")]
    fn utility_ingress_backend(
        initial: CandidateWindowState,
        bridge: CandidateWindowUtilityReceiver,
    ) -> LinuxCandidateWindowBackend {
        LinuxCandidateWindowBackend::new(initial, bridge)
    }

    fn host_state_event(
        kind: CandidateWindowHostEventKind,
        window: CandidateWindowState,
    ) -> CandidateWindowHostEvent {
        CandidateWindowHostEvent {
            kind,
            window: Some(window),
        }
    }

    #[test]
    fn event_registration_precedes_the_initial_snapshot_boundary() {
        let initial = window(CandidateWindowPlacement::Maximized);
        let changed = window(CandidateWindowPlacement::Fullscreen);
        let source = CandidateWindowSource::<FakeSubscription>::open(
            &request(8),
            backend(initial.clone(), vec![changed.clone()], 1, changed.clone()),
        )
        .expect("source opens");

        assert_eq!(source.snapshot().sequence, 0);
        assert_eq!(source.snapshot().window, initial);
        let drain = source.drain();
        assert_eq!(drain.observations.len(), 2);
        assert_eq!(drain.observations[0].sequence, 1);
        assert_eq!(drain.observations[0].event.window, changed);
        assert_eq!(drain.observations[0].event.close_attempts_since_previous, 0);
        assert_eq!(drain.observations[1].sequence, 2);
        assert_eq!(drain.observations[1].event.close_attempts_since_previous, 1);
    }

    #[test]
    fn refreshes_coalesce_but_explicit_transitions_and_close_attempts_do_not() {
        let state = window(CandidateWindowPlacement::Maximized);
        let source = CandidateWindowSource::<FakeSubscription>::open(
            &request(8),
            backend(state.clone(), Vec::new(), 0, state.clone()),
        )
        .expect("source opens");

        source.emitter.observe_state(Ok(state.clone()));
        assert!(source.drain().observations.is_empty());
        source.emitter.observe_transition(Ok(state));
        source.emitter.observe_close_attempt();

        let drain = source.drain();
        assert_eq!(drain.observations.len(), 2);
        assert_eq!(drain.observations[0].event.close_attempts_since_previous, 0);
        assert_eq!(drain.observations[1].event.close_attempts_since_previous, 1);
    }

    #[test]
    fn certainty_updates_source_health_without_interpreting_policy() {
        let complete = window(CandidateWindowPlacement::Maximized);
        let source = CandidateWindowSource::<FakeSubscription>::open(
            &request(8),
            backend(complete.clone(), Vec::new(), 0, complete.clone()),
        )
        .expect("source opens");
        let mut partial = complete.clone();
        partial.certainty = CandidateWindowCertainty::Partial;

        source.emitter.observe_state(Ok(partial));
        assert_eq!(source.health(), SourceHealth::Degraded);
        source.emitter.observe_state(Ok(complete));
        assert_eq!(source.health(), SourceHealth::Healthy);
    }

    #[test]
    fn invalid_initial_state_rolls_back_the_listener_registration() {
        let stopped = Arc::new(AtomicBool::new(false));
        let mut invalid = window(CandidateWindowPlacement::Maximized);
        invalid.presence = CandidateWindowPresence::Absent;
        let valid = window(CandidateWindowPlacement::Maximized);
        let result = CandidateWindowSource::<FakeSubscription>::open(
            &request(8),
            FakeBackend {
                initial: invalid,
                during_open: Vec::new(),
                close_attempts: 0,
                final_window: valid,
                stopped: Arc::clone(&stopped),
            },
        );

        assert!(matches!(result, Err(CandidateWindowError::Protocol(_))));
        assert!(stopped.load(Ordering::Acquire));
    }

    #[test]
    fn queue_overflow_is_terminal_and_preserves_the_missing_range() {
        let initial = window(CandidateWindowPlacement::Normal);
        let source = CandidateWindowSource::<FakeSubscription>::open(
            &request(2),
            backend(
                initial.clone(),
                vec![
                    window(CandidateWindowPlacement::Maximized),
                    window(CandidateWindowPlacement::Fullscreen),
                    window(CandidateWindowPlacement::Normal),
                ],
                0,
                initial,
            ),
        )
        .expect("source opens in a failed state");

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
    fn exact_lost_event_count_is_fenced_in_the_next_fact() {
        let state = window(CandidateWindowPlacement::Maximized);
        let source = CandidateWindowSource::<FakeSubscription>::open(
            &request(8),
            backend(state.clone(), Vec::new(), 0, state),
        )
        .expect("source opens");

        source.emitter.report_lost_events(3);

        let drain = source.drain();
        assert_eq!(drain.health, SourceHealth::Failed);
        assert_eq!(drain.observations[0].sequence, 4);
        assert_eq!(
            drain.observations[0].gap,
            Some(SequenceGap {
                first_missing: 1,
                last_missing: 3,
            })
        );
    }

    #[test]
    fn supervised_reopen_uses_a_fresh_instance_and_orders_the_reset() {
        let state = window(CandidateWindowPlacement::Maximized);
        let first = CandidateWindowSource::<FakeSubscription>::open(
            &request(8),
            backend(state.clone(), Vec::new(), 0, state.clone()),
        )
        .expect("first source opens");
        let second = CandidateWindowSource::<FakeSubscription>::open_after_reset(
            &request(8),
            backend(
                state.clone(),
                vec![window(CandidateWindowPlacement::Fullscreen)],
                0,
                state,
            ),
            2,
            "listener restarted".to_owned(),
        )
        .expect("replacement source opens");

        assert_ne!(
            first.snapshot().source_instance_id,
            second.snapshot().source_instance_id
        );
        let drain = second.drain();
        assert_eq!(drain.resets[0].sequence, 3);
        assert_eq!(drain.observations[0].sequence, 4);
    }

    #[test]
    fn stop_fences_the_subscription_and_returns_a_terminal_snapshot() {
        let initial = window(CandidateWindowPlacement::Maximized);
        let final_window = window(CandidateWindowPlacement::Normal);
        let stopped = Arc::new(AtomicBool::new(false));
        let mut source = CandidateWindowSource::<FakeSubscription>::open(
            &request(8),
            FakeBackend {
                initial,
                during_open: Vec::new(),
                close_attempts: 0,
                final_window: final_window.clone(),
                stopped: Arc::clone(&stopped),
            },
        )
        .expect("source opens");

        let drain = source.stop();

        assert!(stopped.load(Ordering::Acquire));
        assert_eq!(drain.health, SourceHealth::Stopped);
        assert_eq!(drain.observations.len(), 1);
        assert_eq!(drain.observations[0].event.window, final_window);
        let repeated = source.stop();
        assert!(repeated.observations.is_empty());
        assert_eq!(repeated.health, SourceHealth::Stopped);
    }

    #[test]
    fn platform_utility_ingress_reports_the_build_target_without_exposing_handles() {
        let state = window(CandidateWindowPlacement::Maximized);
        let final_state = state.clone();
        let (ingress, bridge) = candidate_window_utility_ingress(8).expect("valid bridge");

        #[cfg(target_os = "macos")]
        let backend = MacOsCandidateWindowBackend::new(state, bridge);
        #[cfg(target_os = "windows")]
        let backend = WindowsCandidateWindowBackend::new(state, bridge);
        #[cfg(target_os = "linux")]
        let backend = LinuxCandidateWindowBackend::new(state, bridge);

        let mut source =
            CandidateWindowSource::open(&request(8), backend).expect("platform ingress opens");
        #[cfg(target_os = "macos")]
        assert_eq!(source.snapshot().platform, PlatformFamily::Macos);
        #[cfg(target_os = "windows")]
        assert_eq!(source.snapshot().platform, PlatformFamily::Windows);
        #[cfg(target_os = "linux")]
        assert_eq!(source.snapshot().platform, PlatformFamily::Linux);
        source
            .snapshot()
            .validate_protocol()
            .expect("platform snapshot satisfies protocol");
        ingress
            .fence_with_final_state(final_state)
            .expect("fresh final state fences utility ingress");
        let _ = source.stop();
        assert_eq!(
            ingress
                .try_send(CandidateWindowHostEvent {
                    kind: CandidateWindowHostEventKind::CloseAttempt,
                    window: None,
                })
                .expect("typed event remains valid"),
            CandidateWindowUtilityIngressOutcome::Stopped
        );
    }

    #[test]
    fn utility_ingress_buffers_typed_events_before_sequence_zero_without_an_open_race() {
        let initial = window(CandidateWindowPlacement::Normal);
        let changed = window(CandidateWindowPlacement::Fullscreen);
        let (ingress, bridge) = candidate_window_utility_ingress(8).expect("valid bridge");
        assert_eq!(
            ingress
                .try_send(host_state_event(
                    CandidateWindowHostEventKind::StateTransition,
                    changed.clone(),
                ))
                .expect("valid transition"),
            CandidateWindowUtilityIngressOutcome::Accepted
        );
        assert_eq!(
            ingress
                .try_send(CandidateWindowHostEvent {
                    kind: CandidateWindowHostEventKind::CloseAttempt,
                    window: None,
                })
                .expect("valid close attempt"),
            CandidateWindowUtilityIngressOutcome::Accepted
        );

        let mut source = CandidateWindowSource::open(
            &request(8),
            utility_ingress_backend(initial.clone(), bridge),
        )
        .expect("utility ingress source opens");
        assert_eq!(source.snapshot().sequence, 0);
        assert_eq!(source.snapshot().window, initial);
        ingress
            .fence_with_final_state(changed.clone())
            .expect("fresh final state fences utility ingress");
        let drain = source.stop();

        assert_eq!(drain.observations.len(), 3);
        assert_eq!(drain.observations[0].sequence, 1);
        assert_eq!(drain.observations[0].event.window, changed);
        assert_eq!(drain.observations[1].sequence, 2);
        assert_eq!(drain.observations[1].event.close_attempts_since_previous, 1);
        assert_eq!(drain.observations[2].sequence, 3);
    }

    #[test]
    fn utility_ingress_overflow_is_nonblocking_and_preserves_the_exact_missing_range() {
        let initial = window(CandidateWindowPlacement::Normal);
        let (ingress, bridge) = candidate_window_utility_ingress(2).expect("valid bridge");
        let placements = [
            CandidateWindowPlacement::Maximized,
            CandidateWindowPlacement::Normal,
            CandidateWindowPlacement::Fullscreen,
            CandidateWindowPlacement::Maximized,
            CandidateWindowPlacement::Fullscreen,
        ];
        let outcomes = placements.map(|placement| {
            ingress
                .try_send(host_state_event(
                    CandidateWindowHostEventKind::StateTransition,
                    window(placement),
                ))
                .expect("valid transition")
        });
        assert_eq!(
            outcomes,
            [
                CandidateWindowUtilityIngressOutcome::Accepted,
                CandidateWindowUtilityIngressOutcome::Accepted,
                CandidateWindowUtilityIngressOutcome::Dropped,
                CandidateWindowUtilityIngressOutcome::Dropped,
                CandidateWindowUtilityIngressOutcome::Dropped,
            ]
        );

        let mut source =
            CandidateWindowSource::open(&request(2), utility_ingress_backend(initial, bridge))
                .expect("utility ingress source opens and reports overflow through health");
        let mut accepted = Vec::new();
        let mut overflow_visible = false;
        for _attempt in 0..10_000 {
            let drain = source.drain();
            accepted.extend(drain.observations);
            if drain.health == SourceHealth::Failed {
                assert_eq!(drain.terminal_error, Some(SourceFailureCode::QueueOverflow));
                overflow_visible = true;
                break;
            }
            std::thread::yield_now();
        }
        assert!(
            overflow_visible,
            "overflow becomes poll-visible without a later event"
        );
        assert!(accepted.iter().any(|observation| {
            observation.sequence == 6
                && observation.gap
                    == Some(SequenceGap {
                        first_missing: 3,
                        last_missing: 5,
                    })
        }));
        let fresh_final = window(CandidateWindowPlacement::Fullscreen);
        ingress
            .fence_with_final_state(fresh_final.clone())
            .expect("fresh state fences the tail-loss boundary");
        let drain = source.stop();

        assert_eq!(drain.health, SourceHealth::Failed);
        assert_eq!(drain.terminal_error, Some(SourceFailureCode::QueueOverflow));
        assert_eq!(drain.observations.len(), 1);
        assert_eq!(drain.observations[0].sequence, 7);
        assert_eq!(drain.observations[0].event.window, fresh_final);
    }

    #[test]
    fn utility_ingress_preserves_loss_reported_by_the_electron_sender() {
        let initial = window(CandidateWindowPlacement::Normal);
        let (ingress, bridge) = candidate_window_utility_ingress(8).expect("valid bridge");
        assert_eq!(
            ingress
                .try_send(host_state_event(
                    CandidateWindowHostEventKind::StateTransition,
                    window(CandidateWindowPlacement::Maximized),
                ))
                .expect("valid transition"),
            CandidateWindowUtilityIngressOutcome::Accepted
        );
        assert_eq!(
            ingress
                .record_lost_events(3)
                .expect("positive loss count advances ingress sequence"),
            CandidateWindowUtilityIngressOutcome::Accepted
        );

        let mut source =
            CandidateWindowSource::open(&request(8), utility_ingress_backend(initial, bridge))
                .expect("utility ingress source opens");
        let mut observations = Vec::new();
        let mut loss_visible = false;
        for _attempt in 0..10_000 {
            let drain = source.drain();
            observations.extend(drain.observations);
            if drain.health == SourceHealth::Failed {
                assert_eq!(drain.terminal_error, Some(SourceFailureCode::QueueOverflow));
                loss_visible = true;
                break;
            }
            std::thread::yield_now();
        }
        assert!(
            loss_visible,
            "reported loss becomes poll-visible without a later event"
        );
        assert_eq!(observations.len(), 2);
        assert_eq!(
            observations[1].gap,
            Some(SequenceGap {
                first_missing: 2,
                last_missing: 4,
            })
        );
        assert_eq!(observations[1].sequence, 5);
        ingress
            .fence_with_final_state(window(CandidateWindowPlacement::Fullscreen))
            .expect("fresh final state fences sender-side loss");
        let drain = source.stop();

        assert_eq!(drain.health, SourceHealth::Failed);
        assert_eq!(drain.terminal_error, Some(SourceFailureCode::QueueOverflow));
        assert_eq!(drain.observations.len(), 1);
        assert_eq!(drain.observations[0].sequence, 6);
        assert!(ingress.record_lost_events(0).is_err());
    }

    #[test]
    fn utility_ingress_capacity_must_match_the_validated_source_request() {
        let initial = window(CandidateWindowPlacement::Normal);
        let (_ingress, receiver) = candidate_window_utility_ingress(8).expect("valid ingress");
        let result =
            CandidateWindowSource::open(&request(4), utility_ingress_backend(initial, receiver));

        assert!(matches!(result, Err(CandidateWindowError::Backend(_))));
        assert!(candidate_window_utility_ingress(1).is_err());
        let above_protocol_limit =
            u16::try_from(MAX_CANDIDATE_WINDOW_FACTS + 1).expect("protocol limit fits u16");
        assert!(candidate_window_utility_ingress(above_protocol_limit).is_err());
    }

    #[test]
    fn utility_ingress_rejects_semantically_invalid_host_events() {
        let (ingress, _bridge) = candidate_window_utility_ingress(2).expect("valid bridge");
        let result = ingress.try_send(CandidateWindowHostEvent {
            kind: CandidateWindowHostEventKind::CloseAttempt,
            window: Some(window(CandidateWindowPlacement::Maximized)),
        });

        assert!(matches!(result, Err(CandidateWindowError::Protocol(_))));
    }
}
