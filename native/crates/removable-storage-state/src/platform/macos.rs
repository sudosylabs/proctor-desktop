use std::fmt::Write as _;
use std::mem::{self, MaybeUninit};
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

use super::identity::{RawStorageFunction, StorageIdentityMap};

const MNT_NOWAIT: libc::c_int = 2;
const MNT_REMOVABLE: u32 = 0x0000_0200;
const MAX_RAW_MOUNTS: libc::c_int = 4_096;

#[repr(C)]
struct VolumeUuidAttributes {
    length: u32,
    uuid: libc::uuid_t,
}

pub struct PlatformRemovableStorageBackend {
    selection: RemovableStorageSelection,
}

impl PlatformRemovableStorageBackend {
    #[must_use]
    pub const fn new(selection: RemovableStorageSelection) -> Self {
        Self { selection }
    }
}

pub enum MacOsRemovableStorageSubscription {
    Polling(InitialFallbackPollingSubscription<RemovableStorageWire>),
    Unavailable(UnavailablePassiveStateSubscription<RemovableStorageWire>),
}

impl PassiveStateSubscription<RemovableStorageWire> for MacOsRemovableStorageSubscription {
    fn stop(self) -> Result<RemovableStorageState, PassiveStateSourceError> {
        match self {
            Self::Polling(subscription) => subscription.stop(),
            Self::Unavailable(subscription) => subscription.stop(),
        }
    }
}

impl PassiveStateBackend<RemovableStorageWire> for PlatformRemovableStorageBackend {
    type Subscription = MacOsRemovableStorageSubscription;

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
                PlatformFamily::Macos,
                "macos-portable-storage-unavailable-v1",
            )
            .open(emitter)?;
            return Ok(OpenedPassiveStateBackend {
                platform: opened.platform,
                permission: opened.permission,
                adapter_version: opened.adapter_version,
                initial_state: opened.initial_state,
                subscription: MacOsRemovableStorageSubscription::Unavailable(opened.subscription),
            });
        }
        let query_identities = Arc::clone(&identities);
        let opened = PollingPassiveStateBackend::new(
            PlatformFamily::Macos,
            PermissionState::Granted,
            "macos-mounted-removable-v1",
            Duration::from_millis(500),
            move || query_state(&query_identities),
        )
        .open_with_initial_backend_fallback(
            emitter,
            "macos-mounted-removable-unavailable-v1",
            RemovableStorageWire::unavailable_state(),
        )?;
        Ok(OpenedPassiveStateBackend {
            platform: opened.platform,
            permission: opened.permission,
            adapter_version: opened.adapter_version,
            initial_state: opened.initial_state,
            subscription: MacOsRemovableStorageSubscription::Polling(opened.subscription),
        })
    }
}

fn query_state(
    identities: &Mutex<StorageIdentityMap>,
) -> Result<RemovableStorageState, PassiveStateSourceError> {
    let records = mount_records()?;
    let mut functions = Vec::new();
    for record in &records {
        if record.f_flags & MNT_REMOVABLE == 0 {
            continue;
        }
        let stable_key = volume_identity(&record.f_mntonname)?;
        functions.push(RawStorageFunction {
            stable_key,
            kind: RemovableStorageFunctionKind::BlockStorage,
            transport: RemovableStorageTransport::Unknown,
            writability: if record.f_flags & (libc::MNT_RDONLY as u32) == 0 {
                RemovableStorageWritability::Writable
            } else {
                RemovableStorageWritability::ReadOnly
            },
            attachment: RemovableStorageAttachment::Mounted,
        });
    }
    identities
        .lock()
        .map_err(|_poisoned| {
            PassiveStateSourceError::Backend(
                "macOS storage identity map lock was poisoned".to_owned(),
            )
        })?
        .state(
            RemovableStorageCoverage::SnapshotOnly,
            RemovableStorageCertainty::Partial,
            functions,
        )
}

fn mount_records() -> Result<Vec<libc::statfs>, PassiveStateSourceError> {
    // SAFETY: a null sizing query asks macOS for the current record count.
    let count = unsafe { libc::getfsstat(std::ptr::null_mut(), 0, MNT_NOWAIT) };
    if count < 0 {
        return Err(PassiveStateSourceError::Backend(
            "macOS mount inventory query failed".to_owned(),
        ));
    }
    if count > MAX_RAW_MOUNTS {
        return Err(PassiveStateSourceError::InventoryOverflow(
            "macOS mount inventory exceeds the source bound".to_owned(),
        ));
    }
    if count == 0 {
        return Ok(Vec::new());
    }
    let capacity = usize::try_from(count)
        .unwrap_or(usize::MAX)
        .checked_add(1)
        .ok_or_else(|| {
            PassiveStateSourceError::InventoryOverflow(
                "macOS mount capacity exceeds the source bound".to_owned(),
            )
        })?;
    let byte_len = capacity
        .checked_mul(mem::size_of::<libc::statfs>())
        .and_then(|bytes| libc::c_int::try_from(bytes).ok())
        .ok_or_else(|| {
            PassiveStateSourceError::InventoryOverflow(
                "macOS mount buffer exceeds the source bound".to_owned(),
            )
        })?;
    let mut storage = Vec::<MaybeUninit<libc::statfs>>::with_capacity(capacity);
    // SAFETY: storage has `capacity` aligned record slots and byte_len exactly
    // describes that writable allocation. macOS initializes `returned` slots.
    let returned = unsafe {
        libc::getfsstat(
            storage.as_mut_ptr().cast::<libc::statfs>(),
            byte_len,
            MNT_NOWAIT,
        )
    };
    let returned = validate_mount_result(returned, capacity)?;
    // SAFETY: getfsstat initialized exactly `returned` records inside storage.
    unsafe { storage.set_len(returned) };
    Ok(storage
        .into_iter()
        .map(|record| {
            // SAFETY: every retained slot is inside the initialized prefix.
            unsafe { record.assume_init() }
        })
        .collect())
}

fn validate_mount_result(
    returned: libc::c_int,
    capacity: usize,
) -> Result<usize, PassiveStateSourceError> {
    if returned < 0 {
        return Err(PassiveStateSourceError::Backend(
            "macOS mount inventory query failed".to_owned(),
        ));
    }
    let returned = usize::try_from(returned).unwrap_or(usize::MAX);
    if returned >= capacity {
        return Err(PassiveStateSourceError::InventoryOverflow(
            "macOS mount inventory changed beyond the bounded snapshot".to_owned(),
        ));
    }
    Ok(returned)
}

fn volume_identity(mount_point: &[libc::c_char]) -> Result<String, PassiveStateSourceError> {
    if !mount_point.contains(&0) {
        return Err(storage_protocol_error(
            "mount_point",
            "NUL-terminated mount point in a successful mount record",
        ));
    }
    let mut attributes = libc::attrlist {
        bitmapcount: libc::ATTR_BIT_MAP_COUNT,
        reserved: 0,
        commonattr: 0,
        volattr: libc::ATTR_VOL_INFO | libc::ATTR_VOL_UUID,
        dirattr: 0,
        fileattr: 0,
        forkattr: 0,
    };
    let mut output = MaybeUninit::<VolumeUuidAttributes>::zeroed();
    // SAFETY: the mount point is bounded and NUL terminated, attributes asks
    // for one fixed-size volume UUID, and output owns exactly that writable
    // result buffer.
    let status = unsafe {
        libc::getattrlist(
            mount_point.as_ptr(),
            (&raw mut attributes).cast(),
            output.as_mut_ptr().cast(),
            mem::size_of::<VolumeUuidAttributes>(),
            0,
        )
    };
    if status != 0 {
        return Err(PassiveStateSourceError::Backend(
            "macOS removable volume identity is unavailable".to_owned(),
        ));
    }
    // SAFETY: a successful getattrlist call initialized the complete fixed
    // output buffer requested above; semantic validation follows immediately.
    let output = unsafe { output.assume_init() };
    parse_volume_uuid_attributes(&output)
}

fn parse_volume_uuid_attributes(
    output: &VolumeUuidAttributes,
) -> Result<String, PassiveStateSourceError> {
    if usize::try_from(output.length).ok() != Some(mem::size_of::<VolumeUuidAttributes>()) {
        return Err(storage_protocol_error(
            "volume_uuid",
            "complete fixed-size volume UUID result",
        ));
    }
    if output.uuid.iter().all(|byte| *byte == 0) {
        return Err(storage_protocol_error(
            "volume_uuid",
            "non-nil stable volume UUID",
        ));
    }
    let mut identity = String::with_capacity(44);
    identity.push_str("volume-uuid:");
    for byte in output.uuid {
        write!(identity, "{byte:02x}").expect("writing to a String cannot fail");
    }
    Ok(identity)
}

fn storage_protocol_error(field: &'static str, rule: &'static str) -> PassiveStateSourceError {
    PassiveStateSourceError::Protocol(ProtocolViolation::Schema(ProtocolValidationError {
        type_name: "MacOsRemovableStorageAdapter",
        field,
        rule,
    }))
}

#[cfg(test)]
mod tests {
    use super::{VolumeUuidAttributes, parse_volume_uuid_attributes, validate_mount_result};
    use native_source_runtime::PassiveStateSourceError;

    #[test]
    fn capacity_race_is_inventory_overflow_but_syscall_failure_is_backend() {
        assert!(matches!(
            validate_mount_result(4, 4),
            Err(PassiveStateSourceError::InventoryOverflow(_))
        ));
        assert!(matches!(
            validate_mount_result(-1, 4),
            Err(PassiveStateSourceError::Backend(_))
        ));
    }

    #[test]
    fn volume_uuid_identity_survives_transient_disk_name_changes() {
        let uuid = [
            0x01, 0x23, 0x45, 0x67, 0x89, 0xab, 0xcd, 0xef, 0xfe, 0xdc, 0xba, 0x98, 0x76, 0x54,
            0x32, 0x10,
        ];
        let first_mount_source = "/dev/disk2s1";
        let reconnected_mount_source = "/dev/disk9s1";
        assert_ne!(first_mount_source, reconnected_mount_source);
        let first = parse_volume_uuid_attributes(&VolumeUuidAttributes {
            length: u32::try_from(std::mem::size_of::<VolumeUuidAttributes>())
                .expect("attribute size fits u32"),
            uuid,
        })
        .expect("first volume UUID");
        let reconnected = parse_volume_uuid_attributes(&VolumeUuidAttributes {
            length: u32::try_from(std::mem::size_of::<VolumeUuidAttributes>())
                .expect("attribute size fits u32"),
            uuid,
        })
        .expect("reconnected volume UUID");
        assert_eq!(first, reconnected);
        assert!(!first.contains("disk"));
    }

    #[test]
    fn malformed_successful_volume_uuid_is_terminal() {
        assert!(matches!(
            parse_volume_uuid_attributes(&VolumeUuidAttributes {
                length: 1,
                uuid: [1; 16],
            }),
            Err(PassiveStateSourceError::Protocol(_))
        ));
        assert!(matches!(
            parse_volume_uuid_attributes(&VolumeUuidAttributes {
                length: u32::try_from(std::mem::size_of::<VolumeUuidAttributes>())
                    .expect("attribute size fits u32"),
                uuid: [0; 16],
            }),
            Err(PassiveStateSourceError::Protocol(_))
        ));
    }
}
