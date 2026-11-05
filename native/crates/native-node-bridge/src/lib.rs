use std::cell::RefCell;
use std::time::Duration;

#[cfg(target_os = "linux")]
use candidate_window_state::LinuxCandidateWindowBackend as PlatformCandidateWindowBackend;
#[cfg(target_os = "macos")]
use candidate_window_state::MacOsCandidateWindowBackend as PlatformCandidateWindowBackend;
#[cfg(target_os = "windows")]
use candidate_window_state::WindowsCandidateWindowBackend as PlatformCandidateWindowBackend;
use candidate_window_state::{
    CandidateWindowError, CandidateWindowUtilityIngress, CandidateWindowUtilityIngressOutcome,
    CandidateWindowUtilityReceiver, candidate_window_utility_ingress,
};
#[cfg(target_os = "linux")]
use capture_session_state::LinuxCaptureSessionBackend as PlatformCaptureSessionBackend;
#[cfg(target_os = "macos")]
use capture_session_state::MacOsCaptureSessionBackend as PlatformCaptureSessionBackend;
#[cfg(target_os = "windows")]
use capture_session_state::WindowsCaptureSessionBackend as PlatformCaptureSessionBackend;
use clipboard_state::{ClipboardWire, PlatformClipboardBackend};
#[cfg(target_os = "linux")]
use display_topology::LinuxDisplayTopologyBackend as PlatformDisplayTopologyBackend;
#[cfg(target_os = "macos")]
use display_topology::MacOsDisplayTopologyBackend as PlatformDisplayTopologyBackend;
#[cfg(target_os = "windows")]
use display_topology::WindowsDisplayTopologyBackend as PlatformDisplayTopologyBackend;
use interactive_session_state::{InteractiveSessionWire, PlatformInteractiveSessionBackend};
use media_device_state::{
    MediaDeviceError, MediaDeviceSelection, MediaDeviceWire, PlatformMediaDeviceBackend,
};
use napi::bindgen_prelude::Unknown;
use napi::{Env, Error, Result, Status};
use napi_derive::napi;
use native_protocol::{
    CandidateWindowDrain, CandidateWindowHostEvent, CandidateWindowSourceSnapshot,
    CandidateWindowState, CaptureSessionDrain, CaptureSessionSourceSnapshot, ClipboardDrain,
    ClipboardSourceSnapshot, DisplayTopologyDrain, DisplayTopologySourceSnapshot,
    InteractiveSessionDrain, InteractiveSessionSourceSnapshot, MediaDeviceDrain,
    MediaDeviceSourceSnapshot, NATIVE_SOURCE_CATEGORY_ORDER, NATIVE_SOURCE_COUNT,
    NATIVE_SOURCE_MANIFEST, NativeSourceCategory, NativeSourceManifestEntry,
    NetworkConfigurationDrain, NetworkConfigurationSourceSnapshot, PrintSpoolerDrain,
    PrintSpoolerSourceSnapshot, ProcessApplicationDrain, ProcessApplicationSourceSnapshot,
    ProtocolValidatable, RemovableStorageDrain, RemovableStorageSourceSnapshot, SourceFailureCode,
    VirtualizationDrain, VirtualizationSourceSnapshot,
};
use native_source_supervisor::{
    BaselineSourceFactories, NATIVE_SOURCE_KINDS, NativeSourceBatch, NativeSourceKind,
    NativeSourceSnapshot, NativeSourceSupervisor, RestartPolicy, SourceLifecycleTransition,
    SupervisorConfig, SupervisorPoll, SupervisorState, SupervisorStop, candidate_window_factory,
    capture_session_factory, display_topology_factory, passive_state_factory,
    process_application_factory,
};
use network_configuration_state::{
    NetworkConfigurationCategory, NetworkConfigurationError, NetworkConfigurationSelection,
    NetworkConfigurationWire, PlatformNetworkConfigurationBackend,
};
use print_spooler_state::{PlatformPrintSpoolerBackend, PrintSpoolerWire};
#[cfg(target_os = "linux")]
use process_application_state::LinuxProcessApplicationBackend as PlatformProcessApplicationBackend;
#[cfg(target_os = "macos")]
use process_application_state::MacOsProcessApplicationBackend as PlatformProcessApplicationBackend;
#[cfg(target_os = "windows")]
use process_application_state::WindowsProcessApplicationBackend as PlatformProcessApplicationBackend;
use removable_storage_state::{
    PlatformRemovableStorageBackend, RemovableStorageError, RemovableStorageSelection,
    RemovableStorageWire,
};
use serde::{Deserialize, Serialize};
use virtualization_state::{PlatformVirtualizationBackend, VirtualizationWire};

const BRIDGE_VERSION: u16 = 1;

thread_local! {
    static RUNTIME: RefCell<Option<BridgeRuntime>> = const { RefCell::new(None) };
}

struct BridgeRuntime {
    supervisor: NativeSourceSupervisor,
    candidate_window_ingress: Option<CandidateWindowUtilityIngress>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct OpenBaselineRequest {
    collection_session_id: String,
    queue_capacity: u16,
    selected_sources: Vec<String>,
    selected_source_categories: Vec<NativeSourceCategory>,
    initial_candidate_window: CandidateWindowState,
}

#[derive(Serialize)]
struct BridgeManifest {
    bridge_version: u16,
    source_manifest: [NativeSourceManifestEntry; NATIVE_SOURCE_COUNT],
}

#[derive(Serialize)]
struct OpenBaselineResult {
    snapshots: Vec<WireSnapshot>,
}

#[derive(Serialize)]
struct WirePoll {
    state: &'static str,
    opened_snapshots: Vec<WireSnapshot>,
    final_snapshots: Vec<WireSnapshot>,
    batches: Vec<WireBatch>,
    transitions: Vec<WireTransition>,
}

#[derive(Serialize)]
struct WireStop {
    state: &'static str,
    final_snapshots: Vec<WireSnapshot>,
    batches: Vec<WireBatch>,
    process_replacement_required: bool,
}

#[derive(Serialize)]
#[serde(tag = "source", content = "snapshot", rename_all = "kebab-case")]
enum WireSnapshot {
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

#[derive(Serialize)]
#[serde(tag = "source", content = "batch", rename_all = "kebab-case")]
enum WireBatch {
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

#[derive(Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
enum WireTransition {
    RestartScheduled {
        source: &'static str,
        previous_source_instance_id: String,
        next_attempt: u8,
        retry_after_ms: u32,
        failure: SourceFailureCode,
    },
    Restarted {
        source: &'static str,
        previous_source_instance_id: String,
        new_source_instance_id: String,
        attempt: u8,
    },
    RestartAttemptFailed {
        source: &'static str,
        attempt: u8,
        retry_after_ms: u32,
        failure: SourceFailureCode,
    },
    RestartExhausted {
        source: &'static str,
        attempts: u8,
        failure: SourceFailureCode,
    },
    ProcessReplacementRequired {
        source: &'static str,
        failure: SourceFailureCode,
    },
}

#[napi(js_name = "manifest")]
/// Returns the fixed native bridge manifest.
///
/// # Errors
///
/// Returns a bounded Node-API error when the manifest cannot be converted.
pub fn manifest<'env>(env: Env) -> Result<Unknown<'env>> {
    to_js(
        env,
        &BridgeManifest {
            bridge_version: BRIDGE_VERSION,
            source_manifest: NATIVE_SOURCE_MANIFEST,
        },
    )
}

#[napi(js_name = "openBaseline")]
/// Opens the exact generated native-source baseline once in this utility process.
///
/// # Errors
///
/// Returns a bounded Node-API error for malformed configuration, duplicate
/// opening, source startup failure, or output conversion failure.
pub fn open_baseline(env: Env, request: Unknown<'_>) -> Result<Unknown<'_>> {
    let request: OpenBaselineRequest = env
        .from_js_value(request)
        .map_err(|_error| invalid_argument("invalid baseline-open request"))?;
    request
        .initial_candidate_window
        .validate_protocol()
        .map_err(|_error| invalid_argument("invalid initial CandidateWindow state"))?;
    let selected_sources = parse_selected_sources(&request.selected_sources)?;
    let selected_categories =
        parse_selected_categories(&selected_sources, &request.selected_source_categories)?;
    let config = SupervisorConfig::new(
        request.collection_session_id,
        request.queue_capacity,
        RestartPolicy::default(),
    )
    .map_err(|_error| invalid_argument("invalid baseline supervisor configuration"))?;
    let (ingress, receiver) = candidate_window_utility_ingress(request.queue_capacity)
        .map_err(|_error| invalid_argument("invalid CandidateWindow ingress capacity"))?;

    let opened = RUNTIME.with(|slot| {
        let mut slot = slot.borrow_mut();
        if slot.is_some() {
            return Err(invalid_state("baseline supervisor is already open"));
        }
        let factories = baseline_factories(
            receiver,
            request.initial_candidate_window,
            selected_categories,
        )
        .select_sources(&selected_sources)
        .map_err(|_error| invalid_argument("invalid native source selection"))?;
        let opened = NativeSourceSupervisor::open(config, factories)
            .map_err(|_error| Error::new(Status::GenericFailure, "native baseline open failed"))?;
        let snapshots = opened
            .snapshots
            .sources
            .into_iter()
            .map(WireSnapshot::from)
            .collect();
        *slot = Some(BridgeRuntime {
            supervisor: opened.supervisor,
            candidate_window_ingress: selected_sources
                .contains(&NativeSourceKind::CandidateWindow)
                .then_some(ingress),
        });
        Ok(OpenBaselineResult { snapshots })
    })?;
    to_js(env, &opened)
}

#[napi(js_name = "candidateWindowEvent")]
/// Enqueues one already-authenticated `CandidateWindow` mechanical event.
///
/// # Errors
///
/// Returns a bounded Node-API error when no baseline is open or the event is
/// malformed.
pub fn candidate_window_event(env: Env, event: Unknown<'_>) -> Result<String> {
    let event: CandidateWindowHostEvent = env
        .from_js_value(event)
        .map_err(|_error| invalid_argument("invalid CandidateWindow host event"))?;
    RUNTIME.with(|slot| {
        let slot = slot.borrow();
        let runtime = slot
            .as_ref()
            .ok_or_else(|| invalid_state("baseline supervisor is not open"))?;
        let outcome = runtime
            .candidate_window_ingress
            .as_ref()
            .ok_or_else(|| invalid_state("CandidateWindow source is not selected"))?
            .try_send(event)
            .map_err(|_error| invalid_argument("invalid CandidateWindow host event"))?;
        Ok(match outcome {
            CandidateWindowUtilityIngressOutcome::Accepted => "accepted",
            CandidateWindowUtilityIngressOutcome::Dropped => "dropped",
            CandidateWindowUtilityIngressOutcome::Stopped => "stopped",
        }
        .to_owned())
    })
}

#[napi(js_name = "candidateWindowEventsLost")]
/// Records an exact count of `CandidateWindow` events discarded by the bounded
/// Electron-main ingress before they reached the native queue.
///
/// # Errors
///
/// Returns a bounded Node-API error when no baseline is open, the count is
/// zero, or the native ingress sequence cannot advance.
pub fn candidate_window_events_lost(lost_count: u32) -> Result<String> {
    if lost_count == 0 {
        return Err(invalid_argument(
            "CandidateWindow lost-event count must be positive",
        ));
    }
    RUNTIME.with(|slot| {
        let slot = slot.borrow();
        let runtime = slot
            .as_ref()
            .ok_or_else(|| invalid_state("baseline supervisor is not open"))?;
        let outcome = runtime
            .candidate_window_ingress
            .as_ref()
            .ok_or_else(|| invalid_state("CandidateWindow source is not selected"))?
            .record_lost_events(lost_count)
            .map_err(|_error| invalid_state("CandidateWindow ingress sequence cannot advance"))?;
        Ok(match outcome {
            CandidateWindowUtilityIngressOutcome::Accepted => "accepted",
            CandidateWindowUtilityIngressOutcome::Dropped => "dropped",
            CandidateWindowUtilityIngressOutcome::Stopped => "stopped",
        }
        .to_owned())
    })
}

#[napi(js_name = "pollBaseline")]
/// Drains one bounded nonblocking supervisor poll.
///
/// # Errors
///
/// Returns a bounded Node-API error when no baseline is open or the result
/// cannot be converted.
pub fn poll_baseline<'env>(env: Env) -> Result<Unknown<'env>> {
    let poll = RUNTIME.with(|slot| {
        let mut slot = slot.borrow_mut();
        let runtime = slot
            .as_mut()
            .ok_or_else(|| invalid_state("baseline supervisor is not open"))?;
        Ok::<WirePoll, Error>(WirePoll::from(runtime.supervisor.poll()))
    })?;
    to_js(env, &poll)
}

#[napi(js_name = "stopBaseline")]
/// Fences `CandidateWindow` input and stops the baseline in reverse order.
///
/// # Errors
///
/// Returns a bounded Node-API error for an invalid final state, a missing open
/// baseline, a failed input fence, or output conversion failure.
pub fn stop_baseline(env: Env, final_candidate_window: Unknown<'_>) -> Result<Unknown<'_>> {
    let final_candidate_window: CandidateWindowState = env
        .from_js_value(final_candidate_window)
        .map_err(|_error| invalid_argument("invalid final CandidateWindow state"))?;
    final_candidate_window
        .validate_protocol()
        .map_err(|_error| invalid_argument("invalid final CandidateWindow state"))?;
    let stopped = RUNTIME.with(|slot| {
        let mut slot = slot.borrow_mut();
        let runtime = slot
            .as_mut()
            .ok_or_else(|| invalid_state("baseline supervisor is not open"))?;
        if let Some(ingress) = &runtime.candidate_window_ingress {
            ingress
                .fence_with_final_state(final_candidate_window)
                .map_err(|_error| {
                    Error::new(Status::GenericFailure, "CandidateWindow input fence failed")
                })?;
        }
        let stopped = WireStop::from(runtime.supervisor.stop());
        *slot = None;
        Ok::<WireStop, Error>(stopped)
    })?;
    to_js(env, &stopped)
}

fn parse_selected_sources(source_ids: &[String]) -> Result<Vec<NativeSourceKind>> {
    if source_ids.is_empty() || source_ids.len() > NATIVE_SOURCE_COUNT {
        return Err(invalid_argument("invalid native source selection"));
    }
    let mut selected = Vec::with_capacity(source_ids.len());
    let mut previous_manifest_index = None;
    for source_id in source_ids {
        let kind = NativeSourceKind::from_source_id(source_id)
            .ok_or_else(|| invalid_argument("unknown native source selection"))?;
        if selected.contains(&kind) {
            return Err(invalid_argument("duplicate native source selection"));
        }
        let manifest_index = NATIVE_SOURCE_KINDS
            .iter()
            .position(|candidate| *candidate == kind)
            .ok_or_else(|| invalid_argument("native source is outside the manifest"))?;
        if previous_manifest_index.is_some_and(|previous| previous >= manifest_index) {
            return Err(invalid_argument(
                "native source selection is outside manifest order",
            ));
        }
        previous_manifest_index = Some(manifest_index);
        selected.push(kind);
    }
    Ok(selected)
}

#[derive(Clone, Copy)]
struct SelectedSourceCategories {
    media: Option<MediaDeviceSelection>,
    removable_storage: Option<RemovableStorageSelection>,
    network_configuration: Option<NetworkConfigurationSelection>,
}

fn parse_selected_categories(
    selected_sources: &[NativeSourceKind],
    categories: &[NativeSourceCategory],
) -> Result<SelectedSourceCategories> {
    if categories.len() > NATIVE_SOURCE_CATEGORY_ORDER.len()
        || !categories.iter().copied().eq(NATIVE_SOURCE_CATEGORY_ORDER
            .into_iter()
            .filter(|category| categories.contains(category)))
    {
        return Err(invalid_argument("invalid native source category selection"));
    }
    let clipboard_selected = selected_sources.contains(&NativeSourceKind::Clipboard);
    let clipboard_category = categories.contains(&NativeSourceCategory::OsClipboardChange);
    if clipboard_selected != clipboard_category {
        return Err(invalid_argument(
            "clipboard source/category selection mismatch",
        ));
    }
    let removable_block_storage = categories.contains(&NativeSourceCategory::RemovableBlockStorage);
    let portable_mtp = categories.contains(&NativeSourceCategory::PortableMtp);
    let removable_storage = RemovableStorageSelection::new(removable_block_storage, portable_mtp);
    if selected_sources.contains(&NativeSourceKind::RemovableStorage) != removable_storage.is_some()
    {
        return Err(invalid_argument(
            "removable-storage source/category selection mismatch",
        ));
    }
    let mut network_categories = Vec::with_capacity(5);
    for (wire_category, category) in [
        (
            NativeSourceCategory::SystemProxyState,
            NetworkConfigurationCategory::SystemProxyState,
        ),
        (
            NativeSourceCategory::OsManagedVpnState,
            NetworkConfigurationCategory::OsManagedVpnState,
        ),
        (
            NativeSourceCategory::TunnelInterfaceState,
            NetworkConfigurationCategory::TunnelInterfaceState,
        ),
        (
            NativeSourceCategory::RouteChange,
            NetworkConfigurationCategory::RouteChange,
        ),
        (
            NativeSourceCategory::NetworkSourceHealth,
            NetworkConfigurationCategory::NetworkSourceHealth,
        ),
    ] {
        if categories.contains(&wire_category) {
            network_categories.push(category);
        }
    }
    let network_configuration = NetworkConfigurationSelection::new(&network_categories);
    if selected_sources.contains(&NativeSourceKind::NetworkConfiguration)
        != network_configuration.is_some()
    {
        return Err(invalid_argument(
            "network-configuration source/category selection mismatch",
        ));
    }
    let camera = categories.contains(&NativeSourceCategory::Camera);
    let microphone = categories.contains(&NativeSourceCategory::Microphone);
    let media_selected = selected_sources.contains(&NativeSourceKind::MediaDevice);
    if media_selected != (camera || microphone) {
        return Err(invalid_argument("media source/category selection mismatch"));
    }
    let media = MediaDeviceSelection::new(camera, microphone);
    Ok(SelectedSourceCategories {
        media,
        removable_storage,
        network_configuration,
    })
}

fn baseline_factories(
    receiver: CandidateWindowUtilityReceiver,
    initial_candidate_window: CandidateWindowState,
    selected_categories: SelectedSourceCategories,
) -> BaselineSourceFactories {
    let mut candidate_receiver = Some(receiver);
    let factories = BaselineSourceFactories::new(
        display_topology_factory(|| Ok(PlatformDisplayTopologyBackend)),
        candidate_window_factory(move || {
            candidate_receiver.take().map_or_else(
                || {
                    Err(CandidateWindowError::Backend(
                        "utility-local CandidateWindow ingress requires process replacement"
                            .to_owned(),
                    ))
                },
                |receiver| {
                    Ok(PlatformCandidateWindowBackend::new(
                        initial_candidate_window.clone(),
                        receiver,
                    ))
                },
            )
        }),
        capture_session_factory(|| Ok(PlatformCaptureSessionBackend)),
        process_application_factory(|| Ok(PlatformProcessApplicationBackend)),
    )
    .with_passive_source(passive_state_factory::<InteractiveSessionWire, _, _>(
        || Ok(PlatformInteractiveSessionBackend),
    ))
    .with_passive_source(passive_state_factory::<ClipboardWire, _, _>(|| {
        Ok(PlatformClipboardBackend)
    }))
    .with_passive_source(passive_state_factory::<PrintSpoolerWire, _, _>(|| {
        Ok(PlatformPrintSpoolerBackend)
    }))
    .with_passive_source(passive_state_factory::<RemovableStorageWire, _, _>(
        move || {
            selected_categories.removable_storage.map_or_else(
                || {
                    Err(RemovableStorageError::Backend(
                        "removable-storage source has no selected category".to_owned(),
                    ))
                },
                |selection| Ok(PlatformRemovableStorageBackend::new(selection)),
            )
        },
    ))
    .with_passive_source(passive_state_factory::<VirtualizationWire, _, _>(|| {
        Ok(PlatformVirtualizationBackend)
    }))
    .with_passive_source(passive_state_factory::<NetworkConfigurationWire, _, _>(
        move || {
            selected_categories.network_configuration.map_or_else(
                || {
                    Err(NetworkConfigurationError::Backend(
                        "network-configuration source has no selected category".to_owned(),
                    ))
                },
                |selection| Ok(PlatformNetworkConfigurationBackend::new(selection)),
            )
        },
    ))
    .with_passive_source(passive_state_factory::<MediaDeviceWire, _, _>(move || {
        selected_categories.media.map_or_else(
            || {
                Err(MediaDeviceError::Backend(
                    "media-device source has no selected category".to_owned(),
                ))
            },
            |selection| Ok(PlatformMediaDeviceBackend::new(selection)),
        )
    }));
    #[cfg(target_os = "macos")]
    let factories = with_packaged_macos_helper(factories);
    factories
}

#[cfg(target_os = "macos")]
fn with_packaged_macos_helper(factories: BaselineSourceFactories) -> BaselineSourceFactories {
    use native_protocol::{HelperSourceKind, PlatformFamily};
    use native_security_helper::{
        HELPER_BUILD_ID, MacOsServiceConnectionConfiguration, NativeHelperConnection,
    };
    let Some(requirement) = option_env!("NATIVE_SERVICE_REQUIREMENT") else {
        return factories;
    };
    // A configured package never falls back after peer or lifecycle failure.
    factories.with_helper_sources(PlatformFamily::Macos, HELPER_BUILD_ID, move || {
        NativeHelperConnection::connect_macos_service(MacOsServiceConnectionConfiguration {
            service_designated_requirement: requirement.to_owned(),
            expected_helper_build_id: HELPER_BUILD_ID.to_owned(),
            expected_capabilities: vec![
                HelperSourceKind::ProcessApplication,
                HelperSourceKind::InteractiveSession,
            ],
        })
    })
}

impl From<SupervisorPoll> for WirePoll {
    fn from(value: SupervisorPoll) -> Self {
        Self {
            state: supervisor_state(value.state),
            opened_snapshots: value
                .opened_snapshots
                .into_iter()
                .map(WireSnapshot::from)
                .collect(),
            final_snapshots: value
                .final_snapshots
                .into_iter()
                .map(WireSnapshot::from)
                .collect(),
            batches: value.batches.into_iter().map(WireBatch::from).collect(),
            transitions: value
                .transitions
                .into_iter()
                .map(WireTransition::from)
                .collect(),
        }
    }
}

impl From<SupervisorStop> for WireStop {
    fn from(value: SupervisorStop) -> Self {
        Self {
            state: supervisor_state(value.state),
            final_snapshots: value
                .final_snapshots
                .into_iter()
                .map(WireSnapshot::from)
                .collect(),
            batches: value.batches.into_iter().map(WireBatch::from).collect(),
            process_replacement_required: value.process_replacement_required,
        }
    }
}

impl From<NativeSourceSnapshot> for WireSnapshot {
    fn from(value: NativeSourceSnapshot) -> Self {
        match value {
            NativeSourceSnapshot::DisplayTopology(snapshot) => Self::DisplayTopology(snapshot),
            NativeSourceSnapshot::CandidateWindow(snapshot) => Self::CandidateWindow(snapshot),
            NativeSourceSnapshot::CaptureSession(snapshot) => Self::CaptureSession(snapshot),
            NativeSourceSnapshot::ProcessApplication(snapshot) => {
                Self::ProcessApplication(snapshot)
            }
            NativeSourceSnapshot::InteractiveSession(snapshot) => {
                Self::InteractiveSession(snapshot)
            }
            NativeSourceSnapshot::Clipboard(snapshot) => Self::Clipboard(snapshot),
            NativeSourceSnapshot::PrintSpooler(snapshot) => Self::PrintSpooler(snapshot),
            NativeSourceSnapshot::RemovableStorage(snapshot) => Self::RemovableStorage(snapshot),
            NativeSourceSnapshot::Virtualization(snapshot) => Self::Virtualization(snapshot),
            NativeSourceSnapshot::NetworkConfiguration(snapshot) => {
                Self::NetworkConfiguration(snapshot)
            }
            NativeSourceSnapshot::MediaDevice(snapshot) => Self::MediaDevice(snapshot),
        }
    }
}

impl From<NativeSourceBatch> for WireBatch {
    fn from(value: NativeSourceBatch) -> Self {
        match value {
            NativeSourceBatch::DisplayTopology(batch) => Self::DisplayTopology(batch),
            NativeSourceBatch::CandidateWindow(batch) => Self::CandidateWindow(batch),
            NativeSourceBatch::CaptureSession(batch) => Self::CaptureSession(batch),
            NativeSourceBatch::ProcessApplication(batch) => Self::ProcessApplication(batch),
            NativeSourceBatch::InteractiveSession(batch) => Self::InteractiveSession(batch),
            NativeSourceBatch::Clipboard(batch) => Self::Clipboard(batch),
            NativeSourceBatch::PrintSpooler(batch) => Self::PrintSpooler(batch),
            NativeSourceBatch::RemovableStorage(batch) => Self::RemovableStorage(batch),
            NativeSourceBatch::Virtualization(batch) => Self::Virtualization(batch),
            NativeSourceBatch::NetworkConfiguration(batch) => Self::NetworkConfiguration(batch),
            NativeSourceBatch::MediaDevice(batch) => Self::MediaDevice(batch),
        }
    }
}

impl From<SourceLifecycleTransition> for WireTransition {
    fn from(value: SourceLifecycleTransition) -> Self {
        match value {
            SourceLifecycleTransition::RestartScheduled {
                source,
                previous_source_instance_id,
                next_attempt,
                retry_after,
                failure,
            } => Self::RestartScheduled {
                source: source_name(source),
                previous_source_instance_id,
                next_attempt,
                retry_after_ms: duration_millis(retry_after),
                failure,
            },
            SourceLifecycleTransition::Restarted {
                source,
                previous_source_instance_id,
                new_source_instance_id,
                attempt,
            } => Self::Restarted {
                source: source_name(source),
                previous_source_instance_id,
                new_source_instance_id,
                attempt,
            },
            SourceLifecycleTransition::RestartAttemptFailed {
                source,
                attempt,
                retry_after,
                failure,
            } => Self::RestartAttemptFailed {
                source: source_name(source),
                attempt,
                retry_after_ms: duration_millis(retry_after),
                failure,
            },
            SourceLifecycleTransition::RestartExhausted {
                source,
                attempts,
                failure,
            } => Self::RestartExhausted {
                source: source_name(source),
                attempts,
                failure,
            },
            SourceLifecycleTransition::ProcessReplacementRequired { source, failure } => {
                Self::ProcessReplacementRequired {
                    source: source_name(source),
                    failure,
                }
            }
        }
    }
}

fn supervisor_state(state: SupervisorState) -> &'static str {
    match state {
        SupervisorState::Healthy => "healthy",
        SupervisorState::Degraded => "degraded",
        SupervisorState::Recovering => "recovering",
        SupervisorState::Failed => "failed",
        SupervisorState::Stopped => "stopped",
    }
}

fn source_name(source: NativeSourceKind) -> &'static str {
    match source {
        NativeSourceKind::DisplayTopology => "display-topology",
        NativeSourceKind::CandidateWindow => "candidate-window",
        NativeSourceKind::CaptureSession => "capture-session",
        NativeSourceKind::ProcessApplication => "process-application",
        NativeSourceKind::InteractiveSession => "interactive-session",
        NativeSourceKind::Clipboard => "clipboard",
        NativeSourceKind::PrintSpooler => "print-spooler",
        NativeSourceKind::RemovableStorage => "removable-storage",
        NativeSourceKind::Virtualization => "virtualization",
        NativeSourceKind::NetworkConfiguration => "network-configuration",
        NativeSourceKind::MediaDevice => "media-device",
    }
}

fn duration_millis(duration: Duration) -> u32 {
    u32::try_from(duration.as_millis()).unwrap_or(u32::MAX)
}

fn to_js<'env, T: Serialize>(env: Env, value: &T) -> Result<Unknown<'env>> {
    env.to_js_value(value)
        .map_err(|_error| Error::new(Status::GenericFailure, "native bridge serialization failed"))
}

fn invalid_argument(reason: &'static str) -> Error {
    Error::new(Status::InvalidArg, reason)
}

fn invalid_state(reason: &'static str) -> Error {
    Error::new(Status::GenericFailure, reason)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde::de::value::{Error as ValueError, MapDeserializer};

    #[test]
    fn baseline_request_rejects_unknown_privileged_fields() {
        let fields = [("unexpected_authority", true)];
        let deserializer = MapDeserializer::<_, ValueError>::new(fields.into_iter());

        let Err(error) = OpenBaselineRequest::deserialize(deserializer) else {
            panic!("unknown privileged request fields must be rejected");
        };
        assert!(error.to_string().contains("unknown field"));
    }

    #[test]
    fn category_parser_preserves_each_independent_native_selection() {
        let sources = [
            NativeSourceKind::Clipboard,
            NativeSourceKind::RemovableStorage,
            NativeSourceKind::NetworkConfiguration,
            NativeSourceKind::MediaDevice,
        ];
        let categories = [
            NativeSourceCategory::OsClipboardChange,
            NativeSourceCategory::PortableMtp,
            NativeSourceCategory::RouteChange,
            NativeSourceCategory::NetworkSourceHealth,
            NativeSourceCategory::Microphone,
        ];

        let parsed = parse_selected_categories(&sources, &categories).expect("valid selection");

        assert_eq!(
            parsed.removable_storage,
            RemovableStorageSelection::new(false, true)
        );
        assert_eq!(
            parsed.network_configuration,
            NetworkConfigurationSelection::new(&[
                NetworkConfigurationCategory::RouteChange,
                NetworkConfigurationCategory::NetworkSourceHealth,
            ])
        );
        assert_eq!(parsed.media, MediaDeviceSelection::new(false, true));
    }

    #[test]
    fn category_parser_rejects_a_selected_source_without_categories() {
        assert!(parse_selected_categories(&[NativeSourceKind::RemovableStorage], &[]).is_err());
        assert!(parse_selected_categories(&[NativeSourceKind::NetworkConfiguration], &[]).is_err());
        assert!(parse_selected_categories(&[NativeSourceKind::MediaDevice], &[]).is_err());
    }

    #[test]
    fn source_parser_rejects_valid_sources_outside_manifest_order() {
        assert!(
            parse_selected_sources(&["clipboard".to_owned(), "display-topology".to_owned(),])
                .is_err()
        );
    }
}
