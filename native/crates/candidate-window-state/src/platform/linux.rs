use native_protocol::{CandidateWindowState, PlatformFamily};

use super::event_backend::{
    CandidateWindowUtilityReceiver, UtilityIngressBackend, UtilityIngressSubscription,
};
use crate::{
    CandidateWindowBackend, CandidateWindowEmitter, CandidateWindowError,
    OpenedCandidateWindowBackend,
};

pub struct LinuxCandidateWindowBackend {
    backend: UtilityIngressBackend,
}

impl LinuxCandidateWindowBackend {
    /// Binds the same utility-local queue used on secure targets. This keeps
    /// future Linux compatibility without claiming secure-target conformance.
    #[must_use]
    pub fn new(
        initial_window: CandidateWindowState,
        ingress: CandidateWindowUtilityReceiver,
    ) -> Self {
        Self {
            backend: UtilityIngressBackend::new(
                PlatformFamily::Linux,
                "utility-post-ipc-v1",
                initial_window,
                ingress,
            ),
        }
    }
}

impl CandidateWindowBackend for LinuxCandidateWindowBackend {
    type Subscription = UtilityIngressSubscription;

    fn open(
        self,
        emitter: CandidateWindowEmitter,
    ) -> Result<OpenedCandidateWindowBackend<Self::Subscription>, CandidateWindowError> {
        self.backend.open(emitter)
    }
}
