use crate::InteractiveSessionWire;
use native_protocol::PlatformFamily;
use native_source_runtime::{
    OpenedPassiveStateBackend, PassiveStateBackend, PassiveStateEmitter, PassiveStateSourceError,
    UnavailablePassiveStateBackend, UnavailablePassiveStateSubscription,
};

pub struct PlatformInteractiveSessionBackend;

impl PassiveStateBackend<InteractiveSessionWire> for PlatformInteractiveSessionBackend {
    type Subscription = UnavailablePassiveStateSubscription<InteractiveSessionWire>;

    fn open(
        self,
        emitter: PassiveStateEmitter<InteractiveSessionWire>,
    ) -> Result<
        OpenedPassiveStateBackend<InteractiveSessionWire, Self::Subscription>,
        PassiveStateSourceError,
    > {
        UnavailablePassiveStateBackend::new(
            PlatformFamily::Macos,
            "macos-session-helper-unavailable-v1",
        )
        .open(emitter)
    }
}
