use prctr_native_protocol::{CandidateWindowState, PlatformFamily};

use super::event_backend::{
    CandidateWindowUtilityReceiver, UtilityIngressBackend, UtilityIngressSubscription,
};
use crate::{
    CandidateWindowBackend, CandidateWindowEmitter, CandidateWindowError,
    OpenedCandidateWindowBackend,
};

pub struct MacOsCandidateWindowBackend {
    backend: UtilityIngressBackend,
}

impl MacOsCandidateWindowBackend {
    /// Binds the utility-local queue populated after private-port decoding.
    #[must_use]
    pub fn new(
        initial_window: CandidateWindowState,
        ingress: CandidateWindowUtilityReceiver,
    ) -> Self {
        Self {
            backend: UtilityIngressBackend::new(
                PlatformFamily::Macos,
                "utility-post-ipc-v1",
                initial_window,
                ingress,
            ),
        }
    }
}

impl CandidateWindowBackend for MacOsCandidateWindowBackend {
    type Subscription = UtilityIngressSubscription;

    fn open(
        self,
        emitter: CandidateWindowEmitter,
    ) -> Result<OpenedCandidateWindowBackend<Self::Subscription>, CandidateWindowError> {
        self.backend.open(emitter)
    }
}
