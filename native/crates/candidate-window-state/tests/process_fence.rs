use std::sync::mpsc::{self, Receiver};

use candidate_window_state::{
    CandidateWindowBackend, CandidateWindowError, CandidateWindowSource,
    CandidateWindowSubscription, OpenedCandidateWindowBackend,
};
use display_topology::{
    DisplayTopologyBackend, DisplayTopologyError, DisplayTopologySource,
    DisplayTopologySubscription, OpenedDisplayTopologyBackend,
};
use native_protocol::{
    CANDIDATE_WINDOW_SCHEMA_VERSION, CandidateWindowBounds, CandidateWindowCertainty,
    CandidateWindowFocus, CandidateWindowPlacement, CandidateWindowPresence, CandidateWindowState,
    CandidateWindowVisibility, DISPLAY_TOPOLOGY_SCHEMA_VERSION, PermissionState, PlatformFamily,
    SourceOpenRequest,
};

struct HangingCandidateBackend {
    release: Receiver<()>,
}

struct HangingCandidateSubscription(Receiver<()>);

impl CandidateWindowSubscription for HangingCandidateSubscription {
    fn stop(self) -> Result<CandidateWindowState, CandidateWindowError> {
        let _ = self.0.recv();
        Ok(candidate_window())
    }
}

impl CandidateWindowBackend for HangingCandidateBackend {
    type Subscription = HangingCandidateSubscription;

    fn open(
        self,
        _emitter: candidate_window_state::CandidateWindowEmitter,
    ) -> Result<OpenedCandidateWindowBackend<Self::Subscription>, CandidateWindowError> {
        Ok(OpenedCandidateWindowBackend {
            platform: PlatformFamily::Linux,
            permission: PermissionState::Granted,
            adapter_version: "process-fence-test",
            initial_window: candidate_window(),
            subscription: HangingCandidateSubscription(self.release),
        })
    }
}

struct NeverDisplayBackend;
struct NeverDisplaySubscription;

impl DisplayTopologySubscription for NeverDisplaySubscription {
    fn stop(&mut self) -> Result<native_protocol::DisplayTopologySnapshot, DisplayTopologyError> {
        panic!("a poisoned process must reject before creating a display subscription")
    }
}

impl DisplayTopologyBackend for NeverDisplayBackend {
    type Subscription = NeverDisplaySubscription;

    fn open(
        self,
        _emitter: display_topology::DisplayTopologyEmitter,
    ) -> Result<OpenedDisplayTopologyBackend<Self::Subscription>, DisplayTopologyError> {
        panic!("a poisoned process must reject before opening another capability")
    }
}

fn candidate_window() -> CandidateWindowState {
    CandidateWindowState {
        certainty: CandidateWindowCertainty::Complete,
        presence: CandidateWindowPresence::Present,
        focus: CandidateWindowFocus::Focused,
        visibility: CandidateWindowVisibility::Visible,
        placement: CandidateWindowPlacement::Maximized,
        bounds: Some(CandidateWindowBounds {
            x: 0,
            y: 0,
            width: 1920,
            height: 1080,
        }),
        display_target_id: Some("display-1".to_owned()),
    }
}

fn request(schema_version: u16) -> SourceOpenRequest {
    SourceOpenRequest {
        collection_session_id: "cross-capability-fence-session".to_owned(),
        requested_schema_version: schema_version,
        queue_capacity: 8,
    }
}

#[test]
fn candidate_cleanup_timeout_fences_display_open_in_the_same_utility_process() {
    let (release_sender, release_receiver) = mpsc::sync_channel(1);
    let mut candidate = CandidateWindowSource::open(
        &request(CANDIDATE_WINDOW_SCHEMA_VERSION),
        HangingCandidateBackend {
            release: release_receiver,
        },
    )
    .expect("candidate source opens before the process is poisoned");

    let final_batch = candidate.stop();
    assert_eq!(
        final_batch.terminal_error,
        Some(native_protocol::SourceFailureCode::Cleanup)
    );

    let display = DisplayTopologySource::<NeverDisplaySubscription>::open(
        &request(DISPLAY_TOPOLOGY_SCHEMA_VERSION),
        NeverDisplayBackend,
    );
    assert!(matches!(display, Err(DisplayTopologyError::Cleanup(_))));

    release_sender
        .send(())
        .expect("release the detached cleanup worker");
}
