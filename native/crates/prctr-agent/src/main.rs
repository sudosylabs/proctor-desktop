//! The native agent: one unprivileged process that Electron main spawns on demand. It speaks the
//! agent protocol on stdin/stdout (the inherited private pipe pair) and writes only diagnostic
//! codes to stderr.
#![forbid(unsafe_code)]

mod agent;
mod diagnostic;
mod recording;
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

/// Release and development builds run the real capabilities, the shared registry and this
/// platform's recorder, which blanks the candidate window.
#[cfg(not(feature = "scripted-capabilities"))]
fn capabilities() -> (Registry, Vec<Box<dyn Source>>, recording::RecorderSetup) {
    let (sources, window) = prctr_capabilities::sources_and_window();
    let setup = recording::RecorderSetup {
        backend: Box::new(prctr_recorder::platform::backend),
        placeholder: std::sync::Arc::new(move || {
            window.bounds().map(|bounds| prctr_recorder::Rect {
                x: bounds.x,
                y: bounds.y,
                width: bounds.width,
                height: bounds.height,
            })
        }),
    };
    (prctr_capabilities::registry(), sources, setup)
}

/// Test builds run only the scripted capability, with no baseline, so tests control every fact.
#[cfg(feature = "scripted-capabilities")]
fn capabilities() -> (Registry, Vec<Box<dyn Source>>, recording::RecorderSetup) {
    let scripted: Box<dyn Source> = Box::new(scripted::Scripted::new());
    let registry = Registry {
        capabilities: vec![scripted.descriptor()],
        baseline_rules: Vec::new(),
        applications: Vec::new(),
    };
    (registry, vec![scripted], scripted::recorder_setup())
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

/// The one-shot setup commands for the macOS helper daemon's registration.
#[cfg(target_os = "macos")]
fn helper_command(argument: &std::ffi::OsStr) -> Option<ExitCode> {
    use prctr_capabilities::helper::macos::{Registration, registration};
    let register = argument == "--register-native-helper";
    if !register && argument != "--native-helper-status" {
        return None;
    }
    Some(match registration(register) {
        Ok(status) => {
            println!(
                "{}",
                match status {
                    Registration::NotRegistered => "not_registered",
                    Registration::RequiresApproval => "requires_approval",
                    Registration::Enabled => "enabled",
                }
            );
            ExitCode::SUCCESS
        }
        Err(_) => ExitCode::FAILURE,
    })
}

fn main() -> ExitCode {
    // Electron main starts the agent with no arguments. The only arguments are the one-shot macOS
    // setup commands; anything else is a usage error on every platform.
    if let Some(argument) = std::env::args_os().nth(1) {
        #[cfg(target_os = "macos")]
        if let Some(code) = helper_command(&argument) {
            return code;
        }
        let _ = argument;
        return ExitCode::from(64);
    }

    // A bug must never leave the agent running in an unknown state: Electron main sees the exit
    // and contains.
    std::panic::set_hook(Box::new(|_| {
        emit(Diagnostic::Panicked);
        std::process::abort();
    }));
    let (sender, receiver) = mpsc::channel();
    transport::spawn_reader(std::io::stdin(), sender.clone());
    let (registry, sources, recorder_setup) = capabilities();
    let _interruptions = watch_interruptions(&sender);
    let mut agent = Agent::new(
        registry,
        sources,
        sender,
        std::io::stdout(),
        BUILD_IDENTITY,
        PROTOCOL_DIGEST,
        recorder_setup,
    );
    match agent.run(&receiver) {
        Exit::Closed => ExitCode::SUCCESS,
        Exit::Protocol => ExitCode::from(70),
    }
}
