//! The seams the OS layer implements: where process events, sessions, identities and agent
//! connections come from. The core (`hub`) depends only on these traits, so it is tested with
//! fakes; the Windows service and the macOS daemon supply the real implementations.
//! Platform composition supplies authenticated local connections and subscription-owned watches.

use std::io::{self, Read, Write};

use prctr_protocol::helper::HelperIdentity;

use crate::processes::RawStart;
use crate::sessions::RawSessionInfo;

/// One raw process event from the OS.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum ProcessEvent {
    Started(RawStart),
    /// Identity copied from the same OS event, without querying a possibly reused PID.
    Observed {
        start: RawStart,
        identity: HelperIdentity,
    },
    Stopped {
        pid: u32,
        created: u64,
    },
    /// The OS source dropped events; the core takes a fresh snapshot.
    Lost,
    /// The live source ended; snapshots alone cannot establish lifecycle coverage.
    Unavailable,
}

pub type ProcessSink = Box<dyn Fn(ProcessEvent) + Send + Sync>;

/// A running process event source. Dropping it stops the source.
pub trait ProcessWatch: Send {}

pub trait ProcessSource: Send + Sync {
    /// Starts delivering events to `sink`. The core calls this before `snapshot`, so no process
    /// falls between the two.
    ///
    /// # Errors
    /// Returns a bounded description when the OS source cannot start.
    fn start(&self, sink: ProcessSink) -> Result<Box<dyn ProcessWatch>, String>;
    /// Every process on the machine now.
    fn snapshot(&self) -> Option<Vec<RawStart>>;
}

pub trait SessionWatch: Send {}

pub trait SessionSource: Send + Sync {
    /// Subscribe before the initial read. Dropping the guard stops notifications.
    ///
    /// # Errors
    /// Returns a bounded source-start failure.
    fn start(&self) -> Result<Option<Box<dyn SessionWatch>>, String> {
        Ok(None)
    }

    /// The console session and every session's state.
    fn read(&self) -> Option<(Option<u32>, Vec<RawSessionInfo>)>;
}

pub trait IdentitySource: Send + Sync {
    /// A process's code identity; `Unavailable` when it cannot be read.
    fn identify(&self, pid: u32) -> HelperIdentity;
}

/// The identity source used until a platform supplies one.
pub struct NoIdentity;

impl IdentitySource for NoIdentity {
    fn identify(&self, _pid: u32) -> HelperIdentity {
        HelperIdentity::Unavailable
    }
}

/// One connected agent, before authorization.
pub struct Peer {
    /// The connecting process.
    pub pid: u32,
    /// Connection-bound macOS audit token; absent on other transports.
    pub audit_token: Option<[u32; 8]>,
    /// The connecting process's interactive session.
    pub session: u32,
    pub reader: Box<dyn Read + Send>,
    pub writer: Box<dyn Write + Send>,
}

pub trait Listener: Send + Sync {
    /// Blocks until the next agent connects.
    ///
    /// # Errors
    /// Returns an error when the listener has failed or was woken for shutdown.
    fn accept(&self) -> io::Result<Peer>;
    /// Unblocks a pending `accept` so the service can stop; every later `accept` fails.
    fn wake(&self);
}

pub trait PeerCheck: Send + Sync {
    /// Whether `pid` is this release's agent.
    fn authorize(&self, peer: &Peer) -> bool;
}

/// A control from the service manager or launchd.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Control {
    Stop,
    /// A session logged on or off, locked, unlocked, connected or disconnected.
    SessionChanged,
}
