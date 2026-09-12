//! SCM composition for the retained controlled-main service channel. Selection
//! requires the signed installer inventory; development arguments cannot supply it.
use std::path::PathBuf;
use std::sync::Arc;

use crate::helper_server::{HelperServer, PlatformHelperSourceFactory};
use prctr_interactive_session_state::{WindowsCandidateSession, WindowsWtsServiceDispatcher};
use prctr_native_helper_protocol::{
    HELPER_PROTOCOL_VERSION, HelperFailureCode, HelperHandshake, HelperKind, HelperProtocolError,
    HelperServerMessage,
};
use prctr_native_security_helper::{
    HELPER_BUILD_ID, HelperTransportError, WindowsConfiguredService, WindowsLaunchManifest,
    WindowsSourceChannel, WindowsSourceHandler, run_windows_service,
};

pub(crate) fn run(
    root: PathBuf,
    manifest: WindowsLaunchManifest,
) -> Result<(), HelperTransportError> {
    run_windows_service(Box::new(WindowsConfiguredService::new(
        root,
        manifest,
        SourceHandler,
    )))
}
struct SourceHandler;
impl WindowsSourceHandler for SourceHandler {
    fn serve(
        &mut self,
        channel: &WindowsSourceChannel,
        dispatcher: Arc<WindowsWtsServiceDispatcher>,
        candidate: WindowsCandidateSession,
    ) -> Result<(), HelperTransportError> {
        let factory = PlatformHelperSourceFactory::from_verified_session(dispatcher, candidate);
        let mut server = HelperServer::new(channel.channel_nonce().to_owned(), factory);
        let result = serve(&mut server, channel);
        // Source intake is fenced before the outer owner closes the transport,
        // observes the controlled job's exit and permits a fresh service client.
        let (tail, cleanup) = server.close_all();
        let delivery = if result.is_ok() {
            channel.stopping().and_then(|stopping| {
                if stopping {
                    Ok(())
                } else {
                    send_messages(channel, &tail)
                }
            })
        } else {
            Ok(())
        };
        if let Some(error) = cleanup {
            return Err(error);
        }
        result.and(delivery)
    }
}
fn serve(
    server: &mut HelperServer<PlatformHelperSourceFactory>,
    channel: &WindowsSourceChannel,
) -> Result<(), HelperTransportError> {
    channel.handshake(&HelperHandshake {
        protocol_version: HELPER_PROTOCOL_VERSION,
        channel_nonce: channel.channel_nonce().to_owned(),
        helper_kind: HelperKind::WindowsSecurityService,
        helper_build_id: HELPER_BUILD_ID.to_owned(),
        capabilities: server.capabilities().to_vec(),
    })?;
    loop {
        if channel.stopping()? {
            return Ok(());
        }
        if let Some(message) = channel.poll()? {
            send_messages(channel, &server.handle_message(message)?)?;
        }
        if server.has_pollable_sources() {
            send_messages(channel, &server.drain_events()?)?;
        }
    }
}

fn send_messages(
    channel: &WindowsSourceChannel,
    messages: &[HelperServerMessage],
) -> Result<(), HelperTransportError> {
    // Inspect fatal cleanup before fallible delivery, so a broken pipe cannot
    // replace the evidence that this service process must never be reused.
    let cleanup = messages.iter().any(|message| {
        message
            .failure
            .as_ref()
            .is_some_and(|failure| failure.failure_code == HelperFailureCode::Cleanup)
    });
    let protocol = messages.iter().any(|message| {
        message
            .failure
            .as_ref()
            .is_some_and(|failure| failure.failure_code == HelperFailureCode::Protocol)
    });
    let delivery = messages
        .iter()
        .try_for_each(|message| channel.send(message));
    if cleanup {
        return Err(HelperTransportError::UtilityPoisoned);
    }
    if protocol {
        return Err(HelperProtocolError::Lifecycle.into());
    }
    delivery
}
