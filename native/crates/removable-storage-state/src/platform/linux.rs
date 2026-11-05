use std::collections::BTreeSet;
use std::fs;
use std::path::Path;
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
    BoundedFileReadError, InitialFallbackPollingSubscription, OpenedPassiveStateBackend,
    PassiveStateBackend, PassiveStateEmitter, PassiveStateSourceError, PassiveStateSubscription,
    PassiveStateWire, PollingPassiveStateBackend, UnavailablePassiveStateBackend,
    UnavailablePassiveStateSubscription, read_bounded_utf8_file,
};

use super::identity::{RawStorageFunction, StorageIdentityMap};

const BLOCK_ROOT: &str = "/sys/class/block";
const MOUNTINFO: &str = "/proc/self/mountinfo";
const MAX_RAW_BLOCK_DEVICES: usize = 4_096;
const MAX_MOUNTINFO_BYTES: usize = 4 * 1024 * 1024;
const MAX_SYSFS_FACT_BYTES: usize = 4_096;
const MAX_DEVICE_ANCESTORS: usize = 32;

pub struct PlatformRemovableStorageBackend {
    selection: RemovableStorageSelection,
}

impl PlatformRemovableStorageBackend {
    #[must_use]
    pub const fn new(selection: RemovableStorageSelection) -> Self {
        Self { selection }
    }
}

pub enum LinuxRemovableStorageSubscription {
    Polling(InitialFallbackPollingSubscription<RemovableStorageWire>),
    Unavailable(UnavailablePassiveStateSubscription<RemovableStorageWire>),
}

impl PassiveStateSubscription<RemovableStorageWire> for LinuxRemovableStorageSubscription {
    fn stop(self) -> Result<RemovableStorageState, PassiveStateSourceError> {
        match self {
            Self::Polling(subscription) => subscription.stop(),
            Self::Unavailable(subscription) => subscription.stop(),
        }
    }
}

impl PassiveStateBackend<RemovableStorageWire> for PlatformRemovableStorageBackend {
    type Subscription = LinuxRemovableStorageSubscription;

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
                PlatformFamily::Linux,
                "linux-portable-storage-unavailable-v1",
            )
            .open(emitter)?;
            return Ok(OpenedPassiveStateBackend {
                platform: opened.platform,
                permission: opened.permission,
                adapter_version: opened.adapter_version,
                initial_state: opened.initial_state,
                subscription: LinuxRemovableStorageSubscription::Unavailable(opened.subscription),
            });
        }
        let query_identities = Arc::clone(&identities);
        let opened = PollingPassiveStateBackend::new(
            PlatformFamily::Linux,
            PermissionState::Granted,
            "linux-sysfs-removable-block-v1",
            Duration::from_millis(500),
            move || {
                query_state(
                    &query_identities,
                    Path::new(BLOCK_ROOT),
                    Path::new(MOUNTINFO),
                )
            },
        )
        .open_with_initial_backend_fallback(
            emitter,
            "linux-removable-block-unavailable-v1",
            RemovableStorageWire::unavailable_state(),
        )?;
        Ok(OpenedPassiveStateBackend {
            platform: opened.platform,
            permission: opened.permission,
            adapter_version: opened.adapter_version,
            initial_state: opened.initial_state,
            subscription: LinuxRemovableStorageSubscription::Polling(opened.subscription),
        })
    }
}

fn query_state(
    identities: &Mutex<StorageIdentityMap>,
    block_root: &Path,
    mountinfo: &Path,
) -> Result<RemovableStorageState, PassiveStateSourceError> {
    let mounted_devices = mounted_devices(mountinfo)?;
    let entries = fs::read_dir(block_root).map_err(|error| {
        PassiveStateSourceError::Backend(format!(
            "cannot read Linux block-device inventory: {error}"
        ))
    })?;
    let mut functions = Vec::new();
    let mut scanned = 0_usize;
    for entry in entries {
        let entry = entry.map_err(|error| {
            PassiveStateSourceError::Backend(format!(
                "cannot inspect one Linux block-device entry: {error}"
            ))
        })?;
        scanned += 1;
        if scanned > MAX_RAW_BLOCK_DEVICES {
            return Err(PassiveStateSourceError::InventoryOverflow(
                "Linux block-device inventory exceeds the source bound".to_owned(),
            ));
        }
        let path = entry.path();
        if marker_exists(&path.join("partition"), "Linux block partition marker")? {
            continue;
        }
        let removable = read_trimmed(&path.join("removable"))?;
        if !parse_removable(removable.as_deref())? {
            continue;
        }
        let stable_path = fs::canonicalize(&path).map_err(|error| {
            PassiveStateSourceError::Backend(format!(
                "cannot resolve Linux removable-storage device: {error}"
            ))
        })?;
        let stable_key = stable_device_key(&stable_path)?;
        functions.push(RawStorageFunction {
            stable_key,
            kind: RemovableStorageFunctionKind::BlockStorage,
            transport: classify_transport(&stable_path),
            writability: {
                let read_only = read_trimmed(&path.join("ro"))?;
                parse_writability(read_only.as_deref())?
            },
            attachment: if storage_or_partition_is_mounted(&path, &mounted_devices)? {
                RemovableStorageAttachment::Mounted
            } else {
                RemovableStorageAttachment::AttachedUnmounted
            },
        });
    }
    identities
        .lock()
        .map_err(|_poisoned| {
            PassiveStateSourceError::Backend(
                "Linux storage identity map lock was poisoned".to_owned(),
            )
        })?
        .state(
            RemovableStorageCoverage::BlockOnly,
            RemovableStorageCertainty::Partial,
            functions,
        )
}

fn mounted_devices(path: &Path) -> Result<BTreeSet<String>, PassiveStateSourceError> {
    let contents = read_bounded_utf8_file(path, MAX_MOUNTINFO_BYTES)
        .map_err(|error| map_storage_file_error(error, "Linux mount namespace", "mountinfo"))?;
    parse_mounted_devices(&contents)
}

fn parse_mounted_devices(contents: &str) -> Result<BTreeSet<String>, PassiveStateSourceError> {
    let mut devices = BTreeSet::new();
    let mut record_count = 0_usize;
    for line in contents.lines().filter(|line| !line.trim().is_empty()) {
        let fields = line.split_ascii_whitespace().collect::<Vec<_>>();
        let separator = fields
            .iter()
            .position(|field| *field == "-")
            .ok_or_else(|| {
                storage_protocol_error("mountinfo", "mount record with field separator")
            })?;
        if separator < 6 || fields.len() != separator + 4 {
            return Err(storage_protocol_error(
                "mountinfo",
                "complete mount record with mandatory and trailing fields",
            ));
        }
        if fields[0].parse::<u64>().is_err() || fields[1].parse::<u64>().is_err() {
            return Err(storage_protocol_error(
                "mountinfo_id",
                "numeric mount and parent identifiers",
            ));
        }
        let device = fields[2];
        let valid_device = device.split_once(':').is_some_and(|(major, minor)| {
            !major.is_empty()
                && !minor.is_empty()
                && !minor.contains(':')
                && major.parse::<u32>().is_ok()
                && minor.parse::<u32>().is_ok()
        });
        if !valid_device {
            return Err(storage_protocol_error(
                "mountinfo_device",
                "numeric major:minor device field",
            ));
        }
        devices.insert(device.to_owned());
        record_count += 1;
    }
    if record_count == 0 {
        return Err(storage_protocol_error(
            "mountinfo",
            "at least one complete mount record",
        ));
    }
    Ok(devices)
}

fn storage_or_partition_is_mounted(
    path: &Path,
    mounted_devices: &BTreeSet<String>,
) -> Result<bool, PassiveStateSourceError> {
    if parse_device_number(read_trimmed(&path.join("dev"))?)?
        .is_some_and(|device| mounted_devices.contains(&device))
    {
        return Ok(true);
    }
    let entries = fs::read_dir(path).map_err(|error| {
        PassiveStateSourceError::Backend(format!(
            "cannot inspect Linux removable-storage partitions: {error}"
        ))
    })?;
    for (index, entry) in entries.enumerate() {
        if index >= MAX_RAW_BLOCK_DEVICES {
            return Err(PassiveStateSourceError::InventoryOverflow(
                "Linux removable-storage partition inventory exceeds the source bound".to_owned(),
            ));
        }
        let entry = entry.map_err(|error| {
            PassiveStateSourceError::Backend(format!(
                "cannot inspect one Linux removable-storage partition: {error}"
            ))
        })?;
        let partition = entry.path();
        if !marker_exists(
            &partition.join("partition"),
            "Linux storage partition marker",
        )? {
            continue;
        }
        if parse_device_number(read_trimmed(&partition.join("dev"))?)?
            .is_some_and(|device| mounted_devices.contains(&device))
        {
            return Ok(true);
        }
    }
    Ok(false)
}

fn marker_exists(path: &Path, description: &str) -> Result<bool, PassiveStateSourceError> {
    match fs::metadata(path) {
        Ok(_) => Ok(true),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(false),
        Err(error) => Err(PassiveStateSourceError::Backend(format!(
            "cannot inspect {description}: {error}"
        ))),
    }
}

fn parse_removable(value: Option<&str>) -> Result<bool, PassiveStateSourceError> {
    match value {
        Some("1") => Ok(true),
        Some("0") => Ok(false),
        Some(_) => Err(storage_protocol_error(
            "removable",
            "binary Linux block removable value",
        )),
        None => Err(PassiveStateSourceError::Backend(
            "Linux block removable fact is unavailable".to_owned(),
        )),
    }
}

fn parse_writability(
    value: Option<&str>,
) -> Result<RemovableStorageWritability, PassiveStateSourceError> {
    match value {
        Some("0") => Ok(RemovableStorageWritability::Writable),
        Some("1") => Ok(RemovableStorageWritability::ReadOnly),
        Some(_) => Err(storage_protocol_error(
            "read_only",
            "binary Linux block read-only value",
        )),
        None => Ok(RemovableStorageWritability::Unknown),
    }
}

fn parse_device_number(value: Option<String>) -> Result<Option<String>, PassiveStateSourceError> {
    let Some(value) = value else {
        return Err(PassiveStateSourceError::Backend(
            "Linux block-device number is unavailable".to_owned(),
        ));
    };
    let (major, minor) = value.split_once(':').ok_or_else(|| {
        storage_protocol_error("device_number", "canonical numeric major:minor value")
    })?;
    if minor.contains(':') {
        return Err(storage_protocol_error(
            "device_number",
            "canonical numeric major:minor value",
        ));
    }
    let major = major.parse::<u32>().map_err(|_error| {
        storage_protocol_error("device_number", "canonical numeric major:minor value")
    })?;
    let minor = minor.parse::<u32>().map_err(|_error| {
        storage_protocol_error("device_number", "canonical numeric major:minor value")
    })?;
    let canonical = format!("{major}:{minor}");
    if canonical != value {
        return Err(storage_protocol_error(
            "device_number",
            "canonical numeric major:minor value",
        ));
    }
    Ok(Some(canonical))
}

fn stable_device_key(path: &Path) -> Result<String, PassiveStateSourceError> {
    for (kind, candidate) in [
        ("wwid", path.join("device/wwid")),
        ("wwid", path.join("wwid")),
        ("serial", path.join("device/serial")),
    ] {
        if let Some(value) = read_trimmed(&candidate)?.filter(|value| !value.is_empty()) {
            return Ok(format!("{kind}:{value}"));
        }
    }
    for ancestor in path.ancestors().take(MAX_DEVICE_ANCESTORS) {
        if !is_usb_device_node(ancestor)? {
            continue;
        }
        return read_trimmed(&ancestor.join("serial"))?
            .filter(|value| !value.is_empty())
            .map(|value| format!("usb-serial:{value}"))
            .ok_or_else(|| {
                PassiveStateSourceError::Backend(
                    "Linux removable USB device has no stable hardware identity".to_owned(),
                )
            });
    }
    Err(PassiveStateSourceError::Backend(
        "Linux removable storage has no stable hardware identity".to_owned(),
    ))
}

fn is_usb_device_node(path: &Path) -> Result<bool, PassiveStateSourceError> {
    Ok(read_trimmed(&path.join("uevent"))?.is_some_and(|value| {
        value
            .lines()
            .any(|line| line.trim() == "DEVTYPE=usb_device")
    }))
}

fn read_trimmed(path: &Path) -> Result<Option<String>, PassiveStateSourceError> {
    match read_bounded_utf8_file(path, MAX_SYSFS_FACT_BYTES) {
        Ok(value) => Ok(Some(value.trim().to_owned())),
        Err(BoundedFileReadError::Io(error)) if error.kind() == std::io::ErrorKind::NotFound => {
            Ok(None)
        }
        Err(error) => Err(map_storage_file_error(
            error,
            "Linux block-device fact",
            "sysfs_fact",
        )),
    }
}

fn map_storage_file_error(
    error: BoundedFileReadError,
    description: &'static str,
    field: &'static str,
) -> PassiveStateSourceError {
    match error {
        BoundedFileReadError::Io(error) => {
            PassiveStateSourceError::Backend(format!("cannot read {description}: {error}"))
        }
        BoundedFileReadError::Overflow { .. } => PassiveStateSourceError::InventoryOverflow(
            format!("{description} exceeds the source bound"),
        ),
        BoundedFileReadError::InvalidUtf8 => {
            storage_protocol_error(field, "valid UTF-8 bounded platform record")
        }
    }
}

fn storage_protocol_error(field: &'static str, rule: &'static str) -> PassiveStateSourceError {
    PassiveStateSourceError::Protocol(ProtocolViolation::Schema(ProtocolValidationError {
        type_name: "LinuxRemovableStorageAdapter",
        field,
        rule,
    }))
}

fn classify_transport(path: &Path) -> RemovableStorageTransport {
    let path = path.to_string_lossy().to_ascii_lowercase();
    if path.contains("/usb") {
        RemovableStorageTransport::Usb
    } else if path.contains("/mmc") {
        RemovableStorageTransport::Sd
    } else if path.contains("thunderbolt") {
        RemovableStorageTransport::Thunderbolt
    } else {
        RemovableStorageTransport::Unknown
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::os::unix::fs::symlink;
    use std::time::{SystemTime, UNIX_EPOCH};

    #[test]
    fn mount_inventory_rejects_malformed_non_empty_records() {
        assert!(matches!(
            parse_mounted_devices(""),
            Err(PassiveStateSourceError::Protocol(_))
        ));
        assert!(matches!(
            parse_mounted_devices("1 0 8:1\n"),
            Err(PassiveStateSourceError::Protocol(_))
        ));
        assert!(matches!(
            parse_mounted_devices("1 0 8:1 / / rw ext4 /dev/x rw\n"),
            Err(PassiveStateSourceError::Protocol(_))
        ));
        assert!(matches!(
            parse_mounted_devices("1 0 8:1 / / rw - ext4 /dev/x\n"),
            Err(PassiveStateSourceError::Protocol(_))
        ));
        assert!(matches!(
            parse_mounted_devices("1 0 invalid / / rw - ext4 /dev/x rw\n"),
            Err(PassiveStateSourceError::Protocol(_))
        ));
        assert_eq!(
            parse_mounted_devices("1 0 8:1 / / rw shared:1 master:2 - ext4 /dev/x rw\n",)
                .expect("valid mount record"),
            BTreeSet::from(["8:1".to_owned()]),
        );
    }

    #[test]
    fn invalid_mount_utf8_and_overflow_remain_terminal() {
        assert!(matches!(
            map_storage_file_error(
                BoundedFileReadError::InvalidUtf8,
                "Linux mount namespace",
                "mountinfo",
            ),
            PassiveStateSourceError::Protocol(_)
        ));
        assert!(matches!(
            map_storage_file_error(
                BoundedFileReadError::Overflow {
                    max_bytes: MAX_MOUNTINFO_BYTES,
                },
                "Linux mount namespace",
                "mountinfo",
            ),
            PassiveStateSourceError::InventoryOverflow(_)
        ));
    }

    #[test]
    fn malformed_present_block_facts_are_protocol_failures() {
        assert!(matches!(
            parse_removable(Some("maybe")),
            Err(PassiveStateSourceError::Protocol(_))
        ));
        assert!(matches!(
            parse_writability(Some("")),
            Err(PassiveStateSourceError::Protocol(_))
        ));
        for malformed in ["device", "8:", ":1", "8:1:2", "08:1"] {
            assert!(matches!(
                parse_device_number(Some(malformed.to_owned())),
                Err(PassiveStateSourceError::Protocol(_))
            ));
        }
        assert_eq!(
            parse_writability(None).expect("absent optional read-only fact"),
            RemovableStorageWritability::Unknown
        );
        assert!(matches!(
            parse_device_number(None),
            Err(PassiveStateSourceError::Backend(_))
        ));
    }

    #[test]
    fn missing_device_numbers_never_become_definite_unmounted_state() {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("time after epoch")
            .as_nanos();
        let root = std::env::temp_dir().join(format!("storage-dev-{unique}"));
        fs::create_dir_all(&root).expect("create storage fixture");
        assert!(matches!(
            storage_or_partition_is_mounted(&root, &BTreeSet::new()),
            Err(PassiveStateSourceError::Backend(_))
        ));

        fs::write(root.join("dev"), "8:0\n").expect("write base device number");
        let partition = root.join("sdb1");
        fs::create_dir_all(&partition).expect("create partition fixture");
        fs::write(partition.join("partition"), "1\n").expect("write partition marker");
        assert!(matches!(
            storage_or_partition_is_mounted(&root, &BTreeSet::new()),
            Err(PassiveStateSourceError::Backend(_))
        ));

        fs::remove_dir_all(root).expect("remove storage fixture");
    }

    #[test]
    fn partition_marker_metadata_errors_are_not_treated_as_absence() {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("time after epoch")
            .as_nanos();
        let root = std::env::temp_dir().join(format!("storage-marker-{unique}"));
        fs::create_dir_all(&root).expect("create marker fixture");
        symlink("partition", root.join("partition")).expect("create marker symlink loop");
        assert!(matches!(
            marker_exists(&root.join("partition"), "partition marker"),
            Err(PassiveStateSourceError::Backend(_))
        ));
        fs::remove_file(root.join("partition")).expect("remove marker symlink loop");
        fs::remove_dir_all(root).expect("remove marker fixture");
    }

    #[test]
    fn stable_hardware_identity_survives_block_name_changes() {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("time after epoch")
            .as_nanos();
        let root = std::env::temp_dir().join(format!("storage-identity-{unique}"));
        let first = root.join("sdb");
        let reconnected = root.join("sdf");
        fs::create_dir_all(first.join("device")).expect("create first device");
        fs::create_dir_all(reconnected.join("device")).expect("create reconnected device");
        fs::write(first.join("device/wwid"), "naa.stable-device-1\n").expect("write first WWID");
        fs::write(reconnected.join("device/wwid"), "naa.stable-device-1\n")
            .expect("write reconnected WWID");

        assert_ne!(first, reconnected);
        assert_eq!(
            stable_device_key(&first).expect("first stable identity"),
            stable_device_key(&reconnected).expect("reconnected stable identity"),
        );
        fs::remove_dir_all(root).expect("remove fixture");
    }

    #[test]
    fn serialless_usb_replacements_never_inherit_controller_identity() {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("time after epoch")
            .as_nanos();
        let root = std::env::temp_dir().join(format!("storage-controller-{unique}"));
        fs::create_dir_all(&root).expect("create controller");
        fs::write(root.join("uevent"), "DEVTYPE=usb_device\n").expect("write controller type");
        fs::write(root.join("serial"), "controller-serial\n").expect("write controller serial");
        let first = root.join("port-1/block/sdb");
        let replacement = root.join("port-2/block/sdf");
        for device in [root.join("port-1"), root.join("port-2")] {
            fs::create_dir_all(device.join("block")).expect("create device block directory");
            fs::write(device.join("uevent"), "DEVTYPE=usb_device\n").expect("write device type");
        }
        fs::create_dir_all(&first).expect("create first block device");
        fs::create_dir_all(&replacement).expect("create replacement block device");

        assert!(matches!(
            stable_device_key(&first),
            Err(PassiveStateSourceError::Backend(_))
        ));
        assert!(matches!(
            stable_device_key(&replacement),
            Err(PassiveStateSourceError::Backend(_))
        ));
        fs::remove_dir_all(root).expect("remove fixture");
    }
}
