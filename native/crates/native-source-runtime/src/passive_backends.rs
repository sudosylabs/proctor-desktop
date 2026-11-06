//! Ready-made passive-state backends: unavailable, static, and polling.

use std::marker::PhantomData;
use std::panic::{self, AssertUnwindSafe};
use std::sync::Arc;
use std::sync::mpsc;
use std::time::Duration;

use native_protocol::{PermissionState, PlatformFamily};

use crate::deadline::{DeadlineThread, poison_native_source_process, prefer_boundary_error};
use crate::passive_state::{
    OpenedPassiveStateBackend, PassiveStateBackend, PassiveStateEmitter, PassiveStateSourceError,
    PassiveStateSubscription, PassiveStateWire,
};

pub struct UnavailablePassiveStateBackend<W: PassiveStateWire> {
    platform: PlatformFamily,
    adapter_version: &'static str,
    wire: PhantomData<W>,
}

impl<W: PassiveStateWire> UnavailablePassiveStateBackend<W> {
    #[must_use]
    pub const fn new(platform: PlatformFamily, adapter_version: &'static str) -> Self {
        Self {
            platform,
            adapter_version,
            wire: PhantomData,
        }
    }
}

pub struct UnavailablePassiveStateSubscription<W: PassiveStateWire> {
    final_state: W::State,
}

impl<W: PassiveStateWire> PassiveStateSubscription<W> for UnavailablePassiveStateSubscription<W> {
    fn stop(self) -> Result<W::State, PassiveStateSourceError> {
        Ok(self.final_state)
    }
}

impl<W: PassiveStateWire> PassiveStateBackend<W> for UnavailablePassiveStateBackend<W> {
    type Subscription = UnavailablePassiveStateSubscription<W>;

    fn open(
        self,
        _emitter: PassiveStateEmitter<W>,
    ) -> Result<OpenedPassiveStateBackend<W, Self::Subscription>, PassiveStateSourceError> {
        let state = W::unavailable_state();
        Ok(OpenedPassiveStateBackend {
            platform: self.platform,
            permission: PermissionState::Unavailable,
            adapter_version: self.adapter_version,
            initial_state: state.clone(),
            subscription: UnavailablePassiveStateSubscription { final_state: state },
        })
    }
}

/// A passive source whose complete mechanical state is immutable for the life
/// of the utility process. Capability crates must use this only for facts that
/// cannot transition without restarting that process (for example, the current
/// guest/root virtualization classification).
pub struct StaticPassiveStateBackend<W: PassiveStateWire> {
    platform: PlatformFamily,
    permission: PermissionState,
    adapter_version: &'static str,
    state: W::State,
}

impl<W: PassiveStateWire> StaticPassiveStateBackend<W> {
    #[must_use]
    pub const fn new(
        platform: PlatformFamily,
        permission: PermissionState,
        adapter_version: &'static str,
        state: W::State,
    ) -> Self {
        Self {
            platform,
            permission,
            adapter_version,
            state,
        }
    }
}

pub struct StaticPassiveStateSubscription<W: PassiveStateWire> {
    final_state: W::State,
}

impl<W: PassiveStateWire> PassiveStateSubscription<W> for StaticPassiveStateSubscription<W> {
    fn stop(self) -> Result<W::State, PassiveStateSourceError> {
        Ok(self.final_state)
    }
}

impl<W: PassiveStateWire> PassiveStateBackend<W> for StaticPassiveStateBackend<W> {
    type Subscription = StaticPassiveStateSubscription<W>;

    fn open(
        self,
        _emitter: PassiveStateEmitter<W>,
    ) -> Result<OpenedPassiveStateBackend<W, Self::Subscription>, PassiveStateSourceError> {
        Ok(OpenedPassiveStateBackend {
            platform: self.platform,
            permission: self.permission,
            adapter_version: self.adapter_version,
            initial_state: self.state.clone(),
            subscription: StaticPassiveStateSubscription {
                final_state: self.state,
            },
        })
    }
}

/// Longest a single polling query is expected to take. Stopping a polling
/// source may have to wait for one query already in flight and then run one
/// final query, so its stop deadlines are derived from this budget.
pub(crate) const POLL_QUERY_BUDGET: Duration = Duration::from_secs(1);

type PassiveStateQuery<W> =
    dyn Fn() -> Result<<W as PassiveStateWire>::State, PassiveStateSourceError> + Send + Sync;

/// Shared bounded reconciliation polling for adapters whose declared coverage
/// is snapshot-only. It coalesces equal states and never upgrades polling into
/// a notification/lifecycle claim.
pub struct PollingPassiveStateBackend<W: PassiveStateWire> {
    platform: PlatformFamily,
    permission: PermissionState,
    adapter_version: &'static str,
    interval: Duration,
    query: Arc<PassiveStateQuery<W>>,
    wire: PhantomData<W>,
}

#[derive(Clone, Copy)]
enum PollingWorkerCommand {
    Start,
    Stop,
}

impl<W: PassiveStateWire> PollingPassiveStateBackend<W> {
    #[must_use]
    pub fn new<Q>(
        platform: PlatformFamily,
        permission: PermissionState,
        adapter_version: &'static str,
        interval: Duration,
        query: Q,
    ) -> Self
    where
        Q: Fn() -> Result<W::State, PassiveStateSourceError> + Send + Sync + 'static,
    {
        Self {
            platform,
            permission,
            adapter_version,
            interval,
            query: Arc::new(query),
            wire: PhantomData,
        }
    }

    /// Starts reconciliation before the authoritative initial query and
    /// degrades only an ordinary query-time backend discovery failure to the
    /// supplied explicit unavailable state. Worker startup and every other
    /// error category remain terminal.
    ///
    /// # Errors
    ///
    /// Returns a setup, boundedness, query, or cleanup failure.
    pub fn open_with_initial_backend_fallback(
        self,
        emitter: PassiveStateEmitter<W>,
        fallback_adapter_version: &'static str,
        fallback_state: W::State,
    ) -> Result<
        OpenedPassiveStateBackend<W, InitialFallbackPollingSubscription<W>>,
        PassiveStateSourceError,
    > {
        let (stop_sender, mut worker) = self.start_worker(emitter.clone())?;
        match (self.query)() {
            Ok(initial_state) => {
                release_poll_worker(&stop_sender, &mut worker)?;
                Ok(OpenedPassiveStateBackend {
                    platform: self.platform,
                    permission: self.permission,
                    adapter_version: self.adapter_version,
                    initial_state,
                    subscription: InitialFallbackPollingSubscription::Polling(
                        PollingPassiveStateSubscription::<W> {
                            stop_sender,
                            worker,
                            query: self.query,
                            wire: PhantomData,
                        },
                    ),
                })
            }
            Err(error) if error.allows_initial_unavailable_fallback() => {
                stop_opening_poll_worker(&stop_sender, &mut worker)?;
                let opened = StaticPassiveStateBackend::new(
                    self.platform,
                    PermissionState::Unavailable,
                    fallback_adapter_version,
                    fallback_state,
                )
                .open(emitter)?;
                Ok(OpenedPassiveStateBackend {
                    platform: opened.platform,
                    permission: opened.permission,
                    adapter_version: opened.adapter_version,
                    initial_state: opened.initial_state,
                    subscription: InitialFallbackPollingSubscription::Static(opened.subscription),
                })
            }
            Err(error) => Err(prefer_boundary_error(
                error,
                stop_opening_poll_worker(&stop_sender, &mut worker),
            )),
        }
    }

    fn start_worker(
        &self,
        emitter: PassiveStateEmitter<W>,
    ) -> Result<(mpsc::SyncSender<PollingWorkerCommand>, DeadlineThread), PassiveStateSourceError>
    {
        if self.interval.is_zero() || self.interval > Duration::from_secs(60) {
            return Err(PassiveStateSourceError::Backend(
                "polling interval is outside the bounded source range".to_owned(),
            ));
        }
        // Capacity two guarantees an immediate Stop can follow Start even if
        // the newly spawned worker has not consumed the release command yet.
        let (control_sender, control_receiver) = mpsc::sync_channel(2);
        let worker_query = Arc::clone(&self.query);
        let worker_emitter = emitter;
        let interval = self.interval;
        let worker = DeadlineThread::spawn(W::STOP_THREAD_NAME, move || {
            let result = panic::catch_unwind(AssertUnwindSafe(|| {
                match control_receiver.recv() {
                    Ok(PollingWorkerCommand::Start) => {}
                    Ok(PollingWorkerCommand::Stop) | Err(_) => return,
                }
                loop {
                    match control_receiver.recv_timeout(interval) {
                        Ok(PollingWorkerCommand::Stop)
                        | Err(mpsc::RecvTimeoutError::Disconnected) => break,
                        Ok(PollingWorkerCommand::Start) => {}
                        Err(mpsc::RecvTimeoutError::Timeout) => match worker_query() {
                            Ok(state) => worker_emitter.observe(state),
                            Err(error) => {
                                worker_emitter.fail(error);
                                break;
                            }
                        },
                    }
                }
            }));
            if result.is_err() {
                worker_emitter.fail(PassiveStateSourceError::Backend(
                    "polling source worker panicked".to_owned(),
                ));
            }
        })
        .map_err(|error| {
            PassiveStateSourceError::Backend(format!("cannot start polling source worker: {error}"))
        })?;
        Ok((control_sender, worker))
    }
}

pub enum InitialFallbackPollingSubscription<W: PassiveStateWire> {
    Polling(PollingPassiveStateSubscription<W>),
    Static(StaticPassiveStateSubscription<W>),
}

impl<W: PassiveStateWire> PassiveStateSubscription<W> for InitialFallbackPollingSubscription<W> {
    fn stop(self) -> Result<W::State, PassiveStateSourceError> {
        match self {
            Self::Polling(subscription) => subscription.stop(),
            Self::Static(subscription) => subscription.stop(),
        }
    }
}

pub struct PollingPassiveStateSubscription<W: PassiveStateWire> {
    stop_sender: mpsc::SyncSender<PollingWorkerCommand>,
    worker: DeadlineThread,
    query: Arc<PassiveStateQuery<W>>,
    wire: PhantomData<W>,
}

impl<W: PassiveStateWire> PassiveStateSubscription<W> for PollingPassiveStateSubscription<W> {
    fn stop(mut self) -> Result<W::State, PassiveStateSourceError> {
        let _ = self.stop_sender.try_send(PollingWorkerCommand::Stop);
        // The worker only sees Stop between polls, so allow a query already in
        // flight to finish before treating the worker as stuck.
        self.worker.finish(POLL_QUERY_BUDGET).map_err(|error| {
            poison_native_source_process();
            PassiveStateSourceError::Cleanup(format!(
                "polling source worker {error}; native utility restart is required"
            ))
        })?;
        (self.query)()
    }
}

impl<W: PassiveStateWire> PassiveStateBackend<W> for PollingPassiveStateBackend<W> {
    type Subscription = PollingPassiveStateSubscription<W>;

    fn open(
        self,
        emitter: PassiveStateEmitter<W>,
    ) -> Result<OpenedPassiveStateBackend<W, Self::Subscription>, PassiveStateSourceError> {
        let (stop_sender, mut worker) = self.start_worker(emitter)?;
        let initial_state = match (self.query)() {
            Ok(state) => state,
            Err(primary) => {
                return Err(prefer_boundary_error(
                    primary,
                    stop_opening_poll_worker(&stop_sender, &mut worker),
                ));
            }
        };
        release_poll_worker(&stop_sender, &mut worker)?;
        Ok(OpenedPassiveStateBackend {
            platform: self.platform,
            permission: self.permission,
            adapter_version: self.adapter_version,
            initial_state,
            subscription: PollingPassiveStateSubscription::<W> {
                stop_sender,
                worker,
                query: self.query,
                wire: PhantomData,
            },
        })
    }
}

fn stop_opening_poll_worker(
    stop_sender: &mpsc::SyncSender<PollingWorkerCommand>,
    worker: &mut DeadlineThread,
) -> Result<(), PassiveStateSourceError> {
    let _ = stop_sender.try_send(PollingWorkerCommand::Stop);
    worker.finish(POLL_QUERY_BUDGET).map_err(|error| {
        poison_native_source_process();
        PassiveStateSourceError::Cleanup(format!(
            "polling source rollback {error}; native utility restart is required"
        ))
    })
}

fn release_poll_worker(
    control_sender: &mpsc::SyncSender<PollingWorkerCommand>,
    worker: &mut DeadlineThread,
) -> Result<(), PassiveStateSourceError> {
    control_sender
        .try_send(PollingWorkerCommand::Start)
        .map_err(|error| {
            let primary = PassiveStateSourceError::Backend(format!(
                "cannot release polling source worker: {error}"
            ));
            prefer_boundary_error(primary, stop_opening_poll_worker(control_sender, worker))
        })
}
