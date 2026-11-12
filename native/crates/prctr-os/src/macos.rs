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

mod window {
    use std::ffi::c_void;

    use objc2_core_foundation::{
        CFArray, CFDictionary, CFNumber, CFNumberType, CFString, CFType, CGRect,
    };
    #[cfg(test)]
    use objc2_core_graphics::kCGWindowNumber;
    use objc2_core_graphics::{
        CGRectMakeWithDictionaryRepresentation, CGWindowListCopyWindowInfo, CGWindowListOption,
        CGWindowSharingType, kCGWindowAlpha, kCGWindowBounds, kCGWindowLayer, kCGWindowOwnerPID,
        kCGWindowSharingState,
    };

    use crate::{RawWindow, Rect};

    /// The dock window level; it can overlap a window's edge without covering exam content.
    const DOCK_LAYER: f64 = 20.0;
    /// Assistive-technology overlays and the cursor sit at or above this level and never count.
    const ASSISTIVE_LAYER: f64 = 1500.0;

    fn entries(array: &CFArray) -> Vec<&CFDictionary> {
        (0..array.count())
            .filter_map(|index| {
                // SAFETY: `index` is within `0..count`, so the array returns a valid element pointer
                // that the array keeps alive while it is borrowed.
                let value = unsafe { array.value_at_index(index) };
                if value.is_null() {
                    return None;
                }
                // SAFETY: every element of a CoreFoundation array is a CoreFoundation object.
                let object = unsafe { &*value.cast::<CFType>() };
                object.downcast_ref::<CFDictionary>()
            })
            .collect()
    }

    fn value<'a>(dictionary: &'a CFDictionary, key: &CFString) -> Option<&'a CFType> {
        let key: *const c_void = std::ptr::from_ref::<CFString>(key).cast();
        // SAFETY: the window-info dictionary uses CFString keys; the value it returns is owned by
        // the dictionary and stays valid while the dictionary is borrowed.
        let value = unsafe { dictionary.value(key) };
        if value.is_null() {
            return None;
        }
        // SAFETY: dictionary values are CoreFoundation objects.
        Some(unsafe { &*value.cast::<CFType>() })
    }

    fn number(dictionary: &CFDictionary, key: &CFString) -> Option<f64> {
        let number = value(dictionary, key)?.downcast_ref::<CFNumber>()?;
        let mut result = 0.0_f64;
        // SAFETY: `result` is a valid `f64` for the double conversion CoreFoundation writes.
        let converted = unsafe { number.value(CFNumberType::DoubleType, (&raw mut result).cast()) };
        converted.then_some(result)
    }

    fn bounds(dictionary: &CFDictionary) -> Option<Rect> {
        let representation = value(dictionary, key(BoundsKey))?.downcast_ref::<CFDictionary>()?;
        let mut rect = CGRect::default();
        // SAFETY: `representation` is the bounds dictionary CoreGraphics produced and `rect` is a
        // valid `CGRect` to write into.
        let parsed =
            unsafe { CGRectMakeWithDictionaryRepresentation(Some(representation), &raw mut rect) };
        parsed.then_some(Rect {
            x: rect.origin.x,
            y: rect.origin.y,
            width: rect.size.width,
            height: rect.size.height,
        })
    }

    #[derive(Clone, Copy)]
    enum Key {
        Bounds,
        Layer,
        Alpha,
        OwnerPid,
        Sharing,
        #[cfg(test)]
        Number,
    }
    use Key::Bounds as BoundsKey;

    fn key(key: Key) -> &'static CFString {
        // SAFETY: these are immutable CoreGraphics constants, initialised before any code runs.
        unsafe {
            match key {
                Key::Bounds => kCGWindowBounds,
                Key::Layer => kCGWindowLayer,
                Key::Alpha => kCGWindowAlpha,
                Key::OwnerPid => kCGWindowOwnerPID,
                Key::Sharing => kCGWindowSharingState,
                #[cfg(test)]
                Key::Number => kCGWindowNumber,
            }
        }
    }

    /// Reads the window with this CoreGraphics window number and the windows above it.
    #[must_use]
    pub fn window(window_number: u32) -> RawWindow {
        let Some(own) =
            CGWindowListCopyWindowInfo(CGWindowListOption::OptionIncludingWindow, window_number)
        else {
            return RawWindow::default();
        };
        let Some(own) = entries(&own).first().copied().map(|entry| {
            let owner = number(entry, key(Key::OwnerPid));
            let sharing = number(entry, key(Key::Sharing));
            (owner, sharing, bounds(entry))
        }) else {
            return RawWindow::default();
        };
        let (owner, sharing, own_bounds) = own;
        let mut covering = Vec::new();
        let options = CGWindowListOption::OptionOnScreenAboveWindow
            | CGWindowListOption::ExcludeDesktopElements;
        if let Some(above) = CGWindowListCopyWindowInfo(options, window_number) {
            for entry in entries(&above) {
                let layer = number(entry, key(Key::Layer)).unwrap_or(0.0);
                let alpha = number(entry, key(Key::Alpha)).unwrap_or(1.0);
                let same_process = owner.is_some() && number(entry, key(Key::OwnerPid)) == owner;
                let ignored = same_process
                    || alpha <= 0.0
                    || (layer - DOCK_LAYER).abs() < f64::EPSILON
                    || layer >= ASSISTIVE_LAYER;
                if let (false, Some(rect)) = (ignored, bounds(entry)) {
                    covering.push(rect);
                }
            }
        }
        RawWindow {
            found: true,
            capture_excluded: sharing
                .map(|state| (state - f64::from(CGWindowSharingType::None.0)).abs() < f64::EPSILON),
            bounds: own_bounds,
            covering,
        }
    }

    #[cfg(test)]
    mod tests {
        use super::*;

        /// Real OS: another application's window can be read from this process, as the agent reads
        /// the Electron window. Skipped when nothing is on screen (headless runners).
        #[test]
        fn another_process_window_can_be_read_back() {
            let Some(list) = CGWindowListCopyWindowInfo(CGWindowListOption::OptionOnScreenOnly, 0)
            else {
                assert!(
                    std::env::var_os("PRCTR_REQUIRE_WINDOW").is_none(),
                    "no window list"
                );
                return;
            };
            let candidate = entries(&list).into_iter().find_map(|entry| {
                let layer = number(entry, key(Key::Layer))?;
                let size = bounds(entry)?;
                (layer.abs() < f64::EPSILON && size.area() > 10_000.0)
                    .then(|| number(entry, key(Key::Number)))?
            });
            let Some(window_number) = candidate else {
                assert!(
                    std::env::var_os("PRCTR_REQUIRE_WINDOW").is_none(),
                    "no on-screen window to read"
                );
                return;
            };
            #[allow(clippy::cast_possible_truncation, clippy::cast_sign_loss)]
            // Window numbers are whole numbers stored as doubles.
            let read = window(window_number as u32);
            assert!(read.found, "the window list includes the window");
            assert!(
                read.bounds.is_some_and(|rect| rect.area() > 0.0),
                "its bounds are read"
            );
            assert!(read.capture_excluded.is_some(), "its sharing state is read");
        }
    }
}

pub use window::window;

mod session {
    use std::ffi::CStr;

    use objc2_core_foundation::{CFBoolean, CFDictionary, CFString, CFType};
    use objc2_core_graphics::CGSessionCopyCurrentDictionary;

    use crate::RawSession;

    /// `kCGSessionOnConsoleKey` and the screen-lock key, which CoreGraphics defines only as strings.
    const ON_CONSOLE: &str = "kCGSSessionOnConsoleKey";
    const SCREEN_LOCKED: &str = "CGSSessionScreenIsLocked";
    /// `USER_PROCESS` in `utmpx`.
    const USER_PROCESS: i16 = 7;

    fn boolean(dictionary: &CFDictionary, key: &'static str) -> Option<bool> {
        let key = CFString::from_static_str(key);
        let key_pointer: *const std::ffi::c_void = std::ptr::from_ref::<CFString>(&key).cast();
        // SAFETY: the session dictionary uses CFString keys; the value is owned by the dictionary
        // and stays valid while it is borrowed.
        let value = unsafe { dictionary.value(key_pointer) };
        if value.is_null() {
            return None;
        }
        // SAFETY: dictionary values are CoreFoundation objects.
        let object = unsafe { &*value.cast::<CFType>() };
        object.downcast_ref::<CFBoolean>().map(CFBoolean::as_bool)
    }

    /// Other users with a login session (`utmpx` user processes), not counting this user.
    fn other_users() -> Option<u64> {
        // SAFETY: `getuid` has no preconditions.
        let uid = unsafe { libc::getuid() };
        // SAFETY: `getpwuid` returns null or a pointer to a static record valid until the next call
        // on this thread; it is read immediately.
        let account = unsafe { libc::getpwuid(uid) };
        if account.is_null() {
            return None;
        }
        // SAFETY: a non-null record from `getpwuid` is valid to read.
        let name = unsafe { (*account).pw_name };
        // SAFETY: `pw_name` of a valid record is a NUL-terminated string.
        let own = unsafe { CStr::from_ptr(name) }.to_bytes().to_vec();
        let mut others = std::collections::BTreeSet::new();
        // SAFETY: `setutxent` rewinds the process-wide utmpx cursor; no other code here uses it.
        unsafe { libc::setutxent() };
        loop {
            // SAFETY: `getutxent` returns null at the end or a pointer valid until the next call.
            let entry = unsafe { libc::getutxent() };
            if entry.is_null() {
                break;
            }
            // SAFETY: a non-null entry is a valid `utmpx` record.
            let record = unsafe { &*entry };
            if record.ut_type != USER_PROCESS {
                continue;
            }
            let name: Vec<u8> = record
                .ut_user
                .iter()
                .take_while(|byte| **byte != 0)
                .map(|byte| byte.to_ne_bytes()[0])
                .collect();
            if !name.is_empty() && name != own {
                others.insert(name);
            }
            if others.len() > 1024 {
                break;
            }
        }
        // SAFETY: closes the cursor opened above.
        unsafe { libc::endutxent() };
        u64::try_from(others.len()).ok()
    }

    /// The current session from the window server, plus other logged-in users from `utmpx`.
    /// Remote viewing is not visible without the Endpoint Security extension.
    #[must_use]
    pub fn session() -> RawSession {
        let Some(dictionary) = CGSessionCopyCurrentDictionary() else {
            return RawSession {
                on_console: Some(false),
                ..RawSession::default()
            };
        };
        RawSession {
            on_console: boolean(&dictionary, ON_CONSOLE),
            locked: Some(boolean(&dictionary, SCREEN_LOCKED).unwrap_or(false)),
            remote: None,
            other_human_sessions: other_users(),
        }
    }
}

pub use session::session;
