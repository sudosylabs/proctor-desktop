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
