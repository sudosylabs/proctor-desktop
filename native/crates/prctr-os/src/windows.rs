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
    fn query<T>(
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

    fn locked(session: u32) -> Option<bool> {
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
