#![deny(unsafe_code)]

mod platform;
use native_protocol::{
    PermissionState, PlatformFamily, REMOVABLE_STORAGE_SCHEMA_VERSION, RemovableStorageCertainty,
    RemovableStorageCoverage, RemovableStorageDrain, RemovableStorageEvent,
    RemovableStorageEventKind, RemovableStorageObservation, RemovableStorageSourceSnapshot,
    RemovableStorageState, SourceFailureCode, SourceHealth, SourceReset,
};
pub use native_source_runtime::{
    OpenedPassiveStateBackend as OpenedRemovableStorageBackend,
    PassiveStateBackend as RemovableStorageBackend, PassiveStateEmitter as RemovableStorageEmitter,
    PassiveStateSource as RemovableStorageSource, PassiveStateSourceError as RemovableStorageError,
    PassiveStateSubscription as RemovableStorageSubscription,
    UnavailablePassiveStateSubscription as UnavailableRemovableStorageSubscription,
};
use native_source_runtime::{
    PassiveStateEventKind, PassiveStateWire, SequencedObservation, SourceSessionMetadata,
};
pub use platform::PlatformRemovableStorageBackend;

pub struct RemovableStorageWire;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct RemovableStorageSelection {
    block_storage: bool,
    portable_mtp: bool,
}

impl RemovableStorageSelection {
    #[must_use]
    pub const fn new(block_storage: bool, portable_mtp: bool) -> Option<Self> {
        if block_storage || portable_mtp {
            Some(Self {
                block_storage,
                portable_mtp,
            })
        } else {
            None
        }
    }

    #[must_use]
    pub const fn all() -> Self {
        Self {
            block_storage: true,
            portable_mtp: true,
        }
    }

    #[must_use]
    pub const fn includes_block_storage(self) -> bool {
        self.block_storage
    }

    #[must_use]
    pub const fn includes_portable_mtp(self) -> bool {
        self.portable_mtp
    }
}

impl PassiveStateWire for RemovableStorageWire {
    type State = RemovableStorageState;
    type Event = RemovableStorageEvent;
    type Snapshot = RemovableStorageSourceSnapshot;
    type Observation = RemovableStorageObservation;
    type Drain = RemovableStorageDrain;
    const SCHEMA_VERSION: u16 = REMOVABLE_STORAGE_SCHEMA_VERSION;
    const SOURCE_VERSION: &'static str = env!("CARGO_PKG_VERSION");
    const STOP_THREAD_NAME: &'static str = "prctr-removable-storage-stop";
    fn health(state: &Self::State) -> SourceHealth {
        if !matches!(state.coverage, RemovableStorageCoverage::Unavailable)
            && matches!(state.certainty, RemovableStorageCertainty::Complete)
        {
            SourceHealth::Healthy
        } else {
            SourceHealth::Degraded
        }
    }
    fn unavailable_state() -> Self::State {
        RemovableStorageState {
            coverage: RemovableStorageCoverage::Unavailable,
            certainty: RemovableStorageCertainty::Unknown,
            attached_functions: Vec::new(),
        }
    }
    fn event(kind: PassiveStateEventKind, state: Self::State) -> Self::Event {
        RemovableStorageEvent {
            kind: match kind {
                PassiveStateEventKind::Changed => RemovableStorageEventKind::Changed,
                PassiveStateEventKind::Reconciled => RemovableStorageEventKind::Reconciled,
            },
            state,
        }
    }
    fn snapshot(
        metadata: SourceSessionMetadata,
        platform: PlatformFamily,
        permission: PermissionState,
        adapter_version: &str,
        state: Self::State,
    ) -> Self::Snapshot {
        RemovableStorageSourceSnapshot {
            source_instance_id: metadata.source_instance_id,
            source_version: Self::SOURCE_VERSION.to_owned(),
            adapter_version: adapter_version.to_owned(),
            schema_version: Self::SCHEMA_VERSION,
            platform,
            permission,
            health: metadata.health,
            sequence: 0,
            observed_at: metadata.observed_at,
            state,
        }
    }
    fn observation(
        source_instance_id: String,
        fact: SequencedObservation<Self::Event>,
    ) -> Self::Observation {
        RemovableStorageObservation {
            source_instance_id,
            sequence: fact.sequence,
            observed_at: fact.observed_at,
            gap: fact.gap,
            event: fact.payload,
        }
    }
    fn drain(
        source_instance_id: String,
        health: SourceHealth,
        observations: Vec<Self::Observation>,
        resets: Vec<SourceReset>,
        terminal_error: Option<SourceFailureCode>,
    ) -> Self::Drain {
        RemovableStorageDrain {
            source_instance_id,
            health,
            observations,
            resets,
            terminal_error,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use native_protocol::SourceOpenRequest;

    #[test]
    fn platform_boundary_reports_truthful_coverage() {
        let request = SourceOpenRequest {
            collection_session_id: "removable-storage-session-0001".to_owned(),
            requested_schema_version: REMOVABLE_STORAGE_SCHEMA_VERSION,
            queue_capacity: 8,
        };
        let mut source = RemovableStorageSource::<RemovableStorageWire, _>::open(
            &request,
            PlatformRemovableStorageBackend::new(RemovableStorageSelection::all()),
        )
        .expect("source opens");
        match source.snapshot().state.coverage {
            RemovableStorageCoverage::Unavailable => {
                assert_eq!(source.snapshot().health, SourceHealth::Degraded);
                assert_eq!(
                    source.snapshot().state,
                    RemovableStorageWire::unavailable_state()
                );
            }
            RemovableStorageCoverage::SnapshotOnly => {
                assert_eq!(source.snapshot().health, SourceHealth::Degraded);
                assert_eq!(
                    source.snapshot().state.certainty,
                    RemovableStorageCertainty::Partial
                );
            }
            RemovableStorageCoverage::BlockOnly => {
                assert_eq!(source.snapshot().health, SourceHealth::Healthy);
                assert_eq!(
                    source.snapshot().state.certainty,
                    RemovableStorageCertainty::Complete
                );
            }
            RemovableStorageCoverage::BlockAndPortable => {
                panic!("initial adapters do not claim complete portable-device coverage")
            }
        }
        assert_eq!(source.stop().health, SourceHealth::Stopped);
    }

    #[test]
    fn portable_only_selection_never_collects_block_storage() {
        let request = SourceOpenRequest {
            collection_session_id: "portable-storage-session-0001".to_owned(),
            requested_schema_version: REMOVABLE_STORAGE_SCHEMA_VERSION,
            queue_capacity: 8,
        };
        let selection = RemovableStorageSelection::new(false, true).expect("portable selection");
        let mut source = RemovableStorageSource::<RemovableStorageWire, _>::open(
            &request,
            PlatformRemovableStorageBackend::new(selection),
        )
        .expect("unsupported portable source degrades explicitly");

        assert_eq!(
            source.snapshot().state,
            RemovableStorageWire::unavailable_state()
        );
        assert_eq!(source.stop().health, SourceHealth::Stopped);
    }
}
