# Design system

Proctor Desktop uses one Proctor-owned design system across LaunchWindow,
AuthenticatedWindow, and CandidateWindow. The system governs presentation and
interaction; it never authorizes an operation or turns a visual state into
authoritative examination or integrity state.

## Product character

Every surface should be:

- **calm** — low-noise and suitable for sustained, high-pressure work;
- **focused** — the current task or decision clearly leads;
- **unambiguous** — actions, restrictions, connectivity, submission, and state
  never depend on color or inference alone;
- **trustworthy** — authoritative, pending, recoverable, and restricted states
  are represented honestly and predictably.

Consistency and accessibility are system requirements. Delight is restrained,
functional polish that cannot compete with clarity. Proctor adapts useful VS
Code mechanics without inheriting its visual identity.

## Accessibility contract

Target [WCAG 2.2](https://www.w3.org/TR/WCAG22/) Level AA for every supported
window, composition, workflow, and meaningful state. Use the
[WAI-ARIA Authoring Practices](https://www.w3.org/WAI/ARIA/apg/) as interaction
guidance, not as a substitute for conformance or platform testing.

Prefer native HTML semantics. Every interactive surface must provide keyboard
parity, visible focus, predictable focus restoration, localized accessible
names, non-color state communication, zoom resilience, high-contrast behavior,
and reduced-motion behavior. Verify new patterns with automated checks,
keyboard operation, visual review, and screen readers on each supported desktop
platform before claiming conformance.

Do not place `role="application"` on a window or workbench root. Apply it only to
a narrowly scoped widget with demonstrated need and verification. Keep browser
forced-color behavior available by default; any `forced-color-adjust: none`
must be local, justified, and verified.

## Themes and presentation

Proctor owns four resolved themes: light, dark, high-contrast light, and
high-contrast dark. Dark is the initial product default. A follow-system
preference resolves to one of them rather than creating another theme.
Authenticated and Candidate preferences may select
approved presentation options but cannot redefine feedback, examination, or
integrity semantics.

Runtime plugins, examinations, and remote content cannot register tokens,
inject CSS, provide themes, or override the application palette. The initial
architecture has no third-party themes, arbitrary token overrides, file-icon
themes, or product-icon themes.

Each window places its resolved theme on the document root, for example
`data-prctr-theme="dark"`, and inherits the resolved custom properties from
there. Controls consume themes but do not initialize them. Theme replacement is
atomic; a change event exists only for implementation that must recalculate
non-CSS state.

Persist validated selections such as theme preference, density, motion
preference, and zoom, not resolved tokens or injected CSS. Resolve the initial
built-in theme before showing a window, then re-resolve it when operating-system
scheme or accessibility preferences change. Launch and workbench windows share
this contract. A slow bootstrap may show a minimal Proctor loading surface, not
simulated workbench geometry.

## Token model

The token model has three layers:

1. **Foundation scales** are private implementation material: palette,
   typography, spacing, radii, strokes, icon sizes, elevation, and motion.
2. **Semantic tokens** are the normal public interface: surface, text, border,
   focus, interaction, selection, feedback, typography, spacing, shape,
   elevation, icon, and motion roles.
3. **Domain or control tokens** exist only when a real Proctor meaning cannot be
   expressed by the semantic layer. The owning domain defines domain meaning.

Canonical identifiers are lowercase dotted names containing their category and
meaning. CSS names are generated deterministically: `color.text.primary`
becomes `--prctr-color-text-primary`. A token rename is an interface change.
`--vscode-*` names are upstream provenance and never Proctor interfaces.

Token declarations are static and enter through explicit Proctor composition.
A control token represents a stable invariant rather than mirroring every CSS
property. Visual styling cannot become authoritative security state, and a
generic color must not acquire an implied integrity meaning.

Shared color, typography, spacing, shape, icon, elevation, and motion decisions
use tokens. Raw values are valid in foundation definitions and for genuinely
local implementation geometry or CSS behavior, including percentages,
flex/grid factors, transforms, clipping, asset dimensions, calculated
constraints, `0`, `auto`, `none`, `inherit`, and `currentColor`. A recurring or
product-meaningful literal becomes a token. Raw colors are limited to theme
definitions and narrow system-color handling. A control cannot hide a missing
required token behind a raw fallback.

## Foundation scales

Application chrome uses the operating-system UI font. Monospace is reserved for
code, terminals, logs, and data that requires alignment. Examination content
uses controlled content roles and cannot override application chrome.

| Typography role  | Font size / line height |
| ---------------- | ----------------------- |
| `label.small`    | 12px / 16px             |
| `label`          | 13px / 18px             |
| `body`           | 14px / 20px             |
| `content.body`   | 16px / 24px             |
| `heading.small`  | 16px / 22px             |
| `heading.medium` | 20px / 28px             |
| `heading.large`  | 24px / 32px             |

Use weights 400 and 600; weight alone cannot communicate state. Whole-window
zoom is the primary scaling mechanism, and layout must reflow rather than clip.

The private spacing ramp is `0, 2, 4, 6, 8, 12, 16, 20, 24, 32, 40, 48, 64`
pixels. Public CSS consumes semantic spacing roles. Default and compact density
are explicit mappings in the same system. Compact density is locally justified
and cannot reduce keyboard behavior, focus visibility, readability, or minimum
interactive hit areas. Density and zoom are separate concepts.

Radii are `0, 2, 4, 6, 8, 12` pixels plus circle. Strokes are 1px and 2px.
Elevation roles are flat, raised, overlay, and modal. Surface and border contrast
establish elevation before shadows; high-contrast themes use explicit
boundaries. Decorative gradients, glass, and blur are not system defaults.

Motion duration roles are instant 0ms, fast 80ms, normal 140ms, and slow 200ms.
Motion must communicate orientation, continuity, acknowledgement, or progress.
Authoritative state never waits for animation. An operating-system or user
reduced-motion or reduced-transparency request wins over remote content.
Continuous animation requires a static alternative and explicit lifecycle
ownership.

Callers use Proctor semantic icon identifiers rather than glyph names. Codicons
are the preferred initial glyph adapter, subject to exact source, dependency,
and license admission. Proctor-specific concepts use purpose-built glyphs when a
Codicon would mislead. Standard sizes are 12, 16, 20, and 24 pixels; 16px is the
normal control icon. Decorative icons are hidden from accessibility APIs, and
icons never communicate state without text or another perceivable cue.

## CSS and layout

Use the stable cascade order `reset`, `theme`, `base`, `controls`, `workbench`,
`contributions`, and `overrides`. Global CSS is limited to the reset, document
defaults, focus baseline, root theme/motion/density state, and shared overlay
infrastructure. There is no registry that lets arbitrary theming participants
emit global CSS.

Co-locate CSS with the TypeScript module that owns the DOM. Give each control or
contribution one `.prctr-*` root and keep internal selectors below it. A caller
cannot reach into another module's DOM to restyle it. Use documented variants,
ARIA and native pseudo-classes, or owner-scoped `data-*` state instead of generic
state classes. Exclude ID selectors. Reserve `!important` for a documented and
verified compatibility or accessibility exception in the override layer.

Use CSS Grid, Flexbox, intrinsic sizing, and container queries for ordinary
control, pane, and responsive layout. Add an imperative layout module only when
users resize, dock, collapse, or persist workbench regions. Each region declares
meaningful minimum, preferred, and maximum constraints plus an overflow policy.
Layout state is explicit; DOM measurements are inputs rather than durable state.
A resize separator supports pointer and keyboard input, exposes accessible
current/minimum/maximum values, and offers reset behavior.

## Focus and overlays

Keep focus order aligned with DOM order. Use `:focus-visible` with a semantic
focus token, and replace any suppressed outline with an equal or stronger
indicator. A composite widget exposes one tab stop and follows an established
roving-focus or active-descendant pattern. Hidden and inactive surfaces are not
focusable. Shortcuts supplement visible interaction rather than replacing it.

Move focus into a transient surface only when its interaction requires it.
Restore focus on close to a target that is still present, visible, and
authorized. Each window owns one themed overlay host with semantic popover,
menu, tooltip, notification, and dialog layers. Modal surfaces isolate
background interaction; non-modal surfaces do not trap focus. Dismissal is
explicit per surface, and a required or destructive decision cannot disappear
through generic dismissal. Tooltips contain no required interaction.

## Reusable controls

Keep one-off UI with its contribution. Promote a reusable browser control when
independent callers share a behavioral invariant or interaction complexity
deserves one tested interface. Prefer native elements and composition. There is
no mandatory Widget inheritance, custom-element, Web Component, or Shadow DOM
architecture, and a wrapper that only assigns classes is too shallow to
promote.

Every control defines its own small interface. Construction receives a caller-
owned host, explicit initial state, and explicit dependencies. The control owns
and removes the DOM it creates but never owns the host. Expose the root only for
a real layout, focus-association, or observation need; keep internal DOM private.

The caller owns authoritative domain and asynchronous state. The control owns
declared transient interaction state. Apply correlated visible state atomically
and idempotently. Intent events neither authorize operations nor silently mutate
domain state. Disabled, read-only, busy, and unavailable remain distinct. A
control performs no remote access, persistence, authentication, or privileged
IPC.

Controls consume inherited semantic tokens. Callers select documented variants,
sizes, and density rather than passing style DTOs, arbitrary internal classes,
or CSS. The parent owns external placement; the control owns internal geometry.

Register listeners, observers, timers, animation, overlays, cancellation, and
children immediately with their owner. Disposal is idempotent, removes owned
DOM, cancels pending work, and prevents later visible output. It never disposes
the caller's host or injected dependencies. Ownership registered after disposal
must dispose immediately or fail loudly. Asynchronous completion proves current
cancellation or generation ownership before applying a result.

A control interface supplies enough localized information for its accessible
name, description, state, and error association. Rich controls document their
keyboard, focus, and text-alternative behavior. Request centralized
announcements only when DOM and focus cannot convey an important change, and
suppress unchanged or duplicate messages. Reserve accessibility help or an
Accessible View for rich visual interaction that needs a separate textual
representation.

## Control Explorer and verification

The development-only Control Explorer uses plain TypeScript, DOM APIs, and CSS.
A static manifest imports fixtures through literal paths. Each fixture renders
production control code in an isolated same-origin frame using the production
cascade and controlled theme, density, motion, direction, locale, viewport,
time, randomness, and disposal context. Browser fixtures and necessary
Electron-only integration fixtures remain separate.

A fixture mounts through the production interface, declares semantic states and
constraints, returns complete disposal ownership, and uses deterministic inputs.
It may replace external dependencies only at accepted seams. It cannot use
network, credentials, authentication, privileged IPC, or native observation.
Animation is disabled by default; dedicated fixtures cover full and reduced
motion. A diagnostic mode checks accidental stylesheet-order dependence.

Use a risk-based review matrix rather than every Cartesian combination:

- all four themes in the normal state;
- applicable interaction states in light and dark;
- high-contrast focus, boundaries, selection, validation, and feedback;
- every supported semantic variant and density;
- minimum, typical, and constrained containers;
- 100% and 200% zoom, plus intermediate levels where layout changes;
- full and reduced motion for animated behavior;
- short, long, empty, multiline, localized, and relevant RTL content;
- complete keyboard traversal and focus restoration;
- supported forced-color behavior;
- screen readers for new patterns and critical authenticated/Candidate workflows.

Readiness combines semantic and state tests through the interface, real-browser
interaction, automated accessibility checks, deterministic visual comparison,
targeted manual accessibility verification, and only necessary workbench
integration. Critical examination and integrity surfaces receive broader
coverage. The [toolchain architecture](./toolchain.md) pins visual baselines to
supported renderers and platforms; baseline changes require explicit review.

A reusable control and every changed state or variant require a fixture,
interface tests, the applicable matrix, and accessibility behavior. An exception
identifies missing evidence, reason, owner, and blocking follow-up. Production
manifests and packages must prove the explorer, fixtures, test adapters, and
baseline tooling unreachable from production AuthenticatedWindow and
CandidateWindow compositions.

## Knowledge and enforcement

This document owns stable cross-module design-system state. Repository skills
own recurring procedure. Future token definitions, theme records, fixture
manifests, tests, lint rules, and commands own facts discoverable from
implementation; generate exhaustive catalogs rather than duplicating them in
Markdown.

The toolchain architecture chooses the Control Explorer runner and baseline
platform. The repository-enforcement track turns the accepted contracts into
automated checks. This architecture decision does not itself admit a VS Code
source cluster; exact admitted relationships live in the ports registry.
