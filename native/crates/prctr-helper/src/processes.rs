//! The process table: raw starts and stops (process ID, parent, session, creation time) become
//! protocol processes with stable instances. Only processes in the agent's own session and system
//! processes are ever reported; another user's processes are dropped here.

use std::collections::HashMap;
use std::hash::{Hash, Hasher};

use prctr_protocol::helper::{HelperIdentity, HelperProcess, ProcessScope};
use prctr_protocol::scalars::{Count, MAX_SAFE_INTEGER};

/// One raw process as the OS reports it.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct RawStart {
    pub pid: u32,
    pub parent: u32,
    pub session: u32,
    /// Creation time in the OS's own units; with the process ID it identifies one process.
    pub created: u64,
}

/// The session that holds system and service processes (Windows session 0).
pub const SYSTEM_SESSION: u32 = 0;

/// A process's instance: unique for its lifetime, within the JavaScript-safe integer range.
#[must_use]
pub fn instance(pid: u32, created: u64) -> Count {
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    (pid, created).hash(&mut hasher);
    Count::new(hasher.finish() & MAX_SAFE_INTEGER).unwrap_or(Count::ZERO)
}

#[derive(Clone, Debug)]
struct Entry {
    created: u64,
    parent: u32,
    session: u32,
    identity: HelperIdentity,
}

impl Entry {
    fn new(start: RawStart, identity: HelperIdentity) -> Self {
        Self {
            created: start.created,
            parent: start.parent,
            session: start.session,
            identity,
        }
    }
}

/// Every live process, keyed by process ID.
#[derive(Debug, Default)]
pub struct ProcessTable {
    live: HashMap<u32, Entry>,
}

impl ProcessTable {
    /// Replaces the table with a fresh OS snapshot.
    pub fn reset(&mut self, snapshot: impl IntoIterator<Item = (RawStart, HelperIdentity)>) {
        self.live = snapshot
            .into_iter()
            .map(|(start, identity)| (start.pid, Entry::new(start, identity)))
            .collect();
    }

    /// Records a start. A start for a process ID already present replaces it: the earlier process
    /// exited without its stop being seen.
    pub fn start(&mut self, start: RawStart, identity: HelperIdentity) {
        self.live.insert(start.pid, Entry::new(start, identity));
    }

    /// Records a stop and returns the stopped process's session, or `None` when the stop is for a
    /// process this table does not hold (already replaced or never seen).
    pub fn stop(&mut self, pid: u32, created: u64) -> Option<u32> {
        let entry = self.live.get(&pid)?;
        if entry.created != created {
            return None;
        }
        let session = entry.session;
        self.live.remove(&pid);
        Some(session)
    }

    fn describe(&self, pid: u32, entry: &Entry, own: u32) -> Option<HelperProcess> {
        let scope = scope(entry.session, own)?;
        let parent = self
            .live
            .get(&entry.parent)
            .map(|parent| instance(entry.parent, parent.created));
        Some(HelperProcess {
            instance: instance(pid, entry.created),
            pid: Count::new(u64::from(pid)).ok()?,
            parent,
            scope,
            identity: entry.identity.clone(),
        })
    }

    /// The process as an agent in session `own` may see it, or `None` when it is hidden.
    #[must_use]
    pub fn visible(&self, pid: u32, own: u32) -> Option<HelperProcess> {
        self.describe(pid, self.live.get(&pid)?, own)
    }

    pub fn clear(&mut self) {
        self.live.clear();
    }

    /// Every process an agent in session `own` may see, in process ID order.
    #[must_use]
    pub fn snapshot(&self, own: u32) -> Vec<HelperProcess> {
        let mut pids: Vec<u32> = self.live.keys().copied().collect();
        pids.sort_unstable();
        pids.into_iter()
            .filter_map(|pid| self.describe(pid, &self.live[&pid], own))
            .collect()
    }
}

/// How a process in `session` appears to an agent in session `own`; `None` hides it.
#[must_use]
pub const fn scope(session: u32, own: u32) -> Option<ProcessScope> {
    if session == own {
        Some(ProcessScope::CandidateSession)
    } else if session == SYSTEM_SESSION {
        Some(ProcessScope::System)
    } else {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn raw(pid: u32, parent: u32, session: u32, created: u64) -> RawStart {
        RawStart {
            pid,
            parent,
            session,
            created,
        }
    }

    fn unknown(start: RawStart) -> (RawStart, HelperIdentity) {
        (start, HelperIdentity::Unavailable)
    }

    #[test]
    fn another_users_processes_are_never_visible() {
        let mut table = ProcessTable::default();
        table.reset([raw(4, 0, 0, 1), raw(100, 4, 1, 2), raw(200, 4, 2, 3)].map(unknown));
        let seen: Vec<u64> = table.snapshot(1).iter().map(|p| p.pid.get()).collect();
        assert_eq!(seen, [4, 100]);
        assert_eq!(table.snapshot(1)[0].scope, ProcessScope::System);
        assert_eq!(table.snapshot(1)[1].scope, ProcessScope::CandidateSession);
        assert!(table.visible(200, 1).is_none());
    }

    #[test]
    fn a_reused_process_id_is_a_new_instance_and_a_stale_stop_is_ignored() {
        let mut table = ProcessTable::default();
        table.start(raw(100, 0, 1, 10), HelperIdentity::Unavailable);
        let first = table.visible(100, 1).expect("visible").instance;
        table.start(raw(100, 0, 1, 20), HelperIdentity::Unavailable);
        let second = table.visible(100, 1).expect("visible").instance;
        assert_ne!(first, second);
        assert_eq!(table.stop(100, 10), None, "stop for the earlier process");
        assert_eq!(table.stop(100, 20), Some(1));
        assert!(table.visible(100, 1).is_none());
    }

    #[test]
    fn a_parent_is_named_by_its_instance_only_while_it_is_known() {
        let mut table = ProcessTable::default();
        table.reset([raw(50, 0, 1, 5), raw(60, 50, 1, 6), raw(70, 999, 1, 7)].map(unknown));
        assert_eq!(
            table.visible(60, 1).expect("visible").parent,
            Some(instance(50, 5))
        );
        assert_eq!(table.visible(70, 1).expect("visible").parent, None);
    }

    #[test]
    fn instances_stay_within_the_javascript_safe_range() {
        for pid in [0, 1, u32::MAX] {
            assert!(instance(pid, u64::MAX).get() <= MAX_SAFE_INTEGER);
        }
    }
}
