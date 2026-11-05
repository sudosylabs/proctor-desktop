//! Bounded, exact-execution signing verification behind the ES callback.
//!
//! Bootstrap tokens are reconciled before work is scheduled. Only the execution
//! current at the subscription watermark enters the initial verification queue;
//! earlier bootstrap executions are outside the source's live observation cut.
//! Live executions are never deduplicated or silently allowed while checking.

#![allow(unsafe_code)]

use std::collections::BTreeMap;
use std::sync::{Arc, Mutex, mpsc};
use std::time::{Duration, Instant};

use native_protocol::{ProcessExecutableIdentity, ProcessExecutableIdentityStatus};
use native_source_runtime::{
    DeadlineThread, ensure_native_source_process_usable, poison_native_source_process,
    run_bounded_task,
};

use super::macos_audit_token::OwnedAuditToken;
use super::macos_lifecycle::{
    MacOsIdentityResolution, MacOsLifecycleFailure, MacOsLifecycleInput, MacOsLifecycleSink,
    MacOsProcessKey,
};

const MAX_BOOTSTRAP_KEYS: usize = 4_096;
// Matches the lifecycle core's MAX_CURRENT_PROCESSES. Historical/tombstoned
// bootstrap keys have a separate, larger bound; only live entries become jobs.
const MAX_IDENTITY_JOBS: usize = 256;
const IDENTITY_BUDGET: Duration = Duration::from_secs(2);
const CLOSE_BUDGET: Duration = Duration::from_secs(3);

#[repr(C)]
struct RawIdentity {
    signing_id: [u8; 257],
    team_id: [u8; 65],
    designated_requirement: [u8; 513],
    bundle_id: [u8; 257],
    version: [u8; 65],
}
impl RawIdentity {
    const fn empty() -> Self {
        Self {
            signing_id: [0; 257],
            team_id: [0; 65],
            designated_requirement: [0; 513],
            bundle_id: [0; 257],
            version: [0; 65],
        }
    }
    fn identity(&self) -> Option<ProcessExecutableIdentity> {
        Some(ProcessExecutableIdentity {
            status: ProcessExecutableIdentityStatus::Verified,
            signing_id: Some(field(&self.signing_id)?),
            team_id: Some(field(&self.team_id)?),
            designated_requirement: Some(field(&self.designated_requirement)?),
            bundle_id: Some(field(&self.bundle_id)?),
            version: Some(field(&self.version)?),
            ..unavailable_identity()
        })
    }
}
impl Drop for RawIdentity {
    fn drop(&mut self) {
        // SAFETY: this fixed byte-only structure is exclusively owned here.
        unsafe { std::ptr::write_volatile(self, Self::empty()) };
    }
}

unsafe extern "C" {
    fn macos_copy_identity(
        token: *const u32,
        process_id: i32,
        generation: u32,
        out: *mut RawIdentity,
    ) -> i32;
}

fn field(buffer: &[u8]) -> Option<String> {
    let end = buffer.iter().position(|byte| *byte == 0)?;
    if end == 0 || buffer[end..].iter().any(|byte| *byte != 0) {
        return None;
    }
    let value = std::str::from_utf8(&buffer[..end]).ok()?;
    if value.chars().any(char::is_control) {
        return None;
    }
    Some(value.to_owned())
}

fn verify(job: IdentityJob) -> ProcessExecutableIdentity {
    let Some(token) = job.token else {
        return unavailable_identity();
    };
    let mut raw = RawIdentity::empty();
    // SAFETY: the exact kernel token and fixed output stay alive for the entire
    // synchronous SDK call. No CF or SecCode reference escapes the C routine.
    let status = unsafe {
        macos_copy_identity(
            token.as_words().as_ptr(),
            job.key.process_id(),
            job.generation,
            &raw mut raw,
        )
    };
    if status != 0 {
        return unavailable_identity();
    }
    raw.identity().unwrap_or_else(unavailable_identity)
}

pub(super) const fn unavailable_identity() -> ProcessExecutableIdentity {
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

struct IdentityJob {
    key: MacOsProcessKey,
    generation: u32,
    token: Option<OwnedAuditToken>,
    deadline: Instant,
}
struct BootstrapToken {
    generation: u32,
    token: Option<OwnedAuditToken>,
    retired: bool,
}
struct Registration {
    sender: mpsc::SyncSender<IdentityJob>,
    tokens: BTreeMap<MacOsProcessKey, BootstrapToken>,
    live: bool,
}

#[derive(Clone)]
pub(super) struct IdentityIngress {
    registration: Arc<Mutex<Option<Registration>>>,
}

impl IdentityIngress {
    /// Called outside callbacks for bounded, authenticated inventory records.
    pub(super) fn inventory(
        &self,
        key: MacOsProcessKey,
        generation: u32,
        token: Option<OwnedAuditToken>,
    ) -> Result<(), MacOsLifecycleFailure> {
        let mut guard = self
            .registration
            .lock()
            .map_err(|_| MacOsLifecycleFailure::Protocol)?;
        let state = guard.as_mut().ok_or(MacOsLifecycleFailure::Backend)?;
        if state.live {
            return Err(MacOsLifecycleFailure::Protocol);
        }
        remember(&mut state.tokens, key, generation, token, false)
    }

    /// Callback work is only a bounded token copy/map update or nonblocking send.
    pub(super) fn observe(
        &self,
        key: MacOsProcessKey,
        generation: u32,
        token: Option<OwnedAuditToken>,
        exited: bool,
    ) -> Result<(), MacOsLifecycleFailure> {
        let mut guard = self
            .registration
            .try_lock()
            .map_err(|_| MacOsLifecycleFailure::Backend)?;
        let state = guard.as_mut().ok_or(MacOsLifecycleFailure::Backend)?;
        if state.live {
            return if exited {
                Ok(())
            } else {
                send_job(&state.sender, key, generation, token)
            };
        }
        remember(&mut state.tokens, key, generation, token, exited)
    }

    pub(super) fn activate(&self) -> Result<(), MacOsLifecycleFailure> {
        let mut guard = self
            .registration
            .try_lock()
            .map_err(|_| MacOsLifecycleFailure::Backend)?;
        let state = guard.as_mut().ok_or(MacOsLifecycleFailure::Backend)?;
        if state.live {
            return Err(MacOsLifecycleFailure::Protocol);
        }
        state.live = true;
        let tokens = std::mem::take(&mut state.tokens);
        if tokens.values().filter(|entry| !entry.retired).count() > MAX_IDENTITY_JOBS {
            return Err(MacOsLifecycleFailure::InventoryOverflow);
        }
        for (key, entry) in tokens {
            if !entry.retired {
                send_job(&state.sender, key, entry.generation, entry.token)?;
            }
        }
        Ok(())
    }

    pub(super) fn close(&self) {
        // Even a poisoned registration must surrender tokens and the sender;
        // no callback is admitted after the native subscription has closed.
        match self.registration.lock() {
            Ok(mut guard) => {
                guard.take();
            }
            Err(error) => {
                error.into_inner().take();
            }
        }
    }
}

fn remember(
    tokens: &mut BTreeMap<MacOsProcessKey, BootstrapToken>,
    key: MacOsProcessKey,
    generation: u32,
    token: Option<OwnedAuditToken>,
    retired: bool,
) -> Result<(), MacOsLifecycleFailure> {
    if let Some(existing) = tokens.get_mut(&key) {
        if existing.retired || generation < existing.generation {
            return Ok(());
        }
        // An exact inventory token is not replaced by absence of a token.
        if generation == existing.generation && token.is_none() && !retired {
            return Ok(());
        }
        *existing = BootstrapToken {
            generation,
            token,
            retired,
        };
    } else {
        if tokens.len() >= MAX_BOOTSTRAP_KEYS {
            return Err(MacOsLifecycleFailure::InventoryOverflow);
        }
        tokens.insert(
            key,
            BootstrapToken {
                generation,
                token,
                retired,
            },
        );
    }
    Ok(())
}

fn send_job(
    sender: &mpsc::SyncSender<IdentityJob>,
    key: MacOsProcessKey,
    generation: u32,
    token: Option<OwnedAuditToken>,
) -> Result<(), MacOsLifecycleFailure> {
    sender
        .try_send(IdentityJob {
            key,
            generation,
            token,
            deadline: Instant::now() + IDENTITY_BUDGET,
        })
        .map_err(|_| MacOsLifecycleFailure::Backend)
}

fn resolve_before_deadline<F>(
    job: IdentityJob,
    verifier: F,
) -> Result<ProcessExecutableIdentity, native_source_runtime::BoundedTaskError>
where
    F: FnOnce(IdentityJob) -> ProcessExecutableIdentity + Send + 'static,
{
    let deadline = job.deadline;
    let remaining = deadline.saturating_duration_since(Instant::now());
    if remaining.is_zero() {
        return Ok(unavailable_identity());
    }
    let identity = run_bounded_task("macos-signing-sdk", remaining, move || verifier(job))?;
    Ok(if Instant::now() >= deadline {
        unavailable_identity()
    } else {
        identity
    })
}

pub(super) struct IdentityWorker {
    thread: DeadlineThread,
    ingress: IdentityIngress,
}
impl IdentityWorker {
    pub(super) fn start(sink: MacOsLifecycleSink) -> Result<Self, MacOsLifecycleFailure> {
        Self::start_with_verifier(sink, verify)
    }

    fn start_with_verifier<F>(
        sink: MacOsLifecycleSink,
        verifier: F,
    ) -> Result<Self, MacOsLifecycleFailure>
    where
        F: Fn(IdentityJob) -> ProcessExecutableIdentity + Send + Sync + 'static,
    {
        let verifier = Arc::new(verifier);
        let (sender, receiver) = mpsc::sync_channel(MAX_IDENTITY_JOBS);
        let ingress = IdentityIngress {
            registration: Arc::new(Mutex::new(Some(Registration {
                sender,
                tokens: BTreeMap::new(),
                live: false,
            }))),
        };
        let thread = DeadlineThread::spawn("macos-signing-owner", move || {
            for job in receiver {
                let key = job.key;
                let generation = job.generation;
                let verifier = Arc::clone(&verifier);
                let Ok(identity) = resolve_before_deadline(job, move |job| verifier(job)) else {
                    // A signature SDK task may still own native code or token
                    // memory. The helper supervisor must replace this process.
                    poison_native_source_process();
                    sink.submit(MacOsLifecycleInput::BackendInvalidated);
                    return;
                };
                if let Ok(resolution) = MacOsIdentityResolution::new(key, generation, identity) {
                    sink.submit(MacOsLifecycleInput::IdentityResolved(Box::new(resolution)));
                } else {
                    sink.submit(MacOsLifecycleInput::BackendInvalidated);
                    return;
                }
            }
        })
        .map_err(|_| MacOsLifecycleFailure::Backend)?;
        Ok(Self { thread, ingress })
    }
    pub(super) fn ingress(&self) -> IdentityIngress {
        self.ingress.clone()
    }
    pub(super) fn close(&mut self) -> Result<(), MacOsLifecycleFailure> {
        self.ingress.close();
        self.thread.finish(CLOSE_BUDGET).map_err(|_| {
            poison_native_source_process();
            MacOsLifecycleFailure::Cleanup
        })?;
        // Joining the owner does not prove that a timed-out SDK worker exited.
        // Attempt cleanup first, then retain the terminal process fence even on
        // repeated close or a verifier that eventually returns after its deadline.
        ensure_native_source_process_usable().map_err(|_| MacOsLifecycleFailure::Cleanup)
    }
}
impl Drop for IdentityWorker {
    fn drop(&mut self) {
        let _closed = self.close();
    }
}

#[cfg(test)]
mod tests {
    use super::super::macos_lifecycle::{
        MacOsCandidateAuditSession, MacOsLifecycleCheckpoint, MacOsLifecycleEventFeed,
        MacOsLifecycleSubscription, MacOsProcessAccountClass, MacOsProcessFact,
        MacOsProcessInventory, MacOsProcessInventoryCollector, MacOsProcessLifecycle,
    };
    use super::*;
    use native_protocol::ProtocolValidatable;

    #[test]
    fn fields_reject_empty_invalid_utf8_embedded_nul_and_control_characters() {
        for input in [
            &[0_u8][..],
            &[0xff, 0],
            b"a\0b\0",
            b"a\n\0",
            b"unterminated",
        ] {
            assert!(field(input).is_none());
        }
        assert_eq!(field(b"signed\0\0").as_deref(), Some("signed"));
    }

    #[test]
    fn sealed_identity_requires_every_admitted_field() {
        let mut raw = RawIdentity::empty();
        raw.signing_id[..2].copy_from_slice(b"s\0");
        raw.team_id[..2].copy_from_slice(b"t\0");
        raw.designated_requirement[..2].copy_from_slice(b"r\0");
        raw.bundle_id[..2].copy_from_slice(b"b\0");
        assert!(raw.identity().is_none());
        raw.version[..2].copy_from_slice(b"1\0");
        let identity = raw.identity().expect("complete fields");
        identity
            .validate_protocol()
            .expect("bounded protocol identity");
        assert_eq!(identity.status, ProcessExecutableIdentityStatus::Verified);
    }

    #[test]
    fn bootstrap_tokens_keep_newer_generations_and_exit_tombstones() {
        let key = MacOsProcessKey::new(12, 123, 0).expect("key");
        let mut tokens = BTreeMap::new();
        remember(&mut tokens, key, 3, None, false).expect("inventory");
        remember(&mut tokens, key, 2, None, false).expect("older callback");
        assert_eq!(tokens[&key].generation, 3);
        remember(&mut tokens, key, 3, None, true).expect("exit");
        remember(&mut tokens, key, 4, None, false).expect("late inventory");
        assert!(tokens[&key].retired);
        assert_eq!(tokens[&key].generation, 3);
    }

    fn ingress(capacity: usize) -> (IdentityIngress, mpsc::Receiver<IdentityJob>) {
        let (sender, receiver) = mpsc::sync_channel(capacity);
        (
            IdentityIngress {
                registration: Arc::new(Mutex::new(Some(Registration {
                    sender,
                    tokens: BTreeMap::new(),
                    live: false,
                }))),
            },
            receiver,
        )
    }

    #[test]
    fn bootstrap_schedules_only_current_generations_and_preserves_live_jobs() {
        let (ingress, receiver) = ingress(4);
        let current = MacOsProcessKey::new(15, 100, 0).expect("key");
        let retired = MacOsProcessKey::new(16, 100, 0).expect("key");
        ingress.inventory(current, 3, None).expect("inventory");
        ingress.observe(current, 1, None, false).expect("old fork");
        ingress.observe(current, 2, None, false).expect("old exec");
        ingress.observe(retired, 2, None, true).expect("exit");
        ingress.inventory(retired, 2, None).expect("late inventory");
        assert!(receiver.try_recv().is_err());
        ingress.activate().expect("watermark");
        let job = receiver.try_recv().expect("current identity");
        assert!(job.key == current);
        assert_eq!(job.generation, 3);
        assert!(receiver.try_recv().is_err());
        ingress.observe(current, 4, None, false).expect("live exec");
        assert_eq!(receiver.try_recv().expect("live identity").generation, 4);
        assert!(ingress.activate().is_err());
        assert!(ingress.inventory(current, 4, None).is_err());
        ingress.close();
        assert!(ingress.observe(current, 5, None, false).is_err());
        assert!(matches!(
            receiver.try_recv(),
            Err(mpsc::TryRecvError::Disconnected)
        ));
    }

    #[test]
    fn activation_refuses_oversized_current_inventory_without_truncating() {
        let (ingress, receiver) = ingress(MAX_IDENTITY_JOBS);
        for pid in 1..=257 {
            ingress
                .inventory(MacOsProcessKey::new(pid, 100, 0).expect("key"), 1, None)
                .expect("bounded raw inventory");
        }
        assert!(matches!(
            ingress.activate(),
            Err(MacOsLifecycleFailure::InventoryOverflow)
        ));
        assert!(receiver.try_recv().is_err());
    }

    #[test]
    fn callback_intake_never_waits_for_registry_or_queue_capacity() {
        let (ingress, receiver) = ingress(1);
        let key = MacOsProcessKey::new(15, 100, 0).expect("key");
        {
            let _held = ingress.registration.lock().expect("lock");
            assert!(ingress.observe(key, 1, None, false).is_err());
        }
        ingress.activate().expect("empty bootstrap");
        ingress.observe(key, 1, None, false).expect("first job");
        assert!(ingress.observe(key, 2, None, false).is_err());
        assert_eq!(receiver.try_recv().expect("accepted tail").generation, 1);
    }

    #[test]
    fn native_verifier_rejects_token_binding_before_identity_metadata() {
        let key = MacOsProcessKey::new(15, 100, 0).expect("key");
        let identity = verify(IdentityJob {
            key,
            generation: 1,
            token: Some(OwnedAuditToken::copy_from_kernel(&[0; 8])),
            deadline: Instant::now() + IDENTITY_BUDGET,
        });
        assert_eq!(
            identity.status,
            ProcessExecutableIdentityStatus::Unavailable
        );
        assert!(identity.signing_id.is_none());
    }

    #[test]
    fn queued_job_deadline_is_not_extended_when_the_worker_reaches_it() {
        let key = MacOsProcessKey::new(15, 100, 0).expect("key");
        let identity = resolve_before_deadline(
            IdentityJob {
                key,
                generation: 1,
                token: None,
                deadline: Instant::now(),
            },
            |_| panic!("expired work must never call Security.framework"),
        )
        .expect("explicit unavailable identity");
        assert_eq!(
            identity.status,
            ProcessExecutableIdentityStatus::Unavailable
        );
    }

    #[test]
    fn stalled_sdk_task_returns_timeout_to_the_process_poisoning_owner() {
        let (release, wait) = mpsc::sync_channel(1);
        let (finished, completion) = mpsc::sync_channel(1);
        let key = MacOsProcessKey::new(15, 100, 0).expect("key");
        let result = resolve_before_deadline(
            IdentityJob {
                key,
                generation: 1,
                token: None,
                deadline: Instant::now() + Duration::from_millis(30),
            },
            move |_| {
                wait.recv().expect("test releases worker after timeout");
                let _sent = finished.send(());
                unavailable_identity()
            },
        );
        assert!(matches!(
            result,
            Err(native_source_runtime::BoundedTaskError::TimedOut)
        ));
        release.send(()).expect("release test SDK task");
        completion
            .recv_timeout(Duration::from_secs(1))
            .expect("test task finishes");
    }

    struct WorkerFeed(Arc<Mutex<Option<IdentityIngress>>>);
    struct WorkerSubscription {
        worker: IdentityWorker,
        sink: MacOsLifecycleSink,
    }
    impl MacOsLifecycleEventFeed for WorkerFeed {
        type Subscription = WorkerSubscription;
        fn start(
            self,
            sink: MacOsLifecycleSink,
        ) -> Result<Self::Subscription, MacOsLifecycleFailure> {
            let worker = IdentityWorker::start(sink.clone())?;
            *self.0.lock().expect("test registration") = Some(worker.ingress());
            Ok(WorkerSubscription { worker, sink })
        }
    }
    impl MacOsLifecycleSubscription for WorkerSubscription {
        fn bootstrap_barrier(&mut self) -> Result<MacOsLifecycleCheckpoint, MacOsLifecycleFailure> {
            // This fixture takes the cut before starting jobs so every result
            // deterministically exercises the live, post-snapshot path.
            let checkpoint = self.sink.checkpoint()?;
            self.worker.ingress().activate()?;
            Ok(checkpoint)
        }
        fn stop(mut self) -> Result<(), MacOsLifecycleFailure> {
            self.worker.close()
        }
    }
    struct WorkerInventory(Arc<Mutex<Option<IdentityIngress>>>);
    impl MacOsProcessInventory for WorkerInventory {
        fn snapshot(
            &mut self,
            collector: &mut MacOsProcessInventoryCollector,
        ) -> Result<(), MacOsLifecycleFailure> {
            let guard = self.0.lock().expect("test registration");
            let ingress = guard.as_ref().expect("worker subscribed first");
            for pid in [41, 42] {
                let key = MacOsProcessKey::new(pid, 100, 0).expect("key");
                collector.push(MacOsProcessFact::new(
                    key,
                    1,
                    42,
                    501,
                    MacOsProcessAccountClass::Human,
                ))?;
                ingress.inventory(key, 1, None)?;
            }
            Ok(())
        }
    }

    struct StalledWorkerFeed {
        registration: Arc<Mutex<Option<IdentityIngress>>>,
        started: mpsc::SyncSender<()>,
        release: mpsc::Receiver<()>,
        finished: mpsc::SyncSender<()>,
    }
    impl MacOsLifecycleEventFeed for StalledWorkerFeed {
        type Subscription = WorkerSubscription;

        fn start(
            self,
            sink: MacOsLifecycleSink,
        ) -> Result<Self::Subscription, MacOsLifecycleFailure> {
            let release = Mutex::new(self.release);
            let worker = IdentityWorker::start_with_verifier(sink.clone(), move |_| {
                self.started.send(()).expect("test verifier entered");
                release
                    .lock()
                    .expect("test release receiver")
                    .recv()
                    .expect("test releases verifier after failed close");
                self.finished.send(()).expect("test verifier returned");
                unavailable_identity()
            })?;
            *self.registration.lock().expect("test registration") = Some(worker.ingress());
            Ok(WorkerSubscription { worker, sink })
        }
    }

    #[test]
    fn timed_out_sdk_cannot_be_acknowledged_as_clean_source_close() {
        const CHILD_ENV: &str = "MACOS_IDENTITY_CLOSE_POISON_CHILD";
        const TEST_NAME: &str = concat!(
            "platform::macos_executable_identity::tests::",
            "timed_out_sdk_cannot_be_acknowledged_as_clean_source_close"
        );
        if std::env::var_os(CHILD_ENV).is_none() {
            let status = std::process::Command::new(
                std::env::current_exe().expect("current test executable"),
            )
            .args(["--exact", TEST_NAME, "--nocapture"])
            .env(CHILD_ENV, "1")
            .status()
            .expect("isolated poison test starts");
            assert!(status.success(), "isolated poison test failed");
            return;
        }

        let registration = Arc::new(Mutex::new(None));
        let (started, entered) = mpsc::sync_channel(1);
        let (release, wait) = mpsc::sync_channel(1);
        let (finished, completion) = mpsc::sync_channel(1);
        let candidate = MacOsCandidateAuditSession::from_verified_peer(42, 501).expect("candidate");
        let (_, mut source) = MacOsProcessLifecycle::open(
            candidate,
            8,
            StalledWorkerFeed {
                registration: Arc::clone(&registration),
                started,
                release: wait,
                finished,
            },
            WorkerInventory(registration),
        )
        .expect("source opens with pending verification");
        entered
            .recv_timeout(Duration::from_secs(1))
            .expect("SDK verifier is running");
        assert!(matches!(
            source.close(),
            Err(MacOsLifecycleFailure::Cleanup)
        ));
        assert!(ensure_native_source_process_usable().is_err());
        assert_eq!(completion.try_recv(), Err(mpsc::TryRecvError::Empty));
        release.send(()).expect("release timed-out test verifier");
        completion
            .recv_timeout(Duration::from_secs(1))
            .expect("late verifier result");
        assert!(ensure_native_source_process_usable().is_err());
    }

    #[test]
    fn close_joins_worker_and_delivers_all_accepted_identity_completions() {
        let registration = Arc::new(Mutex::new(None));
        let candidate = MacOsCandidateAuditSession::from_verified_peer(42, 501).expect("candidate");
        let (initial, mut source) = MacOsProcessLifecycle::open(
            candidate,
            8,
            WorkerFeed(registration.clone()),
            WorkerInventory(registration),
        )
        .expect("subscribed worker");
        assert_eq!(initial.processes.len(), 2);
        assert!(
            initial
                .processes
                .iter()
                .all(|process| process.identity.status == ProcessExecutableIdentityStatus::Pending)
        );
        let closed = source.close().expect("worker joined");
        assert_eq!(closed.drain.events.len(), 2);
        assert!(closed.drain.terminal.is_none());
        assert!(
            closed
                .final_state
                .processes
                .iter()
                .all(|process| process.identity.status
                    == ProcessExecutableIdentityStatus::Unavailable)
        );
    }
    struct GatedFeed {
        registration: Arc<Mutex<Option<IdentityIngress>>>,
        callback: Arc<Mutex<Option<MacOsLifecycleSink>>>,
        started: mpsc::SyncSender<()>,
        release: Mutex<mpsc::Receiver<()>>,
    }
    impl MacOsLifecycleEventFeed for GatedFeed {
        type Subscription = WorkerSubscription;
        fn start(
            self,
            sink: MacOsLifecycleSink,
        ) -> Result<Self::Subscription, MacOsLifecycleFailure> {
            let worker = IdentityWorker::start_with_verifier(sink.clone(), move |_| {
                self.started.send(()).expect("test observes SDK entry");
                self.release
                    .lock()
                    .expect("test gate")
                    .recv()
                    .expect("test releases SDK");
                ProcessExecutableIdentity {
                    status: ProcessExecutableIdentityStatus::Verified,
                    signing_id: Some("signed".to_owned()),
                    team_id: Some("team".to_owned()),
                    designated_requirement: Some("requirement".to_owned()),
                    bundle_id: Some("bundle".to_owned()),
                    version: Some("1".to_owned()),
                    ..unavailable_identity()
                }
            })?;
            *self.registration.lock().expect("registration") = Some(worker.ingress());
            *self.callback.lock().expect("callback") = Some(sink.clone());
            Ok(WorkerSubscription { worker, sink })
        }
    }
    struct GatedInventory(Arc<Mutex<Option<IdentityIngress>>>);
    impl MacOsProcessInventory for GatedInventory {
        fn snapshot(
            &mut self,
            collector: &mut MacOsProcessInventoryCollector,
        ) -> Result<(), MacOsLifecycleFailure> {
            let key = MacOsProcessKey::new(51, 100, 0).expect("key");
            collector.push(MacOsProcessFact::new(
                key,
                1,
                42,
                501,
                MacOsProcessAccountClass::Human,
            ))?;
            self.0
                .lock()
                .expect("registration")
                .as_ref()
                .expect("worker")
                .inventory(key, 1, None)
        }
    }
    struct ReleaseGate(Option<mpsc::SyncSender<()>>);
    impl Drop for ReleaseGate {
        fn drop(&mut self) {
            if let Some(release) = self.0.take() {
                let _sent = release.send(());
            }
        }
    }

    #[test]
    fn actual_owned_worker_settles_a_native_exit_received_during_sdk_verification() {
        let registration = Arc::new(Mutex::new(None));
        let callback = Arc::new(Mutex::new(None));
        let (started, entered) = mpsc::sync_channel(1);
        let (release, wait) = mpsc::sync_channel(1);
        let candidate = MacOsCandidateAuditSession::from_verified_peer(42, 501).expect("candidate");
        let (_, mut source) = MacOsProcessLifecycle::open(
            candidate,
            8,
            GatedFeed {
                registration: registration.clone(),
                callback: callback.clone(),
                started,
                release: Mutex::new(wait),
            },
            GatedInventory(registration),
        )
        .expect("worker source");
        let release_guard = ReleaseGate(Some(release));
        entered
            .recv_timeout(Duration::from_secs(1))
            .expect("SDK lookup is blocked");
        let sink = callback
            .lock()
            .expect("callback")
            .take()
            .expect("registered");
        sink.submit(MacOsLifecycleInput::Exit(MacOsProcessFact::new(
            MacOsProcessKey::new(51, 100, 0).expect("key"),
            1,
            42,
            501,
            MacOsProcessAccountClass::Human,
        )));
        let waiting = source.drain();
        assert!(waiting.terminal.is_none());
        assert_eq!(
            waiting.events[0]
                .event
                .state
                .as_ref()
                .expect("partial")
                .certainty,
            native_protocol::ProcessApplicationCertainty::Partial
        );
        drop(sink);
        drop(release_guard);
        let closed = source.close().expect("worker settles and joins");
        assert!(closed.drain.terminal.is_none());
        assert_eq!(
            closed
                .drain
                .events
                .iter()
                .map(|event| event.event.kind)
                .collect::<Vec<_>>(),
            vec![
                native_protocol::ProcessApplicationEventKind::IdentityChanged,
                native_protocol::ProcessApplicationEventKind::Exited,
                native_protocol::ProcessApplicationEventKind::Reconciled,
            ]
        );
        assert!(closed.final_state.processes.is_empty());
        assert_eq!(
            closed.final_state.certainty,
            native_protocol::ProcessApplicationCertainty::Complete
        );
    }
}
