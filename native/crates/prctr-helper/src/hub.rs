//! The helper's core: every connected agent, the shared process table, and what each agent is
//! sent. `Hub` is a pure state machine: it takes events and returns outputs, so it is tested
//! without threads or an OS. `serve` wires it to a listener and the platform sources.
//!
//! The process source runs only while at least one agent subscribes to processes; with no
//! subscriber the helper is dormant.

use std::collections::BTreeMap;
use std::io::{Read, Write};
use std::sync::Arc;
use std::sync::mpsc::{self, Receiver, RecvTimeoutError, Sender, SyncSender, TrySendError};
use std::time::Duration;

use prctr_protocol::frame::{Decoder, encode};
use prctr_protocol::helper::{
    AgentToHelper, HelperLoss, HelperRefusal, HelperSessions, HelperToAgent,
};

use crate::connection::{Connection, Step, Subscription};
use crate::platform::{
    Control, IdentitySource, Listener, PeerCheck, ProcessEvent, ProcessSink, ProcessSource,
    ProcessWatch, SessionSource,
};
use crate::processes::{ProcessTable, scope};
use crate::sessions::{RawSessionInfo, report};

/// Messages queued for one agent before it is considered stalled.
pub const PEER_QUEUE: usize = 4_096;
const TICK: Duration = Duration::from_secs(1);

pub type PeerId = u64;

/// What the hub asks its driver to do.
#[derive(Debug, PartialEq, Eq)]
pub enum Output {
    Send(PeerId, HelperToAgent),
    /// Send nothing more and close the connection.
    Close(PeerId),
}

/// The platform sources the hub reads.
#[derive(Clone)]
pub struct Sources {
    pub processes: Arc<dyn ProcessSource>,
    pub sessions: Arc<dyn SessionSource>,
    pub identity: Arc<dyn IdentitySource>,
}

struct PeerState {
    session: u32,
    connection: Connection,
}

type RawSessions = (Option<u32>, Vec<RawSessionInfo>);

pub struct Hub {
    sources: Sources,
    digest: String,
    sink: Arc<dyn Fn(ProcessEvent) + Send + Sync>,
    peers: BTreeMap<PeerId, PeerState>,
    watch: Option<Box<dyn ProcessWatch>>,
    table: ProcessTable,
    sessions: Option<RawSessions>,
}

impl Hub {
    /// `sink` is where the process source delivers events; the driver feeds them back through
    /// [`Hub::process`].
    #[must_use]
    pub fn new(
        sources: Sources,
        digest: &str,
        sink: Arc<dyn Fn(ProcessEvent) + Send + Sync>,
    ) -> Self {
        Self {
            sources,
            digest: digest.trim().to_owned(),
            sink,
            peers: BTreeMap::new(),
            watch: None,
            table: ProcessTable::default(),
            sessions: None,
        }
    }

    /// Whether the process source is running.
    #[must_use]
    pub fn observing(&self) -> bool {
        self.watch.is_some()
    }

    pub fn connected(&mut self, peer: PeerId, session: u32) {
        self.peers.insert(
            peer,
            PeerState {
                session,
                connection: Connection::default(),
            },
        );
    }

    pub fn disconnected(&mut self, peer: PeerId) {
        self.peers.remove(&peer);
        self.settle();
    }

    pub fn message(&mut self, peer: PeerId, message: AgentToHelper) -> Vec<Output> {
        let Some(state) = self.peers.get_mut(&peer) else {
            return Vec::new();
        };
        match state.connection.receive(message, &self.digest) {
            Step::Reply(reply) => vec![Output::Send(peer, reply)],
            Step::Close(reply) => {
                self.peers.remove(&peer);
                self.settle();
                vec![Output::Send(peer, reply), Output::Close(peer)]
            }
            Step::Subscribed { newly, .. } => {
                let own = state.session;
                let mut out = Vec::new();
                if newly.processes {
                    if self.watch.is_none() && !self.start_watch() {
                        out.push(Output::Send(
                            peer,
                            HelperToAgent::Lost {
                                reason: HelperLoss::SourceRestarted,
                            },
                        ));
                    }
                    out.push(Output::Send(
                        peer,
                        HelperToAgent::ProcessSnapshot {
                            processes: self.table.snapshot(own),
                        },
                    ));
                }
                if newly.sessions {
                    if self.sessions.is_none() {
                        self.sessions = self.sources.sessions.read();
                    }
                    out.push(Output::Send(peer, self.session_report(own)));
                }
                self.settle();
                out
            }
        }
    }

    fn start_watch(&mut self) -> bool {
        let sink = Arc::clone(&self.sink);
        let forward: ProcessSink = Box::new(move |event| sink(event));
        match self.sources.processes.start(forward) {
            Ok(watch) => {
                self.watch = Some(watch);
                self.resnapshot();
                true
            }
            Err(_) => false,
        }
    }

    fn resnapshot(&mut self) {
        let identity = &self.sources.identity;
        let snapshot = self.sources.processes.snapshot().unwrap_or_default();
        self.table.reset(
            snapshot
                .into_iter()
                .map(|start| (start, identity.identify(start.pid))),
        );
    }

    /// Stops the process source when no agent subscribes to processes, and forgets sessions when
    /// none subscribes to sessions.
    fn settle(&mut self) {
        let wanted = self.wanted();
        if !wanted.processes && self.watch.is_some() {
            self.watch = None;
            self.table.clear();
        }
        if !wanted.sessions {
            self.sessions = None;
        }
    }

    fn wanted(&self) -> Subscription {
        self.peers
            .values()
            .fold(Subscription::default(), |wanted, peer| {
                let subscription = peer.connection.subscription();
                Subscription {
                    processes: wanted.processes || subscription.processes,
                    sessions: wanted.sessions || subscription.sessions,
                }
            })
    }

    fn subscribers(&self, processes: bool) -> impl Iterator<Item = (PeerId, u32)> + '_ {
        self.peers.iter().filter_map(move |(id, peer)| {
            let subscription = peer.connection.subscription();
            let wants = if processes {
                subscription.processes
            } else {
                subscription.sessions
            };
            wants.then_some((*id, peer.session))
        })
    }

    fn session_report(&self, own: u32) -> HelperToAgent {
        let (console, sessions) = self.sessions.clone().unwrap_or_default();
        HelperToAgent::Sessions(report(console, own, &sessions))
    }

    /// One event from the process source.
    pub fn process(&mut self, event: ProcessEvent) -> Vec<Output> {
        if self.watch.is_none() {
            return Vec::new();
        }
        let targets: Vec<(PeerId, u32)> = self.subscribers(true).collect();
        match event {
            ProcessEvent::Started(start) => {
                let identity = self.sources.identity.identify(start.pid);
                self.table.start(start, identity);
                targets
                    .into_iter()
                    .filter_map(|(peer, own)| {
                        let process = self.table.visible(start.pid, own)?;
                        Some(Output::Send(
                            peer,
                            HelperToAgent::ProcessStarted { process },
                        ))
                    })
                    .collect()
            }
            ProcessEvent::Stopped { pid, created } => {
                let Some(session) = self.table.stop(pid, created) else {
                    return Vec::new();
                };
                let instance = crate::processes::instance(pid, created);
                targets
                    .into_iter()
                    .filter(|(_, own)| scope(session, *own).is_some())
                    .map(|(peer, _)| Output::Send(peer, HelperToAgent::ProcessExited { instance }))
                    .collect()
            }
            ProcessEvent::Lost => {
                self.resnapshot();
                targets
                    .into_iter()
                    .flat_map(|(peer, own)| {
                        [
                            Output::Send(
                                peer,
                                HelperToAgent::Lost {
                                    reason: HelperLoss::EventsDropped,
                                },
                            ),
                            Output::Send(
                                peer,
                                HelperToAgent::ProcessSnapshot {
                                    processes: self.table.snapshot(own),
                                },
                            ),
                        ]
                    })
                    .collect()
            }
        }
    }

    /// Re-reads sessions; every session subscriber gets a report when anything changed.
    pub fn sessions_changed(&mut self) -> Vec<Output> {
        if !self.wanted().sessions {
            return Vec::new();
        }
        let now = self.sources.sessions.read();
        if now == self.sessions {
            return Vec::new();
        }
        self.sessions = now;
        let targets: Vec<(PeerId, u32)> = self.subscribers(false).collect();
        targets
            .into_iter()
            .map(|(peer, own)| Output::Send(peer, self.session_report(own)))
            .collect()
    }

    /// The once-a-second tick: a session re-read and a heartbeat to every subscriber.
    pub fn tick(&mut self) -> Vec<Output> {
        let mut out = self.sessions_changed();
        out.extend(self.peers.iter().filter_map(|(id, peer)| {
            peer.connection
                .subscription()
                .any()
                .then_some(Output::Send(*id, HelperToAgent::Heartbeat))
        }));
        out
    }

    /// The report this hub would send an agent in session `own`, for tests and diagnostics.
    #[must_use]
    pub fn sessions_for(&self, own: u32) -> Option<HelperSessions> {
        match self.session_report(own) {
            HelperToAgent::Sessions(report) => Some(report),
            _ => None,
        }
    }
}

enum Event {
    Connected(PeerId, u32, SyncSender<HelperToAgent>),
    Message(PeerId, AgentToHelper),
    Disconnected(PeerId),
    Process(ProcessEvent),
    Control(Control),
}

fn read_messages(peer: PeerId, mut reader: Box<dyn Read + Send>, events: &Sender<Event>) {
    let mut decoder = Decoder::new();
    let mut buffer = [0_u8; 16 * 1024];
    loop {
        match reader.read(&mut buffer) {
            Ok(0) | Err(_) => break,
            Ok(count) => decoder.push(&buffer[..count]),
        }
        loop {
            match decoder.next_message::<AgentToHelper>() {
                Ok(Some(message)) => {
                    if events.send(Event::Message(peer, message)).is_err() {
                        return;
                    }
                }
                Ok(None) => break,
                Err(_) => {
                    let _ = events.send(Event::Disconnected(peer));
                    return;
                }
            }
        }
    }
    let _ = events.send(Event::Disconnected(peer));
}

fn write_messages(mut writer: Box<dyn Write + Send>, queue: &Receiver<HelperToAgent>) {
    for message in queue {
        let close = matches!(message, HelperToAgent::Refused { .. });
        let Ok(frame) = encode(&message) else { break };
        if writer
            .write_all(&frame)
            .and_then(|()| writer.flush())
            .is_err()
            || close
        {
            break;
        }
    }
}

/// Runs the helper until `Control::Stop`: accepts agents, authorizes each one, and drives the hub.
pub fn serve(
    sources: Sources,
    listener: &Arc<dyn Listener>,
    peers: &Arc<dyn PeerCheck>,
    controls: &Receiver<Control>,
    digest: &str,
) {
    let (events, inbox) = mpsc::channel::<Event>();
    let accepting = {
        let listener = Arc::clone(listener);
        let peers = Arc::clone(peers);
        let events = events.clone();
        std::thread::spawn(move || {
            let mut next: PeerId = 0;
            while let Ok(peer) = listener.accept() {
                next += 1;
                let id = next;
                let (queue, outbox) = mpsc::sync_channel::<HelperToAgent>(PEER_QUEUE);
                let writer = peer.writer;
                std::thread::spawn(move || write_messages(writer, &outbox));
                if !peers.authorize(peer.pid) {
                    let _ = queue.send(HelperToAgent::Refused {
                        code: HelperRefusal::UnauthorizedPeer,
                    });
                    continue;
                }
                if events
                    .send(Event::Connected(id, peer.session, queue))
                    .is_err()
                {
                    break;
                }
                let reader = peer.reader;
                let events = events.clone();
                std::thread::spawn(move || read_messages(id, reader, &events));
            }
        })
    };
    let sink_events = events.clone();
    let sink: Arc<dyn Fn(ProcessEvent) + Send + Sync> = Arc::new(move |event| {
        let _ = sink_events.send(Event::Process(event));
    });
    let mut hub = Hub::new(sources, digest, sink);
    let mut queues: BTreeMap<PeerId, SyncSender<HelperToAgent>> = BTreeMap::new();
    loop {
        while let Ok(control) = controls.try_recv() {
            let _ = events.send(Event::Control(control));
        }
        let outputs = match inbox.recv_timeout(TICK) {
            Ok(Event::Connected(peer, session, queue)) => {
                queues.insert(peer, queue);
                hub.connected(peer, session);
                Vec::new()
            }
            Ok(Event::Message(peer, message)) => hub.message(peer, message),
            Ok(Event::Disconnected(peer)) => {
                queues.remove(&peer);
                hub.disconnected(peer);
                Vec::new()
            }
            Ok(Event::Process(event)) => hub.process(event),
            Ok(Event::Control(Control::SessionChanged)) => hub.sessions_changed(),
            Ok(Event::Control(Control::Stop)) | Err(RecvTimeoutError::Disconnected) => break,
            Err(RecvTimeoutError::Timeout) => hub.tick(),
        };
        for output in outputs {
            match output {
                Output::Send(peer, message) => {
                    let stalled = queues.get(&peer).is_some_and(|queue| {
                        matches!(queue.try_send(message), Err(TrySendError::Full(_)))
                    });
                    if stalled {
                        queues.remove(&peer);
                        hub.disconnected(peer);
                    }
                }
                Output::Close(peer) => {
                    queues.remove(&peer);
                }
            }
        }
    }
    drop(queues);
    drop(hub);
    listener.wake();
    let _ = accepting.join();
}

#[cfg(test)]
#[path = "hub_tests.rs"]
mod tests;
