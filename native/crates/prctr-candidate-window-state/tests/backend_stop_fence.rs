use prctr_candidate_window_state::{
    CandidateWindowBackend, CandidateWindowEmitter, CandidateWindowError, CandidateWindowSource,
    CandidateWindowSubscription, OpenedCandidateWindowBackend,
};
use prctr_native_protocol::{
    CANDIDATE_WINDOW_SCHEMA_VERSION, CandidateWindowBounds, CandidateWindowCertainty,
    CandidateWindowFocus, CandidateWindowPlacement, CandidateWindowPresence, CandidateWindowState,
    CandidateWindowVisibility, PermissionState, PlatformFamily, SourceFailureCode, SourceHealth,
    SourceOpenRequest,
};

struct BoundaryFailureBackend;
struct BoundaryFailureSubscription;

impl CandidateWindowSubscription for BoundaryFailureSubscription {
    fn stop(self) -> Result<CandidateWindowState, CandidateWindowError> {
        Err(CandidateWindowError::Backend(
            "closed-input boundary was not established".to_owned(),
        ))
    }
}

impl CandidateWindowBackend for BoundaryFailureBackend {
    type Subscription = BoundaryFailureSubscription;

    fn open(
        self,
        _emitter: CandidateWindowEmitter,
    ) -> Result<OpenedCandidateWindowBackend<Self::Subscription>, CandidateWindowError> {
        Ok(OpenedCandidateWindowBackend {
            platform: PlatformFamily::Linux,
            permission: PermissionState::Granted,
            adapter_version: "backend-stop-fence-test-v1",
            initial_window: candidate_window(),
            subscription: BoundaryFailureSubscription,
        })
    }
}

#[test]
fn backend_category_stop_error_fences_future_candidate_openings() {
    let mut source = CandidateWindowSource::open(&request(), BoundaryFailureBackend)
        .expect("first source opens before process poison");
    let stopped = source.stop();
    assert_eq!(stopped.health, SourceHealth::Failed);
    assert_eq!(stopped.terminal_error, Some(SourceFailureCode::Backend));

    let reopened = CandidateWindowSource::open(&request(), BoundaryFailureBackend);
    assert!(matches!(reopened, Err(CandidateWindowError::Cleanup(_))));
}

fn request() -> SourceOpenRequest {
    SourceOpenRequest {
        collection_session_id: "candidate-backend-stop-fence".to_owned(),
        requested_schema_version: CANDIDATE_WINDOW_SCHEMA_VERSION,
        queue_capacity: 8,
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
