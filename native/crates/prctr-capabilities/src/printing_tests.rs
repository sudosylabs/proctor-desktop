use serde_json::json;

use super::*;

fn job(id: u32, owner: RawJobOwner, active: bool) -> RawPrintJob {
    RawPrintJob { id, owner, active }
}

fn monitored(jobs: Vec<RawPrintJob>) -> RawPrint {
    RawPrint {
        jobs: Some(jobs),
        truncated: false,
        monitored: true,
    }
}

#[test]
fn active_jobs_are_counted_by_owner_and_finished_ones_are_not() {
    let observation = Tracking::default().classify(&monitored(vec![
        job(1, RawJobOwner::Candidate, true),
        job(2, RawJobOwner::Other, true),
        job(3, RawJobOwner::Unknown, true),
        job(4, RawJobOwner::Candidate, false),
    ]));
    assert_eq!(observation.state["candidate_jobs"], 1);
    assert_eq!(observation.state["other_jobs"], 1);
    assert_eq!(observation.state["unknown_jobs"], 1);
    assert_eq!(
        observation.summary,
        json!({ "candidate_jobs": 1, "unknown_jobs": 1 })
    );
    assert_eq!(observation.envelope.certainty, Certainty::Complete);
}

#[test]
fn a_job_queued_before_the_start_is_active_but_not_new() {
    let mut tracking = Tracking::default();
    let first = tracking.classify(&monitored(vec![job(9, RawJobOwner::Candidate, true)]));
    assert_eq!(
        first.state["candidate_jobs"], 1,
        "it still blocks readiness"
    );
    assert_eq!(first.state["candidate_jobs_since_start"], 0);
}

#[test]
fn a_candidate_job_that_finished_between_reads_still_counts_as_new() {
    let mut tracking = Tracking::default();
    tracking.classify(&monitored(vec![job(1, RawJobOwner::Candidate, false)]));
    let later = tracking.classify(&monitored(vec![
        job(1, RawJobOwner::Candidate, false),
        job(2, RawJobOwner::Candidate, false),
        job(3, RawJobOwner::Other, false),
    ]));
    assert_eq!(later.state["candidate_jobs"], 0);
    assert_eq!(later.state["candidate_jobs_since_start"], 1);
    assert_eq!(
        later.fields[&id("printing.candidate_jobs_since_start")],
        FieldValue::Number(1)
    );
}

#[test]
fn job_changes_and_refused_commands_are_change_kinds() {
    let mut tracking = Tracking::default();
    assert!(tracking.classify(&monitored(Vec::new())).changes.is_empty());
    let queued = tracking.classify(&monitored(vec![job(5, RawJobOwner::Candidate, true)]));
    assert_eq!(queued.changes, vec![id(CHANGE_JOBS)]);
    tracking.print_blocked();
    let blocked = tracking.classify(&monitored(vec![job(5, RawJobOwner::Candidate, true)]));
    assert_eq!(blocked.changes, vec![id(CHANGE_BLOCKED)]);
    assert_eq!(blocked.state["blocked_print_commands"], 1);
    let quiet = tracking.classify(&monitored(vec![job(5, RawJobOwner::Candidate, true)]));
    assert!(quiet.changes.is_empty());
}

#[test]
fn a_snapshot_is_partial_and_has_no_since_start_count() {
    let observation = Tracking::default().classify(&RawPrint {
        jobs: Some(vec![job(1, RawJobOwner::Candidate, false)]),
        truncated: false,
        monitored: false,
    });
    assert_eq!(observation.state["coverage"], "snapshot_only");
    assert_eq!(observation.envelope.certainty, Certainty::Partial);
    assert!(
        !observation
            .fields
            .contains_key(&id("printing.candidate_jobs_since_start"))
    );
}

#[test]
fn a_truncated_read_is_partial() {
    let mut raw = monitored(Vec::new());
    raw.truncated = true;
    assert_eq!(
        Tracking::default().classify(&raw).envelope.certainty,
        Certainty::Partial
    );
}

#[test]
fn no_scheduler_is_unavailable_with_no_job_counts() {
    let observation = Tracking::default().classify(&RawPrint::default());
    assert_eq!(observation.state["coverage"], "unavailable");
    assert_eq!(observation.envelope.health, Health::Unsupported);
    assert!(
        !observation
            .fields
            .contains_key(&id("printing.summary.candidate_jobs")),
        "an unread scheduler has no count, never zero"
    );
}

#[test]
fn only_the_print_blocked_host_event_is_accepted() {
    let mut source = PrintingSource::new();
    assert!(source.host_event(&json!({ "print_blocked": {} })).is_ok());
    assert!(
        source
            .host_event(&json!({ "print_blocked": { "count": 2 } }))
            .is_err()
    );
    assert!(source.host_event(&json!({ "printed": {} })).is_err());
    assert_eq!(source.tracked().blocked, 1);
}

#[test]
fn printing_passes_the_core_conformance_suite() {
    let mut tracking = Tracking::default();
    let none = tracking.classify(&monitored(Vec::new()));
    let one = tracking.classify(&monitored(vec![job(1, RawJobOwner::Candidate, true)]));
    prctr_core::testing::assert_capability_conformance(&descriptor(), &none, &one);
}

/// Real OS: the scheduler is observed and nothing is printed.
#[cfg(any(target_os = "macos", target_os = "windows"))]
#[test]
fn this_machine_observes_its_print_scheduler() {
    let (sender, _receiver) = std::sync::mpsc::channel::<()>();
    let sink: Sink = Arc::new(move |_| {
        let _ = sender.send(());
    });
    let mut source = PrintingSource::new();
    let first = source
        .start(&[], sink)
        .expect("the scheduler can be observed");
    assert_eq!(first.state["coverage"], "monitored_scheduler");
    assert_eq!(first.state["candidate_jobs_since_start"], 0);
    source.stop();
}
