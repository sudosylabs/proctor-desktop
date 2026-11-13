# Live correction contract

The accepted wire contract uses the [shared conventions](conventions.md).
[Contract map and implementation status](README.md) separate agreement from availability.

## Immutable authoring and candidate models

Immutable corrections carry an explicit affected-capability selection:

```typescript
interface CorrectionCapabilitySelection {
  affected_capabilities: CandidateCapability[]; // 1..4, unique, sorted ASCII.
}
interface CandidateCorrectionNotice {
  revision_id: ID;
  revision_number: PositiveInt;
  effective_at: Instant;
  summary: string; // Preserve current bounded candidate-summary validation.
  changed_areas: ('browser_policy' | 'instructions' | 'resources')[];
  affected_capabilities: CandidateCapability[];
  acknowledgement_required: boolean;
  acknowledgement_state: 'not_required' | 'pending' | 'acknowledged';
  acknowledged_at?: Instant; // Exactly when state is acknowledged.
}
```

Add affected_capabilities to the existing correction request, domain notice,
immutable revision, Store/SQL serialization, response, and realtime projection.
Preserve the current resource staging model, candidate summary bounds,
expected_sitting_revision/expected_current_revision_id conflict checks, manager
permission, reason, and Idempotency-Key. No corrections to frozen work or native
policy are introduced by this selector.

The authoring rule is a minimum affected set derived from the
actual semantic change:

| Changed area        | Minimum affected set                |
| ------------------- | ----------------------------------- |
| browser_policy only | browser                             |
| instructions        | submission, workspace               |
| resources           | submission, workspace               |
| combined            | Sorted union of the applicable rows |

The author must provide that minimum or a deliberate superset of the four known
capabilities. Reject omissions of the minimum and unknown/duplicate IDs. The
minimum is enforced at authoring. Even with acknowledgement_required
false, retain the affected set for truthful notification; only a pending required
acknowledgement creates a gate. A no-op change cannot create a synthetic pending
correction merely by choosing a new affected set.

Every correction notice carries the exact selection. Replace the previous
notice model and global pending-acknowledgement query; remove the broad-gate
fallback. Update development schema, seed data, and fixtures so notices without
affected_capabilities are invalid rather than silently gating all four areas.

## Authoritative per-operation authorization

For requested capability C, the correction gate is exactly:

`exists correction applicable to this Attempt where acknowledgement_required
and acknowledgement_state=pending and C is in affected_capabilities`.

Compute this in the same authorization/transaction boundary as the operation's
existing Session/Participation/Sitting checks. Querying the boolean in a separate
transaction before a mutation is insufficient because a correction can publish
between check and effect. Keep every other suspension, deadline, native-rule, and
continuity gate intact.

| Capability | Operations affected by its pending gate                                                            |
| ---------- | -------------------------------------------------------------------------------------------------- |
| workspace  | Candidate create/write/rename/move/delete of authoritative Workspace entries                       |
| browser    | Browser open/new navigation/redirect and release of a usable Browser Policy to a navigating source |
| submission | Submission creation/finalization                                                                   |

Corrected instructions and Exam Resources remain readable so the candidate can
understand and acknowledge the notice. Keep correction list/read/acknowledge,
participation renewal, minimized observation delivery, browser spool upload,
source sealing, and safe exit available subject to their ordinary authorization.
Read-only recovery may remain available. Desktop additionally closes its local
gates from the same immutable notice. A browser-only correction leaves Workspace
saves and submission available.

Expose a bounded `pending_correction_capabilities: CandidateCapability[]` union
in Candidate capability summaries alongside the individual notices. Derive each
workspace/browser/submission state independently. This field is a
projection of current notices, not a second authority.

## Acknowledgement and race behavior

Keep the existing exact revision/Attempt acknowledgement command and proof.
Acknowledgement marks only that applicable correction for that candidate. It
cannot acknowledge a future revision or all pending revisions implicitly. Exact
replay is idempotent. Two pending browser corrections require both
acknowledgements before browser resumes. Removing one pending item cannot open
a capability still gated by another item, suspension, native rule, or expiry.

A concurrent correction and candidate operation serialize at the existing
aggregate boundary: an operation committed before correction activation is
historical work; an operation after activation observes the new gate. The
acknowledgement response returns fresh capability state and current correction
revision so a stale client does not resume from an obsolete response.

Acceptance tests: browser-only correction with pending acknowledgement permits
workspace/submission; instructions/resources gate their minimum set;
explicit supersets; acknowledgement_required=false; multiple pending overlaps;
wrong candidate/revision; replay; publication-vs-mutation and ack-vs-new-correction
races; readonly notice access; and rejection of notices
without an affected-capability selection.

Acknowledgement order is oldest-first within the Attempt. Rejoin preserves
Attempt-owned pending acknowledgements. The order does not broaden the affected
capability set, and source/summary operations acknowledge no correction implicitly.
