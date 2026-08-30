# Identity and exam-security architecture

## Authority and scope

Proctor Desktop authenticates a Principal and enforces local candidate security
without becoming authority for institutional relationships, operation access,
Exam Attempt lifecycle, Integrity Flags, review, or consequences.

- The Proctor Server owns Institution availability and compatibility, Session
  validity, current authorization, self-context, Attempt admission and state,
  the active Session lock, Participation generations and leases, Exam Security
  Policy, re-entry, Integrity Flags, and consequences.
- Privileged Desktop modules own installation-key and credential custody,
  authenticated transport, native-capability coordination, local Secure Exam
  Posture, reversible containment, window transitions, continuity, and protected
  delivery.
- Sandboxed renderers present bounded projections and emit closed intents. DOM,
  context keys, restored state, and remote presentation never grant authority.

The Desktop consumes purpose-specific server decisions. It does not reproduce
raw Roles or infer UI authority from their names.

## Independent decisions and bindings

Keep these decisions independent:

- **Server Readiness** establishes one safe Institution origin, availability,
  and Desktop/protocol compatibility before authentication.
- **Authentication** establishes the current Principal and server Session.
- **Authenticated Navigation** projects the product areas the User may visit;
  it grants no operation.
- **Attempt Admission** validates the candidate, Sitting, Attempt
  Configuration, registered Desktop proof, Session, secure posture inputs, and
  candidate-wide unresolved-Attempt rule before secure join.
- **Operation Authorization** checks the current Action and actual Resource at
  each privileged operation.

Realtime events invalidate or route to an authoritative refetch. They do not
grant access or complete a lifecycle transition locally.

`AuthenticatedWindow` has one immutable Session Binding containing the
Institution origin, authenticated User reference, and server Session reference.
`CandidateWindow` adds one Attempt reference, active Participation generation,
and local security-session identity. Changing Institution, User, or Session
destroys the affected window. CandidateWindow is destroyed on suspension or
departure and is never restored directly on application relaunch.

## Server readiness and LaunchWindow

The privileged `DesktopIdentityCoordinator` normalizes the submitted server URL
and calls unauthenticated `GET /api/v1/system/ping`. The response is a small
client contract containing:

- canonical public origin and safe Institution display identity;
- availability: `ready`, `maintenance`, or `temporarily_unavailable`;
- stable safe reason, optional bounded administrator message, and optional
  authoritative retry timing;
- compatible minimum and maximum Desktop releases by platform/architecture;
- supported Desktop Authorization and realtime protocol ranges.

Internal initialization, migrations, database, queue, dependency, and node
health never enter the projection. `/api/v1/system/version` is build/provenance
information, not readiness or admission.

After URL submission, LaunchWindow replaces the input with the verified
Institution state regardless of availability. It offers `Sign in to
<Institution>` only while ready and compatible and always offers `Change
server`. Too old, too new, unsupported, maintenance, and temporary failure use
distinct localized outcomes. Production origins require HTTPS. An explicit
development loopback HTTP origin is visibly marked and cannot enter a production
Candidate Attempt.

## Desktop Authorization and installation proof

LaunchWindow contains no local/external method selector or authentication form.
To start authorization, Electron main creates:

- high-entropy state;
- PKCE S256 verifier/challenge;
- an exact ephemeral `127.0.0.1` or `[::1]` loopback callback with random port
  and transaction path;
- the public key or thumbprint for one Institution-specific Desktop
  Installation;
- declared Desktop release and target metadata.

The private installation key is non-exportable where supported and remains
behind an approved OS-backed adapter. No hardware serial, MAC address, or global
cross-Institution identifier is used.

The Proctor Server returns the exact same-origin hosted authorization URL. Its
page owns every currently available local or external method, authentication,
`Use another account`, explicit `Continue` approval, cancel, and return to the
pending Desktop transaction. Existing Web Sessions may skip authentication but
never skip final approval. Provider credentials and tokens remain between the
browser, server, and provider.

Only Electron main opens that exact URL in the system browser. The server
returns one very short-lived, single-use code and state to the exact loopback
callback. Electron main validates address, path, state, pinned origin, and
pending transaction, then exchanges code, PKCE verifier, and installation proof
only with the pinned origin. The callback carries no Session or refresh
credential. There is no embedded authentication BrowserWindow, custom scheme,
manual copyable code, or renderer-owned callback handling.

Cancel, timeout, mismatch, replay, server switch, proof failure, or ambiguous
exchange invalidates the local transaction. If the callback cannot be reached,
the hosted page gives a bounded retry instruction and a new transaction is
required.

After enrollment, Desktop access/refresh credentials and protected requests are
sender-constrained to the registered installation key with DPoP-compatible
proof. The authenticated transport validates method/URI binding, issued-at
window, proof uniqueness, access-token hash, server nonce where required, and
the Session's key thumbprint. The same proof boundary covers refresh, logout,
and authenticated realtime establishment/actions. The assurance claim is
`registered_desktop_key`; it is not official-binary or device attestation.

Access credentials remain memory-only. A rotating Desktop refresh credential
and installation private key use only approved OS-backed custody. Missing secure
storage makes persistent sign-in or registered-key use explicitly unavailable;
plaintext, renderer storage, generic application storage, URLs, logs, settings,
and restored state never carry credentials or private key material.

## Identity and self-context projection

`IdentityProjection` keeps separate facts:

- authentication: `signedOut`, `authenticating`, `authenticated`, or `ending`;
- Session validity: `valid`, `reauthenticationRequired`, `expired`, `revoked`,
  or `verificationRequired`;
- credential/key readiness: `ready`, `refreshing`, `locked`, or `unavailable`;
- sanitized Principal, Institution, reason, revision, and permitted identity
  intents.

The authoritative self-context independently represents disabled account, no
current affiliation, no assigned access, available product areas, manageable
Academic Units, unresolved Attempt presence, and account/session-management
availability. A current student is exclusively student. Non-student teacher,
staff, Academic Unit, Exam Manager, scoped-role, and system-administration
relationships may overlap.

Refresh is single-flight. Ambiguous credential rotation enters
`verificationRequired` rather than replaying an old credential. Security-related
connection closure triggers authoritative verification. Sign-out immediately
revokes local capabilities and locks Principal-bound protected data, then
attempts server revocation while preserving its exact outcome. Sign-out never
submits an Attempt or deletes candidate work.

## Authoritative Attempt and Session state

Desktop recognizes `ready`, `active`, `suspended`, and `submitted`:

```text
first successful join --------------------------> active
active -- continuity/policy/session loss ------> suspended
suspended -- manager reallow ------------------> ready
ready -- successful secure join ---------------> active
active | ready | suspended -- seal ------------> submitted
```

Ready is durable and has no reconnect interval. It may join whenever the
Sitting is open and otherwise joinable. Pause preserves ready but prevents the
join. Manager reallow changes only suspended to ready. There is no durable
`kicked` state; manager End Attempt seals acknowledged work and submits with
distinct provenance. Scheduled cancellation is pre-open and creates no Attempt
or Submission.

One candidate may have at most one unresolved Attempt (`ready`, `active`, or
`suspended`) across all Sittings. A new join while another Attempt is active
suspends the old Attempt with safe competing-admission provenance and rejects
the new join. A ready or suspended existing Attempt rejects the new join without
mutation. Submitted Attempts do not block later Sittings.

Only active state carries the account Session lock:

1. one active Attempt binds exactly one valid Desktop Session and current
   Participation generation;
2. entering active revokes all other Sessions for the User;
3. every new interactive Session-creation path refuses issuance while that
   active lock exists;
4. ready, suspended, and submitted hold no lock and permit normal sign-in;
5. rejoining ready selects the joining Session and revokes all others;
6. Attempt transitions do not revoke an otherwise valid Session;
7. invalidating the bound Session immediately suspends the active Attempt and
   fences its Participation.

The Desktop observes this state but never implements the lock locally as
authority. It prevents confusing duplicate local actions and presents the
server's stable safe outcome.

## Privileged exam-security module

`ExamSecurityCoordinator` is one Attempt-scoped privileged module used by the
CandidateWindow composition root. It owns:

- policy authenticity, freshness, scope, and rollback checks;
- secure preflight and continuous local posture;
- passive native-source supervision and normalization;
- closed containment effects through separate enforcement adapters;
- connectivity evaluation and Participation lease continuity;
- Browser Activity/integrity delivery reconciliation;
- coordination with Attempt Workspace protection and recovery.

Its renderer interface exposes only an immutable
`CandidateSecurityProjection` and closed intents such as retry checks, begin a
permitted join, acknowledge an explicit correction, or contact approved
support. Raw native streams, policy internals, detector thresholds, evidence,
credentials, server authorization objects, and privileged handles stay behind
the module.

The projection keeps separate:

- authoritative Attempt state and revision;
- local Secure Exam Posture and safe reason;
- Participation generation/lease phase;
- join/re-entry/departure affordances;
- Attempt Configuration and packaged capability availability;
- pause/correction state, protected-work status, authoritative time, and
  permitted intents.

## Effective Exam Security Policy

The server returns one canonical authenticated effective-policy envelope for
preflight and participation. It contains:

- Institution, Exam Revision and Sitting scope, plus either an existing Attempt
  reference for re-entry or a one-use candidate admission scope for first join;
- resolved accommodation/exception provenance without exposing authorization
  internals;
- required packaged capability and schema versions;
- explicit native `disabled`/`observe`/`enforce` selections and bounded
  registered configuration identifiers;
- evidence/visibility/retention classes and admission/expiry bounds;
- a canonical policy digest and anti-rollback identity.

The server resolves Institution policy, Exam Revision rules, current authority,
accommodations, and manager grants before delivery. Desktop validates the
envelope against its static registry and signed packaged capability matrix
before it requests permissions or opens sources. Unknown, contradictory,
oversized, prohibited, or unsupported requirements fail admission; Desktop does
not repair them with local precedence or a cached exception.

The policy remains frozen through one active Participation. Changing it requires
suspension and a fresh join. A separately authenticated emergency restriction
may strengthen or block current participation but cannot weaken the envelope.
The preflight report binds Institution, User Session, the existing Attempt or
one-use admission scope, policy digest, application release, signed matrix
identity, registered installation key, and source generations. The one-use
scope prevents replay but grants no operation and creates no durable Attempt
state. The report proves only the declared admitted capabilities, not official-
binary, device, or kernel attestation.

## Secure Exam Posture and containment

Secure Exam Posture is `uninitialized`, `checking`, `compliant`, `degraded`,
`contained`, `failed`, or `stopped`. It is local privileged state, not the
Attempt's authoritative `ready` state. Attempt entry requires compliant posture
plus fresh server admission; explicitly degraded observe-only coverage may join
only when every enforced requirement remains complete. Unsupported target,
required permission/source loss, expired policy, connectivity failure, or
unverifiable enforcement produces a safe reason and never a renderer-selected
exception.

The accepted initial policy model includes Focus Loss, Connection Loss, and the
first-release native families defined by the
[native family contracts](./native-capability-families.md). Each native family
uses an explicit `disabled`, `observe`, or `enforce` mode. Desktop does not
silently downgrade an enforced requirement or promote a disabled/observe
family.

A closed idempotent containment plan orders effects:

1. deny affected operations and prevent new dispatch;
2. cancel work proven not dispatched;
3. protect accepted work and retain unknown outcomes;
4. apply required native effects;
5. commit posture and capability state;
6. publish the sanitized projection;
7. queue permitted activity/integrity delivery.

Failure of a required step remains blocked. The actual Workspace, browser,
terminal, submission, and server operation owners still reauthorize requests.

A high-confidence native event may synchronously enter `checking` and close
mutation gates while the coordinator reconciles. It creates no occurrence or
integrity evidence until deterministic policy evaluation confirms the condition.
`contained` keeps CandidateWindow visible beneath one aggregated secure overlay
while blocking editor changes, terminal input, browser interaction/navigation,
resource mutation, and submission. Observe-only conditions never contain and do
not repeatedly notify the candidate.

Independent conditions retain independent occurrence lifecycles. Posture derives
from fixed precedence: failed/unknown enforced coverage, inactive authoritative
participation, confirmed enforced condition, checking, observe degradation, then
compliant. There is no suspicion score. A clean complete snapshot plus any
platform-certified stability fence may automatically remove local containment
while the Attempt remains active. Server suspension still requires manager
reallow to ready and a later successful join.

## Connectivity, pause, suspension, and re-entry

Candidate interaction requires continuous authenticated server participation
and has no offline editing grace. A transport close is not immediately
Connection Loss. Reconnect within the short server lease may preserve active
state and the current generation. Confirmed lease expiry suspends the Attempt
under Connection Loss policy while leaving an otherwise valid Session usable.

On any authoritative event that may block mutation, privileged gates close
before refetch. A paused Sitting keeps active Attempt, Participation renewal,
and Session lock. CandidateWindow remains visible beneath an overlay while
Workspace changes, browser, terminal, and submission are frozen.

Suspension closes gates, protects accepted/unknown work, shows a blocking
overlay, destroys CandidateWindow, and opens AuthenticatedWindow at the
suspended Attempt. Reallow later projects ready. A successful join from ready
rechecks Session, registered installation, release, Sitting, Attempt
Configuration, posture, Workspace reconciliation, and current operation
authorization before creating the new generation and CandidateWindow.

Application relaunch always begins at LaunchWindow or AuthenticatedWindow. It
never restores CandidateWindow directly. A renderer-only restart may recover
inside the same CandidateWindow only while the privileged coordinator, bound
Session, required monitors, and Participation lease remain continuously valid.

Ordinary close and quit are vetoed while authoritative active state denies
departure. Force Quit, crash, shutdown, or power loss never submits. Sitting
close seals active, ready, and suspended Attempts; manager End Attempt also
seals acknowledged work. Submission is one immutable server-owned outcome.

## Attempt Configuration and live corrections

At first join, Desktop derives the candidate-safe Attempt Configuration from
the packaged registry, current User Settings revision, and authoritative
constraints. The server validates and freezes its exact object/digest on the
Attempt. Re-entry uses that stored object; later User Settings changes do not
alter it. Stronger current accessibility or safety constraints may narrow the
effective projection without mutating the stored configuration.

Attempt admission pins one Exam Revision. Explicit immutable live corrections
may advance instructions, Exam Resources, or Browser Policy. CandidateWindow
shows a persistent bounded notice. Only a correction marked as requiring
acknowledgement gates affected mutations until its fenced acknowledgement is
accepted.

## Integrity meaning and privacy

Keep the transformation explicit:

```text
Native Observation
    → Security Signal
    → Detector Finding
    → Integrity Evidence
    → Integrity Flag
    → Review Outcome
    → Consequence
```

Every transition preserves source/schema/policy version, uncertainty, and known
gaps. Local findings may drive reversible containment but do not declare guilt
or authoritative Attempt state. Integrity review is not grading.

Sources use source-instance identity, monotonic sequence/time, bounded classified
payload, and explicit gaps/resets; the privileged delivery layer adds wall-clock
context. Raw native facts remain ephemeral; only minimized occurrences,
health/gap transitions,
recovery records, and preflight capability reports enter delivery. The main-
process delivery service binds canonical batches to Institution, User Session,
Attempt, policy digest, application release, capability matrix, source
generations, batch sequence, prior acknowledgement, and idempotency key, then
authenticates them with the registered installation credential. Helpers and the
utility never receive that credential.

Delivery is at-least-once and idempotent with server watermarks. Encrypted local
spool records remain until acknowledgement or server-defined retention expiry.
One aggregated continuity heartbeat reports required-source health, generations,
gaps, and posture rather than recurring normal observations. Protected Browser
Activity and integrity spools are distinct from Attempt Workspace recovery.

Candidate status, manager board state, detailed review evidence, and
exceptional live access remain distinct visibility classes. Ordinary managers
see students and safe current state, not multiple hidden attempt identities.
Exact authorized review may inspect minimized evidence. Ordinary audit,
diagnostics, renderer state, and application logs contain no credentials,
content, raw observations, browser URLs with sensitive query values, or private
review material.

## Process and workbench integration

LaunchWindow receives only readiness/identity projection and identity intents.
AuthenticatedWindow receives self-context and authorized product projections.
CandidateWindow receives the bounded security, Attempt, Workspace, browser, and
execution projections for its one active Attempt.

Concrete credential, DPoP, server transport, protected storage, native source,
and enforcement adapters are chosen in privileged composition roots. The exam-
security coordinator runs in the dedicated utility process. Electron main owns
its launcher, permission broker, CandidateWindow enforcer, window transitions,
and fail-closed projection bridge. Preload exposes fixed capability-specific
channels and validates scope, revision, intent family, and bounds.

## Verification

Use real coordinators behind in-memory ports and packaged-process tests. Cover:

- ping origin/availability/compatibility and change-server behavior;
- method-agnostic hosted auth, another account, cancel, loopback IPv4/IPv6,
  state/PKCE, proof mismatch/replay, callback failure, and active-lock denial;
- installation enrollment/revocation, DPoP URI/method/token/nonce binding,
  refresh rotation, and credential/key redaction;
- current-student exclusivity projection and mixed non-student areas;
- first join, candidate-wide conflict, other-Session revocation, Session issue
  refusal, brief reconnect, lease expiry, bound-Session invalidation, reallow,
  ready join, pause, close, and manager end;
- containment order, immediate event gating, Workspace protection/reconciliation,
  correction acknowledgement, and stale-generation denial;
- window destruction/creation order and absence of direct CandidateWindow
  restoration after relaunch;
- observation/activity duplication, gaps, resets, spool failure, visibility,
  and sensitive-data absence.

Cross-process tests verify sandboxing, IPC validation, fixed preloads, key and
credential custody, close veto, window transitions, security-utility loss, and
capability revocation before presentation. Native platform claims follow
[native-capability architecture](./native-capabilities.md); browser and PTY
claims follow their focused architecture topics.
