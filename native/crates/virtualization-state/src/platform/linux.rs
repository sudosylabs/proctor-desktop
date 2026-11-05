use std::path::Path;

use crate::VirtualizationWire;
use native_protocol::{
    PermissionState, PlatformFamily, ProtocolValidationError, ProtocolViolation,
    VirtualizationState,
};
use native_source_runtime::{
    BoundedFileReadError, OpenedPassiveStateBackend, PassiveStateBackend, PassiveStateEmitter,
    PassiveStateSourceError, StaticPassiveStateBackend, StaticPassiveStateSubscription,
    read_bounded_utf8_file,
};

use super::classification::{
    complete_unknown, marker_recognizes_guest, partial_unknown, recognized_guest,
};

const MARKER_PATHS: [&str; 5] = [
    "/sys/hypervisor/type",
    "/sys/devices/virtual/dmi/id/product_name",
    "/sys/devices/virtual/dmi/id/sys_vendor",
    "/sys/devices/virtual/dmi/id/board_vendor",
    "/proc/device-tree/hypervisor/compatible",
];
const MAX_MARKER_BYTES: usize = 65_536;

pub struct PlatformVirtualizationBackend;

impl PassiveStateBackend<VirtualizationWire> for PlatformVirtualizationBackend {
    type Subscription = StaticPassiveStateSubscription<VirtualizationWire>;

    fn open(
        self,
        emitter: PassiveStateEmitter<VirtualizationWire>,
    ) -> Result<
        OpenedPassiveStateBackend<VirtualizationWire, Self::Subscription>,
        PassiveStateSourceError,
    > {
        StaticPassiveStateBackend::new(
            PlatformFamily::Linux,
            PermissionState::Granted,
            "linux-guest-markers-v1",
            classify_paths(&MARKER_PATHS.map(Path::new))?,
        )
        .open(emitter)
    }
}

fn classify_paths(paths: &[&Path]) -> Result<VirtualizationState, PassiveStateSourceError> {
    let mut readable = 0_usize;
    for path in paths {
        match read_bounded_utf8_file(path, MAX_MARKER_BYTES) {
            Ok(marker) => {
                readable += 1;
                if marker_recognizes_guest(&marker) {
                    return Ok(recognized_guest());
                }
            }
            Err(BoundedFileReadError::Io(_)) => {}
            Err(BoundedFileReadError::Overflow { .. }) => {
                return Err(PassiveStateSourceError::InventoryOverflow(
                    "Linux virtualization marker exceeds the source bound".to_owned(),
                ));
            }
            Err(BoundedFileReadError::InvalidUtf8) => {
                return Err(PassiveStateSourceError::Protocol(
                    ProtocolViolation::Schema(ProtocolValidationError {
                        type_name: "LinuxVirtualizationAdapter",
                        field: "marker",
                        rule: "valid UTF-8 bounded platform marker",
                    }),
                ));
            }
        }
    }
    if readable == paths.len() {
        Ok(complete_unknown())
    } else {
        Ok(partial_unknown())
    }
}
