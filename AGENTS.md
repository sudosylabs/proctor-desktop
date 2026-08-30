# Proctor Desktop instructions

## Project overview

Proctor Desktop is the trusted Electron workbench for programming examinations
and proctoring. Every candidate Exam Attempt includes an IDE workspace. The
product remains an examination workbench rather than a general-purpose editor.

The renderer is built with plain TypeScript, DOM APIs, and CSS. React, Vite,
Next.js, JSX, and equivalent application frameworks are outside the accepted
architecture.

Most durable data is remote. An Attempt Workspace is not a local folder, and the
integrated terminal attaches to one PTY in an isolated remote Execution
Environment. Native
observation packages report bounded mechanical facts behind privileged process
boundaries; the exam-security coordinator applies policy and separate adapters
own enforcement.

The accepted workspace separates authoritative server state, the desktop
working overlay, protected local recovery, and remote execution projection. Read
[`docs/architecture/attempt-workspace.md`](docs/architecture/attempt-workspace.md)
before changing workspace resources, file providers, working state, recovery,
reconciliation, or Exam Resource delivery.

The accepted workbench uses LaunchWindow, AuthenticatedWindow, and
CandidateWindow with privileged secure transitions. Read
[`docs/architecture/workbench.md`](docs/architecture/workbench.md) before
changing shell structure, composition, contributions, content items, lifecycle,
or workbench security integration.

The accepted identity and exam-security architecture keeps credentials and
registered installation keys privileged, keeps authentication method choice on
the server-hosted page, requires continuous online participation, and projects
only bounded state and intents to renderers. Read
[`docs/architecture/identity-and-exam-security.md`](docs/architecture/identity-and-exam-security.md)
before changing authentication, admission, secure-exam posture, containment,
participation continuity, re-entry, or integrity-information handling.

The accepted native-capability architecture uses passive observation sources, a
dedicated exam-security utility process, separate main-process enforcement, a
strict single-display candidate window, and packaged Windows/macOS verification.
Read
[`docs/architecture/native-capabilities.md`](docs/architecture/native-capabilities.md)
before changing native observation, permissions, candidate-window enforcement,
security-utility supervision, native IPC, or platform capability tests. Read
[`docs/architecture/native-capability-families.md`](docs/architecture/native-capability-families.md)
before changing process/application or interactive-session policy, clipboard,
printing, removable storage, virtualization, network configuration, camera,
microphone, platform coverage, correction, or minimized native evidence.

The accepted user-settings architecture uses one server-authoritative virtual
`settings.json`, a static Proctor registry, an Account/Settings destination in
AuthenticatedWindow, and a server-frozen Attempt Configuration. Read
[`docs/architecture/user-settings.md`](docs/architecture/user-settings.md)
before changing preferences, effective configuration, settings persistence,
Attempt Configuration, or the Account/Settings destination.

The integrated browser is a first-release Candidate capability with privileged
revision-frozen navigation enforcement and minimized ordered Browser Activity.
Read [`docs/architecture/integrated-browser.md`](docs/architecture/integrated-browser.md)
before changing browser policy, navigation, Electron browser boundaries,
activity collection, protected spooling, or manager access.

The initial terminal exposes one server-authorized remote PTY and keeps
Execution Environment files distinct from Workspace authority. Read
[`docs/architecture/execution-environment.md`](docs/architecture/execution-environment.md)
before changing terminal transport, PTY lifecycle, generation fencing,
Workspace projection synchronization, or terminal presentation.

The accepted UI uses one Proctor-owned design system across every composition.
Read [`docs/architecture/design-system.md`](docs/architecture/design-system.md)
before changing a user-facing surface, token, theme, icon, reusable control,
DOM, CSS, layout, overlay, or visual verification.

The accepted repository controls map every architecture invariant to active or
objectively deferred evidence. Read
[`docs/architecture/repository-enforcement.md`](docs/architecture/repository-enforcement.md)
before changing build checks, policy schemas, generators, dependency admission,
CI, or enforcement exceptions.

The accepted toolchain uses one pinned npm application graph, strict NodeNext
ESM, esbuild, independent runtime checks, capability-first Rust packages,
Electron Forge, and target-native packaged verification. Read
[`docs/architecture/toolchain.md`](docs/architecture/toolchain.md) before
changing dependencies, compilation, generation, tests, packaging, native build,
updates, signing, CI, or release evidence.

## Repository shape

Application source will live under `src/prctr/`. `prctr` is Proctor's namespace;
upstream paths are provenance, not local ownership.

The planned layers are:

- `base` — dependency-free utilities and browser UI primitives;
- `platform` — shared service contracts and runtime adapters;
- `editor` — selected editor machinery independent of product workflows;
- `workbench` — the application shell, services, and contributions;
- `code` — Electron entrypoints and process composition.

Dependencies point from `code` toward `workbench`, `editor`, `platform`, and
`base`, never in the reverse direction. Runtime-specific code uses explicit
`common`, `browser`, `node`, `electron-browser`, `electron-utility`, or
`electron-main` folders.

Use constructor injection for services. Keep concrete adapters in process
composition roots. User-visible capabilities enter through explicit
Proctor-owned contribution manifests; an upstream aggregate entrypoint never
chooses the product for us.

## VS Code relationship

VS Code is evidence, not architecture authority. Proctor uses selective,
Proctor-owned source transplants rather than a downstream fork. Before
evaluating, copying, adapting, behaviorally reimplementing, or updating VS Code
material, use [`adapt-vscode`](.agents/skills/adapt-vscode/SKILL.md). A new
subsystem first requires a boundary grill under `.scratch/`; an admitted cluster
then receives one exact manifest in
[`docs/upstream/vscode-ports/`](docs/upstream/vscode-ports/README.md).

No VS Code source cluster has been admitted. Preserve meaningful architectural
and runtime topology under `src/prctr/`, but keep Proctor interfaces, seams, and
aggregate manifests authoritative.

Preserve applicable licenses and copyright notices. Never depend at runtime on
another local checkout or put absolute checkout paths in tracked files.

## Engineering rules

- Design deep modules with small interfaces and test through those interfaces.
- Register disposables immediately and make ownership explicit.
- Use events to report state changes; use direct calls or services for control
  flow.
- Keep Electron, Node.js, and native handles out of environment-neutral and
  renderer interfaces.
- Keep renderer sandboxing and context isolation enabled. Preload exposes
  capability-specific APIs rather than generic IPC.
- Validate IPC input and authorize privileged operations in the owning process.
- Keep native observation sources passive; policy interpretation belongs to the
  Exam Security Coordinator and effects belong to closed enforcement adapters.
- Localize user-visible text and design keyboard, screen-reader, zoom,
  high-contrast, and reduced-motion behavior with every interactive surface.
- Co-locate CSS with the TypeScript that owns the DOM and keep selectors within
  the owning control or contribution.

## Finding and validating work

Search concepts, follow imports and registrations, then read the closest tests.
Run the smallest check that exercises the changed interface. Broaden validation
when the change crosses layers, processes, build configuration, or security
boundaries.

Before changing files, inspect Git status and preserve unrelated work. Before
handoff, review the diff for stale guidance, missing provenance, secrets,
generated noise, and unrelated changes.

## Agent knowledge

Use [`docs/README.md`](docs/README.md) as the tracked knowledge map. Product
language lives in [`docs/product/`](docs/product/); accepted cross-module rules
live in [`docs/architecture/`](docs/architecture/); unresolved work lives only
under ignored `.scratch/`.

Use these repository skills when their trigger matches:

- [`design-product-ui`](.agents/skills/design-product-ui/SKILL.md) when designing
  or reviewing a user-facing surface, hierarchy, language, feedback, or
  interaction direction.
- [`develop-design-system`](.agents/skills/develop-design-system/SKILL.md) when
  changing tokens, themes, icons, reusable controls, Control Explorer fixtures,
  or visual baselines.
- [`develop-accessible-ui`](.agents/skills/develop-accessible-ui/SKILL.md) when
  changing interaction semantics, keyboard or focus behavior, ARIA,
  announcements, high contrast, zoom, motion, or screen-reader behavior.
- [`develop-ui-layout`](.agents/skills/develop-ui-layout/SKILL.md) when changing
  DOM ownership, CSS, cascade, responsive or resizable layout, overflow,
  overlays, or first-frame presentation.
- [`develop-workbench`](.agents/skills/develop-workbench/SKILL.md) when adding or
  reviewing a shell part, workbench item or pane, resolver, contribution,
  command, menu, keybinding, manifest, window, or secure transition behavior.
- [`develop-attempt-workspace`](.agents/skills/develop-attempt-workspace/SKILL.md)
  when changing workspace identity, hierarchy, content, providers, working
  state, persistence, recovery, caching, reconciliation, or Exam Resource reads.
- [`develop-identity-and-exam-security`](.agents/skills/develop-identity-and-exam-security/SKILL.md)
  when changing readiness, authentication, installation proof, credentials,
  Sessions, Attempt admission/state, secure posture, containment, participation,
  re-entry, or integrity information.
- [`develop-native-capabilities`](.agents/skills/develop-native-capabilities/SKILL.md)
  when changing native observations, source sessions, permissions,
  candidate-window enforcement, security-utility supervision, native IPC, or
  Windows/macOS capability verification.
- [`develop-user-settings`](.agents/skills/develop-user-settings/SKILL.md) when
  changing registered preferences, JSONC settings, effective configuration,
  Account/Settings editing, Attempt Configuration, constraints, migrations,
  conflicts, caches, or projections.
- [`develop-integrated-browser`](.agents/skills/develop-integrated-browser/SKILL.md)
  when changing Candidate browser policy, navigation enforcement, activity,
  spooling, privacy, access, or workbench presentation.
- [`develop-execution-environment`](.agents/skills/develop-execution-environment/SKILL.md)
  when changing remote PTY transport, terminal lifecycle, fencing, Workspace
  projection synchronization, or terminal presentation.
- [`develop-toolchain`](.agents/skills/develop-toolchain/SKILL.md) when changing
  package metadata, dependencies, TypeScript or esbuild configuration,
  generators, tests, Electron packaging, native builds, updates, signing, CI,
  or release provenance.
- [`source-code-organization`](.agents/skills/source-code-organization/SKILL.md)
  when placing or reviewing a module, service, contribution, environment folder,
  entrypoint, or native package.
- [`adapt-vscode`](.agents/skills/adapt-vscode/SKILL.md) when inspecting, copying,
  comparing, admitting, updating, or auditing VS Code-derived material.
- [`maintain-agent-documentation`](.agents/skills/maintain-agent-documentation/SKILL.md)
  when changing `AGENTS.md`, a skill, agent routing, or tracked documentation
  intended to guide agents.

Keep universal, stable rules here. Put deep domain procedure in a triggered
skill. Put unsettled reasoning in `.scratch/`. Code, tests, configuration, and
command help own facts that are cheap to discover.

`AGENTS.md` and `.agents/skills/` are canonical. `.github/copilot-instructions.md`,
`.github/skills`, and `.claude/skills` are aliases, so Copilot, Codex, and Claude
load the same knowledge without maintained copies.
