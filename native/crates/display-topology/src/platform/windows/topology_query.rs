use std::collections::BTreeMap;
use std::ptr;

use native_protocol::{
    DisplayPowerState, DisplayPrimaryState, DisplayTarget, DisplayTargetKind,
    DisplayTopologySnapshot, MAX_DISPLAY_TARGETS, TopologyCertainty,
};
use windows_sys::Win32::Devices::Display::{
    DISPLAYCONFIG_MODE_INFO, DISPLAYCONFIG_MODE_INFO_TYPE_SOURCE,
    DISPLAYCONFIG_OUTPUT_TECHNOLOGY_COMPONENT_VIDEO,
    DISPLAYCONFIG_OUTPUT_TECHNOLOGY_COMPOSITE_VIDEO, DISPLAYCONFIG_OUTPUT_TECHNOLOGY_D_JPN,
    DISPLAYCONFIG_OUTPUT_TECHNOLOGY_DISPLAYPORT_EMBEDDED,
    DISPLAYCONFIG_OUTPUT_TECHNOLOGY_DISPLAYPORT_EXTERNAL,
    DISPLAYCONFIG_OUTPUT_TECHNOLOGY_DISPLAYPORT_USB_TUNNEL, DISPLAYCONFIG_OUTPUT_TECHNOLOGY_DVI,
    DISPLAYCONFIG_OUTPUT_TECHNOLOGY_HD15, DISPLAYCONFIG_OUTPUT_TECHNOLOGY_HDMI,
    DISPLAYCONFIG_OUTPUT_TECHNOLOGY_INDIRECT_VIRTUAL, DISPLAYCONFIG_OUTPUT_TECHNOLOGY_INTERNAL,
    DISPLAYCONFIG_OUTPUT_TECHNOLOGY_LVDS, DISPLAYCONFIG_OUTPUT_TECHNOLOGY_MIRACAST,
    DISPLAYCONFIG_OUTPUT_TECHNOLOGY_SDI, DISPLAYCONFIG_OUTPUT_TECHNOLOGY_SDTVDONGLE,
    DISPLAYCONFIG_OUTPUT_TECHNOLOGY_SVIDEO, DISPLAYCONFIG_OUTPUT_TECHNOLOGY_UDI_EMBEDDED,
    DISPLAYCONFIG_OUTPUT_TECHNOLOGY_UDI_EXTERNAL, DISPLAYCONFIG_PATH_INFO,
    GetDisplayConfigBufferSizes, QDC_ALL_PATHS, QDC_INCLUDE_HMD, QDC_ONLY_ACTIVE_PATHS,
    QueryDisplayConfig,
};
use windows_sys::Win32::Foundation::{ERROR_INSUFFICIENT_BUFFER, ERROR_SUCCESS, LUID};
use windows_sys::Win32::Graphics::Gdi::{DISPLAYCONFIG_PATH_ACTIVE, DISPLAYCONFIG_TARGET_IS_HMD};

use crate::DisplayTopologyError;

const INVALID_MODE_INDEX: u32 = u32::MAX;
// QueryDisplayConfig may return inactive and alternate paths for one final
// target. Bound its raw OS allocation independently from protocol queue limits.
const MAX_DISPLAY_CONFIG_PATHS: usize = 1_024;
const MAX_DISPLAY_CONFIG_MODES: usize = 2_048;

pub(super) fn enumerate_topology() -> Result<DisplayTopologySnapshot, DisplayTopologyError> {
    let (active_paths, modes) = query_paths(QDC_ONLY_ACTIVE_PATHS | QDC_INCLUDE_HMD)?;
    let (all_paths, _) = query_paths(QDC_ALL_PATHS)?;
    build_topology(&active_paths, &modes, &all_paths)
}

fn build_topology(
    active_paths: &[DISPLAYCONFIG_PATH_INFO],
    modes: &[DISPLAYCONFIG_MODE_INFO],
    all_paths: &[DISPLAYCONFIG_PATH_INFO],
) -> Result<DisplayTopologySnapshot, DisplayTopologyError> {
    let mut unique_targets = BTreeMap::new();
    for path in all_paths
        .iter()
        .filter(|path| path.targetInfo.targetAvailable != 0)
    {
        unique_targets
            .entry(target_id(path))
            .or_insert_with(|| inactive_target(path));
    }

    let mut groups: BTreeMap<String, Vec<String>> = BTreeMap::new();
    for path in active_paths {
        groups
            .entry(source_key(path))
            .or_default()
            .push(target_id(path));
    }
    for group in groups.values_mut() {
        group.sort();
    }

    let mut complete = true;
    for path in active_paths {
        let source_mode = source_mode(path, modes);
        complete &= source_mode.is_some();
        let group = &groups[&source_key(path)];
        let identifier = target_id(path);
        let mirror_primary_id =
            (group.len() > 1 && identifier != group[0]).then(|| group[0].clone());
        let (kind, builtin) = classify_target(path);
        let primary_state = source_mode.map_or(DisplayPrimaryState::Unknown, |mode| {
            if mode.position.x == 0 && mode.position.y == 0 && mirror_primary_id.is_none() {
                DisplayPrimaryState::Primary
            } else {
                DisplayPrimaryState::NotPrimary
            }
        });
        unique_targets.insert(
            identifier.clone(),
            DisplayTarget {
                target_id: identifier,
                active: path.flags & DISPLAYCONFIG_PATH_ACTIVE != 0,
                primary_state,
                builtin,
                power_state: DisplayPowerState::Unknown,
                kind,
                mirror_primary_id,
                pixel_width: source_mode.map_or(0, |mode| mode.width),
                pixel_height: source_mode.map_or(0, |mode| mode.height),
            },
        );
    }

    if unique_targets.len() > MAX_DISPLAY_TARGETS {
        return Err(DisplayTopologyError::Backend(format!(
            "Windows CCD returned {} available display targets; protocol maximum is {MAX_DISPLAY_TARGETS}",
            unique_targets.len()
        )));
    }

    let targets: Vec<_> = unique_targets.into_values().collect();
    let certainty = if complete
        && targets
            .iter()
            .all(|target| target.kind != DisplayTargetKind::Unknown)
    {
        TopologyCertainty::Complete
    } else {
        TopologyCertainty::Partial
    };

    Ok(DisplayTopologySnapshot { certainty, targets })
}

fn query_paths(
    flags: u32,
) -> Result<(Vec<DISPLAYCONFIG_PATH_INFO>, Vec<DISPLAYCONFIG_MODE_INFO>), DisplayTopologyError> {
    for _attempt in 0..3 {
        let mut path_count = 0_u32;
        let mut mode_count = 0_u32;
        // SAFETY: both count pointers reference initialized writable values.
        let size_result =
            unsafe { GetDisplayConfigBufferSizes(flags, &raw mut path_count, &raw mut mode_count) };
        if size_result != ERROR_SUCCESS {
            return Err(win32_error("GetDisplayConfigBufferSizes", size_result));
        }
        let path_capacity = usize::try_from(path_count).unwrap_or(usize::MAX);
        let mode_capacity = usize::try_from(mode_count).unwrap_or(usize::MAX);
        if path_capacity > MAX_DISPLAY_CONFIG_PATHS || mode_capacity > MAX_DISPLAY_CONFIG_MODES {
            return Err(DisplayTopologyError::Backend(format!(
                "Windows CCD requested {path_count} paths and {mode_count} modes; limits are {MAX_DISPLAY_CONFIG_PATHS} and {MAX_DISPLAY_CONFIG_MODES}"
            )));
        }
        let mut paths = vec![DISPLAYCONFIG_PATH_INFO::default(); path_capacity];
        let mut modes = vec![DISPLAYCONFIG_MODE_INFO::default(); mode_capacity];
        // SAFETY: the buffers contain the requested initialized capacity and the
        // count pointers and null topology pointer match QueryDisplayConfig.
        let query_result = unsafe {
            QueryDisplayConfig(
                flags,
                &raw mut path_count,
                paths.as_mut_ptr(),
                &raw mut mode_count,
                modes.as_mut_ptr(),
                ptr::null_mut(),
            )
        };
        if query_result == ERROR_INSUFFICIENT_BUFFER {
            continue;
        }
        if query_result != ERROR_SUCCESS {
            return Err(win32_error("QueryDisplayConfig", query_result));
        }
        paths.truncate(path_count as usize);
        modes.truncate(mode_count as usize);
        return Ok((paths, modes));
    }
    Err(DisplayTopologyError::Backend(
        "Windows CCD topology changed repeatedly while taking a snapshot".to_owned(),
    ))
}

fn inactive_target(path: &DISPLAYCONFIG_PATH_INFO) -> DisplayTarget {
    let (kind, builtin) = classify_target(path);
    DisplayTarget {
        target_id: target_id(path),
        active: false,
        primary_state: DisplayPrimaryState::Unknown,
        builtin,
        power_state: DisplayPowerState::Unknown,
        kind,
        mirror_primary_id: None,
        pixel_width: 0,
        pixel_height: 0,
    }
}

fn source_mode(
    path: &DISPLAYCONFIG_PATH_INFO,
    modes: &[DISPLAYCONFIG_MODE_INFO],
) -> Option<windows_sys::Win32::Devices::Display::DISPLAYCONFIG_SOURCE_MODE> {
    // SAFETY: QDC_VIRTUAL_MODE_AWARE is not set, so modeInfoIdx is the active union member.
    let index = unsafe { path.sourceInfo.Anonymous.modeInfoIdx };
    if index == INVALID_MODE_INDEX {
        return None;
    }
    let mode = modes.get(index as usize)?;
    if mode.infoType != DISPLAYCONFIG_MODE_INFO_TYPE_SOURCE
        || !same_luid(mode.adapterId, path.sourceInfo.adapterId)
        || mode.id != path.sourceInfo.id
    {
        return None;
    }
    // SAFETY: infoType establishes sourceMode as the active union member.
    Some(unsafe { mode.Anonymous.sourceMode })
}

fn source_key(path: &DISPLAYCONFIG_PATH_INFO) -> String {
    format!(
        "{:08x}{:08x}-{}",
        high_part_bits(path.sourceInfo.adapterId.HighPart),
        path.sourceInfo.adapterId.LowPart,
        path.sourceInfo.id
    )
}

fn target_id(path: &DISPLAYCONFIG_PATH_INFO) -> String {
    format!(
        "ccd-{:08x}{:08x}-{}",
        high_part_bits(path.targetInfo.adapterId.HighPart),
        path.targetInfo.adapterId.LowPart,
        path.targetInfo.id
    )
}

fn same_luid(left: LUID, right: LUID) -> bool {
    left.LowPart == right.LowPart && left.HighPart == right.HighPart
}

fn high_part_bits(value: i32) -> u32 {
    u32::from_ne_bytes(value.to_ne_bytes())
}

fn classify_output(technology: i32) -> (DisplayTargetKind, bool) {
    match technology {
        DISPLAYCONFIG_OUTPUT_TECHNOLOGY_INTERNAL
        | DISPLAYCONFIG_OUTPUT_TECHNOLOGY_LVDS
        | DISPLAYCONFIG_OUTPUT_TECHNOLOGY_DISPLAYPORT_EMBEDDED
        | DISPLAYCONFIG_OUTPUT_TECHNOLOGY_UDI_EMBEDDED => (DisplayTargetKind::Physical, true),
        DISPLAYCONFIG_OUTPUT_TECHNOLOGY_HD15
        | DISPLAYCONFIG_OUTPUT_TECHNOLOGY_SVIDEO
        | DISPLAYCONFIG_OUTPUT_TECHNOLOGY_COMPOSITE_VIDEO
        | DISPLAYCONFIG_OUTPUT_TECHNOLOGY_COMPONENT_VIDEO
        | DISPLAYCONFIG_OUTPUT_TECHNOLOGY_DVI
        | DISPLAYCONFIG_OUTPUT_TECHNOLOGY_HDMI
        | DISPLAYCONFIG_OUTPUT_TECHNOLOGY_D_JPN
        | DISPLAYCONFIG_OUTPUT_TECHNOLOGY_SDI
        | DISPLAYCONFIG_OUTPUT_TECHNOLOGY_DISPLAYPORT_EXTERNAL
        | DISPLAYCONFIG_OUTPUT_TECHNOLOGY_UDI_EXTERNAL
        | DISPLAYCONFIG_OUTPUT_TECHNOLOGY_SDTVDONGLE
        | DISPLAYCONFIG_OUTPUT_TECHNOLOGY_DISPLAYPORT_USB_TUNNEL => {
            (DisplayTargetKind::Physical, false)
        }
        DISPLAYCONFIG_OUTPUT_TECHNOLOGY_MIRACAST => (DisplayTargetKind::Remote, false),
        DISPLAYCONFIG_OUTPUT_TECHNOLOGY_INDIRECT_VIRTUAL => (DisplayTargetKind::Virtual, false),
        _ => (DisplayTargetKind::Unknown, false),
    }
}

fn classify_target(path: &DISPLAYCONFIG_PATH_INFO) -> (DisplayTargetKind, bool) {
    if path.targetInfo.statusFlags & DISPLAYCONFIG_TARGET_IS_HMD != 0 {
        return (DisplayTargetKind::Specialized, false);
    }
    classify_output(path.targetInfo.outputTechnology)
}

fn win32_error(operation: &str, code: u32) -> DisplayTopologyError {
    DisplayTopologyError::Backend(format!("{operation} failed with Win32 error {code}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use windows_sys::Win32::Devices::Display::{
        DISPLAYCONFIG_MODE_INFO_0, DISPLAYCONFIG_PATH_SOURCE_INFO,
        DISPLAYCONFIG_PATH_SOURCE_INFO_0, DISPLAYCONFIG_PATH_TARGET_INFO,
        DISPLAYCONFIG_SOURCE_MODE,
    };
    use windows_sys::Win32::Foundation::POINTL;

    #[test]
    fn merges_available_targets_and_marks_shared_source_mirroring() {
        let first = path(3, 10, DISPLAYCONFIG_OUTPUT_TECHNOLOGY_HDMI, 0, 0);
        let second = path(3, 11, DISPLAYCONFIG_OUTPUT_TECHNOLOGY_HDMI, 0, 0);
        let remote = path(
            4,
            12,
            DISPLAYCONFIG_OUTPUT_TECHNOLOGY_MIRACAST,
            INVALID_MODE_INDEX,
            0,
        );
        let active_paths = [
            DISPLAYCONFIG_PATH_INFO {
                flags: DISPLAYCONFIG_PATH_ACTIVE,
                ..first
            },
            DISPLAYCONFIG_PATH_INFO {
                flags: DISPLAYCONFIG_PATH_ACTIVE,
                ..second
            },
        ];
        let topology = build_topology(
            &active_paths,
            &[source_mode_fixture(3, 1920, 1080)],
            &[first, second, remote],
        )
        .expect("build topology");

        assert_eq!(topology.certainty, TopologyCertainty::Complete);
        assert_eq!(topology.targets.len(), 3);
        assert_eq!(
            topology.targets[1].mirror_primary_id,
            Some(topology.targets[0].target_id.clone())
        );
        assert_eq!(topology.targets[2].kind, DisplayTargetKind::Remote);
        assert!(!topology.targets[2].active);
    }

    #[test]
    fn classifies_hmd_and_indirect_virtual_targets() {
        let mut hmd = path(1, 1, DISPLAYCONFIG_OUTPUT_TECHNOLOGY_HDMI, 0, 0);
        hmd.targetInfo.statusFlags = DISPLAYCONFIG_TARGET_IS_HMD;
        let virtual_target = path(2, 2, DISPLAYCONFIG_OUTPUT_TECHNOLOGY_INDIRECT_VIRTUAL, 1, 0);

        assert_eq!(classify_target(&hmd).0, DisplayTargetKind::Specialized);
        assert_eq!(
            classify_target(&virtual_target).0,
            DisplayTargetKind::Virtual
        );
    }

    #[test]
    fn missing_source_mode_degrades_certainty_without_inventing_dimensions() {
        let active = DISPLAYCONFIG_PATH_INFO {
            flags: DISPLAYCONFIG_PATH_ACTIVE,
            ..path(
                1,
                1,
                DISPLAYCONFIG_OUTPUT_TECHNOLOGY_INTERNAL,
                INVALID_MODE_INDEX,
                0,
            )
        };
        let topology = build_topology(&[active], &[], &[active]).expect("build topology");

        assert_eq!(topology.certainty, TopologyCertainty::Partial);
        assert_eq!(topology.targets[0].pixel_width, 0);
        assert_eq!(topology.targets[0].pixel_height, 0);
    }

    fn path(
        source_id: u32,
        target_id: u32,
        output_technology: i32,
        mode_index: u32,
        status_flags: u32,
    ) -> DISPLAYCONFIG_PATH_INFO {
        let adapter_id = LUID {
            LowPart: 7,
            HighPart: 0,
        };
        DISPLAYCONFIG_PATH_INFO {
            sourceInfo: DISPLAYCONFIG_PATH_SOURCE_INFO {
                adapterId: adapter_id,
                id: source_id,
                Anonymous: DISPLAYCONFIG_PATH_SOURCE_INFO_0 {
                    modeInfoIdx: mode_index,
                },
                ..DISPLAYCONFIG_PATH_SOURCE_INFO::default()
            },
            targetInfo: DISPLAYCONFIG_PATH_TARGET_INFO {
                adapterId: adapter_id,
                id: target_id,
                outputTechnology: output_technology,
                targetAvailable: 1,
                statusFlags: status_flags,
                ..DISPLAYCONFIG_PATH_TARGET_INFO::default()
            },
            flags: 0,
        }
    }

    fn source_mode_fixture(source_id: u32, width: u32, height: u32) -> DISPLAYCONFIG_MODE_INFO {
        DISPLAYCONFIG_MODE_INFO {
            infoType: DISPLAYCONFIG_MODE_INFO_TYPE_SOURCE,
            id: source_id,
            adapterId: LUID {
                LowPart: 7,
                HighPart: 0,
            },
            Anonymous: DISPLAYCONFIG_MODE_INFO_0 {
                sourceMode: DISPLAYCONFIG_SOURCE_MODE {
                    width,
                    height,
                    position: POINTL { x: 0, y: 0 },
                    ..DISPLAYCONFIG_SOURCE_MODE::default()
                },
            },
        }
    }
}
