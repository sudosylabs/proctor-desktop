#![forbid(unsafe_code)]

mod helper_sources;
pub use helper_sources::HelperSourceConnection;

use std::fmt;
use std::marker::PhantomData;
use std::sync::mpsc::{self, Receiver, RecvTimeoutError, TryRecvError};
use std::thread;
use std::time::{Duration, Instant};

use candidate_window_state::{
    CandidateWindowBackend, CandidateWindowError, CandidateWindowSource,
    CandidateWindowSubscription,
};
use capture_session_state::{
    CaptureSessionBackend, CaptureSessionError, CaptureSessionSource, CaptureSessionSubscription,
};
use clipboard_state::ClipboardWire;
use display_topology::{
    DisplayTopologyBackend, DisplayTopologyError, DisplayTopologySource,
    DisplayTopologySubscription,
};
use interactive_session_state::InteractiveSessionWire;
use media_device_state::MediaDeviceWire;
use native_protocol::{
    CANDIDATE_WINDOW_SCHEMA_VERSION, CAPTURE_SESSION_SCHEMA_VERSION, CandidateWindowDrain,
    CandidateWindowSourceSnapshot, CaptureSessionDrain, CaptureSessionSourceSnapshot,
    ClipboardDrain, ClipboardSourceSnapshot, DISPLAY_TOPOLOGY_SCHEMA_VERSION, DisplayTopologyDrain,
    DisplayTopologySourceSnapshot, InteractiveSessionDrain, InteractiveSessionSourceSnapshot,
    MediaDeviceDrain, MediaDeviceSourceSnapshot, NATIVE_SOURCE_COUNT,
    NATIVE_SOURCE_LIFECYCLE_DEADLINE_MS, NetworkConfigurationDrain,
    NetworkConfigurationSourceSnapshot, PROCESS_APPLICATION_SCHEMA_VERSION, PermissionState,
    PrintSpoolerDrain, PrintSpoolerSourceSnapshot, ProcessApplicationDrain,
    ProcessApplicationSourceSnapshot, ProtocolValidatable, RemovableStorageDrain,
    RemovableStorageSourceSnapshot, SourceFailureCode, SourceHealth, SourceOpenRequest,
    VirtualizationDrain, VirtualizationSourceSnapshot,
};
use native_source_runtime::{
    BoundedTaskError, PassiveStateBackend, PassiveStateSource, PassiveStateSourceError,
    PassiveStateSubscription, PassiveStateWire, ensure_native_source_process_usable,
    poison_native_source_process, run_bounded_task,
};
use network_configuration_state::NetworkConfigurationWire;
use print_spooler_state::PrintSpoolerWire;
use process_application_state::{
    ProcessApplicationBackend, ProcessApplicationError, ProcessApplicationSource,
    ProcessApplicationSubscription,
};
use removable_storage_state::RemovableStorageWire;
use virtualization_state::VirtualizationWire;

const RESTART_BOUNDARY_MISSING_COUNT: u64 = 1;
const RESTART_REASON: &str = "supervised-source-restart";
const REQUIRED_RESTART_ATTEMPTS: u8 = 1;
const MAX_RESTART_BACKOFF: Duration = Duration::from_secs(60);
const SOURCE_OPEN_DEADLINE: Duration = Duration::from_millis(NATIVE_SOURCE_LIFECYCLE_DEADLINE_MS);

pub const NATIVE_SOURCE_KINDS: [NativeSourceKind; NATIVE_SOURCE_COUNT] = [
    NativeSourceKind::DisplayTopology,
    NativeSourceKind::CandidateWindow,
    NativeSourceKind::CaptureSession,
    NativeSourceKind::ProcessApplication,
    NativeSourceKind::InteractiveSession,
    NativeSourceKind::Clipboard,
    NativeSourceKind::PrintSpooler,
    NativeSourceKind::RemovableStorage,
    NativeSourceKind::Virtualization,
    NativeSourceKind::NetworkConfiguration,
    NativeSourceKind::MediaDevice,
];

#[derive(Clone, Copy, Debug, Eq, Ord, PartialEq, PartialOrd)]
pub enum NativeSourceKind {
    DisplayTopology,
    CandidateWindow,
    CaptureSession,
    ProcessApplication,
    InteractiveSession,
    Clipboard,
    PrintSpooler,
    RemovableStorage,
    Virtualization,
    NetworkConfiguration,
    MediaDevice,
}

impl fmt::Display for NativeSourceKind {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(match self {
            Self::DisplayTopology => "display-topology",
            Self::CandidateWindow => "candidate-window",
            Self::CaptureSession => "capture-session",
            Self::ProcessApplication => "process-application",
            Self::InteractiveSession => "interactive-session",
            Self::Clipboard => "clipboard",
            Self::PrintSpooler => "print-spooler",
            Self::RemovableStorage => "removable-storage",
            Self::Virtualization => "virtualization",
            Self::NetworkConfiguration => "network-configuration",
            Self::MediaDevice => "media-device",
        })
    }
}

impl NativeSourceKind {
    #[must_use]
    pub fn from_source_id(source_id: &str) -> Option<Self> {
        NATIVE_SOURCE_KINDS
            .into_iter()
            .find(|kind| kind.to_string() == source_id)
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum NativeSourceSnapshot {
    DisplayTopology(DisplayTopologySourceSnapshot),
    CandidateWindow(CandidateWindowSourceSnapshot),
    CaptureSession(CaptureSessionSourceSnapshot),
    ProcessApplication(ProcessApplicationSourceSnapshot),
    InteractiveSession(InteractiveSessionSourceSnapshot),
    Clipboard(ClipboardSourceSnapshot),
    PrintSpooler(PrintSpoolerSourceSnapshot),
    RemovableStorage(RemovableStorageSourceSnapshot),
    Virtualization(VirtualizationSourceSnapshot),
    NetworkConfiguration(NetworkConfigurationSourceSnapshot),
    MediaDevice(MediaDeviceSourceSnapshot),
}

impl NativeSourceSnapshot {
    #[must_use]
    pub fn kind(&self) -> NativeSourceKind {
        match self {
            Self::DisplayTopology(_) => NativeSourceKind::DisplayTopology,
            Self::CandidateWindow(_) => NativeSourceKind::CandidateWindow,
            Self::CaptureSession(_) => NativeSourceKind::CaptureSession,
            Self::ProcessApplication(_) => NativeSourceKind::ProcessApplication,
            Self::InteractiveSession(_) => NativeSourceKind::InteractiveSession,
            Self::Clipboard(_) => NativeSourceKind::Clipboard,
            Self::PrintSpooler(_) => NativeSourceKind::PrintSpooler,
            Self::RemovableStorage(_) => NativeSourceKind::RemovableStorage,
            Self::Virtualization(_) => NativeSourceKind::Virtualization,
            Self::NetworkConfiguration(_) => NativeSourceKind::NetworkConfiguration,
            Self::MediaDevice(_) => NativeSourceKind::MediaDevice,
        }
    }

    #[must_use]
    pub fn source_instance_id(&self) -> &str {
        match self {
            Self::DisplayTopology(snapshot) => &snapshot.source_instance_id,
            Self::CandidateWindow(snapshot) => &snapshot.source_instance_id,
            Self::CaptureSession(snapshot) => &snapshot.source_instance_id,
            Self::ProcessApplication(snapshot) => &snapshot.source_instance_id,
            Self::InteractiveSession(snapshot) => &snapshot.source_instance_id,
            Self::Clipboard(snapshot) => &snapshot.source_instance_id,
            Self::PrintSpooler(snapshot) => &snapshot.source_instance_id,
            Self::RemovableStorage(snapshot) => &snapshot.source_instance_id,
            Self::Virtualization(snapshot) => &snapshot.source_instance_id,
            Self::NetworkConfiguration(snapshot) => &snapshot.source_instance_id,
            Self::MediaDevice(snapshot) => &snapshot.source_instance_id,
        }
    }

    #[must_use]
    pub fn health(&self) -> SourceHealth {
        match self {
            Self::DisplayTopology(snapshot) => snapshot.health,
            Self::CandidateWindow(snapshot) => snapshot.health,
            Self::CaptureSession(snapshot) => snapshot.health,
            Self::ProcessApplication(snapshot) => snapshot.health,
            Self::InteractiveSession(snapshot) => snapshot.health,
            Self::Clipboard(snapshot) => snapshot.health,
            Self::PrintSpooler(snapshot) => snapshot.health,
            Self::RemovableStorage(snapshot) => snapshot.health,
            Self::Virtualization(snapshot) => snapshot.health,
            Self::NetworkConfiguration(snapshot) => snapshot.health,
            Self::MediaDevice(snapshot) => snapshot.health,
        }
    }

    #[must_use]
    pub fn permission(&self) -> PermissionState {
        match self {
            Self::DisplayTopology(snapshot) => snapshot.permission,
            Self::CandidateWindow(snapshot) => snapshot.permission,
            Self::CaptureSession(snapshot) => snapshot.permission,
            Self::ProcessApplication(snapshot) => snapshot.permission,
            Self::InteractiveSession(snapshot) => snapshot.permission,
            Self::Clipboard(snapshot) => snapshot.permission,
            Self::PrintSpooler(snapshot) => snapshot.permission,
            Self::RemovableStorage(snapshot) => snapshot.permission,
            Self::Virtualization(snapshot) => snapshot.permission,
            Self::NetworkConfiguration(snapshot) => snapshot.permission,
            Self::MediaDevice(snapshot) => snapshot.permission,
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum NativeSourceBatch {
    DisplayTopology(DisplayTopologyDrain),
    CandidateWindow(CandidateWindowDrain),
    CaptureSession(CaptureSessionDrain),
    ProcessApplication(ProcessApplicationDrain),
    InteractiveSession(InteractiveSessionDrain),
    Clipboard(ClipboardDrain),
    PrintSpooler(PrintSpoolerDrain),
    RemovableStorage(RemovableStorageDrain),
    Virtualization(VirtualizationDrain),
    NetworkConfiguration(NetworkConfigurationDrain),
    MediaDevice(MediaDeviceDrain),
}

impl NativeSourceBatch {
    #[must_use]
    pub fn kind(&self) -> NativeSourceKind {
        match self {
            Self::DisplayTopology(_) => NativeSourceKind::DisplayTopology,
            Self::CandidateWindow(_) => NativeSourceKind::CandidateWindow,
            Self::CaptureSession(_) => NativeSourceKind::CaptureSession,
            Self::ProcessApplication(_) => NativeSourceKind::ProcessApplication,
            Self::InteractiveSession(_) => NativeSourceKind::InteractiveSession,
            Self::Clipboard(_) => NativeSourceKind::Clipboard,
            Self::PrintSpooler(_) => NativeSourceKind::PrintSpooler,
            Self::RemovableStorage(_) => NativeSourceKind::RemovableStorage,
            Self::Virtualization(_) => NativeSourceKind::Virtualization,
            Self::NetworkConfiguration(_) => NativeSourceKind::NetworkConfiguration,
            Self::MediaDevice(_) => NativeSourceKind::MediaDevice,
        }
    }

    #[must_use]
    pub fn source_instance_id(&self) -> &str {
        match self {
            Self::DisplayTopology(batch) => &batch.source_instance_id,
            Self::CandidateWindow(batch) => &batch.source_instance_id,
            Self::CaptureSession(batch) => &batch.source_instance_id,
            Self::ProcessApplication(batch) => &batch.source_instance_id,
            Self::InteractiveSession(batch) => &batch.source_instance_id,
            Self::Clipboard(batch) => &batch.source_instance_id,
            Self::PrintSpooler(batch) => &batch.source_instance_id,
            Self::RemovableStorage(batch) => &batch.source_instance_id,
            Self::Virtualization(batch) => &batch.source_instance_id,
            Self::NetworkConfiguration(batch) => &batch.source_instance_id,
            Self::MediaDevice(batch) => &batch.source_instance_id,
        }
    }

    #[must_use]
    pub fn health(&self) -> SourceHealth {
        match self {
            Self::DisplayTopology(batch) => batch.health,
            Self::CandidateWindow(batch) => batch.health,
            Self::CaptureSession(batch) => batch.health,
            Self::ProcessApplication(batch) => batch.health,
            Self::InteractiveSession(batch) => batch.health,
            Self::Clipboard(batch) => batch.health,
            Self::PrintSpooler(batch) => batch.health,
            Self::RemovableStorage(batch) => batch.health,
            Self::Virtualization(batch) => batch.health,
            Self::NetworkConfiguration(batch) => batch.health,
            Self::MediaDevice(batch) => batch.health,
        }
    }

    #[must_use]
    pub fn terminal_error(&self) -> Option<SourceFailureCode> {
        match self {
            Self::DisplayTopology(batch) => batch.terminal_error,
            Self::CandidateWindow(batch) => batch.terminal_error,
            Self::CaptureSession(batch) => batch.terminal_error,
            Self::ProcessApplication(batch) => batch.terminal_error,
            Self::InteractiveSession(batch) => batch.terminal_error,
            Self::Clipboard(batch) => batch.terminal_error,
            Self::PrintSpooler(batch) => batch.terminal_error,
            Self::RemovableStorage(batch) => batch.terminal_error,
            Self::Virtualization(batch) => batch.terminal_error,
            Self::NetworkConfiguration(batch) => batch.terminal_error,
            Self::MediaDevice(batch) => batch.terminal_error,
        }
    }

    #[must_use]
    pub fn fact_count(&self) -> usize {
        match self {
            Self::DisplayTopology(batch) => batch.observations.len() + batch.resets.len(),
            Self::CandidateWindow(batch) => batch.observations.len() + batch.resets.len(),
            Self::CaptureSession(batch) => batch.observations.len() + batch.resets.len(),
            Self::ProcessApplication(batch) => batch.observations.len() + batch.resets.len(),
            Self::InteractiveSession(batch) => batch.observations.len() + batch.resets.len(),
            Self::Clipboard(batch) => batch.observations.len() + batch.resets.len(),
            Self::PrintSpooler(batch) => batch.observations.len() + batch.resets.len(),
            Self::RemovableStorage(batch) => batch.observations.len() + batch.resets.len(),
            Self::Virtualization(batch) => batch.observations.len() + batch.resets.len(),
            Self::NetworkConfiguration(batch) => batch.observations.len() + batch.resets.len(),
            Self::MediaDevice(batch) => batch.observations.len() + batch.resets.len(),
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum SupervisorState {
    Healthy,
    Degraded,
    Recovering,
    Failed,
    Stopped,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct RestartPolicy {
    maximum_attempts: u8,
    initial_backoff: Duration,
    maximum_backoff: Duration,
}

impl RestartPolicy {
    /// Creates the bounded process-local source restart policy.
    ///
    /// # Errors
    ///
    /// Returns a configuration error unless exactly one automatic restart is
    /// requested, or for a zero, inverted, or excessive backoff.
    pub fn new(
        maximum_attempts: u8,
        initial_backoff: Duration,
        maximum_backoff: Duration,
    ) -> Result<Self, SupervisorConfigError> {
        if maximum_attempts != REQUIRED_RESTART_ATTEMPTS {
            return Err(SupervisorConfigError::InvalidRestartAttempts);
        }
        if initial_backoff.is_zero()
            || initial_backoff > maximum_backoff
            || maximum_backoff > MAX_RESTART_BACKOFF
        {
            return Err(SupervisorConfigError::InvalidRestartBackoff);
        }
        Ok(Self {
            maximum_attempts,
            initial_backoff,
            maximum_backoff,
        })
    }
}

impl Default for RestartPolicy {
    fn default() -> Self {
        Self {
            maximum_attempts: REQUIRED_RESTART_ATTEMPTS,
            initial_backoff: Duration::from_millis(250),
            maximum_backoff: Duration::from_secs(4),
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SupervisorConfig {
    collection_session_id: String,
    queue_capacity: u16,
    restart_policy: RestartPolicy,
}

impl SupervisorConfig {
    /// Validates the capability-neutral collection identifier and source bounds.
    ///
    /// # Errors
    ///
    /// Returns [`SupervisorConfigError::InvalidSourceRequest`] when the
    /// identifier or queue capacity violates the shared source protocol.
    pub fn new(
        collection_session_id: String,
        queue_capacity: u16,
        restart_policy: RestartPolicy,
    ) -> Result<Self, SupervisorConfigError> {
        SourceOpenRequest {
            collection_session_id: collection_session_id.clone(),
            requested_schema_version: DISPLAY_TOPOLOGY_SCHEMA_VERSION,
            queue_capacity,
        }
        .validate_protocol()
        .map_err(|_error| SupervisorConfigError::InvalidSourceRequest)?;
        Ok(Self {
            collection_session_id,
            queue_capacity,
            restart_policy,
        })
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum SupervisorConfigError {
    InvalidSourceRequest,
    InvalidRestartAttempts,
    InvalidRestartBackoff,
}

impl fmt::Display for SupervisorConfigError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(match self {
            Self::InvalidSourceRequest => "source request is outside the bounded native protocol",
            Self::InvalidRestartAttempts => "restart attempts must be exactly one",
            Self::InvalidRestartBackoff => {
                "restart backoff must be ordered, nonzero, and no longer than one minute"
            }
        })
    }
}

impl std::error::Error for SupervisorConfigError {}

pub struct DisplayTopologyFactory<F, B> {
    make_backend: F,
    backend: PhantomData<fn() -> B>,
}

#[must_use]
pub fn display_topology_factory<F, B>(make_backend: F) -> DisplayTopologyFactory<F, B>
where
    F: FnMut() -> Result<B, DisplayTopologyError> + Send,
    B: DisplayTopologyBackend + Send,
    B::Subscription: Send,
{
    DisplayTopologyFactory {
        make_backend,
        backend: PhantomData,
    }
}

pub struct CandidateWindowFactory<F, B> {
    make_backend: F,
    backend: PhantomData<fn() -> B>,
}

#[must_use]
pub fn candidate_window_factory<F, B>(make_backend: F) -> CandidateWindowFactory<F, B>
where
    F: FnMut() -> Result<B, CandidateWindowError> + Send,
    B: CandidateWindowBackend + Send,
    B::Subscription: Send,
{
    CandidateWindowFactory {
        make_backend,
        backend: PhantomData,
    }
}

pub struct CaptureSessionFactory<F, B> {
    make_backend: F,
    backend: PhantomData<fn() -> B>,
}

#[must_use]
pub fn capture_session_factory<F, B>(make_backend: F) -> CaptureSessionFactory<F, B>
where
    F: FnMut() -> Result<B, CaptureSessionError> + Send,
    B: CaptureSessionBackend + Send,
    B::Subscription: Send,
{
    CaptureSessionFactory {
        make_backend,
        backend: PhantomData,
    }
}

pub struct ProcessApplicationFactory<F, B> {
    make_backend: F,
    backend: PhantomData<fn() -> B>,
}

#[must_use]
pub fn process_application_factory<F, B>(make_backend: F) -> ProcessApplicationFactory<F, B>
where
    F: FnMut() -> Result<B, ProcessApplicationError> + Send,
    B: ProcessApplicationBackend + Send,
    B::Subscription: Send,
{
    ProcessApplicationFactory {
        make_backend,
        backend: PhantomData,
    }
}

pub trait SupervisedPassiveStateWire: PassiveStateWire {
    const KIND: NativeSourceKind;
    fn wrap_snapshot(snapshot: Self::Snapshot) -> NativeSourceSnapshot;
    fn wrap_batch(batch: Self::Drain) -> NativeSourceBatch;
}

macro_rules! supervised_passive_wire {
    ($wire:ty, $kind:ident, $snapshot:ident, $batch:ident) => {
        impl SupervisedPassiveStateWire for $wire {
            const KIND: NativeSourceKind = NativeSourceKind::$kind;
            fn wrap_snapshot(snapshot: Self::Snapshot) -> NativeSourceSnapshot {
                NativeSourceSnapshot::$snapshot(snapshot)
            }
            fn wrap_batch(batch: Self::Drain) -> NativeSourceBatch {
                NativeSourceBatch::$batch(batch)
            }
        }
    };
}

supervised_passive_wire!(
    InteractiveSessionWire,
    InteractiveSession,
    InteractiveSession,
    InteractiveSession
);
supervised_passive_wire!(ClipboardWire, Clipboard, Clipboard, Clipboard);
supervised_passive_wire!(PrintSpoolerWire, PrintSpooler, PrintSpooler, PrintSpooler);
supervised_passive_wire!(
    RemovableStorageWire,
    RemovableStorage,
    RemovableStorage,
    RemovableStorage
);
supervised_passive_wire!(
    VirtualizationWire,
    Virtualization,
    Virtualization,
    Virtualization
);
supervised_passive_wire!(
    NetworkConfigurationWire,
    NetworkConfiguration,
    NetworkConfiguration,
    NetworkConfiguration
);
supervised_passive_wire!(MediaDeviceWire, MediaDevice, MediaDevice, MediaDevice);

pub struct PassiveStateFactory<W, F, B> {
    make_backend: F,
    wire: PhantomData<fn() -> (W, B)>,
}

#[must_use]
pub fn passive_state_factory<W, F, B>(make_backend: F) -> PassiveStateFactory<W, F, B>
where
    W: SupervisedPassiveStateWire,
    F: FnMut() -> Result<B, PassiveStateSourceError> + Send,
    B: PassiveStateBackend<W> + Send,
    B::Subscription: Send,
{
    PassiveStateFactory {
        make_backend,
        wire: PhantomData,
    }
}

pub struct BaselineSourceFactories {
    manifest_order: Vec<(NativeSourceKind, Box<dyn ErasedFactory>)>,
}

impl BaselineSourceFactories {
    #[must_use]
    pub fn new<DF, DB, WF, WB, CF, CB, PF, PB>(
        display_topology: DisplayTopologyFactory<DF, DB>,
        candidate_window: CandidateWindowFactory<WF, WB>,
        capture_session: CaptureSessionFactory<CF, CB>,
        process_application: ProcessApplicationFactory<PF, PB>,
    ) -> Self
    where
        DF: FnMut() -> Result<DB, DisplayTopologyError> + Send + 'static,
        DB: DisplayTopologyBackend + Send + 'static,
        DB::Subscription: Send + 'static,
        WF: FnMut() -> Result<WB, CandidateWindowError> + Send + 'static,
        WB: CandidateWindowBackend + Send + 'static,
        WB::Subscription: Send + 'static,
        CF: FnMut() -> Result<CB, CaptureSessionError> + Send + 'static,
        CB: CaptureSessionBackend + Send + 'static,
        CB::Subscription: Send + 'static,
        PF: FnMut() -> Result<PB, ProcessApplicationError> + Send + 'static,
        PB: ProcessApplicationBackend + Send + 'static,
        PB::Subscription: Send + 'static,
    {
        Self {
            manifest_order: vec![
                (
                    NativeSourceKind::DisplayTopology,
                    Box::new(display_topology),
                ),
                (
                    NativeSourceKind::CandidateWindow,
                    Box::new(candidate_window),
                ),
                (NativeSourceKind::CaptureSession, Box::new(capture_session)),
                (
                    NativeSourceKind::ProcessApplication,
                    Box::new(process_application),
                ),
            ],
        }
    }

    #[must_use]
    pub fn with_passive_source<W, F, B>(mut self, factory: PassiveStateFactory<W, F, B>) -> Self
    where
        W: SupervisedPassiveStateWire,
        F: FnMut() -> Result<B, PassiveStateSourceError> + Send + 'static,
        B: PassiveStateBackend<W> + Send + 'static,
        B::Subscription: Send + 'static,
    {
        self.manifest_order.push((W::KIND, Box::new(factory)));
        self
    }

    /// Retains only explicitly enabled sources while preserving manifest order.
    ///
    /// # Errors
    ///
    /// Returns a configuration error for an empty selection, duplicates, or a
    /// source for which this factory collection has no entry.
    pub fn select_sources(
        mut self,
        selected: &[NativeSourceKind],
    ) -> Result<Self, SupervisorConfigError> {
        if selected.is_empty()
            || selected
                .iter()
                .enumerate()
                .any(|(index, kind)| selected[..index].contains(kind))
            || selected.iter().any(|selected_kind| {
                !self
                    .manifest_order
                    .iter()
                    .any(|(kind, _)| kind == selected_kind)
            })
        {
            return Err(SupervisorConfigError::InvalidSourceRequest);
        }
        self.manifest_order
            .retain(|(kind, _factory)| selected.contains(kind));
        Ok(self)
    }

    #[cfg(test)]
    fn from_erased(manifest_order: Vec<(NativeSourceKind, Box<dyn ErasedFactory>)>) -> Self {
        Self { manifest_order }
    }

    fn into_manifest_order(self) -> Vec<(NativeSourceKind, Box<dyn ErasedFactory>)> {
        self.manifest_order
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct BaselineSourceSnapshots {
    pub sources: Vec<NativeSourceSnapshot>,
}

pub struct OpenedSupervisor {
    pub supervisor: NativeSourceSupervisor,
    pub snapshots: BaselineSourceSnapshots,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum SourceLifecycleTransition {
    RestartScheduled {
        source: NativeSourceKind,
        previous_source_instance_id: String,
        next_attempt: u8,
        retry_after: Duration,
        failure: SourceFailureCode,
    },
    Restarted {
        source: NativeSourceKind,
        previous_source_instance_id: String,
        new_source_instance_id: String,
        attempt: u8,
    },
    RestartAttemptFailed {
        source: NativeSourceKind,
        attempt: u8,
        retry_after: Duration,
        failure: SourceFailureCode,
    },
    RestartExhausted {
        source: NativeSourceKind,
        attempts: u8,
        failure: SourceFailureCode,
    },
    ProcessReplacementRequired {
        source: NativeSourceKind,
        failure: SourceFailureCode,
    },
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SupervisorPoll {
    pub state: SupervisorState,
    pub opened_snapshots: Vec<NativeSourceSnapshot>,
    pub final_snapshots: Vec<NativeSourceSnapshot>,
    pub batches: Vec<NativeSourceBatch>,
    pub transitions: Vec<SourceLifecycleTransition>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SupervisorStop {
    pub state: SupervisorState,
    pub final_snapshots: Vec<NativeSourceSnapshot>,
    pub batches: Vec<NativeSourceBatch>,
    pub process_replacement_required: bool,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SupervisorOpenError {
    pub source: NativeSourceKind,
    pub failure: SourceFailureCode,
    pub cleanup_failures: Vec<NativeSourceKind>,
    pub process_replacement_required: bool,
}

impl fmt::Display for SupervisorOpenError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            formatter,
            "{} source failed to open ({})",
            self.source,
            failure_code_name(self.failure)
        )?;
        if !self.cleanup_failures.is_empty() {
            write!(
                formatter,
                "; rollback cleanup failed for {} source(s)",
                self.cleanup_failures.len()
            )?;
        }
        Ok(())
    }
}

impl std::error::Error for SupervisorOpenError {}

pub struct NativeSourceSupervisor {
    config: SupervisorConfig,
    clock: Box<dyn SupervisorClock>,
    process_fence: Box<dyn ProcessFence>,
    restart_open_deadline: Duration,
    slots: Vec<SourceSlot>,
    process_replacement_required: bool,
    stopped: bool,
}

impl NativeSourceSupervisor {
    /// Opens the exact first-release source manifest. Each source opening has
    /// a five-second deadline. Opening is atomic: if a later source fails,
    /// every already-open source is stopped in reverse order before the error
    /// is returned.
    ///
    /// # Errors
    ///
    /// Returns the bounded failure category and any rollback-cleanup failures
    /// when the complete source set cannot be established.
    pub fn open(
        config: SupervisorConfig,
        factories: BaselineSourceFactories,
    ) -> Result<OpenedSupervisor, SupervisorOpenError> {
        Self::open_with_environment(
            config,
            factories,
            Box::new(SystemSupervisorClock::start()),
            Box::new(NativeProcessFence),
            SOURCE_OPEN_DEADLINE,
        )
    }

    #[cfg(test)]
    fn open_with_clock(
        config: SupervisorConfig,
        factories: BaselineSourceFactories,
        clock: Box<dyn SupervisorClock>,
    ) -> Result<OpenedSupervisor, SupervisorOpenError> {
        Self::open_with_environment(
            config,
            factories,
            clock,
            Box::new(NativeProcessFence),
            SOURCE_OPEN_DEADLINE,
        )
    }

    fn open_with_environment(
        config: SupervisorConfig,
        factories: BaselineSourceFactories,
        clock: Box<dyn SupervisorClock>,
        process_fence: Box<dyn ProcessFence>,
        restart_open_deadline: Duration,
    ) -> Result<OpenedSupervisor, SupervisorOpenError> {
        let parameters = SourceParameters::from(&config);
        let OpenedManifest { sources, snapshots } = open_initial_manifest(&parameters, factories)?;
        let slots = sources
            .into_iter()
            .map(|opened| {
                let kind = opened.source.kind();
                SourceSlot::active(kind, opened.factory, opened.source)
            })
            .collect();

        Ok(OpenedSupervisor {
            supervisor: Self {
                config,
                clock,
                process_fence,
                restart_open_deadline,
                slots,
                process_replacement_required: false,
                stopped: false,
            },
            snapshots,
        })
    }

    /// Drains active sources, starts due restart attempts in detached bounded
    /// workers, and harvests completed attempts without waiting. Returned
    /// transitions are mechanical lifecycle facts; the caller must run
    /// complete policy and admission checks after recovery.
    #[must_use]
    pub fn poll(&mut self) -> SupervisorPoll {
        if self.stopped {
            return SupervisorPoll {
                final_snapshots: Vec::new(),
                state: SupervisorState::Stopped,
                opened_snapshots: Vec::new(),
                batches: Vec::new(),
                transitions: Vec::new(),
            };
        }
        if self.process_replacement_required {
            return SupervisorPoll {
                final_snapshots: Vec::new(),
                state: SupervisorState::Failed,
                opened_snapshots: Vec::new(),
                batches: Vec::new(),
                transitions: Vec::new(),
            };
        }
        let now = self.clock.now();
        let parameters = SourceParameters::from(&self.config);
        let policy = self.config.restart_policy;
        let mut poll = SupervisorPoll {
            final_snapshots: Vec::new(),
            state: SupervisorState::Healthy,
            opened_snapshots: Vec::new(),
            batches: Vec::new(),
            transitions: Vec::new(),
        };
        for slot in &mut self.slots {
            let control = match slot.lifecycle {
                SlotLifecycle::Active => {
                    poll_active_source(slot, now, policy, &mut poll, self.process_fence.as_ref())
                }
                SlotLifecycle::RestartPending { due_at, .. } if due_at <= now => {
                    begin_restart_source(
                        slot,
                        &parameters,
                        self.restart_open_deadline,
                        &mut poll,
                        self.process_fence.as_ref(),
                    )
                }
                SlotLifecycle::RestartOpening { .. } => {
                    poll_restart_source(slot, now, policy, &mut poll, self.process_fence.as_ref())
                }
                SlotLifecycle::RestartPending { .. } | SlotLifecycle::Exhausted => {
                    PollControl::Continue
                }
            };
            if control == PollControl::ReplaceProcess {
                self.process_replacement_required = true;
                break;
            }
        }
        poll.state = supervisor_state(&self.slots);
        poll
    }

    #[must_use]
    pub fn state(&self) -> SupervisorState {
        if self.stopped {
            SupervisorState::Stopped
        } else if self.process_replacement_required {
            SupervisorState::Failed
        } else {
            supervisor_state(&self.slots)
        }
    }

    /// Stops every active source in reverse manifest order. Repeated calls are
    /// safe and return an empty stopped result.
    #[must_use]
    pub fn stop(&mut self) -> SupervisorStop {
        if self.stopped {
            return SupervisorStop {
                final_snapshots: Vec::new(),
                state: SupervisorState::Stopped,
                batches: Vec::new(),
                process_replacement_required: self.process_replacement_required,
            };
        }
        self.stopped = true;
        let mut batches = Vec::new();
        let mut final_snapshots = Vec::new();
        for slot in self.slots.iter_mut().rev() {
            if let Some(mut source) = slot.source.take() {
                let stopped = source.stop();
                self.process_replacement_required |= !stopped.closed_input_boundary;
                batches.extend(stopped.preceding_batches);
                final_snapshots.extend(stopped.final_snapshot);
                batches.push(stopped.batch);
            }
            let lifecycle = std::mem::replace(&mut slot.lifecycle, SlotLifecycle::Exhausted);
            if let SlotLifecycle::RestartOpening {
                deadline,
                completion,
                ..
            } = lifecycle
            {
                let remaining = deadline.saturating_duration_since(Instant::now());
                let received = if remaining.is_zero() {
                    completion.try_recv().map_err(|_error| ())
                } else {
                    completion
                        .recv_timeout(remaining)
                        .map_err(|error| match error {
                            RecvTimeoutError::Timeout | RecvTimeoutError::Disconnected => (),
                        })
                };
                match received {
                    Ok(RestartOpenMessage::Completed(completion)) => match completion.result {
                        Ok((mut source, _snapshot)) => {
                            let stopped = source.stop();
                            self.process_replacement_required |= !stopped.closed_input_boundary;
                            batches.extend(stopped.preceding_batches);
                            final_snapshots.extend(stopped.final_snapshot);
                            batches.push(stopped.batch);
                        }
                        Err(failure) => {
                            self.process_replacement_required |=
                                failure.process_replacement_required;
                        }
                    },
                    Ok(RestartOpenMessage::MissedDeadline) | Err(()) => {
                        self.process_replacement_required = true;
                    }
                }
            }
        }
        if self.process_replacement_required {
            self.process_fence.poison();
        }
        SupervisorStop {
            final_snapshots,
            state: SupervisorState::Stopped,
            batches,
            process_replacement_required: self.process_replacement_required,
        }
    }
}

impl Drop for NativeSourceSupervisor {
    fn drop(&mut self) {
        let _ = self.stop();
    }
}

#[derive(Clone)]
struct SourceParameters {
    collection_session_id: String,
    queue_capacity: u16,
}

impl From<&SupervisorConfig> for SourceParameters {
    fn from(config: &SupervisorConfig) -> Self {
        Self {
            collection_session_id: config.collection_session_id.clone(),
            queue_capacity: config.queue_capacity,
        }
    }
}

impl SourceParameters {
    fn request(&self, requested_schema_version: u16) -> SourceOpenRequest {
        SourceOpenRequest {
            collection_session_id: self.collection_session_id.clone(),
            requested_schema_version,
            queue_capacity: self.queue_capacity,
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
struct RestartBoundary {
    missing_count: u64,
    reason: &'static str,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
struct SourceStartFailure {
    code: SourceFailureCode,
    process_replacement_required: bool,
}

fn source_start_failure(code: SourceFailureCode) -> SourceStartFailure {
    SourceStartFailure {
        code,
        process_replacement_required: ensure_native_source_process_usable().is_err(),
    }
}

trait ErasedFactory: Send {
    fn open(
        &mut self,
        parameters: &SourceParameters,
        restart: Option<RestartBoundary>,
    ) -> Result<Box<dyn ErasedSource>, SourceStartFailure>;
}

trait ErasedSource: Send {
    fn kind(&self) -> NativeSourceKind;
    fn snapshot(&self) -> NativeSourceSnapshot;
    fn health(&self) -> SourceHealth;
    fn drain(&mut self) -> NativeSourceBatch;
    fn stop(&mut self) -> SourceStopOutcome;
}

struct SourceStopOutcome {
    preceding_batches: Vec<NativeSourceBatch>,
    final_snapshot: Option<NativeSourceSnapshot>,
    batch: NativeSourceBatch,
    closed_input_boundary: bool,
}

impl<F, B> ErasedFactory for DisplayTopologyFactory<F, B>
where
    F: FnMut() -> Result<B, DisplayTopologyError> + Send,
    B: DisplayTopologyBackend + Send + 'static,
    B::Subscription: Send + 'static,
{
    fn open(
        &mut self,
        parameters: &SourceParameters,
        restart: Option<RestartBoundary>,
    ) -> Result<Box<dyn ErasedSource>, SourceStartFailure> {
        let backend =
            (self.make_backend)().map_err(|error| source_start_failure(error.failure_code()))?;
        let request = parameters.request(DISPLAY_TOPOLOGY_SCHEMA_VERSION);
        let source = match restart {
            Some(boundary) => DisplayTopologySource::open_after_reset(
                &request,
                backend,
                boundary.missing_count,
                boundary.reason.to_owned(),
            ),
            None => DisplayTopologySource::open(&request, backend),
        }
        .map_err(|error| source_start_failure(error.failure_code()))?;
        Ok(Box::new(DisplaySource(source)))
    }
}

impl<F, B> ErasedFactory for CandidateWindowFactory<F, B>
where
    F: FnMut() -> Result<B, CandidateWindowError> + Send,
    B: CandidateWindowBackend + Send + 'static,
    B::Subscription: Send + 'static,
{
    fn open(
        &mut self,
        parameters: &SourceParameters,
        restart: Option<RestartBoundary>,
    ) -> Result<Box<dyn ErasedSource>, SourceStartFailure> {
        let backend =
            (self.make_backend)().map_err(|error| source_start_failure(error.failure_code()))?;
        let request = parameters.request(CANDIDATE_WINDOW_SCHEMA_VERSION);
        let source = match restart {
            Some(boundary) => CandidateWindowSource::open_after_reset(
                &request,
                backend,
                boundary.missing_count,
                boundary.reason.to_owned(),
            ),
            None => CandidateWindowSource::open(&request, backend),
        }
        .map_err(|error| source_start_failure(error.failure_code()))?;
        Ok(Box::new(WindowSource(source)))
    }
}

impl<F, B> ErasedFactory for CaptureSessionFactory<F, B>
where
    F: FnMut() -> Result<B, CaptureSessionError> + Send,
    B: CaptureSessionBackend + Send + 'static,
    B::Subscription: Send + 'static,
{
    fn open(
        &mut self,
        parameters: &SourceParameters,
        restart: Option<RestartBoundary>,
    ) -> Result<Box<dyn ErasedSource>, SourceStartFailure> {
        let backend =
            (self.make_backend)().map_err(|error| source_start_failure(error.failure_code()))?;
        let request = parameters.request(CAPTURE_SESSION_SCHEMA_VERSION);
        let source = match restart {
            Some(boundary) => CaptureSessionSource::open_after_reset(
                &request,
                backend,
                boundary.missing_count,
                boundary.reason.to_owned(),
            ),
            None => CaptureSessionSource::open(&request, backend),
        }
        .map_err(|error| source_start_failure(error.failure_code()))?;
        Ok(Box::new(SessionSource(source)))
    }
}

impl<F, B> ErasedFactory for ProcessApplicationFactory<F, B>
where
    F: FnMut() -> Result<B, ProcessApplicationError> + Send,
    B: ProcessApplicationBackend + Send + 'static,
    B::Subscription: Send + 'static,
{
    fn open(
        &mut self,
        parameters: &SourceParameters,
        restart: Option<RestartBoundary>,
    ) -> Result<Box<dyn ErasedSource>, SourceStartFailure> {
        let backend =
            (self.make_backend)().map_err(|error| source_start_failure(error.failure_code()))?;
        let request = parameters.request(PROCESS_APPLICATION_SCHEMA_VERSION);
        let source = match restart {
            Some(boundary) => ProcessApplicationSource::open_after_reset(
                &request,
                backend,
                boundary.missing_count,
                boundary.reason.to_owned(),
            ),
            None => ProcessApplicationSource::open(&request, backend),
        }
        .map_err(|error| source_start_failure(error.failure_code()))?;
        Ok(Box::new(ProcessSource(source)))
    }
}

impl<W, F, B> ErasedFactory for PassiveStateFactory<W, F, B>
where
    W: SupervisedPassiveStateWire,
    F: FnMut() -> Result<B, PassiveStateSourceError> + Send,
    B: PassiveStateBackend<W> + Send + 'static,
    B::Subscription: Send + 'static,
{
    fn open(
        &mut self,
        parameters: &SourceParameters,
        restart: Option<RestartBoundary>,
    ) -> Result<Box<dyn ErasedSource>, SourceStartFailure> {
        let backend =
            (self.make_backend)().map_err(|error| source_start_failure(error.failure_code()))?;
        let request = parameters.request(W::SCHEMA_VERSION);
        let source = match restart {
            Some(boundary) => PassiveStateSource::<W, B::Subscription>::open_after_reset(
                &request,
                backend,
                boundary.missing_count,
                boundary.reason.to_owned(),
            ),
            None => PassiveStateSource::<W, B::Subscription>::open(&request, backend),
        }
        .map_err(|error| source_start_failure(error.failure_code()))?;
        Ok(Box::new(PassiveSource(source)))
    }
}

struct DisplaySource<S: DisplayTopologySubscription>(DisplayTopologySource<S>);

impl<S: DisplayTopologySubscription + Send> ErasedSource for DisplaySource<S> {
    fn kind(&self) -> NativeSourceKind {
        NativeSourceKind::DisplayTopology
    }

    fn snapshot(&self) -> NativeSourceSnapshot {
        NativeSourceSnapshot::DisplayTopology(self.0.snapshot().clone())
    }

    fn health(&self) -> SourceHealth {
        self.0.health()
    }

    fn drain(&mut self) -> NativeSourceBatch {
        NativeSourceBatch::DisplayTopology(self.0.drain())
    }

    fn stop(&mut self) -> SourceStopOutcome {
        SourceStopOutcome {
            preceding_batches: Vec::new(),
            final_snapshot: None,
            batch: NativeSourceBatch::DisplayTopology(self.0.stop()),
            closed_input_boundary: ensure_native_source_process_usable().is_ok(),
        }
    }
}

struct WindowSource<S: CandidateWindowSubscription>(CandidateWindowSource<S>);

impl<S: CandidateWindowSubscription + Send> ErasedSource for WindowSource<S> {
    fn kind(&self) -> NativeSourceKind {
        NativeSourceKind::CandidateWindow
    }

    fn snapshot(&self) -> NativeSourceSnapshot {
        NativeSourceSnapshot::CandidateWindow(self.0.snapshot().clone())
    }

    fn health(&self) -> SourceHealth {
        self.0.health()
    }

    fn drain(&mut self) -> NativeSourceBatch {
        NativeSourceBatch::CandidateWindow(self.0.drain())
    }

    fn stop(&mut self) -> SourceStopOutcome {
        SourceStopOutcome {
            preceding_batches: Vec::new(),
            final_snapshot: None,
            batch: NativeSourceBatch::CandidateWindow(self.0.stop()),
            closed_input_boundary: ensure_native_source_process_usable().is_ok(),
        }
    }
}

struct SessionSource<S: CaptureSessionSubscription>(CaptureSessionSource<S>);

impl<S: CaptureSessionSubscription + Send> ErasedSource for SessionSource<S> {
    fn kind(&self) -> NativeSourceKind {
        NativeSourceKind::CaptureSession
    }

    fn snapshot(&self) -> NativeSourceSnapshot {
        NativeSourceSnapshot::CaptureSession(self.0.snapshot().clone())
    }

    fn health(&self) -> SourceHealth {
        self.0.health()
    }

    fn drain(&mut self) -> NativeSourceBatch {
        NativeSourceBatch::CaptureSession(self.0.drain())
    }

    fn stop(&mut self) -> SourceStopOutcome {
        SourceStopOutcome {
            preceding_batches: Vec::new(),
            final_snapshot: None,
            batch: NativeSourceBatch::CaptureSession(self.0.stop()),
            closed_input_boundary: ensure_native_source_process_usable().is_ok(),
        }
    }
}

struct ProcessSource<S: ProcessApplicationSubscription>(ProcessApplicationSource<S>);

impl<S: ProcessApplicationSubscription + Send> ErasedSource for ProcessSource<S> {
    fn kind(&self) -> NativeSourceKind {
        NativeSourceKind::ProcessApplication
    }

    fn snapshot(&self) -> NativeSourceSnapshot {
        NativeSourceSnapshot::ProcessApplication(self.0.snapshot().clone())
    }

    fn health(&self) -> SourceHealth {
        self.0.health()
    }

    fn drain(&mut self) -> NativeSourceBatch {
        NativeSourceBatch::ProcessApplication(self.0.drain())
    }

    fn stop(&mut self) -> SourceStopOutcome {
        SourceStopOutcome {
            preceding_batches: Vec::new(),
            final_snapshot: None,
            batch: NativeSourceBatch::ProcessApplication(self.0.stop()),
            closed_input_boundary: ensure_native_source_process_usable().is_ok(),
        }
    }
}

struct PassiveSource<W, S>(PassiveStateSource<W, S>)
where
    W: SupervisedPassiveStateWire,
    S: PassiveStateSubscription<W>;

impl<W, S> ErasedSource for PassiveSource<W, S>
where
    W: SupervisedPassiveStateWire,
    S: PassiveStateSubscription<W> + Send,
{
    fn kind(&self) -> NativeSourceKind {
        W::KIND
    }

    fn snapshot(&self) -> NativeSourceSnapshot {
        W::wrap_snapshot(self.0.snapshot().clone())
    }

    fn health(&self) -> SourceHealth {
        self.0.health()
    }

    fn drain(&mut self) -> NativeSourceBatch {
        W::wrap_batch(self.0.drain())
    }

    fn stop(&mut self) -> SourceStopOutcome {
        SourceStopOutcome {
            preceding_batches: Vec::new(),
            final_snapshot: None,
            batch: W::wrap_batch(self.0.stop()),
            closed_input_boundary: ensure_native_source_process_usable().is_ok(),
        }
    }
}

struct SourceSlot {
    kind: NativeSourceKind,
    factory: Option<Box<dyn ErasedFactory>>,
    source: Option<Box<dyn ErasedSource>>,
    lifecycle: SlotLifecycle,
    restart_attempts: u8,
}

impl SourceSlot {
    fn active(
        kind: NativeSourceKind,
        factory: Box<dyn ErasedFactory>,
        source: Box<dyn ErasedSource>,
    ) -> Self {
        Self {
            kind,
            factory: Some(factory),
            source: Some(source),
            lifecycle: SlotLifecycle::Active,
            restart_attempts: 0,
        }
    }
}

enum SlotLifecycle {
    Active,
    RestartPending {
        due_at: Duration,
        previous_source_instance_id: String,
    },
    RestartOpening {
        previous_source_instance_id: String,
        attempt: u8,
        deadline: Instant,
        completion: Receiver<RestartOpenMessage>,
    },
    Exhausted,
}

struct RestartOpenCompletion {
    factory: Box<dyn ErasedFactory>,
    result: Result<(Box<dyn ErasedSource>, NativeSourceSnapshot), RestartOpenFailure>,
}

enum RestartOpenMessage {
    Completed(RestartOpenCompletion),
    MissedDeadline,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
struct RestartOpenFailure {
    code: SourceFailureCode,
    process_replacement_required: bool,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum PollControl {
    Continue,
    ReplaceProcess,
}

trait ProcessFence: Send {
    fn poison(&self);
}

struct NativeProcessFence;

impl ProcessFence for NativeProcessFence {
    fn poison(&self) {
        poison_native_source_process();
    }
}

struct OpenedErasedSource {
    factory: Box<dyn ErasedFactory>,
    source: Box<dyn ErasedSource>,
    snapshot: NativeSourceSnapshot,
}

struct OpenedManifest {
    sources: Vec<OpenedErasedSource>,
    snapshots: BaselineSourceSnapshots,
}

fn open_initial_manifest(
    parameters: &SourceParameters,
    factories: BaselineSourceFactories,
) -> Result<OpenedManifest, SupervisorOpenError> {
    let manifest_order = factories.into_manifest_order();
    let manifest_kinds: Vec<_> = manifest_order
        .iter()
        .map(|(kind, _factory)| *kind)
        .collect();
    let expected_kinds: Vec<_> = NATIVE_SOURCE_KINDS
        .into_iter()
        .filter(|kind| manifest_kinds.contains(kind))
        .collect();
    let manifest_is_exact = !manifest_order.is_empty() && manifest_kinds == expected_kinds;
    if !manifest_is_exact {
        return Err(SupervisorOpenError {
            source: NativeSourceKind::DisplayTopology,
            failure: SourceFailureCode::Protocol,
            cleanup_failures: Vec::new(),
            process_replacement_required: false,
        });
    }

    let mut opened = Vec::with_capacity(NATIVE_SOURCE_COUNT);
    for (kind, factory) in manifest_order {
        match open_initial_source(kind, parameters, factory) {
            Ok(source) => opened.push(source),
            Err(failure) => {
                let cleanup_failures = cleanup_opened_sources(&mut opened);
                return Err(SupervisorOpenError {
                    source: kind,
                    failure: failure.code,
                    process_replacement_required: failure.process_replacement_required
                        || !cleanup_failures.is_empty(),
                    cleanup_failures,
                });
            }
        }
    }
    let snapshots = BaselineSourceSnapshots {
        sources: opened
            .iter()
            .map(|source| source.snapshot.clone())
            .collect(),
    };
    Ok(OpenedManifest {
        sources: opened,
        snapshots,
    })
}

fn open_initial_source(
    expected_kind: NativeSourceKind,
    parameters: &SourceParameters,
    factory: Box<dyn ErasedFactory>,
) -> Result<OpenedErasedSource, SourceStartFailure> {
    let (factory, opened) =
        match bounded_factory_open(expected_kind, factory, parameters.clone(), None) {
            FactoryOpenOutcome::Completed { factory, result } => (factory, result),
            FactoryOpenOutcome::LifecycleFailure(_failure) => {
                return Err(SourceStartFailure {
                    code: SourceFailureCode::Cleanup,
                    process_replacement_required: true,
                });
            }
        };
    let (source, snapshot) = validate_opened_source(
        expected_kind,
        opened?,
        None,
        ensure_native_source_process_usable().is_ok(),
    )?;
    Ok(OpenedErasedSource {
        factory,
        source,
        snapshot,
    })
}

fn validate_opened_source(
    expected_kind: NativeSourceKind,
    mut source: Box<dyn ErasedSource>,
    previous_source_instance_id: Option<&str>,
    process_usable: bool,
) -> Result<(Box<dyn ErasedSource>, NativeSourceSnapshot), SourceStartFailure> {
    if !process_usable {
        let _cleanup = source.stop();
        return Err(SourceStartFailure {
            code: SourceFailureCode::Cleanup,
            process_replacement_required: true,
        });
    }
    let snapshot = source.snapshot();
    if source.kind() != expected_kind
        || snapshot.kind() != expected_kind
        || previous_source_instance_id
            .is_some_and(|previous| snapshot.source_instance_id() == previous)
        || matches!(
            snapshot.health(),
            SourceHealth::Starting | SourceHealth::Failed | SourceHealth::Stopped
        )
        || matches!(
            source.health(),
            SourceHealth::Starting | SourceHealth::Failed | SourceHealth::Stopped
        )
    {
        let cleanup = source.stop();
        return Err(SourceStartFailure {
            code: cleanup
                .batch
                .terminal_error()
                .unwrap_or(SourceFailureCode::Protocol),
            process_replacement_required: !cleanup.closed_input_boundary,
        });
    }
    Ok((source, snapshot))
}

enum FactoryOpenOutcome {
    Completed {
        factory: Box<dyn ErasedFactory>,
        result: Result<Box<dyn ErasedSource>, SourceStartFailure>,
    },
    LifecycleFailure(BoundedTaskError),
}

fn bounded_factory_open(
    kind: NativeSourceKind,
    factory: Box<dyn ErasedFactory>,
    parameters: SourceParameters,
    restart: Option<RestartBoundary>,
) -> FactoryOpenOutcome {
    bounded_factory_open_with(
        kind,
        factory,
        parameters,
        restart,
        SOURCE_OPEN_DEADLINE,
        &poison_native_source_process,
    )
}

fn bounded_factory_open_with<P>(
    kind: NativeSourceKind,
    factory: Box<dyn ErasedFactory>,
    parameters: SourceParameters,
    restart: Option<RestartBoundary>,
    deadline: Duration,
    poison: &P,
) -> FactoryOpenOutcome
where
    P: Fn(),
{
    match run_bounded_task(source_open_thread_name(kind), deadline, move || {
        let mut factory = factory;
        let result = factory.open(&parameters, restart);
        (factory, result)
    }) {
        Ok((factory, result)) => FactoryOpenOutcome::Completed { factory, result },
        Err(error) => {
            poison();
            FactoryOpenOutcome::LifecycleFailure(error)
        }
    }
}

fn source_open_thread_name(kind: NativeSourceKind) -> &'static str {
    match kind {
        NativeSourceKind::DisplayTopology => "prctr-open-display-source",
        NativeSourceKind::CandidateWindow => "prctr-open-window-source",
        NativeSourceKind::CaptureSession => "prctr-open-session-source",
        NativeSourceKind::ProcessApplication => "prctr-open-process-source",
        NativeSourceKind::InteractiveSession => "prctr-open-interactive-session-source",
        NativeSourceKind::Clipboard => "prctr-open-clipboard-source",
        NativeSourceKind::PrintSpooler => "prctr-open-print-spooler-source",
        NativeSourceKind::RemovableStorage => "prctr-open-removable-storage-source",
        NativeSourceKind::Virtualization => "prctr-open-virtualization-source",
        NativeSourceKind::NetworkConfiguration => "prctr-open-network-source",
        NativeSourceKind::MediaDevice => "prctr-open-media-device-source",
    }
}

fn cleanup_opened_sources(sources: &mut [OpenedErasedSource]) -> Vec<NativeSourceKind> {
    sources
        .iter_mut()
        .rev()
        .filter_map(|opened| {
            let kind = opened.source.kind();
            let outcome = opened.source.stop();
            (!outcome.closed_input_boundary || outcome.batch.health() == SourceHealth::Failed)
                .then_some(kind)
        })
        .collect()
}

fn poll_active_source(
    slot: &mut SourceSlot,
    now: Duration,
    policy: RestartPolicy,
    poll: &mut SupervisorPoll,
    process_fence: &dyn ProcessFence,
) -> PollControl {
    let Some(source) = slot.source.as_mut() else {
        slot.lifecycle = SlotLifecycle::Exhausted;
        return PollControl::Continue;
    };
    let batch = source.drain();
    let failed = batch.health() == SourceHealth::Failed;
    let failure = batch.terminal_error().unwrap_or(SourceFailureCode::Backend);
    let previous_source_instance_id = batch.source_instance_id().to_owned();
    poll.batches.push(batch);
    if !failed {
        return PollControl::Continue;
    }
    let final_batch = source.stop();
    let failure = final_batch.batch.terminal_error().unwrap_or(failure);
    poll.batches.extend(final_batch.preceding_batches);
    poll.final_snapshots.extend(final_batch.final_snapshot);
    poll.batches.push(final_batch.batch);
    slot.source = None;
    if !final_batch.closed_input_boundary {
        process_fence.poison();
        slot.lifecycle = SlotLifecycle::Exhausted;
        poll.transitions
            .push(SourceLifecycleTransition::ProcessReplacementRequired {
                source: slot.kind,
                failure: SourceFailureCode::Cleanup,
            });
        return PollControl::ReplaceProcess;
    }
    if slot.restart_attempts >= policy.maximum_attempts {
        slot.lifecycle = SlotLifecycle::Exhausted;
        poll.transitions
            .push(SourceLifecycleTransition::RestartExhausted {
                source: slot.kind,
                attempts: slot.restart_attempts,
                failure,
            });
        return PollControl::Continue;
    }
    let retry_after = restart_backoff(policy, slot.restart_attempts);
    slot.lifecycle = SlotLifecycle::RestartPending {
        due_at: now.saturating_add(retry_after),
        previous_source_instance_id: previous_source_instance_id.clone(),
    };
    poll.transitions
        .push(SourceLifecycleTransition::RestartScheduled {
            source: slot.kind,
            previous_source_instance_id,
            next_attempt: slot.restart_attempts.saturating_add(1),
            retry_after,
            failure,
        });
    PollControl::Continue
}

fn begin_restart_source(
    slot: &mut SourceSlot,
    parameters: &SourceParameters,
    open_deadline: Duration,
    poll: &mut SupervisorPoll,
    process_fence: &dyn ProcessFence,
) -> PollControl {
    let SlotLifecycle::RestartPending {
        previous_source_instance_id,
        ..
    } = &slot.lifecycle
    else {
        return PollControl::Continue;
    };
    let previous_source_instance_id = previous_source_instance_id.clone();
    let attempt = slot.restart_attempts.saturating_add(1);
    let restart = RestartBoundary {
        missing_count: RESTART_BOUNDARY_MISSING_COUNT,
        reason: RESTART_REASON,
    };
    let Some(factory) = slot.factory.take() else {
        slot.lifecycle = SlotLifecycle::Exhausted;
        poll.transitions
            .push(SourceLifecycleTransition::RestartExhausted {
                source: slot.kind,
                attempts: slot.restart_attempts,
                failure: SourceFailureCode::Cleanup,
            });
        return PollControl::Continue;
    };
    slot.restart_attempts = attempt;
    let (sender, completion) = mpsc::sync_channel(1);
    let deadline = Instant::now() + open_deadline;
    let kind = slot.kind;
    let thread_parameters = parameters.clone();
    let thread_previous_source_instance_id = previous_source_instance_id.clone();
    let spawn = thread::Builder::new()
        .name(source_open_thread_name(kind).to_owned())
        .spawn(move || {
            let completion = complete_restart_open(
                kind,
                factory,
                &thread_parameters,
                restart,
                &thread_previous_source_instance_id,
            );
            let message = if Instant::now() < deadline {
                RestartOpenMessage::Completed(completion)
            } else {
                drop(completion);
                RestartOpenMessage::MissedDeadline
            };
            let _ = sender.send(message);
        });
    match spawn {
        Ok(handle) => {
            drop(handle);
            slot.lifecycle = SlotLifecycle::RestartOpening {
                previous_source_instance_id,
                attempt,
                deadline,
                completion,
            };
            PollControl::Continue
        }
        Err(_error) => {
            process_fence.poison();
            slot.lifecycle = SlotLifecycle::Exhausted;
            poll.transitions
                .push(SourceLifecycleTransition::ProcessReplacementRequired {
                    source: slot.kind,
                    failure: SourceFailureCode::Cleanup,
                });
            PollControl::ReplaceProcess
        }
    }
}

fn complete_restart_open(
    kind: NativeSourceKind,
    mut factory: Box<dyn ErasedFactory>,
    parameters: &SourceParameters,
    restart: RestartBoundary,
    previous_source_instance_id: &str,
) -> RestartOpenCompletion {
    let result = factory
        .open(parameters, Some(restart))
        .and_then(|source| {
            validate_opened_source(
                kind,
                source,
                Some(previous_source_instance_id),
                ensure_native_source_process_usable().is_ok(),
            )
        })
        .map_err(|failure| RestartOpenFailure {
            code: failure.code,
            process_replacement_required: failure.process_replacement_required,
        });
    RestartOpenCompletion { factory, result }
}

fn poll_restart_source(
    slot: &mut SourceSlot,
    now: Duration,
    policy: RestartPolicy,
    poll: &mut SupervisorPoll,
    process_fence: &dyn ProcessFence,
) -> PollControl {
    let SlotLifecycle::RestartOpening {
        previous_source_instance_id,
        attempt,
        deadline,
        completion,
    } = &slot.lifecycle
    else {
        return PollControl::Continue;
    };
    let previous_source_instance_id = previous_source_instance_id.clone();
    let attempt = *attempt;
    let deadline = *deadline;
    let received = match completion.try_recv() {
        Ok(message) => Ok(message),
        Err(TryRecvError::Disconnected) => Err(()),
        Err(TryRecvError::Empty) if Instant::now() < deadline => {
            return PollControl::Continue;
        }
        Err(TryRecvError::Empty) => match completion.try_recv() {
            Ok(message) => Ok(message),
            Err(TryRecvError::Empty | TryRecvError::Disconnected) => Err(()),
        },
    };
    let completion = match received {
        Ok(RestartOpenMessage::Completed(completion)) => completion,
        Ok(RestartOpenMessage::MissedDeadline) | Err(()) => {
            process_fence.poison();
            slot.lifecycle = SlotLifecycle::Exhausted;
            poll.transitions
                .push(SourceLifecycleTransition::ProcessReplacementRequired {
                    source: slot.kind,
                    failure: SourceFailureCode::Cleanup,
                });
            return PollControl::ReplaceProcess;
        }
    };
    slot.factory = Some(completion.factory);
    match completion.result {
        Ok((source, snapshot)) => {
            let new_source_instance_id = snapshot.source_instance_id().to_owned();
            slot.source = Some(source);
            slot.lifecycle = SlotLifecycle::Active;
            poll.opened_snapshots.push(snapshot);
            poll.transitions.push(SourceLifecycleTransition::Restarted {
                source: slot.kind,
                previous_source_instance_id,
                new_source_instance_id,
                attempt,
            });
        }
        Err(failure) if failure.process_replacement_required => {
            process_fence.poison();
            slot.lifecycle = SlotLifecycle::Exhausted;
            poll.transitions
                .push(SourceLifecycleTransition::ProcessReplacementRequired {
                    source: slot.kind,
                    failure: failure.code,
                });
            return PollControl::ReplaceProcess;
        }
        Err(failure) if attempt >= policy.maximum_attempts => {
            slot.lifecycle = SlotLifecycle::Exhausted;
            poll.transitions
                .push(SourceLifecycleTransition::RestartExhausted {
                    source: slot.kind,
                    attempts: attempt,
                    failure: failure.code,
                });
        }
        Err(failure) => {
            let retry_after = restart_backoff(policy, attempt);
            slot.lifecycle = SlotLifecycle::RestartPending {
                due_at: now.saturating_add(retry_after),
                previous_source_instance_id,
            };
            poll.transitions
                .push(SourceLifecycleTransition::RestartAttemptFailed {
                    source: slot.kind,
                    attempt,
                    retry_after,
                    failure: failure.code,
                });
        }
    }
    PollControl::Continue
}

fn supervisor_state(slots: &[SourceSlot]) -> SupervisorState {
    if slots
        .iter()
        .any(|slot| matches!(slot.lifecycle, SlotLifecycle::Exhausted))
    {
        return SupervisorState::Failed;
    }
    if slots.iter().any(|slot| {
        matches!(
            slot.lifecycle,
            SlotLifecycle::RestartPending { .. } | SlotLifecycle::RestartOpening { .. }
        )
    }) {
        return SupervisorState::Recovering;
    }
    if slots.iter().any(|slot| {
        slot.source.as_ref().is_none_or(|source| {
            matches!(
                source.health(),
                SourceHealth::Failed | SourceHealth::Stopped
            )
        })
    }) {
        return SupervisorState::Failed;
    }
    if slots.iter().any(|slot| {
        slot.source
            .as_ref()
            .is_none_or(|source| source.health() != SourceHealth::Healthy)
    }) {
        SupervisorState::Degraded
    } else {
        SupervisorState::Healthy
    }
}

fn restart_backoff(policy: RestartPolicy, attempts_made: u8) -> Duration {
    let multiplier = 1_u32
        .checked_shl(u32::from(attempts_made))
        .unwrap_or(u32::MAX);
    policy
        .initial_backoff
        .saturating_mul(multiplier)
        .min(policy.maximum_backoff)
}

trait SupervisorClock {
    fn now(&self) -> Duration;
}

struct SystemSupervisorClock {
    started_at: Instant,
}

impl SystemSupervisorClock {
    fn start() -> Self {
        Self {
            started_at: Instant::now(),
        }
    }
}

impl SupervisorClock for SystemSupervisorClock {
    fn now(&self) -> Duration {
        self.started_at.elapsed()
    }
}

fn failure_code_name(code: SourceFailureCode) -> &'static str {
    match code {
        SourceFailureCode::Backend => "backend",
        SourceFailureCode::Cleanup => "cleanup",
        SourceFailureCode::InventoryOverflow => "inventory-overflow",
        SourceFailureCode::Protocol => "protocol",
        SourceFailureCode::Queue => "queue",
        SourceFailureCode::QueueOverflow => "queue-overflow",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    use std::cell::Cell;
    use std::collections::VecDeque;
    use std::rc::Rc;
    use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
    use std::sync::mpsc::{self, Receiver, SyncSender};
    use std::sync::{Arc, Mutex};

    use candidate_window_state::{CandidateWindowEmitter, OpenedCandidateWindowBackend};
    use capture_session_state::{CaptureSessionEmitter, OpenedCaptureSessionBackend};
    use display_topology::{
        DisplayTopologyEmitter, OpenedDisplayTopologyBackend, OpenedSourceHealth,
    };
    use native_protocol::{
        CandidateWindowBounds, CandidateWindowCertainty, CandidateWindowFocus,
        CandidateWindowPlacement, CandidateWindowPresence, CandidateWindowState,
        CandidateWindowVisibility, CaptureSessionActivity, CaptureSessionCertainty,
        CaptureSessionSignal, CaptureSessionState, CaptureSessionSupport, DisplayTopologySnapshot,
        PlatformFamily, ProcessApplicationCertainty, ProcessApplicationCoverage,
        ProcessApplicationState, SequenceGap, SourceReset, SourceTimestamp, TopologyCertainty,
    };
    use native_source_runtime::{SourceSessionMetadata, UnavailablePassiveStateBackend};
    use process_application_state::{OpenedProcessApplicationBackend, ProcessApplicationEmitter};

    struct TestDisplayBackend;
    struct TestDisplaySubscription;

    impl DisplayTopologyBackend for TestDisplayBackend {
        type Subscription = TestDisplaySubscription;

        fn open(
            self,
            _emitter: DisplayTopologyEmitter,
        ) -> Result<OpenedDisplayTopologyBackend<Self::Subscription>, DisplayTopologyError>
        {
            Ok(OpenedDisplayTopologyBackend {
                platform: PlatformFamily::Linux,
                permission: PermissionState::Granted,
                health: OpenedSourceHealth::Healthy,
                adapter_version: "test-display-v1",
                initial_topology: display_state(),
                subscription: TestDisplaySubscription,
            })
        }
    }

    impl DisplayTopologySubscription for TestDisplaySubscription {
        fn stop(&mut self) -> Result<DisplayTopologySnapshot, DisplayTopologyError> {
            Ok(display_state())
        }
    }

    struct TestWindowBackend;
    struct TestWindowSubscription;

    impl CandidateWindowBackend for TestWindowBackend {
        type Subscription = TestWindowSubscription;

        fn open(
            self,
            _emitter: CandidateWindowEmitter,
        ) -> Result<OpenedCandidateWindowBackend<Self::Subscription>, CandidateWindowError>
        {
            Ok(OpenedCandidateWindowBackend {
                platform: PlatformFamily::Linux,
                permission: PermissionState::Granted,
                adapter_version: "test-window-v1",
                initial_window: window_state(),
                subscription: TestWindowSubscription,
            })
        }
    }

    impl CandidateWindowSubscription for TestWindowSubscription {
        fn stop(self) -> Result<CandidateWindowState, CandidateWindowError> {
            Ok(window_state())
        }
    }

    struct TestSessionBackend;
    struct TestSessionSubscription;

    impl CaptureSessionBackend for TestSessionBackend {
        type Subscription = TestSessionSubscription;

        fn open(
            self,
            _emitter: CaptureSessionEmitter,
        ) -> Result<OpenedCaptureSessionBackend<Self::Subscription>, CaptureSessionError> {
            Ok(OpenedCaptureSessionBackend {
                platform: PlatformFamily::Linux,
                permission: PermissionState::Unavailable,
                adapter_version: "test-session-v1",
                initial_state: capture_state(),
                subscription: TestSessionSubscription,
            })
        }
    }

    impl CaptureSessionSubscription for TestSessionSubscription {
        fn stop(self) -> Result<CaptureSessionState, CaptureSessionError> {
            Ok(capture_state())
        }
    }

    struct TestProcessBackend;
    struct TestProcessSubscription;

    impl ProcessApplicationBackend for TestProcessBackend {
        type Subscription = TestProcessSubscription;

        fn open(
            self,
            _emitter: ProcessApplicationEmitter,
        ) -> Result<OpenedProcessApplicationBackend<Self::Subscription>, ProcessApplicationError>
        {
            Ok(OpenedProcessApplicationBackend {
                platform: PlatformFamily::Linux,
                permission: PermissionState::Unavailable,
                adapter_version: "test-process-v1",
                initial_state: process_state(),
                subscription: TestProcessSubscription,
            })
        }
    }

    impl ProcessApplicationSubscription for TestProcessSubscription {
        fn stop(self) -> Result<ProcessApplicationState, ProcessApplicationError> {
            Ok(process_state())
        }
    }

    #[test]
    fn public_factories_open_the_fixed_baseline_and_stop_in_reverse_order() {
        let factories = BaselineSourceFactories::new(
            display_topology_factory(|| Ok(TestDisplayBackend)),
            candidate_window_factory(|| Ok(TestWindowBackend)),
            capture_session_factory(|| Ok(TestSessionBackend)),
            process_application_factory(|| Ok(TestProcessBackend)),
        )
        .with_passive_source(passive_state_factory::<InteractiveSessionWire, _, _>(
            || {
                Ok(UnavailablePassiveStateBackend::new(
                    PlatformFamily::Linux,
                    "test-interactive-v1",
                ))
            },
        ))
        .with_passive_source(passive_state_factory::<ClipboardWire, _, _>(|| {
            Ok(UnavailablePassiveStateBackend::new(
                PlatformFamily::Linux,
                "test-clipboard-v1",
            ))
        }))
        .with_passive_source(passive_state_factory::<PrintSpoolerWire, _, _>(|| {
            Ok(UnavailablePassiveStateBackend::new(
                PlatformFamily::Linux,
                "test-print-v1",
            ))
        }))
        .with_passive_source(passive_state_factory::<RemovableStorageWire, _, _>(|| {
            Ok(UnavailablePassiveStateBackend::new(
                PlatformFamily::Linux,
                "test-storage-v1",
            ))
        }))
        .with_passive_source(passive_state_factory::<VirtualizationWire, _, _>(|| {
            Ok(UnavailablePassiveStateBackend::new(
                PlatformFamily::Linux,
                "test-virtual-v1",
            ))
        }))
        .with_passive_source(passive_state_factory::<NetworkConfigurationWire, _, _>(
            || {
                Ok(UnavailablePassiveStateBackend::new(
                    PlatformFamily::Linux,
                    "test-network-v1",
                ))
            },
        ))
        .with_passive_source(passive_state_factory::<MediaDeviceWire, _, _>(|| {
            Ok(UnavailablePassiveStateBackend::new(
                PlatformFamily::Linux,
                "test-media-v1",
            ))
        }));
        let opened = NativeSourceSupervisor::open(config(), factories).expect("baseline opens");

        assert_eq!(opened.snapshots.sources.len(), NATIVE_SOURCE_COUNT);
        assert!(opened.snapshots.sources.iter().all(|snapshot| {
            matches!(
                snapshot.permission(),
                PermissionState::Granted | PermissionState::Unavailable
            )
        }));
        assert_eq!(opened.supervisor.state(), SupervisorState::Degraded);

        let mut supervisor = opened.supervisor;
        let stopped = supervisor.stop();
        assert_eq!(stopped.state, SupervisorState::Stopped);
        assert!(!stopped.process_replacement_required);
        assert_eq!(
            stopped
                .batches
                .iter()
                .map(NativeSourceBatch::kind)
                .collect::<Vec<_>>(),
            vec![
                NativeSourceKind::MediaDevice,
                NativeSourceKind::NetworkConfiguration,
                NativeSourceKind::Virtualization,
                NativeSourceKind::RemovableStorage,
                NativeSourceKind::PrintSpooler,
                NativeSourceKind::Clipboard,
                NativeSourceKind::InteractiveSession,
                NativeSourceKind::ProcessApplication,
                NativeSourceKind::CaptureSession,
                NativeSourceKind::CandidateWindow,
                NativeSourceKind::DisplayTopology,
            ]
        );
        assert!(
            stopped
                .batches
                .iter()
                .all(|batch| batch.health() == SourceHealth::Stopped)
        );
        assert!(supervisor.stop().batches.is_empty());
    }

    #[test]
    fn explicit_source_selection_does_not_open_disabled_factories() {
        let display = fake_factory(
            NativeSourceKind::DisplayTopology,
            vec![FactoryStep::open(fake_source(
                display_snapshot("display-instance-0001", SourceHealth::Healthy),
                Vec::new(),
                empty_batch(
                    NativeSourceKind::DisplayTopology,
                    "display-instance-0001",
                    SourceHealth::Stopped,
                    None,
                ),
                Arc::new(AtomicU32::new(0)),
            ))],
        );
        let factories = healthy_fake_baseline(display)
            .select_sources(&[
                NativeSourceKind::DisplayTopology,
                NativeSourceKind::Clipboard,
            ])
            .expect("selection is valid");
        let opened = NativeSourceSupervisor::open(config(), factories).expect("selection opens");

        assert_eq!(
            opened
                .snapshots
                .sources
                .iter()
                .map(NativeSourceSnapshot::kind)
                .collect::<Vec<_>>(),
            vec![
                NativeSourceKind::DisplayTopology,
                NativeSourceKind::Clipboard,
            ]
        );
        let mut supervisor = opened.supervisor;
        assert_eq!(
            supervisor
                .stop()
                .batches
                .iter()
                .map(NativeSourceBatch::kind)
                .collect::<Vec<_>>(),
            vec![
                NativeSourceKind::Clipboard,
                NativeSourceKind::DisplayTopology,
            ]
        );
    }

    #[test]
    fn configuration_rejects_unbounded_requests_and_restart_policies() {
        assert_eq!(
            RestartPolicy::new(0, Duration::from_millis(1), Duration::from_secs(1)),
            Err(SupervisorConfigError::InvalidRestartAttempts)
        );
        assert_eq!(
            RestartPolicy::new(2, Duration::from_millis(1), Duration::from_secs(1)),
            Err(SupervisorConfigError::InvalidRestartAttempts)
        );
        assert_eq!(
            RestartPolicy::new(1, Duration::ZERO, Duration::from_secs(1)),
            Err(SupervisorConfigError::InvalidRestartBackoff)
        );
        assert_eq!(
            SupervisorConfig::new("short".to_owned(), 1, RestartPolicy::default()),
            Err(SupervisorConfigError::InvalidSourceRequest)
        );
    }

    #[test]
    fn a_partial_open_rolls_back_prior_sources_and_reports_cleanup_failure() {
        let display_stop_count = Arc::new(AtomicU32::new(0));
        let display = fake_factory(
            NativeSourceKind::DisplayTopology,
            vec![FactoryStep::open(fake_source(
                display_snapshot("display-instance-0001", SourceHealth::Healthy),
                Vec::new(),
                empty_batch(
                    NativeSourceKind::DisplayTopology,
                    "display-instance-0001",
                    SourceHealth::Failed,
                    Some(SourceFailureCode::Cleanup),
                ),
                Arc::clone(&display_stop_count),
            ))],
        );
        let candidate = fake_factory(
            NativeSourceKind::CandidateWindow,
            vec![FactoryStep::Fail(SourceFailureCode::Backend)],
        );
        let capture = fake_factory(NativeSourceKind::CaptureSession, Vec::new());
        let process = fake_factory(NativeSourceKind::ProcessApplication, Vec::new());
        let factories = factories_from_prefix(vec![
            (NativeSourceKind::DisplayTopology, display),
            (NativeSourceKind::CandidateWindow, candidate),
            (NativeSourceKind::CaptureSession, capture),
            (NativeSourceKind::ProcessApplication, process),
        ]);

        let error = NativeSourceSupervisor::open(config(), factories)
            .err()
            .expect("candidate open fails");
        assert_eq!(error.source, NativeSourceKind::CandidateWindow);
        assert_eq!(error.failure, SourceFailureCode::Backend);
        assert!(error.process_replacement_required);
        assert_eq!(
            error.cleanup_failures,
            vec![NativeSourceKind::DisplayTopology]
        );
        assert_eq!(display_stop_count.load(Ordering::Acquire), 1);
    }

    #[test]
    fn a_poisoned_initial_failure_reports_process_replacement() {
        let display = fake_factory(
            NativeSourceKind::DisplayTopology,
            vec![FactoryStep::PoisonedFailure(SourceFailureCode::Protocol)],
        );
        let factories = factories_from_prefix(vec![(NativeSourceKind::DisplayTopology, display)]);

        let error = NativeSourceSupervisor::open(config(), factories)
            .err()
            .expect("poisoned initial open fails");
        assert_eq!(error.source, NativeSourceKind::DisplayTopology);
        assert_eq!(error.failure, SourceFailureCode::Protocol);
        assert!(error.cleanup_failures.is_empty());
        assert!(error.process_replacement_required);
    }

    #[test]
    fn a_poisoned_process_rejects_and_stops_the_last_opened_source() {
        let stop_count = Arc::new(AtomicU32::new(0));
        let source = fake_source(
            display_snapshot("display-instance-0001", SourceHealth::Healthy),
            Vec::new(),
            empty_batch(
                NativeSourceKind::DisplayTopology,
                "display-instance-0001",
                SourceHealth::Stopped,
                None,
            ),
            Arc::clone(&stop_count),
        );

        let error = validate_opened_source(
            NativeSourceKind::DisplayTopology,
            Box::new(source),
            None,
            false,
        )
        .err()
        .expect("poisoned process rejects opened source");

        assert_eq!(error.code, SourceFailureCode::Cleanup);
        assert!(error.process_replacement_required);
        assert_eq!(stop_count.load(Ordering::Acquire), 1);
    }

    #[test]
    fn a_failed_source_restarts_after_backoff_with_a_fresh_reset_boundary() {
        let clock = FakeClock::default();
        let display_calls = Arc::new(Mutex::new(Vec::new()));
        let display = fake_factory_with_calls(
            NativeSourceKind::DisplayTopology,
            vec![
                FactoryStep::open(fake_source(
                    display_snapshot("display-instance-0001", SourceHealth::Healthy),
                    vec![empty_batch(
                        NativeSourceKind::DisplayTopology,
                        "display-instance-0001",
                        SourceHealth::Failed,
                        Some(SourceFailureCode::Backend),
                    )],
                    empty_batch(
                        NativeSourceKind::DisplayTopology,
                        "display-instance-0001",
                        SourceHealth::Failed,
                        Some(SourceFailureCode::Backend),
                    ),
                    Arc::new(AtomicU32::new(0)),
                )),
                FactoryStep::open(fake_source(
                    display_snapshot("display-instance-0002", SourceHealth::Healthy),
                    vec![display_reset_batch("display-instance-0002")],
                    empty_batch(
                        NativeSourceKind::DisplayTopology,
                        "display-instance-0002",
                        SourceHealth::Stopped,
                        None,
                    ),
                    Arc::new(AtomicU32::new(0)),
                )),
            ],
            Arc::clone(&display_calls),
        );
        let factories = healthy_fake_baseline(display);
        let mut supervisor =
            NativeSourceSupervisor::open_with_clock(config(), factories, Box::new(clock.clone()))
                .expect("baseline opens")
                .supervisor;

        let failed = supervisor.poll();
        assert_eq!(failed.state, SupervisorState::Recovering);
        assert!(matches!(
            failed.transitions.as_slice(),
            [SourceLifecycleTransition::RestartScheduled {
                source: NativeSourceKind::DisplayTopology,
                next_attempt: 1,
                retry_after,
                failure: SourceFailureCode::Backend,
                ..
            }] if *retry_after == Duration::from_millis(10)
        ));

        assert!(supervisor.poll().opened_snapshots.is_empty());
        clock.advance(Duration::from_millis(10));
        let started = supervisor.poll();
        assert_eq!(started.state, SupervisorState::Recovering);
        assert!(started.transitions.is_empty());
        let restarted = poll_until(&mut supervisor, |poll| {
            matches!(
                poll.transitions.as_slice(),
                [SourceLifecycleTransition::Restarted { .. }]
            )
        });
        assert_eq!(restarted.state, SupervisorState::Healthy);
        assert!(matches!(
            restarted.transitions.as_slice(),
            [SourceLifecycleTransition::Restarted {
                source: NativeSourceKind::DisplayTopology,
                attempt: 1,
                ..
            }]
        ));
        assert_eq!(
            restarted.opened_snapshots[0].source_instance_id(),
            "display-instance-0002"
        );

        let after_restart = supervisor.poll();
        let reset_batch = after_restart
            .batches
            .iter()
            .find(|batch| batch.kind() == NativeSourceKind::DisplayTopology)
            .expect("restarted display batch");
        assert_eq!(reset_batch.fact_count(), 1);
        let calls = display_calls.lock().expect("display calls lock");
        assert_eq!(calls.len(), 2);
        assert!(calls[0].is_none());
        assert_eq!(
            calls[1],
            Some(RestartBoundary {
                missing_count: RESTART_BOUNDARY_MISSING_COUNT,
                reason: RESTART_REASON,
            })
        );
    }

    #[test]
    fn one_restart_failure_exhausts_the_fixed_budget() {
        let clock = FakeClock::default();
        let display = fake_factory(
            NativeSourceKind::DisplayTopology,
            vec![
                FactoryStep::open(fake_source(
                    display_snapshot("display-instance-0001", SourceHealth::Healthy),
                    vec![empty_batch(
                        NativeSourceKind::DisplayTopology,
                        "display-instance-0001",
                        SourceHealth::Failed,
                        Some(SourceFailureCode::Backend),
                    )],
                    empty_batch(
                        NativeSourceKind::DisplayTopology,
                        "display-instance-0001",
                        SourceHealth::Failed,
                        Some(SourceFailureCode::Backend),
                    ),
                    Arc::new(AtomicU32::new(0)),
                )),
                FactoryStep::Fail(SourceFailureCode::Backend),
            ],
        );
        let factories = healthy_fake_baseline(display);
        let policy = RestartPolicy::new(1, Duration::from_millis(10), Duration::from_millis(40))
            .expect("valid policy");
        let config = SupervisorConfig::new("collection-session-0001".to_owned(), 16, policy)
            .expect("valid config");
        let mut supervisor =
            NativeSourceSupervisor::open_with_clock(config, factories, Box::new(clock.clone()))
                .expect("baseline opens")
                .supervisor;

        assert_eq!(supervisor.poll().state, SupervisorState::Recovering);
        clock.advance(Duration::from_millis(10));
        let started_first_attempt = supervisor.poll();
        assert!(started_first_attempt.transitions.is_empty());
        let first_attempt = poll_until(&mut supervisor, |poll| {
            matches!(
                poll.transitions.as_slice(),
                [SourceLifecycleTransition::RestartExhausted { .. }]
            )
        });
        assert_eq!(first_attempt.state, SupervisorState::Failed);
        assert!(matches!(
            first_attempt.transitions.as_slice(),
            [SourceLifecycleTransition::RestartExhausted {
                source: NativeSourceKind::DisplayTopology,
                attempts: 1,
                failure: SourceFailureCode::Backend,
            }]
        ));
        assert!(supervisor.poll().transitions.is_empty());
    }

    #[test]
    fn a_failed_stop_requires_process_replacement_instead_of_local_restart() {
        let clock = FakeClock::default();
        let poisoned = Arc::new(AtomicBool::new(false));
        let mut display_source = fake_source(
            display_snapshot("display-instance-0001", SourceHealth::Healthy),
            vec![empty_batch(
                NativeSourceKind::DisplayTopology,
                "display-instance-0001",
                SourceHealth::Failed,
                Some(SourceFailureCode::Backend),
            )],
            empty_batch(
                NativeSourceKind::DisplayTopology,
                "display-instance-0001",
                SourceHealth::Failed,
                Some(SourceFailureCode::Backend),
            ),
            Arc::new(AtomicU32::new(0)),
        );
        display_source.closed_input_boundary = false;
        let factories = healthy_fake_baseline(fake_factory(
            NativeSourceKind::DisplayTopology,
            vec![FactoryStep::open(display_source)],
        ));
        let mut supervisor = NativeSourceSupervisor::open_with_environment(
            config(),
            factories,
            Box::new(clock),
            Box::new(RecordingProcessFence {
                poisoned: Arc::clone(&poisoned),
            }),
            SOURCE_OPEN_DEADLINE,
        )
        .expect("baseline opens")
        .supervisor;

        let failed = supervisor.poll();
        assert_eq!(failed.state, SupervisorState::Failed);
        assert!(matches!(
            failed.transitions.as_slice(),
            [SourceLifecycleTransition::ProcessReplacementRequired {
                source: NativeSourceKind::DisplayTopology,
                failure: SourceFailureCode::Cleanup,
            }]
        ));
        assert!(poisoned.load(Ordering::Acquire));
        let later = supervisor.poll();
        assert_eq!(later.state, SupervisorState::Failed);
        assert!(later.batches.is_empty());
        assert!(later.transitions.is_empty());
    }

    #[test]
    fn a_poisoned_backend_failure_while_restarting_requires_process_replacement() {
        let clock = FakeClock::default();
        let poisoned = Arc::new(AtomicBool::new(false));
        let display = fake_factory(
            NativeSourceKind::DisplayTopology,
            vec![
                FactoryStep::open(failing_display_source()),
                FactoryStep::PoisonedFailure(SourceFailureCode::Backend),
            ],
        );
        let factories = healthy_fake_baseline(display);
        let mut supervisor = NativeSourceSupervisor::open_with_environment(
            config(),
            factories,
            Box::new(clock.clone()),
            Box::new(RecordingProcessFence {
                poisoned: Arc::clone(&poisoned),
            }),
            SOURCE_OPEN_DEADLINE,
        )
        .expect("baseline opens")
        .supervisor;

        assert_eq!(supervisor.poll().state, SupervisorState::Recovering);
        clock.advance(Duration::from_millis(10));
        assert_eq!(supervisor.poll().state, SupervisorState::Recovering);
        let failed = poll_until(&mut supervisor, |poll| {
            matches!(
                poll.transitions.as_slice(),
                [SourceLifecycleTransition::ProcessReplacementRequired { .. }]
            )
        });
        assert_eq!(failed.state, SupervisorState::Failed);
        assert!(matches!(
            failed.transitions.as_slice(),
            [SourceLifecycleTransition::ProcessReplacementRequired {
                source: NativeSourceKind::DisplayTopology,
                failure: SourceFailureCode::Backend,
            }]
        ));
        assert!(poisoned.load(Ordering::Acquire));
    }

    #[test]
    fn stop_preserves_process_replacement_from_an_in_flight_protocol_failure() {
        let clock = FakeClock::default();
        let poisoned = Arc::new(AtomicBool::new(false));
        let calls = Arc::new(Mutex::new(Vec::new()));
        let display = fake_factory_with_calls(
            NativeSourceKind::DisplayTopology,
            vec![
                FactoryStep::open(failing_display_source()),
                FactoryStep::PoisonedFailure(SourceFailureCode::Protocol),
            ],
            Arc::clone(&calls),
        );
        let factories = healthy_fake_baseline(display);
        let mut supervisor = NativeSourceSupervisor::open_with_environment(
            config(),
            factories,
            Box::new(clock.clone()),
            Box::new(RecordingProcessFence {
                poisoned: Arc::clone(&poisoned),
            }),
            SOURCE_OPEN_DEADLINE,
        )
        .expect("baseline opens")
        .supervisor;

        assert_eq!(supervisor.poll().state, SupervisorState::Recovering);
        clock.advance(Duration::from_millis(10));
        assert_eq!(supervisor.poll().state, SupervisorState::Recovering);
        wait_for_factory_calls(&calls, 2);
        let stopped = supervisor.stop();

        assert_eq!(stopped.state, SupervisorState::Stopped);
        assert!(stopped.process_replacement_required);
        assert!(poisoned.load(Ordering::Acquire));
        assert!(supervisor.stop().process_replacement_required);
    }

    #[test]
    fn a_due_restart_open_never_blocks_the_poll_caller() {
        let (started_sender, started_receiver) = mpsc::sync_channel(1);
        let (release_sender, release_receiver) = mpsc::sync_channel(1);
        let (finished_sender, _finished_receiver) = mpsc::sync_channel(1);
        let clock = FakeClock::default();
        let display = Box::new(BlockingRestartFactory {
            initial: Some(Box::new(failing_display_source())),
            replacement: Some(Box::new(healthy_replacement_display_source())),
            started_sender,
            release_receiver,
            finished_sender,
        });
        let factories = healthy_fake_baseline(display);
        let mut supervisor =
            NativeSourceSupervisor::open_with_clock(config(), factories, Box::new(clock.clone()))
                .expect("baseline opens")
                .supervisor;

        assert_eq!(supervisor.poll().state, SupervisorState::Recovering);
        clock.advance(Duration::from_millis(10));
        let began_at = Instant::now();
        let opening = supervisor.poll();
        let elapsed = began_at.elapsed();
        assert_eq!(opening.state, SupervisorState::Recovering);
        assert!(opening.transitions.is_empty());
        assert!(elapsed < Duration::from_millis(100));
        started_receiver
            .recv_timeout(Duration::from_secs(1))
            .expect("restart worker starts");
        release_sender.send(()).expect("release restart worker");

        let restarted = poll_until(&mut supervisor, |poll| {
            matches!(
                poll.transitions.as_slice(),
                [SourceLifecycleTransition::Restarted { .. }]
            )
        });
        assert_eq!(restarted.state, SupervisorState::Healthy);
    }

    #[test]
    fn stop_fences_an_in_flight_restart_before_reporting_stopped() {
        let (started_sender, started_receiver) = mpsc::sync_channel(1);
        let (release_sender, release_receiver) = mpsc::sync_channel(1);
        let (finished_sender, finished_receiver) = mpsc::sync_channel(1);
        let clock = FakeClock::default();
        let display = Box::new(BlockingRestartFactory {
            initial: Some(Box::new(failing_display_source())),
            replacement: Some(Box::new(healthy_replacement_display_source())),
            started_sender,
            release_receiver,
            finished_sender,
        });
        let factories = healthy_fake_baseline(display);
        let mut supervisor =
            NativeSourceSupervisor::open_with_clock(config(), factories, Box::new(clock.clone()))
                .expect("baseline opens")
                .supervisor;

        assert_eq!(supervisor.poll().state, SupervisorState::Recovering);
        clock.advance(Duration::from_millis(10));
        assert_eq!(supervisor.poll().state, SupervisorState::Recovering);
        started_receiver
            .recv_timeout(Duration::from_secs(1))
            .expect("restart worker starts");
        let releaser = thread::spawn(move || {
            thread::sleep(Duration::from_millis(20));
            release_sender.send(()).expect("release restart worker");
        });

        let stopped = supervisor.stop();
        releaser.join().expect("release thread exits");
        finished_receiver
            .recv_timeout(Duration::from_secs(1))
            .expect("restart worker closes its open boundary");
        assert_eq!(stopped.state, SupervisorState::Stopped);
        assert!(!stopped.process_replacement_required);
        assert_eq!(
            stopped
                .batches
                .iter()
                .map(NativeSourceBatch::kind)
                .collect::<Vec<_>>(),
            vec![
                NativeSourceKind::MediaDevice,
                NativeSourceKind::NetworkConfiguration,
                NativeSourceKind::Virtualization,
                NativeSourceKind::RemovableStorage,
                NativeSourceKind::PrintSpooler,
                NativeSourceKind::Clipboard,
                NativeSourceKind::InteractiveSession,
                NativeSourceKind::ProcessApplication,
                NativeSourceKind::CaptureSession,
                NativeSourceKind::CandidateWindow,
                NativeSourceKind::DisplayTopology,
            ]
        );
    }

    #[test]
    fn a_stalled_restart_open_requires_process_replacement_after_its_deadline() {
        let (started_sender, started_receiver) = mpsc::sync_channel(1);
        let (release_sender, release_receiver) = mpsc::sync_channel(1);
        let (finished_sender, finished_receiver) = mpsc::sync_channel(1);
        let poisoned = Arc::new(AtomicBool::new(false));
        let clock = FakeClock::default();
        let display = Box::new(BlockingRestartFactory {
            initial: Some(Box::new(failing_display_source())),
            replacement: Some(Box::new(healthy_replacement_display_source())),
            started_sender,
            release_receiver,
            finished_sender,
        });
        let factories = healthy_fake_baseline(display);
        let mut supervisor = NativeSourceSupervisor::open_with_environment(
            config(),
            factories,
            Box::new(clock.clone()),
            Box::new(RecordingProcessFence {
                poisoned: Arc::clone(&poisoned),
            }),
            Duration::from_millis(20),
        )
        .expect("baseline opens")
        .supervisor;

        assert_eq!(supervisor.poll().state, SupervisorState::Recovering);
        clock.advance(Duration::from_millis(10));
        assert_eq!(supervisor.poll().state, SupervisorState::Recovering);
        started_receiver
            .recv_timeout(Duration::from_secs(1))
            .expect("restart worker starts");
        thread::sleep(Duration::from_millis(30));
        let failed = supervisor.poll();
        assert_eq!(failed.state, SupervisorState::Failed);
        assert!(matches!(
            failed.transitions.as_slice(),
            [SourceLifecycleTransition::ProcessReplacementRequired {
                source: NativeSourceKind::DisplayTopology,
                failure: SourceFailureCode::Cleanup,
            }]
        ));
        assert!(poisoned.load(Ordering::Acquire));

        release_sender.send(()).expect("release timed-out worker");
        finished_receiver
            .recv_timeout(Duration::from_secs(1))
            .expect("timed-out worker exits after release");
    }

    #[test]
    fn a_stalled_open_is_deadline_bounded_and_poisoned() {
        let (release_sender, release_receiver) = mpsc::sync_channel(1);
        let (finished_sender, finished_receiver) = mpsc::sync_channel(1);
        let poisoned = AtomicBool::new(false);
        let outcome = bounded_factory_open_with(
            NativeSourceKind::DisplayTopology,
            Box::new(BlockingFactory {
                release_receiver,
                finished_sender,
            }),
            SourceParameters::from(&config()),
            None,
            Duration::from_millis(20),
            &|| poisoned.store(true, Ordering::Release),
        );

        assert!(matches!(
            outcome,
            FactoryOpenOutcome::LifecycleFailure(BoundedTaskError::TimedOut)
        ));
        assert!(poisoned.load(Ordering::Acquire));
        release_sender.send(()).expect("release stalled factory");
        finished_receiver
            .recv_timeout(Duration::from_secs(1))
            .expect("detached factory exits after release");
    }

    fn config() -> SupervisorConfig {
        let policy = RestartPolicy::new(1, Duration::from_millis(10), Duration::from_millis(40))
            .expect("valid policy");
        SupervisorConfig::new("collection-session-0001".to_owned(), 16, policy)
            .expect("valid config")
    }

    fn poll_until(
        supervisor: &mut NativeSourceSupervisor,
        predicate: impl Fn(&SupervisorPoll) -> bool,
    ) -> SupervisorPoll {
        let deadline = Instant::now() + Duration::from_secs(1);
        loop {
            let poll = supervisor.poll();
            if predicate(&poll) {
                return poll;
            }
            assert!(
                Instant::now() < deadline,
                "supervisor did not produce the expected transition"
            );
            thread::yield_now();
        }
    }

    fn wait_for_factory_calls(calls: &Arc<Mutex<Vec<Option<RestartBoundary>>>>, expected: usize) {
        let deadline = Instant::now() + Duration::from_secs(1);
        loop {
            if calls.lock().expect("factory calls lock").len() >= expected {
                return;
            }
            assert!(
                Instant::now() < deadline,
                "restart worker did not call the factory"
            );
            thread::yield_now();
        }
    }

    fn display_state() -> DisplayTopologySnapshot {
        DisplayTopologySnapshot {
            certainty: TopologyCertainty::Complete,
            targets: Vec::new(),
        }
    }

    fn window_state() -> CandidateWindowState {
        CandidateWindowState {
            certainty: CandidateWindowCertainty::Complete,
            presence: CandidateWindowPresence::Present,
            focus: CandidateWindowFocus::Focused,
            visibility: CandidateWindowVisibility::Visible,
            placement: CandidateWindowPlacement::Maximized,
            bounds: Some(CandidateWindowBounds {
                x: 0,
                y: 0,
                width: 1920,
                height: 1080,
            }),
            display_target_id: Some("display-1".to_owned()),
        }
    }

    fn capture_state() -> CaptureSessionState {
        let unsupported = CaptureSessionSignal {
            support: CaptureSessionSupport::Unsupported,
            activity: CaptureSessionActivity::Unknown,
            certainty: CaptureSessionCertainty::Unknown,
        };
        CaptureSessionState {
            screen_capture: unsupported.clone(),
            native_remote_session: unsupported,
        }
    }

    fn process_state() -> ProcessApplicationState {
        ProcessApplicationState {
            coverage: ProcessApplicationCoverage::FullLifecycle,
            certainty: ProcessApplicationCertainty::Complete,
            processes: Vec::new(),
        }
    }

    fn timestamp() -> SourceTimestamp {
        SourceTimestamp {
            monotonic_time_ns: 1,
        }
    }

    fn display_snapshot(id: &str, health: SourceHealth) -> NativeSourceSnapshot {
        NativeSourceSnapshot::DisplayTopology(DisplayTopologySourceSnapshot {
            source_instance_id: id.to_owned(),
            source_version: "test-v1".to_owned(),
            adapter_version: "test-adapter-v1".to_owned(),
            schema_version: DISPLAY_TOPOLOGY_SCHEMA_VERSION,
            platform: PlatformFamily::Linux,
            permission: PermissionState::Granted,
            health,
            sequence: 0,
            observed_at: timestamp(),
            topology: display_state(),
        })
    }

    fn candidate_snapshot(id: &str) -> NativeSourceSnapshot {
        NativeSourceSnapshot::CandidateWindow(CandidateWindowSourceSnapshot {
            source_instance_id: id.to_owned(),
            source_version: "test-v1".to_owned(),
            adapter_version: "test-adapter-v1".to_owned(),
            schema_version: CANDIDATE_WINDOW_SCHEMA_VERSION,
            platform: PlatformFamily::Linux,
            permission: PermissionState::Granted,
            health: SourceHealth::Healthy,
            sequence: 0,
            observed_at: timestamp(),
            window: window_state(),
        })
    }

    fn capture_snapshot(id: &str) -> NativeSourceSnapshot {
        NativeSourceSnapshot::CaptureSession(CaptureSessionSourceSnapshot {
            source_instance_id: id.to_owned(),
            source_version: "test-v1".to_owned(),
            adapter_version: "test-adapter-v1".to_owned(),
            schema_version: CAPTURE_SESSION_SCHEMA_VERSION,
            platform: PlatformFamily::Linux,
            permission: PermissionState::Unavailable,
            health: SourceHealth::Healthy,
            sequence: 0,
            observed_at: timestamp(),
            state: capture_state(),
        })
    }

    fn process_snapshot(id: &str) -> NativeSourceSnapshot {
        NativeSourceSnapshot::ProcessApplication(ProcessApplicationSourceSnapshot {
            source_instance_id: id.to_owned(),
            source_version: "test-v1".to_owned(),
            adapter_version: "test-adapter-v1".to_owned(),
            schema_version: PROCESS_APPLICATION_SCHEMA_VERSION,
            platform: PlatformFamily::Linux,
            permission: PermissionState::Unavailable,
            health: SourceHealth::Healthy,
            sequence: 0,
            observed_at: timestamp(),
            state: process_state(),
        })
    }

    fn passive_snapshot<W: SupervisedPassiveStateWire>(id: &str) -> NativeSourceSnapshot {
        W::wrap_snapshot(W::snapshot(
            SourceSessionMetadata {
                source_instance_id: id.to_owned(),
                health: SourceHealth::Healthy,
                observed_at: timestamp(),
            },
            PlatformFamily::Linux,
            PermissionState::Unavailable,
            "test-adapter-v1",
            W::unavailable_state(),
        ))
    }

    fn empty_passive_batch<W: SupervisedPassiveStateWire>(
        id: &str,
        health: SourceHealth,
        terminal_error: Option<SourceFailureCode>,
    ) -> NativeSourceBatch {
        W::wrap_batch(W::drain(
            id.to_owned(),
            health,
            Vec::new(),
            Vec::new(),
            terminal_error,
        ))
    }

    fn empty_batch(
        kind: NativeSourceKind,
        id: &str,
        health: SourceHealth,
        terminal_error: Option<SourceFailureCode>,
    ) -> NativeSourceBatch {
        match kind {
            NativeSourceKind::DisplayTopology => {
                NativeSourceBatch::DisplayTopology(DisplayTopologyDrain {
                    source_instance_id: id.to_owned(),
                    observations: Vec::new(),
                    resets: Vec::new(),
                    health,
                    terminal_error,
                })
            }
            NativeSourceKind::CandidateWindow => {
                NativeSourceBatch::CandidateWindow(CandidateWindowDrain {
                    source_instance_id: id.to_owned(),
                    health,
                    observations: Vec::new(),
                    resets: Vec::new(),
                    terminal_error,
                })
            }
            NativeSourceKind::CaptureSession => {
                NativeSourceBatch::CaptureSession(CaptureSessionDrain {
                    source_instance_id: id.to_owned(),
                    health,
                    observations: Vec::new(),
                    resets: Vec::new(),
                    terminal_error,
                })
            }
            NativeSourceKind::ProcessApplication => {
                NativeSourceBatch::ProcessApplication(ProcessApplicationDrain {
                    source_instance_id: id.to_owned(),
                    health,
                    observations: Vec::new(),
                    resets: Vec::new(),
                    terminal_error,
                })
            }
            NativeSourceKind::InteractiveSession => {
                empty_passive_batch::<InteractiveSessionWire>(id, health, terminal_error)
            }
            NativeSourceKind::Clipboard => {
                empty_passive_batch::<ClipboardWire>(id, health, terminal_error)
            }
            NativeSourceKind::PrintSpooler => {
                empty_passive_batch::<PrintSpoolerWire>(id, health, terminal_error)
            }
            NativeSourceKind::RemovableStorage => {
                empty_passive_batch::<RemovableStorageWire>(id, health, terminal_error)
            }
            NativeSourceKind::Virtualization => {
                empty_passive_batch::<VirtualizationWire>(id, health, terminal_error)
            }
            NativeSourceKind::NetworkConfiguration => {
                empty_passive_batch::<NetworkConfigurationWire>(id, health, terminal_error)
            }
            NativeSourceKind::MediaDevice => {
                empty_passive_batch::<MediaDeviceWire>(id, health, terminal_error)
            }
        }
    }

    fn display_reset_batch(id: &str) -> NativeSourceBatch {
        NativeSourceBatch::DisplayTopology(DisplayTopologyDrain {
            source_instance_id: id.to_owned(),
            observations: Vec::new(),
            resets: vec![SourceReset {
                source_instance_id: id.to_owned(),
                sequence: 2,
                observed_at: timestamp(),
                gap: Some(SequenceGap {
                    first_missing: 1,
                    last_missing: 1,
                }),
                reason: RESTART_REASON.to_owned(),
            }],
            health: SourceHealth::Healthy,
            terminal_error: None,
        })
    }

    struct FakeSource {
        snapshot: NativeSourceSnapshot,
        drains: VecDeque<NativeSourceBatch>,
        fallback_health: SourceHealth,
        stop_batch: NativeSourceBatch,
        closed_input_boundary: bool,
        stop_count: Arc<AtomicU32>,
    }

    impl ErasedSource for FakeSource {
        fn kind(&self) -> NativeSourceKind {
            self.snapshot.kind()
        }

        fn snapshot(&self) -> NativeSourceSnapshot {
            self.snapshot.clone()
        }

        fn health(&self) -> SourceHealth {
            self.fallback_health
        }

        fn drain(&mut self) -> NativeSourceBatch {
            if let Some(batch) = self.drains.pop_front() {
                self.fallback_health = batch.health();
                return batch;
            }
            empty_batch(
                self.kind(),
                self.snapshot.source_instance_id(),
                self.fallback_health,
                (self.fallback_health == SourceHealth::Failed)
                    .then_some(SourceFailureCode::Backend),
            )
        }

        fn stop(&mut self) -> SourceStopOutcome {
            self.stop_count.fetch_add(1, Ordering::AcqRel);
            SourceStopOutcome {
                preceding_batches: Vec::new(),
                final_snapshot: None,
                batch: self.stop_batch.clone(),
                closed_input_boundary: self.closed_input_boundary,
            }
        }
    }

    fn fake_source(
        snapshot: NativeSourceSnapshot,
        drains: Vec<NativeSourceBatch>,
        stop_batch: NativeSourceBatch,
        stop_count: Arc<AtomicU32>,
    ) -> FakeSource {
        let fallback_health = snapshot.health();
        FakeSource {
            snapshot,
            drains: drains.into(),
            fallback_health,
            stop_batch,
            closed_input_boundary: true,
            stop_count,
        }
    }

    fn failing_display_source() -> FakeSource {
        fake_source(
            display_snapshot("display-instance-0001", SourceHealth::Healthy),
            vec![empty_batch(
                NativeSourceKind::DisplayTopology,
                "display-instance-0001",
                SourceHealth::Failed,
                Some(SourceFailureCode::Backend),
            )],
            empty_batch(
                NativeSourceKind::DisplayTopology,
                "display-instance-0001",
                SourceHealth::Failed,
                Some(SourceFailureCode::Backend),
            ),
            Arc::new(AtomicU32::new(0)),
        )
    }

    fn healthy_replacement_display_source() -> FakeSource {
        fake_source(
            display_snapshot("display-instance-0002", SourceHealth::Healthy),
            vec![display_reset_batch("display-instance-0002")],
            empty_batch(
                NativeSourceKind::DisplayTopology,
                "display-instance-0002",
                SourceHealth::Stopped,
                None,
            ),
            Arc::new(AtomicU32::new(0)),
        )
    }

    enum FactoryStep {
        Open(Box<FakeSource>),
        Fail(SourceFailureCode),
        PoisonedFailure(SourceFailureCode),
    }

    impl FactoryStep {
        fn open(source: FakeSource) -> Self {
            Self::Open(Box::new(source))
        }
    }

    struct FakeFactory {
        kind: NativeSourceKind,
        steps: VecDeque<FactoryStep>,
        calls: Arc<Mutex<Vec<Option<RestartBoundary>>>>,
    }

    struct BlockingFactory {
        release_receiver: Receiver<()>,
        finished_sender: SyncSender<()>,
    }

    struct BlockingRestartFactory {
        initial: Option<Box<FakeSource>>,
        replacement: Option<Box<FakeSource>>,
        started_sender: SyncSender<()>,
        release_receiver: Receiver<()>,
        finished_sender: SyncSender<()>,
    }

    impl ErasedFactory for BlockingFactory {
        fn open(
            &mut self,
            _parameters: &SourceParameters,
            _restart: Option<RestartBoundary>,
        ) -> Result<Box<dyn ErasedSource>, SourceStartFailure> {
            let _ = self.release_receiver.recv();
            let _ = self.finished_sender.send(());
            Err(SourceStartFailure {
                code: SourceFailureCode::Backend,
                process_replacement_required: false,
            })
        }
    }

    impl ErasedFactory for BlockingRestartFactory {
        fn open(
            &mut self,
            _parameters: &SourceParameters,
            restart: Option<RestartBoundary>,
        ) -> Result<Box<dyn ErasedSource>, SourceStartFailure> {
            if restart.is_none() {
                return self
                    .initial
                    .take()
                    .map(|source| source as Box<dyn ErasedSource>)
                    .ok_or(SourceStartFailure {
                        code: SourceFailureCode::Backend,
                        process_replacement_required: false,
                    });
            }
            let _ = self.started_sender.send(());
            let _ = self.release_receiver.recv();
            let _ = self.finished_sender.send(());
            self.replacement
                .take()
                .map(|source| source as Box<dyn ErasedSource>)
                .ok_or(SourceStartFailure {
                    code: SourceFailureCode::Backend,
                    process_replacement_required: false,
                })
        }
    }

    impl ErasedFactory for FakeFactory {
        fn open(
            &mut self,
            _parameters: &SourceParameters,
            restart: Option<RestartBoundary>,
        ) -> Result<Box<dyn ErasedSource>, SourceStartFailure> {
            self.calls.lock().expect("factory calls lock").push(restart);
            match self.steps.pop_front() {
                Some(FactoryStep::Open(source)) if source.kind() == self.kind => Ok(source),
                Some(FactoryStep::Open(_source)) => Err(SourceStartFailure {
                    code: SourceFailureCode::Protocol,
                    process_replacement_required: false,
                }),
                Some(FactoryStep::Fail(code)) => Err(SourceStartFailure {
                    code,
                    process_replacement_required: false,
                }),
                Some(FactoryStep::PoisonedFailure(code)) => Err(SourceStartFailure {
                    code,
                    process_replacement_required: true,
                }),
                None => Err(SourceStartFailure {
                    code: SourceFailureCode::Backend,
                    process_replacement_required: false,
                }),
            }
        }
    }

    fn fake_factory(kind: NativeSourceKind, steps: Vec<FactoryStep>) -> Box<dyn ErasedFactory> {
        fake_factory_with_calls(kind, steps, Arc::new(Mutex::new(Vec::new())))
    }

    fn fake_factory_with_calls(
        kind: NativeSourceKind,
        steps: Vec<FactoryStep>,
        calls: Arc<Mutex<Vec<Option<RestartBoundary>>>>,
    ) -> Box<dyn ErasedFactory> {
        Box::new(FakeFactory {
            kind,
            steps: steps.into(),
            calls,
        })
    }

    fn healthy_fake_baseline(display: Box<dyn ErasedFactory>) -> BaselineSourceFactories {
        let candidate = fake_factory(
            NativeSourceKind::CandidateWindow,
            vec![FactoryStep::open(fake_source(
                candidate_snapshot("candidate-instance-0001"),
                Vec::new(),
                empty_batch(
                    NativeSourceKind::CandidateWindow,
                    "candidate-instance-0001",
                    SourceHealth::Stopped,
                    None,
                ),
                Arc::new(AtomicU32::new(0)),
            ))],
        );
        let capture = fake_factory(
            NativeSourceKind::CaptureSession,
            vec![FactoryStep::open(fake_source(
                capture_snapshot("capture-instance-0001"),
                Vec::new(),
                empty_batch(
                    NativeSourceKind::CaptureSession,
                    "capture-instance-0001",
                    SourceHealth::Stopped,
                    None,
                ),
                Arc::new(AtomicU32::new(0)),
            ))],
        );
        let process = fake_factory(
            NativeSourceKind::ProcessApplication,
            vec![FactoryStep::open(fake_source(
                process_snapshot("process-instance-0001"),
                Vec::new(),
                empty_batch(
                    NativeSourceKind::ProcessApplication,
                    "process-instance-0001",
                    SourceHealth::Stopped,
                    None,
                ),
                Arc::new(AtomicU32::new(0)),
            ))],
        );
        let mut manifest_order = vec![
            (NativeSourceKind::DisplayTopology, display),
            (NativeSourceKind::CandidateWindow, candidate),
            (NativeSourceKind::CaptureSession, capture),
            (NativeSourceKind::ProcessApplication, process),
        ];
        manifest_order.push(healthy_passive_entry::<InteractiveSessionWire>(
            "interactive-instance-0001",
        ));
        manifest_order.push(healthy_passive_entry::<ClipboardWire>(
            "clipboard-instance-0001",
        ));
        manifest_order.push(healthy_passive_entry::<PrintSpoolerWire>(
            "print-instance-000001",
        ));
        manifest_order.push(healthy_passive_entry::<RemovableStorageWire>(
            "storage-instance-0001",
        ));
        manifest_order.push(healthy_passive_entry::<VirtualizationWire>(
            "virtual-instance-0001",
        ));
        manifest_order.push(healthy_passive_entry::<NetworkConfigurationWire>(
            "network-instance-0001",
        ));
        manifest_order.push(healthy_passive_entry::<MediaDeviceWire>(
            "media-instance-00001",
        ));
        BaselineSourceFactories::from_erased(manifest_order)
    }

    fn factories_from_prefix(
        mut manifest_order: Vec<(NativeSourceKind, Box<dyn ErasedFactory>)>,
    ) -> BaselineSourceFactories {
        for kind in NATIVE_SOURCE_KINDS
            .iter()
            .copied()
            .skip(manifest_order.len())
        {
            manifest_order.push((kind, fake_factory(kind, Vec::new())));
        }
        BaselineSourceFactories::from_erased(manifest_order)
    }

    fn healthy_passive_entry<W: SupervisedPassiveStateWire>(
        id: &str,
    ) -> (NativeSourceKind, Box<dyn ErasedFactory>) {
        (
            W::KIND,
            fake_factory(
                W::KIND,
                vec![FactoryStep::open(fake_source(
                    passive_snapshot::<W>(id),
                    Vec::new(),
                    empty_passive_batch::<W>(id, SourceHealth::Stopped, None),
                    Arc::new(AtomicU32::new(0)),
                ))],
            ),
        )
    }

    #[derive(Clone, Default)]
    struct FakeClock {
        elapsed: Rc<Cell<Duration>>,
    }

    impl FakeClock {
        fn advance(&self, duration: Duration) {
            self.elapsed
                .set(self.elapsed.get().saturating_add(duration));
        }
    }

    impl SupervisorClock for FakeClock {
        fn now(&self) -> Duration {
            self.elapsed.get()
        }
    }

    struct RecordingProcessFence {
        poisoned: Arc<AtomicBool>,
    }

    impl ProcessFence for RecordingProcessFence {
        fn poison(&self) {
            self.poisoned.store(true, Ordering::Release);
        }
    }
}
