use std::collections::{BTreeMap, BTreeSet};
use std::panic::{self, AssertUnwindSafe};
use std::sync::{Arc, mpsc};
use std::time::Duration;

use native_protocol::{
    PermissionState, PlatformFamily, ProcessApplicationCertainty, ProcessApplicationCoverage,
    ProcessApplicationProcess, ProcessApplicationScope, ProcessApplicationState,
    ProcessExecutableIdentity, ProcessExecutableIdentityStatus,
};
use native_source_runtime::{DeadlineThread, poison_native_source_process, prefer_boundary_error};

use crate::{
    OpenedProcessApplicationBackend, ProcessApplicationBackend, ProcessApplicationEmitter,
    ProcessApplicationError, ProcessApplicationSubscription,
};

use super::unavailable::{
    UnavailableProcessApplicationBackend, UnavailableProcessApplicationSubscription,
};

const MAX_CURRENT_PROCESSES: usize = 256;
const MAX_SESSION_IDENTITIES: usize = 2_048;

type ProcessQuery =
    dyn Fn() -> Result<ProcessApplicationState, ProcessApplicationError> + Send + Sync + 'static;

#[derive(Clone, Copy)]
enum SnapshotWorkerCommand {
    Start,
    Stop,
}

pub(super) struct SnapshotPollingProcessBackend {
    platform: PlatformFamily,
    permission: PermissionState,
    adapter_version: &'static str,
    interval: Duration,
    query: Arc<ProcessQuery>,
}

impl SnapshotPollingProcessBackend {
    pub(super) fn new<Q>(
        platform: PlatformFamily,
        adapter_version: &'static str,
        interval: Duration,
        query: Q,
    ) -> Self
    where
        Q: Fn() -> Result<ProcessApplicationState, ProcessApplicationError> + Send + Sync + 'static,
    {
        Self {
            platform,
            permission: PermissionState::Granted,
            adapter_version,
            interval,
            query: Arc::new(query),
        }
    }

    /// Starts the worker before its authoritative initial query and degrades
    /// only an ordinary query-time backend discovery failure to unavailable.
    pub(super) fn open_with_initial_backend_fallback(
        self,
        emitter: ProcessApplicationEmitter,
        fallback_adapter_version: &'static str,
    ) -> Result<
        OpenedProcessApplicationBackend<InitialFallbackSnapshotProcessSubscription>,
        ProcessApplicationError,
    > {
        let (stop_sender, mut worker) = self.start_worker(emitter.clone())?;
        match (self.query)() {
            Ok(initial_state) => {
                release_snapshot_worker(&stop_sender, &mut worker)?;
                Ok(OpenedProcessApplicationBackend {
                    platform: self.platform,
                    permission: self.permission,
                    adapter_version: self.adapter_version,
                    initial_state,
                    subscription: InitialFallbackSnapshotProcessSubscription::Polling(
                        SnapshotPollingProcessSubscription {
                            stop_sender,
                            worker,
                            query: self.query,
                        },
                    ),
                })
            }
            Err(error) if error.allows_initial_unavailable_fallback() => {
                stop_opening_snapshot_worker(&stop_sender, &mut worker)?;
                let opened = UnavailableProcessApplicationBackend::new(
                    self.platform,
                    fallback_adapter_version,
                )
                .open(emitter)?;
                Ok(OpenedProcessApplicationBackend {
                    platform: opened.platform,
                    permission: opened.permission,
                    adapter_version: opened.adapter_version,
                    initial_state: opened.initial_state,
                    subscription: InitialFallbackSnapshotProcessSubscription::Unavailable(
                        opened.subscription,
                    ),
                })
            }
            Err(error) => Err(prefer_boundary_error(
                error,
                stop_opening_snapshot_worker(&stop_sender, &mut worker),
            )),
        }
    }

    fn start_worker(
        &self,
        emitter: ProcessApplicationEmitter,
    ) -> Result<(mpsc::SyncSender<SnapshotWorkerCommand>, DeadlineThread), ProcessApplicationError>
    {
        if self.interval.is_zero() || self.interval > Duration::from_secs(60) {
            return Err(ProcessApplicationError::InventoryOverflow(
                "snapshot process interval is outside the bounded source range".to_owned(),
            ));
        }
        // Capacity two guarantees an immediate Stop can follow Start even if
        // the newly spawned worker has not consumed the release command yet.
        let (control_sender, control_receiver) = mpsc::sync_channel(2);
        let worker_query = Arc::clone(&self.query);
        let worker_emitter = emitter;
        let interval = self.interval;
        let worker = DeadlineThread::spawn("process-snapshot-worker", move || {
            let result = panic::catch_unwind(AssertUnwindSafe(|| {
                match control_receiver.recv() {
                    Ok(SnapshotWorkerCommand::Start) => {}
                    Ok(SnapshotWorkerCommand::Stop) | Err(_) => return,
                }
                loop {
                    match control_receiver.recv_timeout(interval) {
                        Ok(SnapshotWorkerCommand::Stop)
                        | Err(mpsc::RecvTimeoutError::Disconnected) => break,
                        Ok(SnapshotWorkerCommand::Start) => {}
                        Err(mpsc::RecvTimeoutError::Timeout) => match worker_query() {
                            Ok(state) => worker_emitter.reconcile(state),
                            Err(error) => {
                                worker_emitter.fail(error);
                                break;
                            }
                        },
                    }
                }
            }));
            if result.is_err() {
                worker_emitter.fail(ProcessApplicationError::Backend(
                    "snapshot process worker panicked".to_owned(),
                ));
            }
        })
        .map_err(|error| {
            ProcessApplicationError::Backend(format!(
                "cannot start snapshot process worker: {error}"
            ))
        })?;
        Ok((control_sender, worker))
    }
}

pub enum InitialFallbackSnapshotProcessSubscription {
    Polling(SnapshotPollingProcessSubscription),
    Unavailable(UnavailableProcessApplicationSubscription),
}

impl ProcessApplicationSubscription for InitialFallbackSnapshotProcessSubscription {
    fn stop(self) -> Result<ProcessApplicationState, ProcessApplicationError> {
        match self {
            Self::Polling(subscription) => subscription.stop(),
            Self::Unavailable(subscription) => subscription.stop(),
        }
    }
}

pub struct SnapshotPollingProcessSubscription {
    stop_sender: mpsc::SyncSender<SnapshotWorkerCommand>,
    worker: DeadlineThread,
    query: Arc<ProcessQuery>,
}

impl ProcessApplicationSubscription for SnapshotPollingProcessSubscription {
    fn stop(mut self) -> Result<ProcessApplicationState, ProcessApplicationError> {
        let _ = self.stop_sender.try_send(SnapshotWorkerCommand::Stop);
        self.worker
            .finish(Duration::from_millis(400))
            .map_err(|error| {
                poison_native_source_process();
                ProcessApplicationError::Cleanup(format!(
                    "snapshot process worker {error}; native utility restart is required"
                ))
            })?;
        (self.query)()
    }
}

impl ProcessApplicationBackend for SnapshotPollingProcessBackend {
    type Subscription = SnapshotPollingProcessSubscription;

    fn open(
        self,
        emitter: ProcessApplicationEmitter,
    ) -> Result<OpenedProcessApplicationBackend<Self::Subscription>, ProcessApplicationError> {
        let (stop_sender, mut worker) = self.start_worker(emitter)?;
        let initial_state = match (self.query)() {
            Ok(state) => state,
            Err(primary) => {
                return Err(prefer_boundary_error(
                    primary,
                    stop_opening_snapshot_worker(&stop_sender, &mut worker),
                ));
            }
        };
        release_snapshot_worker(&stop_sender, &mut worker)?;
        Ok(OpenedProcessApplicationBackend {
            platform: self.platform,
            permission: self.permission,
            adapter_version: self.adapter_version,
            initial_state,
            subscription: SnapshotPollingProcessSubscription {
                stop_sender,
                worker,
                query: self.query,
            },
        })
    }
}

fn stop_opening_snapshot_worker(
    stop_sender: &mpsc::SyncSender<SnapshotWorkerCommand>,
    worker: &mut DeadlineThread,
) -> Result<(), ProcessApplicationError> {
    let _ = stop_sender.try_send(SnapshotWorkerCommand::Stop);
    worker.finish(Duration::from_millis(400)).map_err(|error| {
        poison_native_source_process();
        ProcessApplicationError::Cleanup(format!(
            "snapshot process rollback {error}; native utility restart is required"
        ))
    })
}

fn release_snapshot_worker(
    control_sender: &mpsc::SyncSender<SnapshotWorkerCommand>,
    worker: &mut DeadlineThread,
) -> Result<(), ProcessApplicationError> {
    control_sender
        .try_send(SnapshotWorkerCommand::Start)
        .map_err(|error| {
            let primary = ProcessApplicationError::Backend(format!(
                "cannot release snapshot process worker: {error}"
            ));
            prefer_boundary_error(
                primary,
                stop_opening_snapshot_worker(control_sender, worker),
            )
        })
}

#[derive(Default)]
pub(super) struct ProcessIdentityTracker {
    next_identity: u64,
    identities: BTreeMap<String, String>,
}

impl ProcessIdentityTracker {
    #[cfg(any(target_os = "macos", target_os = "windows"))]
    pub(super) fn snapshot(
        &mut self,
        raw_process_keys: Vec<String>,
    ) -> Result<ProcessApplicationState, ProcessApplicationError> {
        self.snapshot_with_scope(
            raw_process_keys,
            ProcessApplicationScope::CandidateInteractiveSession,
        )
    }

    pub(super) fn snapshot_with_scope(
        &mut self,
        raw_process_keys: Vec<String>,
        scope: ProcessApplicationScope,
    ) -> Result<ProcessApplicationState, ProcessApplicationError> {
        let unique = raw_process_keys.into_iter().collect::<BTreeSet<_>>();
        if unique.len() > MAX_CURRENT_PROCESSES {
            return Err(ProcessApplicationError::InventoryOverflow(
                "candidate process inventory exceeds the protocol bound".to_owned(),
            ));
        }
        let mut processes = Vec::with_capacity(unique.len());
        for raw_key in unique {
            let process_instance_id = self.identity(&raw_key)?;
            processes.push(ProcessApplicationProcess {
                process_instance_id,
                scope,
                identity: unavailable_identity(),
            });
        }
        Ok(ProcessApplicationState {
            coverage: ProcessApplicationCoverage::SnapshotOnly,
            certainty: ProcessApplicationCertainty::Partial,
            processes,
        })
    }

    fn identity(&mut self, raw_key: &str) -> Result<String, ProcessApplicationError> {
        if let Some(identity) = self.identities.get(raw_key) {
            return Ok(identity.clone());
        }
        if self.identities.len() >= MAX_SESSION_IDENTITIES {
            return Err(ProcessApplicationError::InventoryOverflow(
                "process source-session identity map is exhausted".to_owned(),
            ));
        }
        self.next_identity = self.next_identity.checked_add(1).ok_or_else(|| {
            ProcessApplicationError::InventoryOverflow(
                "process source-session identity counter overflowed".to_owned(),
            )
        })?;
        let identity = format!("process-instance-{:016x}", self.next_identity);
        self.identities.insert(raw_key.to_owned(), identity.clone());
        Ok(identity)
    }
}

const fn unavailable_identity() -> ProcessExecutableIdentity {
    ProcessExecutableIdentity {
        status: ProcessExecutableIdentityStatus::Unavailable,
        signer_chain_id: None,
        publisher_id: None,
        product_id: None,
        signing_id: None,
        team_id: None,
        designated_requirement: None,
        bundle_id: None,
        package_id: None,
        version: None,
        digest_sha256: None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};

    fn empty_snapshot_state() -> ProcessApplicationState {
        ProcessApplicationState {
            coverage: ProcessApplicationCoverage::SnapshotOnly,
            certainty: ProcessApplicationCertainty::Partial,
            processes: Vec::new(),
        }
    }

    #[test]
    fn source_session_identity_exhaustion_is_an_inventory_overflow() {
        let mut tracker = ProcessIdentityTracker::default();
        for index in 0..MAX_SESSION_IDENTITIES {
            tracker
                .identity(&format!("native-{index}"))
                .expect("bounded identity");
        }
        assert!(matches!(
            tracker.identity("one-too-many"),
            Err(ProcessApplicationError::InventoryOverflow(_))
        ));
    }

    #[test]
    fn native_process_keys_never_cross_the_source_boundary() {
        let mut tracker = ProcessIdentityTracker::default();
        let state = tracker
            .snapshot_with_scope(
                vec!["pid=42;start=private".to_owned()],
                ProcessApplicationScope::CandidateInteractiveSession,
            )
            .expect("snapshot");
        assert_eq!(state.processes.len(), 1);
        assert!(!state.processes[0].process_instance_id.contains("42"));
        assert_eq!(
            state.processes[0].identity.status,
            ProcessExecutableIdentityStatus::Unavailable
        );
    }

    #[test]
    fn an_unclassified_inventory_never_claims_candidate_session_membership() {
        let mut tracker = ProcessIdentityTracker::default();
        let state = tracker
            .snapshot_with_scope(
                vec!["pid=42;start=private".to_owned()],
                ProcessApplicationScope::Unknown,
            )
            .expect("snapshot");
        assert_eq!(state.processes[0].scope, ProcessApplicationScope::Unknown);
    }

    #[test]
    fn authoritative_backend_failure_degrades_after_a_successful_probe() {
        let calls = Arc::new(AtomicUsize::new(0));
        let query_calls = Arc::clone(&calls);
        let query = move || {
            if query_calls.fetch_add(1, Ordering::Relaxed) == 0 {
                Ok(empty_snapshot_state())
            } else {
                Err(ProcessApplicationError::Backend(
                    "inventory disappeared after probe".to_owned(),
                ))
            }
        };
        assert_eq!(query(), Ok(empty_snapshot_state()));
        let emitter = ProcessApplicationEmitter::new(4).expect("emitter");
        let opened = SnapshotPollingProcessBackend::new(
            PlatformFamily::Linux,
            "test-process-snapshot",
            Duration::from_secs(1),
            query,
        )
        .open_with_initial_backend_fallback(emitter, "test-process-unavailable")
        .expect("ordinary authoritative query failure degrades");

        assert_eq!(opened.permission, PermissionState::Unavailable);
        assert_eq!(opened.adapter_version, "test-process-unavailable");
        assert_eq!(
            opened.initial_state.coverage,
            ProcessApplicationCoverage::Unavailable
        );
        assert_eq!(
            opened
                .subscription
                .stop()
                .expect("unavailable subscription stops")
                .coverage,
            ProcessApplicationCoverage::Unavailable
        );
    }

    #[test]
    fn authoritative_inventory_overflow_remains_terminal() {
        let emitter = ProcessApplicationEmitter::new(4).expect("emitter");
        let result = SnapshotPollingProcessBackend::new(
            PlatformFamily::Linux,
            "test-process-snapshot",
            Duration::from_secs(1),
            || {
                Err(ProcessApplicationError::InventoryOverflow(
                    "bounded inventory changed during open".to_owned(),
                ))
            },
        )
        .open_with_initial_backend_fallback(emitter, "test-process-unavailable");

        assert!(matches!(
            result,
            Err(ProcessApplicationError::InventoryOverflow(message))
                if message == "bounded inventory changed during open"
        ));
    }
}
