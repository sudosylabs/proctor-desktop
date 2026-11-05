//! Direct helper projection: native capture clocks are never re-stamped.

use std::collections::{BTreeMap, VecDeque};
use std::sync::{Arc, Mutex};

use native_protocol::{
    HelperFailureCode, HelperSourceFailure, HelperSourceKind, HelperSourceSnapshot,
    InteractiveSessionCertainty, InteractiveSessionCoverage, InteractiveSessionDrain,
    InteractiveSessionObservation, InteractiveSessionSourceSnapshot, MAX_PROTOCOL_SAFE_INTEGER,
    PermissionState, PlatformFamily, ProcessApplicationCertainty, ProcessApplicationCoverage,
    ProcessApplicationDrain, ProcessApplicationObservation, ProcessApplicationSourceSnapshot,
    ProtocolValidatable, SequenceGap, SourceFailureCode, SourceHealth, SourceReset,
    SourceTimestamp,
};
use native_security_helper::{
    HelperSourceCloseResult, HelperTransportError, NativeHelperConnection, NativeHelperSourceEvent,
};
use native_source_runtime::{
    ensure_native_source_process_usable, fresh_source_instance_id, poison_native_source_process,
};

use super::{
    BaselineSourceFactories, ErasedFactory, ErasedSource, NativeSourceBatch, NativeSourceKind,
    NativeSourceSnapshot, RestartBoundary, SourceParameters, SourceStartFailure, SourceStopOutcome,
    source_start_failure,
};

/// Authenticated helper connection owned by the supervisor's shared source group.
/// Methods retain the transport's absolute deadlines and validated native fences.
pub trait HelperSourceConnection: Send {
    /// Opens one generated, bounded source request.
    /// # Errors
    /// Returns the authenticated transport or source failure.
    fn open(
        &mut self,
        kind: HelperSourceKind,
        id: String,
        capacity: u16,
    ) -> Result<HelperSourceSnapshot, HelperTransportError>;
    /// Polls without treating a quiet source as a timeout.
    /// # Errors
    /// Returns a terminal transport failure.
    fn poll(&mut self) -> Result<Option<NativeHelperSourceEvent>, HelperTransportError>;
    /// Fences a source and returns its accepted tail and final snapshot.
    /// # Errors
    /// Returns a source or cleanup failure.
    fn close(&mut self, id: &str) -> Result<HelperSourceCloseResult, HelperTransportError>;
    /// Terminates the owner and proves worker exit.
    /// # Errors
    /// Returns cleanup failure when exit cannot be observed.
    fn terminate(&mut self) -> Result<(), HelperTransportError>;
}

impl HelperSourceConnection for NativeHelperConnection {
    fn open(
        &mut self,
        kind: HelperSourceKind,
        id: String,
        capacity: u16,
    ) -> Result<HelperSourceSnapshot, HelperTransportError> {
        let request = self.make_source_request(kind, id, capacity)?;
        self.open_source(&request)
    }
    fn poll(&mut self) -> Result<Option<NativeHelperSourceEvent>, HelperTransportError> {
        self.poll_event()
    }
    fn close(&mut self, id: &str) -> Result<HelperSourceCloseResult, HelperTransportError> {
        let request = self.make_source_close(id)?;
        self.close_source(&request)
    }
    fn terminate(&mut self) -> Result<(), HelperTransportError> {
        self.close_connection()
    }
}

struct Inbox {
    kind: HelperSourceKind,
    capacity: usize,
    events: VecDeque<NativeHelperSourceEvent>,
}
struct SharedConnection {
    connect:
        Box<dyn FnMut() -> Result<Box<dyn HelperSourceConnection>, HelperTransportError> + Send>,
    connection: Option<Box<dyn HelperSourceConnection>>,
    sources: BTreeMap<String, Inbox>,
    failure: Option<SourceFailureCode>,
}

impl SharedConnection {
    fn fail(&mut self, error: &HelperTransportError) -> SourceFailureCode {
        let code = transport_failure(error);
        self.failure = Some(code);
        if code == SourceFailureCode::Cleanup {
            poison_native_source_process();
        }
        code
    }
    fn route(&mut self, event: NativeHelperSourceEvent) -> Result<(), HelperTransportError> {
        let (id, kind) = match &event {
            NativeHelperSourceEvent::Observation(event) => {
                (&event.helper_source_instance_id, event.source_kind)
            }
            NativeHelperSourceEvent::Failure(event) => {
                (&event.helper_source_instance_id, event.source_kind)
            }
        };
        let inbox = self
            .sources
            .get_mut(id)
            .ok_or(HelperTransportError::ConnectionFenced)?;
        if inbox.kind != kind || inbox.events.len() > inbox.capacity {
            return Err(HelperTransportError::ConnectionFenced);
        }
        inbox.events.push_back(event);
        Ok(())
    }
    fn pump(&mut self) {
        if self.failure.is_some() {
            return;
        }
        let budget = self
            .sources
            .values()
            .map(|source| source.capacity + 1)
            .sum::<usize>();
        for _ in 0..budget {
            if self
                .sources
                .values()
                .any(|source| source.events.len() >= source.capacity)
            {
                break;
            }
            let Some(connection) = self.connection.as_mut() else {
                break;
            };
            match connection.poll() {
                Ok(Some(event)) => {
                    if let Err(error) = self.route(event) {
                        self.fail(&error);
                        break;
                    }
                }
                Ok(None) => break,
                Err(error) => {
                    self.fail(&error);
                    break;
                }
            }
        }
    }
    fn terminate_last(&mut self) -> bool {
        if !self.sources.is_empty() {
            return true;
        }
        let result = self
            .connection
            .take()
            .is_none_or(|mut connection| connection.terminate().is_ok());
        if result {
            self.failure = None;
        } else {
            self.failure = Some(SourceFailureCode::Cleanup);
            poison_native_source_process();
        }
        result
    }
}

struct HelperFactory {
    shared: Arc<Mutex<SharedConnection>>,
    kind: HelperSourceKind,
    platform: PlatformFamily,
    adapter_version: String,
}

impl BaselineSourceFactories {
    /// Replaces process/session snapshot adapters with one shared authenticated helper.
    /// No connection is opened until a selected source is started.
    #[must_use]
    pub fn with_helper_sources<F, C>(
        mut self,
        platform: PlatformFamily,
        adapter_version: &str,
        mut connect: F,
    ) -> Self
    where
        F: FnMut() -> Result<C, HelperTransportError> + Send + 'static,
        C: HelperSourceConnection + 'static,
    {
        let shared = Arc::new(Mutex::new(SharedConnection {
            connect: Box::new(move || {
                connect().map(|connection| Box::new(connection) as Box<dyn HelperSourceConnection>)
            }),
            connection: None,
            sources: BTreeMap::new(),
            failure: None,
        }));
        for (kind, factory) in &mut self.manifest_order {
            let helper_kind = match kind {
                NativeSourceKind::ProcessApplication => HelperSourceKind::ProcessApplication,
                NativeSourceKind::InteractiveSession => HelperSourceKind::InteractiveSession,
                _ => continue,
            };
            *factory = Box::new(HelperFactory {
                shared: Arc::clone(&shared),
                kind: helper_kind,
                platform,
                adapter_version: adapter_version.to_owned(),
            });
        }
        self
    }
}

impl ErasedFactory for HelperFactory {
    fn open(
        &mut self,
        parameters: &SourceParameters,
        restart: Option<RestartBoundary>,
    ) -> Result<Box<dyn ErasedSource>, SourceStartFailure> {
        ensure_native_source_process_usable()
            .map_err(|_| source_start_failure(SourceFailureCode::Cleanup))?;
        parameters
            .request()
            .validate_protocol()
            .map_err(|_| source_start_failure(SourceFailureCode::Protocol))?;
        // Reserve the restart and terminal-loss resets, then split retained
        // observation capacity between the outer inbox and helper close tail.
        // The macOS lifecycle core itself needs four slots including its controls.
        if parameters.queue_capacity < 10 {
            return Err(source_start_failure(SourceFailureCode::Protocol));
        }
        let helper_capacity = (parameters.queue_capacity - 2) / 2;
        let mut shared = self
            .shared
            .try_lock()
            .map_err(|error| lock_failure(&error))?;
        if let Some(code) = shared.failure {
            return Err(source_start_failure(code));
        }
        if shared.connection.is_none() {
            let connection =
                (shared.connect)().map_err(|error| source_start_failure(shared.fail(&error)))?;
            shared.connection = Some(connection);
        }
        let id = fresh_source_instance_id();
        let result = shared
            .connection
            .as_mut()
            .ok_or_else(|| source_start_failure(SourceFailureCode::Backend))?
            .open(self.kind, id.clone(), helper_capacity);
        let snapshot = match result {
            Ok(snapshot) => snapshot,
            Err(error) => {
                let code = shared.fail(&error);
                let closed = shared.terminate_last();
                return Err(source_start_failure(if closed {
                    code
                } else {
                    SourceFailureCode::Cleanup
                }));
            }
        };
        let native = project_snapshot(
            &snapshot,
            self.platform,
            &self.adapter_version,
            SourceHealth::Healthy,
            0,
        )
        .filter(|_| {
            snapshot.helper_source_instance_id == id
                && snapshot.source_kind == self.kind
                && snapshot.last_sequence == 0
        });
        let Some(native) = native else {
            shared.failure = Some(SourceFailureCode::Protocol);
            let closed = shared
                .connection
                .as_mut()
                .is_some_and(|connection| connection.close(&id).is_ok());
            let terminated = shared.terminate_last();
            if !closed || !terminated {
                poison_native_source_process();
            }
            return Err(source_start_failure(if closed && terminated {
                SourceFailureCode::Protocol
            } else {
                SourceFailureCode::Cleanup
            }));
        };
        shared.sources.insert(
            id.clone(),
            Inbox {
                kind: self.kind,
                capacity: usize::from(helper_capacity),
                events: VecDeque::new(),
            },
        );
        let mut source = HelperSource {
            shared: Arc::clone(&self.shared),
            kind: self.kind,
            id,
            platform: self.platform,
            adapter_version: self.adapter_version.clone(),
            health: native.health(),
            snapshot: native,
            failure: None,
            stopped: false,
            offset: 0,
            sequence: 0,
            pending_resets: Vec::new(),
        };
        if let Some(restart) = restart {
            source.install_restart(restart, snapshot.monotonic_time_ns);
        }
        Ok(Box::new(source))
    }
}

struct HelperSource {
    shared: Arc<Mutex<SharedConnection>>,
    kind: HelperSourceKind,
    id: String,
    platform: PlatformFamily,
    adapter_version: String,
    snapshot: NativeSourceSnapshot,
    health: SourceHealth,
    failure: Option<SourceFailureCode>,
    stopped: bool,
    offset: u64,
    sequence: u64,
    pending_resets: Vec<SourceReset>,
}

impl HelperSource {
    fn install_restart(&mut self, restart: RestartBoundary, monotonic_time_ns: u64) {
        // Only the outer source sequence accounts for the source-owned reset.
        // Helper fences still validate the original helper sequence and clock.
        self.offset = restart.missing_count + 1;
        self.sequence = self.offset;
        self.pending_resets.push(SourceReset {
            source_instance_id: self.id.clone(),
            sequence: self.offset,
            observed_at: SourceTimestamp { monotonic_time_ns },
            gap: Some(SequenceGap {
                first_missing: 1,
                last_missing: restart.missing_count,
            }),
            reason: restart.reason.to_owned(),
        });
    }
    fn record_failure(&mut self, failure: &HelperSourceFailure) -> Option<SourceReset> {
        if self.failure != Some(SourceFailureCode::Cleanup) {
            self.failure = Some(source_failure(failure.failure_code));
        }
        let count = failure.lost_event_count?;
        let Some((last, sequence)) = self
            .sequence
            .checked_add(count)
            .and_then(|last| last.checked_add(1).map(|sequence| (last, sequence)))
            .filter(|(_, sequence)| *sequence <= MAX_PROTOCOL_SAFE_INTEGER)
        else {
            if self.failure != Some(SourceFailureCode::Cleanup) {
                self.failure = Some(SourceFailureCode::Protocol);
            }
            return None;
        };
        let reset = SourceReset {
            source_instance_id: self.id.clone(),
            sequence,
            observed_at: SourceTimestamp {
                monotonic_time_ns: failure.monotonic_time_ns,
            },
            gap: Some(SequenceGap {
                first_missing: self.sequence + 1,
                last_missing: last,
            }),
            reason: "native-helper-event-loss".to_owned(),
        };
        self.sequence = sequence;
        Some(reset)
    }

    fn batch(&mut self, events: Vec<NativeHelperSourceEvent>) -> NativeSourceBatch {
        let mut process = Vec::new();
        let mut session = Vec::new();
        let mut resets = std::mem::take(&mut self.pending_resets);
        for event in events {
            match event {
                NativeHelperSourceEvent::Observation(event) => {
                    let Some(sequence) = event
                        .sequence
                        .checked_add(self.offset)
                        .filter(|value| *value <= MAX_PROTOCOL_SAFE_INTEGER)
                    else {
                        self.failure = Some(SourceFailureCode::Protocol);
                        break;
                    };
                    self.sequence = sequence;
                    let observed_at = SourceTimestamp {
                        monotonic_time_ns: event.monotonic_time_ns,
                    };
                    match (event.process_event, event.interactive_session_event) {
                        (Some(event), None)
                            if self.kind == HelperSourceKind::ProcessApplication =>
                        {
                            if !self.stopped
                                && let Some(state) = &event.state
                            {
                                self.health =
                                    if state.certainty == ProcessApplicationCertainty::Complete {
                                        SourceHealth::Healthy
                                    } else {
                                        SourceHealth::Degraded
                                    };
                            }
                            process.push(ProcessApplicationObservation {
                                source_instance_id: self.id.clone(),
                                sequence,
                                observed_at,
                                gap: None,
                                event,
                            });
                        }
                        (None, Some(event))
                            if self.kind == HelperSourceKind::InteractiveSession =>
                        {
                            if !self.stopped {
                                self.health = if event.state.certainty
                                    == InteractiveSessionCertainty::Complete
                                {
                                    SourceHealth::Healthy
                                } else {
                                    SourceHealth::Degraded
                                };
                            }
                            session.push(InteractiveSessionObservation {
                                source_instance_id: self.id.clone(),
                                sequence,
                                observed_at,
                                gap: None,
                                event,
                            });
                        }
                        _ => {
                            self.failure = Some(SourceFailureCode::Protocol);
                            break;
                        }
                    }
                }
                NativeHelperSourceEvent::Failure(failure) => {
                    if let Some(reset) = self.record_failure(&failure) {
                        if process.is_empty() && session.is_empty() {
                            resets.push(reset);
                        } else {
                            // A reset follows the accepted observations on the
                            // source clock. The wire contract requires it in a
                            // subsequent batch, never before those facts.
                            self.pending_resets.push(reset);
                        }
                    }
                }
            }
        }
        if self.failure.is_some() {
            self.health = SourceHealth::Failed;
        }
        match self.kind {
            HelperSourceKind::ProcessApplication => {
                NativeSourceBatch::ProcessApplication(ProcessApplicationDrain {
                    source_instance_id: self.id.clone(),
                    health: self.health,
                    terminal_error: self.failure,
                    observations: process,
                    resets,
                })
            }
            HelperSourceKind::InteractiveSession => {
                NativeSourceBatch::InteractiveSession(InteractiveSessionDrain {
                    source_instance_id: self.id.clone(),
                    health: self.health,
                    terminal_error: self.failure,
                    observations: session,
                    resets,
                })
            }
        }
    }
}

impl ErasedSource for HelperSource {
    fn kind(&self) -> NativeSourceKind {
        match self.kind {
            HelperSourceKind::ProcessApplication => NativeSourceKind::ProcessApplication,
            HelperSourceKind::InteractiveSession => NativeSourceKind::InteractiveSession,
        }
    }
    fn snapshot(&self) -> NativeSourceSnapshot {
        self.snapshot.clone()
    }
    fn health(&self) -> SourceHealth {
        self.health
    }
    fn drain(&mut self) -> NativeSourceBatch {
        if !self.pending_resets.is_empty() {
            return self.batch(Vec::new());
        }
        let shared_arc = Arc::clone(&self.shared);
        let events = match shared_arc.try_lock() {
            Ok(mut shared) if !self.stopped => {
                shared.pump();
                self.failure = self.failure.or(shared.failure);
                shared
                    .sources
                    .get_mut(&self.id)
                    .map_or_else(Vec::new, |inbox| inbox.events.drain(..).collect())
            }
            Ok(_) | Err(std::sync::TryLockError::WouldBlock) => Vec::new(),
            Err(std::sync::TryLockError::Poisoned(_)) => {
                poison_native_source_process();
                self.failure = Some(SourceFailureCode::Cleanup);
                Vec::new()
            }
        };
        self.batch(events)
    }
    fn stop(&mut self) -> SourceStopOutcome {
        if self.stopped {
            return SourceStopOutcome {
                preceding_batches: Vec::new(),
                final_snapshot: None,
                batch: self.batch(Vec::new()),
                closed_input_boundary: self.failure != Some(SourceFailureCode::Cleanup),
            };
        }
        // Native batches permit one reset. Keep an undelivered restart fence
        // ahead of the close tail, which may carry its own terminal-loss reset.
        let mut preceding_batches = if self.pending_resets.is_empty() {
            Vec::new()
        } else {
            vec![self.batch(Vec::new())]
        };
        self.stopped = true;
        let shared_arc = Arc::clone(&self.shared);
        let mut events = Vec::new();
        let mut closed = false;
        let mut final_snapshot = None;
        if let Ok(mut shared) = shared_arc.try_lock() {
            if let Some(inbox) = shared.sources.get_mut(&self.id) {
                events.extend(inbox.events.drain(..));
            }
            if let Some(connection) = shared.connection.as_mut() {
                match connection.close(&self.id) {
                    Ok(result) => {
                        events.extend(result.events);
                        if let Some(snapshot) = project_snapshot(
                            &result.final_snapshot,
                            self.platform,
                            &self.adapter_version,
                            SourceHealth::Stopped,
                            self.offset,
                        )
                        .filter(|_| {
                            result.final_snapshot.helper_source_instance_id == self.id
                                && result.final_snapshot.source_kind == self.kind
                        }) {
                            self.snapshot = snapshot;
                            final_snapshot = Some(self.snapshot.clone());
                            closed = true;
                        } else {
                            self.failure = Some(SourceFailureCode::Protocol);
                        }
                    }
                    Err(error) => {
                        // A protocol failure may already have killed the whole
                        // worker. Distinguish that proved input boundary from
                        // an unobserved exit; the source still reports failure.
                        closed = connection.terminate().is_ok();
                        self.failure = Some(shared.fail(&error));
                    }
                }
            }
            shared.sources.remove(&self.id);
            closed &= shared.terminate_last();
        }
        if !closed {
            self.failure = Some(SourceFailureCode::Cleanup);
            poison_native_source_process();
        }
        self.health = if self.failure.is_some() {
            SourceHealth::Failed
        } else {
            SourceHealth::Stopped
        };
        let mut batch = self.batch(events);
        if !self.pending_resets.is_empty() {
            preceding_batches.push(batch);
            batch = self.batch(Vec::new());
        }
        if let Some(snapshot) = &mut final_snapshot {
            match snapshot {
                NativeSourceSnapshot::ProcessApplication(snapshot) => {
                    snapshot.health = self.health;
                    snapshot.sequence = snapshot.sequence.max(self.sequence);
                }
                NativeSourceSnapshot::InteractiveSession(snapshot) => {
                    snapshot.health = self.health;
                    snapshot.sequence = snapshot.sequence.max(self.sequence);
                }
                _ => {}
            }
        }
        SourceStopOutcome {
            preceding_batches,
            final_snapshot,
            batch,
            closed_input_boundary: closed,
        }
    }
}
impl Drop for HelperSource {
    fn drop(&mut self) {
        if !self.stopped {
            let _ = self.stop();
        }
    }
}

fn lock_failure<T>(error: &std::sync::TryLockError<T>) -> SourceStartFailure {
    if matches!(error, std::sync::TryLockError::Poisoned(_)) {
        poison_native_source_process();
        source_start_failure(SourceFailureCode::Cleanup)
    } else {
        source_start_failure(SourceFailureCode::Backend)
    }
}

#[cfg(test)]
fn schema(kind: HelperSourceKind) -> u16 {
    match kind {
        HelperSourceKind::ProcessApplication => native_protocol::PROCESS_APPLICATION_SCHEMA_VERSION,
        HelperSourceKind::InteractiveSession => native_protocol::INTERACTIVE_SESSION_SCHEMA_VERSION,
    }
}
fn source_failure(code: HelperFailureCode) -> SourceFailureCode {
    match code {
        HelperFailureCode::Cleanup => SourceFailureCode::Cleanup,
        HelperFailureCode::Protocol => SourceFailureCode::Protocol,
        HelperFailureCode::QueueOverflow => SourceFailureCode::QueueOverflow,
        HelperFailureCode::InventoryOverflow => SourceFailureCode::InventoryOverflow,
        HelperFailureCode::PermissionLost
        | HelperFailureCode::NativeEventLoss
        | HelperFailureCode::Backend => SourceFailureCode::Backend,
    }
}
fn transport_failure(error: &HelperTransportError) -> SourceFailureCode {
    match error {
        HelperTransportError::ChildTermination | HelperTransportError::UtilityPoisoned => {
            SourceFailureCode::Cleanup
        }
        HelperTransportError::SourceFailure(failure) => source_failure(failure.failure_code),
        HelperTransportError::Protocol(_)
        | HelperTransportError::Wire(_)
        | HelperTransportError::Json(_) => SourceFailureCode::Protocol,
        _ => SourceFailureCode::Backend,
    }
}

fn project_snapshot(
    snapshot: &HelperSourceSnapshot,
    platform: PlatformFamily,
    adapter: &str,
    health: SourceHealth,
    offset: u64,
) -> Option<NativeSourceSnapshot> {
    snapshot.validate_protocol().ok()?;
    let sequence = snapshot
        .last_sequence
        .checked_add(offset)
        .filter(|sequence| *sequence <= MAX_PROTOCOL_SAFE_INTEGER)?;
    let observed_at = SourceTimestamp {
        monotonic_time_ns: snapshot.monotonic_time_ns,
    };
    let health = if health == SourceHealth::Healthy
        && (snapshot
            .process_state
            .as_ref()
            .is_some_and(|state| state.certainty != ProcessApplicationCertainty::Complete)
            || snapshot
                .interactive_session_state
                .as_ref()
                .is_some_and(|state| state.certainty != InteractiveSessionCertainty::Complete))
    {
        SourceHealth::Degraded
    } else {
        health
    };
    let result = match snapshot.source_kind {
        HelperSourceKind::ProcessApplication => {
            let state = snapshot.process_state.clone()?;
            let permission = if state.coverage == ProcessApplicationCoverage::Unavailable {
                PermissionState::Unavailable
            } else {
                PermissionState::Granted
            };
            NativeSourceSnapshot::ProcessApplication(ProcessApplicationSourceSnapshot {
                source_instance_id: snapshot.helper_source_instance_id.clone(),
                source_version: "helper-source-0.1.0".to_owned(),
                adapter_version: adapter.to_owned(),
                schema_version: snapshot.schema_version,
                platform,
                permission,
                health,
                sequence,
                observed_at,
                state,
            })
        }
        HelperSourceKind::InteractiveSession => {
            let state = snapshot.interactive_session_state.clone()?;
            let permission = if state.coverage == InteractiveSessionCoverage::Unavailable {
                PermissionState::Unavailable
            } else {
                PermissionState::Granted
            };
            NativeSourceSnapshot::InteractiveSession(InteractiveSessionSourceSnapshot {
                source_instance_id: snapshot.helper_source_instance_id.clone(),
                source_version: "helper-source-0.1.0".to_owned(),
                adapter_version: adapter.to_owned(),
                schema_version: snapshot.schema_version,
                platform,
                permission,
                health,
                sequence,
                observed_at,
                state,
            })
        }
    };
    match &result {
        NativeSourceSnapshot::ProcessApplication(snapshot) => snapshot.validate_protocol().ok()?,
        NativeSourceSnapshot::InteractiveSession(snapshot) => snapshot.validate_protocol().ok()?,
        _ => return None,
    }
    Some(result)
}

#[cfg(test)]
mod tests {
    use super::*;
    use interactive_session_state::InteractiveSessionWire;
    use native_protocol::{
        HelperObservation, InteractiveSessionEvent, InteractiveSessionEventKind,
        ProcessApplicationEvent, ProcessApplicationEventKind, ProcessApplicationState,
    };
    use native_source_runtime::PassiveStateWire;

    #[derive(Default)]
    struct Script {
        events: VecDeque<NativeHelperSourceEvent>,
        sources: BTreeMap<String, HelperSourceSnapshot>,
        closed: Vec<String>,
        terminated: usize,
        late_close: bool,
        close_count: u64,
        close_loss: bool,
        fail_termination: bool,
    }
    struct Connection(Arc<Mutex<Script>>);
    impl HelperSourceConnection for Connection {
        fn open(
            &mut self,
            kind: HelperSourceKind,
            id: String,
            capacity: u16,
        ) -> Result<HelperSourceSnapshot, HelperTransportError> {
            assert_eq!(capacity, 4);
            let snapshot = snapshot(kind, &id);
            self.0.lock().unwrap().sources.insert(id, snapshot.clone());
            Ok(snapshot)
        }
        fn poll(&mut self) -> Result<Option<NativeHelperSourceEvent>, HelperTransportError> {
            let mut script = self.0.lock().unwrap();
            let event = script.events.pop_front();
            if let Some(NativeHelperSourceEvent::Observation(observation)) = &event {
                script
                    .sources
                    .get_mut(&observation.helper_source_instance_id)
                    .unwrap()
                    .last_sequence = observation.sequence;
            }
            Ok(event)
        }
        fn close(&mut self, id: &str) -> Result<HelperSourceCloseResult, HelperTransportError> {
            let mut script = self.0.lock().unwrap();
            script.closed.push(id.to_owned());
            let mut final_snapshot = script.sources.remove(id).unwrap();
            final_snapshot.monotonic_time_ns = 250;
            let mut events = if script.late_close {
                let count = script.close_count.max(1);
                let first = final_snapshot.last_sequence + 1;
                final_snapshot.last_sequence += count;
                (first..=final_snapshot.last_sequence)
                    .map(|sequence| observation(&final_snapshot, sequence))
                    .collect()
            } else {
                Vec::new()
            };
            if script.close_loss {
                events.push(NativeHelperSourceEvent::Failure(HelperSourceFailure {
                    channel_nonce: "a".repeat(64),
                    helper_source_instance_id: id.to_owned(),
                    source_kind: final_snapshot.source_kind,
                    failure_code: HelperFailureCode::QueueOverflow,
                    last_sequence: final_snapshot.last_sequence,
                    lost_event_count: Some(1),
                    monotonic_time_ns: 250,
                }));
            }
            Ok(HelperSourceCloseResult {
                events,
                final_snapshot,
            })
        }
        fn terminate(&mut self) -> Result<(), HelperTransportError> {
            let mut script = self.0.lock().unwrap();
            assert!(script.sources.is_empty());
            script.terminated += 1;
            if script.fail_termination {
                Err(HelperTransportError::ChildTermination)
            } else {
                Ok(())
            }
        }
    }
    fn snapshot(kind: HelperSourceKind, id: &str) -> HelperSourceSnapshot {
        HelperSourceSnapshot {
            channel_nonce: "a".repeat(64),
            helper_source_instance_id: id.to_owned(),
            source_kind: kind,
            schema_version: schema(kind),
            last_sequence: 0,
            monotonic_time_ns: 100,
            process_state: (kind == HelperSourceKind::ProcessApplication).then(|| {
                ProcessApplicationState {
                    coverage: ProcessApplicationCoverage::FullLifecycle,
                    certainty: ProcessApplicationCertainty::Complete,
                    processes: Vec::new(),
                }
            }),
            interactive_session_state: (kind == HelperSourceKind::InteractiveSession)
                .then(InteractiveSessionWire::unavailable_state),
        }
    }
    fn observation(snapshot: &HelperSourceSnapshot, sequence: u64) -> NativeHelperSourceEvent {
        NativeHelperSourceEvent::Observation(Box::new(HelperObservation {
            channel_nonce: "a".repeat(64),
            helper_source_instance_id: snapshot.helper_source_instance_id.clone(),
            source_kind: snapshot.source_kind,
            sequence,
            monotonic_time_ns: 200,
            process_event: snapshot
                .process_state
                .clone()
                .map(|state| ProcessApplicationEvent {
                    kind: ProcessApplicationEventKind::Reconciled,
                    capture_delay_ns: Some(75),
                    process_instance_id: None,
                    process: None,
                    state: Some(state),
                }),
            interactive_session_event: snapshot.interactive_session_state.clone().map(|state| {
                InteractiveSessionEvent {
                    kind: InteractiveSessionEventKind::Reconciled,
                    state,
                }
            }),
        }))
    }
    fn factory(script: &Arc<Mutex<Script>>, kind: HelperSourceKind) -> HelperFactory {
        let connection = Arc::clone(script);
        HelperFactory {
            shared: Arc::new(Mutex::new(SharedConnection {
                connect: Box::new(move || Ok(Box::new(Connection(Arc::clone(&connection))))),
                connection: None,
                sources: BTreeMap::new(),
                failure: None,
            })),
            kind,
            platform: PlatformFamily::Macos,
            adapter_version: "test-helper-adapter".to_owned(),
        }
    }
    fn parameters() -> SourceParameters {
        SourceParameters {
            collection_session_id: "collection-session-0001".to_owned(),
            queue_capacity: 10,
        }
    }

    #[test]
    fn quiet_poll_preserves_snapshot_and_native_capture_clock() {
        let script = Arc::new(Mutex::new(Script::default()));
        let mut factory = factory(&script, HelperSourceKind::ProcessApplication);
        let mut source = factory.open(&parameters(), None).unwrap();
        let NativeSourceSnapshot::ProcessApplication(initial) = source.snapshot() else {
            panic!("process");
        };
        assert_eq!(initial.sequence, 0);
        assert_eq!(initial.observed_at.monotonic_time_ns, 100);
        assert!(source.drain().terminal_error().is_none());
        let initial_helper = script.lock().unwrap().sources[&initial.source_instance_id].clone();
        script
            .lock()
            .unwrap()
            .events
            .push_back(observation(&initial_helper, 1));
        let NativeSourceBatch::ProcessApplication(batch) = source.drain() else {
            panic!("process");
        };
        assert_eq!(batch.observations.len(), 1);
        assert_eq!(batch.observations[0].sequence, 1);
        assert_eq!(batch.observations[0].observed_at.monotonic_time_ns, 200);
        assert_eq!(batch.observations[0].event.capture_delay_ns, Some(75));
        assert!(source.stop().closed_input_boundary);
        assert_eq!(script.lock().unwrap().terminated, 1);
    }

    #[test]
    fn shared_sources_route_independently_and_stop_owner_only_after_both_close() {
        let script = Arc::new(Mutex::new(Script::default()));
        let mut process_factory = factory(&script, HelperSourceKind::ProcessApplication);
        let mut session_factory = HelperFactory {
            shared: Arc::clone(&process_factory.shared),
            kind: HelperSourceKind::InteractiveSession,
            platform: PlatformFamily::Macos,
            adapter_version: "test-helper-adapter".to_owned(),
        };
        let mut process = process_factory.open(&parameters(), None).unwrap();
        let mut session = session_factory.open(&parameters(), None).unwrap();
        let process_id = process.snapshot().source_instance_id().to_owned();
        let session_id = session.snapshot().source_instance_id().to_owned();
        {
            let mut script = script.lock().unwrap();
            let first = observation(&script.sources[&session_id], 1);
            let second = observation(&script.sources[&process_id], 1);
            script.events.extend([first, second]);
        }
        let NativeSourceBatch::ProcessApplication(batch) = process.drain() else {
            panic!("process");
        };
        assert_eq!(batch.observations.len(), 1);
        let NativeSourceBatch::InteractiveSession(batch) = session.drain() else {
            panic!("session");
        };
        assert_eq!(batch.observations[0].source_instance_id, session_id);
        assert!(session.stop().final_snapshot.is_some());
        assert_eq!(script.lock().unwrap().terminated, 0);
        assert!(process.stop().final_snapshot.is_some());
        assert_eq!(script.lock().unwrap().terminated, 1);
    }

    #[test]
    fn close_delivers_late_tail_and_final_state_with_restart_offset_only() {
        let script = Arc::new(Mutex::new(Script {
            late_close: true,
            ..Script::default()
        }));
        let mut factory = factory(&script, HelperSourceKind::ProcessApplication);
        let mut source = factory
            .open(
                &parameters(),
                Some(RestartBoundary {
                    missing_count: 1,
                    reason: "supervised-source-restart",
                }),
            )
            .unwrap();
        let stopped = source.stop();
        let NativeSourceBatch::ProcessApplication(batch) = stopped.batch else {
            panic!("process");
        };
        let NativeSourceBatch::ProcessApplication(reset_batch) = &stopped.preceding_batches[0]
        else {
            panic!("reset batch");
        };
        assert_eq!(reset_batch.resets[0].sequence, 2);
        assert_eq!(reset_batch.resets[0].gap.as_ref().unwrap().first_missing, 1);
        reset_batch.validate_protocol().unwrap();
        assert_eq!(batch.observations[0].sequence, 3);
        assert_eq!(batch.observations[0].observed_at.monotonic_time_ns, 200);
        assert_eq!(batch.observations[0].event.capture_delay_ns, Some(75));
        let Some(NativeSourceSnapshot::ProcessApplication(final_snapshot)) = stopped.final_snapshot
        else {
            panic!("final state");
        };
        assert_eq!(final_snapshot.sequence, 3);
        assert_eq!(final_snapshot.observed_at.monotonic_time_ns, 250);
        assert_eq!(final_snapshot.health, SourceHealth::Stopped);
        assert!(stopped.closed_input_boundary);
    }

    #[test]
    fn helper_budget_rejects_before_connecting_when_controls_cannot_fit() {
        let script = Arc::new(Mutex::new(Script::default()));
        let mut factory = factory(&script, HelperSourceKind::ProcessApplication);
        let mut parameters = parameters();
        parameters.queue_capacity = 9;
        assert!(matches!(
            factory.open(&parameters, None),
            Err(SourceStartFailure {
                code: SourceFailureCode::Protocol,
                ..
            })
        ));
        assert!(factory.shared.lock().unwrap().connection.is_none());
        assert!(script.lock().unwrap().sources.is_empty());
    }

    #[test]
    fn retained_inbox_and_late_close_tail_fit_one_source_budget() {
        let script = Arc::new(Mutex::new(Script {
            late_close: true,
            close_count: 4,
            close_loss: true,
            ..Script::default()
        }));
        let mut process_factory = factory(&script, HelperSourceKind::ProcessApplication);
        let mut session_factory = HelperFactory {
            shared: Arc::clone(&process_factory.shared),
            kind: HelperSourceKind::InteractiveSession,
            platform: PlatformFamily::Macos,
            adapter_version: "test-helper-adapter".to_owned(),
        };
        let mut process = process_factory
            .open(
                &parameters(),
                Some(RestartBoundary {
                    missing_count: 1,
                    reason: "supervised-source-restart",
                }),
            )
            .unwrap();
        let mut session = session_factory.open(&parameters(), None).unwrap();
        let id = process.snapshot().source_instance_id().to_owned();
        {
            let mut script = script.lock().unwrap();
            let snapshot = script.sources[&id].clone();
            script
                .events
                .extend((1..=4).map(|sequence| observation(&snapshot, sequence)));
        }
        // Polling the other source must retain these facts rather than consume
        // or overwrite them, and must stop at the shared inbox's fixed bound.
        let NativeSourceBatch::InteractiveSession(batch) = session.drain() else {
            panic!("session");
        };
        assert!(batch.observations.is_empty());
        let stopped = process.stop();
        let NativeSourceBatch::ProcessApplication(batch) = stopped.batch else {
            panic!("process");
        };
        assert_eq!(stopped.preceding_batches.len(), 2);
        let NativeSourceBatch::ProcessApplication(reset_batch) = &stopped.preceding_batches[0]
        else {
            panic!("reset batch");
        };
        let NativeSourceBatch::ProcessApplication(observations) = &stopped.preceding_batches[1]
        else {
            panic!("observation batch");
        };
        assert_eq!(observations.observations.len(), 8);
        assert_eq!(
            observations
                .observations
                .iter()
                .map(|event| event.sequence)
                .collect::<Vec<_>>(),
            (3..=10).collect::<Vec<_>>()
        );
        assert!(observations.resets.is_empty());
        assert!(batch.observations.is_empty());
        assert_eq!(reset_batch.resets.len(), 1);
        assert_eq!(batch.resets.len(), 1);
        assert_eq!(
            reset_batch.resets.len() + observations.observations.len() + batch.resets.len(),
            usize::from(parameters().queue_capacity)
        );
        assert_eq!(reset_batch.resets[0].sequence, 2);
        assert_eq!(batch.resets[0].sequence, 12);
        assert_eq!(batch.resets[0].gap.as_ref().unwrap().first_missing, 11);
        assert_eq!(batch.terminal_error, Some(SourceFailureCode::QueueOverflow));
        assert!(
            observations
                .observations
                .iter()
                .all(|event| event.observed_at.monotonic_time_ns == 200
                    && event.event.capture_delay_ns == Some(75))
        );
        reset_batch.validate_protocol().unwrap();
        observations.validate_protocol().unwrap();
        batch.validate_protocol().unwrap();
        assert!(stopped.closed_input_boundary);
        assert!(session.stop().closed_input_boundary);
    }

    #[test]
    fn failed_worker_stop_poisons_before_another_source_can_open() {
        const KEY: &str = "TEST_SHARED_HELPER_STOP_FAILURE";
        if std::env::var_os(KEY).is_none() {
            let result = std::process::Command::new(std::env::current_exe().unwrap()).arg("--exact").arg("helper_sources::tests::failed_worker_stop_poisons_before_another_source_can_open").env(KEY, "1").status().unwrap();
            assert!(result.success());
            return;
        }
        let script = Arc::new(Mutex::new(Script {
            fail_termination: true,
            ..Script::default()
        }));
        let mut factory = factory(&script, HelperSourceKind::ProcessApplication);
        let mut source = factory.open(&parameters(), None).unwrap();
        let stopped = source.stop();
        assert!(!stopped.closed_input_boundary);
        assert_eq!(
            stopped.batch.terminal_error(),
            Some(SourceFailureCode::Cleanup)
        );
        assert!(stopped.final_snapshot.is_some());
        assert!(ensure_native_source_process_usable().is_err());
        assert!(factory.open(&parameters(), None).is_err());
    }
}
