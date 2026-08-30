# Project status

## Accepted foundation

- `AGENTS.md` is the concise always-loaded guide; stable deep procedure lives
  in triggered repository skills and unresolved work stays ignored under
  `.scratch/`.
- Application source uses the Proctor-owned `src/prctr/` namespace and plain
  TypeScript, DOM APIs, and CSS in renderers.
- Proctor is a programming-examination workbench, not a general-purpose editor.
  Every Candidate Exam Attempt includes an IDE Workspace and separate read-only
  Exam Materials.
- The three-window model is accepted: signed-out LaunchWindow, general
  AuthenticatedWindow, and secure active-Attempt CandidateWindow. Account and
  settings are inside AuthenticatedWindow. CandidateWindow is never restored
  directly after relaunch.
- LaunchWindow uses safe public Institution readiness/compatibility and starts a
  method-agnostic server-hosted system-browser authorization flow with state,
  PKCE, an exact loopback callback, and a per-Institution registered Desktop key.
- Authoritative Attempt states are ready, active, suspended, and submitted.
  Only active binds one Desktop Session/Participation generation; reallow
  produces ready and successful secure join produces active.
- A current student is exclusively student, while non-student academic/
  management/administration responsibilities may overlap. One candidate has at
  most one unresolved Attempt across all Sittings.
- The Attempt Workspace boundary separates server snapshot, Desktop Working
  Overlay, protected recovery/cache, and Execution Environment projection. The
  initial adapter is pinned to the server's integer-cursor/five-mutation v1.
- User Settings remain one server-authoritative virtual JSONC document edited in
  AuthenticatedWindow. Candidate behavior uses a closed server-validated frozen
  Attempt Configuration.
- The integrated browser is first-release scope with revision-frozen privileged
  navigation and minimized ordered Browser Activity over the candidate network.
- The initial terminal attaches to one remote PTY and exposes only open/input/
  resize/output/close. The AI agent is deferred.
- Native architecture uses passive sources, a dedicated exam-security utility
  process, main-process enforcement, one physical display, constrained
  CandidateWindow, and packaged Windows/macOS conformance. Its accepted first-
  release families also cover bounded process/application and interactive-
  session state, clipboard, printing, removable storage, virtualization,
  network configuration, and camera/microphone endpoint state. Each sub-
  capability declares enforce, observe, or unavailable; global external screen-
  capture detection is unavailable on the initial targets.
- One Proctor design system, selective VS Code source admission, one pinned npm/
  NodeNext/esbuild/Forge graph, and invariant-to-assurance mapping govern future
  implementation.

## Desktop implementation state

No user-facing application, Electron renderer or preload, workbench window,
browser, terminal, or VS Code source cluster has landed. Production Electron-
main and utility-process source exists only for the native security baseline.
The native Rust workspace implements an eleven-source generated manifest:
display topology, CandidateWindow, capture/session, process/application,
interactive session, clipboard, print spooler, removable storage,
virtualization, network configuration, and media device state. Checked schemas
generate bounded Rust/TypeScript contracts and validators. Shared runtime and
supervisor code provide race-free source sessions, atomic startup rollback,
bounded polling/restart, exact gaps, reset-fenced replacement, and reverse-order
shutdown over an explicit manifest-ordered source selection. A failed wire
conversion immediately returns failed health and a reconciled observation whose
gap accounts for every discarded source sequence; disabled source factories are
not opened. Initial availability probes degrade only ordinary backend discovery
failure; inventory, protocol, queue, and cleanup failures retain their exact
terminal category, and the supervisor rechecks the process fence after every
completed source open. Display adapters exist for macOS, Windows, and Linux; CandidateWindow
has bounded utility-local ingress; capture/session has notification-first
Windows WTS support with RemoteFX-aware classification and explicit unavailable
macOS/Linux coverage. Process/application now has snapshot-only, partial,
identity-unavailable adapters using Windows Toolhelp, macOS declared running
applications, and same-account Linux `/proc` with session scope left `unknown`.
Windows and macOS omit entries when PID-plus-creation/launch generation cannot
be established rather than aliasing a reused PID or transient object address;
full lifecycle enforcement still
requires the absent signed Windows ETW service or approved macOS Endpoint
Security helper. Interactive-session state has partial Windows WTS and Linux
logind snapshots while macOS remains unavailable without its helper. Clipboard
change counters work on Windows/macOS and remain unavailable on generic Linux.
Windows spooler adapters report bounded active scheduler-job counts from a
field-selective owner/status notification refresh; printer/document names are
never requested and transient owner buffers are cleared after relative
classification. Cleanup outside the fixed field/owner bound runs behind the
shared cleanup deadline and poisons the utility for process replacement if
completion cannot be proved. macOS/Linux spooler coverage is explicitly
unavailable until a bounded IPP implementation replaces the unbounded CUPS API.
Storage reports mounted removable media on Windows/macOS and partial Linux
sysfs-marked removable block/base-or-partition mount state with Attempt-keyed
pseudonyms stable across source replacement, with no implemented portable/MTP
claim. Policy selects block storage and portable/MTP separately. Windows/Linux provide
bounded virtualization classification while macOS correctly remains
unavailable. Network adapters report partial tunnel classes plus Windows
adapter-topology, macOS interface-topology, and Linux IPv4 route/interface
generation; only Windows reports system-proxy presence. macOS AVFoundation
reports separate camera/microphone permission, device-input readiness, count,
and documented concurrent use without starting a capture session or retaining
content; Windows reports endpoint presence only, while Linux reports microphone
endpoint presence and leaves camera coverage unavailable until bounded V4L2
capture-capability inspection exists. Authorization/readiness remain unknown on
those partial adapters. The shared media snapshot permission is a conservative
aggregate of only the selected camera/microphone endpoint permissions.
The private bootstrap also freezes non-empty per-source selections for removable
block versus portable/MTP storage and for the five network categories. The Rust
bridge rejects source/category mismatches; platform adapters skip unselected
storage and network queries rather than emitting broader facts.

A narrow Node-API adapter exposes that manifest to the dedicated Electron
utility process. Electron main launches the exact entrypoint and transfers one
private MessagePort with fixed build/source identity, challenge, participation-
generation, sequencing, heartbeat, acknowledgement, bounded-backpressure, and
shutdown checks. Spawn and authenticated ready consume one shared absolute
startup budget. Process-neutral tests and a real Electron development-runtime
test exercise this bridge. A closed Electron-main CandidateWindow constructor
and enforcer own BrowserWindow listeners, verified platform constraints,
generation fencing, bounded window-state delivery, and authoritative release;
focused interface tests and the real Electron harness exercise that boundary.
An Electron-main permission broker declares separate camera and microphone
permission capabilities, restricts any admitted OS permission request to an
explicit preflight action, and seals prompting across utility startup and
participation until normal shutdown. Inspection and the seal are scoped to the
exact selected source/category set, and a differently scoped launch is rejected.
Cancellation epoch-fences in-flight inspection, permission requests, and
sealing before clearing retained scope; normal sealed shutdown releases the
seal and selection together. Utility ready, poll, and stop output is fenced
to that same source subset.
Non-prompting sources report permission as
not required independently from their source coverage. A generated private
helper protocol, Rust binding validator, and helper transport crate now fix
frame, nonce, peer-build, event-class, literal discriminated client/server
envelopes, source-owned observation/failure routing,
bounded active sources, minimum loss-accounting queue capacity, broker-owned
single-use nonce generation, one absolute identity-verification-through-
handshake startup deadline, fixed request/I/O/termination deadlines, terminal
fail-closed transport, exact Windows release digest held non-replaceable across
spawn, live macOS SecCode validation, private inherited-pipe, and normalized-fact
boundaries. Inventory overflow remains a distinct helper failure category.
Unproved verifier completion or helper termination poisons the owning utility,
rejects further helper launches, and requires process replacement. The present helper binary reports the affected
sources unavailable: no Windows ETW/WTS service or entitled macOS Endpoint
Security implementation is packaged or composed yet. A generated family
registry backed by bounded policy schemas,
authoritative per-family modes and per-platform coverage keys, plus signed-
matrix verification that binds packaged component/adapter/helper identity,
static target-specific permission requirements, limitations, and verification
result while leaving current grant state to preflight,
bounded private Attempt clipboard, and closed candidate print-command gate are
also implemented and tested. No matrix is generated or signed yet. External
screen-capture observation remains explicitly unavailable. The
`ExamSecurityCoordinator`, policy/evidence transformation, policy-to-source
selection composition, and production CandidateWindow composition do not yet
exist. This is source and development-runtime evidence, not packaged secure-
target conformance.

The executable repository foundation contains package metadata and locks,
pinned Electron and esbuild dependencies, runtime-specific TypeScript checks,
typed policy/checker modules, generators, focused Node/Rust tests, an Electron
security-utility harness, a Linux foundation job, a Rust dependency-audit job,
and macOS/Windows jobs that run both native-source and real Electron utility
tests. The complete application graph, Forge packaging, renderer/browser
harnesses, static window manifests, User Settings registry, Workspace client,
protected stores, integrated browser, terminal client, enforcement-grade
process/session helpers and remaining full-coverage adapter variants,
coordinator and
production CandidateWindow security composition, packaging, signing,
distribution, and release jobs remain to be implemented. Global external
screen-capture detection is an explicit unavailable claim rather than an
unfinished implementation item. Accepted architecture and source-only
boundaries must never be reported as working packaged behavior.

## Server integration baseline

The current server already has versioned `/api/v1` and realtime contracts for
discovery/authentication, Sessions, candidate Attempts, Participation and
connections, workspaces/resources/submissions, User Settings, integrity review,
and remote execution/terminal transport. Desktop work should characterize and
pin those existing contracts rather than treating all server protocol design as
future.

Coordinated server work is still required for:

- safe public system ping with Desktop/protocol compatibility;
- method-agnostic hosted Desktop Authorization and registered-key/DPoP binding;
- current-student exclusivity and bounded self-context/activity projections;
- ready state, candidate-wide unresolved-Attempt exclusion, and active Session
  lock across every Session-creation path;
- manager aggregate/board invalidation and safe Candidate presentation;
- server validation/freezing of Attempt Configuration;
- revision-frozen Browser Policy, Browser Activity ingestion/acknowledgement,
  and exact manager access;
- canonical effective Exam Security Policy with resolved exceptions, native
  sub-capability/schema requirements, signed capability-matrix compatibility,
  preflight admission binding, emergency strengthening, and anti-rollback;
- minimized native occurrence/health/recovery ingestion with idempotent
  watermarks, coverage heartbeats, safe live manager projection, authorized
  detailed review, and server-defined retention;
- correction acknowledgement and ready-state sealing/manager-end completion;
- agreement repairs where server domain, OpenAPI, and public projections differ.

Desktop features depending on those additions must expose an unavailable or
compatibility-gated state until the versioned contract exists.

## Approved Desktop delivery tracks

1. **Application/toolchain skeleton** — pinned Electron/esbuild/Forge graph,
   three entrypoints/manifests/preloads, tests, package inventory, fuses, and
   deterministic development/release commands.
2. **Launch and identity** — public ping, server selection, hosted browser auth,
   loopback, OS key/credential custody, DPoP authenticated transport, Session
   lifecycle, and AuthenticatedWindow bootstrap.
3. **Authenticated product** — self-context, student exam activity,
   teacher/manager/admin destinations, account, settings, navigation
   invalidation, and authorization-safe empty/restricted states.
4. **Attempt Workspace/editor** — v1 adapter, file tree/editor provider, Working
   Overlay, mutation scheduler, protected recovery/cache, reconciliation,
   conflicts, Exam Resources, and submission readiness.
5. **Candidate identity/security** — admission, Attempt Configuration,
   CandidateWindow lifecycle, active Session/Participation projection, pause,
   suspension handoff, ready join, close/departure, correction, and submission.
6. **Native capabilities** — replace partial process/session observations with
   the signed privileged helper implementations, close per-platform full-
   coverage gaps, then add coordinator integration, production effect wiring,
   packaged target conformance, and capability-matrix generation/signing over
   the implemented schemas, registry, supervision, eleven-source utility
   bridge, helper protocol, private clipboard, print gate, and matrix verifier.
7. **Integrated browser** — frozen policy validation/enforcement, Candidate item,
   minimized activity, protected spool, ordered delivery, and privacy/access
   verification.
8. **Execution Environment** — terminal capability projection, one remote PTY,
   framing/backpressure/fencing, Candidate panel, and Workspace projection
   reconciliation.
9. **Packaging and distribution** — central signed feeds, Institution
   compatibility/build revocation, updater safety, target-native verification,
   signing/notarization, SBOM/provenance, and support artifacts.

Each track begins with the smallest vertical slice whose server dependency is
implemented or explicitly gated. A track is complete only when source, tests,
packaged evidence, architecture, skills, and project status agree.

## Deferred product and release questions

- Exact supported Windows/macOS version ranges until packaged conformance exists.
- Strong platform attestation that the official untampered binary is running.
- Any future audio, camera-frame, screenshot/video, keystroke, packet/DNS, or
  general system-browser-history collection beyond the accepted mechanical
  native facts.
- AI agent provider/model/prompt/tool/network/privacy/evidence contract.
- Workspace batch, historical/range-backed reads, server revert/conflict
  resolution, journal mutation keys, and per-entry capability snapshots.
- Isolation requirements for untrusted exam code beyond the current Execution
  Environment boundary.
- Protected-record and Browser Activity retention periods.
- Signing providers, artifact publication details, and support-artifact
  retention.
- Product-level extensibility beyond compile-time contributions.
