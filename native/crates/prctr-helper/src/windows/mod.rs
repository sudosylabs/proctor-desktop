//! Windows service composition. Only OS wrappers in prctr-os perform raw calls.
mod processes;
mod service;

use crate::platform::{Listener, Peer, PeerCheck, SessionSource};
use crate::sessions::RawSessionInfo;
use interprocess::os::windows::{
    named_pipe::{PipeListener, PipeListenerOptions, PipeStream, pipe_mode::Bytes},
    security_descriptor::SecurityDescriptor,
};
use std::io;
use std::sync::{
    Arc,
    atomic::{AtomicBool, Ordering},
};

pub use processes::Processes;
pub use service::{ServiceContext, windows_service_main};
pub const SERVICE_NAME: &str = "ProctorNative";
pub const PIPE: &str = r"\\.\pipe\ProctorNative";

pub struct Pipe {
    listener: PipeListener<Bytes, Bytes>,
    stopped: AtomicBool,
}
impl Pipe {
    /// # Errors
    /// Returns pipe-name ownership, ACL, or listener creation failure.
    pub fn new() -> io::Result<Self> {
        // Interactive users get FILE_GENERIC_READ | FILE_GENERIC_WRITE without
        // FILE_CREATE_PIPE_INSTANCE (0x4), so no user process can serve another instance of the
        // pipe or hold its name while the service is stopped.
        let acl = widestring::U16CString::from_str("D:P(A;;GA;;;SY)(A;;0x0012019B;;;IU)")
            .map_err(io::Error::other)?;
        let security = SecurityDescriptor::deserialize(&acl)?;
        // interprocess 2.4.8 creates the initial instance with FILE_FLAG_FIRST_PIPE_INSTANCE.
        let listener = PipeListenerOptions::new()
            .path(PIPE)
            .accept_remote(false)
            .security_descriptor(Some(security))
            .create_duplex::<Bytes>()?;
        Ok(Self {
            listener,
            stopped: AtomicBool::new(false),
        })
    }
}
impl Listener for Pipe {
    fn accept(&self) -> io::Result<Peer> {
        if self.stopped.load(Ordering::Acquire) {
            return Err(io::ErrorKind::Interrupted.into());
        }
        let stream = self.listener.accept()?;
        if self.stopped.load(Ordering::Acquire) {
            return Err(io::ErrorKind::Interrupted.into());
        }
        let pid = stream.client_process_id()?;
        let session = prctr_os::windows::helper::process_session(pid)
            .ok_or(io::ErrorKind::PermissionDenied)?;
        let (reader, writer) = prctr_os::windows::helper_pipe::split(stream)?;
        Ok(Peer {
            pid,
            session,
            audit_token: None,
            reader: Box::new(reader),
            writer: Box::new(writer),
        })
    }
    fn wake(&self) {
        self.stopped.store(true, Ordering::Release);
        let _ = PipeStream::<Bytes, Bytes>::connect_by_path_with_wait_mode(
            PIPE,
            interprocess::ConnectWaitMode::Timeout(std::time::Duration::from_secs(1)),
        );
    }
}

pub struct AgentPeer;
impl PeerCheck for AgentPeer {
    fn authorize(&self, peer: &Peer) -> bool {
        prctr_os::windows::helper::authorize_agent(peer.pid)
    }
}
pub struct Sessions;
impl SessionSource for Sessions {
    fn read(&self) -> Option<(Option<u32>, Vec<RawSessionInfo>)> {
        let (console, sessions) = prctr_os::windows::helper::sessions()?;
        Some((
            console,
            sessions.into_iter().map(crate::os_session).collect(),
        ))
    }
}

/// # Errors
/// Returns listener initialization failure.
pub fn run(context: &ServiceContext) -> io::Result<()> {
    let listener: Arc<dyn Listener> = Arc::new(Pipe::new()?);
    let peers: Arc<dyn PeerCheck> = Arc::new(AgentPeer);
    crate::hub::serve(
        crate::hub::Sources {
            processes: Arc::new(Processes),
            sessions: Arc::new(Sessions),
            identity: Arc::new(Identity),
        },
        &listener,
        &peers,
        context.controls(),
        crate::PROTOCOL_DIGEST,
    );
    Ok(())
}

struct Identity;
impl crate::platform::IdentitySource for Identity {
    fn identify(&self, pid: u32) -> prctr_protocol::helper::HelperIdentity {
        crate::os_identity(prctr_os::windows::helper::identify(pid))
    }
}
