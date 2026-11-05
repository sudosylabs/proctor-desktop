# Proctor Desktop knowledge map

This map routes maintainers and agents to accepted knowledge. Unsettled design
work stays under ignored `.scratch/` until it has been grilled and approved.

## Product

- [Product brief](./product/brief.md) — purpose, product shape, and confirmed
  non-goals
- [Product model](./product/model.md) — canonical desktop-facing terminology

## Architecture

- [Desktop/server contract](./contracts/README.md) — accepted wire models,
  operations, canonical bytes, delivery budgets, and failure semantics; load
  before implementing adapters or cross-language agreement fixtures

- [Development environment](./project/development.md) — local setup, editor project
  discovery, formatting ownership, verification commands, and optional commit checks

- [Overview](./architecture/overview.md) — confirmed application and process
  boundaries
- [Module system](./architecture/module-system.md) — deep-module vocabulary and
  dependency rules
- [Workbench](./architecture/workbench.md) — accepted composition, shell,
  contribution, content, lifecycle, and security-integration model
- [Design system](./architecture/design-system.md) — required Modern UI and
  floating-panel baseline, product character, accessibility, themes, tokens,
  controls, layout, and visual verification
- [Attempt Workspace](./architecture/attempt-workspace.md) — remote workspace
  identity, working state, provider projection, durability, recovery, and
  read-only Exam Resources
- [Identity and exam security](./architecture/identity-and-exam-security.md) —
  readiness, privileged authentication/installation proof, Sessions, Attempt
  state, posture, participation, re-entry, and integrity boundaries
- [Server API client](./architecture/server-api.md) — generated operation types,
  privileged transport, errors, query observations and contract updates
- [Integrated browser](./architecture/integrated-browser.md) — frozen browser
  policy, privileged navigation, minimized activity, protected delivery, and
  privacy
- [Native capabilities](./architecture/native-capabilities.md) — passive native
  observation, candidate-window enforcement, process, privacy, failure, and
  platform-verification boundaries
- [Native capability families](./architecture/native-capability-families.md) —
  accepted process/session, clipboard, printing, storage, virtualization,
  network, media, platform-coverage, correction, and evidence contracts
- [User settings](./architecture/user-settings.md) — authoritative JSONC,
  static registry, effective configuration, Account/Settings persistence, and
  Attempt Configuration
- [Toolchain and release](./architecture/toolchain.md) — package authority,
  compilation, generation, tests, native builds, packaging, updates, CI, and
  release provenance
- [Repository enforcement](./architecture/repository-enforcement.md) — assurance
  controls, typed checks, policies, exceptions, CI, and dependency automation
- [Invariants](./architecture/invariants.md) — accepted rules every future
  implementation preserves
- [Project status](./project/status.md) — accepted foundation, actual
  implementation state, server dependencies, and delivery tracks

## Upstream

- [VS Code policy](./upstream/vscode.md) — selective source admission,
  maintenance, licensing, and provenance rules
- [VS Code ports registry](./upstream/vscode-ports/README.md) — exact manifests
  for admitted source relationships

## Agent system

- [Issue tracker](./agents/issue-tracker.md) — ignored `.scratch/` specifications
  and tickets
- [Triage labels](./agents/triage-labels.md) — canonical local triage states
- [Domain documentation](./agents/domain.md) — where accepted vocabulary and
  architecture decisions live
- [Root instructions](../AGENTS.md) — always-loaded project guidance and skill
  routing

Repository skills under `.agents/skills/` are the primary home for deep,
triggered agent procedure. Create a domain skill only after its rules are stable
enough to guide real work. GitHub Copilot and Claude paths are aliases to the
same canonical instructions and skills.

Use
[`source-code-organization`](../.agents/skills/source-code-organization/SKILL.md)
for the accepted `src/prctr` placement, layer, environment, service,
contribution, and entrypoint rules.

Use [`develop-workbench`](../.agents/skills/develop-workbench/SKILL.md) for
workbench shell, item, pane, resolver, contribution, interaction, manifest,
lifecycle, restoration, and composition changes.

Use
[`develop-attempt-workspace`](../.agents/skills/develop-attempt-workspace/SKILL.md)
for workspace hierarchy, providers, reads, changes, acknowledgements, working
state, recovery, conflicts, caching, and Exam Resource delivery.

Use
[`develop-identity-and-exam-security`](../.agents/skills/develop-identity-and-exam-security/SKILL.md)
for readiness, authentication, credential/installation-key custody, Sessions,
Attempt admission/state, secure posture, containment, connectivity,
participation, re-entry, and integrity information.

Use
[`develop-integrated-browser`](../.agents/skills/develop-integrated-browser/SKILL.md)
for browser policy, navigation enforcement, Browser Activity, protected
spooling, privacy, access, and Candidate presentation.

Use
[`develop-native-capabilities`](../.agents/skills/develop-native-capabilities/SKILL.md)
for native observation sources, OS adapters, permissions, candidate-window
enforcement, security-utility supervision, native IPC, and platform verification.

Use
[`develop-user-settings`](../.agents/skills/develop-user-settings/SKILL.md) for
registered preferences, JSONC parsing and persistence, effective configuration,
Account/Settings editing, Attempt Configuration, constraints,
conflicts, and caches.

Use [`develop-toolchain`](../.agents/skills/develop-toolchain/SKILL.md) for
dependencies, compilation, generated artifacts, localization, test harnesses,
native build schemas, Electron packaging, updates, signing, CI, and releases.

Use [`design-product-ui`](../.agents/skills/design-product-ui/SKILL.md),
[`develop-design-system`](../.agents/skills/develop-design-system/SKILL.md),
[`develop-accessible-ui`](../.agents/skills/develop-accessible-ui/SKILL.md), and
[`develop-ui-layout`](../.agents/skills/develop-ui-layout/SKILL.md) for their
distinct product-design, shared-system, accessibility, and CSS/layout branches.

Use [`commit-organization`](../.agents/skills/commit-organization/SKILL.md),
[`cross-platform-validation`](../.agents/skills/cross-platform-validation/SKILL.md),
and [`code-review`](../.agents/skills/code-review/SKILL.md) for committing,
platform evidence, and review. Directory-local guides live in
[`src/prctr`](../src/prctr/AGENTS.md), [`build`](../build/AGENTS.md), and
[`test`](../test/AGENTS.md).

Bundled color assets and their source relationship are documented in
[GitHub themes](./upstream/github-themes.md).
