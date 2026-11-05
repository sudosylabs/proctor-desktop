use std::sync::{Arc, Mutex};
use std::time::Duration;

use crate::{RemovableStorageSelection, RemovableStorageWire};
use native_protocol::{
    PermissionState, PlatformFamily, ProtocolValidationError, ProtocolViolation,
    RemovableStorageAttachment, RemovableStorageCertainty, RemovableStorageCoverage,
    RemovableStorageFunctionKind, RemovableStorageState, RemovableStorageTransport,
    RemovableStorageWritability, SourceOpenRequest,
};
use native_source_runtime::{
    InitialFallbackPollingSubscription, OpenedPassiveStateBackend, PassiveStateBackend,
    PassiveStateEmitter, PassiveStateSourceError, PassiveStateSubscription, PassiveStateWire,
    PollingPassiveStateBackend, UnavailablePassiveStateBackend,
    UnavailablePassiveStateSubscription,
};
use windows_sys::Win32::Storage::FileSystem::{
    GetDriveTypeW, GetLogicalDriveStringsW, GetVolumeNameForVolumeMountPointW,
};
use windows_sys::Win32::System::WindowsProgramming::DRIVE_REMOVABLE;

use super::identity::{RawStorageFunction, StorageIdentityMap};

const MAX_DRIVE_STRING_CODE_UNITS: usize = 512;
const MAX_VOLUME_IDENTITY_CODE_UNITS: usize = 64;

pub struct PlatformRemovableStorageBackend {
    selection: RemovableStorageSelection,
}

impl PlatformRemovableStorageBackend {
    #[must_use]
    pub const fn new(selection: RemovableStorageSelection) -> Self {
        Self { selection }
    }
}

pub enum WindowsRemovableStorageSubscription {
    Polling(InitialFallbackPollingSubscription<RemovableStorageWire>),
    Unavailable(UnavailablePassiveStateSubscription<RemovableStorageWire>),
}

impl PassiveStateSubscription<RemovableStorageWire> for WindowsRemovableStorageSubscription {
    fn stop(self) -> Result<RemovableStorageState, PassiveStateSourceError> {
        match self {
            Self::Polling(subscription) => subscription.stop(),
            Self::Unavailable(subscription) => subscription.stop(),
        }
    }
}

impl PassiveStateBackend<RemovableStorageWire> for PlatformRemovableStorageBackend {
    type Subscription = WindowsRemovableStorageSubscription;

    fn open(
        self,
        emitter: PassiveStateEmitter<RemovableStorageWire>,
    ) -> Result<
        OpenedPassiveStateBackend<RemovableStorageWire, Self::Subscription>,
        PassiveStateSourceError,
    > {
        let _ = emitter;
        Err(PassiveStateSourceError::Backend(
            "removable-storage source requires Attempt collection context".to_owned(),
        ))
    }

    fn open_with_context(
        self,
        request: &SourceOpenRequest,
        emitter: PassiveStateEmitter<RemovableStorageWire>,
    ) -> Result<
        OpenedPassiveStateBackend<RemovableStorageWire, Self::Subscription>,
        PassiveStateSourceError,
    > {
        let identities = Arc::new(Mutex::new(StorageIdentityMap::for_collection(
            &request.collection_session_id,
        )?));
        if !self.selection.includes_block_storage() {
            let opened = UnavailablePassiveStateBackend::new(
                PlatformFamily::Windows,
                "windows-portable-storage-unavailable",
            )
            .open(emitter)?;
            return Ok(OpenedPassiveStateBackend {
                platform: opened.platform,
                permission: opened.permission,
                adapter_version: opened.adapter_version,
                initial_state: opened.initial_state,
                subscription: WindowsRemovableStorageSubscription::Unavailable(opened.subscription),
            });
        }
        let query_identities = Arc::clone(&identities);
        let opened = PollingPassiveStateBackend::new(
            PlatformFamily::Windows,
            PermissionState::Granted,
            "windows-mounted-removable",
            Duration::from_millis(500),
            move || query_state(&query_identities),
        )
        .open_with_initial_backend_fallback(
            emitter,
            "windows-mounted-removable-unavailable",
            RemovableStorageWire::unavailable_state(),
        )?;
        Ok(OpenedPassiveStateBackend {
            platform: opened.platform,
            permission: opened.permission,
            adapter_version: opened.adapter_version,
            initial_state: opened.initial_state,
            subscription: WindowsRemovableStorageSubscription::Polling(opened.subscription),
        })
    }
}

fn query_state(
    identities: &Mutex<StorageIdentityMap>,
) -> Result<RemovableStorageState, PassiveStateSourceError> {
    let mut buffer = [0_u16; MAX_DRIVE_STRING_CODE_UNITS];
    // SAFETY: buffer is valid for the fixed bounded output and the function
    // writes a double-NUL-terminated list of mounted drive roots.
    let length = unsafe {
        GetLogicalDriveStringsW(
            u32::try_from(buffer.len()).unwrap_or(u32::MAX),
            buffer.as_mut_ptr(),
        )
    };
    if length == 0 {
        return Err(PassiveStateSourceError::Backend(
            "Windows mounted-drive inventory is unavailable".to_owned(),
        ));
    }
    let length = usize::try_from(length).unwrap_or(usize::MAX);
    let roots = parse_drive_roots(&buffer, length)?;
    let mut functions = Vec::new();
    for root in roots {
        // SAFETY: root is a live NUL-terminated drive root from the API buffer.
        if unsafe { GetDriveTypeW(root.as_ptr()) } == DRIVE_REMOVABLE {
            functions.push(RawStorageFunction {
                stable_key: volume_identity(root)?,
                kind: RemovableStorageFunctionKind::BlockStorage,
                transport: RemovableStorageTransport::Unknown,
                writability: RemovableStorageWritability::Unknown,
                attachment: RemovableStorageAttachment::Mounted,
            });
        }
    }
    identities
        .lock()
        .map_err(|_poisoned| {
            PassiveStateSourceError::Backend(
                "Windows storage identity map lock was poisoned".to_owned(),
            )
        })?
        .state(
            RemovableStorageCoverage::SnapshotOnly,
            RemovableStorageCertainty::Partial,
            functions,
        )
}

fn parse_drive_roots(
    buffer: &[u16],
    returned_length: usize,
) -> Result<Vec<&[u16]>, PassiveStateSourceError> {
    if returned_length >= buffer.len() {
        return Err(PassiveStateSourceError::InventoryOverflow(
            "Windows mounted-drive inventory exceeds the source bound".to_owned(),
        ));
    }
    if returned_length == 0 || buffer[returned_length] != 0 {
        return Err(storage_protocol_error(
            "drive_inventory",
            "non-empty double-NUL-terminated successful drive inventory",
        ));
    }
    let mut roots = Vec::new();
    let mut offset = 0_usize;
    while offset < returned_length {
        let remaining = &buffer[offset..returned_length];
        let end = remaining
            .iter()
            .position(|unit| *unit == 0)
            .ok_or_else(|| {
                storage_protocol_error(
                    "drive_inventory",
                    "NUL-terminated entries in a successful drive inventory",
                )
            })?;
        if end == 0 {
            return Err(storage_protocol_error(
                "drive_inventory",
                "non-empty entries in a successful drive inventory",
            ));
        }
        let name = String::from_utf16(&remaining[..end]).map_err(|_error| {
            storage_protocol_error("drive_inventory", "valid UTF-16 drive roots")
        })?;
        if !is_drive_root(&name) {
            return Err(storage_protocol_error(
                "drive_inventory",
                "canonical drive-letter root entries",
            ));
        }
        roots.push(&remaining[..=end]);
        offset += end + 1;
    }
    Ok(roots)
}

fn is_drive_root(value: &str) -> bool {
    let bytes = value.as_bytes();
    bytes.len() == 3 && bytes[0].is_ascii_alphabetic() && bytes[1] == b':' && bytes[2] == b'\\'
}

fn volume_identity(root: &[u16]) -> Result<String, PassiveStateSourceError> {
    let mut identity = [0_u16; MAX_VOLUME_IDENTITY_CODE_UNITS];
    // SAFETY: root is a live NUL-terminated mount point and identity is a
    // fixed writable buffer for the volume GUID path returned by Windows.
    let success = unsafe {
        GetVolumeNameForVolumeMountPointW(
            root.as_ptr(),
            identity.as_mut_ptr(),
            u32::try_from(identity.len()).unwrap_or(u32::MAX),
        )
    };
    if success == 0 {
        return Err(PassiveStateSourceError::Backend(
            "Windows removable volume identity is unavailable".to_owned(),
        ));
    }
    let Some(length) = identity.iter().position(|unit| *unit == 0) else {
        return Err(PassiveStateSourceError::InventoryOverflow(
            "Windows removable volume identity exceeds the source bound".to_owned(),
        ));
    };
    parse_volume_identity(&identity[..length])
}

fn parse_volume_identity(identity: &[u16]) -> Result<String, PassiveStateSourceError> {
    if identity.is_empty() {
        return Err(storage_protocol_error(
            "volume_identity",
            "non-empty volume GUID path in a successful result",
        ));
    }
    let identity = String::from_utf16(identity).map_err(|_error| {
        storage_protocol_error("volume_identity", "valid UTF-16 volume GUID path")
    })?;
    if !is_volume_guid_path(&identity) {
        return Err(storage_protocol_error(
            "volume_identity",
            "canonical volume GUID path",
        ));
    }
    Ok(identity)
}

fn is_volume_guid_path(value: &str) -> bool {
    let Some(guid) = value
        .strip_prefix(r"\\?\Volume{")
        .and_then(|value| value.strip_suffix(r"}\"))
    else {
        return false;
    };
    if guid.len() != 36 {
        return false;
    }
    guid.bytes().enumerate().all(|(index, byte)| {
        if [8, 13, 18, 23].contains(&index) {
            byte == b'-'
        } else {
            byte.is_ascii_hexdigit()
        }
    })
}

fn storage_protocol_error(field: &'static str, rule: &'static str) -> PassiveStateSourceError {
    PassiveStateSourceError::Protocol(ProtocolViolation::Schema(ProtocolValidationError {
        type_name: "WindowsRemovableStorageAdapter",
        field,
        rule,
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn successful_drive_inventory_requires_exact_utf16_roots() {
        let valid = [u16::from(b'E'), u16::from(b':'), u16::from(b'\\'), 0, 0];
        assert_eq!(
            parse_drive_roots(&valid, 4).expect("valid drive inventory"),
            vec![&valid[..4]],
        );
        assert!(matches!(
            parse_drive_roots(
                &[u16::from(b'E'), u16::from(b':'), u16::from(b'\\'), 1, 0],
                4,
            ),
            Err(PassiveStateSourceError::Protocol(_))
        ));
        assert!(matches!(
            parse_drive_roots(&[0, 0], 1),
            Err(PassiveStateSourceError::Protocol(_))
        ));
        assert!(matches!(
            parse_drive_roots(&[0xd800, 0, 0], 2),
            Err(PassiveStateSourceError::Protocol(_))
        ));
    }

    #[test]
    fn successful_volume_identity_is_strict_and_non_lossy() {
        let valid = r"\\?\Volume{01234567-89ab-cdef-0123-456789abcdef}\";
        assert_eq!(
            parse_volume_identity(&valid.encode_utf16().collect::<Vec<_>>())
                .expect("valid volume GUID"),
            valid,
        );
        assert!(matches!(
            parse_volume_identity(&[]),
            Err(PassiveStateSourceError::Protocol(_))
        ));
        assert!(matches!(
            parse_volume_identity(&[0xd800]),
            Err(PassiveStateSourceError::Protocol(_))
        ));
        assert!(matches!(
            parse_volume_identity(&"not-a-volume-guid".encode_utf16().collect::<Vec<_>>()),
            Err(PassiveStateSourceError::Protocol(_))
        ));
    }
}
