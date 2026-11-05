use std::mem;
use std::ptr;
use std::time::Duration;

use crate::{
    MediaDeviceSelection, MediaDeviceWire, not_collected_endpoint, selected_unavailable_state,
};
use native_protocol::{
    MediaConcurrentUse, MediaDeviceCertainty, MediaDeviceCoverage, MediaDeviceState,
    MediaEndpointReadiness, MediaEndpointState, PermissionState, PlatformFamily,
};
use native_source_runtime::{
    InitialFallbackPollingSubscription, OpenedPassiveStateBackend, PassiveStateBackend,
    PassiveStateEmitter, PassiveStateSourceError, PollingPassiveStateBackend,
    poison_native_source_process, prefer_boundary_error,
};
use windows_sys::Win32::Devices::DeviceAndDriverInstallation::{
    DIGCF_DEVICEINTERFACE, DIGCF_PRESENT, HDEVINFO, SP_DEVICE_INTERFACE_DATA,
    SetupDiDestroyDeviceInfoList, SetupDiEnumDeviceInterfaces, SetupDiGetClassDevsW,
};
use windows_sys::Win32::Foundation::{ERROR_NO_MORE_ITEMS, GetLastError};
use windows_sys::Win32::Media::Audio::DEVINTERFACE_AUDIO_CAPTURE;
use windows_sys::Win32::Media::KernelStreaming::KSCATEGORY_VIDEO_CAMERA;
use windows_sys::core::GUID;

const MAX_ENDPOINTS: u32 = 16;
const INVALID_DEVICE_INFO_SET: HDEVINFO = -1_isize;

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
            PlatformFamily::Windows,
            PermissionState::Granted,
            "windows-media-endpoint-presence-v1",
            Duration::from_millis(500),
            move || query_state(selection),
        )
        .open_with_initial_backend_fallback(
            emitter,
            "windows-selected-media-endpoints-unavailable-v1",
            selected_unavailable_state(selection),
        )
    }
}

fn query_state(
    selection: MediaDeviceSelection,
) -> Result<MediaDeviceState, PassiveStateSourceError> {
    Ok(MediaDeviceState {
        camera: if selection.includes_camera() {
            presence_endpoint(count_present_interfaces(&KSCATEGORY_VIDEO_CAMERA)?)
        } else {
            not_collected_endpoint()
        },
        microphone: if selection.includes_microphone() {
            presence_endpoint(count_present_interfaces(&DEVINTERFACE_AUDIO_CAPTURE)?)
        } else {
            not_collected_endpoint()
        },
    })
}

fn count_present_interfaces(class: &GUID) -> Result<u8, PassiveStateSourceError> {
    // SAFETY: class points to an immutable static GUID and this query requests
    // present device interfaces only, without opening any media endpoint.
    let raw = unsafe {
        SetupDiGetClassDevsW(
            class,
            ptr::null(),
            ptr::null_mut(),
            DIGCF_PRESENT | DIGCF_DEVICEINTERFACE,
        )
    };
    if raw == INVALID_DEVICE_INFO_SET {
        return Err(PassiveStateSourceError::Backend(
            "Windows media endpoint inventory is unavailable".to_owned(),
        ));
    }
    let inventory = DeviceInventory::new(raw, destroy_device_inventory);
    let result = enumerate_present_interfaces(&inventory, class);
    let cleanup = inventory.close();
    match result {
        Ok(count) => cleanup.map(|()| count),
        Err(primary) => Err(prefer_boundary_error(primary, cleanup)),
    }
}

fn enumerate_present_interfaces(
    inventory: &DeviceInventory,
    class: &GUID,
) -> Result<u8, PassiveStateSourceError> {
    let mut count = 0_u32;
    loop {
        let mut interface = SP_DEVICE_INTERFACE_DATA {
            cbSize: u32::try_from(mem::size_of::<SP_DEVICE_INTERFACE_DATA>()).unwrap_or(u32::MAX),
            ..SP_DEVICE_INTERFACE_DATA::default()
        };
        // SAFETY: inventory is live, class is immutable, and interface has the
        // required cbSize for this process architecture.
        let success = unsafe {
            SetupDiEnumDeviceInterfaces(
                inventory.raw(),
                ptr::null(),
                class,
                count,
                &raw mut interface,
            )
        };
        if success == 0 {
            // SAFETY: this immediately follows the failed SetupAPI call.
            let error = unsafe { GetLastError() };
            if error == ERROR_NO_MORE_ITEMS {
                break;
            }
            return Err(PassiveStateSourceError::Backend(
                "Windows media endpoint enumeration failed".to_owned(),
            ));
        }
        count += 1;
        if count > MAX_ENDPOINTS {
            return Err(PassiveStateSourceError::InventoryOverflow(
                "Windows media endpoint inventory exceeds the protocol bound".to_owned(),
            ));
        }
    }
    u8::try_from(count).map_err(|_error| {
        PassiveStateSourceError::InventoryOverflow(
            "Windows media endpoint count exceeds the protocol bound".to_owned(),
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

type InventoryCloser = unsafe fn(HDEVINFO) -> i32;

struct DeviceInventory {
    raw: HDEVINFO,
    close_inventory: InventoryCloser,
}

impl DeviceInventory {
    const fn new(raw: HDEVINFO, close_inventory: InventoryCloser) -> Self {
        Self {
            raw,
            close_inventory,
        }
    }

    const fn raw(&self) -> HDEVINFO {
        self.raw
    }

    fn close(mut self) -> Result<(), PassiveStateSourceError> {
        self.close_owned()
    }

    fn close_owned(&mut self) -> Result<(), PassiveStateSourceError> {
        if self.raw == INVALID_DEVICE_INFO_SET {
            return Ok(());
        }
        let raw = std::mem::replace(&mut self.raw, INVALID_DEVICE_INFO_SET);
        // SAFETY: this wrapper owns the live SetupAPI inventory and invalidates
        // it before invoking the matching release operation exactly once.
        if unsafe { (self.close_inventory)(raw) } == 0 {
            poison_native_source_process();
            return Err(PassiveStateSourceError::Cleanup(
                "Windows media endpoint inventory release failed".to_owned(),
            ));
        }
        Ok(())
    }
}

impl Drop for DeviceInventory {
    fn drop(&mut self) {
        let _ = self.close_owned();
    }
}

unsafe fn destroy_device_inventory(inventory: HDEVINFO) -> i32 {
    // SAFETY: callers transfer a live inventory returned by SetupAPI.
    unsafe { SetupDiDestroyDeviceInfoList(inventory) }
}

#[cfg(test)]
mod tests {
    use std::sync::atomic::{AtomicUsize, Ordering};

    use super::*;

    static CLOSE_CALLS: AtomicUsize = AtomicUsize::new(0);

    unsafe fn fail_close(_inventory: HDEVINFO) -> i32 {
        CLOSE_CALLS.fetch_add(1, Ordering::SeqCst);
        0
    }

    #[test]
    fn explicit_inventory_release_failure_is_cleanup_and_not_retried() {
        CLOSE_CALLS.store(0, Ordering::SeqCst);
        let inventory = DeviceInventory::new(1, fail_close);
        assert!(matches!(
            inventory.close(),
            Err(PassiveStateSourceError::Cleanup(_))
        ));
        assert_eq!(CLOSE_CALLS.load(Ordering::SeqCst), 1);
    }
}
