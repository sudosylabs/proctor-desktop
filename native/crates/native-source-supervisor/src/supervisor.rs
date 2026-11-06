//! The supervisor itself and the results it reports to its caller.

use std::fmt;
use std::sync::mpsc::Receiver;
use std::time::{Duration, Instant};

use native_protocol::SourceFailureCode;
use native_source_runtime::poison_native_source_process;

use crate::config::SupervisorConfig;
use crate::erased::{SourceParameters, SourceStopOutcome};
use crate::factories::BaselineSourceFactories;
use crate::open::{OpenedManifest, SOURCE_OPEN_DEADLINE, open_initial_manifest};
use crate::restart::{
    PollControl, RestartOpenMessage, SlotLifecycle, SourceSlot, begin_restart_source,
    poll_active_source, poll_restart_source, supervisor_state,
};
use crate::source::{NativeSourceBatch, NativeSourceKind, NativeSourceSnapshot};

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum SupervisorState {
    Healthy,
    Degraded,
    Recovering,
    Failed,
    Stopped,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct BaselineSourceSnapshots {
    pub sources: Vec<NativeSourceSnapshot>,
}

pub struct OpenedSupervisor {
    pub supervisor: NativeSourceSupervisor,
    pub snapshots: BaselineSourceSnapshots,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum SourceLifecycleTransition {
    RestartScheduled {
        source: NativeSourceKind,
        previous_source_instance_id: String,
        next_attempt: u8,
        retry_after: Duration,
        failure: SourceFailureCode,
    },
    Restarted {
        source: NativeSourceKind,
        previous_source_instance_id: String,
        new_source_instance_id: String,
        attempt: u8,
    },
    RestartAttemptFailed {
        source: NativeSourceKind,
        attempt: u8,
        retry_after: Duration,
        failure: SourceFailureCode,
    },
    RestartExhausted {
        source: NativeSourceKind,
        attempts: u8,
        failure: SourceFailureCode,
    },
    ProcessReplacementRequired {
        source: NativeSourceKind,
        failure: SourceFailureCode,
    },
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SupervisorPoll {
    pub state: SupervisorState,
    pub opened_snapshots: Vec<NativeSourceSnapshot>,
    pub final_snapshots: Vec<NativeSourceSnapshot>,
    pub batches: Vec<NativeSourceBatch>,
    pub transitions: Vec<SourceLifecycleTransition>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SupervisorStop {
    pub state: SupervisorState,
    pub final_snapshots: Vec<NativeSourceSnapshot>,
    pub batches: Vec<NativeSourceBatch>,
    pub process_replacement_required: bool,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SupervisorOpenError {
    pub source: NativeSourceKind,
    pub failure: SourceFailureCode,
    pub cleanup_failures: Vec<NativeSourceKind>,
    pub process_replacement_required: bool,
}

impl fmt::Display for SupervisorOpenError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            formatter,
            "{} source failed to open ({})",
            self.source,
            failure_code_name(self.failure)
        )?;
        if !self.cleanup_failures.is_empty() {
            write!(
                formatter,
                "; rollback cleanup failed for {} source(s)",
                self.cleanup_failures.len()
            )?;
        }
        Ok(())
    }
}

impl std::error::Error for SupervisorOpenError {}

pub struct NativeSourceSupervisor {
    config: SupervisorConfig,
    clock: Box<dyn SupervisorClock>,
    process_fence: Box<dyn ProcessFence>,
    restart_open_deadline: Duration,
    slots: Vec<SourceSlot>,
    process_replacement_required: bool,
    stopped: bool,
}

impl NativeSourceSupervisor {
    /// Opens the exact first-release source manifest. Each source opening has
    /// a five-second deadline. Opening is atomic: if a later source fails,
    /// every already-open source is stopped in reverse order before the error
    /// is returned.
    ///
    /// # Errors
    ///
    /// Returns the bounded failure category and any rollback-cleanup failures
    /// when the complete source set cannot be established.
    pub fn open(
        config: SupervisorConfig,
        factories: BaselineSourceFactories,
    ) -> Result<OpenedSupervisor, SupervisorOpenError> {
        Self::open_with_environment(
            config,
            factories,
            Box::new(SystemSupervisorClock::start()),
            Box::new(NativeProcessFence),
            SOURCE_OPEN_DEADLINE,
        )
    }

    #[cfg(test)]
    pub(crate) fn open_with_clock(
        config: SupervisorConfig,
        factories: BaselineSourceFactories,
        clock: Box<dyn SupervisorClock>,
    ) -> Result<OpenedSupervisor, SupervisorOpenError> {
        Self::open_with_environment(
            config,
            factories,
            clock,
            Box::new(NativeProcessFence),
            SOURCE_OPEN_DEADLINE,
        )
    }

    pub(crate) fn open_with_environment(
        config: SupervisorConfig,
        factories: BaselineSourceFactories,
        clock: Box<dyn SupervisorClock>,
        process_fence: Box<dyn ProcessFence>,
        restart_open_deadline: Duration,
    ) -> Result<OpenedSupervisor, SupervisorOpenError> {
        let parameters = SourceParameters::from(&config);
        let OpenedManifest { sources, snapshots } = open_initial_manifest(&parameters, factories)?;
        let slots = sources
            .into_iter()
            .map(|opened| {
                let kind = opened.source.kind();
                SourceSlot::active(kind, opened.factory, opened.source)
            })
            .collect();

        Ok(OpenedSupervisor {
            supervisor: Self {
                config,
                clock,
                process_fence,
                restart_open_deadline,
                slots,
                process_replacement_required: false,
                stopped: false,
            },
            snapshots,
        })
    }

    /// Drains active sources, starts due restart attempts in detached bounded
    /// workers, and harvests completed attempts without waiting. Returned
    /// transitions are mechanical lifecycle facts; the caller must run
    /// complete policy and admission checks after recovery.
    #[must_use]
    pub fn poll(&mut self) -> SupervisorPoll {
        if self.stopped {
            return SupervisorPoll::empty(SupervisorState::Stopped);
        }
        if self.process_replacement_required {
            return SupervisorPoll::empty(SupervisorState::Failed);
        }
        let now = self.clock.now();
        let parameters = SourceParameters::from(&self.config);
        let policy = self.config.restart_policy;
        let mut poll = SupervisorPoll::empty(SupervisorState::Healthy);
        for slot in &mut self.slots {
            let control = match slot.lifecycle {
                SlotLifecycle::Active => {
                    poll_active_source(slot, now, policy, &mut poll, self.process_fence.as_ref())
                }
                SlotLifecycle::RestartPending { due_at, .. } if due_at <= now => {
                    begin_restart_source(
                        slot,
                        &parameters,
                        self.restart_open_deadline,
                        &mut poll,
                        self.process_fence.as_ref(),
                    )
                }
                SlotLifecycle::RestartOpening { .. } => {
                    poll_restart_source(slot, now, policy, &mut poll, self.process_fence.as_ref())
                }
                SlotLifecycle::RestartPending { .. } | SlotLifecycle::Exhausted => {
                    PollControl::Continue
                }
            };
            if control == PollControl::ReplaceProcess {
                self.process_replacement_required = true;
                break;
            }
        }
        poll.state = supervisor_state(&self.slots);
        poll
    }

    #[must_use]
    pub fn state(&self) -> SupervisorState {
        if self.stopped {
            SupervisorState::Stopped
        } else if self.process_replacement_required {
            SupervisorState::Failed
        } else {
            supervisor_state(&self.slots)
        }
    }

    /// Stops every active source in reverse manifest order. Repeated calls are
    /// safe and return an empty stopped result.
    #[must_use]
    pub fn stop(&mut self) -> SupervisorStop {
        let mut result = SupervisorStop {
            state: SupervisorState::Stopped,
            final_snapshots: Vec::new(),
            batches: Vec::new(),
            process_replacement_required: self.process_replacement_required,
        };
        if self.stopped {
            return result;
        }
        self.stopped = true;
        for slot in self.slots.iter_mut().rev() {
            if let Some(mut source) = slot.source.take() {
                result.absorb(source.stop());
            }
            // A restart still in flight must be waited out (up to its own
            // deadline) so its source is stopped rather than leaked.
            let lifecycle = std::mem::replace(&mut slot.lifecycle, SlotLifecycle::Exhausted);
            if let SlotLifecycle::RestartOpening {
                deadline,
                completion,
                ..
            } = lifecycle
            {
                match wait_for_restart_open(deadline, &completion) {
                    Some(RestartOpenMessage::Completed(completion)) => match completion.result {
                        Ok((mut source, _snapshot)) => result.absorb(source.stop()),
                        Err(failure) => {
                            result.process_replacement_required |=
                                failure.process_replacement_required;
                        }
                    },
                    Some(RestartOpenMessage::MissedDeadline) | None => {
                        result.process_replacement_required = true;
                    }
                }
            }
        }
        self.process_replacement_required = result.process_replacement_required;
        if self.process_replacement_required {
            self.process_fence.poison();
        }
        result
    }
}

impl Drop for NativeSourceSupervisor {
    fn drop(&mut self) {
        let _ = self.stop();
    }
}

impl SupervisorPoll {
    fn empty(state: SupervisorState) -> Self {
        Self {
            state,
            opened_snapshots: Vec::new(),
            final_snapshots: Vec::new(),
            batches: Vec::new(),
            transitions: Vec::new(),
        }
    }
}

impl SupervisorStop {
    /// Collects one stopped source's output, remembering if its input could
    /// not be closed.
    fn absorb(&mut self, stopped: SourceStopOutcome) {
        self.process_replacement_required |= !stopped.closed_input_boundary;
        self.batches.extend(stopped.preceding_batches);
        self.final_snapshots.extend(stopped.final_snapshot);
        self.batches.push(stopped.batch);
    }
}

/// Waits until `deadline` for a restart worker's message. `None` means the
/// worker neither reported in time nor is still able to.
fn wait_for_restart_open(
    deadline: Instant,
    completion: &Receiver<RestartOpenMessage>,
) -> Option<RestartOpenMessage> {
    let remaining = deadline.saturating_duration_since(Instant::now());
    if remaining.is_zero() {
        completion.try_recv().ok()
    } else {
        completion.recv_timeout(remaining).ok()
    }
}

/// Marks the whole process unusable once a source could not be shut down
/// safely. Tests substitute a recording fence.
pub(crate) trait ProcessFence: Send {
    fn poison(&self);
}

struct NativeProcessFence;

impl ProcessFence for NativeProcessFence {
    fn poison(&self) {
        poison_native_source_process();
    }
}

/// Monotonic time since the supervisor started, used to schedule restarts.
/// Tests substitute a manual clock.
pub(crate) trait SupervisorClock {
    fn now(&self) -> Duration;
}

struct SystemSupervisorClock {
    started_at: Instant,
}

impl SystemSupervisorClock {
    fn start() -> Self {
        Self {
            started_at: Instant::now(),
        }
    }
}

impl SupervisorClock for SystemSupervisorClock {
    fn now(&self) -> Duration {
        self.started_at.elapsed()
    }
}

fn failure_code_name(code: SourceFailureCode) -> &'static str {
    match code {
        SourceFailureCode::Backend => "backend",
        SourceFailureCode::Cleanup => "cleanup",
        SourceFailureCode::InventoryOverflow => "inventory-overflow",
        SourceFailureCode::Protocol => "protocol",
        SourceFailureCode::Queue => "queue",
        SourceFailureCode::QueueOverflow => "queue-overflow",
    }
}
