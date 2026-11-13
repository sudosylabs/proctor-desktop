//! Attached data-bearing storage: USB drives, SD cards, external disks (mounted or not) and phones
//! or cameras that expose file or photo transfer. Keyboards, hubs and disk images are not storage.
//! Serials, vendor and model names, volume labels, mount paths and contents are never read.
//! Contract: `docs/architecture/native-capability-families.md`, "Removable and portable storage".

use std::collections::BTreeMap;
use std::sync::{Arc, Mutex, PoisonError};
use std::time::Duration;

use prctr_core::{
    CapabilityDescriptor, FieldKind, FieldSpec, FieldValue, Observation, Sink, Source, SourceError,
};
use prctr_os::{RawStorageDevice, RawStorageKind, RawTransport};
use prctr_protocol::facts::{Certainty, Envelope, Health, Permission};
use prctr_protocol::scalars::Identifier;
use schemars::JsonSchema;
use serde::Serialize;

use crate::poller::Poller;

pub const CAPABILITY: &str = "removable_storage";
pub const POLL_INTERVAL: Duration = Duration::from_secs(2);
pub const STABILITY_MS: u64 = 2_000;
pub const REASON_ATTACHED: &str = "removable_storage.attached";
pub const CHANGE_ATTACHED: &str = "device_attached";
pub const CHANGE_REMOVED: &str = "device_removed";
pub const CHANGE_CHANGED: &str = "device_changed";
/// The most devices a state lists; more devices still count in the summary.
pub const MAX_DEVICES: usize = 64;
const MAX_COUNT: u64 = 1_024;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum Coverage {
    /// Disks and portable devices are both read.
    BlockAndPortable,
    /// Disks are read; this platform cannot read portable devices.
    BlockOnly,
    Unavailable,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum Kind {
    BlockStorage,
    PortableDevice,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum Transport {
    Usb,
    Thunderbolt,
    Sd,
    Other,
    Unknown,
}

/// A yes/no the OS may not state.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum Known {
    Yes,
    No,
    Unknown,
}

impl Known {
    const fn of(value: Option<bool>) -> Self {
        match value {
            Some(true) => Self::Yes,
            Some(false) => Self::No,
            None => Self::Unknown,
        }
    }
}

/// One attached device. `device_id` is opaque and stable within one agent session.
#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct Device {
    pub device_id: String,
    pub kind: Kind,
    pub transport: Transport,
    /// Whether a file system on it is mounted. Unmounted storage still counts as attached.
    pub mounted: Known,
    pub writable: Known,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct StorageState {
    pub coverage: Coverage,
    /// At most [`MAX_DEVICES`], ordered by identity.
    pub devices: Vec<Device>,
}

/// Device counts by kind, derived only from the read devices.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct StorageSummary {
    pub block_storage: u64,
    pub portable_devices: u64,
}

fn id(text: &str) -> Identifier {
    Identifier::new(text).expect("removable storage identifier is valid")
}

#[must_use]
pub fn descriptor() -> CapabilityDescriptor {
    let count = |name: &str| FieldSpec {
        name: id(name),
        kind: FieldKind::Count { max: MAX_COUNT },
    };
    CapabilityDescriptor {
        id: id(CAPABILITY),
        // Read only inside a session: which devices a candidate attaches is personal.
        sensitive: true,
        stability_ms: STABILITY_MS,
        categories: Vec::new(),
        fields: vec![
            count("removable_storage.summary.block_storage"),
            count("removable_storage.summary.portable_devices"),
        ],
        reasons: vec![id(REASON_ATTACHED)],
        app_conditions: false,
        permission_prompt: false,
    }
}

/// One read. `None` means the platform could not read that kind of device.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct RawStorage {
    pub block: Option<Vec<RawStorageDevice>>,
    pub portable: Option<Vec<RawStorageDevice>>,
}

#[must_use]
pub fn read() -> RawStorage {
    let sorted = |devices: Option<Vec<RawStorageDevice>>| {
        devices.map(|mut devices| {
            devices.sort();
            devices
        })
    };
    RawStorage {
        block: sorted(platform::block()),
        portable: sorted(platform::portable()),
    }
}

mod platform {
    use prctr_os::RawStorageDevice;

    #[cfg(target_os = "linux")]
    use prctr_os::linux as os;
    #[cfg(target_os = "macos")]
    use prctr_os::macos as os;
    #[cfg(target_os = "windows")]
    use prctr_os::windows as os;

    #[cfg(any(target_os = "macos", target_os = "windows", target_os = "linux"))]
    pub fn block() -> Option<Vec<RawStorageDevice>> {
        os::block_devices()
    }
    #[cfg(any(target_os = "macos", target_os = "windows", target_os = "linux"))]
    pub fn portable() -> Option<Vec<RawStorageDevice>> {
        os::portable_devices()
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
    pub fn block() -> Option<Vec<RawStorageDevice>> {
        None
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
    pub fn portable() -> Option<Vec<RawStorageDevice>> {
        None
    }
}

/// Per-session memory: opaque device identities and the previous devices, for change kinds.
#[derive(Debug, Default)]
pub struct Tracking {
    ids: BTreeMap<u64, String>,
    previous: Option<BTreeMap<String, Device>>,
}

impl Tracking {
    fn device_id(&mut self, key: u64) -> String {
        let next = self.ids.len() + 1;
        self.ids
            .entry(key)
            .or_insert_with(|| format!("storage{next:04}"))
            .clone()
    }

    fn device(&mut self, raw: &RawStorageDevice) -> Device {
        Device {
            device_id: self.device_id(raw.key),
            kind: match raw.kind {
                RawStorageKind::Block => Kind::BlockStorage,
                RawStorageKind::Portable => Kind::PortableDevice,
            },
            transport: match raw.transport {
                RawTransport::Usb => Transport::Usb,
                RawTransport::Thunderbolt => Transport::Thunderbolt,
                RawTransport::Sd => Transport::Sd,
                RawTransport::Other => Transport::Other,
                RawTransport::Unknown => Transport::Unknown,
            },
            mounted: Known::of(raw.mounted),
            writable: Known::of(raw.writable),
        }
    }

    /// The change kinds between the previous read and `now`; none for the first read.
    fn changes(&mut self, now: &BTreeMap<String, Device>) -> Vec<Identifier> {
        let Some(previous) = self.previous.replace(now.clone()) else {
            return Vec::new();
        };
        let attached = now.keys().any(|key| !previous.contains_key(key));
        let removed = previous.keys().any(|key| !now.contains_key(key));
        let changed = now
            .iter()
            .any(|(key, device)| previous.get(key).is_some_and(|before| before != device));
        [
            (attached, CHANGE_ATTACHED),
            (removed, CHANGE_REMOVED),
            (changed, CHANGE_CHANGED),
        ]
        .into_iter()
        .filter(|(happened, _)| *happened)
        .map(|(_, kind)| id(kind))
        .collect()
    }

    /// The facts for one read.
    pub fn classify(&mut self, raw: &RawStorage) -> Observation {
        let read: Vec<Device> = raw
            .block
            .iter()
            .chain(raw.portable.iter())
            .flatten()
            .map(|device| self.device(device))
            .collect();
        let mut all: BTreeMap<String, Device> = BTreeMap::new();
        for device in read {
            all.entry(device.device_id.clone()).or_insert(device);
        }
        let changes = self.changes(&all);
        let count = |kind| all.values().filter(|device| device.kind == kind).count() as u64;
        let summary = StorageSummary {
            block_storage: count(Kind::BlockStorage).min(MAX_COUNT),
            portable_devices: count(Kind::PortableDevice).min(MAX_COUNT),
        };
        let coverage = match (&raw.block, &raw.portable) {
            (Some(_), Some(_)) => Coverage::BlockAndPortable,
            (Some(_), None) => Coverage::BlockOnly,
            (None, _) => Coverage::Unavailable,
        };
        let (health, certainty) = match coverage {
            Coverage::BlockAndPortable => (Health::Healthy, Certainty::Complete),
            Coverage::BlockOnly => (Health::Degraded, Certainty::Partial),
            Coverage::Unavailable => (Health::Unsupported, Certainty::Unknown),
        };
        let state = StorageState {
            coverage,
            devices: all.into_values().take(MAX_DEVICES).collect(),
        };
        let mut fields = BTreeMap::new();
        if raw.block.is_some() {
            fields.insert(
                id("removable_storage.summary.block_storage"),
                FieldValue::Number(summary.block_storage),
            );
        }
        if raw.portable.is_some() {
            fields.insert(
                id("removable_storage.summary.portable_devices"),
                FieldValue::Number(summary.portable_devices),
            );
        }
        Observation {
            envelope: Envelope {
                permission: Permission::Granted,
                health,
                certainty,
            },
            state: serde_json::to_value(&state).unwrap_or_default(),
            summary: serde_json::to_value(summary).unwrap_or_default(),
            fields,
            apps: None,
            changes,
        }
    }
}

/// The removable storage source: it re-reads the attached devices every [`POLL_INTERVAL`].
pub struct RemovableStorageSource {
    tracking: Arc<Mutex<Tracking>>,
    poller: Option<Poller>,
}

impl RemovableStorageSource {
    #[must_use]
    pub fn new() -> Self {
        Self {
            tracking: Arc::new(Mutex::new(Tracking::default())),
            poller: None,
        }
    }
}

impl Default for RemovableStorageSource {
    fn default() -> Self {
        Self::new()
    }
}

impl Source for RemovableStorageSource {
    fn descriptor(&self) -> CapabilityDescriptor {
        descriptor()
    }

    fn start(
        &mut self,
        _categories: &[Identifier],
        sink: Sink,
    ) -> Result<Observation, SourceError> {
        self.stop();
        self.poller = Some(Poller::start(
            "prctr-removable-storage",
            POLL_INTERVAL,
            read(),
            read,
            sink,
        )?);
        Ok(self.current())
    }

    fn current(&mut self) -> Observation {
        let raw = read();
        self.tracking
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .classify(&raw)
    }

    fn stop(&mut self) {
        if let Some(poller) = self.poller.take() {
            poller.stop();
        }
    }
}

impl Drop for RemovableStorageSource {
    fn drop(&mut self) {
        self.stop();
    }
}

#[cfg(test)]
#[path = "removable_storage_tests.rs"]
mod tests;
