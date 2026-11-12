//! macOS: CoreGraphics display queries.

use objc2_core_graphics::{
    CGDirectDisplayID, CGDisplayIsActive, CGDisplayIsAsleep, CGDisplayIsBuiltin, CGDisplayIsMain,
    CGDisplayMirrorsDisplay, CGError, CGGetOnlineDisplayList,
};

use crate::{MAX_DISPLAYS, OsError, RawDisplay, RawKind, RawTopology};

/// `kCGNullDirectDisplay`.
const NULL_DISPLAY: CGDirectDisplayID = 0;

/// Every online display, including mirrored and sleeping ones that the active list hides.
///
/// CoreGraphics proves that a built-in panel is physical. It cannot reliably tell an external
/// monitor from a virtual or wireless (`AirPlay`, `Sidecar`) target, so external displays are left
/// unclassified until the `IORegistry` transport classification is proved.
///
/// # Errors
/// When CoreGraphics fails, or reports more than [`MAX_DISPLAYS`] displays.
pub fn online_displays() -> Result<RawTopology, OsError> {
    let mut ids: [CGDirectDisplayID; MAX_DISPLAYS + 1] = [NULL_DISPLAY; MAX_DISPLAYS + 1];
    let mut count: u32 = 0;
    let capacity = u32::try_from(ids.len()).unwrap_or(u32::MAX);
    // SAFETY: `ids` is a writable array of `capacity` display IDs and `count` is a valid `u32`;
    // CoreGraphics writes at most `capacity` IDs and sets `count` to the number written.
    let status = unsafe { CGGetOnlineDisplayList(capacity, ids.as_mut_ptr(), &raw mut count) };
    if status != CGError::Success {
        return Err(OsError {
            operation: "CGGetOnlineDisplayList",
            status: i64::from(status.0),
        });
    }
    let count = usize::try_from(count).unwrap_or(usize::MAX);
    if count > MAX_DISPLAYS {
        return Err(OsError {
            operation: "CGGetOnlineDisplayList",
            status: -1,
        });
    }
    let displays = ids[..count]
        .iter()
        .map(|&id| {
            let mirrored = CGDisplayMirrorsDisplay(id);
            RawDisplay {
                id: u64::from(id),
                kind: if CGDisplayIsBuiltin(id) {
                    RawKind::BuiltIn
                } else {
                    RawKind::Unclassified
                },
                active: CGDisplayIsActive(id),
                main: CGDisplayIsMain(id),
                asleep: CGDisplayIsAsleep(id),
                mirror_of: (mirrored != NULL_DISPLAY).then_some(u64::from(mirrored)),
            }
        })
        .collect();
    Ok(RawTopology {
        displays,
        mirroring_known: true,
    })
}
