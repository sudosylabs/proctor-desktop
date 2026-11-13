//! The helper's core: every connected agent, the shared process table, and what each agent is
//! sent. `Hub` is a pure state machine: it takes events and returns outputs, so it is tested
//! without threads or an OS. `serve` wires it to a listener and the platform sources.
//!
//! The process source runs only while at least one agent subscribes to processes; with no
//! subscriber the helper is dormant.

use std::collections::BTreeMap;
use std::io::{Read, Write};
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{self, Receiver, RecvTimeoutError, Sender, SyncSender, TrySendError};
use std::time::Duration;

use prctr_protocol::frame::{Decoder, encode};
use prctr_protocol::helper::{
    AgentToHelper, HelperIdentity, HelperLoss, HelperRefusal, HelperSessions, HelperToAgent,
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
    /// Verify this process's identity off the hub thread, then report it through
    /// [`Hub::identified`].
    Identify {
        generation: u64,
        pid: u32,
        created: u64,
    },
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
    sink: Arc<dyn Fn(u64, ProcessEvent) + Send + Sync>,
    peers: BTreeMap<PeerId, PeerState>,
    watch: Option<Box<dyn ProcessWatch>>,
    snapshot_ready: bool,
    source_generation: u64,
    session_started: bool,
    table: ProcessTable,
    sessions: Option<RawSessions>,
    session_watch: Option<Box<dyn crate::platform::SessionWatch>>,
    /// Processes awaiting identity, handed to the driver with the next outputs.
    to_identify: Vec<(u32, u64)>,
}

impl Hub {
    /// `sink` is where the process source delivers events; the driver feeds them back through
    /// [`Hub::process`].
    #[must_use]
    pub fn new(
        sources: Sources,
        digest: &str,
        sink: Arc<dyn Fn(u64, ProcessEvent) + Send + Sync>,
    ) -> Self {
        Self {
            sources,
            digest: digest.trim().to_owned(),
            sink,
            peers: BTreeMap::new(),
            watch: None,
            snapshot_ready: false,
            source_generation: 0,
            session_started: false,
            table: ProcessTable::default(),
            sessions: None,
            session_watch: None,
            to_identify: Vec::new(),
        }
    }

    /// Appends the identity requests queued while producing `out`.
    fn with_identify(&mut self, mut out: Vec<Output>) -> Vec<Output> {
        let generation = self.source_generation;
        out.extend(
            self.to_identify
                .drain(..)
                .map(|(pid, created)| Output::Identify {
                    generation,
                    pid,
                    created,
                }),
        );
        out
    }

    /// A verified identity for a process the hub asked about. Ignored when the source restarted,
    /// the process exited or its ID was reused since.
    pub fn identified(
        &mut self,
        generation: u64,
        pid: u32,
        created: u64,
        identity: HelperIdentity,
    ) -> Vec<Output> {
        if generation != self.source_generation
            || self.watch.is_none()
            || !self.table.identify(pid, created, identity)
        {
            return Vec::new();
        }
        let targets: Vec<(PeerId, u32)> = self.subscribers(true).collect();
        targets
            .into_iter()
            .filter_map(|(peer, own)| {
                let process = self.table.visible(pid, own)?;
                Some(Output::Send(
                    peer,
                    HelperToAgent::ProcessIdentified {
                        instance: process.instance,
                        identity: process.identity,
                    },
                ))
            })
            .collect()
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
                    if self.watch.is_none() {
                        self.start_watch();
                    }
                    if !self.snapshot_ready {
                        out.push(Output::Send(
                            peer,
                            HelperToAgent::Lost {
                                reason: HelperLoss::SourceRestarted,
                            },
                        ));
                    }
                    if self.snapshot_ready {
                        out.push(Output::Send(
                            peer,
                            HelperToAgent::ProcessSnapshot {
                                processes: self.table.snapshot(own),
                            },
                        ));
                    }
                }
                if newly.sessions {
                    self.start_sessions();
                    self.sessions = if self.session_started {
                        self.sources.sessions.read()
                    } else {
                        None
                    };
                    out.push(Output::Send(peer, self.session_report(own)));
                }
                self.settle();
                self.with_identify(out)
            }
        }
    }

    fn start_watch(&mut self) -> bool {
        self.source_generation += 1;
        let generation = self.source_generation;
        let sink = Arc::clone(&self.sink);
        let forward: ProcessSink = Box::new(move |event| sink(generation, event));
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
        self.snapshot_ready = false;
        self.table.clear();
        let Some(snapshot) = self.sources.processes.snapshot() else {
            return;
        };
        self.to_identify = snapshot
            .iter()
            .map(|start| (start.pid, start.created))
            .collect();
        self.table.reset(
            snapshot
                .into_iter()
                .map(|start| (start, HelperIdentity::Pending)),
        );
        self.snapshot_ready = true;
    }

    /// Stops the process source when no agent subscribes to processes, and forgets sessions when
    /// none subscribes to sessions.
    fn settle(&mut self) {
        let wanted = self.wanted();
        if !wanted.processes && self.watch.is_some() {
            self.watch = None;
            self.table.clear();
            self.snapshot_ready = false;
        }
        if !wanted.sessions {
            self.sessions = None;
            self.session_watch = None;
            self.session_started = false;
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

    fn process_generation(&mut self, generation: u64, event: ProcessEvent) -> Vec<Output> {
        if generation != self.source_generation {
            return Vec::new();
        }
        self.process(event)
    }

    /// One event from the process source.
    pub fn process(&mut self, event: ProcessEvent) -> Vec<Output> {
        let out = self.apply_process(event);
        self.with_identify(out)
    }

    fn apply_process(&mut self, event: ProcessEvent) -> Vec<Output> {
        if self.watch.is_none() {
            return Vec::new();
        }
        let targets: Vec<(PeerId, u32)> = self.subscribers(true).collect();
        match event {
            ProcessEvent::Started(start) => {
                self.to_identify.push((start.pid, start.created));
                self.apply_process(ProcessEvent::Observed {
                    start,
                    identity: HelperIdentity::Pending,
                })
            }
            ProcessEvent::Observed { start, identity } => {
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
                let Some((session, known)) = self.table.stop(pid, created) else {
                    return Vec::new();
                };
                let instance = crate::processes::instance(pid, known);
                targets
                    .into_iter()
                    .filter(|(_, own)| scope(session, *own).is_some())
                    .map(|(peer, _)| Output::Send(peer, HelperToAgent::ProcessExited { instance }))
                    .collect()
            }
            ProcessEvent::Unavailable => {
                self.watch = None;
                self.snapshot_ready = false;
                self.table.clear();
                targets
                    .into_iter()
                    .map(|(peer, _)| {
                        Output::Send(
                            peer,
                            HelperToAgent::Lost {
                                reason: HelperLoss::SourceRestarted,
                            },
                        )
                    })
                    .collect()
            }
            ProcessEvent::Lost => {
                self.resnapshot();
                targets
                    .into_iter()
                    .flat_map(|(peer, own)| {
                        let mut out = vec![Output::Send(
                            peer,
                            HelperToAgent::Lost {
                                reason: HelperLoss::EventsDropped,
                            },
                        )];
                        if self.snapshot_ready {
                            out.push(Output::Send(
                                peer,
                                HelperToAgent::ProcessSnapshot {
                                    processes: self.table.snapshot(own),
                                },
                            ));
                        }
                        if self
                            .peers
                            .get(&peer)
                            .is_some_and(|state| state.connection.subscription().sessions)
                        {
                            out.push(Output::Send(peer, self.session_report(own)));
                        }
                        out
                    })
                    .collect()
            }
        }
    }

    fn start_sessions(&mut self) {
        if !self.session_started
            && let Ok(watch) = self.sources.sessions.start()
        {
            self.session_watch = watch;
            self.session_started = true;
        }
    }

    /// Re-reads sessions; every session subscriber gets a report when anything changed.
    pub fn sessions_changed(&mut self) -> Vec<Output> {
        if !self.wanted().sessions {
            return Vec::new();
        }
        self.start_sessions();
        let now = if self.session_started {
            self.sources.sessions.read()
        } else {
            None
        };
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
        if self.wanted().processes && !self.snapshot_ready {
            if self.watch.is_none() {
                self.start_watch();
            } else {
                self.resnapshot();
            }
            if self.snapshot_ready {
                out.extend(self.subscribers(true).map(|(peer, own)| {
                    Output::Send(
                        peer,
                        HelperToAgent::ProcessSnapshot {
                            processes: self.table.snapshot(own),
                        },
                    )
                }));
            }
        }
        out.extend(self.peers.iter().filter_map(|(id, peer)| {
            peer.connection
                .subscription()
                .any()
                .then_some(Output::Send(*id, HelperToAgent::Heartbeat))
        }));
        self.with_identify(out)
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

/// Events queued for the hub thread before the process source's overflow turns into a loss.
pub const EVENT_QUEUE: usize = 16_384;
/// Identity checks queued before new ones are reported as unavailable.
pub const IDENTIFY_QUEUE: usize = 8_192;
/// Consecutive listener failures, each followed by a back-off, before the helper stops so the
/// service manager can restart it.
const MAX_ACCEPT_FAILURES: u32 = 32;
const ACCEPT_BACKOFF: Duration = Duration::from_millis(50);
const MAX_ACCEPT_BACKOFF: Duration = Duration::from_secs(1);

enum Event {
    Connected(PeerId, u32, SyncSender<HelperToAgent>),
    Message(PeerId, AgentToHelper),
    Disconnected(PeerId),
    Process(u64, ProcessEvent),
    Identified {
        generation: u64,
        pid: u32,
        created: u64,
        identity: HelperIdentity,
    },
}

/// The longest the hub waits before checking service controls, so a session change or a stop
/// is acted on promptly.
const CONTROL_POLL: Duration = Duration::from_millis(100);

fn read_messages(peer: PeerId, mut reader: Box<dyn Read + Send>, events: &SyncSender<Event>) {
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

fn spawn(name: &str, work: impl FnOnce() + Send + 'static) -> bool {
    std::thread::Builder::new()
        .name(name.to_owned())
        .spawn(work)
        .is_ok()
}

/// The back-off after the `failures`-th consecutive listener failure.
fn accept_backoff(failures: u32) -> Duration {
    ACCEPT_BACKOFF
        .saturating_mul(1_u32 << failures.min(5))
        .min(MAX_ACCEPT_BACKOFF)
}

/// Accepts agents until shutdown. A failed accept is one connection's failure: the listener backs
/// off and keeps serving, and only a listener that keeps failing stops the helper.
fn accept_agents(
    listener: &Arc<dyn Listener>,
    peers: &Arc<dyn PeerCheck>,
    events: &SyncSender<Event>,
    stop: &Sender<Control>,
    stopping: &AtomicBool,
) {
    let mut next: PeerId = 0;
    let mut failures = 0_u32;
    loop {
        let peer = match listener.accept() {
            Ok(peer) => {
                failures = 0;
                peer
            }
            Err(_) if stopping.load(Ordering::Acquire) => break,
            Err(error)
                if matches!(
                    error.kind(),
                    std::io::ErrorKind::PermissionDenied | std::io::ErrorKind::InvalidData
                ) =>
            {
                continue;
            }
            Err(_) => {
                failures += 1;
                if failures >= MAX_ACCEPT_FAILURES {
                    let _ = stop.send(Control::Stop);
                    break;
                }
                std::thread::sleep(accept_backoff(failures));
                continue;
            }
        };
        next += 1;
        let id = next;
        let authorized = peers.authorize(&peer);
        let (queue, outbox) = mpsc::sync_channel::<HelperToAgent>(PEER_QUEUE);
        let writer = peer.writer;
        if !spawn("prctr-helper-writer", move || {
            write_messages(writer, &outbox);
        }) {
            continue;
        }
        if !authorized {
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
        let reader_events = events.clone();
        if !spawn("prctr-helper-reader", move || {
            read_messages(id, reader, &reader_events);
        }) {
            let _ = events.send(Event::Disconnected(id));
        }
    }
}

/// Verifies identities one at a time, off the hub thread.
fn identify_processes(
    identity: &Arc<dyn IdentitySource>,
    jobs: &Receiver<(u64, u32, u64)>,
    events: &SyncSender<Event>,
) {
    for (generation, pid, created) in jobs {
        let identity = identity.identify(pid);
        let event = Event::Identified {
            generation,
            pid,
            created,
            identity,
        };
        if events.send(event).is_err() {
            return;
        }
    }
}

/// The hub's driver: delivers outputs to agent queues and identity jobs to the worker.
struct Driver {
    hub: Hub,
    queues: BTreeMap<PeerId, SyncSender<HelperToAgent>>,
    jobs: SyncSender<(u64, u32, u64)>,
}

impl Driver {
    fn deliver(&mut self, outputs: Vec<Output>) {
        let mut pending: std::collections::VecDeque<Output> = outputs.into();
        while let Some(output) = pending.pop_front() {
            match output {
                Output::Send(peer, message) => {
                    let stalled = self
                        .queues
                        .get(&peer)
                        .is_some_and(|queue| queue.try_send(message).is_err());
                    if stalled {
                        self.queues.remove(&peer);
                        self.hub.disconnected(peer);
                    }
                }
                Output::Close(peer) => {
                    self.queues.remove(&peer);
                }
                Output::Identify {
                    generation,
                    pid,
                    created,
                } => {
                    if self.jobs.try_send((generation, pid, created)).is_err() {
                        pending.extend(self.hub.identified(
                            generation,
                            pid,
                            created,
                            HelperIdentity::Unavailable,
                        ));
                    }
                }
            }
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
    let (events, inbox) = mpsc::sync_channel::<Event>(EVENT_QUEUE);
    let (stop, stopped) = mpsc::channel::<Control>();
    let stopping = Arc::new(AtomicBool::new(false));
    let accepting = {
        let (listener, peers, events, stopping) = (
            Arc::clone(listener),
            Arc::clone(peers),
            events.clone(),
            Arc::clone(&stopping),
        );
        std::thread::Builder::new()
            .name("prctr-helper-accept".into())
            .spawn(move || accept_agents(&listener, &peers, &events, &stop, &stopping))
    };
    let Ok(accepting) = accepting else {
        return;
    };
    let (jobs, job_inbox) = mpsc::sync_channel::<(u64, u32, u64)>(IDENTIFY_QUEUE);
    let identity = Arc::clone(&sources.identity);
    let identify_events = events.clone();
    let identifying = std::thread::Builder::new()
        .name("prctr-helper-identity".into())
        .spawn(move || identify_processes(&identity, &job_inbox, &identify_events))
        .ok();
    drive(
        sources,
        digest,
        events,
        &inbox,
        &[controls, &stopped],
        &stopping,
        jobs,
    );
    // Closing the queue first fails any thread blocked on a full queue, so every join returns.
    drop(inbox);
    listener.wake();
    let _ = accepting.join();
    if let Some(identifying) = identifying {
        let _ = identifying.join();
    }
}

/// The hub thread's loop, until a stop control or every event sender is gone.
fn drive(
    sources: Sources,
    digest: &str,
    events: SyncSender<Event>,
    inbox: &Receiver<Event>,
    controls: &[&Receiver<Control>],
    stopping: &AtomicBool,
    jobs: SyncSender<(u64, u32, u64)>,
) {
    let overflowed = Arc::new(AtomicBool::new(false));
    let sink_overflow = Arc::clone(&overflowed);
    let sink_events = events.clone();
    let sink: Arc<dyn Fn(u64, ProcessEvent) + Send + Sync> = Arc::new(move |generation, event| {
        if let Err(TrySendError::Full(_)) = sink_events.try_send(Event::Process(generation, event))
        {
            sink_overflow.store(true, Ordering::Release);
        }
    });
    drop(events);
    let mut driver = Driver {
        hub: Hub::new(sources, digest, sink),
        queues: BTreeMap::new(),
        jobs,
    };
    let mut next_tick = std::time::Instant::now() + TICK;
    'serving: loop {
        if std::time::Instant::now() >= next_tick {
            let outputs = driver.hub.tick();
            driver.deliver(outputs);
            next_tick = std::time::Instant::now() + TICK;
        }
        for control in controls.iter().flat_map(|controls| controls.try_iter()) {
            match control {
                Control::Stop => break 'serving,
                Control::SessionChanged => {
                    let outputs = driver.hub.sessions_changed();
                    driver.deliver(outputs);
                }
            }
        }
        if overflowed.swap(false, Ordering::AcqRel) {
            let outputs = driver.hub.process(ProcessEvent::Lost);
            driver.deliver(outputs);
        }
        let wait = next_tick
            .saturating_duration_since(std::time::Instant::now())
            .min(CONTROL_POLL);
        let outputs = match inbox.recv_timeout(wait) {
            Ok(Event::Connected(peer, session, queue)) => {
                driver.queues.insert(peer, queue);
                driver.hub.connected(peer, session);
                Vec::new()
            }
            Ok(Event::Message(peer, message)) => driver.hub.message(peer, message),
            Ok(Event::Disconnected(peer)) => {
                driver.queues.remove(&peer);
                driver.hub.disconnected(peer);
                Vec::new()
            }
            Ok(Event::Process(generation, event)) => {
                driver.hub.process_generation(generation, event)
            }
            Ok(Event::Identified {
                generation,
                pid,
                created,
                identity,
            }) => driver.hub.identified(generation, pid, created, identity),
            Err(RecvTimeoutError::Disconnected) => break,
            Err(RecvTimeoutError::Timeout) => Vec::new(),
        };
        driver.deliver(outputs);
    }
    stopping.store(true, Ordering::Release);
}

#[cfg(test)]
#[path = "hub_tests.rs"]
mod tests;
