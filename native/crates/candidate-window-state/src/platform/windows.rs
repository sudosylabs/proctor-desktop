use native_protocol::{CandidateWindowState, PlatformFamily};

use super::event_backend::{
    CandidateWindowUtilityReceiver, UtilityIngressBackend, UtilityIngressSubscription,
};
use crate::{
    CandidateWindowBackend, CandidateWindowEmitter, CandidateWindowError,
    OpenedCandidateWindowBackend,
};

pub struct WindowsCandidateWindowBackend {
    backend: UtilityIngressBackend,
}

impl WindowsCandidateWindowBackend {
    /// Binds the utility-local queue populated after private-port decoding.
    #[must_use]
    pub fn new(
        initial_window: CandidateWindowState,
        ingress: CandidateWindowUtilityReceiver,
    ) -> Self {
        Self {
            backend: UtilityIngressBackend::new(
                PlatformFamily::Windows,
                "utility-post-ipc-v1",
                initial_window,
                ingress,
            ),
        }
    }
}

impl CandidateWindowBackend for WindowsCandidateWindowBackend {
    type Subscription = UtilityIngressSubscription;

    fn open(
        self,
        emitter: CandidateWindowEmitter,
    ) -> Result<OpenedCandidateWindowBackend<Self::Subscription>, CandidateWindowError> {
        self.backend.open(emitter)
    }
}
