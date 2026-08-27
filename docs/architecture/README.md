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
  custody, installation proof, Sessions, Attempt state, posture, continuity,
  and integrity data
- [Integrated browser](./integrated-browser.md) — revision-frozen navigation,
  privileged enforcement, Browser Activity, privacy, and delivery
- [Execution Environment](./execution-environment.md) — remote PTY, generation
  fencing, Workspace projection, terminal presentation, and lifecycle
- [Native capabilities](./native-capabilities.md) — passive observation sources,
  candidate-window enforcement, privileged process boundaries, and platform
  verification
- [User settings](./user-settings.md) — registry, JSONC authority, effective
  configuration, Account/Settings persistence, and Attempt Configuration
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
registrations, lifecycle, restoration, or three-window transitions.

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
[`develop-integrated-browser`](../../.agents/skills/develop-integrated-browser/SKILL.md)
when implementing or reviewing Candidate browser policy, navigation
enforcement, Browser Activity, protected delivery, privacy, or access.

Use
[`develop-execution-environment`](../../.agents/skills/develop-execution-environment/SKILL.md)
when implementing or reviewing remote PTY transport, terminal presentation,
generation fencing, or Workspace projection synchronization.

Use
[`develop-native-capabilities`](../../.agents/skills/develop-native-capabilities/SKILL.md)
when implementing or reviewing a native observation source, OS adapter,
permission flow, candidate-window effect, utility-process boundary, native IPC,
or platform-capability test.

Use
[`develop-user-settings`](../../.agents/skills/develop-user-settings/SKILL.md)
when implementing or reviewing settings declarations, effective configuration,
persistence, Account/Settings, or Attempt Configuration.

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
