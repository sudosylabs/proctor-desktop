//! The native agent: one unprivileged process that Electron main spawns on demand. It speaks the
//! agent protocol on stdin/stdout (the inherited private pipe pair) and writes only diagnostic
//! codes to stderr.
#![forbid(unsafe_code)]

mod agent;
mod diagnostic;
#[cfg(feature = "scripted-capabilities")]
mod scripted;
mod transport;

use std::process::ExitCode;
use std::sync::mpsc;

use prctr_core::Source;

use crate::agent::{Agent, Exit};
use crate::diagnostic::{Diagnostic, emit};

const BUILD_IDENTITY: &str = match option_env!("PRCTR_BUILD_IDENTITY") {
    Some(identity) => identity,
    None => "development",
};
const PROTOCOL_DIGEST: &str = include_str!("../../prctr-protocol/schema/agent-protocol.digest");

fn sources() -> Vec<Box<dyn Source>> {
    vec![
        #[cfg(feature = "scripted-capabilities")]
        Box::new(scripted::Scripted::new()),
    ]
}

fn main() -> ExitCode {
    // A bug must never leave the agent running in an unknown state: Electron main sees the exit
    // and contains.
    std::panic::set_hook(Box::new(|_| {
        emit(Diagnostic::Panicked);
        std::process::abort();
    }));
    let (sender, receiver) = mpsc::channel();
    transport::spawn_reader(std::io::stdin(), sender.clone());
    let mut agent = Agent::new(
        sources(),
        sender,
        std::io::stdout(),
        BUILD_IDENTITY,
        PROTOCOL_DIGEST,
    );
    match agent.run(&receiver) {
        Exit::Closed => ExitCode::SUCCESS,
        Exit::Protocol => ExitCode::from(70),
    }
}
