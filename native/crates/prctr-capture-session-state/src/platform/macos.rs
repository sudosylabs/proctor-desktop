use prctr_native_protocol::PlatformFamily;

use super::static_coverage::{StaticCoverageBackend, StaticCoverageSubscription};
use crate::{
    CaptureSessionBackend, CaptureSessionEmitter, CaptureSessionError, OpenedCaptureSessionBackend,
};

pub struct MacOsCaptureSessionBackend;

impl CaptureSessionBackend for MacOsCaptureSessionBackend {
    type Subscription = StaticCoverageSubscription;

    fn open(
        self,
        emitter: CaptureSessionEmitter,
    ) -> Result<OpenedCaptureSessionBackend<Self::Subscription>, CaptureSessionError> {
        StaticCoverageBackend::new(PlatformFamily::Macos, "unsupported-public-signals-v1")
            .open(emitter)
    }
}
