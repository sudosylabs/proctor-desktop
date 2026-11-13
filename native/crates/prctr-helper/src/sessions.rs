//! Interactive sessions as states only: the OS's session list becomes the protocol report with no
//! user names or account IDs.

use prctr_protocol::helper::{HelperSession, HelperSessions, MAX_SESSIONS, SessionState};
use prctr_protocol::scalars::Count;

/// One session as the OS reports it.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct RawSessionInfo {
    pub id: u32,
    pub state: SessionState,
    pub has_user: bool,
    pub remote: bool,
    pub locked: Option<bool>,
}

/// The report for an agent in session `own`. Sessions beyond the protocol bound are dropped from
/// the list (the bound is far above any real machine).
#[must_use]
pub fn report(console: Option<u32>, own: u32, sessions: &[RawSessionInfo]) -> HelperSessions {
    let count = |value: u32| Count::new(u64::from(value)).unwrap_or(Count::ZERO);
    HelperSessions {
        console: console.map(count),
        own: count(own),
        sessions: sessions
            .iter()
            .take(MAX_SESSIONS)
            .map(|session| HelperSession {
                id: count(session.id),
                state: session.state,
                has_user: session.has_user,
                remote: session.remote,
                locked: session.locked,
            })
            .collect(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_report_keeps_states_and_bounds_the_list() {
        let one = RawSessionInfo {
            id: 1,
            state: SessionState::Active,
            has_user: true,
            remote: false,
            locked: Some(false),
        };
        let report = report(Some(1), 1, &vec![one; MAX_SESSIONS + 5]);
        assert_eq!(report.sessions.len(), MAX_SESSIONS);
        assert_eq!(report.console.map(Count::get), Some(1));
        assert_eq!(report.sessions[0].state, SessionState::Active);
    }
}
