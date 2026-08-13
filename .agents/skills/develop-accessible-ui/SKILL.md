---
name: develop-accessible-ui
description: Create or review Proctor Desktop interaction semantics, keyboard behavior, focus, ARIA, announcements, accessible help, high contrast, zoom, reduced motion, or screen-reader behavior. Use for every new interactive pattern and accessibility-affecting UI change.
---

# Develop accessible UI

Treat accessibility as part of the interface and acceptance evidence, targeting
WCAG 2.2 AA across every supported state and desktop platform.

## 1. Recover meaning and semantics

Read the [design-system architecture](../../../docs/architecture/design-system.md)
and the owning product or architecture topic. Enumerate every reachable state,
operation, update, error, and restriction. Choose native HTML semantics first;
use an ARIA pattern only when native semantics cannot express the interaction.

This step is complete when role, name, description, state, relationships, and
error communication are defined for every interactive element.

## 2. Define keyboard and focus

Make every operation keyboard reachable in predictable DOM order. Define Tab,
arrow, Home/End, Enter/Space, Escape, and type-ahead behavior where the chosen
pattern calls for them. Give a composite one tab stop and use an established
roving-focus or active-descendant model.

Specify initial focus, visible `:focus-visible` treatment, containment, and safe
restoration for transient surfaces. Make hidden and inactive content
non-focusable. Keep shortcuts supplementary.

This step is complete when the complete workflow works without pointer input and
focus never becomes hidden, lost, or trapped outside an intentional modal.

## 3. Make change perceivable

Use visible text and ordinary DOM updates before live announcements. Associate
instructions, validation, and errors with their controls. Announce only an
important change that DOM and focus cannot convey, select polite or assertive
priority deliberately, and suppress unchanged or duplicate messages.

Provide accessibility help or an Accessible View only when a rich visual
interaction needs an additional textual representation. Keep integrity and
security language factual rather than accusatory.

This step is complete when state and consequence remain understandable without
color, icon recognition, motion, or spatial inference.

## 4. Honor presentation preferences

Review all four themes, browser forced colors, 100% and 200% zoom, constrained
containers, reduced motion, and reduced transparency. Keep hit areas and focus
usable in every supported density. Localize accessible text and test relevant
content expansion and RTL behavior.

This step is complete when preference changes preserve semantics, operation,
visibility, and layout.

## 5. Verify behavior

Add semantic/state tests and real-browser keyboard interaction. Run automated
accessibility checks, then manually verify keyboard, zoom, high contrast, and
reduced motion. Test new patterns and critical workflows with screen readers on
each supported platform. Record the applicable Control Explorer matrix with
[`develop-design-system`](../develop-design-system/SKILL.md).

Automated checks and screenshots are partial evidence, not a conformance claim.
The work is complete when interface tests, interaction tests, visual evidence,
and required manual verification agree for every changed state.
