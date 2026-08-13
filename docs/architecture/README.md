# Architecture

These files contain accepted current-state rules:

- [Overview](./overview.md) — product and process boundaries
- [Module system](./module-system.md) — module and dependency vocabulary
- [Workbench](./workbench.md) — compositions, shell, contributions, content,
  lifecycle, and security integration
- [Design system](./design-system.md) — product character, accessibility,
  themes, tokens, controls, layout, and verification
- [Attempt Workspace](./attempt-workspace.md) — resource identity, provider
  projection, working state, acknowledgements, recovery, and reconciliation
- [Identity and exam security](./identity-and-exam-security.md) — credential
  custody, admission, posture, containment, continuity, and integrity data
- [Native capabilities](./native-capabilities.md) — passive observation sources,
  candidate-window enforcement, privileged process boundaries, and platform
  verification
- [User settings](./user-settings.md) — registry, JSONC authority, effective
  configuration, persistence, SettingsWindow, and candidate baselines
- [Toolchain and release](./toolchain.md) — package graph, compilation,
  generation, verification, native builds, packaging, updates, and provenance
- [Repository enforcement](./repository-enforcement.md) — invariant assurance,
  typed repository checks, policies, generation, CI, and exception rules
- [Invariants](./invariants.md) — rules implementation must preserve

Source placement and contribution rules live in the triggered
[`source-code-organization`](../../.agents/skills/source-code-organization/SKILL.md)
skill so an agent loads them when creating or reviewing source.

Use
[`develop-workbench`](../../.agents/skills/develop-workbench/SKILL.md) when
implementing or reviewing the shell, content seam, contributions, interaction
registrations, lifecycle, restoration, or role composition.

Use
[`develop-attempt-workspace`](../../.agents/skills/develop-attempt-workspace/SKILL.md)
when implementing or reviewing workspace resources, providers, working copies,
durability, recovery, conflicts, or Exam Resource reads.

Use
[`develop-identity-and-exam-security`](../../.agents/skills/develop-identity-and-exam-security/SKILL.md)
when implementing or reviewing authentication, credential custody, admission,
secure-exam posture, containment, connectivity gating, participation, re-entry,
or integrity-information handling.

Use
[`develop-native-capabilities`](../../.agents/skills/develop-native-capabilities/SKILL.md)
when implementing or reviewing a native observation source, OS adapter,
permission flow, candidate-window effect, utility-process boundary, native IPC,
or platform-capability test.

Use
[`develop-user-settings`](../../.agents/skills/develop-user-settings/SKILL.md)
when implementing or reviewing settings declarations, effective configuration,
persistence, candidate baselines, or the SettingsWindow.

Use [`develop-toolchain`](../../.agents/skills/develop-toolchain/SKILL.md) when
implementing or reviewing dependencies, compilation, generation, tests, native
builds, Electron packaging, updates, signing, CI, or release evidence.

Use [`design-product-ui`](../../.agents/skills/design-product-ui/SKILL.md),
[`develop-design-system`](../../.agents/skills/develop-design-system/SKILL.md),
[`develop-accessible-ui`](../../.agents/skills/develop-accessible-ui/SKILL.md),
and [`develop-ui-layout`](../../.agents/skills/develop-ui-layout/SKILL.md) for
their distinct product-design, shared-system, accessibility, and CSS/layout
branches.

VS Code source-adoption policy lives under
[`docs/upstream`](../upstream/vscode.md).
