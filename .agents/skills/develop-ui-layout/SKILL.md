---
name: develop-ui-layout
description: Create or review Proctor Desktop DOM ownership, CSS, cascade layers, selectors, responsive layout, resizable regions, overflow, overlays, or first-frame presentation. Use before any UI layout or stylesheet change.
---

# Develop UI layout

Keep DOM and CSS ownership local while using browser layout for ordinary reflow
and imperative machinery only where the workbench interaction requires it.

## 1. Load authority and map ownership

Read the [design-system architecture](../../../docs/architecture/design-system.md)
and [`source-code-organization`](../source-code-organization/SKILL.md). For shell
regions, panes, restoration, or composition behavior, also use
[`develop-workbench`](../develop-workbench/SKILL.md). Use
[`develop-accessible-ui`](../develop-accessible-ui/SKILL.md) for interactive
layout or overlays.

For shell layout and VS Code-derived surfaces, load the required
[Modern UI and floating panels baseline](../../../docs/architecture/design-system.md#modern-ui-and-floating-panels).
Map the coordinated CSS and layout sizing before editing region geometry.

Identify the module that owns each DOM node, stylesheet, external placement,
internal geometry, overflow decision, and persisted layout value.

This step is complete when no selector or measurement crosses an unowned module
interface.

## 2. Place CSS in the cascade

Import CSS from its owning TypeScript module and place it in the accepted
cascade layer. Give the module one `.prctr-*` root. Keep internal selectors
beneath it and express state with documented variants, semantics, native
pseudo-classes, or owner-scoped `data-*` attributes.

Use semantic tokens for shared visual decisions. Promote a repeated or
product-meaningful literal through
[`develop-design-system`](../develop-design-system/SKILL.md). Keep ID selectors
out of product styling and put a necessary `!important` compatibility or
accessibility exception in the override layer with focused evidence.

This step is complete when source order, consumer reach-in, and raw shared values
cannot silently change the module.

## 3. Choose the layout mechanism

Use intrinsic sizing, Grid, Flexbox, and container queries for ordinary layout.
Define meaningful constraints and overflow at the owning region. Add imperative
layout only for user resizing, docking, collapsing, or persistence, with an
explicit state model rather than reconstructed DOM geometry.

Give resize separators pointer and keyboard operation, accessible values, and a
reset path. Keep density separate from zoom and verify reflow at constrained
sizes and 200% zoom.

This step is complete when content reflows without inaccessible clipping and
every persisted value has an accepted scope and owner.

## 4. Compose overlays and first paint

Use the window's themed overlay host and semantic layer. Define modal or
non-modal focus behavior, dismissal, outside interaction, restoration, and
disposal per surface. Keep mandatory and destructive decisions out of generic
dismissal paths.

Apply the validated root theme before the window becomes visible. Keep loading
presentation minimal and let the renderer presentation owner take over
atomically after bootstrap.

This step is complete when overlays and initial presentation stay inside the
window's theme, lifecycle, focus, authorization, and composition.

## 5. Verify ownership and reflow

Exercise content extremes, supported directions, every relevant density,
minimum/typical/constrained containers, all themes, zoom, keyboard resize, focus
restoration, and reduced motion. Add or update the Control Explorer fixture and
tests through the owning interface.

The work is complete when CSS ownership, cascade, layout state, interaction,
visual evidence, and production composition agree.
