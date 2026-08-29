use prctr_capture_session_state::{
    CaptureSessionBackend, CaptureSessionEmitter, CaptureSessionError, CaptureSessionSource,
    CaptureSessionSubscription, OpenedCaptureSessionBackend,
};
use prctr_native_protocol::{
    CAPTURE_SESSION_SCHEMA_VERSION, CaptureSessionActivity, CaptureSessionCertainty,
    CaptureSessionSignal, CaptureSessionState, CaptureSessionSupport, PermissionState,
    PlatformFamily, SourceFailureCode, SourceHealth, SourceOpenRequest,
};

struct BoundaryFailureBackend;
struct BoundaryFailureSubscription;

impl CaptureSessionSubscription for BoundaryFailureSubscription {
    fn stop(self) -> Result<CaptureSessionState, CaptureSessionError> {
        // A backend-category error is deliberately used here to prove that no
        // stop error can escape the process poison fence.
        Err(CaptureSessionError::Backend(
            "closed-input boundary was not established".to_owned(),
        ))
    }
}

impl CaptureSessionBackend for BoundaryFailureBackend {
    type Subscription = BoundaryFailureSubscription;

    fn open(
        self,
        _emitter: CaptureSessionEmitter,
    ) -> Result<OpenedCaptureSessionBackend<Self::Subscription>, CaptureSessionError> {
        Ok(OpenedCaptureSessionBackend {
            platform: PlatformFamily::Linux,
            permission: PermissionState::Unavailable,
            adapter_version: "cleanup-fence-test-v1",
            initial_state: unsupported_state(),
            subscription: BoundaryFailureSubscription,
        })
    }
}

#[test]
fn every_subscription_stop_error_fences_future_openings() {
    let mut source = CaptureSessionSource::open(&request(), BoundaryFailureBackend)
        .expect("first source opens before process poison");
    let stopped = source.stop();
    assert_eq!(stopped.health, SourceHealth::Failed);
    assert_eq!(stopped.terminal_error, Some(SourceFailureCode::Backend));

    let reopened = CaptureSessionSource::open(&request(), BoundaryFailureBackend);
    assert!(matches!(reopened, Err(CaptureSessionError::Cleanup(_))));
}

fn request() -> SourceOpenRequest {
    SourceOpenRequest {
        collection_session_id: "cleanup-fence-integration".to_owned(),
        requested_schema_version: CAPTURE_SESSION_SCHEMA_VERSION,
        queue_capacity: 8,
    }
}

fn unsupported_state() -> CaptureSessionState {
    let signal = CaptureSessionSignal {
        support: CaptureSessionSupport::Unsupported,
        activity: CaptureSessionActivity::Unknown,
        certainty: CaptureSessionCertainty::Unknown,
    };
    CaptureSessionState {
        screen_capture: signal.clone(),
        native_remote_session: signal,
    }
}
