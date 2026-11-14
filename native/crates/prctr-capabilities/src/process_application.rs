//! Whether an application the exam's rules name runs in the candidate's session. The inventory
//! (instances, identities, catalog matches) exists only inside the agent; the fact carries one
//! match per application rule: its rule ID, whether the condition is violated, and for blocklists
//! which catalog applications were found. Proctor never ends an application.
//! Contract: `docs/architecture/native-capability-families.md`, "Process and application".

use std::collections::{BTreeMap, BTreeSet, HashMap};
use std::sync::{Arc, Mutex, PoisonError};
use std::time::Duration;

use prctr_core::{AppMatches, CapabilityDescriptor, Observation, Sink, Source, SourceError};
use prctr_os::{RawIdentity, RawProcess};
use prctr_protocol::facts::{Certainty, Envelope, Health, Permission};
use prctr_protocol::rules::{Condition, Rule};
use prctr_protocol::scalars::Identifier;
use schemars::JsonSchema;
use serde::Serialize;

use crate::catalog::{self, Classified};
use crate::poller::Poller;

pub const CAPABILITY: &str = "process_application";
pub const POLL_INTERVAL: Duration = Duration::from_secs(1);
pub const STABILITY_MS: u64 = 2_000;
pub const REASON_BLOCKED: &str = "process_application.blocked_application";
pub const REASON_UNLISTED: &str = "process_application.unlisted_application";
pub const CHANGE_MATCHES: &str = "matches_changed";
/// How far up the parent chain Proctor's own processes are looked for.
const MAX_ANCESTRY: usize = 64;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum Coverage {
    /// Read every [`POLL_INTERVAL`]: a process shorter than one interval can come and go unseen,
    /// but each read classifies every process it sees, so its matches are complete.
    SnapshotOnly,
    Unavailable,
}

/// One application rule's match. `matched` means the condition is violated.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct RuleMatch {
    pub rule_id: String,
    pub matched: bool,
    /// Blocklist rules: the catalog applications found. Always empty for allowlist rules.
    pub catalog_app_ids: Vec<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct ProcessState {
    pub coverage: Coverage,
    /// New processes whose identity is still being verified.
    pub checking: u64,
    pub rule_matches: Vec<RuleMatch>,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct ProcessSummary {
    pub checking: u64,
}

fn id(text: &str) -> Identifier {
    Identifier::new(text).expect("process identifier is valid")
}

#[must_use]
pub fn descriptor() -> CapabilityDescriptor {
    CapabilityDescriptor {
        id: id(CAPABILITY),
        sensitive: true,
        stability_ms: STABILITY_MS,
        categories: Vec::new(),
        fields: Vec::new(),
        reasons: vec![id(REASON_BLOCKED), id(REASON_UNLISTED)],
        app_conditions: true,
        permission_prompt: false,
    }
}

/// An application condition, as the matcher needs it.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum AppCondition {
    Absent(BTreeSet<String>),
    Only(BTreeSet<String>),
}

/// The single application condition in a rule's requirement, if any.
#[must_use]
pub fn app_condition(condition: &Condition) -> Option<AppCondition> {
    let ids = |ids: &[Identifier]| ids.iter().map(|id| id.as_str().to_owned()).collect();
    match condition {
        Condition::AppsAbsent { catalog_app_ids } => {
            Some(AppCondition::Absent(ids(catalog_app_ids)))
        }
        Condition::AppsOnly { catalog_app_ids } => Some(AppCondition::Only(ids(catalog_app_ids))),
        Condition::All { conditions } | Condition::Any { conditions } => {
            conditions.iter().find_map(app_condition)
        }
        Condition::Not { condition } => app_condition(condition),
        Condition::Compare(_) => None,
    }
}

/// One process as the matcher sees it.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Seen {
    /// Proctor itself: the agent's parent and everything it started.
    pub own: bool,
    pub classified: Classified,
}

/// Matches every rule against the processes. A blocklist is violated by any listed application;
/// an allowlist by any process that is not Proctor, not part of the OS and not listed, including
/// one whose identity cannot be read. A child never inherits its parent's allowance.
#[must_use]
pub fn match_rules(rules: &[(String, AppCondition)], processes: &[Seen]) -> Vec<RuleMatch> {
    rules
        .iter()
        .map(|(rule_id, condition)| match condition {
            AppCondition::Absent(blocked) => {
                let found: BTreeSet<String> = processes
                    .iter()
                    .filter(|process| !process.own)
                    .filter_map(|process| match process.classified {
                        Classified::App(app) if blocked.contains(app.id) => Some(app.id.to_owned()),
                        _ => None,
                    })
                    .collect();
                RuleMatch {
                    rule_id: rule_id.clone(),
                    matched: !found.is_empty(),
                    catalog_app_ids: found.into_iter().collect(),
                }
            }
            AppCondition::Only(allowed) => RuleMatch {
                rule_id: rule_id.clone(),
                matched: processes.iter().any(|process| {
                    !process.own
                        && match process.classified {
                            Classified::OsEssential => false,
                            Classified::App(app) => !allowed.contains(app.id),
                            Classified::Unlisted | Classified::Unidentified => true,
                        }
                }),
                catalog_app_ids: Vec::new(),
            },
        })
        .collect()
}

/// Which processes are Proctor's own: `root` (the agent's parent) and its descendants.
#[must_use]
pub fn own_processes(processes: &[RawProcess], root: u32) -> BTreeSet<u32> {
    let parents: HashMap<u32, u32> = processes
        .iter()
        .map(|process| (process.pid, process.parent))
        .collect();
    processes
        .iter()
        .filter(|process| {
            let mut pid = process.pid;
            for _ in 0..MAX_ANCESTRY {
                if pid == root {
                    return true;
                }
                match parents.get(&pid) {
                    Some(parent) if *parent != pid && *parent != 0 => pid = *parent,
                    _ => return false,
                }
            }
            false
        })
        .map(|process| process.pid)
        .collect()
}

/// The device-only inventory: identities cached per process instance, so each is verified once.
#[derive(Debug, Default)]
pub struct Inventory {
    identities: HashMap<u64, RawIdentity>,
}

impl Inventory {
    /// Classifies every process in `processes`, reading the identity of new instances only and
    /// forgetting instances that are gone.
    pub fn observe(
        &mut self,
        processes: &[RawProcess],
        root: u32,
        identity: impl Fn(u32) -> RawIdentity,
    ) -> Vec<Seen> {
        let live: BTreeSet<u64> = processes.iter().map(|process| process.instance).collect();
        self.identities
            .retain(|instance, _| live.contains(instance));
        let own = own_processes(processes, root);
        processes
            .iter()
            .map(|process| {
                let raw = self
                    .identities
                    .entry(process.instance)
                    .or_insert_with(|| identity(process.pid));
                Seen {
                    own: own.contains(&process.pid),
                    classified: catalog::classify(raw),
                }
            })
            .collect()
    }
}

mod platform {
    use prctr_os::{RawIdentity, RawProcess};

    #[cfg(target_os = "linux")]
    use prctr_os::linux as os;
    #[cfg(target_os = "macos")]
    use prctr_os::macos as os;
    #[cfg(target_os = "windows")]
    use prctr_os::windows as os;

    pub fn processes() -> Option<Vec<RawProcess>> {
        os::processes()
    }
    pub fn identity(pid: u32) -> RawIdentity {
        os::identity(pid)
    }

    /// The process that started the agent: Electron main.
    #[cfg(unix)]
    pub fn root(_processes: &[RawProcess]) -> u32 {
        std::os::unix::process::parent_id()
    }
    #[cfg(not(unix))]
    pub fn root(processes: &[RawProcess]) -> u32 {
        let own = std::process::id();
        processes
            .iter()
            .find(|process| process.pid == own)
            .map_or(own, |process| process.parent)
    }
}

/// The matcher's whole input: the rules and the shared identity cache.
#[derive(Debug, Default)]
pub struct Matcher {
    rules: Vec<(String, AppCondition)>,
    inventory: Inventory,
}

impl Matcher {
    pub fn configure(&mut self, rules: &[Rule]) {
        self.rules = rules
            .iter()
            .filter_map(|rule| {
                app_condition(&rule.requirement)
                    .map(|condition| (rule.rule_id.as_str().to_owned(), condition))
            })
            .collect();
    }

    /// The rule matches now, or `None` when no process list could be read.
    pub fn read(&mut self) -> Option<Vec<RuleMatch>> {
        let processes = platform::processes()?;
        let root = platform::root(&processes);
        let seen = self.inventory.observe(&processes, root, platform::identity);
        Some(match_rules(&self.rules, &seen))
    }
}

/// Per-session memory of the previous matches, for the change kind.
#[derive(Debug, Default)]
pub struct Tracking {
    previous: Option<Vec<RuleMatch>>,
}

impl Tracking {
    /// The facts for one read. A completed snapshot classifies every process it sees, so its
    /// matches are complete; a read that returns nothing is unavailable.
    pub fn classify(&mut self, matches: Option<Vec<RuleMatch>>) -> Observation {
        let coverage = if matches.is_some() {
            Coverage::SnapshotOnly
        } else {
            Coverage::Unavailable
        };
        let rule_matches = matches.unwrap_or_default();
        let changes = if self
            .previous
            .replace(rule_matches.clone())
            .is_some_and(|before| before != rule_matches)
        {
            vec![id(CHANGE_MATCHES)]
        } else {
            Vec::new()
        };
        let (health, certainty) = match coverage {
            Coverage::SnapshotOnly => (Health::Healthy, Certainty::Complete),
            Coverage::Unavailable => (Health::Unsupported, Certainty::Unknown),
        };
        let apps = (coverage != Coverage::Unavailable).then(|| AppMatches {
            checking: 0,
            violated: rule_matches
                .iter()
                .filter_map(|rule| {
                    Identifier::new(&rule.rule_id)
                        .ok()
                        .map(|id| (id, rule.matched))
                })
                .collect::<BTreeMap<_, _>>(),
        });
        let state = ProcessState {
            coverage,
            checking: 0,
            rule_matches,
        };
        Observation {
            envelope: Envelope {
                permission: Permission::Granted,
                health,
                certainty,
            },
            state: serde_json::to_value(&state).unwrap_or_default(),
            summary: serde_json::to_value(ProcessSummary { checking: 0 }).unwrap_or_default(),
            fields: BTreeMap::new(),
            apps,
            changes,
        }
    }
}

/// The process and application source: the agent polls snapshots every [`POLL_INTERVAL`].
pub struct ProcessSource {
    matcher: Arc<Mutex<Matcher>>,
    tracking: Tracking,
    poller: Option<Poller>,
}

impl ProcessSource {
    #[must_use]
    pub fn new() -> Self {
        Self {
            matcher: Arc::new(Mutex::new(Matcher::default())),
            tracking: Tracking::default(),
            poller: None,
        }
    }

    fn read(matcher: &Mutex<Matcher>) -> Option<Vec<RuleMatch>> {
        matcher
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .read()
    }
}

impl Default for ProcessSource {
    fn default() -> Self {
        Self::new()
    }
}

impl Source for ProcessSource {
    fn descriptor(&self) -> CapabilityDescriptor {
        descriptor()
    }

    fn configure_rules(&mut self, rules: &[Rule]) {
        self.matcher
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .configure(rules);
    }

    fn start(
        &mut self,
        _categories: &[Identifier],
        sink: Sink,
    ) -> Result<Observation, SourceError> {
        self.stop();
        self.tracking = Tracking::default();
        let matcher = Arc::clone(&self.matcher);
        let first = Self::read(&matcher);
        self.poller = Some(Poller::start(
            "prctr-process",
            POLL_INTERVAL,
            first,
            move || Self::read(&matcher),
            sink,
        )?);
        Ok(self.current())
    }

    fn current(&mut self) -> Observation {
        let matches = Self::read(&self.matcher);
        self.tracking.classify(matches)
    }

    fn stop(&mut self) {
        if let Some(poller) = self.poller.take() {
            poller.stop();
        }
    }
}

impl Drop for ProcessSource {
    fn drop(&mut self) {
        self.stop();
    }
}

#[cfg(test)]
#[path = "process_application_tests.rs"]
mod tests;
