# Native capability architecture

## Scope and security claim

Native capabilities provide bounded mechanical observations and separately
owned enforcement effects for secure candidate participation. They do not prove
that a device is trustworthy, declare cheating, create an Integrity Flag, or
decide an Attempt consequence.

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
claims. The display-topology protocol, source-session/runtime support, and
macOS, Windows, and Linux source adapters are implemented and source-tested.
The CandidateWindow state protocol, bounded source core, and utility-local
post-IPC ingress are also implemented and source-tested. The capture/session
protocol and bounded source core are implemented and source-tested; its Windows
adapter uses notification-first WTS observation and a RemoteFX-aware
current-session fallback, while macOS and Linux report explicit unavailable
coverage. The transport-neutral source-supervision core is implemented and
source-tested for the fixed display, CandidateWindow, and capture/session
baseline, including atomic startup rollback, bounded polling and restart,
reset-fenced source replacement, and reverse-order shutdown. Screen-capture
observation remains unsupported on every adapter. A narrow Node-API bridge now
opens that exact three-source baseline inside a dedicated Electron utility
process. Electron main launches the exact utility entrypoint and transfers one
private MessagePort; the fixed protocol verifies a one-use challenge, build and
source-manifest identity, participation generation, sequence order, heartbeat,
acknowledgement, bounded output pressure, and terminal shutdown. A closed
Electron-main CandidateWindow constructor and enforcer now own BrowserWindow
listeners, apply and verify platform constraints, fence the participation
generation, bound delivered window state, and perform authoritative release.
An Electron-main `NativePermissionBroker` now declares the fixed baseline's
platform permission modes, permits an admitted adapter to inspect or request an
OS permission only during preflight, and seals prompting across security-utility
startup and participation until normal utility shutdown. Focused interface
tests and the real Electron development-runtime test exercise these boundaries;
they do not establish production composition or packaged conformance. The
`ExamSecurityCoordinator`, policy and evidence transformation, production
CandidateWindow composition, other native source families, packaged
verification, and the signed capability matrix remain unimplemented. No
supported secure-candidate target exists yet.

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
- capability-family packages own Windows and macOS mechanical observation
  adapters;
- one attempt-scoped `ExamSecurityCoordinator` in a dedicated utility process
  owns source supervision, normalization, authenticated policy evaluation,
  packaged detectors, posture, integrity delivery, and participation
  continuity;
- Electron main owns process launch, permission prompting, candidate-window
  enforcement, and other main-only effects through closed adapters.

The utility process is a fault boundary, not an automatic least-privilege OS
sandbox. A separate signed helper is justified only by required privilege or
entitlement, native stability, or a materially different risk boundary. The
composition root selects every concrete adapter from packaged code.

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
source owns its instance identity, monotonic sequence, device wall and monotonic
timestamps, bounded mechanical payload, and gap/reset facts. The coordinator
wraps accepted facts with trusted installation, Session, Attempt,
participation-generation, and policy provenance to form a `Native Observation`.

Sources expose health as `starting`, `healthy`, `degraded`, `failed`, or
`stopped` and permission as `not_determined`, `granted`, `denied`, `restricted`,
or `unavailable`.

The first-release required source families cover:

- source supervision and capability health;
- required permission and platform-capability state;
- candidate-window focus, visibility, minimized/maximized state, fullscreen,
  bounds, and close attempts;
- physical, active, mirrored, virtual, remote, and specialized display
  topology;
- reliable screen-capture or remote-session facts where the supported platform
  can establish them;
- privileged process/source continuity and connection state needed to preserve
  the active Participation.

The initial display rule requires exactly one physical usable display and no
mirrored, virtual, remote, or specialized target. CandidateWindow enforcement
also applies best-effort platform content protection without claiming that it
prevents external capture.

Process/application policy, OS session/user-change policy, clipboard access,
printing, removable devices, VM detection, VPN/network-interface restrictions,
camera, microphone, audio or screen content capture, global keystroke logging,
and generic native diagnostics are deferred. Reliable mechanical capture or
remote-session detection is distinct from collecting screen content. Each
deferred family requires a separate product, privacy, permission, false-positive,
evidence, retention, access, and accommodation decision before it can become a
packaged capability.

## Policy and evidence transformation

Sources report mechanical facts only. The coordinator normalizes those facts
and evaluates authenticated policy and accommodations through a private policy
evaluator:

```text
source fact
    → Native Observation
    → Security Signal
    → Detector Finding
    → Integrity Evidence
```

The server remains authoritative for Integrity Flags, review, lifecycle, and
consequences. A packaged local detector may cause immediate reversible
containment, but neither a source nor a detector declares guilt.

The renderer receives only the sanitized `CandidateSecurityProjection`. Raw
source streams, policy internals, detector thresholds, native handles, and
evidence stay privileged. Observation packages expose no control methods and
never become bidirectional native hosts.

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
evaluation. A partial or unverifiable required effect keeps posture blocked.

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
permission requests during setup or preflight. Participation never creates a
surprise permission prompt. Permission loss is a source-state transition and
blocks when the source is required.

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

## Throughput, failure, and lifecycle

OS callbacks never wait for IPC, storage, networking, or detector work. Every
source has a fixed bounded queue. State refreshes may coalesce while meaningful
transitions preserve source order; health and effect acknowledgements outrank
ordinary observations. Overflow emits an explicit missing range and degrades or
fails the source. Required-source overflow blocks interaction and never becomes
misconduct by itself.

Required source, security-process, port, heartbeat, or constraint loss blocks
affected interaction immediately. Restart is bounded and backed off, creates a
new source instance and explicit gap, and repeats permission, policy,
capability, and health checks. Restart never restores `ready` by itself.

Normal authoritative departure denies new source input, records a final
snapshot and terminal sequence, reports remaining gaps, seals the collection
session, finishes permitted integrity delivery, removes OS callbacks, closes
handles and ports, erases queues and in-memory session material, and finally
releases candidate-window constraints. Every step is idempotent and
deadline-bound.

Crash, kill, timeout, or port loss never enters the normal release path.
Electron main preserves blocked containment, fences the participation
generation, and follows recovery or re-entry.

## Privacy and diagnostics

Ordinary diagnostics contain only bounded adapter/schema versions,
pseudonymous source-instance identity, health and error codes, queue depth,
missing ranges, timing aggregates, permission category, and process
exit/crash classification. Raw observations, executable paths, inventories,
candidate content, credentials, policy internals, detector thresholds, and
integrity evidence stay out of stdout, stderr, logs, telemetry, generic audit,
and renderer state.

Security-process crash dumps are not uploaded automatically. Explicit support
capture treats them as restricted sensitive material with separate disclosure,
authorization, encryption, retention, and deletion.

## Verification and release support

Verification has five layers:

1. contract tests cover schema compatibility, snapshot/event ordering,
   sequences, gaps, resets, bounds, and forbidden fields;
2. every adapter passes a shared black-box source conformance suite;
3. packaged Windows and macOS integration tests cover the admitted source
   families: window, permission, display, mirroring, virtual/remote topology,
   capture/remote-session detection where supported, hot-plug, and cleanup;
4. cross-process tests cover handshake attacks, malformed and oversized input,
   stale generations, crash, hang, restart, overload, and renderer isolation;
5. product scenarios cover admission, containment, abnormal loss, re-entry,
   authoritative departure, and sensitive-data absence.

Mocks verify coordinator policy behavior but never satisfy a native-platform
claim. Every secure-candidate release carries a signed capability matrix keyed
by OS/version, architecture, packaged build, adapter versions, required
permissions, observation families, known limitations, and verification result.
Physical-device certification is required where virtual CI cannot reproduce
display, permission, session, or window behavior.

Electron and native build tools, wire encoding, signing mechanics, package
integrity, updater behavior, and source layout follow the accepted
[toolchain architecture](./toolchain.md). They preserve this boundary.
