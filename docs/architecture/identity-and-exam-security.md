# Identity and exam-security architecture

## Authority and scope

Proctor Desktop authenticates a Principal and enforces candidate examination
policy without becoming the authority for institutional roles, Exam Attempt
lifecycle, re-entry approval, Integrity Flags, review, or consequences.

Authority is split deliberately:

- the Proctor Server owns Session validity, current authorization, composition
  and Attempt admission, Exam Security Policy, Attempt lifecycle, participation
  generations, re-entry decisions, Integrity Flags, and consequences;
- privileged desktop modules own credential custody, authenticated client
  transport, native-capability coordination, local Secure Exam Posture,
  reversible containment, participation continuity, and protected delivery;
- the sandboxed renderer owns presentation and sends only closed, validated
  intents. Its projections, context keys, restored state, and DOM never grant
  authority.

The desktop consumes bounded server decisions. Exact teacher roles, re-entry
grants, server routes, evidence persistence, Attempt lifecycle transitions, and
review workflows remain server-owned contracts rather than desktop models.

## Decisions and bindings

Authentication, Composition Admission, Attempt Admission, and Operation
Authorization are independent decisions:

- **Authentication** establishes the current Principal and server Session.
- **Composition Admission** permits one immutable candidate or proctor window
  kind and scope.
- **Attempt Admission** permits one candidate process to begin or recover one
  Exam Attempt under a current policy and participation generation.
- **Operation Authorization** checks the Action and actual Resource immediately
  before each sensitive operation.

Admission projections are short-lived routing inputs rather than reusable
authorization receipts. Realtime events trigger invalidation or refresh and
never grant an operation.

A role window has one immutable `Session Binding`: authenticated User reference,
server Session reference, workbench composition, and composition scope. A
sanitized Principal Snapshot may change after credential rotation, MFA, or
reauthentication without changing that binding. Changing User or server Session
destroys the role window; changing role opens a new window.

The authenticated SettingsWindow is likewise bound to one User and server
Session but carries no role or Attempt authority. A binding replacement destroys
it. Active candidate participation excludes it, and Electron main closes it
before candidate preflight.

## Privileged identity module

`DesktopIdentityCoordinator` is a deep privileged module used by the
`LaunchWindow`, Electron composition root, and product transport adapters. It
owns:

- authentication transactions and exact callback validation;
- the isolated Electron network-session partition;
- refresh coordination, expiry, reauthentication, revocation, and sign-out;
- OS credential-store handles and secure-persistence availability;
- construction and invalidation of Principal Snapshots and Session Bindings;
- attachment of credentials to approved product transport adapters.

Its external interface has three operation families:

1. observe an immutable, sanitized `IdentityProjection` and its changes;
2. submit a closed identity intent such as authenticate, continue a challenge,
   reauthenticate, cancel, retry, or sign out;
3. obtain a trusted Session Binding through the privileged composition root
   after current Composition Admission succeeds.

The renderer receives no access token, refresh token, cookie, CSRF secret,
provider secret, credential-store handle, encryption primitive, arbitrary URL
fetcher, or generic secret-storage interface. Product transports receive a
narrow authenticated-network capability rather than credentials.

Password material may cross one validated, one-shot privileged authentication
operation and is not retained. External authentication initially uses a
dedicated window sharing the isolated Electron session. A future system-browser
flow requires a separately reviewed server handoff. Callback transactions are
high-entropy, expiring, single-use, and bound to the exact expected provider and
URI state.

Persistent credentials require an approved OS-backed adapter. Unavailable
secure storage becomes explicit credential unavailability; there is no
plaintext, weak-encryption, generic application-storage, or silent in-memory
substitute that pretends persistence succeeded.

## Identity projection and lifecycle

`IdentityProjection` keeps independent facts rather than collapsing them into a
single signed-in boolean:

- Authentication: `signedOut`, `authenticating`, `authenticated`, or `ending`;
- Session validity: `valid`, `reauthenticationRequired`, `expired`, `revoked`,
  or `verificationRequired`;
- Credential readiness: `ready`, `refreshing`, `locked`, or `unavailable`;
- sanitized Principal Snapshot, reason code, revision, and permitted identity
  intents.

Refresh is single-flight. An ambiguously completed credential rotation enters
`verificationRequired`; it does not retry an old credential whose server outcome
is unknown. Security-related connection closure invalidates current projections
and triggers authoritative verification rather than inventing logout or
continuing optimistically.

Local Identity Lock, confirmed Session Revocation, and unknown revocation
outcome remain distinct. Sign-out first revokes local capabilities, closes role
windows, and locks Principal-bound protected data. It then attempts server
revocation and reports the exact outcome. Sign-out never submits an Attempt,
deletes candidate work, or claims server revocation merely because local
credentials were removed.

## Privileged exam-security module

`ExamSecurityCoordinator` is one attempt-scoped privileged module used by the
candidate composition root and its security contribution. It owns:

- policy verification, freshness, scope, and rollback protection;
- secure-exam preflight and continuous posture evaluation;
- passive native-source supervision and normalization through private ports;
- coordination of closed effects through separate enforcement adapters;
- authenticated connectivity evaluation and reversible containment;
- participation lease renewal, interruption detection, and re-entry gating;
- integrity-record delivery and reconciliation;
- orchestration with Attempt Workspace protection and reconciliation.

Its renderer-facing interface has two operation families:

1. observe an immutable `CandidateSecurityProjection` and its changes;
2. submit a closed permitted intent such as retry checks, continue an approved
   recovery step, request re-entry, or contact approved support.

Native streams, policy internals, detector thresholds, raw evidence, credentials,
server authorization objects, and privileged handles remain behind the module.
The [native-capability architecture](./native-capabilities.md) fixes the concrete
process roles and source/effect separation while preserving this interface.

`CandidateSecurityProjection` contains only what presentation and packaged
capabilities need:

- projection revision and opaque Attempt scope;
- Secure Exam Posture and sanitized reason code;
- participation continuity: `inactive`, `establishing`, `continuous`,
  `interrupted`, or `superseded`;
- re-entry: `notRequired`, `required`, `pending`, `authorized`, or `denied`;
- packaged capability availability, including browser, terminal, and agent
  surfaces where policy permits them;
- connectivity/recovery phase, protected-work status, authoritative time
  anchor, application-close permission, and permitted intents.

These fields remain separate facts inside the projection. The workbench may
derive one gate presentation from them but cannot turn that presentation back
into authority. `authorized` re-entry permits the recovery transaction to
continue; it does not itself permit candidate interaction.

## Policy and Secure Exam Posture

Exam Security Policy is an authenticated immutable envelope scoped to its
revision, Exam Sitting and Attempt, User and Session, installation, supported
build, effective period, required monitors and controls, packaged detectors,
feature capabilities, accommodations, disclosures, evidence classes, and
restricted or blocked behavior. The desktop verifies authenticity, exact scope,
monotonic revision, and freshness and rejects rollback. Policy selects packaged
behavior; it supplies no executable code.

Secure Exam Posture is one of:

- `notApplicable` — candidate examination enforcement is not required;
- `checking` — required policy, admission, monitor, control, or recovery checks
  have not yet produced a usable posture;
- `ready` — every required current condition permits normal interaction;
- `restricted` — current policy explicitly permits a named reduced capability
  set;
- `blocked` — only bounded recovery, status, teacher/support contact, and
  protected-work information are available.

Attempt entry requires `ready` or an explicitly entry-permitting `restricted`
policy. Only fresh checks restore `ready`. Unsupported platforms, missing
permission, expired policy, monitor loss, connection loss, and control failure
produce sanitized reasons rather than renderer-selected exceptions.

Policy evaluation produces a closed, idempotent `Containment Plan`. Execution
orders effects as follows:

1. deny affected operations and prevent new dispatch;
2. cancel work proven not to have been dispatched;
3. protect accepted work and retain outcome-unknown operation identities;
4. apply required native controls;
5. commit posture and capability state;
6. publish the sanitized projection;
7. queue permitted integrity reporting.

Containment is policy-scoped and reversible. Failure of a required containment
step resolves to blocked rather than partial readiness. The authoritative
operation owner still reauthorizes every operation independently.

## Online-only interaction and recovery

Candidate examination interaction requires a continuously authenticated server
channel and has no offline grace or offline editing mode. A trusted native
connectivity source reports bounded facts; the coordinator distinguishes device
network loss, server unreachability, invalid authenticated channel, suspected
manipulation, and unknown transport failure. Renderer browser status and one
failed request are not transition authority.

Confirmed loss immediately enters blocked posture, denies new workspace changes
and privileged operations, closes policy-gated browser, terminal, and agent
surfaces, protects all previously accepted work, and preserves every in-flight
or outcome-unknown mutation for reconciliation. Required monitoring and bounded
integrity spooling continue where possible.

Connectivity restoration never resumes interaction by itself. Recovery is one
gated transaction:

1. restore native connectivity and authenticated transport;
2. verify or reauthenticate the Session;
3. upload and reconcile permitted integrity records;
4. load authoritative Attempt and re-entry state;
5. renew Attempt Admission and Exam Security Policy;
6. restore required monitor and control health;
7. reconcile authoritative workspace outcomes and protected work;
8. obtain fresh server authorization.

Only then may posture progress through `checking` to `ready` or an explicitly
permitted `restricted` state. Server time remains authoritative; a local
monotonic estimate may support display, but blocking, interruption, or reconnect
does not pause the examination or cause local submission.

Attempt admission also fences the source revision of the Candidate Settings
Baseline defined by the [user-settings architecture](./user-settings.md). A
Participation Interruption or authorized re-entry reuses that Attempt-wide
baseline; it does not reread a remotely changed User Settings Document. Current
trusted policy and accessibility constraints may still narrow its effective
projection.

## Participation continuity and application close

Every active candidate Attempt has one server-recognized `Attempt Participation`
generation. The coordinator holds a short-lived continuity credential outside
the renderer and renews it while the privileged process and required monitoring
remain continuous. The generation scopes candidate operations without replacing
their current authorization checks.

Ordinary application close and quit are prohibited while the authoritative
Attempt projection says examination participation remains active. Electron main
vetoes ordinary close requests. The candidate first completes the normal
server-authorized examination workflow; only an authoritative projection may
permit application departure. Shutdown messages and close modals remain orderly
lifecycle mechanisms rather than security boundaries.

A renderer-only failure may recover while the privileged coordinator, required
monitors, and participation lease remain healthy. Loss of that continuity—by
process termination, crash, power loss, forced close, or monitor failure—creates
a `Participation Interruption`. Authentication after relaunch does not restore
Attempt Admission.

Re-entry is a bounded server projection. Product policy limits approval to the
Exam creator or another server-authorized teacher, while roles, grants, and the
decision workflow remain server-owned. The desktop stays gated until approval,
integrity and workspace reconciliation, fresh admission, and secure preflight
all succeed. Authorized re-entry creates a new generation that fences stale
heartbeats, credentials, and operations from the old process.

An interruption is not submission, suspension, an Integrity Flag, or guilt.
The sequence of a vetoed close followed by continuity loss may become detector
input, but the desktop does not decide its review or consequence.

## Integrity information

Use the explicit transformation chain:

```text
Native Observation
    → Security Signal
    → Detector Finding
    → Integrity Evidence
    → Integrity Flag
    → Review Outcome
    → Consequence
```

Each transformation preserves source, schema and policy version, uncertainty,
and known gaps. Local normalization may reduce high-volume observations, and
packaged local detectors may support immediate posture or containment. Server
policy owns flag creation and authoritative consequences.

Source facts carry source-instance identity, schema version, per-source
monotonic sequence, device wall and monotonic time, bounded classified payload,
and explicit reset or gap information. The coordinator wraps accepted facts
with stable observation IDs and trusted installation, Session, Attempt,
participation-generation, and policy scope. Server receipt provides
authoritative receive time; the desktop invents no total order across sources.

Delivery is at-least-once and idempotent with per-source watermarks and missing
ranges. A bounded encrypted integrity spool, separate from Attempt Workspace
recovery, preserves permitted records during connection loss. Overflow,
corruption, restart, and loss become explicit signals. Raw observations are
ephemeral unless policy promotes minimized material to Integrity Evidence.

Required sources expose `starting`, `healthy`, `degraded`, `failed`, or
`stopped`. Restart changes source-instance identity and reports a sequence
reset. Required-source failure follows policy; optional-source failure reduces
coverage without fabricating misconduct.

Integrity information has four visibility classes:

- Candidate Posture;
- Live Proctor Signal;
- Restricted Review Evidence;
- separately authorized Exceptional Live Observation.

Collection purpose, monitoring categories, permission requirements, evidence
classes, broad retention, and support/correction routes are disclosed before
entry. Accommodations and candidate exceptions enter authenticated policy before
detection. Ordinary proctors receive minimized signals rather than candidate
files, screenshots, terminal or clipboard content, or raw process/window data.
Audit records decisions and transitions; it is not the raw evidence store.

## Workbench and process integration

`LaunchWindow` renders the identity projection and identity intents only. A role
window is created from a trusted Session Binding and composition admission.
Candidate composition then opens behind an explicit attempt-loading and
secure-preflight gate.

The candidate security contribution renders the current security projection,
closes or disables revoked capability surfaces, and restores focus into the
gate. Context keys mirror projection state for menus, routing, and accessibility
only. Candidate content, Exam Resources, terminal, browser, and agent interaction
are unavailable while blocked or awaiting re-entry.

Concrete Electron, server-transport, protected-storage, observation-source, and
enforcement adapters are selected in privileged process composition roots. The
coordinator runs in the dedicated exam-security utility process; Electron main
owns its launcher, permission broker, candidate-window enforcer, and fail-closed
projection bridge. Preload exposes only capability-specific observation and
intent channels for its window kind. IPC validates scope, revision, action
family, and payload bounds in the owning process.

## Verification

Test the two deep modules through their external interfaces with in-memory
server, credential, policy, native-source, native-control, and protected-store
adapters. Cover at least:

- authentication cancellation, callback mismatch/replay, single-flight refresh,
  ambiguous rotation, MFA, expiry, revocation, unavailable secure storage, and
  sign-out with unknown server outcome;
- immutable Session Binding across Principal refresh and destruction on User or
  Session replacement;
- policy signature, scope, expiry and rollback failures; accommodations;
  required and optional source failure; and containment ordering;
- connection loss before dispatch, after dispatch, and with unknown mutation
  outcome; protected-store failure; and the complete recovery transaction;
- renderer crash with continuous privileged health, full process loss,
  prohibited close, participation interruption, denied and approved re-entry,
  generation fencing, and stale-operation rejection;
- observation duplication, gaps, reset, spool overflow/corruption, data
  minimization, visibility, and absence of sensitive values from renderer
  projections and diagnostics.

Cross-process tests verify IPC validation, renderer sandboxing, Electron-session
isolation, close veto, window destruction on binding change, and capability
revocation before presentation. Tests assert observable results through the
same interfaces used by callers.

Native sources, candidate-window effects, utility supervision, strict display
topology, overload, and platform claims follow the additional conformance and
packaged verification requirements in the
[native-capability architecture](./native-capabilities.md).

## Deferred dependencies and VS Code relationship

The server owns exact routes, teacher authorization, participation persistence,
Attempt lifecycle, evidence retention, review, and consequences. Electron/native
builds, wire encoding, signing, package integrity, updates, and test runtimes
follow the accepted [toolchain architecture](./toolchain.md) and cannot weaken
the interfaces above or the native-capability boundary.

Production admission and immediate revocation claims also depend on a server
contract with sufficiently fresh authorization and participation checks. A
desktop projection cannot close a stale server authorization-cache window;
documentation and tests must state the bounded behavior until the server
provides the required guarantee.

At the reviewed VS Code baseline, authentication is a renderer/extension-host
account-and-token broker, secret values cross renderer and extension-host RPC,
Workspace Trust is user-controlled, and lifecycle vetoes coordinate only
orderly shutdown. Proctor therefore admits no VS Code identity or security
cluster. PKCE, one-time callback state, cancellation, disposal, events, and
ordered transition participants remain behavioral evidence for a future
Proctor-owned implementation.
