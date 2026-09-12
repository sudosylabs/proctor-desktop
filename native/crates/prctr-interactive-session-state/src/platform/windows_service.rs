//! Passive WTS source hosted by one process-owned Windows service dispatcher.
//! The service host registers this dispatcher from `ServiceMain`; no installation,
//! privilege elevation, session switching, or user logoff occurs here.

use super::windows_session_events::{
    Ingress, IngressState, PendingQuery, WindowsSessionNotification, minimize,
};
pub use super::windows_session_events::{
    WindowsCandidateSession, WindowsWtsSessionEvent, WindowsWtsSessionSnapshot,
};
use std::collections::VecDeque;
use std::ffi::c_void;
use std::mem;
use std::ptr;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant};

use prctr_native_protocol::{
    InteractiveConsoleOwnership, InteractiveLockState, InteractiveRemoteAttachment,
    InteractiveSessionCertainty, InteractiveSessionCoverage,
};
use prctr_native_source_runtime::{
    PassiveStateSourceError, ensure_native_source_process_usable, poison_native_source_process,
    run_bounded_task,
};
use windows_sys::Win32::Foundation::{CloseHandle, ERROR_CALL_NOT_IMPLEMENTED, HANDLE, NO_ERROR};
use windows_sys::Win32::Security::{GetTokenInformation, TOKEN_STATISTICS, TokenStatistics};
use windows_sys::Win32::System::RemoteDesktop::{WTSQueryUserToken, WTSSESSION_NOTIFICATION};
use windows_sys::Win32::System::Services::{
    RegisterServiceCtrlHandlerExW, SERVICE_ACCEPT_SESSIONCHANGE, SERVICE_ACCEPT_SHUTDOWN,
    SERVICE_ACCEPT_STOP, SERVICE_CONTROL_INTERROGATE, SERVICE_CONTROL_SESSIONCHANGE,
    SERVICE_CONTROL_SHUTDOWN, SERVICE_CONTROL_STOP, SERVICE_RUNNING, SERVICE_STATUS,
    SERVICE_STOPPED, SERVICE_WIN32_OWN_PROCESS, SetServiceStatus,
};

const MAX_QUEUE: usize = 1_024;
const MAX_RECONCILIATIONS: usize = 3;
static DISPATCHER: OnceLock<Arc<DispatcherState>> = OnceLock::new();

struct DispatcherState {
    source: Mutex<Option<Arc<Ingress>>>,
    running: AtomicBool,
    stopping: AtomicBool,
    failed: AtomicBool,
}

/// One SCM dispatcher per helper process. The callback context has process
/// lifetime because Windows offers no control-handler unregister operation.
pub struct WindowsWtsServiceDispatcher {
    status_handle: usize,
    state: Arc<DispatcherState>,
}

impl WindowsWtsServiceDispatcher {
    /// Call once from the signed service's `ServiceMain`, after OS service startup.
    /// Repeated registration requires a fresh helper process.
    ///
    /// # Errors
    /// Fails on invalid name, registration failure, or an already owned dispatcher.
    pub fn register(service_name: &str) -> Result<Self, PassiveStateSourceError> {
        ensure_usable()?;
        let mut name: Vec<u16> = service_name.encode_utf16().collect();
        if name.is_empty() || name.len() > 256 || name.contains(&0) {
            return Err(backend("invalid service identity"));
        }
        name.push(0);
        let state = Arc::new(DispatcherState {
            source: Mutex::new(None),
            running: AtomicBool::new(false),
            stopping: AtomicBool::new(false),
            failed: AtomicBool::new(false),
        });
        DISPATCHER
            .set(Arc::clone(&state))
            .map_err(|_| backend("service dispatcher already registered"))?;
        // SAFETY: the terminated service name is live for the call. The callback
        // uses the process-owned OnceLock, never a pointer to a dropped source.
        let handle = unsafe {
            RegisterServiceCtrlHandlerExW(name.as_ptr(), Some(service_control), ptr::null())
        };
        if handle.is_null() {
            return Err(backend("WTS service control registration unavailable"));
        }
        Ok(Self {
            status_handle: handle as usize,
            state,
        })
    }

    /// The service host calls this only once its private transport is ready.
    /// # Errors
    /// Returns failure if SCM cannot enable the declared session controls.
    pub fn announce_running(&self) -> Result<(), PassiveStateSourceError> {
        if self.state.stopping.load(Ordering::Acquire) {
            return Err(backend("service is stopping"));
        }
        self.set_status(SERVICE_RUNNING)?;
        self.state.running.store(true, Ordering::Release);
        Ok(())
    }

    #[must_use]
    pub fn stop_requested(&self) -> bool {
        self.state.stopping.load(Ordering::Acquire)
    }

    fn set_status(&self, current_state: u32) -> Result<(), PassiveStateSourceError> {
        let status = SERVICE_STATUS {
            dwServiceType: SERVICE_WIN32_OWN_PROCESS,
            dwCurrentState: current_state,
            dwControlsAccepted: if current_state == SERVICE_RUNNING {
                SERVICE_ACCEPT_SESSIONCHANGE | SERVICE_ACCEPT_STOP | SERVICE_ACCEPT_SHUTDOWN
            } else {
                0
            },
            ..SERVICE_STATUS::default()
        };
        // SAFETY: SCM owns this status handle for the registered service lifetime.
        if unsafe { SetServiceStatus(self.status_handle as *mut c_void, &raw const status) } == 0 {
            return Err(backend("service status update failed"));
        }
        Ok(())
    }

    /// Binds a fresh source before its initial all-session query.
    /// # Errors
    /// Fails on missing service ownership, contention, bounds, or an existing source.
    pub fn open_source(
        &self,
        candidate: WindowsCandidateSession,
        capacity: usize,
        deadline: Instant,
    ) -> Result<(WindowsWtsSessionSnapshot, WindowsWtsSessionSource), PassiveStateSourceError> {
        ensure_usable()?;
        if !(1..=MAX_QUEUE).contains(&capacity)
            || !self.state.running.load(Ordering::Acquire)
            || self.state.stopping.load(Ordering::Acquire)
            || self.state.failed.load(Ordering::Acquire)
        {
            return Err(backend("WTS service source unavailable"));
        }
        let ingress = Arc::new(Ingress {
            state: Mutex::new(IngressState {
                accepting: true,
                sequence: 0,
                retained: 0,
                queue: VecDeque::with_capacity(capacity),
            }),
            failed: AtomicBool::new(false),
            capacity,
        });
        {
            let mut source = self
                .state
                .source
                .lock()
                .map_err(|_| backend("service source poisoned"))?;
            if source.is_some() {
                return Err(backend("WTS source already open"));
            }
            *source = Some(Arc::clone(&ingress));
        }
        let mut source = WindowsWtsSessionSource {
            dispatcher: Arc::clone(&self.state),
            ingress,
            candidate,
            closed: false,
            query: None,
        };
        let state = match source.reconcile(deadline) {
            Ok((state, _bootstrap_events)) => state,
            Err(error) => {
                source.detach();
                return Err(error);
            }
        };
        Ok((state, source))
    }
}

impl Drop for WindowsWtsServiceDispatcher {
    fn drop(&mut self) {
        self.state.running.store(false, Ordering::Release);
        self.state.stopping.store(true, Ordering::Release);
        self.state.failed.store(true, Ordering::Release);
        if self.set_status(SERVICE_STOPPED).is_err() {
            poison_native_source_process();
        }
    }
}

unsafe extern "system" fn service_control(
    control: u32,
    event_type: u32,
    data: *mut c_void,
    _context: *mut c_void,
) -> u32 {
    let Some(dispatcher) = DISPATCHER.get() else {
        return ERROR_CALL_NOT_IMPLEMENTED;
    };
    match control {
        SERVICE_CONTROL_STOP | SERVICE_CONTROL_SHUTDOWN => {
            dispatcher.stopping.store(true, Ordering::Release);
            NO_ERROR
        }
        SERVICE_CONTROL_INTERROGATE => NO_ERROR,
        SERVICE_CONTROL_SESSIONCHANGE => {
            // The SDK's session change set also includes desktop-ready (0xF).
            if data.is_null() || !((1..=11).contains(&event_type) || event_type == 0xF) {
                dispatcher.failed.store(true, Ordering::Release);
                return NO_ERROR;
            }
            // SAFETY: SCM supplies WTSSESSION_NOTIFICATION for this control.
            // Copy only the size and numeric session fields, never user data.
            let notification =
                unsafe { ptr::read_unaligned(data.cast::<WTSSESSION_NOTIFICATION>()) };
            if notification.cbSize
                != u32::try_from(mem::size_of::<WTSSESSION_NOTIFICATION>()).unwrap_or(u32::MAX)
            {
                dispatcher.failed.store(true, Ordering::Release);
                return NO_ERROR;
            }
            let Ok(source) = dispatcher.source.try_lock() else {
                dispatcher.failed.store(true, Ordering::Release);
                return NO_ERROR;
            };
            if let Some(source) = source.as_ref() {
                source.record(WindowsSessionNotification {
                    event_type,
                    session_id: notification.dwSessionId,
                    observed_at: Instant::now(),
                });
            }
            NO_ERROR
        }
        _ => ERROR_CALL_NOT_IMPLEMENTED,
    }
}

pub struct WindowsWtsSessionSource {
    dispatcher: Arc<DispatcherState>,
    ingress: Arc<Ingress>,
    candidate: WindowsCandidateSession,
    closed: bool,
    query: Option<PendingQuery>,
}

struct BatchLease(Arc<Ingress>);
impl Drop for BatchLease {
    fn drop(&mut self) {
        self.0.finish_batch();
    }
}

/// Notifications are ordered native wakeups, followed by a fresh bounded state.
/// The helper must deliver the wakeups before the reconciled state; coalescing
/// them could hide a rapid lock/unlock or disconnect/reconnect transition.
pub struct WindowsWtsSessionDrain {
    pub events: Vec<WindowsWtsSessionEvent>,
    pub state: Option<WindowsWtsSessionSnapshot>,
    pub failure: Option<PassiveStateSourceError>,
}

impl WindowsWtsSessionSource {
    /// Allows the helper to skip an idle query between bounded periodic checks.
    #[must_use]
    pub fn has_pending_input(&self) -> bool {
        if self.query.is_some()
            || self.check_active().is_err()
            || self.ingress.failed.load(Ordering::Acquire)
        {
            return true;
        }
        self.ingress
            .state
            .try_lock()
            .map_or(true, |state| !state.queue.is_empty())
    }

    /// Returns native wakeups immediately; a separately owned query worker
    /// produces complete reconciliation on a later poll under its original deadline.
    pub fn drain(&mut self, deadline: Instant) -> WindowsWtsSessionDrain {
        let _lease = BatchLease(Arc::clone(&self.ingress));
        self.drain_inner(deadline)
    }

    fn drain_inner(&mut self, deadline: Instant) -> WindowsWtsSessionDrain {
        if self.closed {
            return empty_drain();
        }
        let (notifications, lost) = match self.ingress.take(false) {
            Ok(tail) => tail,
            Err(error) => return self.fail(Vec::new(), error),
        };
        let events = minimize(self.candidate, notifications);
        if lost {
            return self.fail(events, PassiveStateSourceError::QueueOverflow);
        }
        if let Err(error) = self.check_active() {
            return self.fail(events, error);
        }
        if self.query.is_none() {
            if let Err(error) = self.start_query(deadline, 1) {
                return self.fail(events, error);
            }
            return WindowsWtsSessionDrain {
                events,
                state: None,
                failure: None,
            };
        }
        let Some(mut query) = self.query.take() else {
            return self.fail(events, backend("WTS query ownership lost"));
        };
        if !query.worker.is_finished() {
            if Instant::now() >= query.deadline {
                poison_native_source_process();
                return self.fail(
                    events,
                    PassiveStateSourceError::Cleanup(
                        "WTS query worker deadline exceeded".to_owned(),
                    ),
                );
            }
            self.query = Some(query);
            return WindowsWtsSessionDrain {
                events,
                state: None,
                failure: None,
            };
        }
        if query.worker.finish(Duration::ZERO).is_err() {
            poison_native_source_process();
            return self.fail(
                events,
                PassiveStateSourceError::Cleanup("WTS query worker completion failed".to_owned()),
            );
        }
        let snapshot = match query.result.try_recv() {
            Ok(Ok(state)) => state,
            Ok(Err(error)) => return self.fail(events, error),
            Err(_) => return self.fail(events, backend("WTS query result missing")),
        };
        if Instant::now() >= query.deadline {
            return self.fail(events, backend("WTS query deadline exceeded"));
        }
        if let Err(error) = self.check_active() {
            return self.fail(events, error);
        }
        match self.sequence() {
            Ok(sequence) if sequence == query.sequence => WindowsWtsSessionDrain {
                events,
                state: Some(snapshot),
                failure: None,
            },
            Ok(_) if query.attempts < MAX_RECONCILIATIONS => {
                if let Err(error) = self.start_query(query.deadline, query.attempts + 1) {
                    return self.fail(events, error);
                }
                WindowsWtsSessionDrain {
                    events,
                    state: None,
                    failure: None,
                }
            }
            Ok(_) => self.fail(
                events,
                backend("WTS inventory changed throughout reconciliation"),
            ),
            Err(error) => self.fail(events, error),
        }
    }

    fn start_query(
        &mut self,
        deadline: Instant,
        attempts: usize,
    ) -> Result<(), PassiveStateSourceError> {
        if Instant::now() >= deadline {
            return Err(backend("WTS query deadline exceeded"));
        }
        let sequence = self.sequence()?;
        let candidate = self.candidate;
        self.query = Some(PendingQuery::start(
            deadline,
            sequence,
            attempts,
            move || query_snapshot(candidate),
        )?);
        Ok(())
    }

    fn fail(
        &mut self,
        mut events: Vec<WindowsWtsSessionEvent>,
        mut error: PassiveStateSourceError,
    ) -> WindowsWtsSessionDrain {
        self.detach();
        if let Some(mut query) = self.query.take()
            && (!query.worker.is_finished() || query.worker.finish(Duration::ZERO).is_err())
        {
            poison_native_source_process();
            error = PassiveStateSourceError::Cleanup(
                "WTS query worker retained after source failure".to_owned(),
            );
        }
        if let Ok((tail, _)) = self.ingress.take(true) {
            events.extend(minimize(self.candidate, tail));
        }
        WindowsWtsSessionDrain {
            events,
            state: None,
            failure: Some(error),
        }
    }

    fn reconcile(
        &self,
        deadline: Instant,
    ) -> Result<(WindowsWtsSessionSnapshot, Vec<WindowsSessionNotification>), PassiveStateSourceError>
    {
        for _ in 0..MAX_RECONCILIATIONS {
            self.check_active()?;
            let before = self.sequence()?;
            let candidate = self.candidate;
            let remaining = deadline
                .checked_duration_since(Instant::now())
                .ok_or_else(|| backend("WTS query deadline exceeded"))?;
            let snapshot = run_bounded_task("prctr-wts-initial-query", remaining, move || {
                query_snapshot(candidate)
            })
            .map_err(|_| {
                poison_native_source_process();
                PassiveStateSourceError::Cleanup(
                    "WTS initial query worker completion unproved".to_owned(),
                )
            })??;
            self.check_active()?;
            if Instant::now() >= deadline {
                return Err(backend("WTS query deadline exceeded"));
            }
            let mut ingress = self
                .ingress
                .state
                .lock()
                .map_err(|_| backend("WTS source poisoned"))?;
            if self.ingress.failed.load(Ordering::Acquire) {
                return Err(PassiveStateSourceError::QueueOverflow);
            }
            if ingress.sequence == before {
                // This is a capture-bounded inventory, not a kernel producer
                // watermark. The local receipt cut orders only accepted callbacks;
                // delayed callbacks remain partial and force another full query.
                return Ok((snapshot, ingress.queue.drain(..).collect()));
            }
        }
        Err(backend("WTS inventory changed throughout reconciliation"))
    }

    fn sequence(&self) -> Result<u64, PassiveStateSourceError> {
        let state = self
            .ingress
            .state
            .lock()
            .map_err(|_| backend("WTS source poisoned"))?;
        if self.ingress.failed.load(Ordering::Acquire) {
            return Err(PassiveStateSourceError::QueueOverflow);
        }
        Ok(state.sequence)
    }

    fn check_active(&self) -> Result<(), PassiveStateSourceError> {
        ensure_usable()?;
        if self.closed
            || self.dispatcher.failed.load(Ordering::Acquire)
            || self.dispatcher.stopping.load(Ordering::Acquire)
            || !self.dispatcher.running.load(Ordering::Acquire)
        {
            return Err(backend("WTS service source invalidated"));
        }
        Ok(())
    }

    /// Fences the native subscription and returns the accepted tail before any
    /// final reconciliation failure. It never drops events merely because close failed.
    pub fn close(&mut self, deadline: Instant) -> WindowsWtsSessionDrain {
        let _lease = BatchLease(Arc::clone(&self.ingress));
        if self.closed {
            return WindowsWtsSessionDrain {
                events: Vec::new(),
                state: None,
                failure: None,
            };
        }
        let mut drain = self.drain_inner(deadline);
        while let Some(query) = &mut self.query {
            let remaining = query
                .deadline
                .min(deadline)
                .saturating_duration_since(Instant::now());
            if query.worker.finish(remaining).is_err() {
                poison_native_source_process();
                return self.fail(
                    drain.events,
                    PassiveStateSourceError::Cleanup(
                        "WTS query worker close deadline exceeded".to_owned(),
                    ),
                );
            }
            let next = self.drain_inner(deadline);
            drain.events.extend(next.events);
            drain.state = next.state;
            drain.failure = next.failure;
        }
        self.detach();
        match self.ingress.take(true) {
            Ok((tail, failed)) => {
                if failed || !tail.is_empty() {
                    drain.state = None;
                    if !matches!(drain.failure, Some(PassiveStateSourceError::Cleanup(_))) {
                        drain.failure = Some(if failed {
                            PassiveStateSourceError::QueueOverflow
                        } else {
                            backend("WTS changed across final source boundary")
                        });
                    }
                }
                drain.events.extend(minimize(self.candidate, tail));
            }
            Err(error) => {
                drain.state = None;
                if !matches!(drain.failure, Some(PassiveStateSourceError::Cleanup(_))) {
                    drain.failure = Some(error);
                }
            }
        }
        drain
    }

    fn detach(&mut self) {
        self.closed = true;
        if let Ok(mut source) = self.dispatcher.source.lock() {
            if source
                .as_ref()
                .is_some_and(|source| Arc::ptr_eq(source, &self.ingress))
            {
                *source = None;
            }
        } else {
            self.dispatcher.failed.store(true, Ordering::Release);
        }
    }
}

impl Drop for WindowsWtsSessionSource {
    fn drop(&mut self) {
        self.detach();
        if let Some(mut query) = self.query.take()
            && (!query.worker.is_finished() || query.worker.finish(Duration::ZERO).is_err())
        {
            poison_native_source_process();
        }
    }
}

fn backend(reason: &str) -> PassiveStateSourceError {
    PassiveStateSourceError::Backend(reason.to_owned())
}
fn ensure_usable() -> Result<(), PassiveStateSourceError> {
    ensure_native_source_process_usable().map_err(|_| {
        PassiveStateSourceError::Cleanup("native source process is poisoned".to_owned())
    })
}

struct QueryToken(HANDLE);
impl Drop for QueryToken {
    fn drop(&mut self) {
        // SAFETY: one token handle obtained from WTSQueryUserToken.
        if unsafe { CloseHandle(self.0) } == 0 {
            poison_native_source_process();
        }
    }
}

fn verify_candidate_logon(
    candidate: WindowsCandidateSession,
) -> Result<(), PassiveStateSourceError> {
    let mut handle = ptr::null_mut();
    // SAFETY: scalar session plus owned token output. This requires the signed
    // LocalSystem service with SeTcbPrivilege; no privilege adjustment is attempted.
    let success = unsafe { WTSQueryUserToken(candidate.session_id, &raw mut handle) } != 0;
    let token = (!handle.is_null()).then(|| QueryToken(handle));
    if !success {
        return Err(backend("authenticated session token unavailable"));
    }
    let token = token.ok_or_else(|| backend("authenticated session token unavailable"))?;
    let mut statistics = TOKEN_STATISTICS::default();
    let mut length = 0_u32;
    // SAFETY: exact TOKEN_STATISTICS output storage, used only for its logon LUID.
    let result = unsafe {
        GetTokenInformation(
            token.0,
            TokenStatistics,
            (&raw mut statistics).cast(),
            u32::try_from(mem::size_of::<TOKEN_STATISTICS>()).unwrap_or(u32::MAX),
            &raw mut length,
        )
    };
    let logon_id = (u64::from(statistics.AuthenticationId.HighPart.cast_unsigned()) << 32)
        | u64::from(statistics.AuthenticationId.LowPart);
    let valid = result != 0
        && length as usize == mem::size_of::<TOKEN_STATISTICS>()
        && logon_id == candidate.authentication_id;
    // SAFETY: erase all transient token metadata, including padding.
    for offset in 0..mem::size_of::<TOKEN_STATISTICS>() {
        unsafe {
            ptr::write_volatile((&raw mut statistics).cast::<u8>().add(offset), 0);
        }
    }
    drop(token);
    ensure_usable()?;
    if valid {
        Ok(())
    } else {
        Err(backend("authenticated logon generation changed"))
    }
}

fn empty_drain() -> WindowsWtsSessionDrain {
    WindowsWtsSessionDrain {
        events: Vec::new(),
        state: None,
        failure: None,
    }
}

fn query_snapshot(
    candidate: WindowsCandidateSession,
) -> Result<WindowsWtsSessionSnapshot, PassiveStateSourceError> {
    let capture_started_at = Instant::now();
    verify_candidate_logon(candidate)?;
    let mut state = super::windows::query_state_for(candidate.session_id)?;
    verify_candidate_logon(candidate)?;
    state.coverage = InteractiveSessionCoverage::FullLifecycle;
    state.certainty = if state.console_ownership != InteractiveConsoleOwnership::Unknown
        && state.lock_state != InteractiveLockState::Unknown
        && state.remote_attachment != InteractiveRemoteAttachment::Unknown
    {
        InteractiveSessionCertainty::Complete
    } else {
        InteractiveSessionCertainty::Partial
    };
    Ok(WindowsWtsSessionSnapshot {
        state,
        capture_started_at,
        observed_at: Instant::now(),
    })
}
