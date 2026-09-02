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

The repository now contains a source-level Desktop application graph rather than
only architecture and native foundations. Nineteen Proctor-owned VS Code port
clusters have exact manifests under `docs/upstream/vscode-ports/`: localization,
base-common runtime, performance, Codicons and semantic icons, themes and design
tokens, browser interaction, shared browser controls, context conditions,
commands, instantiation/registry, actions/menus, keybindings, editor core,
workbench kernel, Electron window skeleton, Attempt Workspace core, User Settings,
integrated browser, and remote terminal. Each admitted cluster is pinned to
reviewed upstream blobs, retains applicable license evidence, and is compiled and
tested without a runtime dependency on another checkout.

The base/platform/editor foundation includes the complete admitted utility
closures, generated English localization and settings registries, theme and
presentation services, accessible reusable controls, command/menu/keybinding and
context-condition ownership, and the piece-tree text buffer/search primitives.
Independent Node and real-Chromium suites exercise the transplanted behavior,
while source-graph checks enforce runtime placement, layer direction, manifest
admission, and cycle absence.

The workbench source implements immutable LaunchWindow, AuthenticatedWindow, and
CandidateWindow compositions with explicit contributions, lifecycle phases,
content-item resolution, pane ownership, overlays, responsive sidebar/panel
collapse, keyboard sashes, and localized accessible parts. Capability-specific
sandboxed preloads and Electron-main IPC authorize the bound main frame. The real
Electron window harness verifies the locked renderer preferences and three-window
capability separation. This is a development-runtime skeleton; it is not yet a
Forge-packaged, signed, updateable application.

Attempt Workspace now has canonical URI/path validation, hierarchy and content
models, a provider boundary, mutation scheduling, late-result fencing, retry and
protected-recovery contracts, three-way reconciliation, Exam Resource delivery,
and a Candidate contribution. These are tested client models with injected ports;
production server transport and protected-store adapters are still required.
Likewise, editor core is present, but a complete Candidate editor presentation,
language services, and server-backed Workspace composition have not landed.

User Settings includes the static generated registry, JSONC document/draft and
comment-preserving edits, validation, migrations, effective-resolution and
Attempt Configuration constraints. An Electron-main coordinator owns the
protected cache and server-authoritative revisions, exposes a bounded preload
protocol, and fails unavailable state read-only. AuthenticatedWindow has a real
Account/Settings destination with structured and JSONC views. Production account
transport and protected cache implementations remain composition inputs.

The integrated browser implements strict revision-frozen HTTP(S) policy
validation, institution-bound HTTP exceptions, privileged navigation and
subresource enforcement in a sandboxed `WebContentsView`, popup/permission/
download/DevTools denial, exact policy/gate lifecycle, scoped minimized ordered
Browser Activity, and protected-ledger continuation. Its Candidate pane owns the
native view through a validated zoom-aware bounds, visibility, overlay, focus,
and close protocol; responsive behavior is exercised at 200% zoom in real
Chromium, and enforcement is exercised in real Electron. Server Browser Policy,
activity upload/acknowledgement, and production protected-spool adapters remain
required.

The remote terminal implements the server-authorized one-PTY protocol,
generation/open-epoch fencing, bounded early and live output, sequence/gap and
acknowledgement handling, Workspace projection settlement before readiness,
resize/input/close intents, retryable teardown, Electron IPC, and an accessible
xterm-backed Candidate panel. It still needs the production remote transport and
Workspace projection adapter. The AI agent remains deferred.

Exam security now includes effective-policy and native-selection validation,
reconciliation, minimized evidence, authoritative projection derivation, action
gates, correction acknowledgement, and a fail-closed Candidate contribution.
The renderer subscribes before its initial projection and revision-fences that
snapshot. Electron IPC and composition seams exist, but authoritative server
participation, enforcement adapters, protected evidence delivery, and complete
CandidateWindow startup composition are not yet wired into a production entrypoint.

The native Rust/Node-API/Electron utility foundation remains substantial: the
generated eleven-source manifest, bounded schemas, source-session supervision,
sequence/gap accounting, helper transport and identity verification, Windows/
macOS/Linux observation adapters, permission broker, CandidateWindow enforcer,
private clipboard, print gate, capability-family registry, and signed-matrix
verifier are implemented and tested. Several platform claims deliberately remain
partial or unavailable, including the absent signed Windows ETW/WTS service,
entitled macOS Endpoint Security helper, bounded Linux/macOS printing coverage,
and global external screen-capture observation. No capability matrix is generated
or signed yet, so this is not packaged secure-target conformance.

The executable toolchain has one pinned npm graph, strict NodeNext compiler
projects for every runtime, esbuild harnesses, generators, policy/schema/source/
documentation/provenance checks, focused Node/Rust suites, real sandboxed Chromium
and Electron tests, and target-native CI foundations. Remaining delivery work is
production composition with real server and protected-store ports, complete
Candidate editor integration, Forge packaging and fuses, signed capability-matrix
generation, packaged Windows/macOS conformance, updates, signing/notarization,
SBOM/provenance publication, distribution, and release evidence. Accepted
source-level behavior must not be reported as packaged production behavior.

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
