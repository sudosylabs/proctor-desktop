use std::io;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};

use prctr_protocol::helper::{HelperProcess, ProcessScope, SessionState};
use prctr_protocol::scalars::Digest;

use super::*;
use crate::platform::NoIdentity;
use crate::processes::RawStart;

const DIGEST: &str = "00000000000000000000000000000000000000000000000000000000000000aa";

#[derive(Default)]
struct FakeProcesses {
    snapshot: Mutex<Vec<RawStart>>,
    starts: AtomicUsize,
    running: Arc<AtomicBool>,
}

struct FakeWatch(Arc<AtomicBool>);

impl ProcessWatch for FakeWatch {}

impl Drop for FakeWatch {
    fn drop(&mut self) {
        self.0.store(false, Ordering::SeqCst);
    }
}

impl ProcessSource for FakeProcesses {
    fn start(&self, _sink: ProcessSink) -> Result<Box<dyn ProcessWatch>, String> {
        self.starts.fetch_add(1, Ordering::SeqCst);
        self.running.store(true, Ordering::SeqCst);
        Ok(Box::new(FakeWatch(Arc::clone(&self.running))))
    }

    fn snapshot(&self) -> Option<Vec<RawStart>> {
        Some(self.snapshot.lock().expect("lock").clone())
    }
}

#[derive(Default)]
struct FakeSessions(Mutex<Option<RawSessions>>);

impl SessionSource for FakeSessions {
    fn read(&self) -> Option<RawSessions> {
        self.0.lock().expect("lock").clone()
    }
}

fn raw(pid: u32, session: u32) -> RawStart {
    RawStart {
        pid,
        parent: 0,
        session,
        created: u64::from(pid) * 10,
    }
}

fn session(id: u32, locked: bool) -> RawSessionInfo {
    RawSessionInfo {
        id,
        state: SessionState::Active,
        has_user: true,
        remote: false,
        locked: Some(locked),
    }
}

struct Fixture {
    hub: Hub,
    processes: Arc<FakeProcesses>,
    sessions: Arc<FakeSessions>,
}

fn fixture() -> Fixture {
    let processes = Arc::new(FakeProcesses::default());
    *processes.snapshot.lock().expect("lock") = vec![raw(4, 0), raw(100, 1), raw(200, 2)];
    let sessions = Arc::new(FakeSessions::default());
    *sessions.0.lock().expect("lock") = Some((Some(1), vec![session(1, false)]));
    let sources = Sources {
        processes: Arc::clone(&processes) as Arc<dyn ProcessSource>,
        sessions: Arc::clone(&sessions) as Arc<dyn SessionSource>,
        identity: Arc::new(NoIdentity),
    };
    Fixture {
        hub: Hub::new(sources, DIGEST, Arc::new(|_, _| {})),
        processes,
        sessions,
    }
}

fn hello() -> AgentToHelper {
    AgentToHelper::Hello {
        protocol_digest: Digest::new(DIGEST).expect("digest"),
    }
}

fn subscribe(processes: bool, sessions: bool) -> AgentToHelper {
    AgentToHelper::Subscribe {
        processes,
        sessions,
    }
}

fn join(hub: &mut Hub, peer: PeerId, own: u32) {
    hub.connected(peer, own);
    assert!(matches!(
        hub.message(peer, hello()).as_slice(),
        [Output::Send(_, HelperToAgent::Welcome { .. })]
    ));
}

fn pids(output: &Output) -> Vec<u64> {
    match output {
        Output::Send(_, HelperToAgent::ProcessSnapshot { processes }) => {
            processes.iter().map(|process| process.pid.get()).collect()
        }
        other => panic!("not a snapshot: {other:?}"),
    }
}

#[test]
fn the_helper_is_dormant_until_an_agent_subscribes_and_again_once_it_leaves() {
    let mut fixture = fixture();
    join(&mut fixture.hub, 1, 1);
    assert!(!fixture.hub.observing());
    let out = fixture.hub.message(1, subscribe(true, false));
    assert!(fixture.hub.observing());
    assert_eq!(pids(&out[0]), [4, 100], "system and own session only");
    fixture.hub.disconnected(1);
    assert!(!fixture.hub.observing());
    assert!(!fixture.processes.running.load(Ordering::SeqCst));
}

#[test]
fn a_second_subscriber_shares_the_source_and_sees_only_its_own_session() {
    let mut fixture = fixture();
    join(&mut fixture.hub, 1, 1);
    join(&mut fixture.hub, 2, 2);
    let _ = fixture.hub.message(1, subscribe(true, false));
    let out = fixture.hub.message(2, subscribe(true, false));
    assert_eq!(fixture.processes.starts.load(Ordering::SeqCst), 1);
    assert_eq!(pids(&out[0]), [4, 200]);
}

#[test]
fn process_events_reach_only_the_agents_that_may_see_them() {
    let mut fixture = fixture();
    join(&mut fixture.hub, 1, 1);
    join(&mut fixture.hub, 2, 2);
    let _ = fixture.hub.message(1, subscribe(true, false));
    let _ = fixture.hub.message(2, subscribe(true, false));

    let own = fixture.hub.process(ProcessEvent::Started(raw(300, 1)));
    assert!(matches!(
        own.as_slice(),
        [
            Output::Send(
                1,
                HelperToAgent::ProcessStarted {
                    process: HelperProcess {
                        scope: ProcessScope::CandidateSession,
                        identity: HelperIdentity::Pending,
                        ..
                    }
                }
            ),
            Output::Identify {
                pid: 300,
                created: 3_000,
                ..
            }
        ]
    ));
    let system = fixture.hub.process(ProcessEvent::Started(raw(301, 0)));
    let sent = system
        .iter()
        .filter(|output| matches!(output, Output::Send(..)))
        .count();
    assert_eq!(sent, 2, "a system process is visible to both");

    let exited = fixture.hub.process(ProcessEvent::Stopped {
        pid: 300,
        created: 3_000,
    });
    assert!(matches!(
        exited.as_slice(),
        [Output::Send(1, HelperToAgent::ProcessExited { .. })]
    ));
    let stale = fixture.hub.process(ProcessEvent::Stopped {
        pid: 300,
        created: 3_000,
    });
    assert!(stale.is_empty());
}

#[test]
fn lost_events_send_a_loss_and_a_fresh_snapshot() {
    let mut fixture = fixture();
    join(&mut fixture.hub, 1, 1);
    let _ = fixture.hub.message(1, subscribe(true, false));
    fixture
        .processes
        .snapshot
        .lock()
        .expect("lock")
        .push(raw(500, 1));
    let out = fixture.hub.process(ProcessEvent::Lost);
    assert!(matches!(
        out[0],
        Output::Send(
            1,
            HelperToAgent::Lost {
                reason: HelperLoss::EventsDropped
            }
        )
    ));
    assert_eq!(pids(&out[1]), [4, 100, 500]);
}

#[test]
fn sessions_are_reported_on_subscribe_and_on_change_only() {
    let mut fixture = fixture();
    join(&mut fixture.hub, 1, 1);
    let out = fixture.hub.message(1, subscribe(false, true));
    assert!(matches!(
        out.as_slice(),
        [Output::Send(1, HelperToAgent::Sessions(_))]
    ));
    assert!(fixture.hub.sessions_changed().is_empty());
    *fixture.sessions.0.lock().expect("lock") = Some((Some(1), vec![session(1, true)]));
    let changed = fixture.hub.sessions_changed();
    assert!(matches!(
        changed.as_slice(),
        [Output::Send(1, HelperToAgent::Sessions(report))] if report.sessions[0].locked == Some(true)
    ));
}

#[test]
fn heartbeats_go_only_to_subscribed_agents() {
    let mut fixture = fixture();
    join(&mut fixture.hub, 1, 1);
    join(&mut fixture.hub, 2, 1);
    let _ = fixture.hub.message(1, subscribe(false, true));
    let beats: Vec<PeerId> = fixture
        .hub
        .tick()
        .into_iter()
        .filter_map(|output| match output {
            Output::Send(peer, HelperToAgent::Heartbeat) => Some(peer),
            _ => None,
        })
        .collect();
    assert_eq!(beats, [1]);
}

#[test]
fn a_protocol_error_closes_only_that_agent() {
    let mut fixture = fixture();
    fixture.hub.connected(1, 1);
    let out = fixture.hub.message(1, subscribe(true, true));
    assert_eq!(
        out,
        [
            Output::Send(
                1,
                HelperToAgent::Refused {
                    code: HelperRefusal::InvalidMessage
                }
            ),
            Output::Close(1)
        ]
    );
    assert!(!fixture.hub.observing());
}

/// A byte channel that implements `Read` and `Write`, standing in for a pipe.
struct ChannelReader {
    inbox: Receiver<Vec<u8>>,
    pending: Vec<u8>,
}

impl Read for ChannelReader {
    fn read(&mut self, buffer: &mut [u8]) -> io::Result<usize> {
        if self.pending.is_empty() {
            match self.inbox.recv() {
                Ok(bytes) => self.pending = bytes,
                Err(_) => return Ok(0),
            }
        }
        let count = buffer.len().min(self.pending.len());
        buffer[..count].copy_from_slice(&self.pending[..count]);
        self.pending.drain(..count);
        Ok(count)
    }
}

struct ChannelWriter(Sender<Vec<u8>>);

impl Write for ChannelWriter {
    fn write(&mut self, bytes: &[u8]) -> io::Result<usize> {
        self.0
            .send(bytes.to_vec())
            .map_err(|_| io::Error::from(io::ErrorKind::BrokenPipe))?;
        Ok(bytes.len())
    }

    fn flush(&mut self) -> io::Result<()> {
        Ok(())
    }
}

struct OneAgent {
    peer: Mutex<Option<crate::platform::Peer>>,
    woken: Mutex<bool>,
    wake: std::sync::Condvar,
}

impl Listener for OneAgent {
    fn accept(&self) -> io::Result<crate::platform::Peer> {
        if let Some(peer) = self.peer.lock().expect("lock").take() {
            return Ok(peer);
        }
        let mut woken = self.woken.lock().expect("lock");
        while !*woken {
            woken = self.wake.wait(woken).expect("wait");
        }
        Err(io::Error::from(io::ErrorKind::Interrupted))
    }

    fn wake(&self) {
        *self.woken.lock().expect("lock") = true;
        self.wake.notify_all();
    }
}

struct Allow(bool);

impl PeerCheck for Allow {
    fn authorize(&self, _peer: &crate::platform::Peer) -> bool {
        self.0
    }
}

/// The test's ends of a running `serve`: bytes to the helper, bytes from it, controls, and the
/// server thread.
struct Running {
    to_helper: Sender<Vec<u8>>,
    from_helper: Receiver<Vec<u8>>,
    control: Sender<Control>,
    server: std::thread::JoinHandle<()>,
}

fn run_with_agent(authorized: bool, failures: u32) -> Running {
    let (to_helper, helper_inbox) = mpsc::channel();
    let (helper_outbox, from_helper) = mpsc::channel();
    let agent = OneAgent {
        peer: Mutex::new(Some(crate::platform::Peer {
            audit_token: None,
            pid: 42,
            session: 1,
            reader: Box::new(ChannelReader {
                inbox: helper_inbox,
                pending: Vec::new(),
            }),
            writer: Box::new(ChannelWriter(helper_outbox)),
        })),
        woken: Mutex::new(false),
        wake: std::sync::Condvar::new(),
    };
    let listener: Arc<dyn Listener> = Arc::new(Flaky {
        failures: Mutex::new(failures),
        inner: agent,
    });
    let peers: Arc<dyn PeerCheck> = Arc::new(Allow(authorized));
    let (control, controls) = mpsc::channel();
    let processes = Arc::new(FakeProcesses::default());
    *processes.snapshot.lock().expect("lock") = vec![raw(4, 0), raw(100, 1)];
    let sources = Sources {
        processes,
        sessions: Arc::new(FakeSessions::default()),
        identity: Arc::new(NoIdentity),
    };
    let server = std::thread::spawn(move || serve(sources, &listener, &peers, &controls, DIGEST));
    Running {
        to_helper,
        from_helper,
        control,
        server,
    }
}

fn next_message(from_helper: &Receiver<Vec<u8>>, decoder: &mut Decoder) -> HelperToAgent {
    loop {
        if let Some(message) = decoder.next_message::<HelperToAgent>().expect("valid") {
            return message;
        }
        let bytes = from_helper
            .recv_timeout(Duration::from_secs(5))
            .expect("helper answers");
        decoder.push(&bytes);
    }
}

#[test]
fn serve_welcomes_an_authorized_agent_streams_a_snapshot_and_stops_on_control() {
    let Running {
        to_helper,
        from_helper,
        control,
        server,
    } = run_with_agent(true, 0);
    let mut decoder = Decoder::new();
    to_helper
        .send(encode(&hello()).expect("encodes"))
        .expect("send");
    assert!(matches!(
        next_message(&from_helper, &mut decoder),
        HelperToAgent::Welcome { .. }
    ));
    to_helper
        .send(encode(&subscribe(true, false)).expect("encodes"))
        .expect("send");
    match next_message(&from_helper, &mut decoder) {
        HelperToAgent::ProcessSnapshot { processes } => assert_eq!(processes.len(), 2),
        other => panic!("expected a snapshot, got {other:?}"),
    }
    control.send(Control::Stop).expect("stop");
    drop(to_helper);
    server.join().expect("serve returns");
}

#[test]
fn serve_refuses_an_unauthorized_agent() {
    let Running {
        to_helper: _to_helper,
        from_helper,
        control,
        server,
    } = run_with_agent(false, 0);
    let mut decoder = Decoder::new();
    assert_eq!(
        next_message(&from_helper, &mut decoder),
        HelperToAgent::Refused {
            code: HelperRefusal::UnauthorizedPeer
        }
    );
    control.send(Control::Stop).expect("stop");
    server.join().expect("serve returns");
}

struct UnreadableSnapshot;
impl ProcessSource for UnreadableSnapshot {
    fn start(&self, _: ProcessSink) -> Result<Box<dyn ProcessWatch>, String> {
        Ok(Box::new(FakeWatch(Arc::new(AtomicBool::new(true)))))
    }
    fn snapshot(&self) -> Option<Vec<RawStart>> {
        None
    }
}

#[test]
fn an_unreadable_snapshot_never_becomes_a_complete_empty_inventory() {
    let mut hub = Hub::new(
        Sources {
            processes: Arc::new(UnreadableSnapshot),
            sessions: Arc::new(FakeSessions::default()),
            identity: Arc::new(NoIdentity),
        },
        DIGEST,
        Arc::new(|_, _| {}),
    );
    join(&mut hub, 1, 1);
    let output = hub.message(1, subscribe(true, false));
    assert!(matches!(
        output.as_slice(),
        [Output::Send(1, HelperToAgent::Lost { .. })]
    ));
    let lost = hub.process(ProcessEvent::Lost);
    assert!(matches!(
        lost.as_slice(),
        [Output::Send(1, HelperToAgent::Lost { .. })]
    ));
    assert!(hub.tick().iter().all(|output| !matches!(
        output,
        Output::Send(_, HelperToAgent::ProcessSnapshot { .. })
    )));
}

#[test]
fn event_bound_identity_is_kept_even_if_the_process_has_already_exited() {
    use prctr_protocol::helper::HelperIdentity;
    let mut fixture = fixture();
    join(&mut fixture.hub, 1, 1);
    let _ = fixture.hub.message(1, subscribe(true, false));
    let output = fixture.hub.process(ProcessEvent::Observed {
        start: raw(300, 1),
        identity: HelperIdentity::Unsigned,
    });
    assert!(
        matches!(output.as_slice(), [Output::Send(1, HelperToAgent::ProcessStarted { process })] if process.identity == HelperIdentity::Unsigned)
    );
}

struct WatchedSessions(Arc<AtomicBool>);
struct SessionGuard(Arc<AtomicBool>);
impl crate::platform::SessionWatch for SessionGuard {}
impl Drop for SessionGuard {
    fn drop(&mut self) {
        self.0.store(false, Ordering::SeqCst);
    }
}
impl SessionSource for WatchedSessions {
    fn start(&self) -> Result<Option<Box<dyn crate::platform::SessionWatch>>, String> {
        self.0.store(true, Ordering::SeqCst);
        Ok(Some(Box::new(SessionGuard(Arc::clone(&self.0)))))
    }
    fn read(&self) -> Option<RawSessions> {
        assert!(
            self.0.load(Ordering::SeqCst),
            "notifications must precede the first snapshot"
        );
        Some((Some(1), vec![session(1, false)]))
    }
}
#[test]
fn session_observation_starts_before_reading_and_stops_after_the_last_subscriber() {
    let running = Arc::new(AtomicBool::new(false));
    let mut hub = Hub::new(
        Sources {
            processes: Arc::new(FakeProcesses::default()),
            sessions: Arc::new(WatchedSessions(Arc::clone(&running))),
            identity: Arc::new(NoIdentity),
        },
        DIGEST,
        Arc::new(|_, _| {}),
    );
    assert!(!running.load(Ordering::SeqCst));
    join(&mut hub, 1, 1);
    let _ = hub.message(1, subscribe(false, true));
    assert!(running.load(Ordering::SeqCst));
    hub.disconnected(1);
    assert!(!running.load(Ordering::SeqCst));
}

#[test]
fn a_dead_source_becomes_unavailable_and_events_from_its_old_generation_are_ignored() {
    let mut fixture = fixture();
    join(&mut fixture.hub, 1, 1);
    let _ = fixture.hub.message(1, subscribe(true, false));
    let old_generation = fixture.hub.source_generation;
    let output = fixture.hub.process(ProcessEvent::Unavailable);
    assert!(matches!(
        output.as_slice(),
        [Output::Send(1, HelperToAgent::Lost { .. })]
    ));
    assert!(!fixture.hub.observing());
    assert!(!fixture.hub.snapshot_ready);
    let _ = fixture.hub.tick();
    assert!(fixture.hub.observing());
    assert!(fixture.hub.snapshot_ready);
    assert!(
        fixture
            .hub
            .process_generation(old_generation, ProcessEvent::Unavailable)
            .is_empty()
    );
    assert!(fixture.hub.observing());
}

fn identify_requests(outputs: &[Output]) -> Vec<(u64, u32, u64)> {
    outputs
        .iter()
        .filter_map(|output| match output {
            Output::Identify {
                generation,
                pid,
                created,
            } => Some((*generation, *pid, *created)),
            _ => None,
        })
        .collect()
}

#[test]
fn identities_are_verified_off_the_hub_and_reported_once_known() {
    let mut fixture = fixture();
    join(&mut fixture.hub, 1, 1);
    let subscribed = fixture.hub.message(1, subscribe(true, false));
    let requests = identify_requests(&subscribed);
    assert_eq!(requests.len(), 3, "every snapshot process awaits identity");
    let (generation, pid, created) = requests[1];
    assert_eq!(pid, 100);
    let identified = fixture
        .hub
        .identified(generation, pid, created, HelperIdentity::Unsigned);
    assert!(matches!(
        identified.as_slice(),
        [Output::Send(
            1,
            HelperToAgent::ProcessIdentified {
                identity: HelperIdentity::Unsigned,
                ..
            }
        )]
    ));
    assert!(
        fixture
            .hub
            .identified(generation, pid, created, HelperIdentity::Unsigned)
            .is_empty(),
        "an identity is reported once"
    );
    let (_, hidden, hidden_created) = requests[2];
    assert!(
        fixture
            .hub
            .identified(generation, hidden, hidden_created, HelperIdentity::Unsigned)
            .is_empty(),
        "another user's process is never reported"
    );
}

#[test]
fn a_stale_identity_is_ignored_after_exit_reuse_or_restart() {
    let mut fixture = fixture();
    join(&mut fixture.hub, 1, 1);
    let subscribed = fixture.hub.message(1, subscribe(true, false));
    let (generation, pid, created) = identify_requests(&subscribed)[1];
    let _ = fixture.hub.process(ProcessEvent::Stopped { pid, created });
    assert!(
        fixture
            .hub
            .identified(generation, pid, created, HelperIdentity::Unsigned)
            .is_empty()
    );
    assert!(
        fixture
            .hub
            .identified(generation + 1, 4, 40, HelperIdentity::Unsigned)
            .is_empty(),
        "a result from an earlier source generation"
    );
}

/// A listener that fails `failures` times before handing over one agent.
struct Flaky {
    failures: Mutex<u32>,
    inner: OneAgent,
}

impl Listener for Flaky {
    fn accept(&self) -> io::Result<crate::platform::Peer> {
        let mut failures = self.failures.lock().expect("lock");
        if *failures > 0 {
            *failures -= 1;
            return Err(io::Error::from(io::ErrorKind::ConnectionAborted));
        }
        drop(failures);
        self.inner.accept()
    }

    fn wake(&self) {
        self.inner.wake();
    }
}

#[test]
fn the_accept_back_off_grows_to_a_bound() {
    assert!(accept_backoff(1) < accept_backoff(3));
    assert_eq!(accept_backoff(40), MAX_ACCEPT_BACKOFF);
}

#[test]
fn failed_accepts_do_not_stop_the_helper_and_identities_follow_the_snapshot() {
    let Running {
        to_helper,
        from_helper,
        control,
        server,
    } = run_with_agent(true, 3);
    let mut decoder = Decoder::new();
    to_helper
        .send(encode(&hello()).expect("encodes"))
        .expect("send");
    assert!(matches!(
        next_message(&from_helper, &mut decoder),
        HelperToAgent::Welcome { .. }
    ));
    to_helper
        .send(encode(&subscribe(true, false)).expect("encodes"))
        .expect("send");
    let mut identified = 0;
    while identified < 2 {
        match next_message(&from_helper, &mut decoder) {
            HelperToAgent::ProcessSnapshot { processes } => assert!(
                processes
                    .iter()
                    .all(|process| process.identity == HelperIdentity::Pending)
            ),
            HelperToAgent::ProcessIdentified { identity, .. } => {
                assert_eq!(identity, HelperIdentity::Unavailable);
                identified += 1;
            }
            HelperToAgent::Heartbeat => {}
            other => panic!("unexpected {other:?}"),
        }
    }
    control.send(Control::Stop).expect("stop");
    drop(to_helper);
    server.join().expect("serve returns");
}
