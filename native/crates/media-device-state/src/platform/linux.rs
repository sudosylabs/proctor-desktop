use std::fs;
use std::path::Path;
use std::time::Duration;

use crate::{
    MediaDeviceSelection, MediaDeviceWire, not_collected_endpoint, selected_unavailable_state,
    unavailable_endpoint,
};
use native_protocol::{
    MediaConcurrentUse, MediaDeviceCertainty, MediaDeviceCoverage, MediaDeviceState,
    MediaEndpointReadiness, MediaEndpointState, PermissionState, PlatformFamily,
    ProtocolValidationError, ProtocolViolation,
};
use native_source_runtime::{
    InitialFallbackPollingSubscription, OpenedPassiveStateBackend, PassiveStateBackend,
    PassiveStateEmitter, PassiveStateSourceError, PollingPassiveStateBackend,
};

const SOUND_ROOT: &str = "/sys/class/sound";
const MAX_ENDPOINTS: usize = 16;

pub struct PlatformMediaDeviceBackend {
    selection: MediaDeviceSelection,
}

impl PlatformMediaDeviceBackend {
    #[must_use]
    pub const fn new(selection: MediaDeviceSelection) -> Self {
        Self { selection }
    }
}

impl PassiveStateBackend<MediaDeviceWire> for PlatformMediaDeviceBackend {
    type Subscription = InitialFallbackPollingSubscription<MediaDeviceWire>;

    fn open(
        self,
        emitter: PassiveStateEmitter<MediaDeviceWire>,
    ) -> Result<
        OpenedPassiveStateBackend<MediaDeviceWire, Self::Subscription>,
        PassiveStateSourceError,
    > {
        let selection = self.selection;
        PollingPassiveStateBackend::new(
            PlatformFamily::Linux,
            PermissionState::Granted,
            "linux-microphone-endpoint-presence-v1",
            Duration::from_millis(500),
            move || query_state(selection, Path::new(SOUND_ROOT)),
        )
        .open_with_initial_backend_fallback(
            emitter,
            "linux-selected-media-endpoints-unavailable-v1",
            selected_unavailable_state(selection),
        )
    }
}

fn query_state(
    selection: MediaDeviceSelection,
    sound_root: &Path,
) -> Result<MediaDeviceState, PassiveStateSourceError> {
    Ok(MediaDeviceState {
        camera: if selection.includes_camera() {
            // A video4linux node may be output-only, metadata-only, or a radio
            // endpoint. Until a bounded V4L2 capability query exists, do not
            // turn node presence into a false camera fact.
            unavailable_endpoint()
        } else {
            not_collected_endpoint()
        },
        microphone: if selection.includes_microphone() {
            presence_endpoint(count_entries(sound_root, |name| {
                name.starts_with("pcmC") && name.ends_with('c')
            })?)
        } else {
            not_collected_endpoint()
        },
    })
}

fn count_entries(
    path: &Path,
    include: impl Fn(&str) -> bool,
) -> Result<u8, PassiveStateSourceError> {
    let entries = match fs::read_dir(path) {
        Ok(entries) => entries,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(0),
        Err(error) => {
            return Err(PassiveStateSourceError::Backend(format!(
                "cannot inspect Linux media endpoint inventory: {error}"
            )));
        }
    };
    let mut count = 0_usize;
    for entry in entries {
        let entry = entry.map_err(|error| {
            PassiveStateSourceError::Backend(format!(
                "cannot inspect one Linux media endpoint: {error}"
            ))
        })?;
        let name = entry.file_name().into_string().map_err(|_name| {
            PassiveStateSourceError::Protocol(ProtocolViolation::Schema(ProtocolValidationError {
                type_name: "LinuxMediaDeviceAdapter",
                field: "endpoint_name",
                rule: "valid UTF-8 sysfs endpoint identifier",
            }))
        })?;
        if include(&name) {
            count += 1;
            if count > MAX_ENDPOINTS {
                return Err(PassiveStateSourceError::InventoryOverflow(
                    "Linux media endpoint inventory exceeds the protocol bound".to_owned(),
                ));
            }
        }
    }
    u8::try_from(count).map_err(|_error| {
        PassiveStateSourceError::InventoryOverflow(
            "Linux media endpoint count exceeds the protocol bound".to_owned(),
        )
    })
}

const fn presence_endpoint(endpoint_count: u8) -> MediaEndpointState {
    MediaEndpointState {
        coverage: MediaDeviceCoverage::ReadinessOnly,
        certainty: MediaDeviceCertainty::Partial,
        permission: PermissionState::Unavailable,
        readiness: MediaEndpointReadiness::Unknown,
        endpoint_count,
        other_application_use: MediaConcurrentUse::Unknown,
    }
}

#[cfg(test)]
mod tests {
    use std::os::unix::ffi::OsStringExt;
    use std::time::{SystemTime, UNIX_EPOCH};

    use super::*;

    #[test]
    fn absent_linux_media_roots_are_a_known_empty_inventory() {
        let missing = Path::new("/definitely/not/a/proctor/media/root");
        let state =
            query_state(MediaDeviceSelection::all(), missing).expect("missing roots are empty");
        assert_eq!(state.camera.endpoint_count, 0);
        assert_eq!(state.microphone.endpoint_count, 0);
        assert_eq!(state.camera.coverage, MediaDeviceCoverage::Unavailable);
        assert_eq!(state.camera.readiness, MediaEndpointReadiness::Unknown);
    }

    #[test]
    fn disabled_media_category_is_not_queried() {
        let unreadable = Path::new("/proc/1/mem");
        let state = query_state(
            MediaDeviceSelection::new(true, false).expect("camera selection"),
            unreadable,
        )
        .expect("disabled microphone path is not queried");
        assert_eq!(state.microphone.coverage, MediaDeviceCoverage::NotCollected);
    }

    #[test]
    fn non_utf8_endpoint_name_is_a_terminal_protocol_result() {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("time after epoch")
            .as_nanos();
        let root = std::env::temp_dir().join(format!("prctr-media-non-utf8-{unique}"));
        fs::create_dir_all(&root).expect("create media fixture");
        let invalid = std::ffi::OsString::from_vec(vec![b'p', b'c', b'm', 0xff, b'c']);
        fs::write(root.join(invalid), []).expect("write invalid endpoint fixture");

        assert!(matches!(
            count_entries(&root, |_| true),
            Err(PassiveStateSourceError::Protocol(_))
        ));
        fs::remove_dir_all(root).expect("remove media fixture");
    }
}
