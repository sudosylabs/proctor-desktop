//! Platform-free mechanics of the Windows ETW process feed. SDK ownership stays
//! in `windows_etw`; bounded ingress, decoding and startup settlement are shared
//! with host-runnable regression tests.
#![cfg_attr(not(target_os = "windows"), allow(dead_code))]
use std::fmt;
use std::sync::atomic::{AtomicBool, AtomicU8, AtomicU32, Ordering};
use std::sync::{Mutex, mpsc};
use std::time::Instant;

pub(super) const BACKEND_FAILURE: u8 = 1;
const NATIVE_LOSS: u8 = 2;
const QUEUE_LOSS: u8 = 3;
pub(super) const SCHEMA_FAILURE: u8 = 4;

/// PID plus kernel creation FILETIME, retained only inside the native source.
#[derive(Clone, Copy, Eq, Ord, PartialEq, PartialOrd)]
pub struct WindowsProcessLifetime {
    pub process_id: u32,
    pub creation_file_time: u64,
}

/// Content-free native event. ETW stop events have no `SessionID`; their exact
/// lifetime must be joined against the source's verified inventory/start facts.
pub struct WindowsEtwProcessEvent {
    pub lifetime: WindowsProcessLifetime,
    pub session_id: Option<u32>,
    pub started: bool,
    pub qpc_timestamp: i64,
}

/// Explicit loss counts retain their unit: lost buffers are not fabricated
/// into an exact number of missing process events.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum WindowsEtwFailure {
    Permission,
    Backend,
    UnsupportedSchema,
    QueueOverflow,
    NativeLoss { events: u32, buffers: u32 },
    Cleanup,
}

impl fmt::Display for WindowsEtwFailure {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(match self {
            Self::Permission => "Windows process event permission is unavailable",
            Self::Backend => "Windows process event backend failed",
            Self::UnsupportedSchema => "Windows process event schema is unsupported",
            Self::QueueOverflow => "Windows process event queue overflowed",
            Self::NativeLoss { .. } => "Windows process events were lost",
            Self::Cleanup => "Windows process event cleanup was not proved",
        })
    }
}
impl std::error::Error for WindowsEtwFailure {}

pub struct WindowsEtwDrain {
    pub events: Vec<WindowsEtwProcessEvent>,
    pub failure: Option<WindowsEtwFailure>,
}

pub(super) struct Ingress {
    sender: mpsc::SyncSender<WindowsEtwProcessEvent>,
    commit_gate: Mutex<()>,
    pub(super) accepting: AtomicBool,
    terminal: AtomicU8,
    lost_events: AtomicU32,
    lost_buffers: AtomicU32,
}

impl Ingress {
    pub(super) fn new(sender: mpsc::SyncSender<WindowsEtwProcessEvent>) -> Self {
        Self {
            sender,
            commit_gate: Mutex::new(()),
            accepting: AtomicBool::new(true),
            terminal: AtomicU8::new(0),
            lost_events: AtomicU32::new(0),
            lost_buffers: AtomicU32::new(0),
        }
    }
    pub(super) fn submit(&self, event: WindowsEtwProcessEvent) {
        let Ok(_gate) = self.commit_gate.try_lock() else {
            self.fail(QUEUE_LOSS);
            return;
        };
        if !self.accepting.load(Ordering::Acquire) {
            return;
        }
        match self.sender.try_send(event) {
            Ok(()) => {}
            Err(mpsc::TrySendError::Full(_)) => self.fail(QUEUE_LOSS),
            Err(mpsc::TrySendError::Disconnected(_)) => self.fail(BACKEND_FAILURE),
        }
    }

    pub(super) fn drain(
        &self,
        receiver: &mpsc::Receiver<WindowsEtwProcessEvent>,
        capacity: usize,
    ) -> WindowsEtwDrain {
        // Control-thread boundary: wait for an already admitted callback commit,
        // then collect its tail and terminal state together. Callbacks only try
        // this gate; they never wait for a drain or another producer.
        let _gate = match self.commit_gate.lock() {
            Ok(gate) => gate,
            Err(poisoned) => {
                self.fail(BACKEND_FAILURE);
                poisoned.into_inner()
            }
        };
        WindowsEtwDrain {
            events: receiver.try_iter().take(capacity).collect(),
            failure: self.failure(),
        }
    }
    pub(super) fn fail(&self, kind: u8) {
        self.accepting.store(false, Ordering::Release);
        let _first = self
            .terminal
            .compare_exchange(0, kind, Ordering::AcqRel, Ordering::Acquire);
    }
    pub(super) fn loss(&self, events: u32, buffers: u32) {
        if events == 0 && buffers == 0 {
            return;
        }
        self.lost_events.fetch_max(events, Ordering::AcqRel);
        self.lost_buffers.fetch_max(buffers, Ordering::AcqRel);
        self.fail(NATIVE_LOSS);
    }
    pub(super) fn failure(&self) -> Option<WindowsEtwFailure> {
        match self.terminal.load(Ordering::Acquire) {
            0 => None,
            NATIVE_LOSS => Some(WindowsEtwFailure::NativeLoss {
                events: self.lost_events.load(Ordering::Acquire),
                buffers: self.lost_buffers.load(Ordering::Acquire),
            }),
            QUEUE_LOSS => Some(WindowsEtwFailure::QueueOverflow),
            SCHEMA_FAILURE => Some(WindowsEtwFailure::UnsupportedSchema),
            _ => Some(WindowsEtwFailure::Backend),
        }
    }
}

pub(super) fn validate_open_boundary(
    deadline: Instant,
    usable: impl FnOnce() -> Result<(), WindowsEtwFailure>,
) -> Result<(), WindowsEtwFailure> {
    usable()?;
    if Instant::now() >= deadline {
        return Err(WindowsEtwFailure::Backend);
    }
    Ok(())
}

/// Readiness is notification only: it never transfers native handle ownership.
/// Even a successful late send to an unobserved channel cannot leak a consumer.
pub(super) fn handoff_and_consume(
    ready: &mpsc::SyncSender<Result<(), WindowsEtwFailure>>,
    accepting: &AtomicBool,
    process: impl FnOnce() -> Result<(), WindowsEtwFailure>,
    close: impl FnOnce() -> Result<(), WindowsEtwFailure>,
) -> Result<(), WindowsEtwFailure> {
    let result = if accepting.load(Ordering::Acquire) && ready.try_send(Ok(())).is_ok() {
        process()
    } else {
        Ok(())
    };
    close()?;
    result
}

/// Keeps a source's operational result separate from proved resource cleanup.
/// A successfully joined consumer can fail as a source without leaking a handle.
pub(super) fn settle_cleanup(
    controller_failed: bool,
    worker_outcome: Result<(), WindowsEtwFailure>,
    poison: impl FnOnce(),
) -> Result<Option<WindowsEtwFailure>, WindowsEtwFailure> {
    if controller_failed || matches!(worker_outcome, Err(WindowsEtwFailure::Cleanup)) {
        poison();
        return Err(WindowsEtwFailure::Cleanup);
    }
    Ok(worker_outcome.err())
}

pub(super) fn decode_prefix(
    id: u16,
    version: u8,
    timestamp: i64,
    prefix: &[u8],
) -> Result<WindowsEtwProcessEvent, WindowsEtwFailure> {
    let required = match id {
        1 => 20,
        2 => 12,
        _ => return Err(WindowsEtwFailure::UnsupportedSchema),
    };
    if version > 1 || prefix.len() != required || timestamp < 0 {
        return Err(WindowsEtwFailure::UnsupportedSchema);
    }
    let process_id = u32::from_le_bytes(
        prefix[0..4]
            .try_into()
            .map_err(|_| WindowsEtwFailure::UnsupportedSchema)?,
    );
    let creation_file_time = u64::from_le_bytes(
        prefix[4..12]
            .try_into()
            .map_err(|_| WindowsEtwFailure::UnsupportedSchema)?,
    );
    if process_id == 0 || creation_file_time == 0 {
        return Err(WindowsEtwFailure::UnsupportedSchema);
    }
    let session_id = if id == 1 {
        Some(u32::from_le_bytes(
            prefix[16..20]
                .try_into()
                .map_err(|_| WindowsEtwFailure::UnsupportedSchema)?,
        ))
    } else {
        None
    };
    Ok(WindowsEtwProcessEvent {
        lifetime: WindowsProcessLifetime {
            process_id,
            creation_file_time,
        },
        session_id,
        started: id == 1,
        qpc_timestamp: timestamp,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::AtomicUsize;
    use std::sync::{Arc, Barrier};
    use std::time::Duration;

    fn event(process_id: u32) -> WindowsEtwProcessEvent {
        WindowsEtwProcessEvent {
            lifetime: WindowsProcessLifetime {
                process_id,
                creation_file_time: 100,
            },
            session_id: Some(1),
            started: true,
            qpc_timestamp: 200,
        }
    }

    #[test]
    fn joined_backend_failure_preserves_source_failure_without_poisoning_cleanup() {
        let poisoned = AtomicBool::new(false);
        assert_eq!(
            settle_cleanup(false, Err(WindowsEtwFailure::Backend), || poisoned
                .store(true, Ordering::Release)),
            Ok(Some(WindowsEtwFailure::Backend))
        );
        assert!(!poisoned.load(Ordering::Acquire));
        assert_eq!(
            settle_cleanup(false, Ok(()), || poisoned.store(true, Ordering::Release)),
            Ok(None)
        );
        assert!(!poisoned.load(Ordering::Acquire));
    }

    #[test]
    fn consumer_or_controller_cleanup_failure_poison_before_acknowledgement() {
        for (controller_failed, worker_outcome) in [
            (false, Err(WindowsEtwFailure::Cleanup)),
            (true, Ok(())),
            (true, Err(WindowsEtwFailure::Backend)),
        ] {
            let poisoned = AtomicBool::new(false);
            assert_eq!(
                settle_cleanup(controller_failed, worker_outcome, || poisoned
                    .store(true, Ordering::Release)),
                Err(WindowsEtwFailure::Cleanup)
            );
            assert!(poisoned.load(Ordering::Acquire));
        }
    }

    #[test]
    fn final_open_boundary_rechecks_deadline_and_process_reuse_fence() {
        assert_eq!(
            validate_open_boundary(Instant::now(), || Ok(())),
            Err(WindowsEtwFailure::Backend)
        );
        assert_eq!(
            validate_open_boundary(Instant::now() + Duration::from_secs(1), || Err(
                WindowsEtwFailure::Cleanup
            )),
            Err(WindowsEtwFailure::Cleanup)
        );
        assert_eq!(
            validate_open_boundary(Instant::now() + Duration::from_secs(1), || Ok(())),
            Ok(())
        );
    }

    #[test]
    fn late_ready_notification_never_transfers_consumer_ownership() {
        let (ready, receive) = mpsc::sync_channel(1);
        assert!(receive.recv_timeout(Duration::ZERO).is_err());
        let closed = AtomicUsize::new(0);
        let accepting = AtomicBool::new(false); // timeout fenced before late open returns
        handoff_and_consume(
            &ready,
            &accepting,
            || panic!("fenced worker must not enter ProcessTrace"),
            || {
                closed.fetch_add(1, Ordering::AcqRel);
                Ok(())
            },
        )
        .expect("worker closes late consumer");
        assert_eq!(closed.load(Ordering::Acquire), 1);

        // Even if the notification wins the race into an unread live channel,
        // it carries no handle and the worker still owns/finalizes the consumer.
        accepting.store(true, Ordering::Release);
        handoff_and_consume(
            &ready,
            &accepting,
            || Ok(()),
            || {
                closed.fetch_add(1, Ordering::AcqRel);
                Ok(())
            },
        )
        .expect("unobserved ready still closes");
        assert_eq!(closed.load(Ordering::Acquire), 2);
        assert_eq!(receive.try_recv(), Ok(Ok(())));
    }

    #[test]
    fn disconnected_ready_and_failed_processing_both_close_the_owned_consumer() {
        let (ready, receive) = mpsc::sync_channel(1);
        drop(receive);
        let closed = AtomicUsize::new(0);
        handoff_and_consume(
            &ready,
            &AtomicBool::new(true),
            || panic!("disconnected controller"),
            || {
                closed.fetch_add(1, Ordering::AcqRel);
                Ok(())
            },
        )
        .expect("close without processing");
        assert_eq!(closed.load(Ordering::Acquire), 1);
        let (ready, _receive) = mpsc::sync_channel(1);
        assert_eq!(
            handoff_and_consume(
                &ready,
                &AtomicBool::new(true),
                || Err(WindowsEtwFailure::Backend),
                || {
                    closed.fetch_add(1, Ordering::AcqRel);
                    Err(WindowsEtwFailure::Cleanup)
                }
            ),
            Err(WindowsEtwFailure::Cleanup)
        );
        assert_eq!(closed.load(Ordering::Acquire), 2);
        let (ready, _receive) = mpsc::sync_channel(1);
        assert_eq!(
            handoff_and_consume(
                &ready,
                &AtomicBool::new(true),
                || Ok(()),
                || Err(WindowsEtwFailure::Cleanup)
            ),
            Err(WindowsEtwFailure::Cleanup)
        );
    }

    #[test]
    fn terminal_publication_waits_for_previously_admitted_callback_tail() {
        let (sender, receiver) = mpsc::sync_channel(2);
        let ingress = Arc::new(Ingress::new(sender));
        let admitted = Arc::new(Barrier::new(2));
        let release = Arc::new(Barrier::new(2));
        std::thread::scope(|scope| {
            let producer_ingress = Arc::clone(&ingress);
            let producer_admitted = Arc::clone(&admitted);
            let producer_release = Arc::clone(&release);
            scope.spawn(move || {
                // Pause the exact commit region after its accepting recheck,
                // before the nonblocking enqueue, while retaining its gate.
                let _gate = producer_ingress.commit_gate.lock().expect("commit gate");
                assert!(producer_ingress.accepting.load(Ordering::Acquire));
                producer_admitted.wait();
                producer_release.wait();
                assert!(producer_ingress.sender.try_send(event(42)).is_ok());
            });
            admitted.wait();
            ingress.loss(1, 0);
            let (published, publication) = mpsc::sync_channel(1);
            let draining_ingress = Arc::clone(&ingress);
            scope.spawn(move || {
                assert!(published.send(draining_ingress.drain(&receiver, 2)).is_ok());
            });
            assert!(matches!(
                publication.try_recv(),
                Err(mpsc::TryRecvError::Empty)
            ));
            release.wait();
            let drain = publication
                .recv_timeout(Duration::from_secs(1))
                .expect("terminal publication");
            assert_eq!(drain.events.len(), 1);
            assert_eq!(drain.events[0].lifetime.process_id, 42);
            assert_eq!(
                drain.failure,
                Some(WindowsEtwFailure::NativeLoss {
                    events: 1,
                    buffers: 0
                })
            );
        });
    }

    #[test]
    fn callback_commit_contention_is_nonblocking_and_no_event_follows_terminal() {
        let (sender, receiver) = mpsc::sync_channel(2);
        let ingress = Ingress::new(sender);
        let held = ingress.commit_gate.lock().expect("control gate");
        ingress.submit(event(1)); // must return without waiting for held
        drop(held);
        let terminal = ingress.drain(&receiver, 2);
        assert!(terminal.events.is_empty());
        assert_eq!(terminal.failure, Some(WindowsEtwFailure::QueueOverflow));
        ingress.submit(event(2));
        assert!(ingress.drain(&receiver, 2).events.is_empty());
    }

    #[test]
    fn overflow_preserves_bounded_accepted_tail_before_terminal() {
        let (sender, receiver) = mpsc::sync_channel(2);
        let ingress = Ingress::new(sender);
        ingress.submit(event(1));
        ingress.submit(event(2));
        ingress.submit(event(3));
        let drain = ingress.drain(&receiver, 2);
        assert_eq!(drain.events.len(), 2);
        assert_eq!(drain.failure, Some(WindowsEtwFailure::QueueOverflow));
        assert!(ingress.drain(&receiver, 2).events.is_empty());
    }
    #[test]
    fn pinned_numeric_prefix_preserves_pid_creation_generation_and_session() {
        let mut bytes = [0_u8; 20];
        bytes[0..4].copy_from_slice(&42_u32.to_le_bytes());
        bytes[4..12].copy_from_slice(&99_u64.to_le_bytes());
        bytes[16..20].copy_from_slice(&3_u32.to_le_bytes());
        let started = decode_prefix(1, 1, 88, &bytes).expect("start");
        let stopped = decode_prefix(2, 0, 100, &bytes[..12]).expect("stop");
        assert!(started.lifetime == stopped.lifetime);
        assert_eq!(started.session_id, Some(3));
        assert!(stopped.session_id.is_none());
        assert!(!stopped.started);
        bytes[4..12].copy_from_slice(&101_u64.to_le_bytes());
        assert!(
            decode_prefix(1, 0, 110, &bytes)
                .expect("reused pid")
                .lifetime
                != started.lifetime
        );
    }
    #[test]
    fn unknown_schema_or_missing_creation_identity_never_falls_back_to_pid() {
        assert!(decode_prefix(1, 2, 1, &[0; 20]).is_err());
        assert!(decode_prefix(2, 1, 1, &[0; 11]).is_err());
        let mut bytes = [0_u8; 20];
        bytes[0..4].copy_from_slice(&42_u32.to_le_bytes());
        assert!(decode_prefix(1, 1, 1, &bytes).is_err());
    }
    #[test]
    fn native_buffer_loss_keeps_its_unit_and_fences_intake() {
        let (sender, _receiver) = mpsc::sync_channel(2);
        let ingress = Ingress {
            sender,
            commit_gate: Mutex::new(()),
            accepting: AtomicBool::new(true),
            terminal: AtomicU8::new(0),
            lost_events: AtomicU32::new(0),
            lost_buffers: AtomicU32::new(0),
        };
        ingress.loss(0, 2);
        assert!(!ingress.accepting.load(Ordering::Acquire));
        assert_eq!(
            ingress.failure(),
            Some(WindowsEtwFailure::NativeLoss {
                events: 0,
                buffers: 2
            })
        );
    }
}
