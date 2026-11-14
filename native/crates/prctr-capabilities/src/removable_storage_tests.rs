use super::*;

fn device(key: u64, kind: RawStorageKind, mounted: Option<bool>) -> RawStorageDevice {
    RawStorageDevice {
        key,
        kind,
        transport: RawTransport::Usb,
        mounted,
        writable: Some(true),
    }
}

fn both(block: Vec<RawStorageDevice>, portable: Vec<RawStorageDevice>) -> RawStorage {
    RawStorage {
        block: Some(block),
        portable: Some(portable),
    }
}

#[test]
fn no_storage_is_complete_with_zero_counts() {
    let observation = Tracking::default().classify(&both(Vec::new(), Vec::new()));
    assert_eq!(observation.state["coverage"], "block_and_portable");
    assert_eq!(observation.envelope.certainty, Certainty::Complete);
    assert_eq!(
        observation.fields[&id("removable_storage.summary.block_storage")],
        FieldValue::Number(0)
    );
    assert!(
        observation.changes.is_empty(),
        "the first read has no change kinds"
    );
}

#[test]
fn an_unmounted_disk_still_counts_as_attached() {
    let observation = Tracking::default().classify(&both(
        vec![device(7, RawStorageKind::Block, Some(false))],
        Vec::new(),
    ));
    assert_eq!(observation.summary["block_storage"], 1);
    assert_eq!(observation.state["devices"][0]["mounted"], "no");
    assert_eq!(observation.state["devices"][0]["device_id"], "storage0001");
}

#[test]
fn a_phone_counts_as_a_portable_device() {
    let observation = Tracking::default().classify(&both(
        Vec::new(),
        vec![device(3, RawStorageKind::Portable, None)],
    ));
    assert_eq!(observation.summary["portable_devices"], 1);
    assert_eq!(observation.state["devices"][0]["kind"], "portable_device");
    assert_eq!(observation.state["devices"][0]["mounted"], "unknown");
}

#[test]
fn attach_change_and_removal_are_reported_with_stable_identities() {
    let mut tracking = Tracking::default();
    tracking.classify(&both(Vec::new(), Vec::new()));
    let attached = tracking.classify(&both(
        vec![device(5, RawStorageKind::Block, Some(false))],
        Vec::new(),
    ));
    assert_eq!(attached.changes, vec![id(CHANGE_ATTACHED)]);
    let mounted = tracking.classify(&both(
        vec![device(5, RawStorageKind::Block, Some(true))],
        Vec::new(),
    ));
    assert_eq!(mounted.changes, vec![id(CHANGE_CHANGED)]);
    assert_eq!(mounted.state["devices"][0]["device_id"], "storage0001");
    let removed = tracking.classify(&both(Vec::new(), Vec::new()));
    assert_eq!(removed.changes, vec![id(CHANGE_REMOVED)]);
    let again = tracking.classify(&both(
        vec![device(5, RawStorageKind::Block, Some(true))],
        Vec::new(),
    ));
    assert_eq!(
        again.state["devices"][0]["device_id"], "storage0001",
        "a device keeps its identity when it returns"
    );
}

#[test]
fn a_platform_without_portable_reads_is_block_only_and_partial() {
    let observation = Tracking::default().classify(&RawStorage {
        block: Some(Vec::new()),
        portable: None,
    });
    assert_eq!(observation.state["coverage"], "block_only");
    assert_eq!(observation.envelope.certainty, Certainty::Partial);
    assert!(
        !observation
            .fields
            .contains_key(&id("removable_storage.summary.portable_devices")),
        "an unread kind has no count, never zero"
    );
}

#[test]
fn an_unreadable_platform_is_unavailable() {
    let observation = Tracking::default().classify(&RawStorage::default());
    assert_eq!(observation.state["coverage"], "unavailable");
    assert_eq!(observation.envelope.health, Health::Unsupported);
}

#[test]
fn the_state_lists_at_most_the_bound_but_the_summary_counts_every_device() {
    let many: Vec<_> = (0..(MAX_DEVICES as u64 + 6))
        .map(|key| device(key, RawStorageKind::Block, None))
        .collect();
    let observation = Tracking::default().classify(&both(many, Vec::new()));
    assert_eq!(
        observation.state["devices"].as_array().map(Vec::len),
        Some(MAX_DEVICES)
    );
    assert_eq!(observation.summary["block_storage"], MAX_DEVICES as u64 + 6);
}

#[test]
fn removable_storage_passes_the_core_conformance_suite() {
    let mut tracking = Tracking::default();
    let none = tracking.classify(&both(Vec::new(), Vec::new()));
    let one = tracking.classify(&both(
        vec![device(1, RawStorageKind::Block, Some(true))],
        Vec::new(),
    ));
    prctr_core::testing::assert_capability_conformance(&descriptor(), &none, &one);
}

/// Real OS: the attached devices are readable, and two reads agree.
#[cfg(any(target_os = "macos", target_os = "windows"))]
#[test]
fn this_machine_reports_disks_and_portable_devices() {
    let first = read();
    assert!(first.block.is_some(), "disks are readable");
    assert!(first.portable.is_some(), "portable devices are readable");
    assert_eq!(read(), first, "two reads agree");
}
