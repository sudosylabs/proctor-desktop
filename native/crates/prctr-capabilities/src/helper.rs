//! The agent's side of the privileged helper: one connection shared by the process and session
//! capabilities. It keeps a live view (processes, sessions) from the helper's messages and wakes
//! each listening capability on every change. The connection itself comes from a platform
//! [`HelperLink`] (named pipe on Windows, Unix socket on macOS), written separately; see
//! `.scratch/native-rewrite/os-layer-spec.md`.

use std::collections::BTreeMap;
use std::io::{self, Read, Write};
use std::sync::{Arc, Mutex, PoisonError};
use std::thread;
use std::time::{Duration, Instant};

use prctr_protocol::frame::{Decoder, encode};
use prctr_protocol::helper::{
    AgentToHelper, HelperIdentity, HelperProcess, HelperSessions, HelperToAgent,
};
use prctr_protocol::scalars::Digest;
use schemars::JsonSchema;
use serde::Serialize;

/// The helper protocol digest this build speaks.
pub const PROTOCOL_DIGEST: &str =
    include_str!("../../prctr-protocol/schema/helper-protocol.digest");
/// A subscribed helper sends a heartbeat every second; this long without any message is a stall.
pub const STALL: Duration = Duration::from_secs(3);

/// Whether the privileged component is installed and running, as the OS's service manager
/// (Windows) or launchd registration (macOS) reports it.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum ComponentStatus {
    NotInstalled,
    /// Installed but waiting for the user's approval (macOS Login Items).
    RequiresApproval,
    Stopped,
    Running,
    /// This platform has no privileged component.
    Unsupported,
    Unknown,
}

/// A connection to the helper.
pub struct HelperStream {
    pub reader: Box<dyn Read + Send>,
    pub writer: Box<dyn Write + Send>,
}

pub trait HelperLink: Send + Sync {
    /// Connects to the running helper and verifies it is the installed component.
    ///
    /// # Errors
    /// When the helper is not running or is not the installed component.
    fn connect(&self) -> io::Result<HelperStream>;
    fn status(&self) -> ComponentStatus;
}

/// What the capabilities read: the helper's current view.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct HelperView {
    pub connected: bool,
    /// Every visible process by instance, once the first snapshot arrived.
    pub processes: Option<BTreeMap<u64, HelperProcess>>,
    pub sessions: Option<HelperSessions>,
}

/// What a listener is told changed.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum HelperChange {
    Processes,
    Sessions,
    /// The connection ended; the view is empty.
    Disconnected,
}

type Listener = Arc<dyn Fn(HelperChange) + Send + Sync>;

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
struct Want {
    processes: bool,
    sessions: bool,
}

struct Inner {
    view: HelperView,
    want: Want,
    writer: Option<Box<dyn Write + Send>>,
    listeners: BTreeMap<u64, Listener>,
    next_listener: u64,
    last_message: Instant,
    /// Increases on every connection, so a stale reader thread cannot touch a newer one.
    generation: u64,
}

pub struct HelperClient {
    link: Arc<dyn HelperLink>,
    inner: Mutex<Inner>,
}

/// Applies one helper message to the view and says what changed.
#[must_use]
pub fn apply(view: &mut HelperView, message: HelperToAgent) -> Option<HelperChange> {
    match message {
        HelperToAgent::ProcessSnapshot { processes } => {
            view.processes = Some(
                processes
                    .into_iter()
                    .map(|process| (process.instance.get(), process))
                    .collect(),
            );
            Some(HelperChange::Processes)
        }
        HelperToAgent::ProcessStarted { process } => {
            let processes = view.processes.as_mut()?;
            processes.insert(process.instance.get(), process);
            Some(HelperChange::Processes)
        }
        HelperToAgent::ProcessIdentified { instance, identity } => {
            let process = view.processes.as_mut()?.get_mut(&instance.get())?;
            process.identity = identity;
            Some(HelperChange::Processes)
        }
        HelperToAgent::ProcessExited { instance } => {
            view.processes.as_mut()?.remove(&instance.get())?;
            Some(HelperChange::Processes)
        }
        HelperToAgent::Sessions(sessions) => {
            view.sessions = Some(sessions);
            Some(HelperChange::Sessions)
        }
        // The helper follows a loss with fresh snapshots; until then nothing is complete.
        HelperToAgent::Lost { .. } => {
            view.processes = None;
            Some(HelperChange::Processes)
        }
        HelperToAgent::Welcome { .. } | HelperToAgent::Heartbeat => None,
        HelperToAgent::Refused { .. } => Some(HelperChange::Disconnected),
    }
}

impl HelperClient {
    #[must_use]
    pub fn new(link: Arc<dyn HelperLink>) -> Arc<Self> {
        Arc::new(Self {
            link,
            inner: Mutex::new(Inner {
                view: HelperView::default(),
                want: Want::default(),
                writer: None,
                listeners: BTreeMap::new(),
                next_listener: 0,
                last_message: Instant::now(),
                generation: 0,
            }),
        })
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, Inner> {
        self.inner.lock().unwrap_or_else(PoisonError::into_inner)
    }

    #[must_use]
    pub fn status(&self) -> ComponentStatus {
        self.link.status()
    }

    /// The current view; a stalled connection reads as disconnected.
    #[must_use]
    pub fn view(&self) -> HelperView {
        let inner = self.lock();
        if inner.view.connected && inner.last_message.elapsed() > STALL {
            return HelperView::default();
        }
        inner.view.clone()
    }

    /// Registers a listener; the returned key removes it.
    pub fn listen(&self, listener: impl Fn(HelperChange) + Send + Sync + 'static) -> u64 {
        let mut inner = self.lock();
        inner.next_listener += 1;
        let key = inner.next_listener;
        inner.listeners.insert(key, Arc::new(listener));
        key
    }

    pub fn unlisten(&self, key: u64) {
        self.lock().listeners.remove(&key);
    }

    /// Asks for processes and/or sessions (`None` keeps the current choice), connecting when
    /// something is wanted and disconnecting when nothing is. Returns whether it is connected.
    pub fn want(self: &Arc<Self>, processes: Option<bool>, sessions: Option<bool>) -> bool {
        let mut inner = self.lock();
        inner.want = Want {
            processes: processes.unwrap_or(inner.want.processes),
            sessions: sessions.unwrap_or(inner.want.sessions),
        };
        let want = inner.want;
        if !want.processes && !want.sessions {
            Self::disconnect(&mut inner);
            return false;
        }
        if inner.writer.is_none() {
            drop(inner);
            if !self.connect() {
                return false;
            }
            inner = self.lock();
        }
        let subscribe = AgentToHelper::Subscribe {
            processes: want.processes,
            sessions: want.sessions,
        };
        if !Self::send(&mut inner, &subscribe) {
            Self::disconnect(&mut inner);
            return false;
        }
        if !want.processes {
            inner.view.processes = None;
        }
        if !want.sessions {
            inner.view.sessions = None;
        }
        true
    }

    fn send(inner: &mut Inner, message: &AgentToHelper) -> bool {
        let Some(writer) = inner.writer.as_mut() else {
            return false;
        };
        let Ok(frame) = encode(message) else {
            return false;
        };
        writer
            .write_all(&frame)
            .and_then(|()| writer.flush())
            .is_ok()
    }

    fn disconnect(inner: &mut Inner) {
        inner.writer = None;
        inner.generation += 1;
        inner.view = HelperView::default();
    }

    fn connect(self: &Arc<Self>) -> bool {
        let Ok(stream) = self.link.connect() else {
            return false;
        };
        let Ok(digest) = Digest::new(PROTOCOL_DIGEST.trim()) else {
            return false;
        };
        let mut inner = self.lock();
        inner.generation += 1;
        let generation = inner.generation;
        inner.writer = Some(stream.writer);
        inner.view = HelperView {
            connected: true,
            ..HelperView::default()
        };
        inner.last_message = Instant::now();
        if !Self::send(
            &mut inner,
            &AgentToHelper::Hello {
                protocol_digest: digest,
            },
        ) {
            Self::disconnect(&mut inner);
            return false;
        }
        drop(inner);
        let client = Arc::clone(self);
        let reader = stream.reader;
        thread::Builder::new()
            .name("prctr-helper-client".into())
            .spawn(move || client.read(reader, generation))
            .is_ok()
    }

    fn read(&self, mut reader: Box<dyn Read + Send>, generation: u64) {
        let mut decoder = Decoder::new();
        let mut buffer = vec![0_u8; 64 * 1024];
        'connection: loop {
            match reader.read(&mut buffer) {
                Ok(0) | Err(_) => break,
                Ok(count) => decoder.push(&buffer[..count]),
            }
            loop {
                let message = match decoder.next_message::<HelperToAgent>() {
                    Ok(Some(message)) => message,
                    Ok(None) => break,
                    Err(_) => break 'connection,
                };
                if !message.is_bounded() {
                    break 'connection;
                }
                let (change, listeners) = {
                    let mut inner = self.lock();
                    if inner.generation != generation {
                        return;
                    }
                    inner.last_message = Instant::now();
                    let change = apply(&mut inner.view, message);
                    if change == Some(HelperChange::Disconnected) {
                        break 'connection;
                    }
                    let listeners: Vec<Listener> = inner.listeners.values().cloned().collect();
                    (change, listeners)
                };
                if let Some(change) = change {
                    for listener in &listeners {
                        listener(change);
                    }
                }
            }
        }
        let listeners: Vec<Listener> = {
            let mut inner = self.lock();
            if inner.generation != generation {
                return;
            }
            Self::disconnect(&mut inner);
            inner.listeners.values().cloned().collect()
        };
        for listener in &listeners {
            listener(HelperChange::Disconnected);
        }
    }
}

impl ComponentStatus {
    /// The permission a capability that needs this component reports: an absent or stopped
    /// component is an unavailable permission, one awaiting approval is not determined.
    #[must_use]
    pub const fn permission(self) -> prctr_protocol::facts::Permission {
        use prctr_protocol::facts::Permission;
        match self {
            Self::NotInstalled | Self::Stopped => Permission::Unavailable,
            Self::RequiresApproval => Permission::NotDetermined,
            Self::Running | Self::Unsupported | Self::Unknown => Permission::Granted,
        }
    }

    /// Whether the component should be serving: a missing connection is then a failure.
    #[must_use]
    pub const fn expected_running(self) -> bool {
        matches!(self, Self::Running | Self::Unknown)
    }
}

/// The identity the catalog matches, from the helper's report.
#[must_use]
pub fn raw_identity(identity: &HelperIdentity) -> Option<prctr_os::RawIdentity> {
    use prctr_os::RawIdentity;
    Some(match identity {
        HelperIdentity::Pending => return None,
        HelperIdentity::MacOs {
            signing_identifier,
            team_id,
            apple,
        } => RawIdentity::MacOs {
            signing_identifier: signing_identifier.as_str().to_owned(),
            team_id: team_id.as_ref().map(|team| team.as_str().to_owned()),
            apple: *apple,
        },
        HelperIdentity::Windows {
            publisher,
            original_file_name,
        } => RawIdentity::Windows {
            publisher: publisher.as_str().to_owned(),
            original_file_name: original_file_name.as_str().to_owned(),
        },
        HelperIdentity::Unsigned => RawIdentity::Unsigned,
        HelperIdentity::Unavailable => RawIdentity::Unavailable,
    })
}

#[cfg(test)]
#[path = "helper_tests.rs"]
mod tests;
