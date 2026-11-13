//! Agent connection to the installed service; an arbitrary named-pipe server is refused.
use super::{ComponentStatus, HelperLink, HelperStream};
use interprocess::os::windows::named_pipe::{PipeStream, pipe_mode::Bytes};
use std::io;
use windows_service::{
    service::{ServiceAccess, ServiceState},
    service_manager::{ServiceManager, ServiceManagerAccess},
};

const NAME: &str = "ProctorNative";
const PIPE: &str = r"\\.\pipe\ProctorNative";
pub struct Link;

fn query() -> windows_service::Result<windows_service::service::ServiceStatus> {
    ServiceManager::local_computer(None::<&str>, ServiceManagerAccess::CONNECT)?
        .open_service(NAME, ServiceAccess::QUERY_STATUS)?
        .query_status()
}

fn connect_to(
    path: &str,
    expected_server: impl FnOnce() -> io::Result<u32>,
) -> io::Result<HelperStream> {
    let stream = PipeStream::<Bytes, Bytes>::connect_by_path_with_wait_mode(
        path,
        interprocess::ConnectWaitMode::Timeout(std::time::Duration::from_secs(1)),
    )?;
    // Query SCM after opening the pipe, so a service restart cannot authenticate a stale endpoint.
    if stream.server_process_id()? != expected_server()? {
        return Err(io::ErrorKind::PermissionDenied.into());
    }
    let (reader, writer) = prctr_os::windows::helper_pipe::split(stream)?;
    Ok(HelperStream {
        reader: Box::new(reader),
        writer: Box::new(writer),
    })
}

impl HelperLink for Link {
    fn connect(&self) -> io::Result<HelperStream> {
        connect_to(PIPE, || {
            let status = query().map_err(|_| io::Error::from(io::ErrorKind::PermissionDenied))?;
            if status.current_state != ServiceState::Running {
                return Err(io::ErrorKind::PermissionDenied.into());
            }
            status
                .process_id
                .filter(|pid| *pid != 0)
                .ok_or_else(|| io::ErrorKind::PermissionDenied.into())
        })
    }
    fn status(&self) -> ComponentStatus {
        match query() {
            Ok(status) if status.current_state == ServiceState::Running => ComponentStatus::Running,
            Ok(_) => ComponentStatus::Stopped,
            Err(windows_service::Error::Winapi(error)) if error.raw_os_error() == Some(1060) => {
                ComponentStatus::NotInstalled
            }
            Err(_) => ComponentStatus::Unknown,
        }
    }
}

#[cfg(test)]
mod tests {
    use interprocess::os::windows::named_pipe::{PipeListenerOptions, pipe_mode::Bytes};
    #[test]
    fn an_impostor_pipe_server_is_refused_and_a_matching_server_is_accepted() {
        for matches in [false, true] {
            let name = format!(
                r"\\.\pipe\ProctorNativePeerTest-{}-{matches}",
                std::process::id()
            );
            let listener = PipeListenerOptions::new()
                .path(name.as_str())
                .create_duplex::<Bytes>()
                .expect("test listener");
            // Our test process owns the server handle; the simulated SCM query names either
            // that process or a different one. The PID itself is obtained from the real pipe.
            let expected = if matches {
                std::process::id()
            } else {
                std::process::id() + 1
            };
            let result = super::connect_to(&name, || Ok(expected));
            assert_eq!(result.is_ok(), matches);
            // A refused client has already closed its end; accepting would wait for a new one.
            if matches {
                let _peer = listener.accept().expect("accept test connection");
            }
            drop(result);
        }
    }
}
