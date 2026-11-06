#![deny(unsafe_code)]

mod platform;
use native_protocol::{
    MediaConcurrentUse, MediaDeviceCertainty, MediaDeviceCoverage, MediaDeviceDrain,
    MediaDeviceEvent, MediaDeviceEventKind, MediaDeviceObservation, MediaDeviceSourceSnapshot,
    MediaDeviceState, MediaEndpointReadiness, MediaEndpointState, PermissionState, SourceHealth,
};
use native_source_runtime::PassiveStateWire;
pub use native_source_runtime::{
    OpenedPassiveStateBackend as OpenedMediaDeviceBackend,
    PassiveStateBackend as MediaDeviceBackend, PassiveStateEmitter as MediaDeviceEmitter,
    PassiveStateSource as MediaDeviceSource, PassiveStateSourceError as MediaDeviceError,
    PassiveStateSubscription as MediaDeviceSubscription,
    UnavailablePassiveStateSubscription as UnavailableMediaDeviceSubscription,
};
pub use platform::PlatformMediaDeviceBackend;

pub struct MediaDeviceWire;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct MediaDeviceSelection {
    camera: bool,
    microphone: bool,
}

impl MediaDeviceSelection {
    #[must_use]
    pub const fn new(camera: bool, microphone: bool) -> Option<Self> {
        if camera || microphone {
            Some(Self { camera, microphone })
        } else {
            None
        }
    }

    #[must_use]
    pub const fn all() -> Self {
        Self {
            camera: true,
            microphone: true,
        }
    }

    #[must_use]
    pub const fn includes_camera(self) -> bool {
        self.camera
    }

    #[must_use]
    pub const fn includes_microphone(self) -> bool {
        self.microphone
    }
}

impl PassiveStateWire for MediaDeviceWire {
    type State = MediaDeviceState;
    type Event = MediaDeviceEvent;
    type Snapshot = MediaDeviceSourceSnapshot;
    type Observation = MediaDeviceObservation;
    type Drain = MediaDeviceDrain;
    const SOURCE_VERSION: &'static str = env!("CARGO_PKG_VERSION");
    const STOP_THREAD_NAME: &'static str = "media-device-stop";
    fn health(state: &Self::State) -> SourceHealth {
        if endpoint_healthy(&state.camera) && endpoint_healthy(&state.microphone) {
            SourceHealth::Healthy
        } else {
            SourceHealth::Degraded
        }
    }
    fn unavailable_state() -> Self::State {
        MediaDeviceState {
            camera: unavailable_endpoint(),
            microphone: unavailable_endpoint(),
        }
    }
    native_source_runtime::passive_state_constructors! {
        event: MediaDeviceEvent,
        event_kind: MediaDeviceEventKind,
        snapshot: MediaDeviceSourceSnapshot,
        observation: MediaDeviceObservation,
        drain: MediaDeviceDrain,
        permission: |state, _| aggregate_permission(state),
    }
}

fn endpoint_healthy(state: &MediaEndpointState) -> bool {
    matches!(state.coverage, MediaDeviceCoverage::NotCollected)
        || (!matches!(state.coverage, MediaDeviceCoverage::Unavailable)
            && matches!(state.certainty, MediaDeviceCertainty::Complete))
}

fn aggregate_permission(state: &MediaDeviceState) -> PermissionState {
    let permissions = [&state.camera, &state.microphone]
        .into_iter()
        .filter(|endpoint| !matches!(endpoint.coverage, MediaDeviceCoverage::NotCollected))
        .map(|endpoint| endpoint.permission)
        .collect::<Vec<_>>();
    if permissions.contains(&PermissionState::Denied) {
        PermissionState::Denied
    } else if permissions.contains(&PermissionState::Restricted) {
        PermissionState::Restricted
    } else if permissions.contains(&PermissionState::NotDetermined) {
        PermissionState::NotDetermined
    } else if permissions.contains(&PermissionState::Unavailable) || permissions.is_empty() {
        PermissionState::Unavailable
    } else {
        PermissionState::Granted
    }
}

pub(crate) fn unavailable_endpoint() -> MediaEndpointState {
    MediaEndpointState {
        coverage: MediaDeviceCoverage::Unavailable,
        certainty: MediaDeviceCertainty::Unknown,
        permission: PermissionState::Unavailable,
        readiness: MediaEndpointReadiness::Unknown,
        endpoint_count: 0,
        other_application_use: MediaConcurrentUse::Unknown,
    }
}

pub(crate) const fn not_collected_endpoint() -> MediaEndpointState {
    MediaEndpointState {
        coverage: MediaDeviceCoverage::NotCollected,
        certainty: MediaDeviceCertainty::Unknown,
        permission: PermissionState::NotDetermined,
        readiness: MediaEndpointReadiness::Unknown,
        endpoint_count: 0,
        other_application_use: MediaConcurrentUse::Unknown,
    }
}

pub(crate) fn selected_unavailable_state(selection: MediaDeviceSelection) -> MediaDeviceState {
    MediaDeviceState {
        camera: if selection.includes_camera() {
            unavailable_endpoint()
        } else {
            not_collected_endpoint()
        },
        microphone: if selection.includes_microphone() {
            unavailable_endpoint()
        } else {
            not_collected_endpoint()
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use native_protocol::SourceOpenRequest;

    #[test]
    fn platform_boundary_reports_a_coherent_bounded_snapshot() {
        let request = SourceOpenRequest {
            collection_session_id: "media-device-session-0001".to_owned(),
            queue_capacity: 8,
        };
        let mut source = MediaDeviceSource::<MediaDeviceWire, _>::open(
            &request,
            PlatformMediaDeviceBackend::new(MediaDeviceSelection::all()),
        )
        .expect("source opens");
        assert_eq!(source.snapshot().health, SourceHealth::Degraded);
        assert!(source.snapshot().state.camera.endpoint_count <= 16);
        assert!(source.snapshot().state.microphone.endpoint_count <= 16);
        assert_eq!(source.stop().health, SourceHealth::Stopped);
    }

    #[test]
    fn aggregate_permission_never_hides_a_selected_endpoint_denial() {
        let mut state = MediaDeviceWire::unavailable_state();
        state.camera.permission = PermissionState::Granted;
        state.camera.coverage = MediaDeviceCoverage::ReadinessOnly;
        state.microphone.permission = PermissionState::Denied;
        state.microphone.coverage = MediaDeviceCoverage::ReadinessOnly;
        assert_eq!(aggregate_permission(&state), PermissionState::Denied);
    }

    #[test]
    fn aggregate_permission_ignores_an_unselected_endpoint() {
        let mut state = MediaDeviceWire::unavailable_state();
        state.camera.permission = PermissionState::Granted;
        state.camera.coverage = MediaDeviceCoverage::ReadinessOnly;
        state.microphone = not_collected_endpoint();
        assert_eq!(aggregate_permission(&state), PermissionState::Granted);
    }
}
