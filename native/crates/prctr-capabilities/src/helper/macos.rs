use super::{ComponentStatus, HelperLink, HelperStream};
use prctr_os::macos::helper as os;
pub use prctr_os::macos::helper::{Registration, registration};
use std::io;
use std::os::unix::net::UnixStream;

pub struct Link;
impl HelperLink for Link {
    fn connect(&self) -> io::Result<HelperStream> {
        let stream = UnixStream::connect("/var/run/com.proctor.native/agent.sock")?;
        if os::peer_uid(&stream)? != 0 {
            return Err(io::ErrorKind::PermissionDenied.into());
        }
        let (reader, writer) = prctr_os::helper::unix_halves(stream)?;
        Ok(HelperStream {
            reader: Box::new(reader),
            writer: Box::new(writer),
        })
    }
    fn status(&self) -> ComponentStatus {
        match os::registration(false) {
            Ok(Registration::NotRegistered) => ComponentStatus::NotInstalled,
            Ok(Registration::RequiresApproval) => ComponentStatus::RequiresApproval,
            Ok(Registration::Enabled) => ComponentStatus::Running,
            Err(_) => ComponentStatus::Unknown,
        }
    }
}
