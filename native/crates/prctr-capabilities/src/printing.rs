//! Print jobs in the OS scheduler, attributed to the candidate or not, and print commands the
//! `CandidateWindow` refused. Printer names, document names, job numbers and user names never leave
//! the agent. It cannot claim "no physical printing": printing that bypasses the scheduler is not
//! seen. Proctor never cancels a job.
//! Contract: `docs/architecture/native-capability-families.md`, "Printing".

use std::collections::BTreeSet;
use std::sync::Arc;

use prctr_core::{
    CapabilityDescriptor, FieldKind, FieldSpec, FieldValue, Observation, Sink, Source, SourceError,
    SourceEvent,
};
use prctr_os::{RawJobOwner, RawPrintJob};
use prctr_protocol::facts::{Certainty, Envelope, Health, Permission};
use prctr_protocol::scalars::Identifier;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use serde_json::Value;

pub const CAPABILITY: &str = "printing";
pub const STABILITY_MS: u64 = 0;
pub const REASON_CANDIDATE_JOB: &str = "printing.candidate_job";
pub const CHANGE_JOBS: &str = "jobs_changed";
pub const CHANGE_BLOCKED: &str = "candidate_print_blocked";
const MAX_COUNT: u64 = 1_000_000;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum Coverage {
    /// Every job the scheduler accepts is seen, including jobs that finish between reads.
    MonitoredScheduler,
    /// One read of the jobs present now; a job that came and went is not seen.
    SnapshotOnly,
    Unavailable,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct PrintState {
    pub coverage: Coverage,
    /// Active jobs owned by the candidate's account.
    pub candidate_jobs: u64,
    pub other_jobs: u64,
    /// Active jobs whose owner the scheduler did not state.
    pub unknown_jobs: u64,
    /// Candidate jobs the scheduler accepted since observation started, finished ones included.
    pub candidate_jobs_since_start: u64,
    /// Print commands the `CandidateWindow` refused since observation started.
    pub blocked_print_commands: u64,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct PrintSummary {
    pub candidate_jobs: u64,
    pub unknown_jobs: u64,
}

/// Host events, one key each: `{ "print_blocked": {} }` when Electron main refused a print
/// command from the `CandidateWindow`.
#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "snake_case", deny_unknown_fields)]
pub enum HostEvent {
    PrintBlocked {},
}

fn id(text: &str) -> Identifier {
    Identifier::new(text).expect("printing identifier is valid")
}

const COUNT_FIELDS: [&str; 6] = [
    "printing.summary.candidate_jobs",
    "printing.summary.unknown_jobs",
    "printing.other_jobs",
    "printing.candidate_jobs",
    "printing.candidate_jobs_since_start",
    "printing.blocked_print_commands",
];

#[must_use]
pub fn descriptor() -> CapabilityDescriptor {
    let mut fields = Vec::new();
    fields.extend(COUNT_FIELDS.iter().map(|name| FieldSpec {
        name: id(name),
        kind: FieldKind::Count { max: MAX_COUNT },
    }));
    CapabilityDescriptor {
        id: id(CAPABILITY),
        sensitive: false,
        stability_ms: STABILITY_MS,
        categories: Vec::new(),
        fields,
        reasons: vec![id(REASON_CANDIDATE_JOB)],
        app_conditions: false,
        permission_prompt: false,
    }
}

/// One read of the scheduler. `jobs` is `None` when no scheduler answered.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct RawPrint {
    pub jobs: Option<Vec<RawPrintJob>>,
    /// The read was cut at its bound: some jobs may be missing.
    pub truncated: bool,
    /// The read comes from a running observation that sees every accepted job.
    pub monitored: bool,
}

/// Per-observation memory: which jobs existed when it started, the candidate jobs since, and the
/// refused print commands.
#[derive(Debug, Default)]
pub struct Tracking {
    baseline: Option<BTreeSet<u32>>,
    candidate_since_start: BTreeSet<u32>,
    blocked: u64,
    blocked_pending: bool,
    previous: Option<(u64, u64, u64)>,
}

impl Tracking {
    pub fn print_blocked(&mut self) {
        self.blocked = (self.blocked + 1).min(MAX_COUNT);
        self.blocked_pending = true;
    }

    /// The facts for one read.
    pub fn classify(&mut self, raw: &RawPrint) -> Observation {
        let jobs = raw.jobs.as_deref().unwrap_or_default();
        if raw.monitored && raw.jobs.is_some() {
            let baseline = self
                .baseline
                .get_or_insert_with(|| jobs.iter().map(|job| job.id).collect());
            for job in jobs {
                if job.owner == RawJobOwner::Candidate && !baseline.contains(&job.id) {
                    self.candidate_since_start.insert(job.id);
                }
            }
        }
        let active = |owner| {
            jobs.iter()
                .filter(|job| job.active && job.owner == owner)
                .count() as u64
        };
        let counts = (
            active(RawJobOwner::Candidate),
            active(RawJobOwner::Other),
            active(RawJobOwner::Unknown),
        );
        let coverage = match (&raw.jobs, raw.monitored) {
            (None, _) => Coverage::Unavailable,
            (Some(_), true) => Coverage::MonitoredScheduler,
            (Some(_), false) => Coverage::SnapshotOnly,
        };
        let state = PrintState {
            coverage,
            candidate_jobs: counts.0,
            other_jobs: counts.1,
            unknown_jobs: counts.2,
            candidate_jobs_since_start: (self.candidate_since_start.len() as u64).min(MAX_COUNT),
            blocked_print_commands: self.blocked,
        };
        let mut changes = Vec::new();
        if self
            .previous
            .replace(counts)
            .is_some_and(|before| before != counts)
        {
            changes.push(id(CHANGE_JOBS));
        }
        if std::mem::take(&mut self.blocked_pending) {
            changes.push(id(CHANGE_BLOCKED));
        }
        let (health, certainty) = match coverage {
            Coverage::MonitoredScheduler if !raw.truncated => {
                (Health::Healthy, Certainty::Complete)
            }
            Coverage::MonitoredScheduler | Coverage::SnapshotOnly => {
                (Health::Healthy, Certainty::Partial)
            }
            Coverage::Unavailable => (Health::Unsupported, Certainty::Unknown),
        };
        let summary = PrintSummary {
            candidate_jobs: state.candidate_jobs,
            unknown_jobs: state.unknown_jobs,
        };
        let mut fields = std::collections::BTreeMap::from([(
            id("printing.blocked_print_commands"),
            FieldValue::Number(state.blocked_print_commands),
        )]);
        if raw.jobs.is_some() {
            for (name, value) in [
                ("printing.summary.candidate_jobs", summary.candidate_jobs),
                ("printing.summary.unknown_jobs", summary.unknown_jobs),
                ("printing.candidate_jobs", state.candidate_jobs),
                ("printing.other_jobs", state.other_jobs),
            ] {
                fields.insert(id(name), FieldValue::Number(value));
            }
        }
        if coverage == Coverage::MonitoredScheduler {
            fields.insert(
                id("printing.candidate_jobs_since_start"),
                FieldValue::Number(state.candidate_jobs_since_start),
            );
        }
        Observation {
            envelope: Envelope {
                permission: Permission::Granted,
                health,
                certainty,
            },
            state: serde_json::to_value(state).unwrap_or_default(),
            summary: serde_json::to_value(summary).unwrap_or_default(),
            fields,
            apps: None,
            changes,
        }
    }
}

/// How each platform observes its scheduler.
mod platform {
    use prctr_core::{Sink, SourceError};

    use super::RawPrint;

    /// macOS and Linux: CUPS keeps finished jobs in its history, so polling its complete job list
    /// sees every job, even one that finished between two reads.
    #[cfg(any(target_os = "macos", target_os = "linux"))]
    mod imp {
        use std::time::Duration;

        use super::{RawPrint, Sink, SourceError};
        use crate::poller::Poller;

        const POLL_INTERVAL: Duration = Duration::from_secs(1);

        fn read(monitored: bool) -> RawPrint {
            let jobs = prctr_os::cups::jobs();
            RawPrint {
                truncated: jobs.as_ref().is_some_and(|jobs| jobs.truncated),
                jobs: jobs.map(|jobs| jobs.jobs),
                monitored,
            }
        }

        pub struct Observer(Poller);

        impl Observer {
            pub fn start(sink: Sink) -> Result<Self, SourceError> {
                Poller::start(
                    "prctr-printing",
                    POLL_INTERVAL,
                    read(true),
                    || read(true),
                    sink,
                )
                .map(Self)
            }

            #[allow(clippy::unused_self)] // Same interface as the Windows observer.
            pub fn current(&self) -> RawPrint {
                read(true)
            }

            pub fn stop(self) {
                self.0.stop();
            }
        }

        pub fn snapshot() -> RawPrint {
            read(false)
        }
    }

    /// Windows: spooler job notifications carry each job's owner and status as they happen.
    #[cfg(target_os = "windows")]
    mod imp {
        use std::sync::atomic::{AtomicBool, Ordering};
        use std::sync::{Arc, Mutex, PoisonError};
        use std::thread::{self, JoinHandle};
        use std::time::Duration;

        use prctr_core::SourceEvent;
        use prctr_os::windows::{JobWatch, Watched};

        use super::{RawPrint, Sink, SourceError};

        const WAIT: Duration = Duration::from_millis(250);

        pub struct Observer {
            latest: Arc<Mutex<RawPrint>>,
            stop: Arc<AtomicBool>,
            thread: JoinHandle<()>,
        }

        impl Observer {
            pub fn start(sink: Sink) -> Result<Self, SourceError> {
                let unavailable = SourceError {
                    reason: "the print spooler cannot be observed",
                };
                let mut watch = JobWatch::open().ok_or(unavailable.clone())?;
                let latest = Arc::new(Mutex::new(RawPrint {
                    jobs: Some(watch.jobs()),
                    truncated: false,
                    monitored: true,
                }));
                let stop = Arc::new(AtomicBool::new(false));
                let (thread_latest, thread_stop) = (Arc::clone(&latest), Arc::clone(&stop));
                let thread = thread::Builder::new()
                    .name("prctr-printing".to_owned())
                    .spawn(move || {
                        while !thread_stop.load(Ordering::Acquire) {
                            let watched = watch.wait(WAIT);
                            if watched == Watched::Quiet {
                                continue;
                            }
                            {
                                let mut latest =
                                    thread_latest.lock().unwrap_or_else(PoisonError::into_inner);
                                if watched == Watched::Failed {
                                    latest.jobs = None;
                                } else {
                                    latest.jobs = Some(watch.jobs());
                                }
                            }
                            match watched {
                                Watched::Lost => sink(SourceEvent::Lost(1)),
                                Watched::Failed => {
                                    sink(SourceEvent::Changed);
                                    return;
                                }
                                _ => sink(SourceEvent::Changed),
                            }
                        }
                    })
                    .map_err(|_| unavailable)?;
                Ok(Self {
                    latest,
                    stop,
                    thread,
                })
            }

            pub fn current(&self) -> RawPrint {
                self.latest
                    .lock()
                    .unwrap_or_else(PoisonError::into_inner)
                    .clone()
            }

            pub fn stop(self) {
                self.stop.store(true, Ordering::Release);
                let _ = self.thread.join();
            }
        }

        pub fn snapshot() -> RawPrint {
            RawPrint {
                jobs: prctr_os::windows::print_jobs(),
                truncated: false,
                monitored: false,
            }
        }
    }

    pub use imp::{Observer, snapshot};
}

/// The printing source.
pub struct PrintingSource {
    tracking: Tracking,
    observer: Option<platform::Observer>,
    sink: Option<Sink>,
}

impl PrintingSource {
    #[must_use]
    pub fn new() -> Self {
        Self {
            tracking: Tracking::default(),
            observer: None,
            sink: None,
        }
    }
}

impl Default for PrintingSource {
    fn default() -> Self {
        Self::new()
    }
}

impl Source for PrintingSource {
    fn descriptor(&self) -> CapabilityDescriptor {
        descriptor()
    }

    fn start(
        &mut self,
        _categories: &[Identifier],
        sink: Sink,
    ) -> Result<Observation, SourceError> {
        self.stop();
        self.tracking = Tracking::default();
        self.observer = Some(platform::Observer::start(Arc::clone(&sink))?);
        self.sink = Some(sink);
        Ok(self.current())
    }

    fn current(&mut self) -> Observation {
        let raw = self
            .observer
            .as_ref()
            .map_or_else(platform::snapshot, platform::Observer::current);
        self.tracking.classify(&raw)
    }

    fn stop(&mut self) {
        self.sink = None;
        if let Some(observer) = self.observer.take() {
            observer.stop();
        }
    }

    fn host_event(&mut self, event: &Value) -> Result<(), SourceError> {
        let HostEvent::PrintBlocked {} =
            serde_json::from_value(event.clone()).map_err(|_| SourceError {
                reason: "invalid printing host event",
            })?;
        self.tracking.print_blocked();
        if let Some(sink) = &self.sink {
            sink(SourceEvent::Changed);
        }
        Ok(())
    }
}

impl Drop for PrintingSource {
    fn drop(&mut self) {
        self.stop();
    }
}

#[cfg(test)]
#[path = "printing_tests.rs"]
mod tests;
