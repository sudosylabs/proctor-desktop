mod platform;

use std::fmt;
use std::time::Duration;

use native_protocol::{
    DisplayTopologyDrain, DisplayTopologyObservation, DisplayTopologySnapshot,
    DisplayTopologySourceSnapshot, PermissionState, PlatformFamily, ProtocolValidatable,
    ProtocolViolation, SourceFailureCode, SourceHealth, SourceOpenRequest, SourceReset,
    TopologyCertainty,
};
use native_source_runtime::{
    BoundedTaskError, DeadlineThread, QueueError, SOURCE_CLEANUP_DEADLINE, SourceModel,
    SourceResetPlan, SourceSession, SourceSessionFact, SourceSessionMetadata, SourceStateChange,
    ensure_native_source_process_usable, poison_native_source_process, run_bounded_task,
};

#[cfg(target_os = "linux")]
pub use platform::LinuxDisplayTopologyBackend;
#[cfg(target_os = "macos")]
pub use platform::MacOsDisplayTopologyBackend;
#[cfg(target_os = "windows")]
pub use platform::WindowsDisplayTopologyBackend;

pub const SOURCE_VERSION: &str = env!("CARGO_PKG_VERSION");

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum DisplayTopologyError {
    Backend(String),
    Cleanup(String),
    InventoryOverflow(String),
    Protocol(ProtocolViolation),
    Queue(QueueError),
    QueueOverflow,
}

impl DisplayTopologyError {
    /// Projects the capability error onto the bounded native protocol category.
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
}

impl fmt::Display for DisplayTopologyError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Backend(reason) => write!(formatter, "display topology backend failed: {reason}"),
            Self::Cleanup(reason) => write!(formatter, "display topology cleanup failed: {reason}"),
            Self::InventoryOverflow(reason) => {
                write!(formatter, "display topology inventory overflowed: {reason}")
            }
            Self::Protocol(error) => {
                write!(formatter, "display topology protocol violation: {error}")
            }
            Self::Queue(error) => write!(formatter, "display topology queue failed: {error}"),
            Self::QueueOverflow => formatter.write_str("display topology source queue overflowed"),
        }
    }
}

impl std::error::Error for DisplayTopologyError {}

impl From<ProtocolViolation> for DisplayTopologyError {
    fn from(error: ProtocolViolation) -> Self {
        Self::Protocol(error)
    }
}

impl From<QueueError> for DisplayTopologyError {
    fn from(error: QueueError) -> Self {
        Self::Queue(error)
    }
}

fn prefer_cleanup_error(
    primary: DisplayTopologyError,
    cleanup: Result<(), DisplayTopologyError>,
) -> DisplayTopologyError {
    cleanup.err().unwrap_or(primary)
}

fn rollback_subscription<S: DisplayTopologySubscription>(
    primary: DisplayTopologyError,
    subscription: &mut S,
) -> DisplayTopologyError {
    let cleanup = match subscription.stop() {
        Err(error @ DisplayTopologyError::Cleanup(_)) => Err(error),
        Ok(_) | Err(_) => Ok(()),
    };
    prefer_cleanup_error(primary, cleanup)
}

fn final_snapshot_with_deadline<F>(
    thread_name: &str,
    backend_name: &'static str,
    snapshot: F,
) -> Result<DisplayTopologySnapshot, DisplayTopologyError>
where
    F: FnOnce() -> Result<DisplayTopologySnapshot, DisplayTopologyError> + Send + 'static,
{
    snapshot_with_deadline(
        thread_name,
        backend_name,
        SOURCE_CLEANUP_DEADLINE,
        &poison_native_source_process,
        snapshot,
    )
}

#[cfg(any(target_os = "macos", target_os = "windows"))]
fn cleanup_with_deadline<F>(
    thread_name: &str,
    operation_name: &'static str,
    cleanup: F,
) -> Result<(), DisplayTopologyError>
where
    F: FnOnce() -> Result<(), DisplayTopologyError> + Send + 'static,
{
    operation_with_deadline(
        thread_name,
        operation_name,
        SOURCE_CLEANUP_DEADLINE,
        &poison_native_source_process,
        cleanup,
    )
}

fn snapshot_with_deadline<F, P>(
    thread_name: &str,
    backend_name: &'static str,
    deadline: Duration,
    poison: &P,
    snapshot: F,
) -> Result<DisplayTopologySnapshot, DisplayTopologyError>
where
    F: FnOnce() -> Result<DisplayTopologySnapshot, DisplayTopologyError> + Send + 'static,
    P: Fn(),
{
    operation_with_deadline(thread_name, backend_name, deadline, poison, snapshot)
}

fn operation_with_deadline<T, F, P>(
    thread_name: &str,
    operation_name: &'static str,
    deadline: Duration,
    poison: &P,
    operation: F,
) -> Result<T, DisplayTopologyError>
where
    T: Send + 'static,
    F: FnOnce() -> Result<T, DisplayTopologyError> + Send + 'static,
    P: Fn(),
{
    let result = run_bounded_task(thread_name, deadline, operation).map_err(|error| {
        poison();
        bounded_display_operation_error(operation_name, error)
    })?;
    if matches!(result, Err(DisplayTopologyError::Cleanup(_))) {
        poison();
    }
    result
}

fn bounded_display_operation_error(
    operation_name: &str,
    error: BoundedTaskError,
) -> DisplayTopologyError {
    DisplayTopologyError::Cleanup(format!(
        "{operation_name} {error}; native utility restart is required"
    ))
}

fn finish_native_thread(
    thread: &mut DeadlineThread,
    resource_name: &'static str,
) -> Result<(), DisplayTopologyError> {
    finish_thread_with_deadline(
        thread,
        SOURCE_CLEANUP_DEADLINE,
        resource_name,
        &poison_native_source_process,
    )
}

fn finish_thread_with_deadline<P>(
    thread: &mut DeadlineThread,
    deadline: Duration,
    resource_name: &'static str,
    poison: &P,
) -> Result<(), DisplayTopologyError>
where
    P: Fn(),
{
    thread.finish(deadline).map_err(|error| {
        poison();
        DisplayTopologyError::Cleanup(format!(
            "{resource_name}: {error}; native utility restart is required"
        ))
    })
}

pub trait DisplayTopologySubscription {
    /// Stops native delivery, takes a final mechanical snapshot at the
    /// closed-input boundary, and releases adapter-owned resources.
    ///
    /// # Errors
    ///
    /// Returns a bounded cleanup failure instead of waiting indefinitely.
    fn stop(&mut self) -> Result<DisplayTopologySnapshot, DisplayTopologyError>;
}

pub trait DisplayTopologyBackend {
    type Subscription: DisplayTopologySubscription;

    /// Registers change observation before returning the initial snapshot.
    ///
    /// # Errors
    ///
    /// Returns a backend error when registration or the initial mechanical
    /// snapshot cannot be established.
    fn open(
        self,
        emitter: DisplayTopologyEmitter,
    ) -> Result<OpenedDisplayTopologyBackend<Self::Subscription>, DisplayTopologyError>;
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum OpenedSourceHealth {
    Healthy,
    Degraded,
}

impl From<TopologyCertainty> for OpenedSourceHealth {
    fn from(certainty: TopologyCertainty) -> Self {
        match certainty {
            TopologyCertainty::Complete => Self::Healthy,
            TopologyCertainty::Partial | TopologyCertainty::Unknown => Self::Degraded,
        }
    }
}

impl From<OpenedSourceHealth> for SourceHealth {
    fn from(health: OpenedSourceHealth) -> Self {
        match health {
            OpenedSourceHealth::Healthy => Self::Healthy,
            OpenedSourceHealth::Degraded => Self::Degraded,
        }
    }
}

pub struct OpenedDisplayTopologyBackend<S> {
    pub platform: PlatformFamily,
    pub permission: PermissionState,
    pub health: OpenedSourceHealth,
    pub adapter_version: &'static str,
    pub initial_topology: DisplayTopologySnapshot,
    pub subscription: S,
}

#[derive(Clone)]
pub struct DisplayTopologyEmitter {
    session: SourceSession<DisplayTopologyModel>,
}

struct DisplayTopologyInput {
    topology: Result<DisplayTopologySnapshot, DisplayTopologyError>,
    preserve_duplicate: bool,
}

struct DisplayTopologyModel;

impl SourceModel for DisplayTopologyModel {
    type State = DisplayTopologySnapshot;
    type Input = DisplayTopologyInput;
    type Observation = DisplayTopologySnapshot;
    type Error = DisplayTopologyError;

    fn validate_state(state: &Self::State) -> Result<(), Self::Error> {
        state.validate().map_err(Into::into)
    }

    fn health(state: &Self::State) -> SourceHealth {
        OpenedSourceHealth::from(state.certainty).into()
    }

    fn apply(
        previous: Option<&Self::State>,
        input: Self::Input,
    ) -> Result<SourceStateChange<Self::State, Self::Observation>, Self::Error> {
        let topology = input.topology?;
        topology.validate()?;
        if !input.preserve_duplicate && previous == Some(&topology) {
            return Ok(SourceStateChange::Ignore);
        }
        Ok(SourceStateChange::Observe {
            state: Some(topology.clone()),
            observation: topology,
        })
    }

    fn final_observation(state: Self::State) -> Self::Observation {
        state
    }

    fn queue_error(error: QueueError) -> Self::Error {
        DisplayTopologyError::Queue(error)
    }

    fn overflow_error() -> Self::Error {
        DisplayTopologyError::QueueOverflow
    }
}

impl DisplayTopologyEmitter {
    fn new(queue_capacity: usize) -> Result<Self, DisplayTopologyError> {
        Ok(Self {
            session: SourceSession::new(queue_capacity)?,
        })
    }

    pub(crate) fn emit(&self, topology: Result<DisplayTopologySnapshot, DisplayTopologyError>) {
        self.emit_with_mode(topology, false);
    }

    /// Records an OS transition wakeup. Unlike a state refresh, an explicit
    /// transition remains observable even if enumeration has already returned
    /// to the preceding topology.
    #[cfg(any(target_os = "macos", target_os = "windows", test))]
    pub(crate) fn emit_transition(
        &self,
        topology: Result<DisplayTopologySnapshot, DisplayTopologyError>,
    ) {
        self.emit_with_mode(topology, true);
    }

    fn emit_with_mode(
        &self,
        topology: Result<DisplayTopologySnapshot, DisplayTopologyError>,
        preserve_duplicate: bool,
    ) {
        self.session.submit(DisplayTopologyInput {
            topology,
            preserve_duplicate,
        });
    }

    #[must_use]
    #[cfg(any(target_os = "macos", target_os = "windows"))]
    pub(crate) fn queue_capacity(&self) -> usize {
        self.session.queue_capacity()
    }

    fn finish_open(
        &self,
        initial_topology: DisplayTopologySnapshot,
        initial_health: OpenedSourceHealth,
        reset: Option<SourceResetPlan>,
    ) -> Result<SourceSessionMetadata, DisplayTopologyError> {
        self.session
            .finish_open(initial_topology, initial_health.into(), reset)
    }

    fn source_snapshot(
        platform: PlatformFamily,
        permission: PermissionState,
        adapter_version: &str,
        topology: DisplayTopologySnapshot,
        metadata: SourceSessionMetadata,
    ) -> Result<DisplayTopologySourceSnapshot, DisplayTopologyError> {
        let snapshot = DisplayTopologySourceSnapshot {
            source_instance_id: metadata.source_instance_id,
            source_version: SOURCE_VERSION.to_owned(),
            adapter_version: adapter_version.to_owned(),
            platform,
            permission,
            health: metadata.health,
            sequence: 0,
            observed_at: metadata.observed_at,
            topology,
        };
        snapshot
            .validate_protocol()
            .map_err(ProtocolViolation::from)?;
        Ok(snapshot)
    }

    fn drain(&self) -> DisplayTopologyDrain {
        let session_drain = self.session.drain();
        let source_instance_id = session_drain.source_instance_id;
        let mut observations = Vec::new();
        let mut resets = Vec::new();
        for fact in session_drain.facts {
            match fact.payload {
                SourceSessionFact::Observation(topology) => {
                    let observation = DisplayTopologyObservation {
                        source_instance_id: source_instance_id.clone(),
                        sequence: fact.sequence,
                        observed_at: fact.observed_at,
                        gap: fact.gap,
                        topology,
                    };
                    if let Err(error) = observation.validate_protocol() {
                        self.session
                            .fail(DisplayTopologyError::Protocol(error.into()));
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
                            .fail(DisplayTopologyError::Protocol(error.into()));
                        break;
                    }
                    resets.push(reset);
                }
            }
        }
        let mut drain = DisplayTopologyDrain {
            source_instance_id,
            observations,
            resets,
            health: session_drain.health,
            terminal_error: session_drain
                .terminal_error
                .as_ref()
                .map(DisplayTopologyError::failure_code),
        };
        if let Err(error) = drain.validate_protocol() {
            self.session
                .fail(DisplayTopologyError::Protocol(error.into()));
            let terminal = self.session.drain();
            drain.observations.clear();
            drain.resets.clear();
            drain.health = terminal.health;
            drain.terminal_error = terminal
                .terminal_error
                .as_ref()
                .map(DisplayTopologyError::failure_code);
        }
        drain
    }

    fn begin_stop(&self) {
        self.session.begin_stop();
    }

    fn finish_stop(&self, final_topology: Result<DisplayTopologySnapshot, DisplayTopologyError>) {
        self.session.finish_stop(final_topology);
    }

    fn dispose(&self) {
        self.session.dispose();
    }

    pub(crate) fn fail(&self, error: DisplayTopologyError) {
        self.session.fail(error);
    }

    #[cfg(any(target_os = "macos", target_os = "windows", test))]
    pub(crate) fn report_missing_transitions(&self, count: u64) {
        self.session.report_missing(count);
    }

    fn health(&self) -> SourceHealth {
        self.session.health()
    }
}

pub struct DisplayTopologySource<S: DisplayTopologySubscription> {
    emitter: DisplayTopologyEmitter,
    snapshot: DisplayTopologySourceSnapshot,
    subscription: Option<S>,
}

impl<S: DisplayTopologySubscription> DisplayTopologySource<S> {
    /// Opens a race-free source session over one concrete platform backend.
    ///
    /// # Errors
    ///
    /// Returns an error when the request is invalid or the backend cannot
    /// register observation and return a valid initial snapshot.
    pub fn open<B>(request: &SourceOpenRequest, backend: B) -> Result<Self, DisplayTopologyError>
    where
        B: DisplayTopologyBackend<Subscription = S>,
    {
        Self::open_internal(request, backend, None)
    }

    fn open_internal<B>(
        request: &SourceOpenRequest,
        backend: B,
        reset: Option<SourceResetPlan>,
    ) -> Result<Self, DisplayTopologyError>
    where
        B: DisplayTopologyBackend<Subscription = S>,
    {
        request.validate()?;
        ensure_native_source_process_usable()
            .map_err(|error| DisplayTopologyError::Cleanup(error.to_string()))?;
        let emitter = DisplayTopologyEmitter::new(usize::from(request.queue_capacity))?;
        let opened = backend.open(emitter.clone())?;
        let mut subscription = opened.subscription;
        let initial_topology = opened.initial_topology.clone();
        let snapshot_metadata =
            match emitter.finish_open(opened.initial_topology, opened.health, reset) {
                Ok(metadata) => metadata,
                Err(error) => return Err(rollback_subscription(error, &mut subscription)),
            };
        let snapshot = match DisplayTopologyEmitter::source_snapshot(
            opened.platform,
            opened.permission,
            opened.adapter_version,
            initial_topology,
            snapshot_metadata,
        ) {
            Ok(snapshot) => snapshot,
            Err(error) => return Err(rollback_subscription(error, &mut subscription)),
        };
        Ok(Self {
            emitter,
            snapshot,
            subscription: Some(subscription),
        })
    }

    /// Opens a new source instance after supervised adapter restart and records
    /// the reset as the first post-snapshot fact.
    ///
    /// # Errors
    ///
    /// Returns an open, schema, queue, or reset-reason failure.
    pub fn open_after_reset<B>(
        request: &SourceOpenRequest,
        backend: B,
        missing_count: u64,
        reason: String,
    ) -> Result<Self, DisplayTopologyError>
    where
        B: DisplayTopologyBackend<Subscription = S>,
    {
        let reset = SourceResetPlan::new(missing_count, reason)?;
        Self::open_internal(request, backend, Some(reset))
    }

    #[must_use]
    pub fn snapshot(&self) -> &DisplayTopologySourceSnapshot {
        &self.snapshot
    }

    /// Drains currently buffered ordered topology observations. Terminal health
    /// and the first terminal error remain visible in every returned batch.
    pub fn drain(&self) -> DisplayTopologyDrain {
        self.emitter.drain()
    }

    #[must_use]
    pub fn health(&self) -> SourceHealth {
        self.emitter.health()
    }

    /// Stops native delivery and returns the final ordered batch, including a
    /// terminal snapshot. Repeated calls are safe.
    ///
    pub fn stop(&mut self) -> DisplayTopologyDrain {
        if let Some(mut subscription) = self.subscription.take() {
            let final_topology = subscription.stop();
            self.emitter.begin_stop();
            self.emitter.finish_stop(final_topology);
        }
        let final_batch = self.emitter.drain();
        self.emitter.dispose();
        final_batch
    }
}

impl<S: DisplayTopologySubscription> Drop for DisplayTopologySource<S> {
    fn drop(&mut self) {
        let _ = self.stop();
    }
}

#[cfg(test)]
pub(crate) fn assert_adapter_baseline_conformance<B>(backend: B, platform: PlatformFamily)
where
    B: DisplayTopologyBackend,
{
    let request = SourceOpenRequest {
        collection_session_id: "adapter-conformance-session".to_owned(),
        queue_capacity: 16,
    };
    let mut source = DisplayTopologySource::<B::Subscription>::open(&request, backend)
        .expect("platform display source should open");
    assert_eq!(source.snapshot().platform, platform);
    source
        .snapshot()
        .validate_protocol()
        .expect("initial snapshot satisfies the source protocol");
    source
        .drain()
        .validate_protocol()
        .expect("live adapter batch satisfies the source protocol");
    let final_batch = source.stop();
    assert_eq!(final_batch.health, SourceHealth::Stopped);
    assert!(!final_batch.observations.is_empty());
    final_batch
        .validate_protocol()
        .expect("final batch satisfies the source protocol");
    let repeated = source.stop();
    assert_eq!(repeated.health, SourceHealth::Stopped);
    assert!(repeated.observations.is_empty());
    assert!(repeated.resets.is_empty());
    repeated
        .validate_protocol()
        .expect("repeated stop remains a valid empty terminal batch");
}

#[cfg(test)]
mod tests {
    use super::*;
    use native_protocol::{
        DisplayPowerState, DisplayPrimaryState, DisplayTarget, DisplayTargetKind, SequenceGap,
        TopologyCertainty,
    };
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::mpsc;
    use std::time::Instant;

    struct FakeBackend {
        initial: DisplayTopologySnapshot,
        during_open: Vec<Result<DisplayTopologySnapshot, DisplayTopologyError>>,
    }

    struct FakeSubscription {
        final_topology: DisplayTopologySnapshot,
    }

    impl DisplayTopologySubscription for FakeSubscription {
        fn stop(&mut self) -> Result<DisplayTopologySnapshot, DisplayTopologyError> {
            Ok(self.final_topology.clone())
        }
    }

    struct CleanupFailureBackend;

    struct InvalidOpenCleanupFailureBackend {
        initial: DisplayTopologySnapshot,
        adapter_version: &'static str,
    }

    struct CleanupFailureSubscription;

    struct ChangingFinalTopologyBackend;

    impl DisplayTopologySubscription for CleanupFailureSubscription {
        fn stop(&mut self) -> Result<DisplayTopologySnapshot, DisplayTopologyError> {
            Err(DisplayTopologyError::Cleanup(
                "adapter missed its cleanup deadline".to_owned(),
            ))
        }
    }

    impl DisplayTopologyBackend for CleanupFailureBackend {
        type Subscription = CleanupFailureSubscription;

        fn open(
            self,
            _emitter: DisplayTopologyEmitter,
        ) -> Result<OpenedDisplayTopologyBackend<Self::Subscription>, DisplayTopologyError>
        {
            Ok(OpenedDisplayTopologyBackend {
                platform: PlatformFamily::Linux,
                permission: PermissionState::Granted,
                health: OpenedSourceHealth::Healthy,
                adapter_version: "cleanup-failure-1",
                initial_topology: topology(1920),
                subscription: CleanupFailureSubscription,
            })
        }
    }

    impl DisplayTopologyBackend for InvalidOpenCleanupFailureBackend {
        type Subscription = CleanupFailureSubscription;

        fn open(
            self,
            _emitter: DisplayTopologyEmitter,
        ) -> Result<OpenedDisplayTopologyBackend<Self::Subscription>, DisplayTopologyError>
        {
            Ok(OpenedDisplayTopologyBackend {
                platform: PlatformFamily::Linux,
                permission: PermissionState::Granted,
                health: OpenedSourceHealth::Healthy,
                adapter_version: self.adapter_version,
                initial_topology: self.initial,
                subscription: CleanupFailureSubscription,
            })
        }
    }

    impl DisplayTopologyBackend for ChangingFinalTopologyBackend {
        type Subscription = FakeSubscription;

        fn open(
            self,
            _emitter: DisplayTopologyEmitter,
        ) -> Result<OpenedDisplayTopologyBackend<Self::Subscription>, DisplayTopologyError>
        {
            Ok(OpenedDisplayTopologyBackend {
                platform: PlatformFamily::Linux,
                permission: PermissionState::Granted,
                health: OpenedSourceHealth::Healthy,
                adapter_version: "changing-final-1",
                initial_topology: topology(1920),
                subscription: FakeSubscription {
                    final_topology: topology(2560),
                },
            })
        }
    }

    impl DisplayTopologyBackend for FakeBackend {
        type Subscription = FakeSubscription;

        fn open(
            self,
            emitter: DisplayTopologyEmitter,
        ) -> Result<OpenedDisplayTopologyBackend<Self::Subscription>, DisplayTopologyError>
        {
            for topology in self.during_open {
                emitter.emit(topology);
            }
            let final_topology = self.initial.clone();
            Ok(OpenedDisplayTopologyBackend {
                platform: PlatformFamily::Linux,
                permission: PermissionState::Granted,
                health: OpenedSourceHealth::Healthy,
                adapter_version: "fake-1",
                initial_topology: self.initial,
                subscription: FakeSubscription { final_topology },
            })
        }
    }

    fn topology(width: u32) -> DisplayTopologySnapshot {
        DisplayTopologySnapshot {
            certainty: TopologyCertainty::Complete,
            targets: vec![DisplayTarget {
                target_id: "display-1".to_owned(),
                active: true,
                primary_state: DisplayPrimaryState::Primary,
                builtin: true,
                power_state: DisplayPowerState::Awake,
                kind: DisplayTargetKind::Physical,
                mirror_primary_id: None,
                pixel_width: width,
                pixel_height: 1080,
            }],
        }
    }

    fn request() -> SourceOpenRequest {
        SourceOpenRequest {
            collection_session_id: "collection-session-0001".to_owned(),
            queue_capacity: 4,
        }
    }

    fn assert_cleanup_failure(
        result: Result<DisplayTopologySource<CleanupFailureSubscription>, DisplayTopologyError>,
    ) {
        assert_eq!(
            result.err(),
            Some(DisplayTopologyError::Cleanup(
                "adapter missed its cleanup deadline".to_owned()
            ))
        );
    }

    #[test]
    fn startup_rollback_reports_cleanup_failure_over_primary_failure() {
        let cleanup = DisplayTopologyError::Cleanup("native resource remained live".to_owned());
        assert_eq!(
            prefer_cleanup_error(
                DisplayTopologyError::Backend("initial query failed".to_owned()),
                Err(cleanup.clone()),
            ),
            cleanup
        );
    }

    #[test]
    fn final_snapshot_query_timeout_is_a_bounded_cleanup_failure() {
        let (release_sender, release_receiver) = mpsc::sync_channel(1);
        let (finished_sender, finished_receiver) = mpsc::sync_channel(1);
        let poison = AtomicBool::new(false);
        let started = Instant::now();

        let result = snapshot_with_deadline(
            "hanging-final-snapshot-test",
            "test backend",
            Duration::from_millis(25),
            &|| poison.store(true, Ordering::Release),
            move || {
                let _ = release_receiver.recv();
                let _ = finished_sender.send(());
                Ok(topology(1920))
            },
        );

        assert!(matches!(result, Err(DisplayTopologyError::Cleanup(_))));
        assert!(started.elapsed() < Duration::from_secs(1));
        assert!(poison.load(Ordering::Acquire));
        release_sender.send(()).expect("release detached query");
        finished_receiver
            .recv_timeout(Duration::from_secs(1))
            .expect("detached query exits after release");
    }

    #[test]
    fn native_cleanup_timeout_poison_fences_same_process_reopen() {
        let (release_sender, release_receiver) = mpsc::sync_channel(1);
        let (finished_sender, finished_receiver) = mpsc::sync_channel(1);
        let poison = AtomicBool::new(false);

        let result = operation_with_deadline(
            "hanging-native-cleanup-test",
            "test callback removal",
            Duration::from_millis(25),
            &|| poison.store(true, Ordering::Release),
            move || {
                let _ = release_receiver.recv();
                let _ = finished_sender.send(());
                Ok(())
            },
        );

        assert!(matches!(result, Err(DisplayTopologyError::Cleanup(_))));
        assert!(poison.load(Ordering::Acquire));
        release_sender.send(()).expect("release detached cleanup");
        finished_receiver
            .recv_timeout(Duration::from_secs(1))
            .expect("detached cleanup exits after release");
    }

    #[test]
    fn worker_finish_timeout_poison_fences_same_process_reopen() {
        let (release_sender, release_receiver) = mpsc::sync_channel(1);
        let (finished_sender, finished_receiver) = mpsc::sync_channel(1);
        let poison = AtomicBool::new(false);
        let mut worker = DeadlineThread::spawn("hanging-source-worker-test", move || {
            let _ = release_receiver.recv();
            let _ = finished_sender.send(());
        })
        .expect("spawn hanging source worker");

        let result = finish_thread_with_deadline(
            &mut worker,
            Duration::from_millis(25),
            "test source worker",
            &|| poison.store(true, Ordering::Release),
        );

        assert!(matches!(result, Err(DisplayTopologyError::Cleanup(_))));
        assert!(poison.load(Ordering::Acquire));
        release_sender.send(()).expect("release detached worker");
        finished_receiver
            .recv_timeout(Duration::from_secs(1))
            .expect("detached worker exits after release");
    }

    #[test]
    fn failed_post_open_validation_reports_cleanup_failure() {
        let mut invalid_topology = topology(1920);
        invalid_topology.targets[0].target_id.clear();
        assert_cleanup_failure(DisplayTopologySource::<CleanupFailureSubscription>::open(
            &request(),
            InvalidOpenCleanupFailureBackend {
                initial: invalid_topology,
                adapter_version: "valid-adapter-1",
            },
        ));

        assert_cleanup_failure(DisplayTopologySource::<CleanupFailureSubscription>::open(
            &request(),
            InvalidOpenCleanupFailureBackend {
                initial: topology(1920),
                adapter_version: "",
            },
        ));
    }

    #[test]
    fn event_during_initial_snapshot_is_delivered_after_sequence_zero() {
        let source = DisplayTopologySource::<FakeSubscription>::open(
            &request(),
            FakeBackend {
                initial: topology(1920),
                during_open: vec![Ok(topology(2560))],
            },
        )
        .expect("source opens");
        assert_eq!(source.snapshot().sequence, 0);
        assert_eq!(source.snapshot().topology, topology(1920));
        let drain = source.drain();
        assert_eq!(drain.health, SourceHealth::Healthy);
        assert_eq!(drain.observations.len(), 1);
        assert_eq!(drain.observations[0].sequence, 1);
        assert_eq!(drain.observations[0].topology, topology(2560));
    }

    #[test]
    fn duplicate_topology_is_coalesced() {
        let source = DisplayTopologySource::<FakeSubscription>::open(
            &request(),
            FakeBackend {
                initial: topology(1920),
                during_open: vec![Ok(topology(1920))],
            },
        )
        .expect("source opens");
        assert!(source.drain().observations.is_empty());
    }

    #[test]
    fn accepted_topology_certainty_updates_source_health() {
        let source = DisplayTopologySource::<FakeSubscription>::open(
            &request(),
            FakeBackend {
                initial: topology(1920),
                during_open: Vec::new(),
            },
        )
        .expect("source opens");
        let mut partial = topology(2560);
        partial.certainty = TopologyCertainty::Partial;

        source.emitter.emit(Ok(partial));
        assert_eq!(source.drain().health, SourceHealth::Degraded);

        source.emitter.emit(Ok(topology(3840)));
        assert_eq!(source.drain().health, SourceHealth::Healthy);
    }

    #[test]
    fn explicit_os_transition_is_preserved_when_topology_is_unchanged() {
        let source = DisplayTopologySource::<FakeSubscription>::open(
            &request(),
            FakeBackend {
                initial: topology(1920),
                during_open: Vec::new(),
            },
        )
        .expect("source opens");

        source.emitter.emit_transition(Ok(topology(1920)));

        let drained = source.drain();
        assert_eq!(drained.observations.len(), 1);
        assert_eq!(drained.observations[0].sequence, 1);
    }

    #[test]
    fn every_distinct_event_during_initial_snapshot_is_delivered_in_order() {
        let source = DisplayTopologySource::<FakeSubscription>::open(
            &request(),
            FakeBackend {
                initial: topology(1920),
                during_open: vec![Ok(topology(2560)), Ok(topology(3840)), Ok(topology(1920))],
            },
        )
        .expect("source opens");

        let observations = source.drain().observations;
        assert_eq!(
            observations
                .iter()
                .map(|observation| observation.topology.targets[0].pixel_width)
                .collect::<Vec<_>>(),
            vec![2560, 3840, 1920]
        );
        assert_eq!(
            observations
                .iter()
                .map(|observation| observation.sequence)
                .collect::<Vec<_>>(),
            vec![1, 2, 3]
        );
    }

    #[test]
    fn backend_failure_remains_visible_after_every_drain() {
        let source = DisplayTopologySource::<FakeSubscription>::open(
            &request(),
            FakeBackend {
                initial: topology(1920),
                during_open: vec![Err(DisplayTopologyError::Backend(
                    "observer failed".to_owned(),
                ))],
            },
        )
        .expect("source opens in failed state");

        let first = source.drain();
        let second = source.drain();
        assert_eq!(first.health, SourceHealth::Failed);
        assert_eq!(second.health, SourceHealth::Failed);
        assert_eq!(first.terminal_error, second.terminal_error);
    }

    #[test]
    fn overflow_fails_the_required_source_and_preserves_the_gap() {
        let mut small_request = request();
        small_request.queue_capacity = 2;
        let source = DisplayTopologySource::<FakeSubscription>::open(
            &small_request,
            FakeBackend {
                initial: topology(1920),
                during_open: vec![Ok(topology(2560)), Ok(topology(3840)), Ok(topology(5120))],
            },
        )
        .expect("source opens in failed state");

        let drain = source.drain();
        assert_eq!(drain.health, SourceHealth::Failed);
        assert!(matches!(
            drain.terminal_error,
            Some(SourceFailureCode::QueueOverflow)
        ));
        assert_eq!(
            drain.observations[0].gap,
            Some(native_protocol::SequenceGap {
                first_missing: 1,
                last_missing: 1,
            })
        );
    }

    #[test]
    fn dropped_callback_wakeups_create_a_gap_and_terminal_failure() {
        let source = DisplayTopologySource::<FakeSubscription>::open(
            &request(),
            FakeBackend {
                initial: topology(1920),
                during_open: Vec::new(),
            },
        )
        .expect("source opens");

        source.emitter.report_missing_transitions(2);

        let drain = source.drain();
        assert_eq!(drain.health, SourceHealth::Failed);
        assert_eq!(drain.terminal_error, Some(SourceFailureCode::QueueOverflow));
        assert_eq!(drain.observations[0].sequence, 3);
        assert_eq!(
            drain.observations[0].gap,
            Some(native_protocol::SequenceGap {
                first_missing: 1,
                last_missing: 2,
            })
        );
    }

    #[test]
    fn reopen_after_reset_uses_a_fresh_instance_and_orders_the_reset() {
        let first = DisplayTopologySource::<FakeSubscription>::open(
            &request(),
            FakeBackend {
                initial: topology(1920),
                during_open: Vec::new(),
            },
        )
        .expect("first source opens");
        let second = DisplayTopologySource::<FakeSubscription>::open_after_reset(
            &request(),
            FakeBackend {
                initial: topology(1920),
                during_open: vec![Ok(topology(2560))],
            },
            2,
            "adapter restarted".to_owned(),
        )
        .expect("replacement source opens");

        assert_ne!(
            first.snapshot().source_instance_id,
            second.snapshot().source_instance_id
        );
        let drain = second.drain();
        assert_eq!(drain.resets.len(), 1);
        assert_eq!(drain.resets[0].sequence, 3);
        assert_eq!(
            drain.resets[0].gap,
            Some(native_protocol::SequenceGap {
                first_missing: 1,
                last_missing: 2,
            })
        );
        assert_eq!(drain.observations.len(), 1);
        assert_eq!(drain.observations[0].sequence, 4);
        assert_eq!(drain.observations[0].topology, topology(2560));
    }

    #[test]
    fn reopen_rejects_a_reset_gap_that_cannot_be_represented_on_the_wire() {
        let result = DisplayTopologySource::<FakeSubscription>::open_after_reset(
            &request(),
            FakeBackend {
                initial: topology(1920),
                during_open: Vec::new(),
            },
            9_007_199_254_740_991,
            "adapter restarted".to_owned(),
        );

        assert!(matches!(result, Err(DisplayTopologyError::Protocol(_))));
    }

    #[test]
    fn startup_overflow_preserves_the_restart_fence() {
        let mut small_request = request();
        small_request.queue_capacity = 2;
        let source = DisplayTopologySource::<FakeSubscription>::open_after_reset(
            &small_request,
            FakeBackend {
                initial: topology(1920),
                during_open: vec![Ok(topology(2560)), Ok(topology(3840))],
            },
            2,
            "adapter restarted".to_owned(),
        )
        .expect("replacement source opens in failed state");

        let drain = source.drain();
        assert_eq!(drain.health, SourceHealth::Failed);
        assert_eq!(drain.resets.len(), 1);
        assert_eq!(drain.resets[0].sequence, 3);
        assert_eq!(drain.observations.len(), 1);
        assert_eq!(drain.observations[0].sequence, 5);
        assert_eq!(drain.observations[0].topology, topology(3840));
        assert_eq!(
            drain.observations[0].gap,
            Some(SequenceGap {
                first_missing: 4,
                last_missing: 4,
            })
        );
    }

    #[test]
    fn explicit_stop_returns_the_terminal_snapshot() {
        let mut source = DisplayTopologySource::<FakeSubscription>::open(
            &request(),
            ChangingFinalTopologyBackend,
        )
        .expect("source opens");

        let final_batch = source.stop();

        assert_eq!(final_batch.health, SourceHealth::Stopped);
        assert_eq!(final_batch.observations.len(), 1);
        assert_eq!(final_batch.observations[0].sequence, 1);
        assert_eq!(final_batch.observations[0].topology, topology(2560));
        assert!(source.drain().observations.is_empty());
    }

    #[test]
    fn cleanup_failure_is_reported_through_the_final_drain() {
        let mut source = DisplayTopologySource::<CleanupFailureSubscription>::open(
            &request(),
            CleanupFailureBackend,
        )
        .expect("source opens");

        let final_batch = source.stop();

        assert_eq!(final_batch.health, SourceHealth::Failed);
        assert_eq!(final_batch.terminal_error, Some(SourceFailureCode::Cleanup));
        assert!(final_batch.observations.is_empty());
    }
}
