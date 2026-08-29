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
  CandidateWindow, and packaged Windows/macOS conformance.
- One Proctor design system, selective VS Code source admission, one pinned npm/
  NodeNext/esbuild/Forge graph, and invariant-to-assurance mapping govern future
  implementation.

## Desktop implementation state

No user-facing application, Electron renderer or preload, workbench window,
browser, terminal, or VS Code source cluster has landed. Production Electron-
main and utility-process source exists only for the native security baseline.
The native Rust workspace implements the display-topology protocol, bounded
source session/runtime support, generated Rust/TypeScript wire types, macOS,
Windows, and Linux display adapters, and the CandidateWindow state protocol/
source core with bounded utility-local ingress. It also implements the capture/
session protocol and bounded source core, a notification-first Windows WTS
adapter with RemoteFX-aware remote-session classification, and explicit
unavailable macOS/Linux coverage. The transport-neutral Rust supervisor
composes the fixed display, CandidateWindow, and capture/session baseline with
atomic startup rollback, bounded polling and restart, reset-fenced source
replacement, and reverse-order shutdown.

A narrow Node-API adapter exposes that baseline to the dedicated Electron
utility process. Electron main launches the exact entrypoint and transfers one
private MessagePort with fixed build/source identity, challenge, participation-
generation, sequencing, heartbeat, acknowledgement, bounded-backpressure, and
shutdown checks. Process-neutral tests and a real Electron development-runtime
test exercise this bridge. A closed Electron-main CandidateWindow constructor
and enforcer own BrowserWindow listeners, verified platform constraints,
generation fencing, bounded window-state delivery, and authoritative release;
focused interface tests and the real Electron harness exercise that boundary.
An Electron-main permission broker declares the fixed baseline's platform
permission modes, restricts any admitted OS permission request to preflight,
and seals prompting across utility startup and participation until normal
shutdown. Focused tests and the real Electron harness cover that lifecycle,
including fail-closed startup loss. Screen-capture observation, the
`ExamSecurityCoordinator`, policy/evidence transformation, and production
CandidateWindow composition do not yet exist. This is source and
development-runtime evidence, not packaged secure-target conformance.

The executable repository foundation contains package metadata and locks,
pinned Electron and esbuild dependencies, runtime-specific TypeScript checks,
typed policy/checker modules, generators, focused Node/Rust tests, an Electron
security-utility harness, a Linux foundation job, a Rust dependency-audit job,
and macOS/Windows jobs that run both native-source and real Electron utility
tests. The complete application graph, Forge packaging, renderer/browser
harnesses, static window manifests, User Settings registry, Workspace client,
protected stores, integrated browser, terminal client, other native source
families, screen-capture observation, coordinator and production CandidateWindow
security composition, packaging, signing, distribution, and release jobs remain
to be implemented.
Accepted architecture must never be reported as working runtime behavior.

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
6. **Native baseline** — window/display/permission/source-health/capture-session
   facts, utility coordination, closed effects, packaged target conformance, and
   capability matrix.
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
- Process/application, OS-user/session, clipboard, printing, removable-device,
  VM, VPN/network-interface, camera, microphone, and content-capture policy.
- AI agent provider/model/prompt/tool/network/privacy/evidence contract.
- Workspace batch, historical/range-backed reads, server revert/conflict
  resolution, journal mutation keys, and per-entry capability snapshots.
- Isolation requirements for untrusted exam code beyond the current Execution
  Environment boundary.
- Protected-record and Browser Activity retention periods.
- Signing providers, artifact publication details, and support-artifact
  retention.
- Product-level extensibility beyond compile-time contributions.
