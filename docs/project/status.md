# Project status

## Accepted foundation

- AuthenticatedWindow uses a movable Primary Side Bar, one central content region,
  and an optional page-owned Secondary Side Bar. The titlebar provides visibility
  controls and the source Customize Layout picker. Its status bar and notification
  center entrypoint are omitted; CandidateWindow retains its separate layout.
  See [workbench layout](../architecture/workbench.md) for ownership, persistence,
  keyboard behavior, and fixed-size regions.

- In-app notifications now have a shared model/service, retained center, toast
  scheduling, prompts, source filtering, progress and accessible reading. The
  [workbench architecture](../architecture/workbench.md) owns composition and
  security behavior; the [design system](../architecture/design-system.md) records
  the remaining manual release evidence.

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
- Institutional affiliations are non-exclusive, including concurrent student
  and teacher affiliations. AuthenticatedWindow presents all server-authorized
  academic, management, administration, and account areas. One candidate has at
  most one unresolved Attempt across all Sittings.
- The Attempt Workspace boundary separates server snapshot, Desktop Working
  Overlay, and protected recovery/cache. The
  initial adapter is pinned to the server's integer-cursor/five-mutation v1.
- User Settings remain one server-authoritative virtual JSONC document edited in
  AuthenticatedWindow. Candidate behavior uses a closed server-validated frozen
  Attempt Configuration.
- The integrated browser is first-release scope with revision-frozen privileged
  navigation and minimized ordered Browser Activity over the candidate network.
- Code execution is deferred. The server removed execution hosts and interactive
  terminals (2026-09-12) because institutions self-host and per-candidate
  environments are too costly, so Desktop removed its remote terminal. A Run
  action with an output panel and no interactive terminal is planned before the
  first release; its backend is undecided. The AI agent is deferred.
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

## Accepted presentation migration

[Modern UI and floating panels](../architecture/design-system.md#modern-ui-and-floating-panels)
are the required UI target. AuthenticatedWindow now uses the admitted
[Modern workbench cluster](../upstream/vscode-ports/modern-workbench.json): inset
navigation and content surfaces, shared canvas, default/compact seams, fixed
section sizing, and a narrow navigation disclosure. Profile, Sessions, and Settings
use the contained layout and inset scrollable content. The compact account
trigger sits in the right titlebar action area before native window controls,
preceded by a sidebar toggle with synchronized icons and device-local restoration.
The native macOS account popup remains outside clipped part surfaces.

Real Chromium verification covers all four color-scheme categories, both densities, exposed/shared
edges, RTL, fixed sidebar sizing, constrained 200%-equivalent dimensions, focus restoration,
and repeated layout. macOS computer-use comparison covers the running Insiders
shell and the native Proctor profile/session surfaces and account popup. Proctor
uses its own semantic colors, fixed product topology and account content; it does
not claim pixel identity with the editor. Windows native chrome/forced-color and
screen-reader release verification remain with the design-system owner.
CandidateWindow's presentation migration remains outstanding; LaunchWindow keeps
its accepted centered composition.

## Desktop implementation state

The repository now contains a source-level Desktop application graph rather than
only architecture and native foundations. Twenty-one Proctor-owned VS Code port
clusters have exact manifests under `docs/upstream/vscode-ports/`: localization,
base-common runtime, performance, Codicons and semantic icons, themes and design
tokens, browser interaction, shared browser controls, context conditions,
commands, instantiation/registry, actions/menus, keybindings, editor core,
workbench kernel, Electron window skeleton, Attempt Workspace core, User Settings,
and integrated browser. Each admitted cluster is pinned to
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
capability separation. LaunchWindow and AuthenticatedWindow now use the admitted
VS Code native-chrome topology: macOS retains native traffic lights, Windows and
Linux use Electron's native Window Controls Overlay, and the renderer owns the
integrated drag region, control inset, theme/zoom synchronization, and fullscreen
spacing. CandidateWindow remains separately frameless and control-free. This is
a development-runtime skeleton; it is not yet a Forge-packaged, signed,
updateable application.

LaunchWindow now implements server selection and split public readiness through
a privileged Desktop Identity Coordinator. The real HTTP adapter consumes system
ping for availability/build/realtime compatibility and discovery for verified
Institution/origin and Desktop Authorization compatibility. Bounded IPC,
revision-fenced projections, cancellation, retry, localized failure states, and
keyboard focus are exercised through unit, browser, and Electron tests. Its
visual surface uses one centered group containing the Proctor lockup, Institution,
and compact sign-in action, with integrated native chrome on a continuous canvas.
Native Launch menus provide editing, zoom, window actions, exit, and bounded
connection diagnostics. A development-only Electron preview mounts the production
renderer with sample readiness data. The separate real-server development entrypoint
connects readiness to hosted authorization, an exact ephemeral callback, native
non-exportable installation signing, DPoP exchange/refresh/logout, encrypted
refresh custody, and a sanitized AuthenticatedWindow account handoff. The identity
owner fences cancellation, ambiguous refresh rotation, and sign-out. Native key
custody is mandatory in development too. macOS native signing, key persistence,
encrypted refresh storage and the actual sandboxed window transition have a
runnable Electron conformance test. The Windows CNG implementation still requires
Windows execution and both platforms require packaged conformance. A running
Institution deployment has not yet been tested. Authenticated settings transport,
exam destinations, realtime continuity and secure Attempt admission remain
separate integrations; completing sign-in does not grant them.

ProductWindowChrome currently has one scoped design-system evidence exception.
The missing evidence is deterministic pixel-baseline comparison for every
supported renderer/platform matrix entry; computed-geometry browser fixtures
and target-native Electron assertions exist, but the repository has no pinned
golden-image capture and approval runner yet. The design-system/toolchain owners
own this gap. Landing that baseline runner, recording reviewed Windows, macOS,
and Linux images, and making comparison a required CI check blocks any claim of
pixel-level visual conformance for this reusable control.

Attempt Workspace includes shared domain services, the server API authority adapter,
OS-wrapped encrypted recovery storage, and real VS Code FileService providers.
Tests cover acknowledged writes, exact retry commands, immutable resource bytes,
relaunch recovery, three-way reconciliation and immediate participation gating.
Reusable preview access uses the same providers and disposable, revocable leases.
A privileged factory assembles these services; CandidateWindow composition and the
complete editor document/working-copy wiring remain subsequent integration work.

User Settings includes the static generated registry, JSONC document/draft and
comment-preserving edits, validation, effective-resolution and
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

The remote terminal and Execution Environment projection were removed to match
the server. The Candidate panel part remains in the workbench kernel without a
contribution. The AI agent remains deferred.

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
Candidate admission composition of the shared server/protected-store foundations,
complete Candidate editor integration, Forge packaging and fuses, signed capability-matrix
generation, packaged Windows/macOS conformance, updates, signing/notarization,
SBOM/provenance publication, distribution, and release evidence. Accepted
source-level behavior must not be reported as packaged production behavior.

## Server integration baseline

The current server already exposes `/api/v1` and realtime contracts for
discovery/authentication, Sessions, candidate Attempts, Participation and
connections, workspaces/resources/submissions, User Settings, and integrity
review. Desktop work should characterize and
pin those existing contracts rather than treating all server protocol design as
future.

The LaunchWindow readiness adapter now uses the existing public
`/api/v1/system/ping` and `/api/v1/discovery` contracts. It does not require a
combined ping response.

The [Desktop/server agreement](../contracts/README.md) is accepted. The server
agent is implementing it, as reported by the user on 2026-09-08. Delivery has not
yet been verified here. The exact DTOs and failure rules are settled; implementation
conformance and activation evidence remain separate.

Existing identity and product integration still requires verification of:

- method-agnostic hosted Desktop Authorization and registered-key/DPoP binding;
- overlapping institutional responsibilities and bounded self-context/activity
  projections;
- ready state, candidate-wide unresolved-Attempt exclusion, and active Session
  lock across every Session-creation path;
- manager aggregate/board invalidation and safe Candidate presentation;
- ready-state sealing and manager-end completion.

The agreed server work and matching Desktop follow-through cover:

- typed native policy and verified artifacts, with lease-based authority and
  suspension-based emergency blocking;
- bounded preflight, atomic Connect/configuration freeze and metadata reservation;
- exact receipts, active gap progression, closure-based replay, finite quotas and
  metadata capacity refusal across rejoining;
- processed-control ordering for successful and failed coverage updates and live
  reset receipts;
- complete browser source lifecycle, committed closure on replacement refusal,
  grouped evidence, all-source settlement and independent manager access/retention;
- oldest-first correction acknowledgement with transactional per-capability gates.

Desktop now decodes the frozen security policy and verifies its scope, canonical
digests, release matrix, authenticated catalogs and preflight challenge. Native
policy has no independent expiry; current Participation authority remains required.
Missing observe-only coverage is explicit and degraded, while absent mandatory or
enforce coverage blocks admission. Frozen configuration retains original build
provenance across compatible patched builds and accepts only packaged catalog IDs.

Production process/application and interactive-session helpers remain source-incomplete.
The macOS source now includes an ES notification feed, kernel-bound peer code
verification, bounded audit inventory and generation-aware reconciliation. A bounded
worker verifies executable identity against exact kernel audit tokens and secured
signing metadata; missing fields remain unavailable. Startup requires natural event
boundaries around inventory and rejects gaps, suppressed notifications or an unproved
deadline. The fixed macOS service/worker entrypoints, authenticated socket bootstrap,
observed-exit acknowledgement, shared Node source owner and explicit main-process
registration are implemented. Unsigned service staging records hashes and actual
permissions; it does not establish installation, exact utility-role authorization,
profile/signature validity or packaged support. The ordinary stdio entrypoint remains
unavailable for privileged sources, and complete macOS interactive-session coverage
remains unavailable. Windows has an ETW event feed, bounded process inventory/reducer,
exact-lifetime account-scope enrichment, a service-owned WTS session source and an
authenticated-context helper bridge. Live client
executable verification, complete process bootstrap, service transport activation and
target verification are still outstanding. Source tests do not
establish entitlement, signing or packaged support.

Initial resolver exclusions are Institution inheritance, accommodations and
exception authoring/revocation, plus selective live native-policy strengthening.
Nonempty Institution allowlists remain unavailable until their catalog owner
exists. These capabilities must not be presented as part of implemented policy
resolution.

Desktop features depending on those areas must expose an unavailable or
compatibility-gated state until their adapters match the verified server contract.

## Approved Desktop delivery tracks

1. **Application/toolchain skeleton** — pinned Electron/esbuild/Forge graph,
   three entrypoints/manifests/preloads, tests, package inventory, fuses, and
   deterministic development/release commands.
2. **Launch and identity** — split public readiness and server selection, hosted browser auth,
   loopback, OS key/credential custody, DPoP authenticated transport, Session
   lifecycle, and AuthenticatedWindow bootstrap.
3. **Authenticated product** — self-context, student exam activity,
   teacher/manager/admin destinations, account, settings, navigation
   invalidation, and authorization-safe empty/restricted states.
4. **Attempt Workspace/editor** — current server adapter, file tree/editor provider, Working
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
8. **Packaging and distribution** — central signed feeds, Institution
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
- The Run capability: backend (local sandbox, opt-in server runner, or both),
  whether Run output is exam evidence, and any server API. Draft reasoning is in
  ignored `.scratch/run-capability/`; it must be settled before the first release.
- Institution choices for independent protected-record and Browser Activity retention
  periods; their fields, access boundaries and retirement semantics are agreed.
- Signing providers, artifact publication details, and support-artifact
  retention.
- Product-level extensibility beyond compile-time contributions.
