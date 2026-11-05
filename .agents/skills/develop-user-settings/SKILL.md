---
name: develop-user-settings
description: Design, implement, or review Proctor Desktop User Settings JSONC, static registry declarations, Account/Settings editing, effective configuration, Attempt Configuration, preferences, constraints, conflicts, caches, schemas, or settings projections. Use before changing any user setting or settings-related interface.
---

# Develop user settings

Keep portable user intent, presentation state, authoritative constraints, and
the frozen Attempt Configuration behind distinct seams.

## 1. Load and classify

Read [user-settings architecture](../../../docs/architecture/user-settings.md),
[design-system architecture](../../../docs/architecture/design-system.md), and
[invariants](../../../docs/architecture/invariants.md). Use
[`develop-workbench`](../develop-workbench/SKILL.md) for Account/Settings
placement, [`develop-attempt-workspace`](../develop-attempt-workspace/SKILL.md)
for working state/autosave, and
[`develop-identity-and-exam-security`](../develop-identity-and-exam-security/SKILL.md)
for Attempt Configuration admission or Session binding.

Classify a value as portable user preference, device preference, composition
restoration, Attempt presentation, Exam configuration, security/browser/
execution policy, or authoritative product state. Only the first two belong in
the settings registry. Use [`adapt-vscode`](../adapt-vscode/SKILL.md) before
adopting a VS Code key/implementation. The step is complete when one authority,
scope, window set, and candidate treatment are explicit.

For Attempt Configuration models, hashes, approved IDs or re-entry, load the
[configuration contract](../../../docs/contracts/attempt-configuration.md).

## 2. Declare one packaged setting

Add one immutable typed declaration through the owning capability and literal
settings manifest. Declare identifier, schema/default, bounds/normalization,
portable/device scope, domain, window applicability, candidate treatment,
activation, language override, fallback, lifecycle, and localized
editor metadata.

Choose `eligible`, `policyConstrained`, `nonCandidateOnly`, or `prohibited`.
Preserve unknown keys without activating them and diagnose prohibited keys.
Keep credentials, paths, commands, executable/network/browser/security policy,
extensions, formatters, file associations, autosave semantics, and injected
visual content outside settings.

The step is complete when schema, Account/Settings catalog, rejection catalog,
and registry fingerprint derive from one owner. Use `develop-toolchain` when
changing generation.

## 3. Resolve through the deep interface

Apply packaged default, one user/device value, applicable language override,
window constraints, authenticated Exam/security constraints, platform/
accessibility requirements, then packaged safety. Return typed immutable values
and bounded provenance. Workspace content, restoration, context keys, renderer
state, and remote schema never enter precedence; settings never grant.

The step is complete when callers need no JSONC parsing, policy object, storage
target, or arbitrary string-key lookup.

## 4. Derive and freeze Attempt Configuration

At initial join derive only the closed candidate-safe subset: theme/high
contrast, bounded zoom/font/line height, reduced motion, screen-reader/
announcement mode, cursor, and approved Candidate command/keybinding IDs. Include
exact manifest SHA-256, registry FNV, build/target and User Settings revision
provenance. Approved keybindings are catalog IDs associated with selected
Candidate-safe command IDs, never raw chords. Preserve pixel line-height units.

Submit it for server validation/freeze on the Attempt. Re-entry applies the
exact stored object, never current User Settings. Hash the complete candidate
object and preserve original provenance; a later verified build may re-enter
when its admitted manifest reproduces that object. Stronger current platform,
accessibility, or safety constraints may narrow only the effective projection.
Candidate preload receives no source/cache/draft/mutation interface.

The step is complete when restart/rejoin cannot change candidate behavior by
editing settings and unknown/unsupported fields cannot silently activate.

## 5. Edit and persist safely

Use the Account/Settings destination in AuthenticatedWindow with one in-memory
draft for structured and JSONC views. Validate before explicit save. Commit the
whole bounded source with expected revision/idempotency key and verify ambiguous
outcomes using the same key.

On conflict retain base/draft/latest. Auto-merge only unambiguous disjoint
properties/language entries while preserving comments; surface same-path,
delete/modify, and trivia ambiguity. Server-unavailable state is read-only with
no offline queue. Cache only acknowledged source in protected Principal-bound
storage.

The step is complete when failure, conflict, cancel, sign-out, and unknown
completion preserve the draft and never guess authority or cross Principals.

## 6. Place and present

Keep registry, JSONC grammar, resolution, inspection, schema inputs,
and immutable projections under `src/prctr/platform/settings/common/`. Keep
coordinator/network/protected-cache adapters in Electron main. Put UI under
`src/prctr/workbench/contrib/settings/` and select it from the authenticated
manifest/`authenticated.main.ts`.

Use product-UI, accessibility, layout, and design-system skills for the page and
preview. The step is complete when imports, process APIs, Session binding,
preload, and manifest express the accepted ownership.

## 7. Verify

Test registry/generated parity, parser bounds/fuzzing, unknown/prohibited keys,
precedence, conditional writes, ambiguity/conflict, cache isolation,
Attempt Configuration closed schema/freeze/rejoin, and Candidate preload
exclusion. Exercise the Account/Settings page for keyboard/focus, loading,
invalid, conflict, unavailable, themes, reduced motion, high contrast, and 200%
zoom. Keep values/source/conflicts out of diagnostics.

The work is complete when authority, artifacts, effective values, candidate
behavior, presentation, and tests agree through the same small interfaces.
