# Protected delivery and resource budgets

The accepted wire contract uses the [shared conventions](conventions.md).
[Contract map and implementation status](README.md) separate agreement from availability.

## Native record ownership

Keep current Focus Loss and Connection Loss ingestion/evaluation. Add a separate
Participation-bound native delivery stream; do not overload FocusLossSignal with
arbitrary JSON or change its source enum to accept every native family.

The privileged Desktop coordinator already emits MinimizedIntegrityOccurrence
in `src/prctr/workbench/services/examSecurity/common/examSecurity.ts`. The wire
mapping below preserves that model and adds delivery/schema provenance in the
privileged transport. Native helpers and the utility process never receive
registered installation credentials.

```typescript
interface SourceRange {
  source_id: NativeSourceID;
  source_instance_id: OpaqueID;
  first_sequence: SafeInt;
  last_sequence: SafeInt; // >= first_sequence.
}
interface NativeOccurrence {
  kind: 'occurrence';
  occurrence_id: OpaqueID;
  condition_id: OpaqueID; // Registered deterministic detector condition, not prose.
  detector_id: OpaqueID;
  detector_version: PositiveInt;
  capability_id: OpaqueID;
  mode: 'observe' | 'enforce';
  status: 'opened' | 'repeated' | 'recovered';
  first_observed_at: Instant;
  last_confirmed_at: Instant;
  repeat_count: PositiveInt;
  certainty: 'complete' | 'partial' | 'unknown';
  gap_count: SafeInt;
  source_ranges: SourceRange[]; // 1..11, canonical source order.
}
interface NativeCoverageTransition {
  kind: 'coverage_transition';
  source: SourceCoverage;
  occurred_at: Instant;
  reason: 'initial' | 'health_changed' | 'permission_changed' | 'reconciled' | 'stopped';
}
interface NativeSourceGap {
  kind: 'source_gap';
  source_id: NativeSourceID;
  source_instance_id: OpaqueID;
  first_missing_sequence: SafeInt;
  last_missing_sequence: SafeInt;
  reason: 'overflow' | 'source_loss' | 'corruption';
  occurred_at: Instant;
}
type NativeRecord =
  NativeOccurrence | NativeCoverageTransition | NativeSourceReset | NativeSourceGap;
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

## Native operations

- `POST /exam-attempts/{attempt_id}/security-batches` accepts NativeSecurityBatch
  and returns NativeSecurityAcknowledgement. Use registered Desktop proof and
  Idempotency-Key; live delivery also requires current connection/generation.
- `GET /exam-attempts/{attempt_id}/security-streams/{stream_id}` returns the owning
  Desktop's NativeSecurityStreamStatus without detailed evidence.
- `POST /exam-attempts/{attempt_id}/security-streams/{stream_id}/seal` accepts
  FinalDeliveryDeclaration and returns NativeSecurityStreamStatus.
- `POST /exam-attempts/{attempt_id}/security-streams/{stream_id}/summary` accepts
  UnretainedDeliverySummary and returns the stored summary and current status.

One server-created stream belongs to one admitted security_session_id and
Participation generation. Batch sequence starts at one. Commit each batch
atomically, deduplicated by stream/sequence/canonical content and command key.
Apply ordered occurrence transitions through contiguous batches or explicitly
settled terminal gaps. prior_acknowledgement is only the client's known actual
receipt watermark; it cannot exceed the server watermark or advance authority.

Live HTTP delivery uses X-Proctor-Attempt-Credential and
X-Proctor-Attempt-Connection-ID alongside registered Session/DPoP authentication.
The exact connection determines the current Participation/generation. Historical
delivery uses the retained source/key owner under the rules below.

## Server validation and review meaning

Recheck ownership, Participant generation, policy/matrix/release binding, known
source instances and reset chain, selected family/sub-capability, detector
version, allowed mode, range order, monotonic occurrence transitions, and bounds.
A client cannot promote observe to enforce or select the server's consequence.
Maintain a release-owned detector catalog of allowed detector_id/version,
condition_id grammar, capability_id, source requirements, and allowed minimized
fields. If that catalog is not packaged yet, require coordinated fixtures and
keep production native ingestion unavailable; do not accept arbitrary prose IDs.

Occurrence first/last times are client provenance. Store server receive time
separately and never order cross-source facts by wall-clock equality. Repeat
counts cannot decrease; repeated/recovered must refer to a known opened
occurrence in the same stream/policy/generation, except for the explicitly
unresolved transition after a settled delivery hole described in [delivery progression](protected-delivery.md#a-permanent-missing-position-need-not-end-an-active-stream).
Recovery of a known occurrence closes it;
a later recurrence receives a new occurrence ID. Reject cross-occurrence reuse
and inconsistent source ranges. Source reset fences the retired instance; it
cannot recover a finding using a clean snapshot from the wrong lifetime.

Store native condition material separately from operational health/gap/reset
records. A confirmed, selected native condition can be retained as minimized
review evidence, with optional association to a separately created Flag. It is
not an automatic guilt finding. For this first protocol, native ingestion alone
creates no Flag, warning, or authoritative suspension; enforce mode drives
reversible local containment, and ordinary manager/lifecycle operations remain
the server's consequence owners. Preserve existing Focus Loss/Connection Loss
flagging behavior. Source gaps, permissions, uncertain coverage, or broken
helpers are operational facts and never become misconduct evidence by being
stored in the native stream.

If the current IntegrityEvidence structure requires every row to have a Flag,
introduce a closed native-occurrence/evidence model rather than fabricate a Flag
to satisfy that foreign key. Authorized detailed review must be able to inspect
native occurrences without declaring them violations. Add safe summary counts
and family-level health to the manager board; omit detailed identity and native
payloads from that board and ordinary realtime events.

The initial NativeOccurrence deliberately contains no optional identity text
or raw native detail bag. Signer/product/bundle details may later be added through
an exact reviewed per-family evidence union. For now their omission is a
bounded collection choice, not an invitation to put them into condition_id.

## Native retention

Native condition evidence follows the Institution's integrity retention/holds.
Operational coverage records use a separate class, with an explicit
`security_operational_retention_days` setting under the existing retention
approval machinery (0 means no configured expiry, consistent with existing
settings). The live latest-state row is needed only for current Participation;
expire/reduce normal coverage after closure according to that class. Do not
retain every renewal as an evidence event. Audits contain IDs, versions, counts,
and outcomes, never native facts or browser/workspace/terminal content.

## Native delivery acceptance tests

- Exact Desktop occurrence-to-wire fixtures; known detector/mode/source matrix;
  unknown fields, raw-content attempts, invalid identities, oversized payloads.
- Duplicate, reordered, missing, replay-window overflow, conflicting retry,
  partially invalid batch, response loss, and restart produce explicit watermarks.
- Open/repeat/recover/recurrence, source reset, source gap, permission change,
  clock rollback, and retired generation do not merge unrelated lifetimes.
- Ordinary healthy renewal creates no recurring evidence, and operational
  failure never creates a misconduct Flag.
- Containment retains Participation renewal but denies interaction; recovery
  requires exact healthy source generations and current server authorization.
- Pause, suspension, submission, manager end, Sitting close, Session/key
  revocation, and bounded late replay all preserve work and truthful gaps.
- Exact authorized review sees minimized condition material; ordinary board,
  audit, logs, and candidate renderer contain no detailed evidence.

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
  expected_declaration_revision: SafeInt;
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
  expected_declaration_revision: SafeInt;
  final_sequence: SafeInt;
}
interface DeliveryClosure {
  closed_at: Instant | null;
  close_reason: DeliveryCloseReason | null;
  known_at_close: SafeInt | null;
  final_sequence: SafeInt | null;
  final_declaration_id: OpaqueID | null;
  final_boundary_origin: 'client_declared' | 'server_known' | null;
  unknown_tail: boolean;
  upload_expires_at: Instant | null;
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

Normal native delivery contains transitions and bounded occurrence updates,
not periodic healthy inventories. For sizing, allow a sustained average of one
native detail record per second over a four-hour examination (14,400 records),
and one top-level browser event per second (another 14,400). Real normal usage
is expected to be lower; this is a planning assumption, not test evidence.
Redirect bursts and source changes must fit the existing 64-record request
ceiling. Repeated native updates for the same occurrence may be coalesced for
up to five seconds while preserving repeat counts, first/last times, uncertainty,
and source ranges. Open, recovery, source reset, and live containment are not
waiting on that coalescing timer. Never merge across source lifetimes.

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

Reserve latest live coverage, source bindings, closure/deadline, lifetime quota
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
local enforcement, server operation gates, execution freeze when required,
Participation renewal, correction acknowledgement, and submission remain valid.
Required live coverage failure continues to contain independently. Present
bounded incomplete-record status to authorized users; never claim complete
history after a quota-related omission.

## Bounded summaries after detail collection stops

Use one replaceable, cumulative summary per source/stream, not new evidence rows:

```typescript
interface UnretainedDeliverySummary {
  summary_sequence: PositiveInt;
  unretained_record_count: SafeInt;
  count_complete: boolean;
  first_unretained_at: Instant | null;
  last_unretained_at: Instant | null;
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
   sources. This includes bindings, start/refusal fingerprints, reset/declaration
   receipts, closure and final-boundary state, summary slots, omission markers,
   quota state, and the bounded live-control cache. Detail and content-receipt
   bytes already charged by [delivery budgets](protected-delivery.md#workload-assumptions-and-admission-limits) are counted there once, not again here.
2. Before creating a Participation's security stream/control owner, reserve the
   maximum bounded metadata needed for that owner's latest coverage, control
   ordering/cache, closure, final declaration, quota markers, and summary. Before
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
5. A reset whose necessary edge cannot be retained cannot establish usable new
   source continuity. Commit a processed `reset_required` result under [processed control ordering](secure-participation.md#processed-control-ordering),
   close the required security gates, and keep valid lease renewal available.
   Capacity loss must not be converted into a healthy source assertion.
6. Existing authoritative lifecycle, audit, idempotency, and execution-effect
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
