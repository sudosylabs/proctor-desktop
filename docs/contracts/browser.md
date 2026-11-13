# Browser policy, sources, and privacy

The accepted wire contract uses the [shared conventions](conventions.md).
[Contract map and implementation status](README.md) separate agreement from availability.

## Browser Policy

```typescript
interface BrowserPolicy {
  enabled: boolean;
  start_rule_id?: string; // Required iff enabled.
  rules?: BrowserPolicyRule[]; // 1..128 iff enabled; absent when disabled.
}
interface BrowserPolicyRule {
  rule_id: string; // Existing lowercase [a-z0-9_-]{1,64} is retained.
  origin: string; // Bounded ASCII, <=2048 bytes; canonical exact origin.
  path_prefix: string; // <=2048 ASCII bytes; rules below.
  host_match: 'exact' | 'exact_and_subdomains';
  allow_redirects: boolean;
  blocked_navigation_outcome: 'record' | 'integrity_evidence';
  institution_http_exception: boolean; // Explicit even when false.
}
interface CandidateBrowserPolicy extends BrowserPolicy {
  policy_revision_id: ID;
  policy_revision_number: PositiveInt;
  policy_digest: SHA256;
  browser_activity_disclosure: BrowserActivityDisclosure;
}
```

Retain the canonical policy byte ceiling of 32 KiB in addition to the 128-rule
bound. Canonical authoring sorts rules by rule_id, rejects duplicate IDs and
identical origin/path/host-match predicates, and requires start_rule_id to exist.
Digest canonical BrowserPolicy bytes; exclude candidate-only revision/digest
metadata and the separately revisioned browser_activity_disclosure.
The surrounding authenticated connection supplies Attempt/generation for the
Desktop adapter's BrowserPolicy scope. policy_revision_number supplies its
monotonic ordinal; an opaque revision ID must not be lexically ordered.

An HTTP rule is permitted only when
institution_http_exception=trueinstitution_http_exception=true and its normalized hostname and explicit-port
component match the pinned canonical HTTPS Institution origin. Default ports
normalize away (HTTPS 443 and HTTP 80). Reject exceptions to unrelated hosts,
non-HTTPS Institution origins, or different explicit ports. HTTPS rules require
institution_http_exception=false. An exception authorizes exam web navigation,
not HTTP Desktop Authorization, credential transport, or a production origin.

## Exact canonicalization and rule selection

The target is deliberately closed and aligned with browser request parsing:

1. Enforce the existing 8,192-character navigation input bound, strict string
   input, and no literal controls/DEL/backslash. Rule origins are bounded ASCII.
2. Parse network origins using HTTPS, or the exact admitted HTTP exception.
   Reject user-info, query, fragment, and non-root path on a rule origin.
   Lowercase DNS labels and remove default port. Ports are decimal 1..65535;
   reject noncanonical leading-zero spellings. DNS labels are 1..63 ASCII
   letters/digits/hyphens with no leading/trailing hyphen; host <=253 bytes,
   no trailing dot, empty labels, or `xn--` labels. Unicode/IDN/punycode and IPv6
   hosts are unavailable in this contract to match the packaged Desktop capability.
   Canonical dotted-decimal IPv4 is supported; navigation parsing normalizes
   browser-supported numeric IPv4 spellings before matching. Authoring returns
   the canonical dotted form. Wildcard host matching is forbidden for IP hosts.
3. A rule path begins with one slash, contains no query/fragment/backslash,
   malformed percent triplet, encoded slash/backslash (`%2f`, `%5c`, any case),
   or dot/dot-dot segment after browser dot-segment recognition. Reject a rule
   requiring normalization instead of silently broadening it. A trailing slash
   on a non-root prefix is normalized away, once, at authoring.
4. Navigation uses the browser's serialized pathname after its dot-segment
   handling. Preserve repeated internal slashes and percent-encoded unreserved
   characters exactly; do not apply Go path.Clean or percent-decode `~`, letters,
   or other unreserved bytes. Preserve percent-triplet case for comparison.
   Reject malformed escapes and encoded slash/backslash before allowing a
   navigation. Query and fragment never select a rule. Fragments are removed
   from retained activity and navigation projection; query values remain only
   in the transient permitted navigation request, never in activity.
5. Path match is exact or a slash-delimited descendant; `/docs` never matches
   `/docstring`. Host wildcard matches the exact host or dot-delimited
   subdomains, never suffix lookalikes.
6. Among all matches, choose longest path prefix, then exact host-match over
   wildcard, then longest configured hostname, then lexically smallest rule_id.
   This preserves the server's current specificity ordering. Input array order
   does not choose permissions or consequences.
7. Every redirect destination must independently match. The rule authorizing
   the preceding hop must permit redirects. The final matched destination rule
   becomes the source rule for the next hop. Deny external schemes, popups,
   downloads, permission prompts, and external application launches unless a
   separately agreed capability admits them; this contract does not add those capabilities.
8. Canonicalization output is an identity-preserving representation for policy
   matching/activity. Do not replace the permitted request URL with an unrelated
   decoded/reinterpreted path. Subresources use the same closed origin boundary
   but never enter Browser Activity.

Publication and Desktop navigation use the same parser, validators, and digest
fixtures. A running Sitting changes policy only through immutable correction.

Required shared fixtures, with origin `https://example.com` unless specified:

| Case                                                                                         | Expected result                                                         |
| -------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Rules a_root `/` (redirect=true), z_private `/private` (redirect=false); URL `/private/page` | z_private wins regardless of input order; redirect from this hop denied |
| Rule `/~user`; URL `/%7euser`                                                                | No match; retained path stays `/%7euser`                                |
| Rule `/%7euser`; URL `/%7euser`                                                              | Match; no decoding to `/~user`                                          |
| Rule `/%7Euser`; URL `/%7euser`                                                              | No match; percent-triplet case remains explicit                         |
| Rule `/a/b`; URL `/a//b`                                                                     | No match; duplicate slash is not collapsed                              |
| Rule `/docs`; URL `/docs/chapter`                                                            | Match                                                                   |
| Rule `/docs`; URL `/docstring`                                                               | No match                                                                |
| Rule `/a/%2f/b` or `/a/%5C/b`                                                                | Reject authoring                                                        |
| Navigation `/a/%2f/b` or malformed `/%zz`                                                    | Block before contact; invalid_url and all-empty retained location       |
| Rule with `/a/../b` or encoded dot segment                                                   | Reject authoring; no hidden prefix rewrite                              |
| `https://bücher.example` or `https://xn--bcher-kva.example`                                  | Reject unsupported host                                                 |
| `https://example.com:443/`                                                                   | Canonical origin `https://example.com`                                  |
| `https://127.1` navigation                                                                   | Canonical host `127.0.0.1`; exact IPv4 rule can match                   |
| IPv4 exact_and_subdomains                                                                    | Reject authoring                                                        |
| HTTPS Institution example.com; explicit HTTP exception example.com                           | Allowed only with the exception flag                                    |
| HTTPS Institution example.com; HTTP other.example.com                                        | Reject exception                                                        |
| HTTPS source forbids redirects; target is another allowed rule                               | Block redirect; target allowlisting alone is insufficient               |

## Browser Activity wire mapping and server validation

Source UUIDv4, Participation generation, frozen policy, and sequence bind each
event under the source lifecycle below. The navigation record is:

```typescript
interface BrowserNavigationRecord {
  sequence: PositiveInt;
  kind: 'top_level_navigation' | 'top_level_redirect' | 'blocked_top_level_navigation';
  policy_revision_id: ID;
  client_occurred_at: Instant;
  location: { scheme: string; host: string; port?: string; path: string };
  matched_rule_id?: string;
  block_reason?:
    | 'scheme_not_allowed'
    | 'origin_not_allowed'
    | 'path_not_allowed'
    | 'redirect_not_allowed'
    | 'invalid_url';
  redirect_from_sequence?: PositiveInt;
}
```

Successful navigation/redirect requires a matched rule and no block_reason.
Redirect requires redirect_from_sequence identifying the prior successful hop
within the same source/policy; it must precede this record. Blocked redirect also
includes that selector. This lets the server verify source-rule redirect
permission rather than trust a client consequence. Validate such references in
contiguous order; a missing hop is a gap, not fabricated history.
For redirect_not_allowed, matched_rule_id identifies the rule of that prior
successful hop and must equal its validated stored rule. For another blocked
reason, omit matched_rule_id unless the destination actually selected a rule;
invalid_url and scheme_not_allowed always omit it. Successful redirects name
the destination rule. The prior-hop reference supplies source provenance
without duplicating arbitrary URLs or allowing a client to choose consequences.

Opened/closed lifecycle events retain their current strict shape with no location,
matched rule, or block reason. For invalid URLs retain the existing all-empty
location. For denied non-HTTP(S) schemes retain scheme only and empty host/path.
For HTTP(S) policy failures retain bounded canonical components under the current path
rules. User-info, fragments, query, headers, cookies, page content, forms,
screenshots, and subresources are never accepted. URI parse failures must not
leak raw strings into diagnostics. The Desktop transport must translate its
sentinel values (`invalid`, `/`) into these reason-specific wire shapes; the
server is not asked to weaken its privacy validator.

Preserve block reason and redirect source before protected spooling; do not
reconstruct them heuristically after restart.
The client does not send a trusted blocked consequence. The server computes it
from the frozen policy and matched/source rule. Unmatched/invalid/scheme-only
attempts default to record unless a separately agreed policy change adds a
specific consequence selector for them. A general staff permission or client
string never changes that outcome.

## Source lifecycle

Canonical UUIDv4 sources bind one immutable Browser Policy revision/digest and
one Participation generation. Panel open/close does not allocate a source; a
source may record multiple browser_opened/browser_closed events.

## Current DTOs

The models reference shared conventions and BrowserNavigationRecord above.
Every object is closed.

```typescript
type BrowserSourceID = string; // Existing canonical UUIDv4 validation.
type BrowserStartTransition =
  | { kind: 'initial' }
  | { kind: 'policy_correction'; predecessor_source_session_id: BrowserSourceID }
  | {
      kind: 'runtime_reset';
      predecessor_source_session_id: BrowserSourceID;
      reason: 'coordinator_restarted' | 'spool_unavailable' | 'source_corrupt';
    };
interface StartBrowserActivity {
  participation_id: ID;
  generation: PositiveInt;
  source_session_id: BrowserSourceID;
  policy_revision_id: ID;
  policy_digest: SHA256;
  transition: BrowserStartTransition;
}
interface BrowserLifecycleRecord {
  sequence: PositiveInt;
  kind: 'browser_opened' | 'browser_closed';
  policy_revision_id: ID;
  client_occurred_at: Instant;
}
type BrowserDeliveryRecord = BrowserNavigationRecord | BrowserLifecycleRecord;
interface AppendBrowserActivity {
  source_session_id: BrowserSourceID;
  participation_id: ID;
  generation: PositiveInt;
  policy_revision_id: ID;
  policy_digest: SHA256;
  events: BrowserDeliveryRecord[]; // 1..64, sorted unique sequence; <=256 KiB.
}
interface BrowserEventReceipt {
  sequence: PositiveInt;
  event_digest: SHA256;
  received_at: Instant;
}
interface BrowserDeliveryProgress {
  highest_contiguous_sequence: SafeInt;
  settled_through_sequence: SafeInt;
  highest_seen_sequence: SafeInt;
  allocated_through_sequence: SafeInt;
  terminal_missing_through_sequence: SafeInt;
  missing_ranges: SequenceRange[]; // Earliest 32 recoverable ranges.
  missing_ranges_truncated: boolean;
}
interface BrowserActivityAcknowledgement extends BrowserDeliveryProgress {
  source_session_id: BrowserSourceID;
  receipts: BrowserEventReceipt[]; // Exactly the submitted events, up to 64.
  server_time: Instant;
}
interface BrowserSourceStatus extends BrowserDeliveryProgress {
  source_session_id: BrowserSourceID;
  attempt_id: ID;
  participation_id: ID;
  generation: PositiveInt;
  policy_revision_id: ID;
  policy_digest: SHA256;
  predecessor_source_session_id: BrowserSourceID | null;
  start_transition: 'initial' | 'policy_correction' | 'runtime_reset';
  runtime_reset_reason: 'coordinator_restarted' | 'spool_unavailable' | 'source_corrupt' | null;
  started_at: Instant;
  closure: DeliveryClosure;
  declaration_revision: SafeInt;
  detail_mode: 'collecting' | 'summary_only';
  budget_scope: 'participation' | 'attempt' | null;
  summary_only_reason: DeliveryStopReason | null;
  remaining_correction_starts: SafeInt;
  remaining_runtime_reset_starts: SafeInt;
  summary: UnretainedDeliverySummary | null;
  server_time: Instant;
}
```

The source's server record additionally stores candidate User, registered-key
owner/registration, opening Session/Connection as provenance, and the exact
start command fingerprint. These are derived from the authenticated call, never
client-selectable fields. Status is for the owning privileged Desktop and
contains no raw history or credentials. Manager access remains through the
existing separately authorized Browser Activity view.

## Operation mapping

Paths are relative to the existing API root. Define S as
`/exam-attempts/{attempt_id}/browser-activity/sources` in this table only.
This is one application contract, even where HTTP and realtime both reach it.

Live HTTP mutations reuse the current candidate-access headers exactly:
`X-Proctor-Attempt-Credential` and `X-Proctor-Attempt-Connection-ID`, alongside
registered Session/DPoP authentication. Resolve the active Participation from
that exact connection and verify any repeated body generation/identity against
it. This applies to live native delivery, gaps, summaries, and stop-details too.
Historical operations use their retained source/registered-key owner instead;
they neither require nor accept an old connection as current authority.

| Operation                    | Transport and result                                                                                                                                                                                                                             |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Start/successor              | Realtime `exam_attempt.browser_activity.start` takes StartBrowserActivity plus the existing outer continuity proof; returns BrowserSourceStatus. This is the only source-creation transport.                                                     |
| Live append                  | Realtime `exam_attempt.browser_activity.append` takes AppendBrowserActivity plus existing outer connection proof; returns BrowserActivityAcknowledgement.                                                                                        |
| Historical append            | `POST S/{source_session_id}/events` uses AppendBrowserActivity and the same codec/domain append, for a closed source and historical key owner; returns BrowserActivityAcknowledgement.                                                           |
| Status / lost-start recovery | `GET S/{source_session_id}` returns BrowserSourceStatus. `GET S?participation_id=...` returns at most 49 statuses in start order for that owned Participation.                                                                                   |
| Final declaration            | `POST S/{source_session_id}/seal` takes FinalDeliveryDeclaration and returns BrowserSourceStatus for the already closed source.                                                                                                                  |
| Permanent gap                | `POST S/{source_session_id}/gaps` takes DeclareDeliveryGaps and returns DeliveryGapReceipt plus current BrowserSourceStatus.                                                                                                                     |
| Summary-only reporting       | `POST S/{source_session_id}/summary` takes UnretainedDeliverySummary and returns the stored summary and BrowserSourceStatus.                                                                                                                     |
| Ambiguous append receipt     | `GET S/{source_session_id}/receipts?cursor=...&limit=...` returns up to 64 BrowserEventReceipts in sequence order as `items` plus an opaque `next_cursor`, omitted on the last page. Return the cursor unchanged. Missing positions are omitted. |

Mutations use Idempotency-Key. Realtime source UUID plus exact canonical
start body is also a permanent semantic deduplication key within its retention
window; event source/sequence/digest is the append key across both transports.
A successful source-start retry returns the same source's current status, which
may now be closed; it never reopens it or spends a second start allowance.
Receipt/status requests for inaccessible scope use the existing non-disclosing
not-found behavior. Closed-source read/write authority ends with key revocation
or the applicable access/retirement rules; an upload deadline grants no manager
access and no candidate navigation.

Each BrowserSourceStatus is bounded at 16 KiB; the Participation list response
is bounded at 1 MiB. A receipt page has at most 64 entries and is bounded at
16 KiB. Pagination examines the bounded retained sequence ledger rather than
allocating an entry for each missing position.

## Closure, successor creation, and counters

At most one source per Participation has live navigation authority. Start is
atomic with checking current native rule status, browser policy, Sitting state,
Session/Connection/generation, source counters, and [live corrections](live-corrections.md)'s browser gate.

- Initial start is allowed once, only when no earlier source exists for the
  Participation. Reopening the browser uses the same source, not another initial.
- A policy correction closes the old source transactionally at its effective
  server time, fixes its deadline, and invalidates navigation. It does not wait
  for client acknowledgement, an old-source final declaration, or a successor.
- After the latest policy and required acknowledgements are available, a
  correction successor may start against the most recent predecessor. It must
  bind the current enabled policy and an actual new applicable revision. If
  several corrections occurred while gated, start only for the current policy;
  skipped revisions create no unused sources and consume no start allowance.
- A correction disabling the browser closes the source and permits no successor
  until a later enabled policy is effective and acknowledged. Re-enabling after
  that closure uses the correction budget. If browser was never started, the
  first enabled start still consumes the one initial allowance.
- A runtime reset replaces the current source under the same policy and valid
  current authority; it closes that predecessor and fixes its replay deadline
  in the same transaction that admits the successor. A valid refusal instead
  commits closure under the committed-reset-outcome rules below. Predecessor must be the
  latest source, so reset cannot fork history or resurrect a previous source.
- Pause retains source identity and denies navigation without closing its live
  generation; records already queued may upload. Resume reuses the source if
  no correction/reset intervened. Browser UI close alone also retains identity.
- Participation termination, suspension, submission, manager end, and Sitting
  closure end source authority immediately and apply [protected delivery](protected-delivery.md). A later authorized
  Participation receives its own initial-source allowance and exact generation.

The source maximum is 49: one initial, up to 32 correction starts,
and up to 16 runtime-reset starts. The two successor counters are independent,
validated from current policy/predecessor state, and increment only on a new
successful start. They are not a claim that 32 corrections will occur in each
Participation. Replays consume no counter. Retired/deleted history does not
replenish them. A runtime reset cannot masquerade as a correction.

At reset-budget exhaustion, return `exam.browser.source_budget_exhausted` (409),
keep browser navigation unavailable, and expose the bounded reason. Workspace,
submission, native monitoring, and lease renewal keep their independently valid
states; do not create a misconduct Flag or automatically reallow/rejoin to reset
counters. The candidate can safely depart or request an ordinary manager action.
A real later correction may use its own remaining counter. A pending correction
never leaves the superseded source navigable as a workaround.

Summary-only delivery retains the source for enforcement and its bounded
operational summary; it does not create a fresh source to reset quotas. New
source status inherits the applicable Participation/Attempt summary-only latch.

## Final browser records and submission settlement

A server-initiated close may leave an unknown local tail. Apply [protected delivery](protected-delivery.md)'s final
boundary and 24-hour deadline to each source independently. A terminal
browser_closed lifecycle record produced while handling that close may belong
to the declared tail; it grants no permission for another navigation. Late
source records always use their own frozen policy, including redirect provenance.
A missing prior hop is unresolved; it cannot be guessed from the current page.

Submission summarizes every source through this server-owned settlement object:

```typescript
interface BrowserSubmissionSettlement {
  state: 'not_applicable' | 'settled' | 'pending' | 'incomplete';
  inventory_revision: PositiveInt;
  source_count: SafeInt;
  pending_source_count: SafeInt;
  incomplete_source_count: SafeInt;
}
```

The server owns this response/snapshot. The submit request does not choose its
counts, completeness, or policy. Preserve expected Workspace/current-revision
fences and existing Focus Loss finalization separately. Submission closes all
live browser sources in its transaction and then derives this inventory without
waiting indefinitely for declarations. `not_applicable` requires no browser
source/history for the Attempt, not merely a disabled final policy. Pending means
any source remains settleable; otherwise incomplete means any terminal loss or
unknown tail; settled requires all sources complete. Counts cover previous
Participations as well. Late eligible delivery updates review settlement and
inventory_revision without changing Submission content. Fixed omission summaries
from [delivery budgets](protected-delivery.md#workload-assumptions-and-admission-limits) remain part of incomplete settlement even if every earlier accepted
record was uploaded.

Tests: start/append lost response, exact cross-transport replay, every closure
reason, all 32 correction successors, 16 runtime resets, mixed/skipped/disabled
corrections, budget exhaustion, old-policy late records, finalized and unknown
tails, missing redirect hop, and Submission with gaps in an earlier source.

## Committed browser reset outcomes

After validating the authenticated current owner, generation, latest predecessor,
policy, reset reason, and applicable gates, a valid runtime-reset request has one
of two committed outcomes:

| Condition                                                                                                                                                  | Durable outcome                                                                                                                                                                                                                                      |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Successor allowance and metadata reservation are available                                                                                                 | Close the predecessor and create its successor in the same transaction.                                                                                                                                                                              |
| The runtime-reset allowance is exhausted, or [metadata reservations](protected-delivery.md#metadata-reservation-and-accounting) cannot reserve a successor | Close the predecessor with `runtime_reset`, freeze its historical boundary/deadline, leave no source with live navigation authority, and retain the bounded refusal outcome. Create no successor and spend no additional successful-start allowance. |

Return `exam.browser.source_budget_exhausted` for allowance exhaustion, with the
existing 409 equivalent. Return [metadata reservations](protected-delivery.md#metadata-reservation-and-accounting)'s metadata-capacity code for that distinct
failure. Both outcomes include the closed predecessor's `BrowserSourceStatus`
and current candidate capability projection. Browser is unavailable; independently
valid Workspace, submission, monitoring, and renewal remain usable.

The Store commits a typed domain outcome, then the application/transport maps it
to the public refusal. Returning an error from inside the transaction must not
undo the closure. Preserve the declared realtime error envelope; this does not
add an HTTP source-creation route.

Store the refusal fingerprint in bounded reserved predecessor/control state.
The same source-start identity and canonical command replay returns that outcome
with current projections after reauthorization. It does not reopen the predecessor,
move its deadline, or consume another allowance. A different source UUID cannot
revive a closed predecessor. Status/list recovery also reveals that closure if
the refusal response was lost.

Invalid credentials, a foreign or obsolete predecessor, conflicting retry bytes,
or an otherwise invalid start do not gain permission to close any source.
Ordinary panel close remains unchanged and does not allocate a successor.
A later real policy correction can create the allowed correction successor if
its separate allowance and metadata reservation are available.

Shared acceptance cases: successful 16th reset then refused 17th; lost refusal
response and restart; exact retry and conflicting retry; stale/foreign predecessor;
concurrent correction; metadata refusal; and later correction recovery. Assert
server capability state and stored predecessor closure, not only Desktop UI state.

## Browser Flag grouping and finite overflow

A validated blocked event whose frozen rule selects integrity_evidence contributes
minimized evidence containing source UUID, sequence, policy revision/digest, rule,
bounded location, block reason and server receive time. Evidence owns that minimum
provenance so ordinary history can retire independently. Copy no surrounding
history or query values. Record-only outcomes and successful allowed navigation
create neither evidence nor a Flag. A grouped Flag is for review and creates no
automatic warning, suspension or guilt finding.

Use the group key `(Attempt, Participation, Browser Policy revision, rule_id)`.
The first 100 qualifying accepted events per group are eligible for detailed
copies, subject to the additional 10,000-record/8-MiB Attempt evidence cap.
Keep the first retained details immutable; do not silently rotate evidence that
may already have been reviewed. Each further validated qualifying event updates
that group's exact overflow count and first/last server receive times once.
No extra location or payload is copied. Acceptance order is durable server
processing order, not client clock order.

At 256 groups, retain one bounded Attempt-level browser evidence overflow
summary: count of additional validated qualifying events not assigned a new
Flag, first/last receive times, and reason=group_capacity. It is not another
misconduct Flag, and it does not claim the number of distinct omitted groups.
No unbounded map of uncreated group keys is needed. Ordinary activity, while
within its separate quota, still records the original events.

All exact counts above come from newly accepted, policy-validated events and
share their durable source/sequence deduplication. Once ordinary browser detail
collection stops, subsequent unretained counts are only the client-reported
operational summaries in [bounded delivery summaries](protected-delivery.md#bounded-summaries-after-detail-collection-stops); do not add them to validated evidence counts or
invent rule attribution. If a redirect's prior hop was lost, retain its bounded
record as unresolved where quota permits; do not manufacture a verified Flag
from an unverified consequence. Fixed overflow summaries remain visible in review.

Every newly accepted evidence/overflow change invalidates the affected review
inventory, waiver, and Sitting records completion according to existing rules.
No new event inherits an earlier disposition. Group/evidence retirement remains
independent of ordinary Browser Activity retirement. Neither receipt recovery
nor late replay can resurrect retired material or increment a counter twice.

## Exact manager membership plus the dedicated action

Every detailed Browser Activity read requires both:

1. Current, exact Exam Manager membership for the Exam owning the Sitting.
2. Current authorization for `ActionExamAttemptBrowserActivityView` in the
   applicable Institution/academic scope.

Check both on every list, detail, pagination, source/gap inspection, download,
and export operation. A broad teacher/staff/administrator Role alone satisfies
neither exact membership nor this dedicated action. Deny when membership is
removed between pages. Keep existing strong-assurance and access-audit rules.
Use the established non-disclosing not-found/denied behavior for foreign scope.

Remove `ActionExamAttemptBrowserActivityViewOverride` as a live authorization
alternative for Browser Activity. Remove the obsolete action from current
permission catalogs, authoring, defaults, and development fixtures. Do not turn
existing override holders into Exam Manager members. An administrator who
actually is an Exam Manager can qualify through the same two checks.

A native-integrity reviewer or holder of a generic integrity/export action does
not thereby gain surrounding browser history. A browser-navigation evidence
record from [browser evidence](browser.md#browser-flag-grouping-and-finite-overflow) may be reviewed under the separately authorized integrity
evidence action because it owns only the minimized fields needed for that
finding. Following its source reference into ordinary history repeats the
exact-manager and Browser Activity action check.

## Independent retention policy and storage category

Extend the existing RetentionPolicySettings replacement/read/audit DTOs with:

```typescript
interface AdditionalRetentionSettings {
  browser_activity_retention_days: SafeInt;
  security_operational_retention_days: SafeInt;
}
```

Both fields have a maximum of 36,500 days (RetentionPolicyMaxDays).
Zero has the existing meaning of no configured automatic expiry. The native
operational field implements [native retention](protected-delivery.md#native-retention); Browser Activity uses its own new
`browser_activity` retirement category. Keep current optimistic policy revision,
change approval, automatic-deletion enablement, candidate-notice configuration,
deletion grace, and legal/administrative hold behavior. These additions cannot
silently re-enable automatic deletion after a policy replacement.

The current policy model and development seeds initialize both fields to zero.
Automatic removal requires the existing explicit policy approval/enablement.
Replace previous storage/DTO shapes through the normal development schema
workflow; do not keep a reader that interprets a missing field as the integrity
period. Surface unset periods explicitly in management and candidate disclosure.
Never shorten a retained hold by introducing a new category.

Remove Browser Activity event/source deletion from the `integrity` branch in
`server/store/sqlstore/retention_retirement_store.go`. Its new branch owns ordinary
navigation events, source records, upload/gap bookkeeping, and activity-only
exports. Browser integrity evidence retains its own bounded policy/source
provenance under integrity retention; a foreign key must not require retaining
the entire ordinary source/history forever. Likewise, integrity retirement must
not delete ordinary activity before its independently configured period.
The current work-retirement path also clears browser settlement fields and
closes ingestion. Change those updates to respect the independent activity
category, and retain the minimal Attempt/Submission identity and settlement
stub while another category still needs it. Whole-work deletion or an object
cascade must not bypass either independent retention or the upload deadline.

Use the server's existing eligible closed-Sitting/records-completion anchor,
applied independently per category. Do not start retention while an active
Attempt still needs a source or protected-spool reconciliation. A valid late
upload must invalidate/recompute the affected category's completion inventory
before a retirement job can claim completion. Preserve existing whole-scope
holds across the new categories; extend category-selective holds explicitly if
that feature exists. A retirement job must recheck revision, hold, grace,
completion, and scope conditions in its transaction.

Apply the same category boundary to previews, retirement approvals, jobs,
exports, orphan cleanup, and read-side retired/unavailable states. Report record
counts without putting URLs or native facts in retention audit logs. Private
browser URLs must never appear in generic exam exports by default; an explicit
Browser Activity export requires the same dedicated access and retention rules.

## Candidate disclosure projection

Before candidate admission enables the browser, include this bounded descriptor
in privileged Sitting/preflight detail and project its display fields:

```typescript
interface BrowserActivityDisclosure {
  notice_id: 'integrated_browser_activity';
  audience: 'exam_managers_with_browser_activity_permission';
  retention_policy_revision: PositiveInt;
  browser_activity_retention_days: SafeInt;
  retention_anchor: 'eligible_closed_sitting_records_completion';
  may_create_integrity_evidence: boolean;
}
```

The closed notice ID resolves to localized Desktop text explaining collection
of top-level navigation outcomes, canonical host/path without queries/fragments,
policy/source ordering and gaps, and the excluded page/content/media data. Zero
days must display that no automatic expiry is configured, not “retained for zero
days.” Explain applicable holds and that minimized integrity evidence may have
a different retention period. `may_create_integrity_evidence` is server-derived
from the delivered policy. This descriptor grants no history-read capability.

Include `browser_activity_disclosure: BrowserActivityDisclosure` on
SecurityPolicyResponse and the ordinary current candidate Browser Policy
response. First join and policy/retention changes must refresh the displayed
notice from authorized server data; a material notice change is surfaced before
new affected interaction. Disclosure receipt is separate from consent and from
[live corrections](live-corrections.md) acknowledgement. Do not invent an acknowledgement-based data collection
consent mechanism.

Acceptance tests cover manager+action, manager without action, action without
membership, override only, membership revocation during pagination/export,
independent shorter/longer browser and integrity periods, unset periods,
holds/grace, late upload, source references after history retirement, and absence
of queries/content from every read/export/log path.
