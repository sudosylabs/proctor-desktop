use native_protocol::{
    CaptureSessionActivity, CaptureSessionCertainty, CaptureSessionSignal, CaptureSessionState,
    CaptureSessionSupport, PermissionState, PlatformFamily,
};

use crate::{
    CaptureSessionBackend, CaptureSessionEmitter, CaptureSessionError, CaptureSessionSubscription,
    OpenedCaptureSessionBackend,
};

pub(super) struct StaticCoverageBackend {
    platform: PlatformFamily,
    adapter_version: &'static str,
}

impl StaticCoverageBackend {
    pub(super) fn new(platform: PlatformFamily, adapter_version: &'static str) -> Self {
        Self {
            platform,
            adapter_version,
        }
    }
}

#[doc(hidden)]
pub struct StaticCoverageSubscription {
    final_state: CaptureSessionState,
}

impl CaptureSessionSubscription for StaticCoverageSubscription {
    fn stop(self) -> Result<CaptureSessionState, CaptureSessionError> {
        Ok(self.final_state)
    }
}

impl CaptureSessionBackend for StaticCoverageBackend {
    type Subscription = StaticCoverageSubscription;

    fn open(
        self,
        _emitter: CaptureSessionEmitter,
    ) -> Result<OpenedCaptureSessionBackend<Self::Subscription>, CaptureSessionError> {
        let state = unsupported_state();
        Ok(OpenedCaptureSessionBackend {
            platform: self.platform,
            permission: PermissionState::Unavailable,
            adapter_version: self.adapter_version,
            initial_state: state.clone(),
            subscription: StaticCoverageSubscription { final_state: state },
        })
    }
}

fn unsupported_state() -> CaptureSessionState {
    let unsupported = CaptureSessionSignal {
        support: CaptureSessionSupport::Unsupported,
        activity: CaptureSessionActivity::Unknown,
        certainty: CaptureSessionCertainty::Unknown,
    };
    CaptureSessionState {
        screen_capture: unsupported.clone(),
        native_remote_session: unsupported,
    }
}
