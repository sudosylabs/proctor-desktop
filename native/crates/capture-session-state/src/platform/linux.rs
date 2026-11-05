use native_protocol::PlatformFamily;

use super::static_coverage::{StaticCoverageBackend, StaticCoverageSubscription};
use crate::{
    CaptureSessionBackend, CaptureSessionEmitter, CaptureSessionError, OpenedCaptureSessionBackend,
};

pub struct LinuxCaptureSessionBackend;

impl CaptureSessionBackend for LinuxCaptureSessionBackend {
    type Subscription = StaticCoverageSubscription;

    fn open(
        self,
        emitter: CaptureSessionEmitter,
    ) -> Result<OpenedCaptureSessionBackend<Self::Subscription>, CaptureSessionError> {
        StaticCoverageBackend::new(PlatformFamily::Linux, "unsupported-public-signals")
            .open(emitter)
    }
}
