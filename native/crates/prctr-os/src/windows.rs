//! Windows: the display configuration API over every path, not only active ones.

use std::collections::BTreeMap;

use windows::Win32::Devices::Display::{
    DISPLAYCONFIG_MODE_INFO, DISPLAYCONFIG_OUTPUT_TECHNOLOGY_DISPLAYPORT_EMBEDDED,
    DISPLAYCONFIG_OUTPUT_TECHNOLOGY_INDIRECT_VIRTUAL,
    DISPLAYCONFIG_OUTPUT_TECHNOLOGY_INDIRECT_WIRED, DISPLAYCONFIG_OUTPUT_TECHNOLOGY_INTERNAL,
    DISPLAYCONFIG_OUTPUT_TECHNOLOGY_MIRACAST, DISPLAYCONFIG_OUTPUT_TECHNOLOGY_UDI_EMBEDDED,
    DISPLAYCONFIG_PATH_INFO, GetDisplayConfigBufferSizes, QDC_ALL_PATHS, QueryDisplayConfig,
};
use windows::Win32::Foundation::{ERROR_INSUFFICIENT_BUFFER, ERROR_SUCCESS, WIN32_ERROR};

use crate::{MAX_DISPLAYS, OsError, RawDisplay, RawKind, RawTopology};

/// `DISPLAYCONFIG_PATH_ACTIVE`.
const PATH_ACTIVE: u32 = 0x0000_0001;
const ATTEMPTS: usize = 3;

fn failed(operation: &'static str, status: WIN32_ERROR) -> OsError {
    OsError {
        operation,
        status: i64::from(status.0),
    }
}

fn query_paths() -> Result<Vec<DISPLAYCONFIG_PATH_INFO>, OsError> {
    for _ in 0..ATTEMPTS {
        let mut path_count = 0_u32;
        let mut mode_count = 0_u32;
        // SAFETY: both counts are valid writable `u32`s; the call only writes the buffer sizes.
        let status = unsafe {
            GetDisplayConfigBufferSizes(QDC_ALL_PATHS, &raw mut path_count, &raw mut mode_count)
        };
        if status != ERROR_SUCCESS {
            return Err(failed("GetDisplayConfigBufferSizes", status));
        }
        let mut paths = vec![DISPLAYCONFIG_PATH_INFO::default(); path_count as usize];
        let mut modes = vec![DISPLAYCONFIG_MODE_INFO::default(); mode_count as usize];
        // SAFETY: `paths` and `modes` hold exactly `path_count` and `mode_count` initialised
        // elements; the call writes at most that many and updates the counts to the number written.
        let status = unsafe {
            QueryDisplayConfig(
                QDC_ALL_PATHS,
                &raw mut path_count,
                paths.as_mut_ptr(),
                &raw mut mode_count,
                modes.as_mut_ptr(),
                None,
            )
        };
        if status == ERROR_INSUFFICIENT_BUFFER {
            // The topology changed between the two calls; query again.
            continue;
        }
        if status != ERROR_SUCCESS {
            return Err(failed("QueryDisplayConfig", status));
        }
        paths.truncate(path_count as usize);
        return Ok(paths);
    }
    Err(failed("QueryDisplayConfig", ERROR_INSUFFICIENT_BUFFER))
}

/// Every available display target, with activity, mirroring and output technology.
///
/// # Errors
/// When the display configuration cannot be read, or reports more than [`MAX_DISPLAYS`] targets.
pub fn display_targets() -> Result<RawTopology, OsError> {
    let paths = query_paths()?;
    // One entry per physical target, keyed by adapter and target id; QDC_ALL_PATHS repeats a
    // target once per possible source.
    let mut targets: BTreeMap<(u32, i32, u32), RawDisplay> = BTreeMap::new();
    let mut sources: BTreeMap<(u32, i32, u32), u64> = BTreeMap::new();
    for path in &paths {
        let target = &path.targetInfo;
        if !target.targetAvailable.as_bool() {
            continue;
        }
        let key = (
            target.adapterId.LowPart,
            target.adapterId.HighPart,
            target.id,
        );
        let id = u64::try_from(targets.len()).unwrap_or(u64::MAX);
        let technology = target.outputTechnology;
        let kind = if technology == DISPLAYCONFIG_OUTPUT_TECHNOLOGY_INTERNAL
            || technology == DISPLAYCONFIG_OUTPUT_TECHNOLOGY_DISPLAYPORT_EMBEDDED
            || technology == DISPLAYCONFIG_OUTPUT_TECHNOLOGY_UDI_EMBEDDED
        {
            RawKind::BuiltIn
        } else if technology == DISPLAYCONFIG_OUTPUT_TECHNOLOGY_INDIRECT_VIRTUAL {
            RawKind::Virtual
        } else if technology == DISPLAYCONFIG_OUTPUT_TECHNOLOGY_MIRACAST {
            RawKind::Wireless
        } else if technology == DISPLAYCONFIG_OUTPUT_TECHNOLOGY_INDIRECT_WIRED {
            RawKind::IndirectExternal
        } else {
            RawKind::External
        };
        let entry = targets.entry(key).or_insert_with(|| RawDisplay {
            id,
            kind,
            active: false,
            main: false,
            asleep: false,
            mirror_of: None,
        });
        if path.flags & PATH_ACTIVE != 0 && !entry.active {
            entry.active = true;
            let source = (
                path.sourceInfo.adapterId.LowPart,
                path.sourceInfo.adapterId.HighPart,
                path.sourceInfo.id,
            );
            // Two active paths from one source are a clone: the later target mirrors the first.
            match sources.get(&source) {
                Some(first) => entry.mirror_of = Some(*first),
                None => {
                    sources.insert(source, entry.id);
                }
            }
        }
        if targets.len() > MAX_DISPLAYS {
            return Err(failed("QueryDisplayConfig", ERROR_INSUFFICIENT_BUFFER));
        }
    }
    Ok(RawTopology {
        displays: targets.into_values().collect(),
        mirroring_known: true,
    })
}

#[path = "windows_capture.rs"]
mod capture;

pub use capture::{H264Mft, RawFrame, ScreenCapture};

mod window {
    use std::ffi::c_void;

    use windows::Win32::Foundation::{HWND, RECT};
    use windows::Win32::Graphics::Dwm::{DWMWA_CLOAKED, DwmGetWindowAttribute};
    use windows::Win32::UI::WindowsAndMessaging::{
        GW_HWNDPREV, GetWindow, GetWindowDisplayAffinity, GetWindowRect, GetWindowThreadProcessId,
        IsWindow, IsWindowVisible, WDA_EXCLUDEFROMCAPTURE, WDA_MONITOR,
    };

    use crate::{RawWindow, Rect};

    /// Bounds the z-order walk; a desktop never has more top-level windows above one window.
    const MAX_WINDOWS_ABOVE: usize = 1024;

    fn rect(window: HWND) -> Option<Rect> {
        let mut bounds = RECT::default();
        // SAFETY: `bounds` is a valid `RECT` to write into; an invalid handle only fails the call.
        unsafe { GetWindowRect(window, &raw mut bounds) }.ok()?;
        Some(Rect {
            x: f64::from(bounds.left),
            y: f64::from(bounds.top),
            width: f64::from(bounds.right - bounds.left),
            height: f64::from(bounds.bottom - bounds.top),
        })
    }

    fn owner(window: HWND) -> u32 {
        let mut process = 0_u32;
        // SAFETY: `process` is a valid `u32` to write into; an invalid handle leaves it zero.
        unsafe { GetWindowThreadProcessId(window, Some(&raw mut process)) };
        process
    }

    fn cloaked(window: HWND) -> bool {
        let mut value = 0_u32;
        // SAFETY: `value` is a valid `u32` of exactly the size passed; DWM writes at most that.
        let read = unsafe {
            DwmGetWindowAttribute(
                window,
                DWMWA_CLOAKED,
                (&raw mut value).cast::<c_void>(),
                u32::try_from(size_of::<u32>()).unwrap_or(4),
            )
        };
        read.is_ok() && value != 0
    }

    /// Reads the window with this handle and the visible windows of other processes above it.
    #[must_use]
    pub fn window(handle: isize) -> RawWindow {
        let own = HWND(handle as *mut c_void);
        // SAFETY: `IsWindow` accepts any value and only reports whether it names a window.
        if !unsafe { IsWindow(Some(own)) }.as_bool() {
            return RawWindow::default();
        }
        let mut affinity = 0_u32;
        // SAFETY: `affinity` is a valid `u32` to write into.
        let protection = unsafe { GetWindowDisplayAffinity(own, &raw mut affinity) }
            .ok()
            .map(|()| affinity == WDA_EXCLUDEFROMCAPTURE.0 || affinity == WDA_MONITOR.0);
        let own_process = owner(own);
        let mut covering = Vec::new();
        let mut current = own;
        for _ in 0..MAX_WINDOWS_ABOVE {
            // SAFETY: `current` is a window handle from the previous step; an invalid one fails.
            let Ok(above) = (unsafe { GetWindow(current, GW_HWNDPREV) }) else {
                break;
            };
            if above.is_invalid() {
                break;
            }
            current = above;
            // SAFETY: `IsWindowVisible` accepts any handle.
            let visible = unsafe { IsWindowVisible(above) }.as_bool();
            if visible
                && !cloaked(above)
                && owner(above) != own_process
                && let Some(bounds) = rect(above)
            {
                covering.push(bounds);
            }
        }
        RawWindow {
            found: true,
            capture_excluded: protection,
            bounds: rect(own),
            covering,
        }
    }
}

pub use window::window;

mod session {
    use windows::Win32::System::RemoteDesktop::{
        ProcessIdToSessionId, WTS_CONNECTSTATE_CLASS, WTS_CURRENT_SERVER_HANDLE, WTS_INFO_CLASS,
        WTS_SESSION_INFOW, WTS_SESSIONSTATE_LOCK, WTS_SESSIONSTATE_UNLOCK, WTSActive,
        WTSDisconnected, WTSEnumerateSessionsW, WTSFreeMemory, WTSGetActiveConsoleSessionId,
        WTSINFOEXW, WTSQuerySessionInformationW, WTSSessionInfoEx, WTSUserName,
    };
    use windows::Win32::System::Threading::GetCurrentProcessId;
    use windows::Win32::UI::WindowsAndMessaging::{GetSystemMetrics, SM_REMOTESESSION};
    use windows::core::PWSTR;

    use crate::RawSession;

    /// `WTSGetActiveConsoleSessionId` when no session is attached to the console.
    const NO_CONSOLE: u32 = 0xFFFF_FFFF;
    const MAX_SESSIONS: u32 = 1024;

    /// Queries one information class and hands the buffer to `read` before freeing it.
    pub(super) fn query<T>(
        session: u32,
        class: WTS_INFO_CLASS,
        read: impl FnOnce(*const u8, u32) -> T,
    ) -> Option<T> {
        let mut buffer = PWSTR::null();
        let mut bytes = 0_u32;
        // SAFETY: `buffer` and `bytes` are valid out-parameters; on success WTS allocates the buffer.
        unsafe {
            WTSQuerySessionInformationW(
                Some(WTS_CURRENT_SERVER_HANDLE),
                session,
                class,
                &raw mut buffer,
                &raw mut bytes,
            )
        }
        .ok()?;
        let result = read(buffer.0.cast::<u8>().cast_const(), bytes);
        // SAFETY: `buffer` was allocated by WTS for this call and is freed exactly once.
        unsafe { WTSFreeMemory(buffer.0.cast()) };
        Some(result)
    }

    pub(super) fn locked(session: u32) -> Option<bool> {
        query(session, WTSSessionInfoEx, |buffer, bytes| {
            if buffer.is_null() || (bytes as usize) < size_of::<WTSINFOEXW>() {
                return None;
            }
            // SAFETY: WTS returned at least one `WTSINFOEXW`; level 1 is the only defined level.
            let info = unsafe { buffer.cast::<WTSINFOEXW>().read_unaligned() };
            if info.Level != 1 {
                return None;
            }
            // SAFETY: level 1 selects the `WTSInfoExLevel1` member of the union.
            let flags = unsafe { info.Data.WTSInfoExLevel1.SessionFlags };
            match u32::try_from(flags).ok()? {
                WTS_SESSIONSTATE_LOCK => Some(true),
                WTS_SESSIONSTATE_UNLOCK => Some(false),
                _ => None,
            }
        })
        .flatten()
    }

    fn has_user(session: u32) -> bool {
        query(session, WTSUserName, |buffer, bytes| {
            !buffer.is_null() && bytes > 2
        })
        .unwrap_or(false)
    }

    fn other_human_sessions(own: u32) -> Option<u64> {
        let mut sessions: *mut WTS_SESSION_INFOW = std::ptr::null_mut();
        let mut count = 0_u32;
        // SAFETY: `sessions` and `count` are valid out-parameters; on success WTS allocates the array.
        unsafe {
            WTSEnumerateSessionsW(
                Some(WTS_CURRENT_SERVER_HANDLE),
                0,
                1,
                &raw mut sessions,
                &raw mut count,
            )
        }
        .ok()?;
        let mut others = 0_u64;
        for index in 0..count.min(MAX_SESSIONS) as usize {
            // SAFETY: `index` is below `count`, the number of entries WTS allocated.
            let entry = unsafe { sessions.add(index) };
            // SAFETY: `entry` points at an initialised element of the WTS array.
            let info = unsafe { &*entry };
            let state: WTS_CONNECTSTATE_CLASS = info.State;
            let human = (state == WTSActive || state == WTSDisconnected) && info.SessionId != own;
            if human && has_user(info.SessionId) {
                others += 1;
            }
        }
        // SAFETY: `sessions` was allocated by WTS for this call and is freed exactly once.
        unsafe { WTSFreeMemory(sessions.cast()) };
        Some(others)
    }

    /// The current session from WTS: console ownership, lock, remote use, and other human sessions.
    #[must_use]
    pub fn session() -> RawSession {
        let mut own = 0_u32;
        // SAFETY: `GetCurrentProcessId` has no preconditions.
        let process = unsafe { GetCurrentProcessId() };
        // SAFETY: `own` is a valid out-parameter.
        let known = unsafe { ProcessIdToSessionId(process, &raw mut own) }.is_ok();
        if !known {
            return RawSession::default();
        }
        // SAFETY: no preconditions.
        let console = unsafe { WTSGetActiveConsoleSessionId() };
        // SAFETY: no preconditions.
        let remote = unsafe { GetSystemMetrics(SM_REMOTESESSION) } != 0;
        RawSession {
            on_console: (console != NO_CONSOLE).then_some(console == own),
            locked: locked(own),
            remote: Some(remote),
            other_human_sessions: other_human_sessions(own),
        }
    }
}

pub use session::session;

/// The clipboard sequence number, which rises on every change. Content, formats and owner are never
/// read. `None` when this session has no clipboard access.
#[must_use]
pub fn clipboard_change_count() -> Option<u64> {
    // SAFETY: no preconditions; zero means the sequence number is not available.
    let sequence = unsafe { windows::Win32::System::DataExchange::GetClipboardSequenceNumber() };
    (sequence != 0).then_some(u64::from(sequence))
}

/// Virtualization evidence from CPUID. On ARM64 Windows there is no CPUID, so it is unprobed.
#[must_use]
pub fn virtualization() -> crate::RawVirtualization {
    #[cfg(target_arch = "x86_64")]
    return crate::cpuid_virtualization();
    #[cfg(not(target_arch = "x86_64"))]
    crate::RawVirtualization::unprobed()
}

mod network {
    use windows::Win32::Foundation::{ERROR_BUFFER_OVERFLOW, ERROR_SUCCESS, GlobalFree, HGLOBAL};
    use windows::Win32::NetworkManagement::IpHelper::{
        FreeMibTable, GAA_FLAG_SKIP_ANYCAST, GAA_FLAG_SKIP_DNS_SERVER, GAA_FLAG_SKIP_MULTICAST,
        GetAdaptersAddresses, GetIpForwardTable2, IF_TYPE_PPP, IF_TYPE_PROP_VIRTUAL,
        IF_TYPE_TUNNEL, IP_ADAPTER_ADDRESSES_LH, MIB_IPFORWARD_ROW2, MIB_IPFORWARD_TABLE2,
    };
    use windows::Win32::NetworkManagement::Ndis::IfOperStatusUp;
    use windows::Win32::NetworkManagement::Rras::RasEnumConnectionsW;
    use windows::Win32::Networking::WinHttp::{
        WINHTTP_CURRENT_USER_IE_PROXY_CONFIG, WinHttpGetIEProxyConfigForCurrentUser,
    };
    use windows::Win32::Networking::WinSock::AF_UNSPEC;
    use windows::core::PWSTR;

    use crate::{RawProxy, RawTunnel, RawTunnelClass, fingerprint};

    const MAX_ADAPTERS: usize = 256;
    const MAX_ROUTES: usize = 65_536;
    /// `ERROR_BUFFER_TOO_SMALL` from RAS.
    const RAS_BUFFER_TOO_SMALL: u32 = 603;

    fn release(text: PWSTR) {
        if !text.is_null() {
            // SAFETY: WinHTTP allocates these strings with `GlobalAlloc` and the caller frees them.
            let _ = unsafe { GlobalFree(Some(HGLOBAL(text.0.cast()))) };
        }
    }

    /// Whether a system proxy is configured for this user, and of which kind. Hosts, ports and the
    /// configuration script are never read; the strings are freed unread.
    #[must_use]
    pub fn system_proxy() -> Option<RawProxy> {
        let mut config = WINHTTP_CURRENT_USER_IE_PROXY_CONFIG::default();
        // SAFETY: `config` is a valid out-parameter.
        unsafe { WinHttpGetIEProxyConfigForCurrentUser(&raw mut config) }.ok()?;
        let kind = if !config.lpszProxy.is_null() {
            RawProxy::Manual
        } else if !config.lpszAutoConfigUrl.is_null() {
            RawProxy::AutomaticConfig
        } else if config.fAutoDetect.as_bool() {
            RawProxy::AutoDetect
        } else {
            RawProxy::None
        };
        release(config.lpszProxy);
        release(config.lpszAutoConfigUrl);
        release(config.lpszProxyBypass);
        Some(kind)
    }

    /// Whether an OS-managed (RAS) VPN connection is active.
    #[must_use]
    pub fn managed_vpn() -> Option<bool> {
        let mut bytes = 0_u32;
        let mut connections = 0_u32;
        // SAFETY: a null buffer with zero size asks only for the required size and the count.
        let status = unsafe { RasEnumConnectionsW(None, &raw mut bytes, &raw mut connections) };
        match status {
            0 => Some(connections > 0),
            RAS_BUFFER_TOO_SMALL => Some(true),
            _ => None,
        }
    }

    fn class_of(adapter: &IP_ADAPTER_ADDRESSES_LH) -> Option<RawTunnelClass> {
        match adapter.IfType {
            IF_TYPE_TUNNEL => Some(RawTunnelClass::PacketTunnel),
            IF_TYPE_PPP => Some(RawTunnelClass::PointToPoint),
            IF_TYPE_PROP_VIRTUAL => Some(RawTunnelClass::VirtualEthernet),
            _ => None,
        }
    }

    /// Tunnel, point-to-point and virtual adapters that are up.
    #[must_use]
    pub fn tunnels() -> Option<Vec<RawTunnel>> {
        let flags = GAA_FLAG_SKIP_ANYCAST | GAA_FLAG_SKIP_MULTICAST | GAA_FLAG_SKIP_DNS_SERVER;
        let mut size = 16 * 1024_u32;
        for _ in 0..3 {
            // A `u64` buffer keeps the adapter structures aligned.
            let mut buffer = vec![0_u64; (size as usize).div_ceil(8)];
            let first = buffer.as_mut_ptr().cast::<IP_ADAPTER_ADDRESSES_LH>();
            // SAFETY: `buffer` holds at least `size` writable, 8-byte-aligned bytes.
            let status = unsafe {
                GetAdaptersAddresses(
                    u32::from(AF_UNSPEC.0),
                    flags,
                    None,
                    Some(first),
                    &raw mut size,
                )
            };
            if status == ERROR_BUFFER_OVERFLOW.0 {
                continue;
            }
            if status != ERROR_SUCCESS.0 {
                return None;
            }
            let mut tunnels = Vec::new();
            let mut cursor = first.cast_const();
            let mut visited = 0_usize;
            while !cursor.is_null() && visited < MAX_ADAPTERS {
                visited += 1;
                // SAFETY: `cursor` is a node of the list the call wrote into `buffer`.
                let adapter = unsafe { &*cursor };
                cursor = adapter.Next.cast_const();
                if adapter.OperStatus != IfOperStatusUp {
                    continue;
                }
                if let Some(class) = class_of(adapter) {
                    // SAFETY: `Value` is the 64-bit view of the interface LUID union.
                    let luid = unsafe { adapter.Luid.Value };
                    tunnels.push(RawTunnel {
                        key: fingerprint(&luid.to_le_bytes()),
                        class,
                    });
                }
            }
            return Some(tunnels);
        }
        None
    }

    /// A fingerprint of the IPv4 and IPv6 routing table.
    #[must_use]
    pub fn route_fingerprint() -> Option<u64> {
        let mut table: *mut MIB_IPFORWARD_TABLE2 = std::ptr::null_mut();
        // SAFETY: `table` is a valid out-parameter; on success the OS allocates the table.
        if unsafe { GetIpForwardTable2(AF_UNSPEC, &raw mut table) } != ERROR_SUCCESS
            || table.is_null()
        {
            return None;
        }
        // SAFETY: the table header is valid until it is freed below.
        let entries = unsafe { (*table).NumEntries } as usize;
        let rows = entries.min(MAX_ROUTES);
        // SAFETY: the table holds `NumEntries` rows starting at `Table`.
        let first = unsafe { (&raw const (*table).Table).cast::<MIB_IPFORWARD_ROW2>() };
        // SAFETY: `rows` rows starting at `first` are initialised; they are read as bytes.
        let bytes = unsafe {
            std::slice::from_raw_parts(first.cast::<u8>(), rows * size_of::<MIB_IPFORWARD_ROW2>())
        };
        let result = fingerprint(bytes);
        // SAFETY: frees the table returned above exactly once.
        unsafe { FreeMibTable(table.cast_const().cast()) };
        Some(result)
    }
}

pub use network::{managed_vpn, route_fingerprint, system_proxy, tunnels};

mod storage {
    use std::collections::BTreeSet;
    use std::ffi::c_void;

    use windows::Win32::Devices::DeviceAndDriverInstallation::{
        DIGCF_PRESENT, GUID_DEVCLASS_WPD, SP_DEVINFO_DATA, SetupDiDestroyDeviceInfoList,
        SetupDiEnumDeviceInfo, SetupDiGetClassDevsW, SetupDiGetDeviceInstanceIdW,
    };
    use windows::Win32::Foundation::{
        CloseHandle, ERROR_NO_MEDIA_IN_DRIVE, ERROR_NOT_READY, ERROR_WRITE_PROTECT, HANDLE,
    };
    use windows::Win32::Storage::FileSystem::{
        BusTypeMmc, BusTypeSd, BusTypeUsb, CreateFileW, FILE_FLAGS_AND_ATTRIBUTES, FILE_SHARE_READ,
        FILE_SHARE_WRITE, GetLogicalDrives, OPEN_EXISTING,
    };
    use windows::Win32::System::IO::DeviceIoControl;
    use windows::Win32::System::Ioctl::{
        IOCTL_DISK_IS_WRITABLE, IOCTL_STORAGE_CHECK_VERIFY2, IOCTL_STORAGE_GET_DEVICE_NUMBER,
        IOCTL_STORAGE_QUERY_PROPERTY, PropertyStandardQuery, STORAGE_DEVICE_DESCRIPTOR,
        STORAGE_DEVICE_NUMBER, STORAGE_PROPERTY_QUERY, StorageDeviceProperty,
    };
    use windows::core::{HSTRING, w};

    use crate::{RawStorageDevice, RawStorageKind, RawTransport, fingerprint};

    /// Physical drive numbers probed; Windows numbers attached disks densely from zero.
    const MAX_DRIVES: u32 = 64;
    const MAX_DEVICES: u32 = 256;

    /// A device handle opened with no data access: enough for storage queries, never for reads.
    struct Device(HANDLE);

    impl Device {
        fn open(path: &str) -> Option<Self> {
            // SAFETY: the path is a valid wide string; zero access opens no data stream.
            let handle = unsafe {
                CreateFileW(
                    &HSTRING::from(path),
                    0,
                    FILE_SHARE_READ | FILE_SHARE_WRITE,
                    None,
                    OPEN_EXISTING,
                    FILE_FLAGS_AND_ATTRIBUTES(0),
                    None,
                )
            };
            handle.ok().map(Self)
        }

        fn control<T: Copy + Default>(
            &self,
            code: u32,
            input: Option<&STORAGE_PROPERTY_QUERY>,
        ) -> windows::core::Result<T> {
            let mut output = T::default();
            let mut returned = 0_u32;
            let input_size = input.map_or(0, |_| size_of::<STORAGE_PROPERTY_QUERY>());
            // SAFETY: the handle is open, the input (when present) and output point at live values
            // of the stated sizes, and the call is synchronous.
            unsafe {
                DeviceIoControl(
                    self.0,
                    code,
                    input.map(|query| std::ptr::from_ref(query).cast::<c_void>()),
                    u32::try_from(input_size).unwrap_or(0),
                    Some((&raw mut output).cast::<c_void>()),
                    u32::try_from(size_of::<T>()).unwrap_or(0),
                    Some(&raw mut returned),
                    None,
                )
            }?;
            Ok(output)
        }

        fn number(&self) -> Option<u32> {
            self.control::<STORAGE_DEVICE_NUMBER>(IOCTL_STORAGE_GET_DEVICE_NUMBER, None)
                .ok()
                .map(|number| number.DeviceNumber)
        }
    }

    impl Drop for Device {
        fn drop(&mut self) {
            // SAFETY: the handle was opened by `CreateFileW` and is closed exactly once.
            let _ = unsafe { CloseHandle(self.0) };
        }
    }

    /// The physical drive numbers that hold a mounted volume with a drive letter.
    fn mounted_drives() -> BTreeSet<u32> {
        // SAFETY: no arguments; returns a bit mask of drive letters.
        let letters = unsafe { GetLogicalDrives() };
        (0..26_u8)
            .filter(|bit| letters & (1 << bit) != 0)
            .filter_map(|bit| Device::open(&format!(r"\\.\{}:", char::from(b'A' + bit))))
            .filter_map(|volume| volume.number())
            .collect()
    }

    /// Removable or USB/SD-attached physical drives. A Thunderbolt disk reports its inner bus
    /// (`NVMe`), so it is counted only when Windows marks its media removable.
    #[must_use]
    pub fn block_devices() -> Option<Vec<RawStorageDevice>> {
        let mounted = mounted_drives();
        let mut devices = Vec::new();
        for drive in 0..MAX_DRIVES {
            let Some(device) = Device::open(&format!(r"\\.\PhysicalDrive{drive}")) else {
                continue;
            };
            let query = STORAGE_PROPERTY_QUERY {
                PropertyId: StorageDeviceProperty,
                QueryType: PropertyStandardQuery,
                AdditionalParameters: [0],
            };
            let Ok(descriptor) = device
                .control::<STORAGE_DEVICE_DESCRIPTOR>(IOCTL_STORAGE_QUERY_PROPERTY, Some(&query))
            else {
                continue;
            };
            let bus = descriptor.BusType;
            let transport = if bus == BusTypeUsb {
                RawTransport::Usb
            } else if bus == BusTypeSd || bus == BusTypeMmc {
                RawTransport::Sd
            } else if descriptor.RemovableMedia {
                RawTransport::Other
            } else {
                continue;
            };
            // An empty card reader is not a device until media is inserted.
            if let Err(error) = device.control::<u32>(IOCTL_STORAGE_CHECK_VERIFY2, None) {
                let code = error.code();
                if code == ERROR_NOT_READY.to_hresult()
                    || code == ERROR_NO_MEDIA_IN_DRIVE.to_hresult()
                {
                    continue;
                }
            }
            let writable = match device.control::<u8>(IOCTL_DISK_IS_WRITABLE, None) {
                Ok(_) => Some(true),
                Err(error) if error.code() == ERROR_WRITE_PROTECT.to_hresult() => Some(false),
                Err(_) => None,
            };
            devices.push(RawStorageDevice {
                key: fingerprint(&drive.to_le_bytes()),
                kind: RawStorageKind::Block,
                transport,
                mounted: Some(mounted.contains(&drive)),
                writable,
            });
        }
        devices.sort();
        Some(devices)
    }

    /// Phones and cameras: Windows Portable Devices enumerated by the USB bus. A USB stick also
    /// appears as a portable device, but through the software bus, so it is not counted twice.
    #[must_use]
    pub fn portable_devices() -> Option<Vec<RawStorageDevice>> {
        // SAFETY: the class GUID is a constant and the enumerator a static wide string.
        let set = unsafe {
            SetupDiGetClassDevsW(Some(&GUID_DEVCLASS_WPD), w!("USB"), None, DIGCF_PRESENT)
        }
        .ok()?;
        let mut devices = BTreeSet::new();
        for index in 0..MAX_DEVICES {
            let mut data = SP_DEVINFO_DATA {
                cbSize: u32::try_from(size_of::<SP_DEVINFO_DATA>()).unwrap_or(0),
                ..SP_DEVINFO_DATA::default()
            };
            // SAFETY: `set` is the live device set and `data` is sized for the call.
            if unsafe { SetupDiEnumDeviceInfo(set, index, &raw mut data) }.is_err() {
                break;
            }
            let mut id = [0_u16; 512];
            // SAFETY: `data` was filled by the enumeration above and `id` is a writable buffer.
            if unsafe { SetupDiGetDeviceInstanceIdW(set, &raw const data, Some(&mut id), None) }
                .is_ok()
            {
                let length = id.iter().position(|unit| *unit == 0).unwrap_or(id.len());
                let bytes: Vec<u8> = id[..length]
                    .iter()
                    .flat_map(|unit| unit.to_le_bytes())
                    .collect();
                devices.insert(RawStorageDevice {
                    key: fingerprint(&bytes),
                    kind: RawStorageKind::Portable,
                    transport: RawTransport::Usb,
                    mounted: None,
                    writable: None,
                });
            }
        }
        // SAFETY: `set` was returned by `SetupDiGetClassDevsW` and is destroyed exactly once.
        let _ = unsafe { SetupDiDestroyDeviceInfoList(set) };
        Some(devices.into_iter().collect())
    }
}

pub use storage::{block_devices, portable_devices};

mod printing {
    use std::collections::BTreeMap;
    use std::time::Duration;

    use windows::Win32::Foundation::{HANDLE, INVALID_HANDLE_VALUE, WAIT_OBJECT_0};
    use windows::Win32::Graphics::Printing::{
        ClosePrinter, FindClosePrinterChangeNotification, FindFirstPrinterChangeNotification,
        FindNextPrinterChangeNotification, FreePrinterNotifyInfo, JOB_NOTIFY_FIELD_STATUS,
        JOB_NOTIFY_FIELD_USER_NAME, JOB_NOTIFY_TYPE, JOB_STATUS_COMPLETE, JOB_STATUS_DELETED,
        JOB_STATUS_DELETING, JOB_STATUS_PRINTED, OpenPrinterW, PRINTER_CHANGE_JOB, PRINTER_HANDLE,
        PRINTER_NOTIFY_INFO, PRINTER_NOTIFY_INFO_DATA, PRINTER_NOTIFY_INFO_DISCARDED,
        PRINTER_NOTIFY_OPTIONS, PRINTER_NOTIFY_OPTIONS_REFRESH, PRINTER_NOTIFY_OPTIONS_TYPE,
    };
    use windows::Win32::System::Threading::WaitForSingleObject;
    use windows::Win32::System::WindowsProgramming::GetUserNameW;
    use windows::core::{PCWSTR, PWSTR};

    use crate::{RawJobOwner, RawPrintJob};

    /// The most jobs remembered, finished ones included; the oldest finished jobs go first.
    pub const MAX_JOBS: usize = 1_000;
    const FINISHED: u32 =
        JOB_STATUS_COMPLETE | JOB_STATUS_DELETED | JOB_STATUS_DELETING | JOB_STATUS_PRINTED;

    /// What one wait observed.
    #[derive(Clone, Copy, Debug, PartialEq, Eq)]
    pub enum Watched {
        Changed,
        Quiet,
        /// The spooler discarded notifications; the jobs were re-read in full.
        Lost,
        Failed,
    }

    #[derive(Clone, Copy, Default)]
    struct Job {
        owner: Option<bool>,
        status: Option<u32>,
    }

    /// The local spooler's job notifications, carrying only each job's owner and status. The owner
    /// is compared with the candidate's account as it arrives and never kept.
    pub struct JobWatch {
        server: PRINTER_HANDLE,
        change: HANDLE,
        fields: [u16; 2],
        user: Vec<u16>,
        jobs: BTreeMap<u32, Job>,
    }

    // SAFETY: the spooler handles may be used from any thread; the watch is moved to its own
    // thread and used only there.
    unsafe impl Send for JobWatch {}

    fn current_user() -> Option<Vec<u16>> {
        let mut buffer = [0_u16; 257];
        let mut length = u32::try_from(buffer.len()).unwrap_or(0);
        // SAFETY: `buffer` is writable for `length` characters.
        unsafe { GetUserNameW(Some(PWSTR(buffer.as_mut_ptr())), &raw mut length) }.ok()?;
        let length = usize::try_from(length).ok()?.saturating_sub(1);
        Some(buffer.get(..length)?.to_vec())
    }

    impl JobWatch {
        /// Opens the local spooler and reads every current job. `None` when the spooler is not
        /// running.
        #[must_use]
        pub fn open() -> Option<Self> {
            let user = current_user()?;
            let mut server = PRINTER_HANDLE::default();
            // SAFETY: a null name opens the local print server; `server` is a valid out-parameter.
            unsafe { OpenPrinterW(PCWSTR::null(), &raw mut server, None) }.ok()?;
            let mut watch = Self {
                server,
                change: INVALID_HANDLE_VALUE,
                fields: [
                    u16::try_from(JOB_NOTIFY_FIELD_USER_NAME).unwrap_or(0),
                    u16::try_from(JOB_NOTIFY_FIELD_STATUS).unwrap_or(0),
                ],
                user,
                jobs: BTreeMap::new(),
            };
            let mut kinds = watch.kinds();
            let options = Self::options(&mut kinds, 0);
            // SAFETY: `server` is open and `options` points at live option structures.
            let change = unsafe {
                FindFirstPrinterChangeNotification(
                    server,
                    PRINTER_CHANGE_JOB,
                    0,
                    Some(std::ptr::from_ref(&options).cast()),
                )
            };
            if change.is_invalid() {
                return None;
            }
            watch.change = change;
            watch.refresh().then_some(watch)
        }

        fn kinds(&mut self) -> [PRINTER_NOTIFY_OPTIONS_TYPE; 1] {
            [PRINTER_NOTIFY_OPTIONS_TYPE {
                Type: u16::try_from(JOB_NOTIFY_TYPE).unwrap_or(0),
                Count: u32::try_from(self.fields.len()).unwrap_or(0),
                pFields: self.fields.as_mut_ptr(),
                ..PRINTER_NOTIFY_OPTIONS_TYPE::default()
            }]
        }

        fn options(
            kinds: &mut [PRINTER_NOTIFY_OPTIONS_TYPE; 1],
            flags: u32,
        ) -> PRINTER_NOTIFY_OPTIONS {
            PRINTER_NOTIFY_OPTIONS {
                Version: 2,
                Flags: flags,
                Count: 1,
                pTypes: kinds.as_mut_ptr(),
            }
        }

        /// Reads the pending notification data, or all jobs when `flags` asks for a refresh.
        /// Returns whether the spooler discarded data, or `None` when the read failed.
        fn next(&mut self, flags: u32) -> Option<bool> {
            let mut kinds = self.kinds();
            let options = Self::options(&mut kinds, flags);
            let mut changed = 0_u32;
            let mut info: *mut core::ffi::c_void = std::ptr::null_mut();
            // SAFETY: `change` is the open notification, `options` is live, and `info` is a valid
            // out-parameter the spooler fills.
            let read = unsafe {
                FindNextPrinterChangeNotification(
                    self.change,
                    Some(&raw mut changed),
                    Some(std::ptr::from_ref(&options).cast()),
                    Some(&raw mut info),
                )
            };
            if !read.as_bool() {
                return None;
            }
            if info.is_null() {
                return Some(false);
            }
            let info = info.cast::<PRINTER_NOTIFY_INFO>();
            // SAFETY: the spooler returned a valid `PRINTER_NOTIFY_INFO` that lives until freed.
            let header = unsafe { info.read_unaligned() };
            let discarded = header.Flags & PRINTER_NOTIFY_INFO_DISCARDED != 0;
            #[allow(clippy::cast_ptr_alignment)] // Every entry is read with `read_unaligned`.
            let data = info
                .cast::<u8>()
                .wrapping_add(std::mem::offset_of!(PRINTER_NOTIFY_INFO, aData))
                .cast::<PRINTER_NOTIFY_INFO_DATA>();
            for index in 0..usize::try_from(header.Count).unwrap_or(0).min(MAX_JOBS * 2) {
                let entry = data.wrapping_add(index);
                // SAFETY: `aData` holds `Count` entries laid out after the header, and `index` is
                // below `Count`.
                let entry = unsafe { entry.read_unaligned() };
                self.apply(&entry);
            }
            // SAFETY: `info` was returned by `FindNextPrinterChangeNotification` and is freed once.
            let _ = unsafe { FreePrinterNotifyInfo(info) };
            Some(discarded)
        }

        fn apply(&mut self, entry: &PRINTER_NOTIFY_INFO_DATA) {
            if u32::from(entry.Type) != JOB_NOTIFY_TYPE {
                return;
            }
            let field = u32::from(entry.Field);
            let job = self.jobs.entry(entry.Id).or_default();
            if field == JOB_NOTIFY_FIELD_STATUS {
                // SAFETY: the status field is carried in `adwData`.
                job.status = Some(unsafe { entry.NotifyData.adwData[0] });
            } else if field == JOB_NOTIFY_FIELD_USER_NAME {
                // SAFETY: the user name field is carried as a buffer of `cbBuf` bytes.
                let buffer = unsafe { entry.NotifyData.Data };
                let units = usize::try_from(buffer.cbBuf).unwrap_or(0) / 2;
                job.owner = (!buffer.pBuf.is_null()).then(|| {
                    // SAFETY: `pBuf` holds `cbBuf` bytes of UTF-16 until the info is freed.
                    let name =
                        unsafe { std::slice::from_raw_parts(buffer.pBuf.cast::<u16>(), units) };
                    let length = name
                        .iter()
                        .position(|unit| *unit == 0)
                        .unwrap_or(name.len());
                    name[..length].eq_ignore_ascii_case_wide(&self.user)
                });
            }
            self.evict();
        }

        fn evict(&mut self) {
            while self.jobs.len() > MAX_JOBS {
                let oldest = self
                    .jobs
                    .iter()
                    .find(|(_, job)| job.status.is_some_and(|status| status & FINISHED != 0))
                    .or_else(|| self.jobs.iter().next())
                    .map(|(id, _)| *id);
                if let Some(id) = oldest {
                    self.jobs.remove(&id);
                }
            }
        }

        /// Re-reads every current job; jobs no longer reported are finished.
        fn refresh(&mut self) -> bool {
            let before: Vec<u32> = self.jobs.keys().copied().collect();
            for job in self.jobs.values_mut() {
                job.status = Some(JOB_STATUS_DELETED);
            }
            let refreshed = self.next(PRINTER_NOTIFY_OPTIONS_REFRESH).is_some();
            if !refreshed {
                for id in before {
                    self.jobs.remove(&id);
                }
            }
            refreshed
        }

        /// Waits up to `timeout` for job changes and applies them.
        pub fn wait(&mut self, timeout: Duration) -> Watched {
            let milliseconds = u32::try_from(timeout.as_millis()).unwrap_or(u32::MAX);
            // SAFETY: `change` is an open waitable notification handle.
            if unsafe { WaitForSingleObject(self.change, milliseconds) } != WAIT_OBJECT_0 {
                return Watched::Quiet;
            }
            match self.next(0) {
                Some(false) => Watched::Changed,
                Some(true) if self.refresh() => Watched::Lost,
                _ => Watched::Failed,
            }
        }

        /// Every job seen since the watch opened, active and finished.
        #[must_use]
        pub fn jobs(&self) -> Vec<RawPrintJob> {
            self.jobs
                .iter()
                .map(|(id, job)| RawPrintJob {
                    id: *id,
                    owner: match job.owner {
                        Some(true) => RawJobOwner::Candidate,
                        Some(false) => RawJobOwner::Other,
                        None => RawJobOwner::Unknown,
                    },
                    active: job.status.is_none_or(|status| status & FINISHED == 0),
                })
                .collect()
        }
    }

    impl Drop for JobWatch {
        fn drop(&mut self) {
            if !self.change.is_invalid() {
                // SAFETY: the notification was opened by `FindFirstPrinterChangeNotification`.
                let _ = unsafe { FindClosePrinterChangeNotification(self.change) };
            }
            // SAFETY: the server handle was opened by `OpenPrinterW` and is closed once.
            let _ = unsafe { ClosePrinter(self.server) };
        }
    }

    trait WideEq {
        fn eq_ignore_ascii_case_wide(&self, other: &[u16]) -> bool;
    }

    impl WideEq for [u16] {
        /// Windows account names compare without regard to case.
        fn eq_ignore_ascii_case_wide(&self, other: &[u16]) -> bool {
            let fold = |unit: u16| {
                if (u16::from(b'A')..=u16::from(b'Z')).contains(&unit) {
                    unit + 32
                } else {
                    unit
                }
            };
            self.len() == other.len()
                && self
                    .iter()
                    .zip(other)
                    .all(|(left, right)| fold(*left) == fold(*right))
        }
    }

    /// A one-off read of the current jobs.
    #[must_use]
    pub fn print_jobs() -> Option<Vec<RawPrintJob>> {
        JobWatch::open().map(|watch| watch.jobs())
    }
}

pub use printing::{JobWatch, Watched, print_jobs};

mod media {
    use windows::Win32::Foundation::ERROR_SUCCESS;
    use windows::Win32::Media::Audio::{
        AudioSessionStateActive, DEVICE_STATE_ACTIVE, IAudioSessionControl2, IAudioSessionManager2,
        IMMDeviceEnumerator, MMDeviceEnumerator, eCapture,
    };
    use windows::Win32::Media::MediaFoundation::{
        IMFActivate, IMFAttributes, MF_DEVSOURCE_ATTRIBUTE_SOURCE_TYPE,
        MF_DEVSOURCE_ATTRIBUTE_SOURCE_TYPE_VIDCAP_GUID,
        MF_DEVSOURCE_ATTRIBUTE_SOURCE_TYPE_VIDCAP_SYMBOLIC_LINK, MFCreateAttributes,
        MFEnumDeviceSources,
    };
    use windows::Win32::System::Com::{
        CLSCTX_ALL, COINIT_MULTITHREADED, CoCreateInstance, CoInitializeEx, CoTaskMemFree,
        CoUninitialize,
    };
    use windows::Win32::System::Registry::{
        HKEY, HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE, KEY_READ, RRF_RT_REG_QWORD, RRF_RT_REG_SZ,
        RegCloseKey, RegEnumKeyExW, RegGetValueW, RegOpenKeyExW,
    };
    use windows::core::{HSTRING, Interface, PWSTR};

    use crate::{RawMedia, RawMediaDevice, RawMediaPermission, fingerprint};

    const MAX_DEVICES: usize = 64;
    const MAX_APPS: u32 = 1_024;
    const CONSENT: &str =
        r"Software\Microsoft\Windows\CurrentVersion\CapabilityAccessManager\ConsentStore";

    /// COM for the calling thread, released when dropped.
    struct Com(bool);

    impl Com {
        fn enter() -> Self {
            // SAFETY: no reserved argument; a thread may initialize COM more than once.
            Self(unsafe { CoInitializeEx(None, COINIT_MULTITHREADED) }.is_ok())
        }
    }

    impl Drop for Com {
        fn drop(&mut self) {
            if self.0 {
                // SAFETY: balances the successful `CoInitializeEx` above on the same thread.
                unsafe { CoUninitialize() };
            }
        }
    }

    fn wide(text: &str) -> HSTRING {
        HSTRING::from(text)
    }

    fn text_value(root: HKEY, path: &str, name: &str) -> Option<String> {
        let mut buffer = [0_u16; 64];
        let mut size = u32::try_from(size_of_val(&buffer)).unwrap_or(0);
        // SAFETY: `buffer` is writable for `size` bytes.
        let status = unsafe {
            RegGetValueW(
                root,
                &wide(path),
                &wide(name),
                RRF_RT_REG_SZ,
                None,
                Some(buffer.as_mut_ptr().cast()),
                Some(&raw mut size),
            )
        };
        (status == ERROR_SUCCESS).then(|| {
            let units = usize::try_from(size).unwrap_or(0) / 2;
            String::from_utf16_lossy(&buffer[..units.min(buffer.len())])
                .trim_end_matches('\0')
                .to_owned()
        })
    }

    fn quad_value(root: HKEY, path: &str, name: &str) -> Option<u64> {
        let mut value = 0_u64;
        let mut size = u32::try_from(size_of::<u64>()).unwrap_or(0);
        // SAFETY: `value` is writable for `size` bytes.
        let status = unsafe {
            RegGetValueW(
                root,
                &wide(path),
                &wide(name),
                RRF_RT_REG_QWORD,
                None,
                Some((&raw mut value).cast()),
                Some(&raw mut size),
            )
        };
        (status == ERROR_SUCCESS).then_some(value)
    }

    /// The desktop-app permission for a `ConsentStore` capability (`webcam`, `microphone`): denied
    /// when the machine, the user, or the user's desktop-app switch denies it.
    fn permission(capability: &str) -> RawMediaPermission {
        let base = format!(r"{CONSENT}\{capability}");
        let values = [
            text_value(HKEY_LOCAL_MACHINE, &base, "Value"),
            text_value(HKEY_CURRENT_USER, &base, "Value"),
            text_value(HKEY_CURRENT_USER, &format!(r"{base}\NonPackaged"), "Value"),
        ];
        if values
            .iter()
            .flatten()
            .any(|value| value.eq_ignore_ascii_case("Deny"))
        {
            RawMediaPermission::Denied
        } else {
            RawMediaPermission::Granted
        }
    }

    /// The subkey names under `path`. Each name is an application identity and is dropped as soon
    /// as its values are read.
    fn subkeys(path: &str) -> Vec<String> {
        let mut key = HKEY::default();
        // SAFETY: `key` is a valid out-parameter for the opened key.
        if unsafe { RegOpenKeyExW(HKEY_CURRENT_USER, &wide(path), None, KEY_READ, &raw mut key) }
            != ERROR_SUCCESS
        {
            return Vec::new();
        }
        let mut names = Vec::new();
        for index in 0..MAX_APPS {
            let mut name = [0_u16; 512];
            let mut length = u32::try_from(name.len()).unwrap_or(0);
            // SAFETY: `key` is open and `name` is writable for `length` characters.
            let status = unsafe {
                RegEnumKeyExW(
                    key,
                    index,
                    Some(PWSTR(name.as_mut_ptr())),
                    &raw mut length,
                    None,
                    None,
                    None,
                    None,
                )
            };
            if status != ERROR_SUCCESS {
                break;
            }
            names.push(String::from_utf16_lossy(
                &name[..usize::try_from(length).unwrap_or(0).min(name.len())],
            ));
        }
        // SAFETY: `key` was opened above and is closed once.
        let _ = unsafe { RegCloseKey(key) };
        names
    }

    /// Whether an application currently uses the capability, from the `ConsentStore` usage times: a
    /// use that started and has not stopped. Undocumented; certification must prove it.
    fn in_use(capability: &str) -> bool {
        let base = format!(r"{CONSENT}\{capability}");
        let packaged = subkeys(&base)
            .into_iter()
            .filter(|name| name != "NonPackaged")
            .map(|name| format!(r"{base}\{name}"));
        let desktop = subkeys(&format!(r"{base}\NonPackaged"))
            .into_iter()
            .map(|name| format!(r"{base}\NonPackaged\{name}"));
        packaged.chain(desktop).any(|path| {
            quad_value(HKEY_CURRENT_USER, &path, "LastUsedTimeStart")
                .is_some_and(|start| start != 0)
                && quad_value(HKEY_CURRENT_USER, &path, "LastUsedTimeStop") == Some(0)
        })
    }

    /// A camera is physical unless it is root- or software-enumerated (virtual cameras).
    fn physical_camera(link: &str) -> bool {
        let link = link.to_ascii_lowercase();
        !(link.starts_with(r"\\?\root#") || link.starts_with(r"\\?\swd#"))
    }

    fn camera_links() -> Option<Vec<String>> {
        let mut attributes: Option<IMFAttributes> = None;
        // SAFETY: `attributes` is a valid out-parameter.
        unsafe { MFCreateAttributes(&raw mut attributes, 1) }.ok()?;
        let attributes = attributes?;
        // SAFETY: both GUIDs are constants.
        unsafe {
            attributes.SetGUID(
                &MF_DEVSOURCE_ATTRIBUTE_SOURCE_TYPE,
                &MF_DEVSOURCE_ATTRIBUTE_SOURCE_TYPE_VIDCAP_GUID,
            )
        }
        .ok()?;
        let mut sources: *mut Option<IMFActivate> = std::ptr::null_mut();
        let mut count = 0_u32;
        // SAFETY: the out-parameters are valid; the returned array is freed below.
        unsafe { MFEnumDeviceSources(&attributes, &raw mut sources, &raw mut count) }.ok()?;
        let mut links = Vec::new();
        for index in 0..usize::try_from(count).unwrap_or(0) {
            let slot = sources.wrapping_add(index);
            // SAFETY: `sources` holds `count` entries and `index` is below it; taking each entry
            // releases it when dropped.
            let source = unsafe { slot.replace(None) };
            let Some(source) = source else { continue };
            let mut link = PWSTR::null();
            let mut length = 0_u32;
            // SAFETY: the attribute is a string; the OS allocates it and it is freed below.
            if unsafe {
                source.GetAllocatedString(
                    &MF_DEVSOURCE_ATTRIBUTE_SOURCE_TYPE_VIDCAP_SYMBOLIC_LINK,
                    &raw mut link,
                    &raw mut length,
                )
            }
            .is_ok()
            {
                // SAFETY: `link` is a NUL-terminated string the OS allocated.
                if let Ok(text) = unsafe { link.to_string() }
                    && links.len() < MAX_DEVICES
                {
                    links.push(text);
                }
                // SAFETY: `link` was allocated with the COM allocator and is freed once.
                unsafe { CoTaskMemFree(Some(link.0.cast())) };
            }
        }
        // SAFETY: the array was allocated with the COM allocator and its entries were released.
        unsafe { CoTaskMemFree(Some(sources.cast())) };
        Some(links)
    }

    /// Every video-capture device from Media Foundation; no device is activated.
    #[must_use]
    pub fn cameras() -> RawMedia {
        let _com = Com::enter();
        RawMedia {
            permission: permission("webcam"),
            devices: camera_links().map(|links| {
                links
                    .iter()
                    .map(|link| RawMediaDevice {
                        key: fingerprint(link.as_bytes()),
                        physical: physical_camera(link),
                        available: Some(true),
                    })
                    .collect()
            }),
            in_use_by_other: Some(in_use("webcam")),
        }
    }

    /// Active capture endpoints, and whether any has an active session from another process.
    fn capture_endpoints() -> Option<(Vec<RawMediaDevice>, bool)> {
        // SAFETY: the class ID is a constant and no aggregation is used.
        let enumerator: IMMDeviceEnumerator =
            unsafe { CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL) }.ok()?;
        // SAFETY: valid flow and state constants.
        let collection =
            unsafe { enumerator.EnumAudioEndpoints(eCapture, DEVICE_STATE_ACTIVE) }.ok()?;
        // SAFETY: `collection` is a live endpoint collection.
        let count = unsafe { collection.GetCount() }.ok()?;
        let own = std::process::id();
        let mut devices = Vec::new();
        let mut recording = false;
        for index in 0..count.min(u32::try_from(MAX_DEVICES).unwrap_or(0)) {
            // SAFETY: `index` is below `count`.
            let Ok(device) = (unsafe { collection.Item(index) }) else {
                continue;
            };
            // SAFETY: `device` is live; the identifier is freed below.
            if let Ok(id) = unsafe { device.GetId() } {
                // SAFETY: `id` is a NUL-terminated string the OS allocated.
                let text = unsafe { id.to_string() }.unwrap_or_default();
                // SAFETY: allocated with the COM allocator, freed once.
                unsafe { CoTaskMemFree(Some(id.0.cast())) };
                devices.push(RawMediaDevice {
                    key: fingerprint(text.as_bytes()),
                    physical: true,
                    available: Some(true),
                });
            }
            // SAFETY: `device` is live; the session manager has no activation parameters.
            let Ok(manager) =
                (unsafe { device.Activate::<IAudioSessionManager2>(CLSCTX_ALL, None) })
            else {
                continue;
            };
            // SAFETY: `manager` is live.
            let Ok(sessions) = (unsafe { manager.GetSessionEnumerator() }) else {
                continue;
            };
            // SAFETY: `sessions` is live.
            let total = unsafe { sessions.GetCount() }.unwrap_or(0);
            for session in 0..total.min(256) {
                // SAFETY: `session` is below the session count.
                let Ok(control) = (unsafe { sessions.GetSession(session) }) else {
                    continue;
                };
                // SAFETY: `control` is live.
                let active = unsafe { control.GetState() }
                    .is_ok_and(|state| state == AudioSessionStateActive);
                let other = control
                    .cast::<IAudioSessionControl2>()
                    // SAFETY: `control` is live.
                    .and_then(|control| unsafe { control.GetProcessId() })
                    .is_ok_and(|pid| pid != own);
                recording |= active && other;
            }
        }
        Some((devices, recording))
    }

    /// Active audio capture endpoints from Core Audio; no stream is opened.
    #[must_use]
    pub fn microphones() -> RawMedia {
        let _com = Com::enter();
        let endpoints = capture_endpoints();
        RawMedia {
            permission: permission("microphone"),
            in_use_by_other: endpoints.as_ref().map(|(_, recording)| *recording),
            devices: endpoints.map(|(devices, _)| devices),
        }
    }
}

pub use media::{cameras, microphones};

mod processes {
    use windows::Win32::Foundation::CloseHandle;
    use windows::Win32::System::Diagnostics::ToolHelp::{
        CreateToolhelp32Snapshot, PROCESSENTRY32W, Process32FirstW, Process32NextW,
        TH32CS_SNAPPROCESS,
    };
    use windows::Win32::System::RemoteDesktop::ProcessIdToSessionId;

    use crate::{RawIdentity, RawProcess, fingerprint};

    const MAX_PROCESSES: usize = 32_768;

    fn session(pid: u32) -> Option<u32> {
        let mut session = 0_u32;
        // SAFETY: `session` is a valid out-parameter.
        unsafe { ProcessIdToSessionId(pid, &raw mut session) }.ok()?;
        Some(session)
    }

    /// Every process in the agent's interactive session. A process number and parent are not an
    /// instance by themselves: the snapshot's thread count stands in for a start time until the
    /// privileged service supplies creation times.
    #[must_use]
    pub fn processes() -> Option<Vec<RawProcess>> {
        let own = session(std::process::id())?;
        // SAFETY: a process snapshot takes no process argument.
        let snapshot = unsafe { CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) }.ok()?;
        let mut entry = PROCESSENTRY32W {
            dwSize: u32::try_from(size_of::<PROCESSENTRY32W>()).unwrap_or(0),
            ..PROCESSENTRY32W::default()
        };
        let mut processes = Vec::new();
        // SAFETY: `snapshot` is open and `entry` is sized for the call.
        let mut more = unsafe { Process32FirstW(snapshot, &raw mut entry) }.is_ok();
        while more && processes.len() < MAX_PROCESSES {
            if entry.th32ProcessID != 0 && session(entry.th32ProcessID) == Some(own) {
                processes.push(RawProcess {
                    instance: fingerprint(
                        &[
                            entry.th32ProcessID.to_le_bytes(),
                            entry.th32ParentProcessID.to_le_bytes(),
                        ]
                        .concat(),
                    ),
                    pid: entry.th32ProcessID,
                    parent: entry.th32ParentProcessID,
                });
            }
            // SAFETY: as above.
            more = unsafe { Process32NextW(snapshot, &raw mut entry) }.is_ok();
        }
        // SAFETY: the snapshot handle is closed once.
        let _ = unsafe { CloseHandle(snapshot) };
        Some(processes)
    }

    /// Code identity needs the privileged service, which opens each image itself; the unprivileged
    /// agent cannot verify catalog-signed system files, so it reports none.
    #[must_use]
    pub const fn identity(_pid: u32) -> RawIdentity {
        RawIdentity::Unavailable
    }
}

pub use processes::{identity, processes};

/// Nanoseconds this machine has spent asleep or hibernating since boot: the interrupt time counts
/// sleep, the unbiased interrupt time does not.
#[must_use]
pub fn suspended_ns() -> Option<u64> {
    use windows::Win32::System::WindowsProgramming::{
        QueryInterruptTime, QueryUnbiasedInterruptTime,
    };
    let mut awake = 0_u64;
    // SAFETY: `awake` is a valid out-parameter.
    if !unsafe { QueryUnbiasedInterruptTime(&raw mut awake) }.as_bool() {
        return None;
    }
    // SAFETY: no arguments.
    let total = unsafe { QueryInterruptTime() };
    total.saturating_sub(awake).checked_mul(100)
}

pub mod helper;
pub mod helper_pipe;
