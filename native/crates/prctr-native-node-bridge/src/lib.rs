use std::cell::RefCell;
use std::time::Duration;

use napi::bindgen_prelude::Unknown;
use napi::{Env, Error, Result, Status};
use napi_derive::napi;
#[cfg(target_os = "linux")]
use prctr_candidate_window_state::LinuxCandidateWindowBackend as PlatformCandidateWindowBackend;
#[cfg(target_os = "macos")]
use prctr_candidate_window_state::MacOsCandidateWindowBackend as PlatformCandidateWindowBackend;
#[cfg(target_os = "windows")]
use prctr_candidate_window_state::WindowsCandidateWindowBackend as PlatformCandidateWindowBackend;
use prctr_candidate_window_state::{
    CandidateWindowError, CandidateWindowUtilityIngress, CandidateWindowUtilityIngressOutcome,
    CandidateWindowUtilityReceiver, candidate_window_utility_ingress,
};
#[cfg(target_os = "linux")]
use prctr_capture_session_state::LinuxCaptureSessionBackend as PlatformCaptureSessionBackend;
#[cfg(target_os = "macos")]
use prctr_capture_session_state::MacOsCaptureSessionBackend as PlatformCaptureSessionBackend;
#[cfg(target_os = "windows")]
use prctr_capture_session_state::WindowsCaptureSessionBackend as PlatformCaptureSessionBackend;
#[cfg(target_os = "linux")]
use prctr_display_topology::LinuxDisplayTopologyBackend as PlatformDisplayTopologyBackend;
#[cfg(target_os = "macos")]
use prctr_display_topology::MacOsDisplayTopologyBackend as PlatformDisplayTopologyBackend;
#[cfg(target_os = "windows")]
use prctr_display_topology::WindowsDisplayTopologyBackend as PlatformDisplayTopologyBackend;
use prctr_native_protocol::{
    CandidateWindowDrain, CandidateWindowHostEvent, CandidateWindowSourceSnapshot,
    CandidateWindowState, CaptureSessionDrain, CaptureSessionSourceSnapshot, DisplayTopologyDrain,
    DisplayTopologySourceSnapshot, NATIVE_SOURCE_COUNT, NATIVE_SOURCE_MANIFEST,
    NATIVE_SOURCE_MANIFEST_VERSION, NativeSourceManifestEntry, ProtocolValidatable,
    SourceFailureCode,
};
use prctr_native_source_supervisor::{
    BaselineSourceFactories, BaselineSourceSnapshots, NativeSourceBatch, NativeSourceKind,
    NativeSourceSnapshot, NativeSourceSupervisor, RestartPolicy, SourceLifecycleTransition,
    SupervisorConfig, SupervisorPoll, SupervisorState, SupervisorStop, candidate_window_factory,
    capture_session_factory, display_topology_factory,
};
use serde::{Deserialize, Serialize};

const BRIDGE_VERSION: u16 = 1;

thread_local! {
    static RUNTIME: RefCell<Option<BridgeRuntime>> = const { RefCell::new(None) };
}

struct BridgeRuntime {
    supervisor: NativeSourceSupervisor,
    candidate_window_ingress: CandidateWindowUtilityIngress,
}

#[derive(Deserialize)]
struct OpenBaselineRequest {
    collection_session_id: String,
    queue_capacity: u16,
    initial_candidate_window: CandidateWindowState,
}

#[derive(Serialize)]
struct BridgeManifest {
    bridge_version: u16,
    source_manifest_version: u16,
    source_manifest: [NativeSourceManifestEntry; NATIVE_SOURCE_COUNT],
}

#[derive(Serialize)]
struct OpenBaselineResult {
    snapshots: WireBaselineSnapshots,
}

#[derive(Serialize)]
struct WireBaselineSnapshots {
    display_topology: DisplayTopologySourceSnapshot,
    candidate_window: CandidateWindowSourceSnapshot,
    capture_session: CaptureSessionSourceSnapshot,
}

#[derive(Serialize)]
struct WirePoll {
    state: &'static str,
    opened_snapshots: Vec<WireSnapshot>,
    batches: Vec<WireBatch>,
    transitions: Vec<WireTransition>,
}

#[derive(Serialize)]
struct WireStop {
    state: &'static str,
    batches: Vec<WireBatch>,
    process_replacement_required: bool,
}

#[derive(Serialize)]
#[serde(tag = "source", content = "snapshot", rename_all = "kebab-case")]
enum WireSnapshot {
    DisplayTopology(DisplayTopologySourceSnapshot),
    CandidateWindow(CandidateWindowSourceSnapshot),
    CaptureSession(CaptureSessionSourceSnapshot),
}

#[derive(Serialize)]
#[serde(tag = "source", content = "batch", rename_all = "kebab-case")]
enum WireBatch {
    DisplayTopology(DisplayTopologyDrain),
    CandidateWindow(CandidateWindowDrain),
    CaptureSession(CaptureSessionDrain),
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
            source_manifest_version: NATIVE_SOURCE_MANIFEST_VERSION,
            source_manifest: NATIVE_SOURCE_MANIFEST,
        },
    )
}

#[napi(js_name = "openBaseline")]
/// Opens the exact three-source baseline once in this utility process.
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
        let factories = baseline_factories(receiver, request.initial_candidate_window);
        let opened = NativeSourceSupervisor::open(config, factories)
            .map_err(|_error| Error::new(Status::GenericFailure, "native baseline open failed"))?;
        let snapshots = WireBaselineSnapshots::from(opened.snapshots);
        *slot = Some(BridgeRuntime {
            supervisor: opened.supervisor,
            candidate_window_ingress: ingress,
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
        runtime
            .candidate_window_ingress
            .fence_with_final_state(final_candidate_window)
            .map_err(|_error| {
                Error::new(Status::GenericFailure, "CandidateWindow input fence failed")
            })?;
        let stopped = WireStop::from(runtime.supervisor.stop());
        *slot = None;
        Ok::<WireStop, Error>(stopped)
    })?;
    to_js(env, &stopped)
}

fn baseline_factories(
    receiver: CandidateWindowUtilityReceiver,
    initial_candidate_window: CandidateWindowState,
) -> BaselineSourceFactories {
    let mut candidate_receiver = Some(receiver);
    BaselineSourceFactories::new(
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
    )
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
            batches: value.batches.into_iter().map(WireBatch::from).collect(),
            transitions: value
                .transitions
                .into_iter()
                .map(WireTransition::from)
                .collect(),
        }
    }
}

impl From<BaselineSourceSnapshots> for WireBaselineSnapshots {
    fn from(value: BaselineSourceSnapshots) -> Self {
        Self {
            display_topology: value.display_topology,
            candidate_window: value.candidate_window,
            capture_session: value.capture_session,
        }
    }
}

impl From<SupervisorStop> for WireStop {
    fn from(value: SupervisorStop) -> Self {
        Self {
            state: supervisor_state(value.state),
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
        }
    }
}

impl From<NativeSourceBatch> for WireBatch {
    fn from(value: NativeSourceBatch) -> Self {
        match value {
            NativeSourceBatch::DisplayTopology(batch) => Self::DisplayTopology(batch),
            NativeSourceBatch::CandidateWindow(batch) => Self::CandidateWindow(batch),
            NativeSourceBatch::CaptureSession(batch) => Self::CaptureSession(batch),
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
