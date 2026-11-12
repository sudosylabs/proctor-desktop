//! The agent's single core thread: the handshake, requests from Electron main, source events, the
//! heartbeat and recovery ticks. It owns the engine and every source.

use std::collections::BTreeMap;
use std::collections::hash_map::RandomState;
use std::hash::{BuildHasher, Hasher};
use std::io::Write;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{Receiver, RecvTimeoutError, Sender};
use std::time::{Duration, Instant};

use prctr_core::{
    CoreError, Engine, InitialState, Input, Numbered, Registry, Sink, Source, SourceEvent,
};
use prctr_protocol::facts::Fact;
use prctr_protocol::messages::{
    AgentMessage, FatalCode, MainMessage, Notification, RefusalCode, Request, Response,
};
use prctr_protocol::rules::Policy;
use prctr_protocol::scalars::{BuildIdentity, Count, Digest, Identifier, OpaqueId};

use crate::diagnostic::{Diagnostic, emit};
use crate::transport::Writer;

pub const HEARTBEAT_INTERVAL: Duration = Duration::from_secs(1);
pub const HANDSHAKE_TIMEOUT: Duration = Duration::from_secs(5);

/// Everything the core thread reacts to.
pub enum Event {
    Main(Box<MainMessage>),
    MainClosed,
    MainInvalid,
    Source(Identifier, SourceEvent),
}

/// How the agent stops.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Exit {
    /// Electron main closed the pipe.
    Closed,
    /// The handshake or a frame was invalid.
    Protocol,
}

pub struct Agent<W: Write> {
    engine: Engine,
    sources: BTreeMap<Identifier, Box<dyn Source>>,
    pending: BTreeMap<Identifier, Arc<AtomicBool>>,
    events: Sender<Event>,
    writer: Writer<W>,
    started: Instant,
    build_identity: BuildIdentity,
    protocol_digest: Digest,
    random: RandomState,
    instances: u64,
}

impl<W: Write> Agent<W> {
    /// # Panics
    /// Panics when the compiled build identity or protocol digest is malformed (a build error).
    pub fn new(
        sources: Vec<Box<dyn Source>>,
        events: Sender<Event>,
        output: W,
        build_identity: &str,
        protocol_digest: &str,
    ) -> Self {
        let registry = Registry {
            capabilities: sources.iter().map(|source| source.descriptor()).collect(),
            baseline_rules: Vec::new(),
        };
        let mut by_id = BTreeMap::new();
        let mut pending = BTreeMap::new();
        for source in sources {
            let id = source.descriptor().id;
            pending.insert(id.clone(), Arc::new(AtomicBool::new(false)));
            by_id.insert(id, source);
        }
        Self {
            engine: Engine::new(registry),
            sources: by_id,
            pending,
            events,
            writer: Writer::new(output),
            started: Instant::now(),
            build_identity: BuildIdentity::new(build_identity)
                .expect("compiled build identity is valid"),
            protocol_digest: Digest::new(protocol_digest.trim())
                .expect("compiled protocol digest is valid"),
            random: RandomState::new(),
            instances: 0,
        }
    }

    /// Runs until Electron main closes the pipe or breaks the protocol.
    pub fn run(&mut self, events: &Receiver<Event>) -> Exit {
        if let Err(exit) = self.handshake(events) {
            return exit;
        }
        let mut next_heartbeat = Instant::now();
        loop {
            let now = Instant::now();
            if now >= next_heartbeat {
                let heartbeat = Notification::Heartbeat {
                    monotonic_ms: Count::new(self.now_ms()).unwrap_or(Count::ZERO),
                };
                let numbered = self.engine.notify(heartbeat);
                if self.send_numbered(vec![numbered]).is_err() {
                    return Exit::Closed;
                }
                next_heartbeat = now + HEARTBEAT_INTERVAL;
            }
            let mut wait = next_heartbeat.saturating_duration_since(Instant::now());
            if let Some(deadline) = self.engine.next_deadline() {
                wait = wait.min(Duration::from_millis(
                    deadline.saturating_sub(self.now_ms()),
                ));
            }
            match events.recv_timeout(wait) {
                Ok(Event::Main(message)) => match self.handle_main(*message) {
                    Ok(()) => {}
                    Err(exit) => return exit,
                },
                Ok(Event::Source(capability, event)) => self.handle_source(&capability, &event),
                Ok(Event::MainClosed) | Err(RecvTimeoutError::Disconnected) => {
                    emit(Diagnostic::MainClosed);
                    self.stop_all();
                    return Exit::Closed;
                }
                Ok(Event::MainInvalid) => return self.fatal(Diagnostic::ProtocolError),
                Err(RecvTimeoutError::Timeout) => {
                    if self
                        .engine
                        .next_deadline()
                        .is_some_and(|deadline| deadline <= self.now_ms())
                    {
                        let input = Input::Tick {
                            at_ms: self.now_ms(),
                        };
                        self.apply(input);
                    }
                }
            }
        }
    }

    fn handshake(&mut self, events: &Receiver<Event>) -> Result<(), Exit> {
        let message = match events.recv_timeout(HANDSHAKE_TIMEOUT) {
            Ok(Event::Main(message)) => *message,
            Err(RecvTimeoutError::Timeout) => {
                emit(Diagnostic::HandshakeTimeout);
                return Err(Exit::Protocol);
            }
            Ok(Event::MainClosed) | Err(RecvTimeoutError::Disconnected) => {
                return Err(Exit::Closed);
            }
            Ok(_) => {
                emit(Diagnostic::HandshakeMismatch);
                return Err(Exit::Protocol);
            }
        };
        let MainMessage::Hello {
            secret,
            build_identity,
            protocol_digest,
        } = message
        else {
            emit(Diagnostic::HandshakeMismatch);
            return Err(Exit::Protocol);
        };
        if build_identity != self.build_identity || protocol_digest != self.protocol_digest {
            emit(Diagnostic::HandshakeMismatch);
            return Err(Exit::Protocol);
        }
        let reply = AgentMessage::HelloAck {
            secret,
            build_identity: self.build_identity.clone(),
            protocol_digest: self.protocol_digest.clone(),
        };
        self.writer.send(&reply).map_err(|_| Exit::Closed)
    }

    fn handle_main(&mut self, message: MainMessage) -> Result<(), Exit> {
        match message {
            MainMessage::Hello { .. } => Err(self.fatal(Diagnostic::ProtocolError)),
            MainMessage::Request {
                request_id,
                request,
            } => {
                let response = self.respond(request);
                self.writer
                    .send(&AgentMessage::Response {
                        request_id,
                        response,
                    })
                    .map_err(|_| Exit::Closed)
            }
            MainMessage::HostEvent { capability, event } => {
                let accepted = self
                    .sources
                    .get_mut(&capability)
                    .is_some_and(|source| source.host_event(&event).is_ok());
                if accepted {
                    Ok(())
                } else {
                    Err(self.fatal(Diagnostic::ProtocolError))
                }
            }
            MainMessage::HostEventsLost { capability, count } => {
                let input = Input::EventsLost {
                    capability,
                    count: count.get(),
                    at_ms: self.now_ms(),
                };
                self.apply(input);
                Ok(())
            }
            MainMessage::Acknowledge { up_to } => {
                self.apply(Input::Acknowledged { up_to: up_to.get() });
                Ok(())
            }
        }
    }

    fn respond(&mut self, request: Request) -> Response {
        let refused = |code| Response::Refused { code };
        match request {
            Request::Query { capability } => self.query(&capability).unwrap_or_else(refused),
            Request::OpenReadiness { policy, .. } => self.open(policy).unwrap_or_else(refused),
            Request::BeginParticipation => {
                let at_ms = self.now_ms();
                let fresh: Vec<_> = self
                    .engine
                    .registry()
                    .capabilities
                    .iter()
                    .map(|descriptor| descriptor.id.clone())
                    .collect();
                for capability in fresh {
                    if let Some(source) = self.sources.get_mut(&capability) {
                        let observation = source.current();
                        if let Ok(messages) = self.engine.handle(Input::Observed {
                            capability,
                            observation,
                            at_ms,
                        }) {
                            let _ = self.send_numbered(messages);
                        }
                    }
                }
                match self.engine.begin_participation() {
                    Ok((facts, rules)) => Response::ParticipationBegun { facts, rules },
                    Err(error) => refused(refusal(&error)),
                }
            }
            Request::ConfirmParticipation => match self.engine.confirm_participation(self.now_ms())
            {
                Ok(rules) => Response::ParticipationConfirmed { rules },
                Err(error) => refused(refusal(&error)),
            },
            Request::AbandonParticipation => match self.engine.abandon_participation() {
                Ok(rules) => Response::ParticipationAbandoned { rules },
                Err(error) => refused(refusal(&error)),
            },
            Request::RequestPermission { capability } => self
                .sources
                .get_mut(&capability)
                .ok_or(RefusalCode::UnknownCapability)
                .and_then(|source| {
                    source
                        .request_permission()
                        .map_err(|_| RefusalCode::NoPermissionPrompt)
                })
                .map_or_else(refused, |permission| Response::PermissionRequested {
                    capability,
                    permission,
                }),
            Request::Close => match self.engine.close() {
                Ok((facts, rules)) => {
                    self.stop_all();
                    Response::Closed { facts, rules }
                }
                Err(error) => refused(refusal(&error)),
            },
        }
    }

    fn query(&mut self, capability: &Identifier) -> Result<Response, RefusalCode> {
        let sensitive = self
            .engine
            .registry()
            .capability(capability)
            .is_none_or(|descriptor| descriptor.sensitive);
        if sensitive {
            return Err(RefusalCode::UnknownCapability);
        }
        let instance = self.fresh_instance();
        let at_ms = self.now_ms();
        let source = self
            .sources
            .get_mut(capability)
            .ok_or(RefusalCode::UnknownCapability)?;
        let observation = source.current();
        Ok(Response::Queried {
            fact: Fact {
                capability: capability.clone(),
                source_instance_id: instance,
                sequence: Count::ZERO,
                captured_at_ms: Count::new(at_ms).unwrap_or(Count::ZERO),
                envelope: observation.envelope,
                state: observation.state,
                summary: observation.summary,
                changes: Vec::new(),
            },
        })
    }

    fn open(&mut self, policy: Policy) -> Result<Response, RefusalCode> {
        if self.engine.is_open() {
            return Err(RefusalCode::WrongPhase);
        }
        let mut initial = Vec::new();
        for activation in &policy.activations {
            let Some(pending) = self.pending.get(&activation.capability).cloned() else {
                self.stop_all();
                return Err(RefusalCode::InvalidPolicy);
            };
            let events = self.events.clone();
            let capability = activation.capability.clone();
            let sink: Sink = Arc::new(move |event| {
                // Changes coalesce: one pending wake-up per capability until the core reads it.
                if matches!(event, SourceEvent::Changed) && pending.swap(true, Ordering::AcqRel) {
                    return;
                }
                let _ = events.send(Event::Source(capability.clone(), event));
            });
            let instance = self.fresh_instance();
            let Some(source) = self.sources.get_mut(&activation.capability) else {
                self.stop_all();
                return Err(RefusalCode::InvalidPolicy);
            };
            let Ok(observation) = source.start(sink) else {
                emit(Diagnostic::SourceStartFailed);
                self.stop_all();
                return Err(RefusalCode::NotReady);
            };
            initial.push(InitialState {
                capability: activation.capability.clone(),
                source_instance_id: instance,
                observation,
            });
        }
        match self.engine.open_readiness(policy, initial, self.now_ms()) {
            Ok((facts, rules)) => Ok(Response::ReadinessOpened { facts, rules }),
            Err(error) => {
                self.stop_all();
                Err(refusal(&error))
            }
        }
    }

    fn handle_source(&mut self, capability: &Identifier, event: &SourceEvent) {
        if !self.engine.is_open() {
            return;
        }
        let at_ms = self.now_ms();
        let input = match event {
            SourceEvent::Changed => {
                if let Some(pending) = self.pending.get(capability) {
                    pending.store(false, Ordering::Release);
                }
                let Some(source) = self.sources.get_mut(capability) else {
                    return;
                };
                Input::Observed {
                    capability: capability.clone(),
                    observation: source.current(),
                    at_ms,
                }
            }
            SourceEvent::Lost(count) => Input::EventsLost {
                capability: capability.clone(),
                count: *count,
                at_ms,
            },
        };
        self.apply(input);
    }

    fn apply(&mut self, input: Input) {
        if let Ok(messages) = self.engine.handle(input) {
            let _ = self.send_numbered(messages);
        }
    }

    fn send_numbered(&mut self, messages: Vec<Numbered>) -> std::io::Result<()> {
        for message in messages {
            self.writer.send(&AgentMessage::Notification {
                message_number: message.message_number,
                notification: message.notification,
            })?;
        }
        Ok(())
    }

    fn fatal(&mut self, diagnostic: Diagnostic) -> Exit {
        emit(diagnostic);
        let fatal = self.engine.notify(Notification::Fatal {
            code: FatalCode::Protocol,
        });
        let _ = self.send_numbered(vec![fatal]);
        self.stop_all();
        Exit::Protocol
    }

    fn stop_all(&mut self) {
        for source in self.sources.values_mut().rev() {
            source.stop();
        }
    }

    fn now_ms(&self) -> u64 {
        u64::try_from(self.started.elapsed().as_millis()).unwrap_or(u64::MAX)
    }

    fn fresh_instance(&mut self) -> OpaqueId {
        self.instances += 1;
        let mut hasher = self.random.build_hasher();
        hasher.write_u64(self.instances);
        let first = hasher.finish();
        hasher.write_u64(first);
        OpaqueId::new(format!("{first:016x}{:016x}", hasher.finish()))
            .expect("hex instance id is valid")
    }
}

const fn refusal(error: &CoreError) -> RefusalCode {
    match error {
        CoreError::WrongPhase => RefusalCode::WrongPhase,
        CoreError::InvalidPolicy(_) | CoreError::InitialStatesMismatch => {
            RefusalCode::InvalidPolicy
        }
        CoreError::UnknownCapability(_) => RefusalCode::UnknownCapability,
        CoreError::NotReady(_) => RefusalCode::NotReady,
    }
}
