# Proctor Desktop instructions

## Project overview

Proctor Desktop is the trusted Electron workbench for programming examinations
and proctoring. Every candidate Exam Attempt includes an IDE workspace. The
product remains an examination workbench rather than a general-purpose editor.

The renderer is built with plain TypeScript, DOM APIs, and CSS. React, Vite,
Next.js, JSX, and equivalent application frameworks are outside the accepted
architecture.

Most durable data is remote. An Attempt Workspace is not a local folder. Code
runs only in the server's per-Attempt execution environment: CandidateWindow
presents its terminals and port previews, and no local shell or process is ever
exposed to a renderer. The AI assistant runs on the server at the level the
exam allows. Native
capabilities report bounded mechanical facts inside one native agent that
evaluates server-compiled rules; Electron main applies containment and the
server decides flags and consequences.

The accepted workspace separates authoritative server state, the desktop
working overlay, and protected local recovery. Read
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

The accepted native-capability architecture uses one on-demand unprivileged
native agent spawned by Electron main, Rust protocol types as the wire
authority, a strict single-display candidate window, privileged Windows/macOS
components for full coverage, and real-OS proof of every fact. Read
[`docs/architecture/native-capabilities.md`](docs/architecture/native-capabilities.md)
before changing the native agent, its protocol, readiness, containment,
permissions, candidate-window enforcement, privileged components, the screen
evidence recorder, or platform capability tests. Read
[`docs/architecture/native-capability-families.md`](docs/architecture/native-capability-families.md)
before changing what a capability reports, its platform coverage, or its privacy
limits, and [`docs/architecture/native-rules.md`](docs/architecture/native-rules.md)
before changing rules, their evaluation, or the baseline.

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
`base`, never in the reverse direction. Runtime-specific code in `base`,
`platform`, `editor`, `code`, and `workbench/services` uses explicit `common`,
`browser`, `node`, `electron-browser`, `electron-utility`, or `electron-main`
folders. A Proctor-authored `workbench/contrib/<feature>` is renderer code with
no environment folder; its `common/` holds only DOM-free modules that Node tests
import. Ported VS Code clusters keep their upstream folders.

Identify services with `createDecorator` and inject them through constructors.
Each window has one strict instantiation service; a class that takes services is
created with `createInstance`. Keep concrete adapters in process composition
roots. User-visible capabilities enter through explicit
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

For VS Code UI transfers and reviews, use the required
[Modern UI and floating panels baseline](docs/architecture/design-system.md#modern-ui-and-floating-panels),
including the applicable styles and coordinated layout code. Load that decision
before choosing a UI source revision or treating an existing port as a template.

Admitted VS Code source clusters are listed only in
[`docs/upstream/vscode-ports/`](docs/upstream/vscode-ports/README.md). Preserve
meaningful architectural and runtime topology under `src/prctr/`, but keep
Proctor interfaces, seams, and aggregate manifests authoritative. Narrow
product scope through explicit exclusions; do not replace admitted behavior
with a lower-fidelity substitute.

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
- [`write-workbench-code`](.agents/skills/write-workbench-code/SKILL.md) when
  writing or reviewing renderer TypeScript: views, panes, parts, controls,
  workbench services, contributions, and their DOM, listeners, and lifecycle.
- [`develop-attempt-workspace`](.agents/skills/develop-attempt-workspace/SKILL.md)
  when changing workspace identity, hierarchy, content, providers, working
  state, persistence, recovery, caching, reconciliation, or Exam Resource reads.
- [`develop-identity-and-exam-security`](.agents/skills/develop-identity-and-exam-security/SKILL.md)
  when changing readiness, authentication, installation proof, credentials,
  Sessions, Attempt admission/state, secure posture, containment, participation,
  re-entry, or integrity information.
- [`develop-native-capabilities`](.agents/skills/develop-native-capabilities/SKILL.md)
  when changing native capabilities, rules, the native agent or its protocol,
  permissions, candidate-window enforcement, privileged components, the screen
  recorder, or Windows/macOS capability verification.
- [`develop-user-settings`](.agents/skills/develop-user-settings/SKILL.md) when
  changing registered preferences, JSONC settings, effective configuration,
  Account/Settings editing, Attempt Configuration, constraints,
  conflicts, caches, or projections.
- [`develop-integrated-browser`](.agents/skills/develop-integrated-browser/SKILL.md)
  when changing Candidate browser policy, navigation enforcement, activity,
  spooling, privacy, access, or workbench presentation.
- [`develop-toolchain`](.agents/skills/develop-toolchain/SKILL.md) when changing
  package metadata, dependencies, TypeScript or esbuild configuration,
  generators, tests, Electron packaging, native builds, updates, signing, CI,
  or release provenance.
- [`source-code-organization`](.agents/skills/source-code-organization/SKILL.md)
  when placing or reviewing a module, service, contribution, environment folder,
  entrypoint, or native package.
- [`commit-organization`](.agents/skills/commit-organization/SKILL.md) when
  committing work, splitting a large change, or planning a commit series.
- [`cross-platform-validation`](.agents/skills/cross-platform-validation/SKILL.md)
  when a change behaves differently on Windows, macOS, or Linux, or claims that a
  platform works.
- [`code-review`](.agents/skills/code-review/SKILL.md) when reviewing a branch,
  commit, pull request, or working-tree change.
- [`adapt-vscode`](.agents/skills/adapt-vscode/SKILL.md) when inspecting, copying,
  comparing, admitting, updating, or auditing VS Code-derived material.
- [`maintain-agent-documentation`](.agents/skills/maintain-agent-documentation/SKILL.md)
  when changing `AGENTS.md`, a skill, agent routing, or tracked documentation
  intended to guide agents.

Directory-local guides add rules for one area and defer everything else to this
file: [`src/prctr/AGENTS.md`](src/prctr/AGENTS.md),
[`build/AGENTS.md`](build/AGENTS.md), and [`test/AGENTS.md`](test/AGENTS.md).

Keep universal, stable rules here. Put deep domain procedure in a triggered
skill. Put unsettled reasoning in `.scratch/`. Code, tests, configuration, and
command help own facts that are cheap to discover.

`AGENTS.md` and `.agents/skills/` are canonical. `.github/copilot-instructions.md`,
`.github/skills`, and `.claude/skills` are aliases, so Copilot, Codex, and Claude
load the same knowledge without maintained copies.
