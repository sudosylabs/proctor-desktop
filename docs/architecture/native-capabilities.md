# Native capability architecture

## Scope and security claim

Native capabilities provide bounded mechanical observations and separately
owned enforcement effects for secure candidate participation. They do not prove
that a device is trustworthy, declare cheating, create an Integrity Flag, or
decide an Attempt consequence.

The accepted family-by-family policy, privacy, correction, and platform claim
is defined in
[`native-capability-families.md`](./native-capability-families.md). This document
owns the shared source-session, privilege, process, coordination, failure,
evidence, and release architecture.

Every observation states its platform coverage, permission and source health,
uncertainty, and known gaps. Missing required coverage blocks candidate
interaction. Administrator/root control, kernel compromise, and external
hardware remain outside the guaranteed threat boundary unless a later hardened
deployment explicitly accepts them.

Secure candidate mode initially targets declared Windows and macOS versions and
architectures. Untested combinations and unsupported platforms fail preflight;
there is no silently weakened mode. Exact version ranges wait for packaged
conformance and belong to the signed release capability matrix.

This document separates accepted architecture from implementation and release
claims. The generated native manifest now contains display topology,
CandidateWindow, capture/session, process/application, interactive session,
clipboard, print spooler, removable storage, virtualization, network
configuration, and media device sources. Checked JSON Schemas generate bounded
Rust and TypeScript DTOs and validators for every source and for the private
process/session helper protocol. The shared observation schema also owns the
ordered native source-category enum; its generator emits the TypeScript and
Rust category type and order consumed by utility admission and the Node-API
bridge. The shared runtime and scalable supervisor
provide race-free startup, ordered bounded delivery, exact gaps, reset-fenced
replacement, atomic rollback, and reverse-order shutdown across an explicitly
selected, manifest-ordered source subset. Disabled sources have no factory
opened. The Node-API bridge, security-utility protocol, and development
Electron harness carry the exact complete source manifest plus the selected
subset. Electron main keeps a
separate permission manifest because camera and microphone are independent OS
permissions over one shared media source. Inspection, explicit requests, and
the preflight seal are bound to that exact source/category selection; a launch
with a different selection is rejected before the utility starts.
Ready, poll, and stop messages are checked against the same sealed subset, so a
utility cannot introduce facts from a disabled source after bootstrap.

Display topology has source-tested macOS, Windows, and Linux adapters.
CandidateWindow has a source-tested main-owned host adapter and utility ingress.
Capture/session has notification-first Windows WTS observation with a
RemoteFX-aware current-session fallback; macOS and Linux report explicit
unavailable coverage. The newer source crates now have the bounded platform
adapters detailed below. Their `snapshot_only`, partial, or unavailable states
are explicit and cannot satisfy a stronger enforced requirement. Full process
and all-interactive-session coverage still requires the signed Windows ETW/WTS
service or entitled macOS Endpoint Security helper. The generated helper
protocol, its validation/binding library, and an exact-path,
code-identity-verified private-pipe launcher exist. Windows launch admission
pins Authenticode trust and the exact release SHA-256 on a file handle opened
without write/delete sharing, retains that handle across process creation, and
checks the spawned child image path before the nonce handshake. macOS resolves
the live child with Security.framework and checks its designated requirement;
neither target trusts a path-only post-spawn verification. Helper output uses one
generated discriminated envelope and source-owned lifecycle fences. The current
helper binary's ordinary stdio entrypoint returns explicit unavailable snapshots
and is not yet part of privileged packaged service composition. The macOS source
also includes kernel audit-token peer verification, a bounded audit inventory and
an ES notification adapter with generation-aware bootstrap reconciliation.
Its bounded signing worker binds secured executable metadata to an exact kernel
audit token and exec generation; absent required fields remain unavailable.
Exec/exit transitions awaiting identity retain their ordered history under bounded
source credits and publish Partial coverage until settlement completes. Poll limits
cannot discard accepted transitions or replace their original terminal failure;
an SDK timeout remains a cleanup failure even if the SDK later returns.
Its passive startup requires natural event boundaries before and after inventory;
quiet startup, gaps, muted lifecycle events and expired deadlines cannot produce
a complete snapshot. Windows includes a bounded ETW notification feed and a
service-owned WTS dispatcher with asynchronous session reconciliation, retained
logon identity, minimized callbacks and bounded close tails. The helper bridge
preserves event capture times and pending reconciliation. Kernel pipe/token
binding accepts an already code-verified retained client process handle; it does
not supply that executable proof. The Windows process inventory/reducer retains
exact process lifetimes and account scope, but its unproved ETW prefix barrier
remains unavailable. These components do not establish installed
service activation, complete Windows executable identity, complete Windows process
bootstrap or macOS all-interactive-session coverage.

A generated family/sub-capability registry with exact registry and source-schema
digests, mandatory display/window/capture/content-protection baseline claims,
authoritative per-family modes,
bounded family-policy schema references and per-platform coverage keys,
fail-closed signed-matrix parser
and privileged pinned-Ed25519-key verifier, bounded CandidateWindow-only private clipboard,
and closed candidate print-command denial gate are implemented and interface-
tested. Electron main also owns the implemented CandidateWindow
constructor/enforcer and preflight-only permission broker. The Attempt-scoped
`ExamSecurityCoordinator` state machine now validates the closed effective-
policy shape against the registry and a verified matrix identity, derives the
exact native source/category selection, keeps policy authenticity and anti-
rollback behind a privileged port, orders containment and protected-work steps,
maintains minimized occurrence lifecycles, fences Participation, and exposes a
sanitized Candidate projection through closed Electron-main IPC. These remain
source-level primitives: the coordinator is not yet activated by the production
utility bootstrap, and no packaged detector set, production CandidateWindow
composition, signed release matrix, or supported target tuple exists. Focused
interfaces and the real Electron development-runtime harness test the existing
boundaries; they do not establish packaged conformance. Privileged platform
helpers, remaining full-coverage adapter variants, packaged target
verification, matrix generation/signing, and release gates remain
unimplemented. Global external screen-capture detection is explicitly
unavailable rather than an unfinished promise. No supported secure-candidate
target exists yet.

## Ownership and process flow

```text
passive native observation sources
        │ snapshots, events, states, health
        ▼
dedicated exam-security utility process
        │ ExamSecurityCoordinator
        │ normalization, policy evaluation, detectors,
        │ posture, integrity delivery, continuity
        ▼
closed containment plan
        │
        ▼
Electron main enforcement adapters
        │ candidate-window and main-only effects
        ▼
sanitized CandidateSecurityProjection
        │
        ▼
sandboxed candidate renderer
```

Ownership is split into four areas:

- environment-neutral exam-security code owns the language-neutral observation
  protocol and schemas;
- capability-family packages own target-specific mechanical observation
  adapters;
- one attempt-scoped `ExamSecurityCoordinator` in a dedicated utility process
  owns source supervision, normalization, authenticated policy evaluation,
  packaged detectors, posture, integrity delivery, and participation
  continuity;
- Electron main owns process launch, permission prompting, candidate-window
  enforcement, and other main-only effects through closed adapters.

The utility process is a fault boundary, not an automatic least-privilege OS
sandbox. Full process and all-interactive-session coverage requires a signed,
version-matched Windows service using ETW/WTS and an approved macOS Endpoint
Security component with Full Disk Access. These helpers are admitted only for
their narrower privilege/entitlement boundary. They are installed with the
packaged application, remain dormant outside source sessions, and expose no
network or generic filesystem service. The composition root selects every
concrete adapter from packaged code.

The helper protocol receives bounded event classes and resource limits rather
than policy. It carries no Institution, User, server Session, Attempt, policy,
or content data. Missing service, approval, entitlement, code identity,
privilege, or compatible version makes the dependent capability unavailable;
an unprivileged fallback cannot retain the stronger claim.

## Capability-first native packages

One Rust crate owns each independently testable observation-source lifecycle.
Small facts that share one OS lifecycle remain sub-capabilities rather than
separate crates. The accepted expansion is:

- `prctr-process-application-state`;
- `prctr-interactive-session-state`;
- `prctr-clipboard-state`;
- `prctr-print-spooler-state`;
- `prctr-removable-storage-state`;
- `prctr-virtualization-state`;
- `prctr-network-configuration-state`;
- `prctr-media-device-state` for separate camera and microphone facts over
  shared permission, endpoint, hot-plug, and cleanup machinery.

`prctr-native-source-runtime`, `prctr-native-protocol`, and
`prctr-native-source-supervisor` own only reusable source lifecycle, schema,
fencing, bounded queue, health, and transport mechanics. Capability crates own
their state models, platform adapters, normalization, and focused tests.
`prctr-native-helper-protocol` binds the generated process/session helper wire
contract to a verified peer identity, fresh channel nonce, and frame boundary;
it contains no executable or OS transport. `prctr-native-security-helper` owns
the exact-path signature check, inherited-pipe and authenticated macOS service
transports, fixed supervisor/worker entrypoints, and unavailable responses for
unimplemented target sources. The macOS launchd service retains the worker process
and acknowledges stop only after observing its exit. A nonce-free acceptance
marker precedes reciprocal code verification; the marker conveys no authority.
Explicit main-owned service registration is separate from permission and source
readiness, and is blocked during preflight or active participation.
The launcher generates each nonce internally, consumes one launch authority,
applies one absolute startup deadline across path/signature verification,
nonce generation, process creation, live-process verification, pipe setup, and
handshake, applies separate request and termination deadlines, and terminally kills and
fences the child on the first framing, validation, ordering, timeout, or I/O
failure. Close returns the ordered source tail together with its final snapshot,
so no observation can be delivered after terminal state.
Language-neutral JSON Schemas remain wire authority; deterministic generation
produces Rust/TypeScript DTOs, validators, bounds, discriminants, and manifest
entries.

Current source adapters make the following development-runtime claims. They are
not signed release-matrix or packaged-support claims:

| Family              | Windows source                                                                                                       | macOS source                                                                                                                                         | Linux source                                                                                                                                                    |
| ------------------- | -------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Process/application | Current-session Toolhelp snapshot, partial, identity unavailable                                                     | Declared running-application snapshot, partial, identity unavailable                                                                                 | Same-account `/proc` snapshot with session scope `unknown`, partial, identity unavailable                                                                       |
| Interactive session | WTS human-session snapshot, partial                                                                                  | Unavailable until the approved helper exists                                                                                                         | logind human-session snapshot when present, partial                                                                                                             |
| Clipboard           | Content-free change counter, partial                                                                                 | Content-free pasteboard change counter, partial                                                                                                      | Unavailable across generic X11/Wayland                                                                                                                          |
| Print spooler       | Active local scheduler-job counts from field-selective owner/status notifications, partial                           | Unavailable until a bounded IPP query replaces unbounded CUPS enumeration                                                                            | Unavailable until a bounded IPP query replaces unbounded CUPS enumeration                                                                                       |
| Removable storage   | Mounted removable-volume snapshot keyed internally by volume GUID and emitted with Attempt-keyed pseudonyms, partial | Mounted removable-volume snapshot with Attempt-keyed pseudonyms, partial                                                                             | Sysfs-marked removable block inventory and base/partition mount state with Attempt-keyed pseudonyms, partial; no generic portable/MTP claim                     |
| Virtualization      | CPUID recognized-guest/Hyper-V-root classification                                                                   | Unavailable through public generic APIs                                                                                                              | Recognized-guest marker classification with explicit uncertainty                                                                                                |
| Network             | Active tunnel classes, adapter-topology generation, and system-proxy presence, partial                               | Active tunnel classes, interface-topology generation, and bounded system-proxy enable flags, partial; actual route and managed-VPN facts unavailable | Active tunnel classes plus IPv4 route/interface generation, partial                                                                                             |
| Camera/microphone   | Endpoint presence only; permission/readiness/concurrent use remain unknown                                           | AVFoundation permission, device-input readiness probe, endpoint count, and documented concurrent use                                                 | Camera unavailable until bounded V4L2 capture-capability inspection exists; microphone endpoint presence only, with permission/readiness/concurrent use unknown |

Snapshot adapters start observation before their initial query, coalesce equal
states, fence final snapshots, and fall back to explicit unavailable coverage
when their platform service cannot be queried. Only an ordinary backend
discovery failure permits that fallback: inventory overflow, protocol, queue,
and cleanup failures retain their exact terminal category. The supervisor
rechecks the process-wide fence after every completed source open, including
the final selected source, and rejects readiness when process replacement is
required. Windows and macOS process
snapshot entries require a stable PID-plus-creation/launch generation and are
omitted when that generation cannot be read; PID-only and transient application
object addresses are never process-instance authority. Native process keys, account
values, application pointers, interface names, mount identities, device paths,
proxy values, job metadata, and media names never cross the source boundary.
Print observation asks Windows only for owner and numeric status fields, reduces
the owner in place to a relative classification, and clears every transient
owner buffer before release. A notification outside the fixed processing or
owner-size bound is cleaned behind the shared cleanup deadline; inability to
prove completion poisons the utility so the supervisor must replace its process.
Only opaque source-session process/interface
identities, Attempt-keyed storage pseudonyms, and bounded classifications are
emitted.

Raw source timestamps are process-local monotonic values. Wall-clock time is
added only when the privileged utility delivers an initial snapshot or poll to
Electron main. Delayed process transitions retain a bounded `capture_delay_ns`:
the original source-ingress capture is the enclosing observation timestamp minus
this duration. This denotes adapter receipt, not kernel event-generation time.
Publication remains monotonic while identity verification settles;
translating or advancing the publication clock must preserve that capture time.
Absent delay means no deferred capture, and delay may never precede the source
time origin. Inventory bounds fail with the distinct
`inventory_overflow` category rather than being collapsed into a backend
failure.

The media source snapshot permission is a conservative aggregate over selected
endpoint categories only: any selected denial, restriction, undetermined, or
unavailable state prevents an aggregate `granted` claim. Per-endpoint permission
remains authoritative for camera- versus microphone-specific policy.

Electron main invalidates a running native source lifetime on suspend, resume,
screen lock/unlock, and interactive-user transitions. It terminally fences the
utility before another heartbeat can be accepted, removes the OS callbacks,
and requires a fresh admission/security lifetime. These are operational gaps,
not misconduct observations.

The snapshot-only process and session adapters cannot authorize an application,
prove complete lifecycle coverage, or satisfy an enforced single-session gate.
Those claims still require the signed ETW/WTS service or approved Endpoint
Security helper. The macOS service transport and process-source composition exist
in source, but no installed signed service, packaged capability matrix, or
certified target tuple is established. Complete macOS interactive-session coverage
and Windows service activation/complete ETW bootstrap remain unavailable.
The helper-backed supervisor preserves capture timing, bounds retained observations
and close tails together, reserves reset controls, and delivers terminal snapshots
through the private Node and utility/main contracts.

## Passive observation sources

A native observation package is a passive fact source. It receives no User or
Attempt identity, exam content, authorization object, Exam Security Policy,
accommodation, detector rule, posture, or generic control command. It receives
only an opaque collection-session identifier, requested schema version,
selected mechanical categories, and resource bounds.

Opening a source creates one race-free source session. The handshake returns:

- source, adapter, and schema versions;
- platform support and permission state;
- a new source-instance identifier and current health;
- one complete initial snapshot at sequence `N`;
- an ordered stream beginning strictly after `N`;
- explicit gaps and resets;
- idempotent disposal.

The adapter buffers transitions while constructing the initial snapshot.
Event-only sources and separate query-then-subscribe startup are invalid. A
source owns its instance identity, monotonic sequence and time, bounded
mechanical payload, and gap/reset facts. The privileged delivery layer adds wall-
clock context. Clock adjustment cannot reorder occurrences, extend a recovery
fence, or manufacture a gap. The coordinator wraps accepted facts with trusted
installation, Session, Attempt, participation-generation, and policy provenance
to form a `Native Observation`.

Sources expose health as `starting`, `healthy`, `degraded`, `failed`, or
`stopped` and permission as `not_determined`, `granted`, `denied`, `restricted`,
or `unavailable`.

The coordinator translates the verified effective policy into source admission:

- `disabled` opens no source and requests no permission;
- `observe` may run with explicit degraded coverage and never contains solely
  because its mechanical condition occurred;
- `enforce` requires complete healthy coverage and contains on a confirmed
  prohibited condition.

Sources remain policy-blind. They receive only selected mechanical categories,
schema versions, adapter variants, queue limits, and other observation bounds.
The private bootstrap names clipboard change; removable block and portable/MTP;
system-proxy, OS-managed-VPN, tunnel-interface, route-change, and network-source-
health; and camera/microphone selections in the schema-generated fixed order. A selected
clipboard, removable-storage, network-configuration, or media source requires a
non-empty matching category selection, while an unselected source permits none.
Main-owned private clipboard and candidate print-command denial are closed
effects, not observation categories: selecting either effect alone does not open
the clipboard or print-spooler source.
Platform adapters do not query an unselected storage or network category;
unsupported selected categories remain explicit unavailable or unknown coverage
instead of widening collection.
Polling adapters register their worker before one authoritative initial query.
Only an ordinary backend-discovery failure from that authoritative query may
roll back the worker and return explicit unavailable coverage; worker setup,
inventory bounds, protocol, queue, and cleanup failures remain terminal. A
separate successful probe never authorizes a later failing initial query.
The coordinator stays `checking` until every required source has returned a
complete healthy snapshot for its current generation. Snapshots carry capture
bounds and do not pretend to be simultaneous.

Platform notifications wake reconciliation rather than establishing complete
authority. Startup, resume, helper or source restart, user-session or namespace
change, permission change, and detected notification loss require a new bounded
complete snapshot. A replaced generation cannot accept a stale callback.

The accepted first-release source families cover:

- source supervision and capability health;
- required permission and platform-capability state;
- candidate-window focus, visibility, minimized/maximized state, fullscreen,
  bounds, and close attempts;
- physical, active, mirrored, virtual, remote, and specialized display
  topology;
- supported remote interactive-session facts;
- process/application and interactive OS-session state;
- private clipboard and host clipboard-change state;
- CandidateWindow print commands and certified spooler state;
- removable block-storage and supported portable-device state;
- bounded virtualization classification;
- explicit proxy, managed-VPN, tunnel-interface, route, and network-source
  state;
- camera and microphone endpoint readiness plus supported mechanical concurrent
  use;
- privileged process/source continuity needed to preserve active Participation.

The initial display rule requires exactly one physical usable display and no
mirrored, virtual, remote, or specialized target. CandidateWindow enforcement
also applies best-effort platform content protection without claiming that it
prevents external capture.

These source contracts and lifecycle packages are implemented at the exact
coverage levels stated above; a partial or unavailable adapter cannot satisfy
an enforced requirement. Exact sub-capability and platform boundaries live in the
[family contracts](./native-capability-families.md). Global external screen-
capture detection is unavailable on the initial targets. Audio, camera, or
screen content collection; keystroke logging; packet/DNS capture; general
system-browser history; and generic native diagnostics are outside this
accepted capability scope.

## Policy and evidence transformation

Sources report mechanical facts only. The coordinator normalizes those facts
and evaluates one authenticated canonical effective-policy envelope through a
private policy evaluator. The [security-policy contract](../contracts/security-policy.md)
defines the initial published-selection/baseline/artifact resolver and its
explicit exclusions. The envelope binds registry/schema identities, target
requirements, admission scope, and a policy digest; the Participation lease
supplies live time authority. Unknown, conflicting, oversized, prohibited, or
unsupported requirements fail before permission or source startup.

```text
source fact
    → Native Observation
    → Security Signal
    → Detector Finding
    → Integrity Evidence
```

The server remains authoritative for Attempt state, Integrity Flags, review,
and consequences. Packaged local detectors are deterministic versioned state
machines rather than opaque scores. A high-confidence event may apply
provisional `checking` containment while reconciliation runs, but creates no
condition occurrence until policy evaluation confirms it. An occurrence keeps
stable identity, bounded repeats, source ranges, uncertainty, gaps, and recovery.
Neither a source nor a detector declares guilt.

The renderer receives only the sanitized `CandidateSecurityProjection`. Raw
source streams, policy internals, detector constants, native handles, and
evidence stay privileged. One aggregated correction overlay presents safe
family-level reasons and actions. Observation packages expose no control methods
and never become bidirectional native hosts.

## Candidate-window enforcement

Candidate participation uses a purpose-built immutable candidate window.
Electron main owns a closed `CandidateWindowEnforcer` with only three product
operations: prepare the window for one participation generation, verify its
constraints, and release it after authoritative departure. The renderer cannot
invoke release or individual native setters.

Preparation applies and verifies the complete initial invariant:

- maximize before candidate admission;
- use the Proctor-owned titlebar without usable native minimize, maximize, or
  close controls;
- prevent user move, resize, ordinary close, and fullscreen transitions;
- enable platform content protection as a best-effort control;
- return a verified receipt rather than command-dispatch success.

Maximized mode is the initial contract; kiosk and always-on-top are not. Window
controls and close veto coordinate orderly behavior but cannot prevent Task
Manager, Force Quit, process termination, shutdown, or power loss. Such loss is
a Participation Interruption under the identity and exam-security architecture.

Constraint drift becomes a mechanical window observation and triggers fresh
evaluation. A partial or unverifiable required effect keeps posture contained or
failed according to source health.

Local containment leaves CandidateWindow visible behind a secure overlay and
blocks editor mutation, terminal input, browser interaction/navigation,
resource mutation, and submission. Protected working state remains intact.
Only safe correction, retry/checking feedback, accessibility controls, and
permitted help/exit actions remain available. Proctor-owned adapters may gate
CandidateWindow interaction, private clipboard, candidate print commands, and
content protection; they never kill applications, terminate OS sessions, cancel
print jobs, eject storage, or disconnect host networking.

## Strict display invariant

Candidate admission requires:

- exactly one connected physical usable display target;
- exactly one active display surface;
- no mirrored secondary target;
- no virtual or remote display/session target;
- no head-mounted or other specialized target;
- complete topology certainty.

A mirrored or inactive secondary target still violates the single-screen rule.
Electron display events are useful wakeups, but the platform adapter owns the
authoritative snapshot. Windows uses Current Display Configuration path and
target information with relevant virtual and specialized-target awareness.
macOS uses online and active display lists plus mirror relationships because
hardware mirroring can hide a secondary target from the active-display list.

Any display transition during participation causes immediate reversible
containment while a fresh snapshot is taken. Interaction resumes only through
the complete secure-exam recovery gates; the source itself does not block,
flag, or judge the candidate.

## Permissions and private protocols

A separate privileged `NativePermissionBroker` owns disclosed, user-visible OS
permission requests during setup or candidate-initiated preflight. A disabled
capability never prompts; observe denial degrades; enforce denial blocks.
Participation never creates a surprise permission prompt. Permission loss is a
source-state transition and contains when the source is enforced. The broker
may offer one trusted System Settings destination and reinspects only after
explicit candidate retry.

The Windows service and macOS Endpoint Security component are installed and
approved during application setup, never as a surprise exam action. They expose
only a health/version handshake outside an active source session and stop event
subscriptions when collection closes.

Electron main launches one exact packaged security entrypoint without `PATH`
lookup and transfers a private MessagePort using a single-use bootstrap secret.
Startup verifies packaged build identity, exact protocol version, expected
source manifest, participation generation, one-time challenge, and schema
compatibility. Secrets never travel in command-line arguments or environment
variables. Renderers cannot discover or connect to this port.

Every cross-process protocol is fixed, typed, versioned, bounded, and
capability-specific. Unknown messages, stale generations, duplicate handshakes,
oversized payloads, or incompatible versions fail startup closed. A successful
handshake authenticates the expected packaged child relationship; it is not
device or kernel attestation.

Privileged-helper channels additionally enforce OS access controls, peer code-
signature identity, a fresh broker-generated nonce, exact frame limits, and
literal discriminated client and server envelopes. Helper launch uses one
absolute deadline from executable verification through the authenticated
handshake, and every later helper request/response has its own absolute deadline;
the first transport or protocol failure terminally fences the connection and
terminates the child. Exit must be observed before termination succeeds; kill
errors, an unobserved exit at the termination deadline, or a startup verifier
that outlives its deadline poisons the owning utility and rejects further
launches until process replacement. Active source state is bounded to one instance per
negotiated capability, source queue capacity is at least two for explicit gap
accounting, `inventory_overflow` remains distinct from backend failure, and
terminal failures are explicitly discriminated from
observations. They provide no generic execution, filesystem, path-
query, or arbitrary subscription method. The helper receives no installation
credential and cannot authenticate evidence to the server.

## Throughput, failure, and lifecycle

OS callbacks never wait for IPC, storage, networking, or detector work. Every
source has a fixed bounded queue. State refreshes may coalesce while meaningful
transitions preserve source order; health and effect acknowledgements outrank
ordinary observations. Overflow emits an explicit missing range and degrades or
fails the source. Required-source overflow blocks interaction and never becomes
misconduct by itself.

Required source, security-process, port, heartbeat, or constraint loss blocks
affected interaction immediately. Each source or helper may make one bounded
automatic restart for a recoverable failure. Restart creates a new instance and
generation, emits an explicit reset/gap, and repeats permission, policy,
capability, health, and complete snapshot checks. Repeated failure remains
blocked until explicit retry or a new preflight. Failure is operational evidence
and never candidate misconduct.

Coordinator reconciliation carries the authenticated supervisor `restarted`
edge as an exact source, prior instance/sequence watermark, replacement instance,
and the sole `attempt: 1` automatic restart. A second automatic restart, an
unlinked replacement, reuse of any instance identity seen during the current
preflight, or any later message from a retired instance fails closed until
explicit retry or a new preflight. Active findings are fenced onto the replacement
instance and cannot recover until that replacement supplies a healthy,
permission-granted, gap-free complete snapshot.

Normal authoritative departure stops callback intake, fences the generation,
drains already accepted bounded facts, removes OS subscriptions, closes handles
and ports, records terminal health/cleanup, erases raw observations, queues,
detector state and private clipboard state, seals permitted integrity delivery,
and finally releases Proctor-owned constraints. External applications, devices,
network configuration, print jobs, and host clipboard contents remain untouched.
Every step is idempotent and deadline-bound. Inability to prove callback fencing
is a failed cleanup; Electron main may terminate the utility after the bounded
final-drain deadline.

Crash, kill, timeout, or port loss never enters the normal release path.
Electron main preserves blocked containment, fences the participation
generation, and follows recovery or re-entry.

While the server still reports the Attempt active, contained sources continue
observing so a correction can be verified. On suspended, submitted, expired, or
other authoritative departure, CandidateWindow blocks mutation and presents the
transition before secure closure and source cleanup. Relaunch never restores an
old source session; a later successful join creates fresh generations.

## Privacy and diagnostics

Ordinary diagnostics contain only bounded adapter/schema versions,
pseudonymous source-instance identity, lifecycle transitions, health/error
codes, queue utilization, missing ranges, timing aggregates, resets, permission
category, and cleanup classification. Raw observations, process/device/network
identities, OS accounts, Attempt identifiers, policy contents, candidate
content, credentials, detector constants, and integrity evidence stay out of
stdout, stderr, logs, telemetry, generic audit, and renderer state.

Raw facts remain ephemeral inside the privileged boundary. The coordinator
derives minimized occurrences, health/gap transitions, recovery records, and a
preflight capability report. It never uploads clipboard content, screenshots or
camera frames, audio, keystrokes, command lines, arbitrary paths, window or
document names, user/account identifiers, device serials, mount paths, SSIDs,
network addresses, proxy URLs, packets, DNS history, or general system-browser
history.

Electron main canonicalizes permitted evidence batches, binds them to
Institution, User Session, Attempt, policy digest, application release,
capability matrix, source generations, batch sequence, prior acknowledgement,
and idempotency key, then authenticates them with the registered installation
credential. Helpers and the utility never receive that credential. Encrypted
spool records remain until server acknowledgement or server-defined retention
expiry; reconnect may resend but cannot duplicate an occurrence.

Candidate status, live manager state, and detailed review are separate
visibility classes. The board shows safe family-level state. Detailed minimized
identity and occurrence timelines require separately authorized review.

Security-process crash dumps are not uploaded automatically. Explicit support
capture treats them as restricted sensitive material with separate disclosure,
authorization, encryption, retention, and deletion.

## Verification and release support

Verification has four claim levels:

1. environment-neutral state-machine, schema, bounds, sequence, gap, reset,
   cleanup, and forbidden-field tests;
2. target-OS adapter conformance through the same source interface, including
   real permissions, notifications, snapshots, restart, and hot-plug;
3. packaged Electron/utility/helper integration tests covering private protocol,
   peer identity, malformed/oversized input, stale generations, overload,
   containment, cleanup, and renderer isolation;
4. destructive and adversarial certification fixtures on controlled physical
   machines covering rapid process bursts, ETW/event loss, multiple and remote
   sessions, background print retries, storage/MTP reconnects, route churn,
   docking, virtual media devices, permission revocation, sleep/resume, helper
   failure, and rapid media replacement.

Mocks verify coordinator policy behavior but never satisfy a native-platform
claim. Every secure-candidate release carries a signed capability matrix keyed
by OS/version, architecture, packaged build/helper identity, adapter/schema
versions, static target-specific required permissions, each sub-capability's
`enforce`/`observe`/`unavailable` result, known limitations, and verification
result. A failed, skipped, flaky, stale, or absent required target test removes
the claim or blocks release; it never inherits the prior matrix entry.
The matrix uses the same `registry_digest`, `source_schema_digest`, sorted
coverage entries, and optional helper identity as the server contract. The
privileged verifier pins bounded Ed25519 public keys supplied by the release
composition, verifies the exact signed UTF-8 payload, checks its release-manifest
SHA-256 identity, then validates the target, complete coverage set, and running
adapter identities. No network key discovery or unsigned development bypass is
provided. Verifying an unavailable matrix does not qualify a target; preflight
separately requires passed enforcement for every mandatory baseline claim.
Current permission state is inspected separately during the candidate's frozen
preflight selection; denial degrades observe mode or blocks enforce mode and is
never signed into the release matrix.

Physical-device certification is required where virtual CI cannot reproduce the
behavior. Linux source checks cannot establish an initial secure-candidate
target. Exact timing fences are adapter constants derived from this evidence,
not manager-configurable grace periods.

Electron and native build tools, wire encoding, signing mechanics, package
integrity, updater behavior, and source layout follow the accepted
[toolchain architecture](./toolchain.md). They preserve this boundary.
