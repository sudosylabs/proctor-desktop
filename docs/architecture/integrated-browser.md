# Integrated browser architecture

## Scope and authority

The integrated browser is a first-release Candidate capability for exam-
permitted web access over the candidate's own network. It is not the system
browser used for Desktop Authorization and is not a general-purpose browser.

The Proctor Server owns the revision-frozen Browser Policy, explicit live
corrections, Attempt/Participation authorization, Browser Activity acceptance,
manager access, acknowledgement, and retention. Privileged Desktop modules own
navigation enforcement, browser lifecycle, minimized collection, and protected
delivery. The sandboxed Candidate renderer owns presentation and closed
navigation intents only.

## Browser Policy

The [browser contract](../contracts/browser.md) owns exact wire models,
canonicalization fixtures, source operations, evidence grouping and retention.

One typed policy is authored by an authorized Exam Manager with the Exam, frozen
in the Exam Revision, and returned through the candidate presentation. Each rule
contains a stable ID and uses a closed grammar:

- exact HTTPS origin;
- optional normalized path prefix;
- optional explicit subdomain wildcard with unambiguous label matching;
- redirect permission;
- explicit blocked-navigation consequence;
- a narrowly authorized Institution-controlled HTTP exception, if supported.

Canonicalization is identical in authoring validation and Desktop enforcement.
It normalizes scheme/host/port/path while rejecting user-info, fragments as
selectors, arbitrary regular expressions, `file:`, `javascript:`, `data:`,
custom schemes, external-application launches, and unlisted downloads.

Draft edits never affect an open Sitting. Only an immutable live correction may
advance Browser Policy; CandidateWindow presents a persistent summary and
requires acknowledgement only when the correction declares it.
Applying a correction closes the prior source's navigation authority immediately.
A successor waits for the current policy and applicable acknowledgements, while
old-source records may deliver under their frozen policy and closure deadline.
Closure does not wait for flushing or a client final declaration.

Matching uses longest path prefix, exact host before wildcard, longest configured
hostname, then rule ID. Preserve repeated path slashes, percent-encoded unreserved
bytes and percent-triplet case. Redirect destinations must match independently,
and the preceding hop's rule must allow the redirect. The contract fixes the
admitted HTTP exception and rejects unsupported host/path forms.

## Privileged enforcement

The browser contribution opens only when the candidate presentation enables it,
the current Attempt is active, the Sitting is not paused, Secure Exam Posture
permits it, and the policy revision is loaded. A `WorkbenchItem` carries safe
identity/presentation; a privileged browser coordinator owns the actual
navigation session and exact policy checks.

Candidate preload exposes closed operations such as open a rule-approved start
location, request a navigation, go back/forward where valid, reload, and close.
It exposes no generic Electron session, request interception, cookies, headers,
download manager, arbitrary URL opener, or external application launch.

Every top-level navigation and redirect is checked before commitment where the
engine permits. Redirect chains are checked hop by hop. Renderer navigation,
window creation, popups, permission prompts, protocol handlers, downloads, and
external opens default to denied unless the closed policy explicitly supports
the exact behavior. Subresource enforcement uses the minimum request controls
needed to keep prohibited origins from being contacted, but subresources are
not recorded as Browser Activity.

Pause, suspension, stale Participation generation, policy loss, or privileged
coordinator failure immediately closes navigation/input gates. Pause preserves
the item beneath the CandidateWindow overlay without producing activity from
blocked UI. Suspension seals the browser source session before CandidateWindow
is destroyed.

The renderer projection reports lifecycle capabilities independently:
`canOpen` is true only for an idle, ungated coordinator; `canClose` remains true
while an underlying native owner is opening or open, including when policy has
changed the visible state to `blocked`. A pane assigned while blocked opens
automatically when a later projection permits `canOpen`, and pane cleanup uses
`canClose` so a blocked native owner cannot be orphaned. Navigation capabilities
remain false whenever the visible state is non-interactive.

## Browser Activity

Collect only these Attempt-scoped event kinds:

- browser opened;
- browser closed;
- successful top-level navigation;
- top-level redirect;
- blocked top-level navigation attempt.

Each record carries browser source-session ID, monotonic sequence,
Participation generation, event kind, normalized scheme/host/port/path, matched
rule ID, client occurrence time, and server receive time after ingestion. Query and fragments are absent from retained activity. User-info is never
retained. No full-URL digest is sent. Block reason and prior redirect-hop sequence
must survive protected spooling. Invalid URLs and denied schemes use the exact
minimized reason-specific wire shapes.

Do not collect subresource requests, DOM/page content, screenshots, cookies,
headers, form values, credentials, or general system-browser history. An
allowed navigation is ordinary Browser Activity, not Integrity Evidence. A
blocked attempt creates evidence only when its validated frozen rule selects
integrity_evidence. Flags group by Attempt, Participation, Browser Policy revision
and rule; detail and overflow follow the finite contract budgets. Every new
qualifying evidence/overflow change invalidates the review inventory. Missing
redirect provenance remains unresolved and cannot manufacture a verified Flag.

## Ordered protected delivery

One canonical UUIDv4 source binds one policy and Participation. Panel open/close
retains that source. Initial, correction and runtime-reset starts have separate
validated allowances. A valid runtime reset whose successor is refused still
commits predecessor closure and browser unavailability; it cannot roll back that
closure or reopen the unusable source. Metadata is reserved before new owners.

The [protected-delivery contract](../contracts/protected-delivery.md) owns receipt,
settlement, replay, quota and spool rules. Exact per-event receipts authorize
atomic local payload cleanup even behind a gap. Active and closed sources advance
receive windows across terminal gaps without acknowledging missing bytes.
Authoritative closure starts the historical deadline; a one-time bounded final
declaration is separate. Same-User/key historical delivery grants no navigation.

Summary-only mode retains enforcement and explicit incomplete provenance. New
source creation cannot refill Attempt quotas. Submission settles every source
across Participations and does not wait indefinitely for an absent client.

Exact Attempt managers with the dedicated current action may inspect activity.
General User search, Class membership, or broad staff visibility is
insufficient. Every read is audited without copying URLs into ordinary audit or
logs. Candidate disclosure and Institution-configured Browser Activity
retention are separate from Integrity Evidence retention. Generic override
permission does not bypass exact manager membership plus the dedicated action.
Ordinary history and minimized integrity evidence retire independently; holds,
late delivery and category completion are rechecked transactionally.

## Module and process seams

Keep policy types, canonicalization, normalized activity DTOs, sequencing, and
the renderer projection in environment-neutral modules. Keep Electron session,
navigation/request interception, protected spool, authenticated delivery, and
window/webContents handles in privileged environments. The workbench
contribution owns only item/pane presentation and intents.

Use the same language-neutral policy/activity schemas in Desktop validators and
server agreement fixtures. Remote policy selects values in a closed schema; it
never supplies JavaScript, a regex engine program, a preload, or a module path.

## Verification

Verify:

- origin/path/wildcard canonicalization, IDN/port/path edge cases, and exact
  parity with server fixtures;
- redirect chains, popup/window-open, schemes, external apps, permissions,
  downloads, and subresource containment;
- no navigation before policy/admission and immediate gating on pause,
  suspension, stale generation, policy change, or coordinator failure;
- source startup/order, duplicates, gaps, offline resend, acknowledgement,
  overflow/corruption, final sealing facts, and cross-Attempt isolation;
- stripping of user-info, fragments, query values, headers, content, cookies,
  and credentials from activity/diagnostics;
- exact manager authorization, audit redaction, disclosure, and retention;
- keyboard/focus/zoom/high-contrast/reduced-motion behavior in CandidateWindow.

Implementation, candidate presentation, policy schemas, spool, server
agreement, packaged Electron tests, and this architecture must assert the same
closed navigation and privacy behavior.
