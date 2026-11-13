//! launchd daemon composition, with connection-bound code checks and subscription-owned ES clients.
use crate::platform::{
    Listener, Peer, PeerCheck, ProcessEvent, ProcessSink, ProcessSource, ProcessWatch,
    SessionSource, SessionWatch,
};
use crate::sessions::RawSessionInfo;
use prctr_os::macos::helper as os;
use std::collections::BTreeMap;
use std::io;
use std::os::unix::net::{UnixListener, UnixStream};
use std::sync::{
    Arc, Mutex,
    atomic::{AtomicBool, Ordering},
    mpsc,
};

pub const SOCKET: &str = "/var/run/com.proctor.native/agent.sock";
pub struct Socket {
    listener: UnixListener,
    stopped: AtomicBool,
}
impl Socket {
    /// # Errors
    /// Requires root and the one launchd socket declared in the shipped plist.
    pub fn activate() -> io::Result<Self> {
        Ok(Self {
            listener: os::activate_socket()?,
            stopped: AtomicBool::new(false),
        })
    }
}
impl Listener for Socket {
    fn accept(&self) -> io::Result<Peer> {
        if self.stopped.load(Ordering::Acquire) {
            return Err(io::ErrorKind::Interrupted.into());
        }
        let (stream, _) = self.listener.accept()?;
        if self.stopped.load(Ordering::Acquire) {
            return Err(io::ErrorKind::Interrupted.into());
        }
        let token = os::peer_token(&stream)?;
        let (reader, writer) = prctr_os::helper::unix_halves(stream)?;
        Ok(Peer {
            pid: token[5],
            session: token[6],
            audit_token: Some(token),
            reader: Box::new(reader),
            writer: Box::new(writer),
        })
    }
    fn wake(&self) {
        self.stopped.store(true, Ordering::Release);
        let _ = UnixStream::connect(SOCKET);
    }
}
pub struct AgentPeer;
impl PeerCheck for AgentPeer {
    fn authorize(&self, peer: &Peer) -> bool {
        peer.audit_token.is_some_and(|token| {
            token[5] == peer.pid && token[6] == peer.session && os::authorize_agent(token)
        })
    }
}

pub struct Processes;
struct ProcessGuard {
    _watch: os::Watch,
}
impl ProcessWatch for ProcessGuard {}
impl ProcessSource for Processes {
    fn start(&self, sink: ProcessSink) -> Result<Box<dyn ProcessWatch>, String> {
        let watch = os::watch(
            true,
            Box::new(move |event| match event {
                os::Event::Started(start, Some(identity)) => sink(ProcessEvent::Observed {
                    start: crate::os_start(start),
                    identity: crate::os_identity(identity),
                }),
                os::Event::Started(start, None) => {
                    sink(ProcessEvent::Started(crate::os_start(start)));
                }
                os::Event::Stopped { pid, created } => sink(ProcessEvent::Stopped { pid, created }),
                os::Event::Lost => sink(ProcessEvent::Lost),
                _ => {}
            }),
        )
        .map_err(|error| error.to_string())?;
        Ok(Box::new(ProcessGuard { _watch: watch }))
    }
    fn snapshot(&self) -> Option<Vec<crate::processes::RawStart>> {
        Some(os::snapshot()?.into_iter().map(crate::os_start).collect())
    }
}
pub struct Identity;
impl crate::platform::IdentitySource for Identity {
    fn identify(&self, pid: u32) -> prctr_protocol::helper::HelperIdentity {
        crate::os_identity(prctr_os::macos::identity(pid))
    }
}

#[derive(Default)]
struct SessionState {
    active: bool,
    lost: bool,
    locks: BTreeMap<u64, bool>,
    sharing: BTreeMap<u32, (Option<u64>, u32)>,
}
impl SessionState {
    fn observe(&mut self, event: &os::Event) {
        match event {
            os::Event::Lost => {
                self.lost = true;
                self.locks.clear();
                self.sharing.clear();
            }
            os::Event::Lock { user_key, locked } => {
                self.locks.insert(*user_key, *locked);
            }
            os::Event::Sharing {
                graphical,
                attached,
                user_key,
            } => {
                let (user, count) = self.sharing.entry(*graphical).or_default();
                if user_key.is_some() {
                    *user = *user_key;
                }
                *count = if *attached {
                    count.saturating_add(1)
                } else {
                    count.saturating_sub(1)
                };
            }
            os::Event::SessionUserChanged { user_key } => {
                self.locks.remove(user_key);
                self.sharing.retain(|_, (user, _)| *user != Some(*user_key));
            }
            _ => {}
        }
        if self.locks.len() + self.sharing.len() > prctr_os::helper::MAX_SESSIONS {
            self.lost = true;
            self.locks.clear();
            self.sharing.clear();
        }
    }
    fn report(
        &mut self,
        console: Option<u32>,
        sessions: Vec<os::ConsoleSession>,
        sharing: bool,
    ) -> Option<(Option<u32>, Vec<RawSessionInfo>)> {
        if !self.active {
            return None;
        }
        // A fresh complete initial-state read recovers notification loss. Unknown lock or
        // unassignable remote state remains unavailable instead of becoming a negative fact.
        if self.lost && sessions.iter().any(|session| session.info.locked.is_none()) {
            return None;
        }
        self.lost = false;
        let active: Vec<_> = self
            .sharing
            .values()
            .filter(|(_, count)| *count > 0)
            .collect();
        if active.iter().any(|(user, _)| user.is_none()) {
            return None;
        }
        let unassigned_initial_sharing = sharing && active.is_empty();
        if unassigned_initial_sharing && sessions.len() != 1 {
            return None;
        }
        let mut result = Vec::new();
        for session in sessions {
            let mut info = session.info;
            if let Some(locked) = self.locks.get(&session.user_key) {
                info.locked = Some(*locked);
            }
            info.remote = unassigned_initial_sharing
                || active
                    .iter()
                    .any(|(user, _)| *user == Some(session.user_key));
            result.push(crate::os_session(info));
        }
        Some((console, result))
    }
}
#[derive(Default)]
pub struct Sessions {
    state: Arc<Mutex<SessionState>>,
    /// Where session events are announced, so the hub re-reads at once.
    changed: Option<Mutex<mpsc::Sender<crate::platform::Control>>>,
}

impl Sessions {
    fn announcing(changed: mpsc::Sender<crate::platform::Control>) -> Self {
        Self {
            state: Arc::default(),
            changed: Some(Mutex::new(changed)),
        }
    }
}
struct SessionGuard {
    _watch: os::Watch,
    state: Arc<Mutex<SessionState>>,
}
impl SessionWatch for SessionGuard {}
impl Drop for SessionGuard {
    fn drop(&mut self) {
        if let Ok(mut state) = self.state.lock() {
            state.active = false;
        }
    }
}
impl SessionSource for Sessions {
    fn start(&self) -> Result<Option<Box<dyn SessionWatch>>, String> {
        let state = Arc::clone(&self.state);
        *state.lock().map_err(|_| "Session state unavailable")? = SessionState {
            active: true,
            ..Default::default()
        };
        let updates = Arc::clone(&state);
        let changed = self
            .changed
            .as_ref()
            .and_then(|changed| changed.lock().ok().map(|sender| sender.clone()));
        let watch = match os::watch(
            false,
            Box::new(move |event| {
                {
                    let Ok(mut state) = updates.lock() else {
                        return;
                    };
                    state.observe(&event);
                }
                if let Some(changed) = changed.as_ref() {
                    let _ = changed.send(crate::platform::Control::SessionChanged);
                }
            }),
        ) {
            Ok(watch) => watch,
            Err(error) => {
                if let Ok(mut state) = state.lock() {
                    state.active = false;
                }
                return Err(error.to_string());
            }
        };
        Ok(Some(Box::new(SessionGuard {
            _watch: watch,
            state,
        })))
    }
    fn read(&self) -> Option<(Option<u32>, Vec<RawSessionInfo>)> {
        let (console, sessions) = os::initial_sessions()?;
        let sharing = os::screen_sharing()?;
        let mut state = self.state.lock().ok()?;
        state.report(console, sessions, sharing)
    }
}

/// # Errors
/// Requires root and a valid launchd listening socket.
pub fn run() -> io::Result<()> {
    if !os::is_root() {
        return Err(io::ErrorKind::PermissionDenied.into());
    }
    let listener: Arc<dyn Listener> = Arc::new(Socket::activate()?);
    let peers: Arc<dyn PeerCheck> = Arc::new(AgentPeer);
    let (sender, controls) = mpsc::channel();
    let sessions = Sessions::announcing(sender.clone());
    std::thread::Builder::new()
        .name("prctr-helper-stop".into())
        .spawn(move || {
            let _ = os::wait_for_stop();
            let _ = sender.send(crate::platform::Control::Stop);
        })?;
    crate::hub::serve(
        crate::hub::Sources {
            processes: Arc::new(Processes),
            sessions: Arc::new(sessions),
            identity: Arc::new(Identity),
        },
        &listener,
        &peers,
        &controls,
        crate::PROTOCOL_DIGEST,
    );
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{SessionState, os};
    fn session(id: u32, user_key: u64, locked: Option<bool>) -> os::ConsoleSession {
        os::ConsoleSession {
            user_key,
            info: prctr_os::helper::SessionInfo {
                id,
                attachment: prctr_os::helper::Attachment::Active,
                has_user: true,
                remote: false,
                locked,
            },
        }
    }
    fn state() -> SessionState {
        SessionState {
            active: true,
            ..Default::default()
        }
    }
    #[test]
    fn graphical_and_audit_ids_are_kept_distinct_and_remote_state_is_scoped_by_user() {
        let mut state = state();
        state.observe(&os::Event::Sharing {
            graphical: 123,
            attached: true,
            user_key: Some(42),
        });
        let (_, sessions) = state
            .report(
                Some(7),
                vec![session(7, 42, Some(false)), session(8, 99, Some(true))],
                true,
            )
            .expect("assigned sharing");
        assert_eq!(sessions[0].id, 7);
        assert!(sessions[0].remote);
        assert!(!sessions[1].remote);
    }
    #[test]
    fn initial_remote_state_is_unavailable_when_multiple_sessions_cannot_be_disambiguated() {
        let mut state = state();
        assert!(
            state
                .report(
                    Some(7),
                    vec![session(7, 42, Some(false)), session(8, 99, Some(true))],
                    true
                )
                .is_none()
        );
        let (_, sessions) = state
            .report(Some(7), vec![session(7, 42, Some(false))], true)
            .expect("only session");
        assert!(sessions[0].remote);
        state.observe(&os::Event::Sharing {
            graphical: 123,
            attached: true,
            user_key: None,
        });
        assert!(
            state
                .report(Some(7), vec![session(7, 42, Some(false))], true)
                .is_none()
        );
    }
    #[test]
    fn login_logout_and_loss_do_not_reuse_an_old_users_lock_state() {
        let mut state = state();
        state.observe(&os::Event::Lock {
            user_key: 42,
            locked: true,
        });
        let (_, sessions) = state
            .report(Some(7), vec![session(7, 42, Some(false))], false)
            .expect("live lock");
        assert_eq!(sessions[0].locked, Some(true));
        state.observe(&os::Event::SessionUserChanged { user_key: 42 });
        let (_, sessions) = state
            .report(Some(8), vec![session(8, 42, Some(false))], false)
            .expect("fresh login");
        assert_eq!(sessions[0].locked, Some(false));
        state.observe(&os::Event::Lost);
        assert!(
            state
                .report(Some(8), vec![session(8, 42, None)], false)
                .is_none()
        );
        assert!(
            state
                .report(Some(8), vec![session(8, 42, Some(false))], false)
                .is_some()
        );
    }
}
