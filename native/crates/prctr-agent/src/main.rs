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

use prctr_core::{Registry, Source};

use crate::agent::{Agent, Exit};
use crate::diagnostic::{Diagnostic, emit};

const BUILD_IDENTITY: &str = match option_env!("PRCTR_BUILD_IDENTITY") {
    Some(identity) => identity,
    None => "development",
};
const PROTOCOL_DIGEST: &str = include_str!("../../prctr-protocol/schema/agent-protocol.digest");

/// Release and development builds run the real capabilities and the shared registry.
#[cfg(not(feature = "scripted-capabilities"))]
fn capabilities() -> (Registry, Vec<Box<dyn Source>>) {
    (
        prctr_capabilities::registry(),
        prctr_capabilities::sources(),
    )
}

/// Test builds run only the scripted capability, with no baseline, so tests control every fact.
#[cfg(feature = "scripted-capabilities")]
fn capabilities() -> (Registry, Vec<Box<dyn Source>>) {
    let scripted: Box<dyn Source> = Box::new(scripted::Scripted::new());
    let registry = Registry {
        capabilities: vec![scripted.descriptor()],
        baseline_rules: Vec::new(),
        applications: Vec::new(),
    };
    (registry, vec![scripted])
}

/// Reports sleep, screen lock and user switch to the agent. Test builds inject interruptions
/// through the scripted capability instead.
#[cfg(not(feature = "scripted-capabilities"))]
fn watch_interruptions(
    events: &mpsc::Sender<agent::Event>,
) -> Option<prctr_capabilities::interruptions::Watcher> {
    let events = events.clone();
    let watcher = prctr_capabilities::interruptions::Watcher::start(
        prctr_capabilities::interruptions::sample,
        move |kind| {
            let _ = events.send(agent::Event::Interrupted(kind));
        },
    );
    if watcher.is_err() {
        emit(Diagnostic::SourceStartFailed);
    }
    watcher.ok()
}

#[cfg(feature = "scripted-capabilities")]
const fn watch_interruptions(_events: &mpsc::Sender<agent::Event>) -> Option<()> {
    None
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
    let (registry, sources) = capabilities();
    let _interruptions = watch_interruptions(&sender);
    let mut agent = Agent::new(
        registry,
        sources,
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
