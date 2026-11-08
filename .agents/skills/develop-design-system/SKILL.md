---
name: develop-design-system
description: Create or review Proctor Desktop design tokens, themes, icons, reusable browser controls, Control Explorer fixtures, visual baselines, or design-system source. Use whenever a shared visual primitive or its verification changes.
---

# Develop the design system

Keep shared presentation behind small Proctor-owned interfaces and prove each
control through the same interface its callers use.

## 1. Load authority and classify the change

Read the [design-system architecture](../../../docs/architecture/design-system.md)
and [`source-code-organization`](../source-code-organization/SKILL.md). Use
[`adapt-vscode`](../adapt-vscode/SKILL.md) before inspecting or transferring any
VS Code material. Use [`develop-accessible-ui`](../develop-accessible-ui/SKILL.md)
for interaction and [`develop-ui-layout`](../develop-ui-layout/SKILL.md) for CSS
or layout changes.

For CandidateWindow and other VS Code-derived presentation, apply the required
[Modern UI and floating panels baseline](../../../docs/architecture/design-system.md#modern-ui-and-floating-panels).
Review token mappings against its composition and state behavior before changing
shared primitives or accepting visual baselines. LaunchWindow and
AuthenticatedWindow use the
[Proctor controls](../../../docs/architecture/design-system.md#proctor-controls), Proctor Light/Dark and Phosphor icons;
add a Proctor icon to the literal list in `build/generators/phosphorIcons.ts`,
regenerate, and name it by meaning in `proctorIcons.ts`.

Classify the work as a foundation value, semantic token, domain/control token,
theme, semantic icon, reusable control, fixture, or verification change. Keep a
one-off visual surface with its contribution unless shared behavior or
interaction complexity earns a reusable interface.

Use [`develop-user-settings`](../develop-user-settings/SKILL.md) when a theme,
zoom, density, motion, font, or other presentation choice becomes a persisted
user preference or candidate projection.

Use [`develop-toolchain`](../develop-toolchain/SKILL.md) when changing the
Control Explorer runner, generated catalogs, baseline infrastructure, or
packaged visual evidence.

This step is complete when one owning module and one public meaning are clear.

## 2. Design the interface

Name tokens in the Proctor dotted namespace and generate their `--prctr-*` CSS
form. Reuse an existing semantic role before adding a narrower token. Let domain
owners define domain meaning. Keep glyph choice behind semantic icon IDs.

For a control, define explicit initial state and dependencies, caller-owned host
behavior, owned DOM, atomic state updates, typed intent events, focus needs, and
disposal. Keep remote access, persistence, authorization, and privileged IPC in
the owning product module. Prefer native elements and composition.

This step is complete when callers and tests need no raw styling, internal DOM,
glyph name, or product authority to use the interface correctly.

## 3. Implement the visual contract

Consume inherited semantic tokens and documented variants. Keep external
placement with the parent and internal geometry with the control. Register
listeners, observers, timers, animation, overlays, cancellation, children, and
DOM with the lifecycle owner immediately. Make disposal idempotent and prevent
late asynchronous output.

Apply themes at the document root and change the resolved set atomically. Keep
theme and icon registrations static and reachable only through Proctor-owned
composition manifests.

This step is complete when the implementation preserves token ownership,
composition, lifecycle, and production exclusion without an escape styling
interface.

## 4. Add explorer evidence

Add or update a deterministic Control Explorer fixture that mounts production
code through its public interface. Declare states, variants, content extremes,
container constraints, themes, density, motion, direction, and disposal. Replace
external behavior only at accepted seams. Keep network, credentials, native
capabilities, and privileged IPC unavailable.

Add interface behavior tests, real-browser interaction, automated accessibility
checks, and the applicable visual matrix. Use targeted manual verification for
new interaction patterns. Treat baseline changes as explicit review decisions.

This step is complete when every new or changed state has the required evidence
and production manifests cannot reach explorer or fixture code.

## 5. Review the system

Search for raw shared values, `--vscode-*`, unowned selectors, arbitrary style
DTOs, duplicate tokens, missing disposal, and undocumented matrix exceptions.
When exhaustive catalogs become useful, generate them from implementation.

The work is complete when architecture, interface, fixture, tests, visual
evidence, accessibility evidence, and packaged composition agree.
