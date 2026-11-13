//! Explicit target-machine acceptance tests. Run individually on the declared privileged rig.
#![cfg(any(target_os = "windows", target_os = "macos"))]
use prctr_helper::platform::{ProcessEvent, ProcessSource, SessionSource};
use std::collections::BTreeSet;
use std::sync::mpsc;
use std::time::{Duration, Instant};

fn processes() -> Box<dyn ProcessSource> {
    #[cfg(target_os = "windows")]
    return Box::new(prctr_helper::windows::Processes);
    #[cfg(target_os = "macos")]
    Box::new(prctr_helper::macos::Processes)
}

#[test]
#[ignore = "Requires SYSTEM on Windows, or root plus Endpoint Security entitlement/FDA on macOS"]
fn existing_process_creation_time_matches_notifications_and_snapshot() {
    let source = processes();
    let (events, inbox) = mpsc::channel();
    let _watch = source
        .start(Box::new(move |event| {
            let _ = events.send(event);
        }))
        .expect("privileged process subscription");
    #[cfg(target_os = "windows")]
    let mut child = std::process::Command::new("notepad.exe")
        .spawn()
        .expect("notepad");
    #[cfg(target_os = "macos")]
    let mut child = std::process::Command::new("/bin/sleep")
        .arg("10")
        .spawn()
        .expect("sleep");
    let pid = child.id();
    let snapshot = source.snapshot().expect("complete machine snapshot");
    let expected = snapshot
        .iter()
        .find(|start| start.pid == pid)
        .expect("live child")
        .created;
    assert_ne!(expected, 0);
    child.kill().expect("stop test child");
    let _ = child.wait();
    let deadline = Instant::now() + Duration::from_secs(10);
    let (mut started, mut stopped) = (false, false);
    while !(started && stopped) {
        let event = inbox
            .recv_timeout(deadline.saturating_duration_since(Instant::now()))
            .expect("start and stop before deadline");
        match event {
            ProcessEvent::Started(start) | ProcessEvent::Observed { start, .. }
                if start.pid == pid =>
            {
                assert_eq!(start.created, expected);
                started = true;
            }
            ProcessEvent::Stopped {
                pid: exited,
                created,
            } if exited == pid => {
                assert_eq!(created, expected);
                stopped = true;
            }
            _ => {}
        }
    }
    #[cfg(target_os = "windows")]
    assert!(
        snapshot
            .iter()
            .any(|start| start.session == 0 && start.created != 0),
        "session zero service creation times"
    );
}

#[test]
#[ignore = "Requires the privileged process-event rig; do not run alongside another named ETW test"]
fn fifty_rapid_process_pairs_are_delivered_or_loss_is_explicit() {
    let source = processes();
    let (events, inbox) = mpsc::channel();
    let _watch = source
        .start(Box::new(move |event| {
            let _ = events.send(event);
        }))
        .expect("privileged process subscription");
    let mut wanted = BTreeSet::new();
    for _ in 0..50 {
        #[cfg(target_os = "windows")]
        let mut child = std::process::Command::new("cmd.exe")
            .args(["/d", "/c", "exit", "0"])
            .spawn()
            .expect("short child");
        #[cfg(target_os = "macos")]
        let mut child = std::process::Command::new("/usr/bin/true")
            .spawn()
            .expect("short child");
        wanted.insert(child.id());
        child.wait().expect("child exit");
    }
    let deadline = Instant::now() + Duration::from_secs(10);
    let mut starts = BTreeSet::new();
    let mut stops = BTreeSet::new();
    loop {
        match inbox.recv_timeout(deadline.saturating_duration_since(Instant::now())) {
            Ok(ProcessEvent::Lost) => return,
            Ok(ProcessEvent::Started(start) | ProcessEvent::Observed { start, .. })
                if wanted.contains(&start.pid) =>
            {
                starts.insert((start.pid, start.created));
            }
            Ok(ProcessEvent::Stopped { pid, created }) if wanted.contains(&pid) => {
                stops.insert((pid, created));
            }
            Ok(_) => {}
            Err(_) => break,
        }
        if starts.intersection(&stops).count() >= 50 {
            return;
        }
    }
    panic!("a short-lived process pair was lost without an explicit Lost event");
}

#[test]
#[ignore = "Requires an unlocked local interactive session on the privileged rig"]
fn sessions_report_the_local_console_as_active_unlocked_and_human() {
    #[cfg(target_os = "windows")]
    let source = prctr_helper::windows::Sessions;
    #[cfg(target_os = "macos")]
    let source = prctr_helper::macos::Sessions::default();
    let _watch = source.start().expect("session notifications");
    let (console, sessions) = source.read().expect("session enumeration");
    let console = console.expect("physical console");
    let own = sessions
        .iter()
        .find(|session| session.id == console)
        .expect("console entry");
    assert_eq!(own.state, prctr_protocol::helper::SessionState::Active);
    assert!(own.has_user);
    assert!(!own.remote);
    assert_eq!(own.locked, Some(false));
}

/// `auditon(A_GETPINFO_ADDR)` is deprecated BSM: prove on the rig that it still answers for a
/// user process and for a system daemon, since every macOS snapshot depends on it.
#[cfg(target_os = "macos")]
#[test]
#[ignore = "Requires root on the macOS privileged rig"]
fn macos_audit_sessions_are_readable_for_user_and_system_processes() {
    let own = prctr_os::macos::helper::process_session(std::process::id())
        .expect("the test process's audit session");
    assert_ne!(
        own, 0,
        "a process started from a login session has a user audit session"
    );
    assert_eq!(
        prctr_os::macos::helper::process_session(1),
        Some(0),
        "launchd runs in the system scope"
    );
}
