# Protected delivery and resource budgets

The accepted wire contract uses the [shared conventions](conventions.md).
[Contract map and implementation status](README.md) separate agreement from availability.

## Native record ownership

Keep current Focus Loss and Connection Loss ingestion/evaluation. Add a separate
Participation-bound native delivery stream; do not overload FocusLossSignal with
arbitrary JSON or change its source enum to accept every native family.

The native agent reports facts; Electron main's privileged transport adds the
delivery envelope. Native processes never receive registered installation
credentials. Shared aliases (`RegistryName`, `NativePermission`, `NativeHealth`,
`NativeCertainty`, `NativeRuleStatus`, `NativeUnknownCause`) are defined in
[security policy](security-policy.md#compiled-activations-and-rules) and
[secure participation](secure-participation.md#report-that-desktop-sends).

```typescript
interface NativeCapabilityFact {
  kind: 'capability_fact';
  observed_at: Instant; // Device time, whole milliseconds.
  capability: RegistryName; // An activated capability.
  source_instance_id: OpaqueID;
  sequence: SafeInt;
  permission: NativePermission;
  health: NativeHealth;
  certainty: NativeCertainty;
  state: object; // Valid against the capability's published state schema.
  summary: object; // Valid against its published summary schema; state + summary <=16 KiB.
}
interface NativeParticipationConfirmed {
  kind: 'participation_confirmed';
  observed_at: Instant;
}
interface NativeRuleStatusReport {
  kind: 'rule_status';
  rule_id: string; // <=128; a participation-phase rule of the policy.
  status: NativeRuleStatus;
  unknown_cause?: NativeUnknownCause; // Present only when status is unknown.
  contained: boolean; // Whether Desktop is containing the CandidateWindow because of it.
  observed_at: Instant;
}
interface NativeSourceGap {
  kind: 'source_gap';
  capability: RegistryName;
  source_instance_id: OpaqueID;
  first_missing_sequence: SafeInt;
  last_missing_sequence: SafeInt;
  reason: 'overflow' | 'source_loss' | 'corruption';
  occurred_at: Instant;
}
interface NativeSourceReset {
  kind: 'source_reset';
  reset_id: OpaqueID;
  capability: RegistryName;
  previous_source_instance_id: OpaqueID;
  previous_final_sequence: SafeInt;
  new_source_instance_id: OpaqueID;
  reason: 'restart' | 'resume' | 'permission_changed';
  occurred_at: Instant;
}
type NativeRecord =
  | NativeCapabilityFact
  | NativeParticipationConfirmed
  | NativeRuleStatusReport
  | NativeSourceGap
  | NativeSourceReset;
interface NativeSecurityBatch {
  stream_id: OpaqueID;
  batch_sequence: PositiveInt;
  prior_acknowledgement: SafeInt;
  participation_id: ID;
  generation: PositiveInt;
  security_session_id: OpaqueID;
  policy_digest: SHA256;
  application_release_id: OpaqueID;
  matrix_id: OpaqueID;
  records: NativeRecord[]; // 1..64; whole encoded request <=256 KiB.
}
```

Desktop sends a capability fact whenever a capability's state or envelope
changes; it carries the full minimized state, never a delta. A fact no newer
than the latest of its source instance changes nothing. Desktop sends
`participation_confirmed` exactly once, when the CandidateWindow mounts after
admission. Desktop sends a `rule_status` record when its own status or
containment for a participation rule changes. Source resets and gaps have no
separate receipts; the batch receipt covers them.

## Native operations

- `POST /exam-attempts/{attempt_id}/security-batches` (`appendNativeDelivery`)
  accepts NativeSecurityBatch and returns NativeSecurityAcknowledgement. Use
  registered Desktop proof and Idempotency-Key; live delivery also requires
  current connection/generation.
- `GET /exam-attempts/{attempt_id}/security-streams/{stream_id}`
  (`nativeDeliveryStatus`) returns the owning Desktop's
  NativeSecurityStreamStatus without detailed evidence.
- `POST /exam-attempts/{attempt_id}/security-streams/{stream_id}/seal`
  (`sealNativeDelivery`) accepts FinalDeliveryDeclaration and returns
  NativeSecurityStreamStatus.
- `POST /exam-attempts/{attempt_id}/security-streams/{stream_id}/summary`
  (`updateNativeDeliverySummary`) accepts UnretainedDeliverySummary and returns
  the current status.

One server-created stream belongs to one admitted security_session_id and
Participation generation. Batch sequence starts at one. Commit each batch
atomically, deduplicated by stream/sequence/canonical content and command key.
prior_acknowledgement is only the client's known actual receipt watermark; it
cannot exceed the server watermark or advance authority.

Live HTTP delivery uses X-Proctor-Attempt-Credential and
X-Proctor-Attempt-Connection-ID alongside registered Session/DPoP authentication.
The exact connection determines the current Participation/generation. Both
headers may be omitted after server-owned closure; historical delivery uses the
retained source/key owner under the rules below, and omission never establishes
historical authority.

## Server tracking and evaluation

At Connect the server begins tracking every activated capability from the
admitted preflight report's facts: its source instance, sequence, envelope and
state. For each batch it rechecks ownership, Participation generation, policy,
certification and release binding, then applies records in batch order:

- A capability fact must name an activated capability and a known source
  instance, with state and summary valid against the registry's published
  schemas. A fact for an unknown instance, or one that fails its schema,
  invalidates the batch.
- A source reset must name the capability's current instance as
  `previous_source_instance_id`, with `previous_final_sequence` not below the
  last sequence the server holds for it, and a fresh new instance. It fences the
  retired instance; a clean fact from the wrong lifetime cannot recover a rule.
  Reset reason does not authorize a new policy or a new capability.
- A source gap marks the named capability as having lost events; its rules are
  unknown (`gap`) until a fresh complete fact arrives.
- A batch position the server learns is permanently missing is treated as a gap
  for every activated capability, since any of them may have lost a fact there.
- `participation_confirmed`, sent exactly once, switches evaluation from
  readiness-phase rules to participation-phase rules.

The server evaluates the policy's rules on the facts it holds, with the same
three-valued semantics and per-capability stability time as Desktop
([native rules](../architecture/native-rules.md#evaluation)). Its status is
authoritative. A `rule_status` record is compared with the server's status for
the same rule; a disagreement is counted, never applied.

An occurrence opens when a rule becomes not met and closes when it becomes met
again. An enforce occurrence that opens raises its capability's native Flag; for
a `flag_and_suspend` family it also suspends the Attempt
([native outcomes](security-policy.md#native-outcomes)). When the policy's
screen recorder is on, an enforce occurrence that raises a native Flag also
creates an incident [screen clip](#screen-clips) request. Observe rules are
recorded only. Unknown status, gaps, resets, permissions and failed capabilities
are operational facts and never become misconduct evidence by being stored in
the native stream.

Client observed_at times are provenance. Store server receive time separately
and never order cross-capability facts by wall-clock equality.

## Native review

Authorized detailed review uses
`GET /submissions/{submission_id}/native-conditions` (`listNativeConditions`),
which requires the same Submission integrity-view authorization as detailed
evidence. It returns every change of a native rule's status as the server
evaluated it, at most 100 per page:

```typescript
interface NativeRuleTransition {
  rule_id: string;
  capability: RegistryName;
  mode: 'enforce' | 'observe';
  reason: string; // The registry's reason ID; Desktop owns its wording.
  from?: NativeRuleReport;
  to: NativeRuleReport;
  event?: 'opened' | 'closed';
  occurrence?: PositiveInt; // Counted from 1 per Participation.
  at: Instant; // Device time of the change; never moves backwards in a Participation.
}
interface NativeConditionEvidence {
  id: ID;
  attempt_id: ID;
  participation_id: ID;
  generation: PositiveInt;
  stream_id: OpaqueID;
  security_session_id: OpaqueID;
  policy_digest: SHA256;
  policy_revision_id: ID;
  application_release_id: OpaqueID;
  matrix_id: OpaqueID;
  batch_sequence: SafeInt; // 0..20000; 0 is the state reported at Start.
  record_index: SafeInt; // 0..63.
  received_at: Instant;
  interpreted_at: Instant;
  transition: NativeRuleTransition;
}
```

The facts themselves are not returned. The manager board carries
`native_security: NativeSecuritySummary` per candidate: retained condition
record count, whether live native delivery is open, each live enforce rule's
server status with its occurrence counts, whether Desktop reports containment,
and the Attempt's screen clips by state. It contains no facts, source-instance
or application identities; an application outside the catalog is never named.
Ordinary realtime events carry no native detail.

## Native retention

Native condition evidence follows the Institution's integrity retention/holds.
Operational native records (facts, gaps, resets, rule-status reports) use a
separate class, with an explicit `security_operational_retention_days` setting
under the existing retention approval machinery (0 means no configured expiry,
consistent with existing settings). The server's latest-state rows are needed
only for the current Participation; expire/reduce them after closure according
to that class. Do not retain every renewal as an evidence event. Audits contain
IDs, versions, counts, and outcomes, never native facts or
browser/workspace/terminal content.

## Native delivery acceptance tests

- Exact Desktop fact-to-wire fixtures; facts valid and invalid against every
  published schema; unknown fields, raw-content attempts, invalid identities,
  oversized state.
- Duplicate, reordered, missing, replay-window overflow, conflicting retry,
  partially invalid batch, response loss, and restart produce explicit watermarks.
- Source reset, source gap, permission change, a lost batch position, clock
  rollback, and retired generation do not merge unrelated lifetimes.
- Shared conformance vectors give identical server and Desktop rule statuses,
  including every unknown cause and the stability time.
- Readiness-to-participation switch at `participation_confirmed`, and a
  disagreeing `rule_status`.
- Enforce occurrence raising a native Flag, flag_and_suspend suspension, and an
  incident clip request; observe and operational failures never creating a Flag.
- Pause, suspension, submission, manager end, Sitting close, Session/key
  revocation, and bounded late replay all preserve work and truthful gaps.
- Exact authorized review sees rule transitions; ordinary board, audit, logs,
  and candidate renderer contain no facts.

## A permanent missing position need not end an active stream

Use `max(highest_contiguous, settled_through)` as the receive-window base both
before and after closure. Native window width remains 1,024 batches; browser
width remains its existing 4,096 events. Byte limits in [delivery budgets](protected-delivery.md#workload-assumptions-and-admission-limits) apply independently.

Contiguous acknowledges actual stored content only. Settled means each earlier
position is either stored or explicitly terminally missing. Neither a missing
declaration nor settlement counts as receipt. Later transitions whose required
earlier facts were lost remain explicitly unresolved. They do not fabricate an
opening, recovery, redirect origin, or misconduct conclusion.

Provide this operation for both native and browser sources:

```typescript
interface SequenceRange {
  first: PositiveInt;
  last: PositiveInt;
}
interface DeclareDeliveryGaps {
  declaration_id: OpaqueID;
  expected_revision: SafeInt; // The source's current declaration_revision.
  allocated_through_sequence: SafeInt;
  ranges: SequenceRange[]; // 1..32, sorted, disjoint, non-adjacent.
  reason: 'spool_corrupt' | 'spool_lost' | 'local_capacity_exhausted';
}
interface DeliveryGapReceipt {
  declaration_id: OpaqueID;
  request_digest: SHA256;
  declaration_revision: PositiveInt;
  settled_through_sequence: SafeInt;
}
```

The request is at most 8 KiB. It declares only allocated, permanently unavailable
positions, never future capacity reservations. Every range must be at or below
allocated_through_sequence and within the permitted receive window at commit;
advance in successive bounded declarations if necessary. Reject any range
intersecting already retained content. Its durable receipt makes those positions
terminal; later content for them conflicts. Repeating the same declaration ID
and bytes returns its receipt without spending quota twice; different bytes
conflict. Revision comparison serializes concurrent declarations and finalization.

Each newly accepted gap or final declaration increments declaration_revision
once; an exact replay does not. A final declaration fixes the upper boundary,
but subsequent gap declarations may still mark loss within that boundary before
upload expiry. They cannot change it or reclaim retained positions.

During live participation require the same current connection/generation fences
as upload. After closure use [closure and final boundaries](protected-delivery.md#closure-is-server-owned-a-final-declaration-is-separate)'s historical ownership and final boundary.
The server records the loss as client-reported operational provenance; it cannot
prove the physical cause. A declaration creates no misconduct Flag or new source
lifetime. A browser gap alone does not spend its runtime-reset source budget.

Routes, relative to the existing API root:

- Native: `POST /exam-attempts/{attempt_id}/security-streams/{stream_id}/gaps`.
- Browser: `POST /exam-attempts/{attempt_id}/browser-activity/sources/{source_session_id}/gaps`.

Both require an Idempotency-Key in addition to their semantic declaration ID.
They remain available when the detail queue is full, subject to the reserved
metadata budget and lifetime limits in [delivery budgets](protected-delivery.md#workload-assumptions-and-admission-limits).

## Receipts permit bounded protected-spool cleanup

Return an exact durable receipt on every successful native append:

```typescript
interface NativeBatchReceipt {
  stream_id: OpaqueID;
  batch_sequence: PositiveInt;
  request_digest: SHA256;
  received_at: Instant;
}
interface NativeSecurityAcknowledgement {
  receipt: NativeBatchReceipt;
  highest_contiguous_batch_sequence: SafeInt;
  settled_through_batch_sequence: SafeInt;
  highest_seen_batch_sequence: SafeInt;
  missing_batch_ranges: SequenceRange[]; // Earliest 32 recoverable ranges.
  missing_ranges_truncated: boolean;
  server_time: Instant;
}
```

The digest covers the exact submitted batch. Desktop persists the receipt and
removes that batch's local payload atomically, even when an earlier permanent
gap keeps highest_contiguous at zero. A declaration receipt permits cleanup
only of its declared irrecoverable positions. Settlement by itself permits no
payload deletion. Browser receipts acknowledge individual sequence/digest pairs
under [browser sources](browser.md#source-lifecycle), so changing batch packing cannot duplicate an event.

Add native receipt lookup:
`GET /exam-attempts/{attempt_id}/security-streams/{stream_id}/receipts/{batch_sequence}`.
It returns NativeBatchReceipt only for actually retained content and is
authorized through the same source ownership. Retain exact receipt fingerprints
for the permitted upload window, including behind the receive window; their
count is bounded by [delivery budgets](protected-delivery.md#workload-assumptions-and-admission-limits). A missing declaration cannot produce a content receipt.

Canonical exact replay includes the batch's original prior_acknowledgement;
Desktop stores and retries the original request rather than mutating that member.
Old successful commands remain deduplicated after newer progress. Different
bytes at an already retained sequence conflict.

## Closure is server-owned; a final declaration is separate

The historical upload deadline is:

`upload_expires_at = min(closed_at + 24 hours, earlier applicable retirement deadline)`.

Persist closed_at when live collection authority first ends. The deadline never
moves later. Client sealing, reauthentication, retries, and restart cannot extend
it. Closing a source does not wait for an evidence upload or final declaration.
Submission/manager end/Participation termination and browser correction are
authoritative closure triggers. Freeze known_at_close as the greatest accepted
sequence or accepted live-control allocated watermark at that instant.

```typescript
interface FinalDeliveryDeclaration {
  declaration_id: OpaqueID;
  expected_revision: SafeInt; // The source's current declaration_revision.
  final_sequence: SafeInt;
}
// Absent members are omitted, never null. An open delivery carries only unknown_tail.
interface DeliveryClosure {
  closed_at?: Instant;
  close_reason?: DeliveryCloseReason;
  known_at_close?: SafeInt;
  final_sequence?: SafeInt;
  final_declaration_id?: OpaqueID;
  final_boundary_origin?: 'client_declared' | 'server_known';
  unknown_tail: boolean;
  upload_expires_at?: Instant;
}
type DeliveryCloseReason =
  | 'submission'
  | 'suspension'
  | 'manager_end'
  | 'sitting_closed'
  | 'participation_ended'
  | 'security_session_lost'
  | 'policy_correction'
  | 'runtime_reset'
  | 'browser_disabled';
```

Only a closed source can accept FinalDeliveryDeclaration. It is at most 2 KiB,
requires Idempotency-Key, and succeeds once. Exact replay is idempotent; a later
different boundary conflicts. The client does not choose close_reason. Native
closure cannot use the browser-specific reasons.

The accepted final boundary must be at least known_at_close and every already
retained/declared position. It may exceed known_at_close by at most 1,024 native
batches or 4,096 browser events, and must also fit remaining position limits
under [delivery budgets](protected-delivery.md#workload-assumptions-and-admission-limits). Accepting it atomically charges those additional positions. This is
a bounded assertion about an unreported historical tail, not server attestation
that records existed before closure. It grants no new source, observation, or
interaction authority. Oversized tails remain an explicit unknown discrepancy;
do not silently clamp a client's declaration and call it exact.

[delivery budgets](protected-delivery.md#workload-assumptions-and-admission-limits)'s summary-only cutoff takes precedence: a final declaration cannot raise
the frozen allocated boundary after detail collection stops. A larger local tail
remains unknown and can be described only by the bounded operational summary.
Even a known final sequence does not make later unsequenced omissions complete;
summary state and terminal missing positions remain part of review settlement.

Before final declaration, late upload may fill only through known_at_close.
After declaration, it may fill through final_sequence. In both cases, the caller
needs a valid current Session for the same User and registered key recorded on
the source; an old invalid Session is not revived. Revocation denies replay,
and a replacement key cannot claim the source. Current Attempt connection is
unnecessary solely for historical delivery. Retention holds do not extend the
collection/replay deadline.

At upload expiry, an undeclared source gets final_sequence=known_at_close,
final_boundary_origin=server_known, and unknown_tail=true. A declared source
keeps its boundary and origin. Remaining holes become terminal discrepancies;
received content never disappears into a synthetic missing interval. Derive
terminal holes from the bounded position/receipt ledger if necessary rather
than requiring an unbounded array of gap rows. Finite settlement must succeed
without client cooperation. Work/Submission bytes remain unchanged.

The native seal operation accepts FinalDeliveryDeclaration and returns current
source status. Gaps use their own operation. Status exposes closure and progress
independently; a sealed boolean cannot represent those facts.

The native status shape is:

```typescript
interface NativeSecurityStreamStatus extends Omit<NativeSecurityAcknowledgement, 'receipt'> {
  stream_id: OpaqueID;
  allocated_through_sequence: SafeInt;
  terminal_missing_through_sequence: SafeInt;
  closure: DeliveryClosure;
  declaration_revision: SafeInt;
  detail_mode: 'collecting' | 'summary_only';
  budget_scope: 'participation' | 'attempt' | null;
  summary_only_reason: DeliveryStopReason | null;
  summary: UnretainedDeliverySummary | null;
}
```

Status contains no append receipt for an unrelated request. A source status is
bounded at 16 KiB. Empty/missing final declaration has final_declaration_id=null;
a successful client declaration fixes its ID permanently. A server-known final
boundary has no client declaration ID. While open, closure dates/reason and
final-boundary fields are null and unknown_tail=false; after undeclared closure,
unknown_tail=true; a valid complete final declaration sets it false while any
missing positions remain separately visible.

Tests: first/middle permanent holes during active operation and after closure,
progress past both receive-window widths, exact receipts behind a gap, conflicting
replay, absent client, later bounded tail, an excessive tail, declaration races,
revocation, expiry/restart, and independently earlier retirement.

## Workload assumptions and admission limits

These are accepted initial constants and workload assumptions, not measured
production throughput. Implementation must validate the required capacity cases.

Normal native delivery contains capability facts sent on change, rule-status
changes, and source resets/gaps, not periodic healthy inventories. For sizing,
allow a sustained average of one native detail record per second over a
four-hour examination (14,400 records), and one top-level browser event per
second (another 14,400). Real normal usage is expected to be lower; this is a
planning assumption, not test evidence. Redirect bursts and source changes must
fit the existing 64-record request ceiling. Desktop may coalesce successive
facts for one source instance into its latest state; containment changes and
source resets are not delayed by batching. Never merge across source lifetimes.

A limit ending in “per Attempt” combines all its Participations and sources;
rejoin, correction, and source reset never replenish that allowance. A per-
Participation limit is additional. All applicable limits must pass.

| Resource                                                                          | Per Participation         | Per Attempt                                                  |
| --------------------------------------------------------------------------------- | ------------------------- | ------------------------------------------------------------ |
| Native accepted detail records, including operational detail records              | 50,000 records and 32 MiB | 200,000 records and 128 MiB                                  |
| Native allocated batch positions, including missing positions                     | 20,000                    | 80,000                                                       |
| Browser accepted detail events                                                    | 50,000 events and 32 MiB  | 200,000 events and 128 MiB                                   |
| Browser allocated event positions across all sources, including missing positions | 50,000                    | 200,000                                                      |
| Native pending out-of-order bytes across its sources                              | —                         | 2 MiB                                                        |
| Browser pending out-of-order bytes across its sources                             | —                         | 2 MiB                                                        |
| Browser-navigation Flag groups                                                    | —                         | 256                                                          |
| Detailed browser evidence copied into Flag groups                                 | —                         | 10,000 records and 8 MiB, additionally at most 100 per group |
| Explicit client-declared terminal missing intervals across both delivery families | —                         | 4,096 intervals                                              |
| Additional delivery-control metadata, excluding counted payloads/receipts         | —                         | 2 MiB                                                        |
| Desktop native protected detail spool                                             | —                         | 4 MiB and 8,192 records                                      |
| Desktop browser protected detail spool across every source                        | —                         | 4 MiB and 8,192 events                                       |

MiB means 1,048,576 bytes. Detail bytes count canonical persisted record/event
bytes plus fixed fingerprint/sequence receipt data, once per unique record;
native batch envelope/receipt bytes also count once. Pending bytes count the
same data and are included in retained-byte totals, not a second free allowance.
Repacking/retrying events does not spend their retained quota twice. Positions
are charged when the server first accepts a record, live allocated watermark,
gap declaration, or final declaration that raises that source's allocated
boundary. Raising a boundary charges its entire delta, including holes.

These are application-data ceilings. SQL indexes, storage-engine overhead,
replication, HTTP decoding, and background workers need separate deployment
sizing and bounded concurrency; do not describe these limits as total RAM or
physical disk guarantees. Global admission/overload handling remains necessary.

Current budget snapshots returned by owning status/error/control operations use:

```typescript
type DeliveryStopReason =
  'records' | 'bytes' | 'positions' | 'metadata' | 'local_loss_inventory_exhausted';
interface DeliveryQuotaUsage {
  retained_records: SafeInt;
  retained_bytes: SafeInt;
  allocated_positions: SafeInt;
  record_limit: PositiveInt;
  byte_limit: PositiveInt;
  position_limit: PositiveInt;
  summary_only: boolean;
  stop_reason: DeliveryStopReason | null;
}
interface DeliveryFamilyBudget {
  participation: DeliveryQuotaUsage;
  attempt: DeliveryQuotaUsage;
  pending_bytes: SafeInt;
  pending_byte_limit: PositiveInt;
}
interface DeliveryBudgetSnapshot {
  participation_id: ID;
  generation: PositiveInt;
  native: DeliveryFamilyBudget;
  browser: DeliveryFamilyBudget;
  browser_flag_groups: SafeInt;
  browser_evidence_records: SafeInt;
  browser_evidence_bytes: SafeInt;
  explicit_missing_intervals: SafeInt;
  control_metadata_bytes: SafeInt;
  server_time: Instant;
}
```

Provide `GET /exam-attempts/{attempt_id}/delivery-limits?participation_id=...`
for the owning registered Desktop. Return this snapshot, bounded at 8 KiB;
the generation is the requested owned Participation, and Attempt counters are
current across generations. It is a projection, never permission to select a
larger limit. All quota compare-and-increment decisions are transactional.

Within each 2-MiB pending allowance reserve 320 KiB for a repair request beginning
at the next unsettled position. Non-repair requests may consume only 1,728 KiB.
The reserve covers the 256-KiB request ceiling plus at most 64 KiB of its counted
receipt/envelope metadata; enforce that metadata bound at admission too.
Reserve the same repair headroom within retained-byte limits while an earlier
recoverable gap exists. A full out-of-order queue must not prevent the one
request that advances it. Gap declarations and control/status operations have
separate reserved capacity. For browser repair, require a consecutive event run
beginning at that position; a request with unrelated later events does not
qualify merely because it also names the missing first event.

Append rate limits, shared across a User's Sessions and transport choices for
the same Attempt: native 2 requests/second with burst 8; browser 2 requests/second
with burst 8. Replay consumes request-rate allowance but not retained quota.
Use 429 plus an integer Retry-After of 1..30 seconds; apply bounded jittered
retry, not parallel retries across transports. Live renewal, security updates,
source closure, status, and gap/final declarations are separate control traffic.
They are subject to ordinary abuse protection without competing for append slots.

## Refusal, bounded retry, and permanent exhaustion

An append is atomic: accept and receipt every new record in it, or accept none.
Validate authorization and conflicts before returning cached success. Do not
acknowledge rejected bytes. Return a bounded current progress/budget snapshot
with safe application errors:

| Code                                  | HTTP equivalent | Desktop behavior                                                                                                      |
| ------------------------------------- | --------------- | --------------------------------------------------------------------------------------------------------------------- |
| exam.delivery.pending_capacity        | 429             | Honor Retry-After; send earliest repair first; keep bounded spool and renew normally.                                 |
| exam.delivery.replay_window_exceeded  | 409             | Reconcile earliest missing positions, using [protected delivery](protected-delivery.md) gaps only for permanent loss. |
| exam.delivery.detail_budget_exhausted | 409             | Enter the indicated family's summary-only mode and apply the terminal-loss rule below. No repeated detail retries.    |
| exam.delivery.sequence_limit          | 409             | Same summary-only outcome; no allocation beyond the retained position limit.                                          |
| exam.delivery.declaration_conflict    | 409             | Read status and reconcile the exact declaration; do not invent a new boundary.                                        |
| exam.delivery.upload_expired          | 410             | Stop replay; retain the server's terminal discrepancy.                                                                |

When a Participation or Attempt detail/position limit is exhausted, latch
summary-only for that family at that scope. A Participation-only latch permits a
later authorized generation to use the remaining Attempt quota; an Attempt latch
persists across rejoin. Retirement or deleting local spool data does not refund
these lifetime counters. Exhausting the shared metadata budget latches both
families for the Attempt. Status says which scope and limit caused the latch.

The server freezes the affected sources' allocated boundary and persists one
`terminal_missing_through_sequence` cutoff per source. Any unreceived position
at or below that cutoff is terminally omitted due to server capacity; retained
positions remain received. Later new detail is refused. Exact replay of already
received content can still recover its receipt. This bounded cutoff plus the
receipt ledger represents loss without allocating thousands of extra gap rows.
The server's fixed summary-only receipt/status authorizes Desktop to drop only
those rejected/omitted positions, with explicit capacity provenance. It is not
an acknowledgement of their content. A locally held tail beyond the server's
known boundary is reported as an unknown/count-only tail, not falsely accepted.

Reserve latest capability state and rule statuses, source bindings, closure/deadline, lifetime quota
counters, and the summary-only marker before admitting detailed delivery; these
fixed state slots remain writable after the detail budget is spent. Keep a
bounded latest-state/control-receipt cache rather than appending every healthy
renewal. Existing general audit/idempotency retention controls remain separate.

An ordinary local spool limit does not immediately exhaust server detail quota.
Prefer stopping nonessential repeated-detail emission and retrying earliest
records within the byte bound. If detail must be discarded, retain a bounded
loss declaration in a separate reserved 64-KiB local control area per family;
upload the declaration before advancing through those positions. If even this
loss inventory cannot be represented, request server summary-only for that
family. An unavailable/corrupt local control store invokes the existing local
containment/recovery path; it does not justify reporting healthy monitoring.

Add `POST /exam-attempts/{attempt_id}/delivery-limits/stop-details`, body
`{ family: 'native' | 'browser', reason: 'local_loss_inventory_exhausted' }`,
requiring current live fences and Idempotency-Key. It atomically applies the
same Participation-scoped summary-only cutoff and returns the current budget
and affected source statuses for the current Participation only: at most one
native stream or 49 browser sources, according to family, in a response bounded
at 1 MiB. The client cannot replenish quotas with this operation.

Historical detail exhaustion alone creates no misconduct Flag and does not
suspend the Attempt or deny otherwise authorized interaction. Native observation,
local enforcement, server operation gates,
Participation renewal, correction acknowledgement, and submission remain valid.
Enforce rules continue to contain locally and the server keeps evaluating the facts it receives. Present
bounded incomplete-record status to authorized users; never claim complete
history after a quota-related omission.

## Bounded summaries after detail collection stops

Use one replaceable, cumulative summary per source/stream, not new evidence rows:

```typescript
interface UnretainedDeliverySummary {
  summary_sequence: PositiveInt;
  unretained_record_count: SafeInt;
  count_complete: boolean;
  first_unretained_at?: Instant; // Omitted, never null, when unknown.
  last_unretained_at?: Instant;
}
```

Submit through the source's `POST .../summary` operation, at most 2 KiB, using
live fences before closure and historical ownership afterward. Rate: at most
one changed summary per source per five seconds, except its one final summary.
Exact sequence/body replay is idempotent; lower counts conflict, and a false
count_complete cannot become true within that source. After a counter overflow,
saturate at SafeInt maximum and set count_complete=false. Missing local counters
also mean incomplete; never initialize lost history to a truthful zero.

Times/counts are explicitly client-reported, disclose no locations or native
identities, and do not prove a policy breach. The server stores its receive time
separately. This summary is operational uncertainty, not additional validated
Flag evidence. Its existence does not extend source lifetime or upload deadline.

## Budget acceptance cases

Verify maximum payloads; a full pending queue followed by repair; long permanent
gaps; sharing quotas across 49 sources and rejoined Participations; concurrent
quota races; 100 details then overflow; evidence-byte exhaustion before 100;
256 groups then bounded summary; summary-counter loss; exact retries; and live
renewal/containment while historical detail budgets are exhausted.

## Metadata reservation and accounting

1. Count all new delivery-owned metadata across the Attempt's Participations and
   sources. This includes bindings, start/refusal fingerprints, reset edges, declaration
   receipts, closure and final-boundary state, summary slots, omission markers,
   quota state, and the bounded live-control cache. Detail and content-receipt
   bytes already charged by [delivery budgets](protected-delivery.md#workload-assumptions-and-admission-limits) are counted there once, not again here.
2. Before creating a Participation's security stream/control owner, reserve the
   maximum bounded metadata needed for that owner's latest capability state and
   rule statuses, control ordering/cache, closure, final declaration, quota markers, and summary. Before
   creating a browser source, reserve its binding, fixed refusal/closure/final
   state, summary, and omission marker. Compute reservations from the closed
   stored shapes and their bounds using canonical application-data bytes; SQL
   indexes and database overhead retain [delivery budgets](protected-delivery.md#workload-assumptions-and-admission-limits)'s separate deployment sizing.
3. Charge reserved capacity to `control_metadata_bytes` at allocation. Writes
   within those reserved slots, including repeated healthy renewals and summaries,
   spend no additional lifetime quota. Reservations are not refunded by closure,
   rejoin, source replacement, local deletion, or retirement. This retains [delivery budgets](protected-delivery.md#workload-assumptions-and-admission-limits)'s
   lifetime accounting and makes empty-source creation consume finite capacity.
4. Additional gap/reset/declaration metadata that does not fit an existing
   reservation requires its own atomic capacity check before creating the fact.
   The explicit 4,096 missing-interval cap remains independently applicable.
   Exhaustion follows the existing metadata summary-only rule. Terminal holes
   are represented by the reserved cutoff/receipt ledger, not extra unbounded rows.
5. A batch carrying a source reset whose edge cannot be retained is refused with
   the metadata capacity outcome; it cannot establish new source continuity, so
   the capability's rules stay unknown while valid lease renewal remains
   available. Capacity loss must not be converted into a healthy source assertion.
6. Existing authoritative lifecycle, audit, and idempotency
   owners retain their existing storage controls. The contract does not relabel
   newly introduced delivery metadata as general audit state to evade its cap.

This does not promise that every Attempt can exhaust every per-Participation
maximum independently. The aggregate metadata budget applies too, just as the
aggregate record and byte budgets do. Ordinary detail-budget exhaustion alone
still permits source creation or authorized rejoin when the necessary metadata
reservation remains available.

## Metadata capacity refusal

Add `exam.delivery.metadata_capacity`, with HTTP equivalent 409 and the same
stable code in realtime. Its safe bounded fields are `control_metadata_bytes`,
`control_metadata_limit_bytes` (2,097,152), `required_reservation_bytes`, and
`remaining_reservable_bytes`; each is a SafeInt. Return no metadata payloads.
These capacity fields are bounded at 1 KiB. The complete refusal is bounded at
8 KiB, or 64 KiB when it also includes [refused browser replacement](browser.md#committed-browser-reset-outcomes)'s closed-source status and capability
projection. This is a permanent lifetime-capacity refusal, not a transient 429
asking the client to retry indefinitely.

| Allocation                                                                                        | Behavior when its required reservation cannot fit                                                                                                                                                                 |
| ------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| First secure admission or Ready rejoin                                                            | Do not consume the preflight, create a Participation/stream, or move the Attempt to Active. Preserve any existing Ready Attempt; if none exists, create none solely for this refusal. Return the capacity reason. |
| Initial browser source                                                                            | Create no source and keep browser navigation unavailable. Other independently permitted capabilities remain usable.                                                                                               |
| Correction successor                                                                              | The superseded source remains closed. Create no successor; keep the browser unavailable.                                                                                                                          |
| Runtime-reset successor                                                                           | Apply [refused browser replacement](browser.md#committed-browser-reset-outcomes)'s committed predecessor closure and bounded refusal.                                                                             |
| Mutation of an existing reserved closure, live-control, final-boundary, summary, or omission slot | Complete it within its reservation, subject to its ordinary authorization and lifecycle rules. The spent detail/metadata pool does not block this update.                                                         |

An existing active Participation is not suspended merely because its history
budget is spent. A new allocation that cannot fit is unavailable. This is an
explicit capacity limitation on further admission/browser replacement; it is
not a misconduct finding and must not trigger automatic reallow/rejoin loops.
Safe departure and ordinary authorized manager end remain available. The initial
contract contains no quota-refill or new administrator-override mechanism.

Shared acceptance cases: many empty-source creations and rejoined Participations;
metadata limit reached before any detail limit; concurrent source/Connect
reservations; exact retry without double charge; source reset with no room for
its edge; and closure, final settlement, renewal, freeze, and summary updates
after all unreserved metadata capacity is exhausted.

## Screen clips

When the policy's [screen recorder](security-policy.md#screen-recording) is on,
Desktop records the whole session on the device and uploads only requested
ranges. The local recording is deleted at submission.

```typescript
interface ScreenClipRange {
  from_session_start: boolean; // From the moment the CandidateWindow opened.
  start?: Instant; // Required unless from_session_start; omitted then.
  end: Instant;
}
interface ScreenClip {
  id: ID;
  exam_attempt_id: ID;
  source: 'manager' | 'incident';
  range: ScreenClipRange;
  state: 'requested' | 'recording' | 'uploading' | 'ready' | 'failed';
  failure?: 'attempt_ended' | 'not_recorded' | 'upload_deadline' | 'rejected'; // Only when failed.
  requested_at: Instant;
  updated_at: Instant;
  revision: PositiveInt;
}
interface BeginScreenClipUpload {
  media_type: 'video/mp4' | 'video/webm';
  size_bytes: PositiveInt; // <=3221225472 (3 GiB).
  chunk_sha256: string[]; // 1..384 lowercase-hex SHA-256 values, one per chunk in order.
}
interface ScreenClipUpload {
  clip: ScreenClip;
  chunk_bytes: PositiveInt; // 8388608: every chunk but the last.
  chunk_count: PositiveInt; // 1..384.
  content_digest: string; // ^[0-9a-f]{64}$.
  received_chunks: PositiveInt[]; // <=384; chunk numbers from 1 that arrived, in order.
}
interface CompleteScreenClipUpload {
  content_digest: string; // ^[0-9a-f]{64}$; as the upload status reports it.
  signature: string; // ^[A-Za-z0-9_-]{86}$; ES256 raw r‖s, unpadded base64url.
}
interface RequestScreenClip {
  from_session_start: boolean;
  start?: Instant;
  end: Instant; // At most ten minutes after the request.
  reason: string; // 1..1000; stored with the request and never returned.
}
```

Candidate routes, for the registered Desktop that owns the Attempt:

- `GET /exam-attempts/{attempt_id}/screen-clip-requests`
  (`listCandidateScreenClipRequests`) lists, newest first, the requests waiting
  for Desktop. Each item carries the range to cut, never who asked or why.
- `POST /exam-attempts/{attempt_id}/screen-clip-requests/{screen_clip_id}/take`
  (`takeCandidateScreenClipRequest`) records that Desktop took the request and is
  recording what remains of its range. The request then belongs to the taking
  Participation; taking it again through that Participation returns it unchanged.
- `POST …/screen-clip-requests/{screen_clip_id}/upload`
  (`beginCandidateScreenClipUpload`) declares BeginScreenClipUpload and returns
  ScreenClipUpload. Declaring the same clip again returns it unchanged.
- `GET …/screen-clip-requests/{screen_clip_id}/upload`
  (`getCandidateScreenClipUpload`) returns ScreenClipUpload so Desktop resumes an
  interrupted upload with the remaining chunks.
- `PUT …/screen-clip-requests/{screen_clip_id}/upload/chunks/{chunk}`
  (`uploadCandidateScreenClipChunk`) streams one chunk as the raw body with its
  exact Content-Length and returns `{ chunk }`. The bytes are kept only when they
  match the declared hash. Resending a stored chunk changes nothing.
- `POST …/screen-clip-requests/{screen_clip_id}/upload/complete`
  (`completeCandidateScreenClipUpload`) accepts CompleteScreenClipUpload once
  every chunk arrived and makes the clip ready. Completing again returns it
  unchanged.

Listing and taking require X-Proctor-Attempt-Credential and
X-Proctor-Attempt-Connection-ID, so requests are taken only during
participation. Requests made while the Attempt is suspended are queued by the
server and appear once the candidate resumes. After the Participation that took a
clip closes, as at submission, the upload routes accept requests without those
two headers from the same registered Desktop until that Participation's upload
deadline; a clip not complete by then fails with `upload_deadline`. A request
never taken fails with `attempt_ended` when the Attempt is submitted.

Every chunk is 8,388,608 bytes except the last, which holds the rest. A clip is
at most 3 GiB (`exam.attempt.screen_clip_too_large`), and a clip that would take
the Attempt's clips past 6 GiB is refused. `content_digest` is the lowercase-hex
SHA-256 of the manifest bytes:

```text
"proctor-screen-clip-v1\n" + media_type + "\n" + size_bytes + "\n" + 8388608 + "\n"
  + for each chunk in order: chunk_sha256 + "\n"
```

with decimal integers. The signature is the installation key's ES256 signature,
raw r‖s in unpadded base64url, over the 64 ASCII bytes of content_digest. It
must verify with the public key of the Desktop registration uploading the clip
and is stored with the clip, so a reviewer can check the clip later from the
clip and its record alone. Completion before every chunk arrived fails with
`exam.attempt.screen_clip_incomplete`.

Manager routes, under
`/exams/{exam_id}/sittings/{sitting_id}/attempts/{attempt_id}/screen-clips`:

- `POST` (`requestExamAttemptScreenClip`) with RequestScreenClip and an
  Idempotency-Key returns the ScreenClip, 201 when created and 200 on replay. The
  range is from session start or an explicit start and end of at most six hours,
  ending at most ten minutes after the request; Desktop waits for the future part
  before cutting. The reason is audited and never returned. An Attempt takes at
  most ten manager requests (`exam.attempt.screen_clip_limit_reached`); an Exam
  whose policy has the recorder off refuses (`exam.attempt.screen_recording_off`).
  Requests stop once the Attempt has ended.
- `GET` (`listExamAttemptScreenClips`) lists, newest first, every clip for the
  Attempt, manager and incident alike, with its state.
- `GET …/screen-clips/{screen_clip_id}/content` (`playExamAttemptScreenClip`)
  streams a ready clip to one of the Sitting's Exam Managers, whole or by one
  byte range (`Range`, 206). Multiple ranges or a range past the end are refused.
  Each playback from the first byte is audited.

When the recorder is on, an enforce occurrence that raises a native Flag creates
an incident request for the range from 60 seconds before to 60 seconds after the
occurrence. The realtime event `exam_attempt_screen_clips_requested`, on
`exam.sitting.participate` for the addressed candidate, carries
`{ exam_sitting_id, exam_attempt_id, changed_at }` and none of the requests;
Desktop then lists its pending requests. Clip bytes are integrity evidence and
follow its retention.

Tests: chunk resume after a lost response; a chunk not matching its hash; the
last-chunk size; manifest digest fixtures; signature from another registration;
the 3 GiB and 6 GiB limits; upload after submission without the live headers and
after the deadline; requests queued during suspension; and incident requests
from a native Flag.
