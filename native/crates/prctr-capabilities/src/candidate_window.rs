//! The candidate window's own condition: host facts from Electron main, plus the agent's OS
//! read-back of content protection and occlusion.
//! Contract: `docs/architecture/native-capability-families.md`, "Candidate window".

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, MutexGuard, PoisonError};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};

use prctr_core::{
    CapabilityDescriptor, FieldKind, FieldSpec, FieldValue, Observation, Sink, Source, SourceError,
    SourceEvent,
};
use prctr_os::{RawWindow, Rect};
use prctr_protocol::facts::{Certainty, Envelope, Health, Permission};
use prctr_protocol::rules::{
    Compare, CompareOp, Condition, Mode, Rule, RulePhase, RuleValue, Scalar,
};
use prctr_protocol::scalars::Identifier;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use serde_json::Value;

pub const CAPABILITY: &str = "candidate_window";
pub const POLL_INTERVAL: Duration = Duration::from_millis(250);
pub const STABILITY_MS: u64 = 1_000;
/// Another window covering at least this share of the exam window…
pub const OCCLUSION_SHARE: f64 = 0.05;
/// …for at least this long is reported as `covered`.
pub const OCCLUSION_MS: u64 = 1_000;
const MAX_COVERING: usize = 64;
const MAX_CLOSE_ATTEMPTS: u64 = 1_000_000;

pub const REASON_WINDOW: &str = "candidate_window.window_required";
pub const REASON_COVERED: &str = "candidate_window.covered";
pub const REASON_FOCUS: &str = "candidate_window.focus_lost";

macro_rules! symbol_enum {
    ($name:ident { $($variant:ident => $text:literal),+ $(,)? }) => {
        #[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
        #[serde(rename_all = "snake_case")]
        pub enum $name { $($variant),+ }

        impl $name {
            const VALUES: &'static [&'static str] = &[$($text),+];

            const fn text(self) -> &'static str {
                match self { $(Self::$variant => $text),+ }
            }
        }
    };
}

symbol_enum!(Presence { Present => "present", Absent => "absent" });
symbol_enum!(Focus { Focused => "focused", NotFocused => "not_focused", Unknown => "unknown" });
symbol_enum!(Visibility { Visible => "visible", Hidden => "hidden", Unknown => "unknown" });
symbol_enum!(Placement {
    Maximized => "maximized",
    Normal => "normal",
    Minimized => "minimized",
    Fullscreen => "fullscreen",
    Unknown => "unknown",
});
symbol_enum!(Protection { Verified => "verified", Failed => "failed", Unknown => "unknown" });
symbol_enum!(Occlusion { None => "none", Covered => "covered", Unknown => "unknown" });

/// What Electron main reports about its window.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct HostWindow {
    pub presence: Presence,
    pub focus: Focus,
    pub visibility: Visibility,
    pub placement: Placement,
}

/// Host events, one key each: `{ "attach": { "window": "<native id>" } }`, `{ "state": HostWindow }`,
/// `{ "close_attempted": {} }`, `{ "detach": {} }`.
#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "snake_case", deny_unknown_fields)]
pub enum HostEvent {
    /// The window's native identity: the CoreGraphics window number on macOS, the window handle
    /// on Windows, as decimal text.
    Attach {
        window: String,
    },
    State(HostWindow),
    CloseAttempted {},
    Detach {},
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct CandidateWindowState {
    pub presence: Presence,
    pub focus: Focus,
    pub visibility: Visibility,
    pub placement: Placement,
    pub content_protection: Protection,
    pub occlusion: Occlusion,
    pub close_attempts: u64,
}

/// The share of `window` covered by the union of `covering`, from 0 to 1.
#[must_use]
pub fn covered_share(window: Rect, covering: &[Rect]) -> f64 {
    let area = window.area();
    if area <= 0.0 {
        return 0.0;
    }
    let pieces: Vec<Rect> = covering
        .iter()
        .take(MAX_COVERING)
        .filter_map(|rect| rect.intersection(window))
        .collect();
    let mut xs: Vec<f64> = pieces
        .iter()
        .flat_map(|rect| [rect.x, rect.x + rect.width])
        .collect();
    xs.sort_by(f64::total_cmp);
    xs.dedup();
    let mut union = 0.0;
    for pair in xs.windows(2) {
        let (left, right) = (pair[0], pair[1]);
        let mut spans: Vec<(f64, f64)> = pieces
            .iter()
            .filter(|rect| rect.x <= left && rect.x + rect.width >= right)
            .map(|rect| (rect.y, rect.y + rect.height))
            .collect();
        spans.sort_by(|a, b| a.0.total_cmp(&b.0));
        let mut covered = 0.0;
        let mut current: Option<(f64, f64)> = None;
        for (top, bottom) in spans {
            match current {
                Some((start, end)) if top <= end => current = Some((start, end.max(bottom))),
                Some((start, end)) => {
                    covered += end - start;
                    current = Some((top, bottom));
                }
                None => current = Some((top, bottom)),
            }
        }
        if let Some((start, end)) = current {
            covered += end - start;
        }
        union += covered * (right - left);
    }
    (union / area).clamp(0.0, 1.0)
}

/// Applies the 5% / 1 s rule. `covered_since` is when the share first reached the threshold.
#[must_use]
pub fn occlusion(
    share: Option<f64>,
    covered_since: Option<u64>,
    now_ms: u64,
) -> (Occlusion, Option<u64>) {
    match share {
        None => (Occlusion::Unknown, None),
        Some(share) if share >= OCCLUSION_SHARE => {
            let since = covered_since.unwrap_or(now_ms);
            let state = if now_ms.saturating_sub(since) >= OCCLUSION_MS {
                Occlusion::Covered
            } else {
                Occlusion::None
            };
            (state, Some(since))
        }
        Some(_) => (Occlusion::None, None),
    }
}

/// Everything the source knows, updated by host events and the OS read-back.
#[derive(Clone, Debug, Default)]
pub struct Tracked {
    pub host: Option<HostWindow>,
    pub attached: Option<u64>,
    pub raw: RawWindow,
    pub covered_since: Option<u64>,
    pub occlusion: Option<Occlusion>,
    pub close_attempts: u64,
}

impl Tracked {
    /// Re-applies the OS read-back at `now_ms`.
    pub fn read_back(&mut self, raw: RawWindow, now_ms: u64) {
        let share = raw
            .bounds
            .filter(|_| raw.found)
            .map(|bounds| covered_share(bounds, &raw.covering));
        let (state, since) = occlusion(share, self.covered_since, now_ms);
        self.covered_since = since;
        self.occlusion = Some(state);
        self.raw = raw;
    }

    #[must_use]
    pub fn state(&self) -> CandidateWindowState {
        let host = self.host.unwrap_or(HostWindow {
            presence: Presence::Absent,
            focus: Focus::Unknown,
            visibility: Visibility::Unknown,
            placement: Placement::Unknown,
        });
        let attached = self.attached.is_some() && self.raw.found;
        CandidateWindowState {
            presence: host.presence,
            focus: host.focus,
            visibility: host.visibility,
            placement: host.placement,
            content_protection: match (attached, self.raw.capture_excluded) {
                (true, Some(true)) => Protection::Verified,
                (true, Some(false)) => Protection::Failed,
                _ => Protection::Unknown,
            },
            occlusion: if attached {
                self.occlusion.unwrap_or(Occlusion::Unknown)
            } else {
                Occlusion::Unknown
            },
            close_attempts: self.close_attempts.min(MAX_CLOSE_ATTEMPTS),
        }
    }

    #[must_use]
    pub fn observation(&self) -> Observation {
        let state = self.state();
        let complete = self.host.is_some()
            && state.content_protection != Protection::Unknown
            && state.occlusion != Occlusion::Unknown;
        let envelope = Envelope {
            permission: Permission::Granted,
            health: if complete {
                Health::Healthy
            } else {
                Health::Degraded
            },
            certainty: if complete {
                Certainty::Complete
            } else {
                Certainty::Partial
            },
        };
        let symbol = |name: &str, value: &str| (id(name), FieldValue::Symbol(id(value)));
        Observation {
            envelope,
            state: serde_json::to_value(state).unwrap_or_default(),
            summary: serde_json::json!({}),
            fields: [
                symbol("candidate_window.presence", state.presence.text()),
                symbol("candidate_window.focus", state.focus.text()),
                symbol("candidate_window.visibility", state.visibility.text()),
                symbol("candidate_window.placement", state.placement.text()),
                symbol(
                    "candidate_window.content_protection",
                    state.content_protection.text(),
                ),
                symbol("candidate_window.occlusion", state.occlusion.text()),
                (
                    id("candidate_window.close_attempts"),
                    FieldValue::Number(state.close_attempts),
                ),
            ]
            .into_iter()
            .collect(),
            apps: None,
            changes: Vec::new(),
        }
    }

    /// Applies one host event. Returns an error for an invalid event.
    ///
    /// # Errors
    /// When the event is not one of the documented shapes, or the window identity is not decimal.
    pub fn host_event(&mut self, event: &Value) -> Result<(), SourceError> {
        let invalid = SourceError {
            reason: "invalid candidate window host event",
        };
        let event: HostEvent =
            serde_json::from_value(event.clone()).map_err(|_| invalid.clone())?;
        match event {
            HostEvent::Attach { window } => {
                let parsed = window.parse::<u64>().map_err(|_| invalid)?;
                self.attached = Some(parsed);
                self.covered_since = None;
                self.occlusion = None;
            }
            HostEvent::State(host) => self.host = Some(host),
            HostEvent::CloseAttempted {} => {
                self.close_attempts = self.close_attempts.saturating_add(1);
            }
            HostEvent::Detach {} => {
                self.attached = None;
                self.raw = RawWindow::default();
                self.covered_since = None;
                self.occlusion = None;
            }
        }
        Ok(())
    }
}

fn id(text: &str) -> Identifier {
    Identifier::new(text).expect("candidate window identifier is valid")
}

#[must_use]
pub fn descriptor() -> CapabilityDescriptor {
    let symbol = |name: &str, values: &[&str]| FieldSpec {
        name: id(name),
        kind: FieldKind::Symbol {
            values: values.iter().map(|value| id(value)).collect(),
        },
    };
    CapabilityDescriptor {
        id: id(CAPABILITY),
        sensitive: false,
        stability_ms: STABILITY_MS,
        categories: Vec::new(),
        fields: vec![
            symbol("candidate_window.presence", Presence::VALUES),
            symbol("candidate_window.focus", Focus::VALUES),
            symbol("candidate_window.visibility", Visibility::VALUES),
            symbol("candidate_window.placement", Placement::VALUES),
            symbol("candidate_window.content_protection", Protection::VALUES),
            symbol("candidate_window.occlusion", Occlusion::VALUES),
            FieldSpec {
                name: id("candidate_window.close_attempts"),
                kind: FieldKind::Count {
                    max: MAX_CLOSE_ATTEMPTS,
                },
            },
        ],
        reasons: vec![id(REASON_WINDOW), id(REASON_COVERED), id(REASON_FOCUS)],
        app_conditions: false,
        permission_prompt: false,
    }
}

/// `baseline.window`: the window is present, maximized and its content protection is verified.
///
/// # Panics
/// Never: every identifier in it is a valid constant.
#[must_use]
pub fn baseline_rule() -> Rule {
    let equals = |field: &str, value: &str| {
        Condition::Compare(Compare {
            field: id(field),
            op: CompareOp::Eq,
            value: RuleValue::One(Scalar::Symbol(id(value))),
        })
    };
    Rule {
        rule_id: id("baseline.window"),
        capability: id(CAPABILITY),
        mode: Mode::Enforce,
        phase: RulePhase::Participation,
        reason: id(REASON_WINDOW),
        requirement: Condition::All {
            conditions: vec![
                equals("candidate_window.presence", "present"),
                equals("candidate_window.placement", "maximized"),
                equals("candidate_window.content_protection", "verified"),
            ],
        },
    }
}

/// The platform read-back this build uses.
fn read(window: u64) -> RawWindow {
    #[cfg(target_os = "macos")]
    return u32::try_from(window).map_or_else(|_| RawWindow::default(), prctr_os::macos::window);
    #[cfg(target_os = "windows")]
    return isize::try_from(window)
        .map_or_else(|_| RawWindow::default(), prctr_os::windows::window);
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        let _ = window;
        RawWindow::default()
    }
}

struct Poller {
    stop: Arc<AtomicBool>,
    thread: JoinHandle<()>,
}

/// The candidate window source.
pub struct CandidateWindowSource {
    tracked: Arc<Mutex<Tracked>>,
    started: Instant,
    sink: Option<Sink>,
    poller: Option<Poller>,
}

impl CandidateWindowSource {
    #[must_use]
    pub fn new() -> Self {
        Self {
            tracked: Arc::new(Mutex::new(Tracked::default())),
            started: Instant::now(),
            sink: None,
            poller: None,
        }
    }

    fn tracked(&self) -> MutexGuard<'_, Tracked> {
        self.tracked.lock().unwrap_or_else(PoisonError::into_inner)
    }
}

impl Default for CandidateWindowSource {
    fn default() -> Self {
        Self::new()
    }
}

impl Source for CandidateWindowSource {
    fn descriptor(&self) -> CapabilityDescriptor {
        descriptor()
    }

    fn start(&mut self, sink: Sink) -> Result<Observation, SourceError> {
        self.stop();
        let stop = Arc::new(AtomicBool::new(false));
        let thread_stop = Arc::clone(&stop);
        let tracked = Arc::clone(&self.tracked);
        let started = self.started;
        let thread_sink = Arc::clone(&sink);
        let thread = thread::Builder::new()
            .name("prctr-candidate-window".to_owned())
            .spawn(move || {
                while !thread_stop.load(Ordering::Acquire) {
                    thread::park_timeout(POLL_INTERVAL);
                    if thread_stop.load(Ordering::Acquire) {
                        return;
                    }
                    let attached = tracked
                        .lock()
                        .unwrap_or_else(PoisonError::into_inner)
                        .attached;
                    let Some(window) = attached else { continue };
                    let raw = read(window);
                    let now_ms = u64::try_from(started.elapsed().as_millis()).unwrap_or(u64::MAX);
                    let mut guard = tracked.lock().unwrap_or_else(PoisonError::into_inner);
                    let before = guard.state();
                    guard.read_back(raw, now_ms);
                    let changed = guard.state() != before;
                    drop(guard);
                    if changed {
                        thread_sink(SourceEvent::Changed);
                    }
                }
            })
            .map_err(|_| SourceError {
                reason: "cannot start the candidate window poller",
            })?;
        self.sink = Some(sink);
        self.poller = Some(Poller { stop, thread });
        Ok(self.current())
    }

    fn current(&mut self) -> Observation {
        self.tracked().observation()
    }

    fn stop(&mut self) {
        if let Some(poller) = self.poller.take() {
            poller.stop.store(true, Ordering::Release);
            poller.thread.thread().unpark();
            let _ = poller.thread.join();
        }
        self.sink = None;
    }

    fn host_event(&mut self, event: &Value) -> Result<(), SourceError> {
        self.tracked().host_event(event)?;
        if let Some(sink) = &self.sink {
            sink(SourceEvent::Changed);
        }
        Ok(())
    }
}

impl Drop for CandidateWindowSource {
    fn drop(&mut self) {
        self.stop();
    }
}

#[cfg(test)]
#[path = "candidate_window_tests.rs"]
mod tests;
