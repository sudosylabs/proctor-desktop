use crate::VirtualizationWire;
use prctr_native_protocol::PlatformFamily;
use prctr_native_source_runtime::{
    OpenedPassiveStateBackend, PassiveStateBackend, PassiveStateEmitter, PassiveStateSourceError,
    UnavailablePassiveStateBackend, UnavailablePassiveStateSubscription,
};

pub struct PlatformVirtualizationBackend;

impl PassiveStateBackend<VirtualizationWire> for PlatformVirtualizationBackend {
    type Subscription = UnavailablePassiveStateSubscription<VirtualizationWire>;

    fn open(
        self,
        emitter: PassiveStateEmitter<VirtualizationWire>,
    ) -> Result<
        OpenedPassiveStateBackend<VirtualizationWire, Self::Subscription>,
        PassiveStateSourceError,
    > {
        // macOS exposes no public generic guest/root classification API. A CPU
        // feature or model string would overstate this capability.
        UnavailablePassiveStateBackend::new(
            PlatformFamily::Macos,
            "macos-public-classification-unavailable-v1",
        )
        .open(emitter)
    }
}
