use std::sync::mpsc;

use prctr_protocol::helper::{
    HelperLoss, HelperRefusal, HelperSession, ProcessScope, SessionState,
};
use prctr_protocol::scalars::{CodeText, Count};

use super::*;
use crate::helper_testing::{ScriptedLink, scripted, wait_for};

fn count(value: u64) -> Count {
    Count::new(value).expect("small")
}

fn process(instance: u64, pid: u64) -> HelperProcess {
    HelperProcess {
        instance: count(instance),
        pid: count(pid),
        parent: None,
        scope: ProcessScope::CandidateSession,
        identity: HelperIdentity::Pending,
    }
}

#[test]
fn the_view_follows_snapshots_starts_identities_and_exits() {
    let mut view = HelperView::default();
    assert_eq!(
        apply(
            &mut view,
            HelperToAgent::ProcessStarted {
                process: process(1, 10)
            }
        ),
        None,
        "a start before the first snapshot is ignored"
    );
    let _ = apply(
        &mut view,
        HelperToAgent::ProcessSnapshot {
            processes: vec![process(1, 10)],
        },
    );
    let _ = apply(
        &mut view,
        HelperToAgent::ProcessStarted {
            process: process(2, 20),
        },
    );
    let _ = apply(
        &mut view,
        HelperToAgent::ProcessIdentified {
            instance: count(2),
            identity: HelperIdentity::Unsigned,
        },
    );
    let _ = apply(
        &mut view,
        HelperToAgent::ProcessExited { instance: count(1) },
    );
    let processes = view.processes.as_ref().expect("snapshot seen");
    assert_eq!(processes.keys().copied().collect::<Vec<_>>(), [2]);
    assert_eq!(processes[&2].identity, HelperIdentity::Unsigned);
    assert_eq!(
        apply(
            &mut view,
            HelperToAgent::Lost {
                reason: HelperLoss::EventsDropped
            }
        ),
        Some(HelperChange::Processes)
    );
    assert!(
        view.processes.is_none(),
        "incomplete until the next snapshot"
    );
}

#[test]
fn the_client_says_hello_subscribes_and_wakes_listeners_on_changes() {
    let (client, mut helper) = scripted();
    let (notify, notified) = mpsc::channel();
    let _ = client.listen(move |change| {
        let _ = notify.send(change);
    });
    assert!(client.want(Some(true), None));
    assert!(matches!(helper.next(), AgentToHelper::Hello { .. }));
    assert_eq!(
        helper.next(),
        AgentToHelper::Subscribe {
            processes: true,
            sessions: false
        }
    );
    helper.send(&HelperToAgent::Welcome {
        helper_version: CodeText::new("0.1.0").expect("text"),
    });
    helper.send(&HelperToAgent::ProcessSnapshot {
        processes: vec![process(7, 70)],
    });
    assert_eq!(
        notified.recv_timeout(Duration::from_secs(5)),
        Ok(HelperChange::Processes)
    );
    let view = wait_for(&client, |view| view.processes.is_some());
    assert!(view.connected);
    assert_eq!(view.processes.map(|processes| processes.len()), Some(1));

    assert!(client.want(None, Some(true)));
    assert_eq!(
        helper.next(),
        AgentToHelper::Subscribe {
            processes: true,
            sessions: true
        }
    );
    helper.send(&HelperToAgent::Sessions(HelperSessions {
        console: Some(count(1)),
        own: count(1),
        sessions: vec![HelperSession {
            id: count(1),
            state: SessionState::Active,
            has_user: true,
            remote: false,
            locked: Some(false),
        }],
    }));
    let view = wait_for(&client, |view| view.sessions.is_some());
    assert_eq!(view.sessions.map(|sessions| sessions.own.get()), Some(1));
}

#[test]
fn a_refusal_or_a_closed_helper_disconnects_and_tells_listeners() {
    let (client, mut helper) = scripted();
    let (notify, notified) = mpsc::channel();
    let _ = client.listen(move |change| {
        let _ = notify.send(change);
    });
    assert!(client.want(Some(true), Some(true)));
    let _ = helper.next();
    helper.send(&HelperToAgent::Refused {
        code: HelperRefusal::UnauthorizedPeer,
    });
    assert_eq!(
        notified.recv_timeout(Duration::from_secs(5)),
        Ok(HelperChange::Disconnected)
    );
    assert_eq!(client.view(), HelperView::default());
}

#[test]
fn without_a_running_helper_nothing_connects() {
    let link = Arc::new(ScriptedLink {
        ends: Mutex::new(None),
        status: ComponentStatus::NotInstalled,
    });
    let client = HelperClient::new(link);
    assert!(!client.want(Some(true), None));
    assert_eq!(client.status(), ComponentStatus::NotInstalled);
    assert!(!client.view().connected);
}
