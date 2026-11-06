//! Public source factories and the manifest of factories handed to the
//! supervisor, plus the adapters that erase each capability's typed source.

use std::marker::PhantomData;

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
use native_protocol::SourceHealth;
use native_source_runtime::{
    PassiveStateBackend, PassiveStateSource, PassiveStateSourceError, PassiveStateSubscription,
    PassiveStateWire,
};
use network_configuration_state::NetworkConfigurationWire;
use print_spooler_state::PrintSpoolerWire;
use process_application_state::{
    ProcessApplicationBackend, ProcessApplicationError, ProcessApplicationSource,
    ProcessApplicationSubscription,
};
use removable_storage_state::RemovableStorageWire;
use virtualization_state::VirtualizationWire;

use crate::config::SupervisorConfigError;
use crate::erased::{
    ErasedFactory, ErasedSource, RestartBoundary, SourceParameters, SourceStartFailure,
    SourceStopOutcome, source_start_failure,
};
use crate::source::{NativeSourceBatch, NativeSourceKind, NativeSourceSnapshot};

/// A passive-state wire format the supervisor knows how to label and wrap into
/// its source-neutral snapshot and batch enums.
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

/// Opens one passive-state source for wire format `W` from a caller-supplied
/// backend constructor.
pub struct PassiveStateFactory<W, F, B> {
    make_backend: F,
    wire: PhantomData<fn() -> (W, B)>,
}

/// Builds a passive-state factory for wire format `W`. The constructor runs
/// again for every restart, so it must produce a fresh backend each time.
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
    pub(crate) manifest_order: Vec<(NativeSourceKind, Box<dyn ErasedFactory>)>,
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
    pub(crate) fn from_erased(
        manifest_order: Vec<(NativeSourceKind, Box<dyn ErasedFactory>)>,
    ) -> Self {
        Self { manifest_order }
    }

    pub(crate) fn into_manifest_order(self) -> Vec<(NativeSourceKind, Box<dyn ErasedFactory>)> {
        self.manifest_order
    }
}

/// Declares the public factory for one capability with its own backend trait,
/// and teaches the supervisor to open that capability fresh or after a restart
/// boundary.
macro_rules! typed_source_factory {
    (
        $(#[$doc:meta])*
        $factory:ident, $constructor:ident,
        $backend:ident, $error:ident, $source:ident, $wrapper:ident
    ) => {
        /// Opens one capability source from a caller-supplied backend constructor.
        pub struct $factory<F, B> {
            make_backend: F,
            backend: PhantomData<fn() -> B>,
        }

        $(#[$doc])*
        #[must_use]
        pub fn $constructor<F, B>(make_backend: F) -> $factory<F, B>
        where
            F: FnMut() -> Result<B, $error> + Send,
            B: $backend + Send,
            B::Subscription: Send,
        {
            $factory {
                make_backend,
                backend: PhantomData,
            }
        }

        impl<F, B> ErasedFactory for $factory<F, B>
        where
            F: FnMut() -> Result<B, $error> + Send,
            B: $backend + Send + 'static,
            B::Subscription: Send + 'static,
        {
            fn open(
                &mut self,
                parameters: &SourceParameters,
                restart: Option<RestartBoundary>,
            ) -> Result<Box<dyn ErasedSource>, SourceStartFailure> {
                let backend = (self.make_backend)()
                    .map_err(|error| source_start_failure(error.failure_code()))?;
                let request = parameters.request();
                let source = match restart {
                    Some(boundary) => $source::open_after_reset(
                        &request,
                        backend,
                        boundary.missing_count,
                        boundary.reason.to_owned(),
                    ),
                    None => $source::open(&request, backend),
                }
                .map_err(|error| source_start_failure(error.failure_code()))?;
                Ok(Box::new($wrapper(source)))
            }
        }
    };
}

typed_source_factory!(
    /// Builds the display-topology factory. The constructor runs again for
    /// every restart, so it must produce a fresh backend each time.
    DisplayTopologyFactory,
    display_topology_factory,
    DisplayTopologyBackend,
    DisplayTopologyError,
    DisplayTopologySource,
    DisplaySource
);
typed_source_factory!(
    /// Builds the candidate-window factory. The constructor runs again for
    /// every restart, so it must produce a fresh backend each time.
    CandidateWindowFactory,
    candidate_window_factory,
    CandidateWindowBackend,
    CandidateWindowError,
    CandidateWindowSource,
    WindowSource
);
typed_source_factory!(
    /// Builds the capture-session factory. The constructor runs again for
    /// every restart, so it must produce a fresh backend each time.
    CaptureSessionFactory,
    capture_session_factory,
    CaptureSessionBackend,
    CaptureSessionError,
    CaptureSessionSource,
    SessionSource
);
typed_source_factory!(
    /// Builds the process-application factory. The constructor runs again for
    /// every restart, so it must produce a fresh backend each time.
    ProcessApplicationFactory,
    process_application_factory,
    ProcessApplicationBackend,
    ProcessApplicationError,
    ProcessApplicationSource,
    ProcessSource
);

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
        let request = parameters.request();
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

/// Wraps one capability's typed source so the supervisor can drive it through
/// [`ErasedSource`]. The wrapper exists because the typed sources have inherent
/// methods with the same names as the erased trait.
macro_rules! erased_source {
    ($wrapper:ident, $source:ident, $subscription:ident, $kind:ident) => {
        struct $wrapper<S: $subscription>($source<S>);

        impl<S: $subscription + Send> ErasedSource for $wrapper<S> {
            fn kind(&self) -> NativeSourceKind {
                NativeSourceKind::$kind
            }

            fn snapshot(&self) -> NativeSourceSnapshot {
                NativeSourceSnapshot::$kind(self.0.snapshot().clone())
            }

            fn health(&self) -> SourceHealth {
                self.0.health()
            }

            fn drain(&mut self) -> NativeSourceBatch {
                NativeSourceBatch::$kind(self.0.drain())
            }

            fn stop(&mut self) -> SourceStopOutcome {
                SourceStopOutcome::in_process(NativeSourceBatch::$kind(self.0.stop()))
            }
        }
    };
}

erased_source!(
    DisplaySource,
    DisplayTopologySource,
    DisplayTopologySubscription,
    DisplayTopology
);
erased_source!(
    WindowSource,
    CandidateWindowSource,
    CandidateWindowSubscription,
    CandidateWindow
);
erased_source!(
    SessionSource,
    CaptureSessionSource,
    CaptureSessionSubscription,
    CaptureSession
);
erased_source!(
    ProcessSource,
    ProcessApplicationSource,
    ProcessApplicationSubscription,
    ProcessApplication
);

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
        SourceStopOutcome::in_process(W::wrap_batch(self.0.stop()))
    }
}
