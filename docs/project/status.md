# Project status

## Established

- Git uses `main` as the initial branch.
- `AGENTS.md` is the concise, always-loaded project guide.
- Deep agent procedure lives in triggered repository skills.
- Unresolved specifications and grilling live under ignored `.scratch/`.
- Accepted decisions update their owning living topic; the repository does not
  use an ADR directory.
- Planned application source uses the Proctor-owned `src/prctr/` namespace.
- The renderer uses plain TypeScript, DOM APIs, and CSS.
- Proctor is a programming-examination workbench; every candidate Exam Attempt
  includes an IDE workspace and a separate read-only exam-materials destination.
- Attempt data and future terminal execution are remote-first.
- The window composition is accepted: a minimal signed-out launch window creates
  immutable candidate or proctor workbenches after authentication and role
  authorization, while a dedicated authenticated SettingsWindow remains outside
  role workbench composition.
- Candidate and proctor share a small workbench kernel while selecting product
  behavior through separate static contribution manifests.
- Candidate secure-exam readiness is privileged state distinct from
  authentication, authorization, and renderer presentation.
- The identity and exam-security boundary is accepted: privileged credential
  custody, independent admission and authorization, online-only Secure Exam
  Posture, ordered containment, fenced participation, server-controlled
  re-entry, and separated integrity information sit behind Proctor-owned
  interfaces.
- The native-capability boundary is accepted: passive mechanical observation
  sources feed a dedicated exam-security utility process, Electron main owns
  separate closed enforcement, candidate mode requires one constrained
  maximized window and one physical display, and Windows/macOS claims require
  packaged conformance.
- The Attempt Workspace boundary is accepted: stable entry identity and logical
  paths, provider-defined content versions, acknowledged durability, protected
  recovery, a working overlay, cursor reconciliation, and separate read-only
  Exam Resources sit behind Proctor-owned interfaces.
- The VS Code relationship is a selective, Proctor-owned source transplant with
  per-cluster admission, provenance, and re-intake rules.
- One Proctor-owned design system governs product character, accessibility,
  themes, tokens, reusable controls, CSS/layout, and visual verification across
  launch, SettingsWindow, candidate, and proctor surfaces.
- The user-settings boundary is accepted: every authenticated user has one
  server-authoritative virtual `settings.json`, a static Proctor registry and
  dedicated SettingsWindow; candidate mode consumes an Attempt-wide frozen
  baseline under current trusted constraints and exposes no mutation path.
- The toolchain boundary is accepted: one locked npm application graph, strict
  NodeNext ESM, esbuild, deterministic generation, capability-first Rust,
  Electron Forge, packaged target-native verification, protected updates, and
  traceable releases preserve the application and security boundaries.
- Repository enforcement is active: stable invariant IDs map to active or
  objectively deferred assurance controls; typed source, composition, CSS,
  dependency, provenance, generation, and documentation checks share one tested
  kernel; one exact locked foundation job runs the full cheap gate.
- No VS Code source cluster has been admitted.

## Implementation state

No application or native source has landed and no VS Code cluster is admitted.
The executable repository foundation now includes exact Node/npm metadata and
lockfile, typed policy/check/generator modules, focused Node tests, one Linux
foundation CI job, and bounded dependency-update configuration. Electron,
Forge, esbuild, browser/Electron harnesses, native workspaces, packaging, and
release jobs remain absent until a real consumer activates their control.

## Foundation tracks

Instantiate unresolved work as local `.scratch/<effort>/` specifications. The
workbench shape and contribution-composition grill is complete. Its accepted
state lives in [`workbench.md`](../architecture/workbench.md) and its recurring
procedure in
[`develop-workbench`](../../.agents/skills/develop-workbench/SKILL.md).

The VS Code subsystem-adoption and source-maintenance track is complete. Its
accepted policy lives in [`vscode.md`](../upstream/vscode.md), exact admitted
relationships belong to the
[`vscode-ports`](../upstream/vscode-ports/README.md) registry, and recurring
procedure lives in
[`adapt-vscode`](../../.agents/skills/adapt-vscode/SKILL.md).

The design-system track is complete. Its accepted state lives in
[`design-system.md`](../architecture/design-system.md); recurring work is routed
through [`design-product-ui`](../../.agents/skills/design-product-ui/SKILL.md),
[`develop-design-system`](../../.agents/skills/develop-design-system/SKILL.md),
[`develop-accessible-ui`](../../.agents/skills/develop-accessible-ui/SKILL.md),
and [`develop-ui-layout`](../../.agents/skills/develop-ui-layout/SKILL.md).

The Attempt Workspace track is complete. Its accepted state lives in
[`attempt-workspace.md`](../architecture/attempt-workspace.md), and recurring
work is routed through
[`develop-attempt-workspace`](../../.agents/skills/develop-attempt-workspace/SKILL.md).

The identity and exam-security track is complete. Its accepted state lives in
[`identity-and-exam-security.md`](../architecture/identity-and-exam-security.md),
and recurring work is routed through
[`develop-identity-and-exam-security`](../../.agents/skills/develop-identity-and-exam-security/SKILL.md).

The native-capability track is complete. Its accepted state lives in
[`native-capabilities.md`](../architecture/native-capabilities.md), and recurring
work is routed through
[`develop-native-capabilities`](../../.agents/skills/develop-native-capabilities/SKILL.md).

The user-settings track is complete. Its accepted state lives in
[`user-settings.md`](../architecture/user-settings.md), and recurring work is
routed through
[`develop-user-settings`](../../.agents/skills/develop-user-settings/SKILL.md).

The toolchain and release track is complete. Its accepted state lives in
[`toolchain.md`](../architecture/toolchain.md), and recurring work is routed
through [`develop-toolchain`](../../.agents/skills/develop-toolchain/SKILL.md).

The repository-enforcement track is complete. Its accepted state lives in
[`repository-enforcement.md`](../architecture/repository-enforcement.md), its
executable authorities live under `build/`, and recurring changes are routed
through [`develop-toolchain`](../../.agents/skills/develop-toolchain/SKILL.md).

The initial foundation program has no remaining open track.

Each track begins with questions and competing boundaries, not a preferred
implementation. Accepted results are distilled into `AGENTS.md`, a focused
skill, or the owning architecture/product document.

## Later product questions

- Exact supported Windows 11 and macOS version ranges in the first signed
  capability matrix.
- Isolation for untrusted exam code.
- Protected-record retention periods.
- Server protocol and compatibility.
- Product-level extensibility beyond compile-time contributions.
- Signing providers, artifact publication, and support-artifact retention.
