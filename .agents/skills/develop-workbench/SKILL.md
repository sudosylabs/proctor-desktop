---
name: develop-workbench
description: Design, implement, or review Proctor Desktop LaunchWindow, AuthenticatedWindow, or CandidateWindow shell parts, destinations, WorkbenchItem/WorkbenchPane types, resolvers, navigation, contributions, commands, menus, keybindings, manifests, lifecycle, restoration, or secure window transitions. Use before changing a workbench mechanism or user-visible contribution under src/prctr.
---

# Develop the workbench

Preserve the three-window product and keep durable domain behavior behind its
owning capability.

## 1. Load authority

Read [workbench architecture](../../../docs/architecture/workbench.md),
[product model](../../../docs/product/model.md), and
[architecture invariants](../../../docs/architecture/invariants.md). Use
[`source-code-organization`](../source-code-organization/SKILL.md) for placement.

Use [`develop-identity-and-exam-security`](../develop-identity-and-exam-security/SKILL.md)
for readiness, auth, bindings, candidate gates, Attempt transitions, or secure
window handoff. Use [`develop-user-settings`](../develop-user-settings/SKILL.md)
for Account/Settings or Attempt Configuration,
[`develop-integrated-browser`](../develop-integrated-browser/SKILL.md) for
browser items, and
[`develop-execution-environment`](../develop-execution-environment/SKILL.md) for
terminal panels. Use [`adapt-vscode`](../adapt-vscode/SKILL.md) before deriving
from VS Code.

For user-visible work, also load the design-system architecture and applicable
product-UI, accessibility, design-system, and layout skills. The step is complete
when every domain state and action has one authority outside shell presentation.

## 2. Choose the window and owner

Place behavior in exactly one window:

- LaunchWindow: signed-out server selection/readiness and start/cancel auth;
- AuthenticatedWindow: student activity, authorized non-student areas, account,
  and settings;
- CandidateWindow: one active secure Attempt only.

Put shared shell mechanics in the kernel, one product capability under
`workbench/contrib/<name>`, cross-feature behavior behind a narrow workbench
service, and window/concrete-adapter selection in `code` composition roots.
Keep credentials, authorization, policy, native facts, and protected data out of
renderers. The step is complete when one module owns the behavior behind one
small interface.

## 3. Preserve the content seam

Use `WorkbenchItem`, `WorkbenchPane`, and a resolver for central content. Items
own identity/presentation/shell capabilities; panes own DOM lifecycle,
cancellable assignment, visibility/layout/focus, safe view state, and disposal.
The resolver acquires the model. Saving, synchronization, browser enforcement,
terminal lifetime, review, and submission remain in owning capabilities.

Use [`develop-attempt-workspace`](../develop-attempt-workspace/SKILL.md) for
files, resources, durability, recovery, or merge UI. The step is complete when
the workbench can host/restore presentation without learning durable semantics.

## 4. Register static interaction

Register Proctor-namespaced commands and project them through actions, menus,
keybindings, or quick input. Validate arguments and recheck the owning
privileged capability at execution. Context keys control visibility, enablement,
and routing only.

Register destination/item types statically. Remote self-context may populate
authorized instances in AuthenticatedWindow but never register code, choose a
module path, or grant an action. The step is complete when executable behavior
is reachable only through literal Proctor manifests.

## 5. Own lifecycle and safe state

Choose the latest viable phase: `Starting`, `Ready`, `Restored`, or
`Eventually`. Keep early blockers on the reviewed allowlist and present
readiness, authentication, Attempt loading, and security as explicit gates.

Declare local state as `device`, `principalComposition`,
`attemptPresentation`, or `windowSession`, with sensitivity/schema/cleanup.
CandidateWindow is never a restorable application entrypoint. The step is
complete when cancellation/disposal are owned and restored state cannot become
authority.

## 6. Preserve secure window transitions

Compose common, authenticated, and candidate allowlists explicitly. Candidate
always includes IDE Workspace and Exam Materials; browser and terminal activate
only from trusted Attempt capability and posture. The AI agent remains absent.

Opening CandidateWindow closes AuthenticatedWindow. Pause keeps CandidateWindow
under a blocking overlay and gates interaction. Suspension gates first, protects
work, shows the overlay, destroys CandidateWindow, then opens
AuthenticatedWindow at the Attempt. Reallow is ready; only successful secure
join opens CandidateWindow. Relaunch begins through normal authentication and
never focuses/restores CandidateWindow directly.

The step is complete when event-before-refetch gating and every create/destroy/
focus transition have one privileged owner and testable order.

## 7. Verify

Test through owning interfaces: item resolution/cancellation, pane lifecycle,
static contribution activation, command authorization, restoration failure,
focus/accessibility, three-window exclusion, pause/suspension/rejoin order, and
cleanup. Review literal imports, preload allowlists, sensitive storage/logging,
mandatory Candidate IDE dependencies, and exclusion of agent/developer code.

The work is complete when implementation, manifests, tests, and workbench
architecture describe the same observable product.
