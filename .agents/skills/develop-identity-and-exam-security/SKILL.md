---
name: develop-identity-and-exam-security
description: Design, implement, or review Proctor Desktop server readiness, system-browser authentication, registered installation/DPoP custody, Sessions, self-context, Attempt admission/state, active Session lock, CandidateWindow security gates, Secure Exam Posture, containment, connectivity, pause/suspension/re-entry, or integrity delivery. Use before changing identity, authenticated transport, secure participation, or security-sensitive IPC.
---

# Develop identity and exam security

Keep server authority, privileged Desktop enforcement, and renderer presentation
separate through every transition.

## 1. Load authority

Read [identity and exam-security architecture](../../../docs/architecture/identity-and-exam-security.md),
[workbench architecture](../../../docs/architecture/workbench.md),
[product model](../../../docs/product/model.md), and
[invariants](../../../docs/architecture/invariants.md).

Use [`source-code-organization`](../source-code-organization/SKILL.md) for
placement, [`develop-workbench`](../develop-workbench/SKILL.md) for window UI,
[`develop-user-settings`](../develop-user-settings/SKILL.md) for Attempt
Configuration, [`develop-attempt-workspace`](../develop-attempt-workspace/SKILL.md)
for protection/reconciliation, and [`develop-native-capabilities`](../develop-native-capabilities/SKILL.md)
for sources/effects. Load the browser skill when its gates change. The
step is complete when caller, process, authority, scope, sensitive fields, and
failure outcome are explicit.

For wire models, preflight, policy lifetime, control ordering, quotas or
correction gates, load the matching [server contract](../../../docs/contracts/README.md).
Use that accepted contract when existing adapters or fixtures still differ.

## 2. Choose the privileged owner

Put readiness/auth/key/credential/Session lifecycle in the privileged
`DesktopIdentityCoordinator`. Put Attempt-scoped policy, posture, containment,
continuity, activity/integrity delivery, and Workspace orchestration in the
privileged `ExamSecurityCoordinator`. Keep Electron-main-only window effects,
OS storage, system browser, loopback listener, permission prompts, and native
effects behind focused adapters. Renderers receive immutable projections and
closed intents.

The step is complete when no interface becomes a credential broker, arbitrary
fetcher, generic IPC/native host, or renderer-owned authorization path.

## 3. Implement readiness and method-agnostic auth

Normalize and pin one submitted server origin. Use public system ping for
availability/retry and the server's build/realtime compatibility decision; use
public discovery for Institution/origin identity and Desktop Authorization
availability/protocol compatibility. Follow the split contract in the
architecture, not an expanded ping or a locally recomputed build catalog.
Bound requests and responses, reject redirects and origin mismatches, cancel and
fence stale checks on server change, and expose only sanitized presentation.
After submission, project that state and `Change server`; enable sign-in only
when both checks pass and the privileged authorization owner is available.

For Desktop Authorization generate state, PKCE S256, exact random loopback,
Institution-specific installation public key/thumbprint, and release target.
Open only the server-returned same-origin URL. The server-hosted page owns all
method/provider/account choice and final approval. Validate exact callback and
exchange one-use code without putting credentials in URLs/renderers.

The step is complete when cancel, timeout, callback failure, replay, mix-up,
maintenance, incompatibility, and active-lock Session denial each have one safe
terminal result.

## 4. Bind registered Desktop credentials

Keep one per-Institution private key in approved OS-backed custody. Enroll its
public key only after interactive authorization. Sender-constrain access,
refresh, protected HTTP, logout, and realtime with DPoP-compatible proof. Bind
method/URI, issued-at, unique proof ID, access-token hash, key thumbprint, and
nonce where required. Preserve refresh-family replay protection and account-
visible installation revocation.

Call the assurance `registered_desktop_key`; a stronger official-binary claim
requires separately accepted platform attestation. The step is complete when
cross-User/Institution/key/token replay and all redaction paths are covered.

## 5. Preserve self-context and authority

Keep disabled account, no current affiliation, no assigned access, product
areas, manageable Academic Units, unresolved Attempt, and account/session
management as separate self-context facts. Institutional affiliations are
non-exclusive, including simultaneous student and teacher affiliations. Present
every server-authorized product area while keeping relationship and operation
authorization separate. Never map Role names directly to UI or treat
navigation/realtime projections as grants.

Refresh is single-flight. Ambiguous rotation verifies rather than retries.
Changing Institution/User/Session destroys bound windows and locks protected
data. Sign-out revokes local capabilities before remote cleanup and never
submits/deletes work. The step is complete when stale projection, callback,
credential, event, or cleanup result cannot authorize.

## 6. Enforce Attempt states and Session lock

Model authoritative `ready`, `active`, `suspended`, and `submitted`. Reallow
produces ready; only successful secure join produces active. Ready has no local
timeout and may join whenever the Sitting is joinable. Enforce the candidate-
wide unresolved-Attempt result before opening CandidateWindow.

Only active has one bound Desktop Session and Participation generation. Entering
active revokes other Sessions and blocks new issuance; ready/suspended/submitted
allow sign-in. Bound-Session invalidation suspends. Transport reconnect inside
the lease may preserve active/generation; confirmed expiry suspends without
inventing Session invalidity.

The step is complete when join/session races, competing Sittings, revoke,
refresh, pause, lease expiry, ready join, close, and manager end have precise
non-authorizing outcomes.

## 7. Contain before presentation

Validate the canonical effective policy, packaged capability/schema requirements,
bounded configuration, admission scope and digest. Initial exception references
are empty; preserve the contract's resolver exclusions. Use current Participation
lease/Sitting authority, with no independent policy timeout. Reject unknown, conflicting, prohibited,
oversized, or unsupported requirements before permission/source startup. Keep
server policy resolution out of Desktop and bind preflight/evidence to the
verified digest and signed capability matrix.

Evaluate authenticated policy and admitted native sources into local
`uninitialized`, `checking`, `compliant`, `degraded`, `contained`, `failed`, or
`stopped` posture. Keep it distinct from Attempt ready. Execute containment:
deny dispatch, cancel proven-undispatched work, protect accepted/unknown work,
apply effects, commit state, publish presentation, then queue permitted
delivery.

A high-confidence event may provisionally enter checking and close mutation
gates, but creates no occurrence until deterministic evaluation confirms it.
Observe conditions never contain. Contained CandidateWindow blocks editor,
browser, resource, and submission mutations behind one safe correction
overlay while sources continue verifying recovery.

Pause keeps CandidateWindow/Participation/lock while gating Workspace, browser,
and submission. Suspension gates and protects first, shows overlay,
destroys CandidateWindow, then opens AuthenticatedWindow. Relaunch never restores
CandidateWindow; ready rejoin repeats full admission and creates a new
generation. The step is complete when event-before-refetch, renderer crash,
process loss, Force Quit, and stale generation are testable.

## 8. Preserve integrity meaning and privacy

Keep `Native Observation` → `Security Signal` → `Detector Finding` →
`Integrity Evidence` → `Integrity Flag` → `Review Outcome` → `Consequence`
distinct. Preserve versions, uncertainty, gaps, source sequences, and delivery
watermarks. Keep Browser Activity and Workspace Recovery in separate protected
spools. Project only authorized minimized state and keep content/evidence/
credentials out of ordinary audit, diagnostics, renderer state, and logs.

Let main canonicalize and authenticate minimized batches with the registered
installation credential; helpers and the utility never receive it. Separate
content receipts from settlement and final declarations from server closure.
Honor Attempt-wide detail/metadata budgets and reserved lifecycle capacity. Bind batch
sequence, prior acknowledgement, idempotency key, policy digest, release,
matrix, and source generations. Send one aggregate coverage heartbeat rather
than recurring normal observations. Separate safe live manager state from
authorized detailed review and use server-defined retention. Process successful
and faulted controls through one durable ordering boundary. Reset edges reach
live coverage independently of delayed evidence; stale responses never undo
containment. Lease renewal remains available while interaction gates are closed.

The step is complete when every collected field has a purpose, classification,
scope, delivery/access/retention rule, and failure behavior without becoming a
guilt or grading conclusion.

## 9. Verify

Use real coordinators behind in-memory ports, then Electron/private-protocol
tests. Cover ping/discovery/auth/DPoP, Session rotation/revocation, self-context, Attempt
and lock transitions, containment order, window handoff, correction,
Workspace/activity reconciliation, source gaps, spool failures, and sensitive-
data absence.

The work is complete when implementation, adapters, process composition,
projections, diagnostics, tests, and architecture express the same authority
and failure semantics.
