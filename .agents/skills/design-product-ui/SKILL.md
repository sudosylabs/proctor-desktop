---
name: design-product-ui
description: Design or review Proctor Desktop user-facing surfaces, visual hierarchy, language, feedback, interaction direction, and product character. Use before proposing a new screen, workflow presentation, or substantial visual change.
---

# Design product UI

Turn product meaning into a calm, focused, unambiguous, and trustworthy
experience without letting presentation invent domain authority.

## 1. Load the owning meaning

Read the [design-system architecture](../../../docs/architecture/design-system.md),
the relevant [product model](../../../docs/product/model.md), and the owning
architecture topic. For shell or composition behavior, also use
[`develop-workbench`](../develop-workbench/SKILL.md).

Use the accepted
[Modern UI and floating panels baseline](../../../docs/architecture/design-system.md#modern-ui-and-floating-panels)
for shell composition and VS Code-derived UI. Inspect the relevant source and
running surface through `adapt-vscode` before choosing a different arrangement.

Identify the user, task, authoritative state owner, consequential decisions,
latency and failure states, and what must remain visible. Continue an unresolved
product or security question in `.scratch/` instead of deciding it visually.

This step is complete when every displayed state and action has an accepted
owner outside visual styling.

## 2. Establish hierarchy

Choose the one task or decision that leads. Reduce simultaneous emphasis, group
related information, and reveal secondary detail when it becomes useful. Use
plain, localized language that describes current state and consequence. Let IDE
conventions support the programming task without making the product feel like a
general-purpose editor or obscuring examination state and policy.

This step is complete when a user can identify the current task, system state,
primary action, and consequence without relying on color or icon recognition.

## 3. Design complete states

Describe normal, empty, loading, unavailable, restricted, recoverable failure,
terminal failure, and completion states that the workflow can reach. Separate
authoritative state from pending presentation. Keep integrity evidence distinct
from an accusation or finding.

Select established semantic tokens and interaction patterns. Use
[`develop-design-system`](../develop-design-system/SKILL.md) for a new shared
visual role, [`develop-accessible-ui`](../develop-accessible-ui/SKILL.md) for
interaction behavior, and [`develop-ui-layout`](../develop-ui-layout/SKILL.md)
for DOM or layout mechanics.

This step is complete when success, delay, restriction, recovery, and failure
remain understandable across the bundled palette matrix, all four color-scheme
categories, and reduced motion.

## 4. Review product character

Review the result for calm density, one clear lead, consistent vocabulary,
honest system feedback, restrained polish, and absence of theatrical security
effects. Remove decoration that competes with examination work.

For LaunchWindow, cover submitted-server, ready, maintenance, temporarily
unavailable, incompatible, authenticating, cancelled, and change-server states.
For AuthenticatedWindow, cover overlapping student/teacher responsibilities and
every authorized management/account/settings area without exposing Role names
as UI authority.
For CandidateWindow, cover admission, active, pause overlay, suspension handoff,
ready rejoin, correction, submission, and safe departure.

This step is complete when the design-system character holds across
LaunchWindow, AuthenticatedWindow, and CandidateWindow without creating a
destination-specific visual language.
