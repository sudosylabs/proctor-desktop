use prctr_core::{Registry, ValidPolicy};
use prctr_os::{RawWindow, Rect};
use prctr_protocol::facts::Certainty;
use prctr_protocol::rules::{Activation, Policy};
use prctr_protocol::scalars::Identifier;
use serde_json::json;

use super::*;

const WINDOW: Rect = Rect {
    x: 0.0,
    y: 0.0,
    width: 1000.0,
    height: 800.0,
};

fn rect(x: f64, y: f64, width: f64, height: f64) -> Rect {
    Rect {
        x,
        y,
        width,
        height,
    }
}

fn raw(protected: Option<bool>, covering: Vec<Rect>) -> RawWindow {
    RawWindow {
        found: true,
        capture_excluded: protected,
        bounds: Some(WINDOW),
        covering,
    }
}

fn attached() -> Tracked {
    let mut tracked = Tracked::default();
    tracked
        .host_event(&json!({ "attach": { "window": "42" } }))
        .expect("attach parses");
    tracked
        .host_event(&json!({ "state": { "presence": "present", "focus": "focused", "visibility": "visible", "placement": "maximized" } }))
        .expect("state parses");
    tracked
}

#[test]
fn the_covered_share_counts_overlapping_windows_once() {
    let half = rect(0.0, 0.0, 500.0, 800.0);
    assert!((covered_share(WINDOW, &[half]) - 0.5).abs() < 1e-9);
    assert!(
        (covered_share(WINDOW, &[half, half]) - 0.5).abs() < 1e-9,
        "the same area twice counts once"
    );
    let overlapping = [rect(0.0, 0.0, 600.0, 800.0), rect(400.0, 0.0, 600.0, 800.0)];
    assert!((covered_share(WINDOW, &overlapping) - 1.0).abs() < 1e-9);
    let outside = rect(2000.0, 2000.0, 100.0, 100.0);
    assert!(
        covered_share(WINDOW, &[outside]).abs() < 1e-9,
        "a window elsewhere does not count"
    );
}

#[test]
fn occlusion_needs_five_percent_for_one_second() {
    let small = Some(0.04);
    let enough = Some(0.05);
    assert_eq!(
        occlusion(small, None, 0),
        (Occlusion::None, None),
        "below 5% never counts"
    );
    let (state, since) = occlusion(enough, None, 100);
    assert_eq!(
        (state, since),
        (Occlusion::None, Some(100)),
        "the timer starts"
    );
    assert_eq!(
        occlusion(enough, since, 100 + OCCLUSION_MS - 1).0,
        Occlusion::None
    );
    assert_eq!(
        occlusion(enough, since, 100 + OCCLUSION_MS).0,
        Occlusion::Covered
    );
    assert_eq!(
        occlusion(small, since, 5_000),
        (Occlusion::None, None),
        "uncovering resets the timer"
    );
    assert_eq!(occlusion(None, since, 5_000), (Occlusion::Unknown, None));
}

#[test]
fn a_brief_notification_banner_is_not_reported() {
    let mut tracked = attached();
    let banner = vec![rect(700.0, 0.0, 300.0, 100.0)]; // 3.75% of the window
    tracked.read_back(raw(Some(true), banner.clone()), 0);
    tracked.read_back(raw(Some(true), banner), 2_000);
    assert_eq!(tracked.state().occlusion, Occlusion::None);
}

#[test]
fn an_overlay_that_stays_is_reported_covered_and_clears_when_it_leaves() {
    let mut tracked = attached();
    let overlay = vec![rect(0.0, 0.0, 400.0, 400.0)]; // 20%
    tracked.read_back(raw(Some(true), overlay.clone()), 0);
    assert_eq!(tracked.state().occlusion, Occlusion::None);
    tracked.read_back(raw(Some(true), overlay), OCCLUSION_MS);
    assert_eq!(tracked.state().occlusion, Occlusion::Covered);
    tracked.read_back(raw(Some(true), Vec::new()), OCCLUSION_MS + 250);
    assert_eq!(tracked.state().occlusion, Occlusion::None);
}

#[test]
fn content_protection_is_read_back_from_the_os_not_assumed() {
    let mut tracked = attached();
    tracked.read_back(raw(Some(true), Vec::new()), 0);
    assert_eq!(tracked.state().content_protection, Protection::Verified);
    tracked.read_back(raw(Some(false), Vec::new()), 250);
    assert_eq!(tracked.state().content_protection, Protection::Failed);
    tracked.read_back(raw(None, Vec::new()), 500);
    assert_eq!(tracked.state().content_protection, Protection::Unknown);
}

#[test]
fn without_a_read_back_the_unseen_fields_are_left_out() {
    let tracked = attached();
    let observation = tracked.observation();
    assert_eq!(tracked.state().content_protection, Protection::Unknown);
    assert_eq!(tracked.state().occlusion, Occlusion::Unknown);
    assert_eq!(observation.envelope.health, Health::Degraded);
    assert_eq!(
        observation.envelope.certainty,
        Certainty::Complete,
        "the fields that are present are certain"
    );
    for field in [
        "candidate_window.content_protection",
        "candidate_window.occlusion",
    ] {
        assert!(
            !observation.fields.contains_key(&id(field)),
            "{field} is unseen, so a rule on it is unavailable"
        );
    }
    assert!(
        observation
            .fields
            .contains_key(&id("candidate_window.presence"))
    );
}

#[test]
fn a_complete_read_back_makes_the_window_healthy() {
    let mut tracked = attached();
    tracked.read_back(raw(Some(true), Vec::new()), 0);
    assert_eq!(tracked.observation().envelope.health, Health::Healthy);
}

#[test]
fn close_attempts_are_counted_and_detach_forgets_the_window() {
    let mut tracked = attached();
    tracked.read_back(raw(Some(true), Vec::new()), 0);
    tracked
        .host_event(&json!({ "close_attempted": {} }))
        .expect("parses");
    tracked
        .host_event(&json!({ "close_attempted": {} }))
        .expect("parses");
    assert_eq!(tracked.state().close_attempts, 2);
    tracked
        .host_event(&json!({ "detach": {} }))
        .expect("parses");
    assert_eq!(tracked.state().content_protection, Protection::Unknown);
}

#[test]
fn invalid_host_events_are_refused() {
    let mut tracked = Tracked::default();
    for invalid in [
        json!({ "attach": { "window": "not-a-number" } }),
        json!({ "state": { "presence": "present" } }),
        json!({ "state": { "presence": "present", "focus": "focused", "visibility": "visible", "placement": "maximized", "title": "x" } }),
        json!({ "resize": {} }),
        json!("attach"),
    ] {
        assert!(tracked.host_event(&invalid).is_err(), "{invalid}");
    }
}

#[test]
fn the_baseline_rule_only_uses_registered_fields_and_values() {
    let registry = Registry {
        capabilities: vec![descriptor()],
        baseline_rules: vec![baseline_rule()],
        applications: Vec::new(),
    };
    let policy = Policy {
        activations: vec![Activation {
            capability: Identifier::new(CAPABILITY).expect("valid"),
            categories: Vec::new(),
        }],
        rules: vec![baseline_rule()],
    };
    assert!(ValidPolicy::new(policy, &registry).is_ok());
}

#[test]
fn candidate_window_passes_the_core_conformance_suite() {
    let mut first = attached();
    first.read_back(raw(Some(true), Vec::new()), 0);
    let mut second = attached();
    second.read_back(raw(Some(false), Vec::new()), 0);
    prctr_core::testing::assert_capability_conformance(
        &descriptor(),
        &first.observation(),
        &second.observation(),
    );
}
