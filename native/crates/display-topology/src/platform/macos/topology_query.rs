use std::collections::HashSet;
use std::ptr;

use native_protocol::{
    DisplayPowerState, DisplayPrimaryState, DisplayTarget, DisplayTargetKind,
    DisplayTopologySnapshot, MAX_DISPLAY_TARGETS, TopologyCertainty,
};

use super::core_graphics::{CG_ERROR_SUCCESS, CGDirectDisplayId, CGError};
use crate::DisplayTopologyError;

type BooleanT = u32;

const NULL_DISPLAY: CGDirectDisplayId = 0;

#[link(name = "CoreGraphics", kind = "framework")]
unsafe extern "C" {
    fn CGGetOnlineDisplayList(
        max_displays: u32,
        online_displays: *mut CGDirectDisplayId,
        display_count: *mut u32,
    ) -> CGError;
    fn CGGetActiveDisplayList(
        max_displays: u32,
        active_displays: *mut CGDirectDisplayId,
        display_count: *mut u32,
    ) -> CGError;
    fn CGDisplayIsBuiltin(display: CGDirectDisplayId) -> BooleanT;
    fn CGDisplayIsMain(display: CGDirectDisplayId) -> BooleanT;
    fn CGDisplayIsAsleep(display: CGDirectDisplayId) -> BooleanT;
    fn CGDisplayIsInMirrorSet(display: CGDirectDisplayId) -> BooleanT;
    fn CGDisplayMirrorsDisplay(display: CGDirectDisplayId) -> CGDirectDisplayId;
    fn CGDisplayPixelsWide(display: CGDirectDisplayId) -> usize;
    fn CGDisplayPixelsHigh(display: CGDirectDisplayId) -> usize;
}

pub(super) fn enumerate_topology() -> Result<DisplayTopologySnapshot, DisplayTopologyError> {
    let online = display_list(CGGetOnlineDisplayList, "query online displays")?;
    let active: HashSet<CGDirectDisplayId> =
        display_list(CGGetActiveDisplayList, "query active displays")?
            .into_iter()
            .collect();
    let mut certainty = TopologyCertainty::Complete;
    let targets = online
        .into_iter()
        .map(|display| {
            // CoreGraphics establishes that a built-in panel is physical, but
            // does not reliably classify every external virtual/remote target.
            let builtin = boolean(unsafe { CGDisplayIsBuiltin(display) });
            let kind = if builtin {
                DisplayTargetKind::Physical
            } else {
                certainty = TopologyCertainty::Partial;
                DisplayTargetKind::Unknown
            };
            let mirror_primary = if boolean(unsafe { CGDisplayIsInMirrorSet(display) }) {
                let primary = unsafe { CGDisplayMirrorsDisplay(display) };
                (primary != NULL_DISPLAY).then(|| target_id(primary))
            } else {
                None
            };
            DisplayTarget {
                target_id: target_id(display),
                active: active.contains(&display),
                primary_state: if boolean(unsafe { CGDisplayIsMain(display) }) {
                    DisplayPrimaryState::Primary
                } else {
                    DisplayPrimaryState::NotPrimary
                },
                builtin,
                power_state: if boolean(unsafe { CGDisplayIsAsleep(display) }) {
                    DisplayPowerState::Asleep
                } else {
                    DisplayPowerState::Awake
                },
                kind,
                mirror_primary_id: mirror_primary,
                pixel_width: dimension(unsafe { CGDisplayPixelsWide(display) }),
                pixel_height: dimension(unsafe { CGDisplayPixelsHigh(display) }),
            }
        })
        .collect();
    Ok(DisplayTopologySnapshot { certainty, targets })
}

fn display_list(
    function: unsafe extern "C" fn(u32, *mut CGDirectDisplayId, *mut u32) -> CGError,
    operation: &str,
) -> Result<Vec<CGDirectDisplayId>, DisplayTopologyError> {
    let mut count = 0_u32;
    // SAFETY: a null output list with max_displays zero is the documented count query.
    let count_result = unsafe { function(0, ptr::null_mut(), &raw mut count) };
    if count_result != CG_ERROR_SUCCESS {
        return Err(core_graphics_error(operation, count_result));
    }
    if usize::try_from(count).unwrap_or(usize::MAX) > MAX_DISPLAY_TARGETS {
        return Err(DisplayTopologyError::Backend(format!(
            "{operation} returned {count} displays; protocol maximum is {MAX_DISPLAY_TARGETS}"
        )));
    }
    let mut displays = vec![NULL_DISPLAY; usize::try_from(count).unwrap_or(0)];
    if count == 0 {
        return Ok(displays);
    }
    let mut returned = count;
    // SAFETY: displays has count initialized entries and returned points to writable storage.
    let list_result = unsafe { function(count, displays.as_mut_ptr(), &raw mut returned) };
    if list_result != CG_ERROR_SUCCESS {
        return Err(core_graphics_error(operation, list_result));
    }
    displays.truncate(usize::try_from(returned).unwrap_or(0));
    Ok(displays)
}

fn boolean(value: BooleanT) -> bool {
    value != 0
}

fn dimension(value: usize) -> u32 {
    u32::try_from(value).unwrap_or(u32::MAX)
}

fn target_id(display: CGDirectDisplayId) -> String {
    format!("cg-{display:08x}")
}

fn core_graphics_error(operation: &str, code: CGError) -> DisplayTopologyError {
    DisplayTopologyError::Backend(format!(
        "CoreGraphics could not {operation} (CGError {code})"
    ))
}
