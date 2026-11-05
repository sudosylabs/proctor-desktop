use std::time::Duration;

use crate::ClipboardWire;
use native_protocol::{
    ClipboardCertainty, ClipboardCoverage, ClipboardState, PermissionState, PlatformFamily,
};
use native_source_runtime::{
    InitialFallbackPollingSubscription, OpenedPassiveStateBackend, PassiveStateBackend,
    PassiveStateEmitter, PassiveStateSourceError, PassiveStateWire, PollingPassiveStateBackend,
};
use windows_sys::Win32::System::DataExchange::GetClipboardSequenceNumber;

pub struct PlatformClipboardBackend;

impl PassiveStateBackend<ClipboardWire> for PlatformClipboardBackend {
    type Subscription = InitialFallbackPollingSubscription<ClipboardWire>;

    fn open(
        self,
        emitter: PassiveStateEmitter<ClipboardWire>,
    ) -> Result<OpenedPassiveStateBackend<ClipboardWire, Self::Subscription>, PassiveStateSourceError>
    {
        PollingPassiveStateBackend::new(
            PlatformFamily::Windows,
            PermissionState::Granted,
            "windows-clipboard-sequence-v1",
            Duration::from_millis(250),
            query_state as fn() -> Result<ClipboardState, PassiveStateSourceError>,
        )
        .open_with_initial_backend_fallback(
            emitter,
            "windows-clipboard-unavailable-v1",
            ClipboardWire::unavailable_state(),
        )
    }
}

fn query_state() -> Result<ClipboardState, PassiveStateSourceError> {
    // SAFETY: GetClipboardSequenceNumber has no pointer arguments and reads no
    // clipboard contents. It returns a desktop-scoped mechanical counter.
    let generation = unsafe { GetClipboardSequenceNumber() };
    if generation == 0 {
        return Err(PassiveStateSourceError::Backend(
            "Windows clipboard sequence is unavailable for this window station".to_owned(),
        ));
    }
    Ok(ClipboardState {
        coverage: ClipboardCoverage::SnapshotCounter,
        certainty: ClipboardCertainty::Partial,
        change_generation: u64::from(generation),
    })
}
