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

    pub(super) fn value<'a>(dictionary: &'a CFDictionary, key: &CFString) -> Option<&'a CFType> {
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

    pub(super) fn number(dictionary: &CFDictionary, key: &CFString) -> Option<f64> {
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

/// The general pasteboard's change count. Content, types and owner are never read.
#[must_use]
pub fn clipboard_change_count() -> Option<u64> {
    objc2::rc::autoreleasepool(|_| {
        let pasteboard = objc2_app_kit::NSPasteboard::generalPasteboard();
        u64::try_from(pasteboard.changeCount()).ok()
    })
}

fn sysctl_text(name: &std::ffi::CStr) -> Option<String> {
    let mut length = 0_usize;
    // SAFETY: querying the length with a null buffer is the documented first step.
    let sized = unsafe {
        libc::sysctlbyname(
            name.as_ptr(),
            std::ptr::null_mut(),
            &raw mut length,
            std::ptr::null_mut(),
            0,
        )
    };
    if sized != 0 || length == 0 || length > 256 {
        return None;
    }
    let mut buffer = vec![0_u8; length];
    // SAFETY: `buffer` holds `length` writable bytes, as the size query reported.
    let read = unsafe {
        libc::sysctlbyname(
            name.as_ptr(),
            buffer.as_mut_ptr().cast(),
            &raw mut length,
            std::ptr::null_mut(),
            0,
        )
    };
    if read != 0 {
        return None;
    }
    buffer.truncate(length);
    let text = buffer.split(|byte| *byte == 0).next().unwrap_or_default();
    String::from_utf8(text.to_vec()).ok()
}

fn sysctl_int(name: &std::ffi::CStr) -> Option<i32> {
    let mut value = 0_i32;
    let mut length = size_of::<i32>();
    // SAFETY: `value` is a writable `i32` of exactly `length` bytes.
    let read = unsafe {
        libc::sysctlbyname(
            name.as_ptr(),
            (&raw mut value).cast(),
            &raw mut length,
            std::ptr::null_mut(),
            0,
        )
    };
    (read == 0 && length == size_of::<i32>()).then_some(value)
}

/// Virtualization evidence: the kernel's VMM-present flag and the hardware model. A real
/// Apple-silicon model (`Mac<major>,<minor>`) with no VMM flag is positive physical evidence.
#[must_use]
pub fn virtualization() -> crate::RawVirtualization {
    use crate::{RawHypervisor, RawVirtualization};
    let Some(vmm) = sysctl_int(c"kern.hv_vmm_present") else {
        return RawVirtualization::unprobed();
    };
    let model = sysctl_text(c"hw.model").unwrap_or_default();
    if vmm == 1 {
        let family = if model.starts_with("VirtualMac") {
            RawHypervisor::AppleVirtualization
        } else if model.starts_with("VMware") {
            RawHypervisor::Vmware
        } else if model.starts_with("Parallels") {
            RawHypervisor::Parallels
        } else {
            RawHypervisor::Other
        };
        return RawVirtualization {
            probed: true,
            guest_of: family,
            physical_or_root: false,
        };
    }
    let apple_silicon_model = cfg!(target_arch = "aarch64") && is_apple_hardware_model(&model);
    RawVirtualization {
        probed: true,
        guest_of: RawHypervisor::None,
        physical_or_root: apple_silicon_model,
    }
}

/// Whether `model` is an Apple hardware model identifier: a family (`Mac`, `MacBookPro`,
/// `MacBookAir`, `Macmini`, `iMac`, `MacPro`) followed by `<major>,<minor>`. Apple's virtualization
/// framework reports `VirtualMac…`, which does not match.
#[must_use]
pub fn is_apple_hardware_model(model: &str) -> bool {
    const FAMILIES: [&str; 6] = [
        "MacBookPro",
        "MacBookAir",
        "Macmini",
        "MacPro",
        "iMac",
        "Mac",
    ];
    let digits = |text: &str| !text.is_empty() && text.bytes().all(|byte| byte.is_ascii_digit());
    FAMILIES.iter().any(|family| {
        model
            .strip_prefix(family)
            .and_then(|rest| rest.split_once(','))
            .is_some_and(|(major, minor)| digits(major) && digits(minor))
    })
}

mod storage {
    use std::collections::BTreeMap;
    use std::ffi::{CStr, c_char};

    use objc2_core_foundation::{
        CFBoolean, CFDictionary, CFNumber, CFNumberType, CFRetained, CFString, CFType,
    };
    use objc2_io_kit::{
        IOIteratorNext, IOObjectConformsTo, IOObjectRelease, IORegistryEntryCreateCFProperty,
        IORegistryEntryGetParentEntry, IORegistryEntrySearchCFProperty,
        IOServiceGetMatchingServices, IOServiceMatching, io_object_t, kIOMainPortDefault,
        kIORegistryIterateParents, kIORegistryIterateRecursively,
    };

    use crate::{RawStorageDevice, RawStorageKind, RawTransport, fingerprint};

    const MAX_ENTRIES: usize = 512;
    /// The USB interface class for still-image devices: phones and cameras (PTP, often with MTP).
    const STILL_IMAGE_CLASS: f64 = 6.0;

    /// An `IOKit` name buffer (`io_name_t`) holding `name`.
    fn name_buffer(name: &CStr) -> [c_char; 128] {
        let mut buffer = [0 as c_char; 128];
        for (slot, byte) in buffer.iter_mut().zip(name.to_bytes().iter().take(127)) {
            *slot = c_char::from_ne_bytes([*byte]);
        }
        buffer
    }

    /// Visits every registered service of `class`; each is released after `visit` returns.
    fn each_service(class: &CStr, mut visit: impl FnMut(io_object_t)) -> Option<()> {
        // SAFETY: `class` is a NUL-terminated IOKit class name.
        let matching = unsafe { IOServiceMatching(class.as_ptr()) }?;
        // The call consumes one reference: hand it a dictionary reference of its own.
        let matching: CFRetained<CFDictionary> = CFRetained::from(&**matching);
        let mut iterator: io_object_t = 0;
        // SAFETY: the default main port is always valid, the call consumes the one `matching`
        // reference it is given, and `iterator` is a valid out-parameter.
        let status = unsafe {
            IOServiceGetMatchingServices(kIOMainPortDefault, Some(matching), &raw mut iterator)
        };
        if status != 0 {
            return None;
        }
        for _ in 0..MAX_ENTRIES {
            let service = IOIteratorNext(iterator);
            if service == 0 {
                break;
            }
            visit(service);
            IOObjectRelease(service);
        }
        IOObjectRelease(iterator);
        Some(())
    }

    fn property(service: io_object_t, key: &str) -> Option<CFRetained<CFType>> {
        let key = CFString::from_str(key);
        // SAFETY: `service` is a live registry entry and `key` a valid CFString.
        unsafe { IORegistryEntryCreateCFProperty(service, Some(&key), None, 0) }
    }

    /// Reads `key` from the entry or its nearest ancestor in the service plane.
    fn inherited(service: io_object_t, key: &str) -> Option<CFRetained<CFType>> {
        let key = CFString::from_str(key);
        let mut plane = name_buffer(c"IOService");
        // SAFETY: `service` is a live registry entry, `plane` names the service plane and stays
        // alive for the call, and `key` is a valid CFString.
        unsafe {
            IORegistryEntrySearchCFProperty(
                service,
                (&raw mut plane).cast(),
                Some(&key),
                None,
                kIORegistryIterateRecursively | kIORegistryIterateParents,
            )
        }
    }

    /// Whether the entry's provider is a block-storage driver: true for a physical disk, false for
    /// a disk synthesized on top of another (an APFS container), which would count a device twice.
    fn is_physical_disk(service: io_object_t) -> bool {
        let mut plane = name_buffer(c"IOService");
        let mut parent: io_object_t = 0;
        // SAFETY: `service` is live, `plane` names the service plane, `parent` is a valid
        // out-parameter.
        let status = unsafe {
            IORegistryEntryGetParentEntry(service, (&raw mut plane).cast(), &raw mut parent)
        };
        if status != 0 {
            return false;
        }
        let mut class = name_buffer(c"IOBlockStorageDriver");
        // SAFETY: `parent` is the live entry just returned and `class` is a NUL-terminated name.
        let conforms = unsafe { IOObjectConformsTo(parent, (&raw mut class).cast()) };
        IOObjectRelease(parent);
        conforms
    }

    fn boolean(value: Option<CFRetained<CFType>>) -> Option<bool> {
        value?.downcast_ref::<CFBoolean>().map(CFBoolean::as_bool)
    }

    fn text(value: Option<&CFType>) -> Option<String> {
        value?.downcast_ref::<CFString>().map(ToString::to_string)
    }

    fn number(value: Option<CFRetained<CFType>>) -> Option<f64> {
        let value = value?;
        let number = value.downcast_ref::<CFNumber>()?;
        let mut result = 0.0_f64;
        // SAFETY: `result` is a valid `f64` for the double conversion CoreFoundation writes.
        let converted = unsafe { number.value(CFNumberType::DoubleType, (&raw mut result).cast()) };
        converted.then_some(result)
    }

    /// The whole-disk BSD names (`diskN`) that have a mounted file system.
    fn mounted_disks() -> Vec<String> {
        let mut table: *mut libc::statfs = std::ptr::null_mut();
        // SAFETY: `table` is a valid out-parameter; the returned table belongs to libc.
        let count = unsafe { libc::getmntinfo(&raw mut table, libc::MNT_NOWAIT) };
        let count = usize::try_from(count).unwrap_or(0).min(MAX_ENTRIES);
        if table.is_null() || count == 0 {
            return Vec::new();
        }
        // SAFETY: `getmntinfo` returned `count` initialized entries starting at `table`.
        let entries = unsafe { std::slice::from_raw_parts(table, count) };
        entries
            .iter()
            .filter_map(|entry| {
                // SAFETY: `f_mntfromname` is a NUL-terminated string within its array.
                let source = unsafe { CStr::from_ptr(entry.f_mntfromname.as_ptr()) };
                crate::whole_disk(&source.to_string_lossy())
            })
            .collect()
    }

    fn transport(interconnect: &str) -> RawTransport {
        match interconnect {
            "USB" => RawTransport::Usb,
            "Thunderbolt" => RawTransport::Thunderbolt,
            "Secure Digital" | "SD" | "SDXC" => RawTransport::Sd,
            "" => RawTransport::Unknown,
            _ => RawTransport::Other,
        }
    }

    /// Whole removable or external disks, mounted or not. Disk images and disks synthesized on
    /// another disk are not devices.
    #[must_use]
    pub fn block_devices() -> Option<Vec<RawStorageDevice>> {
        let mounted = mounted_disks();
        let mut devices = Vec::new();
        each_service(c"IOMedia", |service| {
            if boolean(property(service, "Whole")) != Some(true) || !is_physical_disk(service) {
                return;
            }
            let characteristics = inherited(service, "Protocol Characteristics");
            let characteristics = characteristics
                .as_deref()
                .and_then(|value| value.downcast_ref::<CFDictionary>());
            let read = |key: &str| {
                characteristics
                    .and_then(|dictionary| {
                        text(super::window::value(dictionary, &CFString::from_str(key)))
                    })
                    .unwrap_or_default()
            };
            let interconnect = read("Physical Interconnect");
            if interconnect == "Virtual Interface" {
                return;
            }
            let removable = boolean(property(service, "Removable")) == Some(true)
                || boolean(property(service, "Ejectable")) == Some(true);
            if !removable && read("Physical Interconnect Location") != "External" {
                return;
            }
            let Some(name) = text(property(service, "BSD Name").as_deref()) else {
                return;
            };
            devices.push(RawStorageDevice {
                key: fingerprint(name.as_bytes()),
                kind: RawStorageKind::Block,
                transport: transport(&interconnect),
                mounted: Some(mounted.contains(&name)),
                writable: boolean(property(service, "Writable")),
            });
        })?;
        devices.sort();
        Some(devices)
    }

    /// Phones and cameras that expose a still-image USB interface. One device may expose several
    /// interfaces; they share the device's location and count once.
    #[must_use]
    pub fn portable_devices() -> Option<Vec<RawStorageDevice>> {
        let mut devices: BTreeMap<u64, RawStorageDevice> = BTreeMap::new();
        each_service(c"IOUSBHostInterface", |service| {
            if number(property(service, "bInterfaceClass")) != Some(STILL_IMAGE_CLASS) {
                return;
            }
            let location = number(inherited(service, "locationID")).unwrap_or(0.0);
            let key = fingerprint(&location.to_bits().to_le_bytes());
            devices.entry(key).or_insert(RawStorageDevice {
                key,
                kind: RawStorageKind::Portable,
                transport: RawTransport::Usb,
                mounted: None,
                writable: None,
            });
        })?;
        Some(devices.into_values().collect())
    }
}

pub use storage::{block_devices, portable_devices};

#[cfg(test)]
mod model_tests {
    use super::is_apple_hardware_model;

    #[test]
    fn apple_hardware_models_are_recognized_and_virtual_ones_are_not() {
        for model in [
            "Macmini9,1",
            "MacBookPro18,3",
            "MacBookAir10,1",
            "iMac21,1",
            "Mac14,2",
            "MacPro7,1",
        ] {
            assert!(is_apple_hardware_model(model), "{model}");
        }
        for model in [
            "VirtualMac2,1",
            "VMware7,1",
            "Parallels-ARM",
            "Mac",
            "Macmini9",
            "MacBookPro,1",
            "",
        ] {
            assert!(!is_apple_hardware_model(model), "{model}");
        }
    }
}

mod network {
    use std::ffi::CStr;

    use objc2_core_foundation::CFString;
    use objc2_system_configuration::{
        SCDynamicStore, kSCPropNetProxiesFTPEnable, kSCPropNetProxiesHTTPEnable,
        kSCPropNetProxiesHTTPSEnable, kSCPropNetProxiesProxyAutoConfigEnable,
        kSCPropNetProxiesProxyAutoDiscoveryEnable, kSCPropNetProxiesSOCKSEnable,
    };

    use crate::{RawProxy, RawTunnel, RawTunnelClass, fingerprint};

    const MAX_INTERFACES: usize = 256;

    fn enabled(dictionary: &objc2_core_foundation::CFDictionary, key: &CFString) -> bool {
        super::window::number(dictionary, key).is_some_and(|value| value >= 1.0)
    }

    /// Whether a system proxy is configured, and of which kind. Hosts, ports and the PAC script are
    /// never read.
    #[must_use]
    pub fn system_proxy() -> Option<RawProxy> {
        let proxies = SCDynamicStore::proxies(None)?;
        // SAFETY: these are immutable SystemConfiguration constants.
        let manual = unsafe {
            [
                kSCPropNetProxiesHTTPEnable,
                kSCPropNetProxiesHTTPSEnable,
                kSCPropNetProxiesSOCKSEnable,
                kSCPropNetProxiesFTPEnable,
            ]
        };
        // SAFETY: immutable SystemConfiguration constants.
        let (pac, discovery) = unsafe {
            (
                kSCPropNetProxiesProxyAutoConfigEnable,
                kSCPropNetProxiesProxyAutoDiscoveryEnable,
            )
        };
        Some(if manual.iter().any(|key| enabled(&proxies, key)) {
            RawProxy::Manual
        } else if enabled(&proxies, pac) {
            RawProxy::AutomaticConfig
        } else if enabled(&proxies, discovery) {
            RawProxy::AutoDetect
        } else {
            RawProxy::None
        })
    }

    /// Up tunnel interfaces. A `utun` counts only with a routable address: macOS creates `utun`
    /// interfaces with link-local addresses only for iCloud Private Relay and Continuity.
    #[must_use]
    pub fn tunnels() -> Option<Vec<RawTunnel>> {
        let mut list: *mut libc::ifaddrs = std::ptr::null_mut();
        // SAFETY: `list` is a valid out-parameter; on success the OS allocates the list.
        if unsafe { libc::getifaddrs(&raw mut list) } != 0 {
            return None;
        }
        let mut seen: std::collections::BTreeMap<Vec<u8>, (RawTunnelClass, bool)> =
            std::collections::BTreeMap::new();
        let mut cursor = list;
        let mut visited = 0_usize;
        while !cursor.is_null() && visited < MAX_INTERFACES * 8 {
            visited += 1;
            // SAFETY: `cursor` is a non-null node of the list the OS returned.
            let entry = unsafe { &*cursor };
            cursor = entry.ifa_next;
            if entry.ifa_name.is_null() {
                continue;
            }
            // SAFETY: interface names are NUL-terminated strings owned by the list.
            let name = unsafe { CStr::from_ptr(entry.ifa_name) }
                .to_bytes()
                .to_vec();
            let flags = entry.ifa_flags;
            let up = flags & (libc::IFF_UP as u32) != 0 && flags & (libc::IFF_RUNNING as u32) != 0;
            let class = if name.starts_with(b"utun") {
                RawTunnelClass::PacketTunnel
            } else if name.starts_with(b"ipsec") {
                RawTunnelClass::ManagedVpn
            } else if name.starts_with(b"ppp") {
                RawTunnelClass::PointToPoint
            } else if name.starts_with(b"tap") {
                RawTunnelClass::VirtualEthernet
            } else if name.starts_with(b"tun") {
                RawTunnelClass::PacketTunnel
            } else {
                continue;
            };
            let routable = !entry.ifa_addr.is_null() && routable_address(entry.ifa_addr);
            let slot = seen.entry(name).or_insert((class, false));
            if up && (class != RawTunnelClass::PacketTunnel || routable) {
                slot.1 = true;
            }
            if seen.len() > MAX_INTERFACES {
                break;
            }
        }
        // SAFETY: frees the list returned by `getifaddrs` exactly once.
        unsafe { libc::freeifaddrs(list) };
        Some(
            seen.into_iter()
                .filter(|(_, (_, active))| *active)
                .map(|(name, (class, _))| RawTunnel {
                    key: fingerprint(&name),
                    class,
                })
                .collect(),
        )
    }

    fn routable_address(address: *const libc::sockaddr) -> bool {
        // SAFETY: `address` is a non-null address owned by the interface list.
        let family = i32::from(unsafe { (*address).sa_family });
        if family == libc::AF_INET {
            return true;
        }
        if family == libc::AF_INET6 {
            // SAFETY: an AF_INET6 address is a `sockaddr_in6`; it is copied out unaligned.
            let ipv6 = unsafe { address.cast::<libc::sockaddr_in6>().read_unaligned() };
            let bytes = ipv6.sin6_addr.s6_addr;
            // fe80::/10 is link-local.
            return !(bytes[0] == 0xfe && bytes[1] & 0xc0 == 0x80);
        }
        false
    }

    /// A fingerprint of the routing table; it changes whenever a route changes.
    #[must_use]
    pub fn route_fingerprint() -> Option<u64> {
        let mut mib = [libc::CTL_NET, libc::PF_ROUTE, 0, 0, libc::NET_RT_DUMP, 0];
        let mut length = 0_usize;
        let count = u32::try_from(mib.len()).unwrap_or(6);
        // SAFETY: querying the length with a null buffer is the documented first step.
        let sized = unsafe {
            libc::sysctl(
                mib.as_mut_ptr(),
                count,
                std::ptr::null_mut(),
                &raw mut length,
                std::ptr::null_mut(),
                0,
            )
        };
        if sized != 0 || length > 16 * 1024 * 1024 {
            return None;
        }
        let mut buffer = vec![0_u8; length];
        // SAFETY: `buffer` holds `length` writable bytes.
        let read = unsafe {
            libc::sysctl(
                mib.as_mut_ptr(),
                count,
                buffer.as_mut_ptr().cast(),
                &raw mut length,
                std::ptr::null_mut(),
                0,
            )
        };
        (read == 0).then(|| fingerprint(&buffer[..length.min(buffer.len())]))
    }
}

pub use network::{route_fingerprint, system_proxy, tunnels};
