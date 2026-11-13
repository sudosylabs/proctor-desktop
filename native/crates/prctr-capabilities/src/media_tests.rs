use prctr_os::RawMediaDevice;

use super::*;

fn device(key: u64, physical: bool, available: Option<bool>) -> RawMediaDevice {
    RawMediaDevice {
        key,
        physical,
        available,
    }
}

fn raw(
    permission: RawMediaPermission,
    devices: Vec<RawMediaDevice>,
    in_use: Option<bool>,
) -> RawMedia {
    RawMedia {
        permission,
        devices: Some(devices),
        in_use_by_other: in_use,
    }
}

#[test]
fn a_permitted_available_physical_camera_is_ready() {
    let observation = Tracking::default().classify(
        Kind::Camera,
        &raw(
            RawMediaPermission::Granted,
            vec![device(1, true, Some(true))],
            Some(false),
        ),
    );
    assert_eq!(observation.state["ready"], "ready");
    assert_eq!(observation.state["physical_devices"], 1);
    assert_eq!(observation.envelope.permission, Permission::Granted);
    assert_eq!(observation.envelope.certainty, Certainty::Complete);
    assert_eq!(
        observation.fields[&id("camera.in_use_by_other_app")],
        FieldValue::Symbol(id("no"))
    );
}

#[test]
fn a_virtual_camera_never_makes_the_camera_ready() {
    let observation = Tracking::default().classify(
        Kind::Camera,
        &raw(
            RawMediaPermission::Granted,
            vec![device(1, false, Some(true))],
            Some(false),
        ),
    );
    assert_eq!(observation.state["ready"], "not_ready");
    assert_eq!(observation.summary["virtual_devices"], 1);
    assert_eq!(observation.summary["physical_devices"], 0);
}

#[test]
fn a_suspended_camera_or_a_missing_permission_is_not_ready() {
    for (permission, available) in [
        (RawMediaPermission::Granted, Some(false)),
        (RawMediaPermission::Denied, Some(true)),
        (RawMediaPermission::NotDetermined, Some(true)),
    ] {
        let observation = Tracking::default().classify(
            Kind::Camera,
            &raw(permission, vec![device(1, true, available)], Some(false)),
        );
        assert_eq!(
            observation.state["ready"], "not_ready",
            "{permission:?} {available:?}"
        );
    }
}

#[test]
fn a_virtual_microphone_still_counts_as_a_microphone() {
    let observation = Tracking::default().classify(
        Kind::Microphone,
        &raw(
            RawMediaPermission::Granted,
            vec![device(1, false, Some(true))],
            Some(true),
        ),
    );
    assert_eq!(observation.state["devices"], 1);
    assert_eq!(observation.state["ready"], "ready");
    assert_eq!(observation.state["in_use_by_other_app"], "yes");
}

#[test]
fn unreadable_use_is_readiness_only_partial_and_has_no_field() {
    let observation = Tracking::default().classify(
        Kind::Camera,
        &raw(
            RawMediaPermission::Granted,
            vec![device(1, true, Some(true))],
            None,
        ),
    );
    assert_eq!(observation.state["coverage"], "readiness_only");
    assert_eq!(observation.envelope.certainty, Certainty::Partial);
    assert!(
        !observation
            .fields
            .contains_key(&id("camera.in_use_by_other_app"))
    );
}

#[test]
fn unlisted_devices_are_unavailable_with_no_fields() {
    let observation = Tracking::default().classify(Kind::Microphone, &RawMedia::unavailable());
    assert_eq!(observation.state["coverage"], "unavailable");
    assert_eq!(observation.state["ready"], "unknown");
    assert!(
        observation.fields.is_empty(),
        "unknown values have no fields"
    );
}

#[test]
fn changes_name_what_moved() {
    let mut tracking = Tracking::default();
    let none = raw(RawMediaPermission::NotDetermined, Vec::new(), Some(false));
    assert!(tracking.classify(Kind::Camera, &none).changes.is_empty());
    let plugged = raw(
        RawMediaPermission::NotDetermined,
        vec![device(4, true, Some(true))],
        Some(false),
    );
    assert_eq!(
        tracking.classify(Kind::Camera, &plugged).changes,
        vec![id(CHANGE_ADDED)]
    );
    let granted = raw(
        RawMediaPermission::Granted,
        vec![device(4, true, Some(true))],
        Some(false),
    );
    assert_eq!(
        tracking.classify(Kind::Camera, &granted).changes,
        vec![id(CHANGE_PERMISSION), id(CHANGE_READINESS)]
    );
    let used = raw(
        RawMediaPermission::Granted,
        vec![device(4, true, Some(true))],
        Some(true),
    );
    assert_eq!(
        tracking.classify(Kind::Camera, &used).changes,
        vec![id(CHANGE_USE)]
    );
    assert_eq!(
        tracking.classify(Kind::Camera, &none).changes,
        vec![
            id(CHANGE_REMOVED),
            id(CHANGE_PERMISSION),
            id(CHANGE_READINESS),
            id(CHANGE_USE)
        ]
    );
}

#[test]
fn camera_and_microphone_pass_the_core_conformance_suite() {
    for kind in [Kind::Camera, Kind::Microphone] {
        let mut tracking = Tracking::default();
        let none = tracking.classify(
            kind,
            &raw(RawMediaPermission::Granted, Vec::new(), Some(false)),
        );
        let one = tracking.classify(
            kind,
            &raw(
                RawMediaPermission::Granted,
                vec![device(1, true, Some(true))],
                Some(false),
            ),
        );
        prctr_core::testing::assert_capability_conformance(&descriptor(kind), &none, &one);
    }
}

/// Real OS: devices, permission and use are read without opening any device.
#[cfg(any(target_os = "macos", target_os = "windows"))]
#[test]
fn this_machine_reads_cameras_and_microphones() {
    for kind in [Kind::Camera, Kind::Microphone] {
        let first = read(kind);
        assert!(first.devices.is_some(), "{kind:?} devices are listed");
        assert_ne!(
            first.permission,
            RawMediaPermission::Unavailable,
            "{kind:?} permission"
        );
        assert!(
            first.in_use_by_other.is_some() || cfg!(target_os = "macos"),
            "{kind:?} use"
        );
    }
}
