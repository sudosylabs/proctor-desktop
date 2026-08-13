---
name: develop-workbench
description: Design, implement, or review Proctor Desktop workbench shell parts, WorkbenchItem and WorkbenchPane types, resolvers, navigation, contributions, commands, menus, keybindings, manifests, lifecycle, restoration, or candidate/proctor composition behavior. Use before changing any workbench mechanism or user-visible contribution under src/prctr.
---

# Develop the workbench

Preserve the accepted workbench seams while adding product behavior through an
explicit composition.

## 1. Load authority

Read [`docs/architecture/workbench.md`](../../../docs/architecture/workbench.md),
[`docs/architecture/invariants.md`](../../../docs/architecture/invariants.md),
and the relevant product terms in
[`docs/product/model.md`](../../../docs/product/model.md). Use
[`source-code-organization`](../source-code-organization/SKILL.md) to place the
source.

Use
[`develop-identity-and-exam-security`](../develop-identity-and-exam-security/SKILL.md)
for authentication, role-window binding, candidate gates, security posture,
containment, participation, or re-entry behavior.

Use [`develop-user-settings`](../develop-user-settings/SKILL.md) for the
SettingsWindow, registered preferences, effective configuration, candidate
baseline, or settings-related restoration behavior.

If the change derives from VS Code, also use
[`adapt-vscode`](../adapt-vscode/SKILL.md). For user-visible work, read the
[design-system architecture](../../../docs/architecture/design-system.md) and
use the applicable `design-product-ui`, `develop-design-system`,
`develop-accessible-ui`, and `develop-ui-layout` skills. If the change requires
unsettled product, server-transport, or native-capability rules, continue the
corresponding `.scratch/` grill instead of settling that domain in workbench
code.

The step is complete when every governing accepted rule and every unresolved
dependency of the requested behavior is identified.

## 2. Choose the owner

Classify the behavior before designing its interface:

- Put mechanics required by both role compositions in the shared kernel.
- Put one user-visible product capability in `workbench/contrib/<name>` behind
  one registration entrypoint.
- Put composition selection and concrete adapter selection in a `code`-layer
  process root.
- Put privileged observation, policy, credentials, and authorization outside
  the renderer; project only bounded state and actions into workbench UI.

Prefer one deep owning module over cross-contribution coordination. Introduce a
workbench service only when behavior genuinely spans contributions.

The step is complete when one module owns the state and behavior and its callers
cross one small interface.

## 3. Preserve the content seam

Represent central content with `WorkbenchItem`, `WorkbenchPane`, and a resolver.
Keep the item limited to identity, presentation, shell capabilities, matching,
and presentation changes. Keep the pane limited to DOM lifecycle, cancellable
item assignment, visibility, layout, focus, safe view state, and disposal.

Let the resolver acquire the model. Keep saving, synchronization, content
versions, submission, and terminal lifetime inside the owning capability.
Make superseded resolution cancellable and make failure local to its item.

For a workspace file, Exam Resource, file-tree, durability status, or merge
surface, use
[`develop-attempt-workspace`](../develop-attempt-workspace/SKILL.md) and keep its
working and authoritative state outside `WorkbenchItem` and `WorkbenchPane`.

The step is complete when the workbench can host and restore the item without
learning its durable product semantics.

## 4. Register interaction

Register a Proctor-namespaced command for executable intent. Project that
command through actions, menus, packaged keybindings, or quick input only where
the composition needs it. Validate command arguments and recheck privileged
capability at execution time. Use context keys only for visibility, enablement,
and routing.

Register destination and item types statically. Let authorized remote data
populate instances only. Load optional packaged code through a literal import
reachable from an approved role manifest.

The step is complete when no remote value, restored state, context key, or DOM
state can register code or authorize execution.

## 5. Assign lifecycle and state

Choose the latest viable phase: `Starting`, `Ready`, `Restored`, or
`Eventually`. Add early blocking work only to the reviewed bootstrap allowlist.
Render authentication, connectivity, attempt loading, and secure-exam readiness
as explicit gates.

For local state, declare the `device`, `principalComposition`,
`attemptPresentation`, or `windowSession` scope together with sensitivity,
schema version, and cleanup owner. Store only non-sensitive presentation state.
Restore through minimal references and safe placeholders.

The step is complete when startup failure is contained, cancellation and
disposal are owned, and persisted state cannot become product authority.

## 6. Compose deliberately

Import the registration entrypoint only from a Proctor-owned common or role
manifest. Keep candidate and proctor allowlists explicit. The candidate manifest
always composes the IDE workspace and read-only exam-materials destinations.
Browser, terminal, and agent contributions remain separately packaged and may
activate only from trusted attempt capability and security state.

Keep each window bound to the launch descriptor selected by Electron main. Keep
preload capabilities specific to the window kind. Exclude production developer
surfaces and arbitrary external navigation.

Keep SettingsWindow outside role workbench manifests. Select its editing
contribution through its dedicated literal manifest, bind it to one User and
Session, and exclude it during active candidate participation.

The step is complete when the final import graph expresses the intended product
composition without an upstream aggregate or generic conditional manifest.

## 7. Verify through interfaces

Test observable behavior through the owning interface. Cover item resolution
and cancellation, pane lifecycle, contribution activation, command capability
checks, restoration failure, focus and accessibility, composition exclusion,
and cleanup at the smallest relevant scope.

Review the final diff for layer direction, environment APIs, literal manifest
imports, sensitive storage or diagnostics, mandatory candidate IDE dependencies,
and accidental activation of disallowed browser, terminal, or agent capability.
When upstream material is involved, complete its port-map and license
verification.

The work is complete when implementation, tests, manifests, and the accepted
workbench architecture describe the same observable behavior.
