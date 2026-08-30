use crate::PrintSpoolerWire;
use prctr_native_protocol::PlatformFamily;
use prctr_native_source_runtime::{
    OpenedPassiveStateBackend, PassiveStateBackend, PassiveStateEmitter, PassiveStateSourceError,
    UnavailablePassiveStateBackend, UnavailablePassiveStateSubscription,
};

pub struct PlatformPrintSpoolerBackend;

impl PassiveStateBackend<PrintSpoolerWire> for PlatformPrintSpoolerBackend {
    type Subscription = UnavailablePassiveStateSubscription<PrintSpoolerWire>;

    fn open(
        self,
        emitter: PassiveStateEmitter<PrintSpoolerWire>,
    ) -> Result<
        OpenedPassiveStateBackend<PrintSpoolerWire, Self::Subscription>,
        PassiveStateSourceError,
    > {
        UnavailablePassiveStateBackend::new(
            current_platform(),
            "bounded-print-spooler-inventory-unavailable-v1",
        )
        .open(emitter)
    }
}

const fn current_platform() -> PlatformFamily {
    #[cfg(target_os = "macos")]
    {
        PlatformFamily::Macos
    }
    #[cfg(target_os = "linux")]
    {
        PlatformFamily::Linux
    }
}
