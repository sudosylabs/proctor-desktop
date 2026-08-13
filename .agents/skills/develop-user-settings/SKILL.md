---
name: develop-user-settings
description: Design, implement, or review Proctor Desktop User Settings Document parsing, registry declarations, effective configuration, SettingsWindow editing, candidate baselines, preferences, constraints, migrations, conflicts, caches, schemas, or settings projections. Use before changing any user setting or settings-related interface.
---

# Develop user settings

Keep portable user intent, local presentation state, trusted constraints, and
candidate-safe effective configuration behind distinct Proctor-owned seams.

## 1. Load authority and classify the value

Read the [user-settings architecture](../../../docs/architecture/user-settings.md),
[design-system architecture](../../../docs/architecture/design-system.md), and
[architecture invariants](../../../docs/architecture/invariants.md). Use
[`develop-workbench`](../develop-workbench/SKILL.md) for shell placement or
restoration, [`develop-attempt-workspace`](../develop-attempt-workspace/SKILL.md)
for editor working state or autosave, and
[`develop-identity-and-exam-security`](../develop-identity-and-exam-security/SKILL.md)
for candidate baselines, trusted policy, accessibility containment, or Session
Binding.

Classify the proposed value as portable user preference, device preference,
composition restoration, Attempt presentation, Exam configuration, Exam
Security Policy, or authoritative product state. Keep only the first two in the
settings registry. Use [`adapt-vscode`](../adapt-vscode/SKILL.md) before relying
on a VS Code key or implementation.

This step is complete when one authority, storage scope, composition set, and
candidate treatment are explicit.

## 2. Declare one static setting

Add an immutable typed descriptor through the owning capability and the literal
Proctor settings manifest. Declare identifier, schema/default, bounds and
normalization, portable-user or device storage, domain, composition
applicability, candidate treatment, activation point, language-override support,
fallback, lifecycle, migration, and localized editor metadata.

Choose `eligible`, `policyConstrained`, `nonCandidateOnly`, or `prohibited` for
candidate treatment. Preserve an unknown key without activating it. Diagnose a
known prohibited key without giving it an effective value. Keep secrets,
commands, paths, arbitrary network or execution configuration, injected visual
material, and security controls outside settings.

This step is complete when generated schema, SettingsWindow catalog, rejection
catalog, and registry fingerprint have one declaration owner and the frozen
registry accepts it.

Use [`develop-toolchain`](../develop-toolchain/SKILL.md) when changing the
generator, committed-artifact policy, or clean-regeneration gate.

## 3. Resolve through the deep interface

Select packaged default, then exactly one portable-user or device value, then
an applicable language override. Apply composition constraints, authenticated
Exam and security constraints, platform/accessibility requirements, and
packaged safety invariants in that order.

Return typed immutable effective values. Expose only requested/effective values,
sanitized source categories, and bounded constraint reasons through inspection.
Never let workspace content, restoration, context keys, renderer state, or a
remote schema enter precedence. Never let a setting grant a capability or
authorize an operation.

This step is complete when callers need no parsing, policy object, storage
target, or arbitrary string-key access.

## 4. Preserve candidate freezing

Capture the Candidate Settings Baseline once for the Exam Attempt using the
fenced server document revision, registry/build and composition versions, and
normalized eligible values. Reuse it across renderer restart, Participation
Interruption, and authorized re-entry. Apply stronger current policy, platform,
accessibility, and safety constraints only to the Effective Candidate Settings
Projection.

Keep document source, caches, drafts, mutations, and conflict operations out of
candidate preload. Put safe candidate resize and placement in
`attemptPresentation`; make closed accessibility changes Attempt-scoped. A
remote user edit affects a future Attempt, never the active baseline.

This step is complete when killing and re-entering the application cannot
change candidate behavior by changing settings.

## 5. Edit and persist safely

Use the dedicated authenticated SettingsWindow and one in-memory SettingsDraft
for structured and JSONC views. Validate before explicit save. Commit the whole
bounded source with expected opaque revision and idempotency key. Verify an
ambiguous outcome with that same key.

On conflict, retain base, draft, and latest remote source. Auto-merge only
unambiguous disjoint paths and language entries; preserve comments and surface
same-path, delete/modify, or uncertain-trivia conflicts. Keep unavailable-server
state read-only and do not create an offline queue. Cache only acknowledged
source in protected Principal-bound storage and clean or lock it on binding
replacement.

This step is complete when failure, conflict, cancellation, sign-out, and
unknown completion cannot lose the draft, guess authority, or expose another
Principal's data.

## 6. Place source and presentation

Keep registry, JSONC grammar, migrations, resolution, inspection, schema inputs,
and immutable projections under `src/prctr/platform/settings/common/`. Keep the
privileged UserSettingsCoordinator and protected/network adapters in their
narrow Electron-main environment. Keep the editing contribution under
`src/prctr/workbench/contrib/settings/` and select it only through
`src/prctr/code/electron-browser/settings.main.ts` and the dedicated trusted
window composition root.

Use [`design-product-ui`](../design-product-ui/SKILL.md),
[`develop-accessible-ui`](../develop-accessible-ui/SKILL.md), and
[`develop-ui-layout`](../develop-ui-layout/SKILL.md) for SettingsWindow changes.
Use [`develop-design-system`](../develop-design-system/SKILL.md) for visual
preference or preview behavior.

This step is complete when import direction, process APIs, window binding,
preload surface, and manifest inclusion express the accepted ownership.

## 7. Verify through the interfaces

Test registry/schema/catalog parity, grammar bounds and fuzzing, unknown and
prohibited keys, exact precedence, sanitized inspection, migrations, conditional
writes, idempotent ambiguity handling, conflict merges, cache isolation,
candidate baseline stability, stronger live constraints, and manifest/preload
exclusion.

Exercise the SettingsWindow with keyboard, focus, diagnostics, conflict,
loading/read-only/error states, all four themes, reduced motion, and 200% zoom.
Keep source JSONC, values, conflicts, and cache data out of ordinary diagnostics.

The work is complete when document authority, generated artifacts, effective
values, candidate behavior, persistence, presentation, and tests agree through
the same small role-specific interfaces.
