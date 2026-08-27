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

## Browser Activity

Collect only these Attempt-scoped event kinds:

- browser opened;
- browser closed;
- successful top-level navigation;
- top-level redirect;
- blocked top-level navigation attempt.

Each record carries browser source-session ID, monotonic sequence,
Participation generation, event kind, normalized scheme/host/port/path, matched
rule ID, client occurrence time, and server receive time after ingestion. Query
values are removed by default; a future policy may retain only explicitly safe
parameter names. User-info and fragments are always removed. A digest of the
complete normalized URL may be used for bounded correlation without exposing
it.

Do not collect subresource requests, DOM/page content, screenshots, cookies,
headers, form values, credentials, or general system-browser history. An
allowed navigation is ordinary Browser Activity, not Integrity Evidence. A
blocked attempt becomes Evidence/Flag input only when the frozen policy selects
that consequence.

## Ordered protected delivery

One source session returns its instance ID and begins at a known sequence.
Delivery is at-least-once and idempotent by source instance/sequence. The server
acknowledges the highest contiguous sequence and reports gaps. Desktop retains
unacknowledged records in a bounded encrypted spool distinct from Workspace
Recovery and the general integrity spool.

Reconnect resends from the authoritative acknowledgement. Submission and
automatic sealing report final browser source/sequence/gap facts but cannot
wait indefinitely for a missing client record. Corruption, overflow, lost key,
or terminal gap becomes an explicit minimized discrepancy, never invented
activity.

Exact Attempt managers with the dedicated current action may inspect activity.
General User search, Class membership, or broad staff visibility is
insufficient. Every read is audited without copying URLs into ordinary audit or
logs. Candidate disclosure and Institution-configured Browser Activity
retention are separate from Integrity Evidence retention.

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
