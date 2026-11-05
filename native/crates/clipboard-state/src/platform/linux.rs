use crate::ClipboardWire;
use native_protocol::PlatformFamily;
use native_source_runtime::{
    OpenedPassiveStateBackend, PassiveStateBackend, PassiveStateEmitter, PassiveStateSourceError,
    UnavailablePassiveStateBackend, UnavailablePassiveStateSubscription,
};

pub struct PlatformClipboardBackend;

impl PassiveStateBackend<ClipboardWire> for PlatformClipboardBackend {
    type Subscription = UnavailablePassiveStateSubscription<ClipboardWire>;

    fn open(
        self,
        emitter: PassiveStateEmitter<ClipboardWire>,
    ) -> Result<OpenedPassiveStateBackend<ClipboardWire, Self::Subscription>, PassiveStateSourceError>
    {
        // Generic Linux has no compositor-independent clipboard generation.
        UnavailablePassiveStateBackend::new(
            PlatformFamily::Linux,
            "generic-linux-clipboard-unavailable-v1",
        )
        .open(emitter)
    }
}
