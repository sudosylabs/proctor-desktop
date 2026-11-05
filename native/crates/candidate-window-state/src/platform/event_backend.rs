use std::cell::Cell;
use std::collections::VecDeque;
use std::marker::PhantomData;
use std::rc::Rc;
use std::sync::Arc;
use std::sync::Mutex;
use std::sync::mpsc::{self, Receiver, SyncSender, TrySendError};
use std::time::{Duration, Instant};

use native_protocol::{
    CandidateWindowHostEvent, CandidateWindowHostEventKind, CandidateWindowState,
    MAX_CANDIDATE_WINDOW_FACTS, PermissionState, PlatformFamily, ProtocolValidatable,
    ProtocolViolation,
};
use native_source_runtime::{DeadlineThread, QueueError, ThreadFinishError};

use crate::{
    CandidateWindowBackend, CandidateWindowEmitter, CandidateWindowError,
    CandidateWindowSubscription, OpenedCandidateWindowBackend,
};

const BRIDGE_STOP_DEADLINE: Duration = Duration::from_millis(200);

enum IngressMessage {
    Event {
        ingress_sequence: u64,
        event: CandidateWindowHostEvent,
    },
    Lost(IngressLossRange),
    Wake,
    Stop {
        next_ingress_sequence: u64,
        final_state: CandidateWindowState,
    },
}

#[derive(Clone, Copy)]
struct IngressLossRange {
    first_missing: u64,
    last_missing: u64,
}

struct FencedCandidateWindowState {
    next_ingress_sequence: u64,
    final_state: CandidateWindowState,
}

struct IngressFence {
    fenced_state: Mutex<Option<FencedCandidateWindowState>>,
    pending_loss_ranges: Mutex<VecDeque<IngressLossRange>>,
    max_pending_loss_ranges: usize,
}

/// Nonblocking, bounded utility-side endpoint for already decoded private-port
/// messages. The Electron `MessagePortMain` adapter remains a separate
/// process-composition responsibility and must authenticate and validate the
/// generated DTO before forwarding it here.
///
/// The `Rc` marker deliberately makes this endpoint `!Send` and `!Sync`: one
/// utility event-loop owner establishes strict enqueue order.
///
/// ```compile_fail
/// use candidate_window_state::candidate_window_utility_ingress;
///
/// let (ingress, _receiver) = candidate_window_utility_ingress(8).unwrap();
/// std::thread::spawn(move || drop(ingress));
/// ```
pub struct CandidateWindowUtilityIngress {
    sender: SyncSender<IngressMessage>,
    fence: Arc<IngressFence>,
    accepting: Cell<bool>,
    next_sequence: Cell<u64>,
    single_thread_owner: PhantomData<Rc<()>>,
}

pub struct CandidateWindowUtilityReceiver {
    receiver: Receiver<IngressMessage>,
    sender: SyncSender<IngressMessage>,
    fence: Arc<IngressFence>,
    capacity: u16,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum CandidateWindowUtilityIngressOutcome {
    Accepted,
    Dropped,
    Stopped,
}

/// Creates the typed utility-local queue used after private-port decoding.
/// Events accepted before source opening remain ordered behind the
/// sequence-zero snapshot boundary.
///
/// # Errors
///
/// Returns [`QueueError::InvalidCapacity`] when fewer than two events can be
/// retained.
pub fn candidate_window_utility_ingress(
    capacity: u16,
) -> Result<
    (
        CandidateWindowUtilityIngress,
        CandidateWindowUtilityReceiver,
    ),
    QueueError,
> {
    if capacity < 2 || usize::from(capacity) > MAX_CANDIDATE_WINDOW_FACTS {
        return Err(QueueError::InvalidCapacity);
    }
    let (sender, receiver) = mpsc::sync_channel(usize::from(capacity));
    let fence = Arc::new(IngressFence {
        fenced_state: Mutex::new(None),
        pending_loss_ranges: Mutex::new(VecDeque::with_capacity(usize::from(capacity) + 1)),
        max_pending_loss_ranges: usize::from(capacity) + 1,
    });
    Ok((
        CandidateWindowUtilityIngress {
            sender: sender.clone(),
            fence: Arc::clone(&fence),
            accepting: Cell::new(true),
            next_sequence: Cell::new(1),
            single_thread_owner: PhantomData,
        },
        CandidateWindowUtilityReceiver {
            receiver,
            sender,
            fence,
            capacity,
        },
    ))
}

impl CandidateWindowUtilityIngress {
    /// Validates and attempts to enqueue one event without waiting for source
    /// locks, validation drains, or worker progress.
    ///
    /// # Errors
    ///
    /// Returns a protocol error for a malformed generated DTO.
    pub fn try_send(
        &self,
        event: CandidateWindowHostEvent,
    ) -> Result<CandidateWindowUtilityIngressOutcome, CandidateWindowError> {
        event
            .validate_protocol()
            .map_err(ProtocolViolation::from)
            .map_err(CandidateWindowError::Protocol)?;
        if !self.accepting.get() {
            return Ok(CandidateWindowUtilityIngressOutcome::Stopped);
        }
        let ingress_sequence = self.next_sequence.get();
        self.next_sequence.set(ingress_sequence.saturating_add(1));
        match self.sender.try_send(IngressMessage::Event {
            ingress_sequence,
            event,
        }) {
            Ok(()) => Ok(CandidateWindowUtilityIngressOutcome::Accepted),
            Err(TrySendError::Full(IngressMessage::Event {
                ingress_sequence, ..
            })) => {
                record_pending_loss(
                    &self.sender,
                    &self.fence,
                    IngressLossRange {
                        first_missing: ingress_sequence,
                        last_missing: ingress_sequence,
                    },
                );
                Ok(CandidateWindowUtilityIngressOutcome::Dropped)
            }
            Err(TrySendError::Full(_message)) => unreachable!("only an event was sent"),
            Err(TrySendError::Disconnected(_event)) => {
                Ok(CandidateWindowUtilityIngressOutcome::Stopped)
            }
        }
    }

    /// Commits the exact ingress range for events discarded by the bounded
    /// Electron-main sender before they reached this utility-local queue. A
    /// prioritized marker makes the source failure poll-visible even when no
    /// later window event arrives.
    ///
    /// # Errors
    ///
    /// Returns a backend error if the sequence space is exhausted.
    pub fn record_lost_events(
        &self,
        lost_count: u32,
    ) -> Result<CandidateWindowUtilityIngressOutcome, CandidateWindowError> {
        if lost_count == 0 {
            return Err(CandidateWindowError::Backend(
                "CandidateWindow lost-event count must be positive".to_owned(),
            ));
        }
        if !self.accepting.get() {
            return Ok(CandidateWindowUtilityIngressOutcome::Stopped);
        }
        let first_missing = self.next_sequence.get();
        let next_sequence = first_missing
            .checked_add(u64::from(lost_count))
            .ok_or_else(|| {
                CandidateWindowError::Backend(
                    "CandidateWindow utility ingress sequence space was exhausted".to_owned(),
                )
            })?;
        let loss = IngressLossRange {
            first_missing,
            last_missing: next_sequence.saturating_sub(1),
        };
        self.next_sequence.set(next_sequence);
        match self.sender.try_send(IngressMessage::Lost(loss)) {
            Ok(()) => Ok(CandidateWindowUtilityIngressOutcome::Accepted),
            Err(TrySendError::Full(IngressMessage::Lost(loss))) => {
                record_pending_loss(&self.sender, &self.fence, loss);
                Ok(CandidateWindowUtilityIngressOutcome::Accepted)
            }
            Err(TrySendError::Full(_message)) => unreachable!("only a loss marker was sent"),
            Err(TrySendError::Disconnected(_message)) => {
                Ok(CandidateWindowUtilityIngressOutcome::Stopped)
            }
        }
    }

    /// Fences utility-side delivery with the fresh final state received from
    /// Electron main after its `BrowserWindow` listeners have been detached.
    /// This is a control-path operation, never an event callback.
    ///
    /// # Errors
    ///
    /// Returns a protocol error for an invalid final state or a cleanup error
    /// when the endpoint was already fenced with a different final state.
    pub fn fence_with_final_state(
        &self,
        final_state: CandidateWindowState,
    ) -> Result<(), CandidateWindowError> {
        final_state
            .validate_protocol()
            .map_err(ProtocolViolation::from)
            .map_err(CandidateWindowError::Protocol)?;
        if self.accepting.replace(false) {
            *lock(&self.fence.fenced_state) = Some(FencedCandidateWindowState {
                next_ingress_sequence: self.next_sequence.get(),
                final_state,
            });
            return Ok(());
        }
        let fenced = lock(&self.fence.fenced_state);
        if fenced
            .as_ref()
            .is_some_and(|fenced| fenced.final_state == final_state)
        {
            return Ok(());
        }
        Err(CandidateWindowError::Cleanup(
            "CandidateWindow utility ingress was already fenced with a different final state"
                .to_owned(),
        ))
    }
}

pub(super) struct UtilityIngressBackend {
    platform: PlatformFamily,
    adapter_version: &'static str,
    initial_window: CandidateWindowState,
    ingress: CandidateWindowUtilityReceiver,
}

impl UtilityIngressBackend {
    pub(super) fn new(
        platform: PlatformFamily,
        adapter_version: &'static str,
        initial_window: CandidateWindowState,
        ingress: CandidateWindowUtilityReceiver,
    ) -> Self {
        Self {
            platform,
            adapter_version,
            initial_window,
            ingress,
        }
    }
}

#[doc(hidden)]
pub struct UtilityIngressSubscription {
    sender: SyncSender<IngressMessage>,
    fence: Arc<IngressFence>,
    final_state: Receiver<CandidateWindowState>,
    worker: DeadlineThread,
}

impl CandidateWindowBackend for UtilityIngressBackend {
    type Subscription = UtilityIngressSubscription;

    fn open(
        self,
        emitter: CandidateWindowEmitter,
    ) -> Result<OpenedCandidateWindowBackend<Self::Subscription>, CandidateWindowError> {
        let CandidateWindowUtilityReceiver {
            receiver,
            sender,
            fence,
            capacity,
        } = self.ingress;
        if usize::from(capacity) != emitter.queue_capacity() {
            return Err(CandidateWindowError::Backend(format!(
                "CandidateWindow utility ingress capacity {capacity} does not match requested capacity {}",
                emitter.queue_capacity()
            )));
        }
        let (final_sender, final_state) = mpsc::sync_channel(1);
        let worker_fence = Arc::clone(&fence);
        let worker = DeadlineThread::spawn("candidate-window-events", move || {
            run_event_worker(&receiver, &emitter, &final_sender, &worker_fence);
        })
        .map_err(|error| {
            CandidateWindowError::Backend(format!(
                "cannot start CandidateWindow utility ingress: {error}"
            ))
        })?;
        Ok(OpenedCandidateWindowBackend {
            platform: self.platform,
            permission: PermissionState::Granted,
            adapter_version: self.adapter_version,
            initial_window: self.initial_window,
            subscription: UtilityIngressSubscription {
                sender,
                fence,
                final_state,
                worker,
            },
        })
    }
}

fn run_event_worker(
    receiver: &Receiver<IngressMessage>,
    emitter: &CandidateWindowEmitter,
    final_sender: &SyncSender<CandidateWindowState>,
    fence: &IngressFence,
) {
    let mut expected_ingress_sequence = 1_u64;
    loop {
        report_pending_losses(fence, &mut expected_ingress_sequence, emitter);
        let Ok(message) = receiver.recv() else {
            return;
        };
        match message {
            IngressMessage::Event {
                ingress_sequence,
                event,
            } => {
                if ingress_sequence > expected_ingress_sequence {
                    emitter.report_lost_events(ingress_sequence - expected_ingress_sequence);
                }
                expected_ingress_sequence = ingress_sequence.saturating_add(1);
                match event.kind {
                    CandidateWindowHostEventKind::StateRefresh => {
                        emitter.observe_state(event.window.ok_or_else(|| {
                            CandidateWindowError::Backend(
                                "state refresh arrived without a window state".to_owned(),
                            )
                        }));
                    }
                    CandidateWindowHostEventKind::StateTransition => {
                        emitter.observe_transition(event.window.ok_or_else(|| {
                            CandidateWindowError::Backend(
                                "state transition arrived without a window state".to_owned(),
                            )
                        }));
                    }
                    CandidateWindowHostEventKind::CloseAttempt => {
                        emitter.observe_close_attempt();
                    }
                }
            }
            IngressMessage::Lost(loss) => {
                report_loss_range(emitter, &mut expected_ingress_sequence, loss);
            }
            IngressMessage::Wake => {}
            IngressMessage::Stop {
                next_ingress_sequence,
                final_state,
            } => {
                if next_ingress_sequence > expected_ingress_sequence {
                    emitter.report_lost_events(next_ingress_sequence - expected_ingress_sequence);
                }
                let _ = final_sender.send(final_state);
                return;
            }
        }
    }
}

fn record_pending_loss(
    sender: &SyncSender<IngressMessage>,
    fence: &IngressFence,
    loss: IngressLossRange,
) {
    let mut ranges = lock(&fence.pending_loss_ranges);
    if let Some(tail) = ranges.back_mut()
        && tail.last_missing.saturating_add(1) == loss.first_missing
    {
        tail.last_missing = loss.last_missing;
    } else {
        assert!(
            ranges.len() < fence.max_pending_loss_ranges,
            "pending CandidateWindow loss ranges exceed the bounded ingress proof"
        );
        ranges.push_back(loss);
    }
    drop(ranges);
    let _ = sender.try_send(IngressMessage::Wake);
}

fn report_pending_losses(
    fence: &IngressFence,
    expected_ingress_sequence: &mut u64,
    emitter: &CandidateWindowEmitter,
) {
    loop {
        let loss = {
            let mut ranges = lock(&fence.pending_loss_ranges);
            if ranges
                .front()
                .is_some_and(|range| range.first_missing == *expected_ingress_sequence)
            {
                ranges.pop_front()
            } else {
                None
            }
        };
        let Some(loss) = loss else {
            return;
        };
        report_loss_range(emitter, expected_ingress_sequence, loss);
    }
}

fn report_loss_range(
    emitter: &CandidateWindowEmitter,
    expected_ingress_sequence: &mut u64,
    loss: IngressLossRange,
) {
    if loss.last_missing >= *expected_ingress_sequence {
        emitter.report_lost_events(loss.last_missing - *expected_ingress_sequence + 1);
        *expected_ingress_sequence = loss.last_missing.saturating_add(1);
    }
}

impl CandidateWindowSubscription for UtilityIngressSubscription {
    fn stop(mut self) -> Result<CandidateWindowState, CandidateWindowError> {
        let started = Instant::now();
        let fenced = lock(&self.fence.fenced_state).take().ok_or_else(|| {
            CandidateWindowError::Cleanup(
                "CandidateWindow utility ingress stopped without a fresh fenced final state"
                    .to_owned(),
            )
        })?;
        self.sender
            .send(IngressMessage::Stop {
                next_ingress_sequence: fenced.next_ingress_sequence,
                final_state: fenced.final_state,
            })
            .map_err(|_error| {
                CandidateWindowError::Cleanup(
                    "CandidateWindow utility ingress worker disconnected before its stop fence"
                        .to_owned(),
                )
            })?;
        let final_state = self
            .final_state
            .recv_timeout(BRIDGE_STOP_DEADLINE)
            .map_err(|_error| {
                CandidateWindowError::Cleanup(
                    "CandidateWindow utility ingress did not return its final state before the deadline"
                        .to_owned(),
                )
            })?;
        self.worker
            .finish(BRIDGE_STOP_DEADLINE.saturating_sub(started.elapsed()))
            .map_err(|error| match error {
                ThreadFinishError::Panicked | ThreadFinishError::TimedOut => {
                    CandidateWindowError::Cleanup(format!(
                        "CandidateWindow utility ingress worker {error}"
                    ))
                }
            })?;
        Ok(final_state)
    }
}

fn lock<T>(mutex: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    mutex
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
}
