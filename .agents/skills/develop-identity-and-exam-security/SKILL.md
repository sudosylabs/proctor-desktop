---
name: develop-identity-and-exam-security
description: Design, implement, or review Proctor Desktop authentication, credential custody, Session Binding, composition or Attempt admission, operation authorization, Secure Exam Posture, security policy, containment, connectivity gating, participation continuity, re-entry, integrity information, or identity/security renderer projections. Use before changing login, sign-out, reauthentication, authenticated networking, candidate security gates, role-window binding, security-sensitive IPC, or integrity delivery.
---

# Develop Identity and Exam Security

Keep credential and exam-security authority behind privileged deep modules while
renderers consume bounded projections and closed intents.

## 1. Load authority

Read the
[identity and exam-security architecture](../../../docs/architecture/identity-and-exam-security.md),
[product model](../../../docs/product/model.md), and
[architecture invariants](../../../docs/architecture/invariants.md). Use
[`source-code-organization`](../source-code-organization/SKILL.md) before placing
source and [`develop-workbench`](../develop-workbench/SKILL.md) for launch,
candidate-gate, status, close, or role-window presentation.

Use [`develop-attempt-workspace`](../develop-attempt-workspace/SKILL.md) when
blocking, recovery, re-entry, or containment affects accepted work, in-flight
mutations, protected recovery, or reconciliation. For VS Code-derived behavior,
also use [`adapt-vscode`](../adapt-vscode/SKILL.md).

Use
[`develop-native-capabilities`](../develop-native-capabilities/SKILL.md) before
changing OS observations, native source sessions, permissions,
candidate-window effects, security-utility supervision, private native IPC, or
platform verification. Keep server roles, routes, lifecycle, re-entry
authorization, evidence retention, review, and consequences behind bounded
server projections.

Use [`develop-user-settings`](../develop-user-settings/SKILL.md) for
SettingsWindow Session binding, Candidate Settings Baseline fencing, settings
constraints, and candidate renderer projection.

The step is complete when the caller, process, authority, sensitive data, and
every unresolved native or server dependency are explicit.

## 2. Choose the owning module

Put authentication transactions, credential lifecycle, Electron network-session
custody, Principal projection, and Session Binding in the privileged
`DesktopIdentityCoordinator`.

Put policy evaluation, posture, passive-source coordination, closed-effect
orchestration, containment, connectivity gating, participation continuity,
re-entry orchestration, and integrity delivery in one attempt-scoped privileged
`ExamSecurityCoordinator`.

Keep composition and concrete adapter selection in Electron process roots. Put
renderer presentation in a candidate or launch contribution. Keep transport,
native, protected-storage, and detector mechanics behind private ports rather
than exposing them as caller concepts.

The step is complete when deleting either coordinator would force its lifecycle
and ordering rules into multiple callers, while each caller crosses one small
interface.

## 3. Preserve the external seams

Expose from identity only:

1. an immutable sanitized `IdentityProjection` and change notification;
2. one closed family of identity intents;
3. privileged acquisition of a trusted Session Binding after current
   Composition Admission.

Expose from exam security only:

1. an immutable `CandidateSecurityProjection` and change notification;
2. one closed family of permitted recovery, re-entry, retry, or support intents.

Keep credentials, cookies, arbitrary network access, generic secrets, raw native
streams, detector thresholds, policy internals, evidence, authorization objects,
and privileged handles out of renderer and environment-neutral interfaces.
Preload offers capability-specific IPC and validates scope, revision, intent,
and payload bounds in the owning process.

The step is complete when callers cannot bypass the coordinator, reconstruct
authority from projection state, or perform a generic privileged operation.

## 4. Preserve identity and admission semantics

Keep Authentication, Composition Admission, Attempt Admission, and Operation
Authorization independent. Treat admission as short-lived routing state and
reauthorize each sensitive Action against its actual Resource.

Keep authentication, Session validity, credential readiness, Principal
Snapshot, and network availability as independent facts. Bind a role window
immutably to User, server Session, composition, and scope. Permit MFA,
reauthentication, and credential rotation to update the Principal Snapshot
inside that binding; destroy role windows when User or Session changes.

Make refresh single-flight. Preserve ambiguous rotation as
`verificationRequired`. Distinguish local lock, confirmed revocation, and
unknown revocation outcome. Make sign-out revoke local capabilities and lock
Principal-bound data before reporting the exact server outcome.

Bind every auth callback to one expiring, single-use transaction and its exact
expected provider and URI state. Treat unavailable OS-backed credential storage
as explicit unavailability.

The step is complete when no stale projection, callback, credential, realtime
event, role window, or local cleanup result can grant authority.

## 5. Enforce posture, containment, and continuity

Evaluate authenticated, scoped, fresh, rollback-resistant Exam Security Policy
into `notApplicable`, `checking`, `ready`, `restricted`, or `blocked`. Apply
accommodations before detection. Select only packaged controls and detectors.

Execute containment in order: deny dispatch, cancel proven-undispatched work,
protect accepted and unknown work, apply controls, commit posture/capabilities,
publish presentation, then queue permitted reporting. A failed required step
resolves to blocked.

Require continuous authenticated server connectivity for candidate interaction.
On loss, block new interaction and preserve exact outstanding outcomes. Restore
through authentication, integrity reconciliation, authoritative Attempt state,
fresh admission and policy, monitor/control health, workspace reconciliation,
and current authorization before reopening interaction.

Maintain one fenced Attempt Participation generation. Veto ordinary close while
active. Treat full privileged-process or required-monitor loss as Participation
Interruption; a renderer-only restart may recover only while trusted continuity
remains healthy. Relaunch stays gated until the server projects approved
re-entry and a new generation fences the old process.

The step is complete when disconnect, restart, close, renderer crash, process
kill, stale generation, and delayed operation each have one non-authorizing,
testable outcome.

## 6. Preserve integrity meaning and privacy

Keep `Native Observation` → `Security Signal` → `Detector Finding` →
`Integrity Evidence` → `Integrity Flag` → `Review Outcome` → `Consequence`
distinct. Preserve provenance, versions, uncertainty, and gaps. A local result
may drive reversible containment but never declares guilt or authoritative
Attempt lifecycle.

Use stable observation IDs, source instances, schemas, monotonic per-source
sequences, dual device clocks, bounded classified payloads, and explicit gaps or
resets. Deliver at least once with idempotency and watermarks. Keep the bounded
encrypted integrity spool separate from Attempt Workspace recovery.

Project only Candidate Posture or explicitly authorized minimized information.
Keep Live Proctor Signal, Restricted Review Evidence, and Exceptional Live
Observation access separate. Keep raw evidence out of ordinary audit,
diagnostics, renderer state, and application logs.

The step is complete when every collected field has a purpose, classification,
scope, delivery rule, visibility owner, and failure behavior without becoming a
cheating verdict.

## 7. Verify through the interfaces

Use the real coordinators with in-memory server, credential, policy, native,
workspace, and protected-store adapters. Test observable projections, intents,
capability denial, and process effects through the same interfaces as callers.

Cover callback replay, ambiguous refresh, revocation, sign-out failure, Session
Binding replacement, policy rollback, monitor loss, ordered containment,
connection loss at every dispatch phase, protected-store failure, renderer
recovery, full process loss, prohibited close, re-entry fencing, duplicated or
missing observations, spool failure, and sensitive-data absence.

Add cross-process verification for IPC validation, sandboxing, Electron-session
isolation, close veto, binding-driven window destruction, and capability
revocation before presentation.

The work is complete when implementation, adapters, process composition,
workbench projection, diagnostics, tests, and the architecture topic express the
same authority and failure semantics.
