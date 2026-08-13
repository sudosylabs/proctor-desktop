# Proctor Desktop knowledge map

This map routes maintainers and agents to accepted knowledge. Unsettled design
work stays under ignored `.scratch/` until it has been grilled and approved.

## Product

- [Product brief](./product/brief.md) — purpose, product shape, and confirmed
  non-goals
- [Product model](./product/model.md) — canonical desktop-facing terminology

## Architecture

- [Overview](./architecture/overview.md) — confirmed application and process
  boundaries
- [Module system](./architecture/module-system.md) — deep-module vocabulary and
  dependency rules
- [Workbench](./architecture/workbench.md) — accepted composition, shell,
  contribution, content, lifecycle, and security-integration model
- [Design system](./architecture/design-system.md) — product character,
  accessibility, themes, tokens, controls, layout, and visual verification
- [Attempt Workspace](./architecture/attempt-workspace.md) — remote workspace
  identity, working state, provider projection, durability, recovery, and
  read-only Exam Resources
- [Identity and exam security](./architecture/identity-and-exam-security.md) —
  privileged authentication, admission, posture, containment, participation,
  re-entry, and integrity-information boundaries
- [Native capabilities](./architecture/native-capabilities.md) — passive native
  observation, candidate-window enforcement, process, privacy, failure, and
  platform-verification boundaries
- [User settings](./architecture/user-settings.md) — authoritative JSONC,
  static registry, effective configuration, SettingsWindow, persistence, and
  Attempt-wide candidate baselines
- [Toolchain and release](./architecture/toolchain.md) — package authority,
  compilation, generation, tests, native builds, packaging, updates, CI, and
  release provenance
- [Repository enforcement](./architecture/repository-enforcement.md) — assurance
  controls, typed checks, policies, exceptions, CI, and dependency automation
- [Invariants](./architecture/invariants.md) — accepted rules every future
  implementation preserves
- [Project status](./project/status.md) — current foundation and unresolved
  grilling tracks

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
for authentication, credential custody, role-window binding, admission,
secure-exam policy and posture, containment, connectivity, participation,
re-entry, and integrity information.

Use
[`develop-native-capabilities`](../.agents/skills/develop-native-capabilities/SKILL.md)
for native observation sources, OS adapters, permissions, candidate-window
enforcement, security-utility supervision, native IPC, and platform verification.

Use
[`develop-user-settings`](../.agents/skills/develop-user-settings/SKILL.md) for
registered preferences, JSONC parsing and persistence, effective configuration,
SettingsWindow editing, candidate baselines, constraints, migrations, conflicts,
and caches.

Use [`develop-toolchain`](../.agents/skills/develop-toolchain/SKILL.md) for
dependencies, compilation, generated artifacts, localization, test harnesses,
native build schemas, Electron packaging, updates, signing, CI, and releases.

Use [`design-product-ui`](../.agents/skills/design-product-ui/SKILL.md),
[`develop-design-system`](../.agents/skills/develop-design-system/SKILL.md),
[`develop-accessible-ui`](../.agents/skills/develop-accessible-ui/SKILL.md), and
[`develop-ui-layout`](../.agents/skills/develop-ui-layout/SKILL.md) for their
distinct product-design, shared-system, accessibility, and CSS/layout branches.
