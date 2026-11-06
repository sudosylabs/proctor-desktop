//! Per-source slots and the state machine that drains an active source,
//! schedules its restart, and harvests the restart without blocking a poll.

use std::sync::mpsc::{self, Receiver, TryRecvError};
use std::thread;
use std::time::{Duration, Instant};

use native_protocol::{SourceFailureCode, SourceHealth};
use native_source_runtime::ensure_native_source_process_usable;

use crate::config::{RestartPolicy, restart_backoff};
use crate::erased::{ErasedFactory, ErasedSource, RestartBoundary, SourceParameters};
use crate::open::{source_open_thread_name, validate_opened_source};
use crate::source::{NativeSourceKind, NativeSourceSnapshot};
use crate::supervisor::{ProcessFence, SourceLifecycleTransition, SupervisorPoll, SupervisorState};

/// A restarted source reports exactly one missing observation slot so
/// consumers know continuity was broken.
pub(crate) const RESTART_BOUNDARY_MISSING_COUNT: u64 = 1;
pub(crate) const RESTART_REASON: &str = "supervised-source-restart";

/// One manifest entry: its factory, its running source if any, and where it
/// is in the restart cycle.
pub(crate) struct SourceSlot {
    pub(crate) kind: NativeSourceKind,
    pub(crate) factory: Option<Box<dyn ErasedFactory>>,
    pub(crate) source: Option<Box<dyn ErasedSource>>,
    pub(crate) lifecycle: SlotLifecycle,
    pub(crate) restart_attempts: u8,
}

impl SourceSlot {
    pub(crate) fn active(
        kind: NativeSourceKind,
        factory: Box<dyn ErasedFactory>,
        source: Box<dyn ErasedSource>,
    ) -> Self {
        Self {
            kind,
            factory: Some(factory),
            source: Some(source),
            lifecycle: SlotLifecycle::Active,
            restart_attempts: 0,
        }
    }
}

/// Where a slot is in its restart cycle.
pub(crate) enum SlotLifecycle {
    Active,
    /// The source failed and will be reopened once `due_at` passes.
    RestartPending {
        due_at: Duration,
        previous_source_instance_id: String,
    },
    /// A detached worker is reopening the source and reports on `completion`.
    RestartOpening {
        previous_source_instance_id: String,
        attempt: u8,
        deadline: Instant,
        completion: Receiver<RestartOpenMessage>,
    },
    /// The source is gone for good; the supervisor reports `Failed`.
    Exhausted,
}

pub(crate) struct RestartOpenCompletion {
    pub(crate) factory: Box<dyn ErasedFactory>,
    pub(crate) result: Result<(Box<dyn ErasedSource>, NativeSourceSnapshot), RestartOpenFailure>,
}

/// What a restart worker sends back. A worker that finishes after its
/// deadline drops its result and reports only that it was late.
pub(crate) enum RestartOpenMessage {
    Completed(RestartOpenCompletion),
    MissedDeadline,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) struct RestartOpenFailure {
    pub(crate) code: SourceFailureCode,
    pub(crate) process_replacement_required: bool,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
/// Whether polling may continue or the process must be replaced.
pub(crate) enum PollControl {
    Continue,
    ReplaceProcess,
}

pub(crate) fn poll_active_source(
    slot: &mut SourceSlot,
    now: Duration,
    policy: RestartPolicy,
    poll: &mut SupervisorPoll,
    process_fence: &dyn ProcessFence,
) -> PollControl {
    let Some(source) = slot.source.as_mut() else {
        slot.lifecycle = SlotLifecycle::Exhausted;
        return PollControl::Continue;
    };
    let batch = source.drain();
    let failed = batch.health() == SourceHealth::Failed;
    let failure = batch.terminal_error().unwrap_or(SourceFailureCode::Backend);
    let previous_source_instance_id = batch.source_instance_id().to_owned();
    poll.batches.push(batch);
    if !failed {
        return PollControl::Continue;
    }
    let final_batch = source.stop();
    let failure = final_batch.batch.terminal_error().unwrap_or(failure);
    poll.batches.extend(final_batch.preceding_batches);
    poll.final_snapshots.extend(final_batch.final_snapshot);
    poll.batches.push(final_batch.batch);
    slot.source = None;
    if !final_batch.closed_input_boundary {
        return require_process_replacement(slot, poll, process_fence, SourceFailureCode::Cleanup);
    }
    if slot.restart_attempts >= policy.maximum_attempts {
        slot.lifecycle = SlotLifecycle::Exhausted;
        poll.transitions
            .push(SourceLifecycleTransition::RestartExhausted {
                source: slot.kind,
                attempts: slot.restart_attempts,
                failure,
            });
        return PollControl::Continue;
    }
    let retry_after = restart_backoff(policy, slot.restart_attempts);
    slot.lifecycle = SlotLifecycle::RestartPending {
        due_at: now.saturating_add(retry_after),
        previous_source_instance_id: previous_source_instance_id.clone(),
    };
    poll.transitions
        .push(SourceLifecycleTransition::RestartScheduled {
            source: slot.kind,
            previous_source_instance_id,
            next_attempt: slot.restart_attempts.saturating_add(1),
            retry_after,
            failure,
        });
    PollControl::Continue
}

pub(crate) fn begin_restart_source(
    slot: &mut SourceSlot,
    parameters: &SourceParameters,
    open_deadline: Duration,
    poll: &mut SupervisorPoll,
    process_fence: &dyn ProcessFence,
) -> PollControl {
    let SlotLifecycle::RestartPending {
        previous_source_instance_id,
        ..
    } = &slot.lifecycle
    else {
        return PollControl::Continue;
    };
    let previous_source_instance_id = previous_source_instance_id.clone();
    let attempt = slot.restart_attempts.saturating_add(1);
    let restart = RestartBoundary {
        missing_count: RESTART_BOUNDARY_MISSING_COUNT,
        reason: RESTART_REASON,
    };
    let Some(factory) = slot.factory.take() else {
        slot.lifecycle = SlotLifecycle::Exhausted;
        poll.transitions
            .push(SourceLifecycleTransition::RestartExhausted {
                source: slot.kind,
                attempts: slot.restart_attempts,
                failure: SourceFailureCode::Cleanup,
            });
        return PollControl::Continue;
    };
    slot.restart_attempts = attempt;
    let (sender, completion) = mpsc::sync_channel(1);
    let deadline = Instant::now() + open_deadline;
    let kind = slot.kind;
    let thread_parameters = parameters.clone();
    let thread_previous_source_instance_id = previous_source_instance_id.clone();
    let spawn = thread::Builder::new()
        .name(source_open_thread_name(kind).to_owned())
        .spawn(move || {
            let completion = complete_restart_open(
                kind,
                factory,
                &thread_parameters,
                restart,
                &thread_previous_source_instance_id,
            );
            let message = if Instant::now() < deadline {
                RestartOpenMessage::Completed(completion)
            } else {
                drop(completion);
                RestartOpenMessage::MissedDeadline
            };
            let _ = sender.send(message);
        });
    match spawn {
        Ok(handle) => {
            drop(handle);
            slot.lifecycle = SlotLifecycle::RestartOpening {
                previous_source_instance_id,
                attempt,
                deadline,
                completion,
            };
            PollControl::Continue
        }
        Err(_error) => {
            require_process_replacement(slot, poll, process_fence, SourceFailureCode::Cleanup)
        }
    }
}

fn complete_restart_open(
    kind: NativeSourceKind,
    mut factory: Box<dyn ErasedFactory>,
    parameters: &SourceParameters,
    restart: RestartBoundary,
    previous_source_instance_id: &str,
) -> RestartOpenCompletion {
    let result = factory
        .open(parameters, Some(restart))
        .and_then(|source| {
            validate_opened_source(
                kind,
                source,
                Some(previous_source_instance_id),
                ensure_native_source_process_usable().is_ok(),
            )
        })
        .map_err(|failure| RestartOpenFailure {
            code: failure.code,
            process_replacement_required: failure.process_replacement_required,
        });
    RestartOpenCompletion { factory, result }
}

pub(crate) fn poll_restart_source(
    slot: &mut SourceSlot,
    now: Duration,
    policy: RestartPolicy,
    poll: &mut SupervisorPoll,
    process_fence: &dyn ProcessFence,
) -> PollControl {
    let SlotLifecycle::RestartOpening {
        previous_source_instance_id,
        attempt,
        deadline,
        completion,
    } = &slot.lifecycle
    else {
        return PollControl::Continue;
    };
    let previous_source_instance_id = previous_source_instance_id.clone();
    let attempt = *attempt;
    let deadline = *deadline;
    let received = match completion.try_recv() {
        Ok(message) => Ok(message),
        Err(TryRecvError::Disconnected) => Err(()),
        Err(TryRecvError::Empty) if Instant::now() < deadline => {
            return PollControl::Continue;
        }
        Err(TryRecvError::Empty) => match completion.try_recv() {
            Ok(message) => Ok(message),
            Err(TryRecvError::Empty | TryRecvError::Disconnected) => Err(()),
        },
    };
    let completion = match received {
        Ok(RestartOpenMessage::Completed(completion)) => completion,
        Ok(RestartOpenMessage::MissedDeadline) | Err(()) => {
            return require_process_replacement(
                slot,
                poll,
                process_fence,
                SourceFailureCode::Cleanup,
            );
        }
    };
    slot.factory = Some(completion.factory);
    match completion.result {
        Ok((source, snapshot)) => {
            let new_source_instance_id = snapshot.source_instance_id().to_owned();
            slot.source = Some(source);
            slot.lifecycle = SlotLifecycle::Active;
            poll.opened_snapshots.push(snapshot);
            poll.transitions.push(SourceLifecycleTransition::Restarted {
                source: slot.kind,
                previous_source_instance_id,
                new_source_instance_id,
                attempt,
            });
        }
        Err(failure) if failure.process_replacement_required => {
            return require_process_replacement(slot, poll, process_fence, failure.code);
        }
        Err(failure) if attempt >= policy.maximum_attempts => {
            slot.lifecycle = SlotLifecycle::Exhausted;
            poll.transitions
                .push(SourceLifecycleTransition::RestartExhausted {
                    source: slot.kind,
                    attempts: attempt,
                    failure: failure.code,
                });
        }
        Err(failure) => {
            let retry_after = restart_backoff(policy, attempt);
            slot.lifecycle = SlotLifecycle::RestartPending {
                due_at: now.saturating_add(retry_after),
                previous_source_instance_id,
            };
            poll.transitions
                .push(SourceLifecycleTransition::RestartAttemptFailed {
                    source: slot.kind,
                    attempt,
                    retry_after,
                    failure: failure.code,
                });
        }
    }
    PollControl::Continue
}

/// Retires a slot whose source could not be shut down or reopened safely and
/// poisons the process so nothing else opens in it.
fn require_process_replacement(
    slot: &mut SourceSlot,
    poll: &mut SupervisorPoll,
    process_fence: &dyn ProcessFence,
    failure: SourceFailureCode,
) -> PollControl {
    process_fence.poison();
    slot.lifecycle = SlotLifecycle::Exhausted;
    poll.transitions
        .push(SourceLifecycleTransition::ProcessReplacementRequired {
            source: slot.kind,
            failure,
        });
    PollControl::ReplaceProcess
}

pub(crate) fn supervisor_state(slots: &[SourceSlot]) -> SupervisorState {
    if slots
        .iter()
        .any(|slot| matches!(slot.lifecycle, SlotLifecycle::Exhausted))
    {
        return SupervisorState::Failed;
    }
    if slots.iter().any(|slot| {
        matches!(
            slot.lifecycle,
            SlotLifecycle::RestartPending { .. } | SlotLifecycle::RestartOpening { .. }
        )
    }) {
        return SupervisorState::Recovering;
    }
    if slots.iter().any(|slot| {
        slot.source.as_ref().is_none_or(|source| {
            matches!(
                source.health(),
                SourceHealth::Failed | SourceHealth::Stopped
            )
        })
    }) {
        return SupervisorState::Failed;
    }
    if slots.iter().any(|slot| {
        slot.source
            .as_ref()
            .is_none_or(|source| source.health() != SourceHealth::Healthy)
    }) {
        SupervisorState::Degraded
    } else {
        SupervisorState::Healthy
    }
}
