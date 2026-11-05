use native_protocol::{
    PermissionState, PlatformFamily, ProcessApplicationCertainty, ProcessApplicationCoverage,
    ProcessApplicationState,
};

use crate::{
    OpenedProcessApplicationBackend, ProcessApplicationBackend, ProcessApplicationEmitter,
    ProcessApplicationError, ProcessApplicationSubscription,
};

pub(super) struct UnavailableProcessApplicationBackend {
    platform: PlatformFamily,
    adapter_version: &'static str,
}

impl UnavailableProcessApplicationBackend {
    pub(super) const fn new(platform: PlatformFamily, adapter_version: &'static str) -> Self {
        Self {
            platform,
            adapter_version,
        }
    }
}

pub struct UnavailableProcessApplicationSubscription {
    final_state: ProcessApplicationState,
}

impl ProcessApplicationSubscription for UnavailableProcessApplicationSubscription {
    fn stop(self) -> Result<ProcessApplicationState, ProcessApplicationError> {
        Ok(self.final_state)
    }
}

impl ProcessApplicationBackend for UnavailableProcessApplicationBackend {
    type Subscription = UnavailableProcessApplicationSubscription;

    fn open(
        self,
        _emitter: ProcessApplicationEmitter,
    ) -> Result<OpenedProcessApplicationBackend<Self::Subscription>, ProcessApplicationError> {
        let state = ProcessApplicationState {
            coverage: ProcessApplicationCoverage::Unavailable,
            certainty: ProcessApplicationCertainty::Unknown,
            processes: Vec::new(),
        };
        Ok(OpenedProcessApplicationBackend {
            platform: self.platform,
            permission: PermissionState::Unavailable,
            adapter_version: self.adapter_version,
            initial_state: state.clone(),
            subscription: UnavailableProcessApplicationSubscription { final_state: state },
        })
    }
}
