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
functional polish that cannot compete with clarity. CandidateWindow and other
VS Code-derived surfaces use the Modern UI baseline below. LaunchWindow and
AuthenticatedWindow use the Proctor-owned presentation, controls, icons and
states described next, with the same Proctor semantic tokens, themes,
accessibility, and lifecycle contracts.

## Authenticated product presentation

AuthenticatedWindow serves students and institutional staff, including people
who do not use an IDE. It uses a Proctor-owned rail-and-sidebar frame:

- A 76px **area rail** on the window material lists the product areas the
  server makes available (Activity, Exams, Admin) as icon-and-label entries,
  with the account photo or initials at the bottom. The photo opens Account and
  carries the accent ring while Account is open. On macOS the traffic lights sit
  at the top of the rail.
- A **contextual sidebar** (default 232px, resizable from 200 to 320px with a
  keyboard-operable separator, hideable) shows the current area's title and
  pages; in Account it ends with Sign out. Below a 1000px window width it stops
  docking and opens over the content instead.
- One opaque **content surface** reaches the window edges. Its 52px top bar holds
  Show sidebar (only while the sidebar is hidden), back and forward, and one
  search field. There is no status bar, Secondary Side Bar, layout picker or
  titlebar Settings and account control.
- On Windows and Linux a 32px title bar strip with the product name and the
  native caption buttons sits above the frame.

Pages follow the task rather than an editor pane or file tree; a page that
needs detail shows it in its own panel beside its list. IBM Plex Sans and Mono,
the Proctor palette, and status by shape apply. Selection in the rail and
sidebar is a neutral grey with ink text. The purple brand accent is reserved for
the main action and focus.

These product surfaces do not follow the VS Code look; Settings is a Proctor
Account page, not the VS Code Settings editor. CandidateWindow retains the IDE
presentation. Verify desktop previews in the native Electron window; a website
preview is not the visual acceptance surface.

### Page layout

- A page's content is one centred column, at most 760px wide (880px for pages
  built around a table), with 40px side padding. A wide window adds margin, not
  line length.
- A record's page (one user, one class) opens with a trail back to its list,
  then the record's name with initials for a person and a status word beside
  it.
- A table has no card: column labels in the quiet text colour, hairlines
  between rows, people as initials with a name and one detail line, status as a
  word on a tinted pill, and one "⋯" menu per row, always visible in muted grey.
  A bar of search and select filters sits above it, with More filters for the
  rarer ones. A sortable column's header is a button with an arrow and
  `aria-sort`; the pager says "Showing 1–10 of 1,284" on a counted list and
  offers 10, 25 or 50 rows a page, remembered per list in the person's settings.
- Status colour answers "do I need to act?". `StatusBadgeTone` names the meaning
  and the badge picks the colour: red `failure` when something went wrong, amber
  `attention` when it waits on you or lapses soon, green `safeguard` only for a
  protection on the viewer's own account (Verified, Linked, Set, On), and grey
  `neutral` for everything else, work still running included. Purple is for
  actions and selection, never a status. A status is a word, never an icon.
- Sections are grouped lists on `color.background.card`: 10px radius, a
  hairline boundary and no shadow. A row is a small glyph, its title and one
  detail line, then either a status word or one "⋯" actions menu. The current
  session's Sign out is the one inline row button.
- A dialog is a card near the top of the window. Its title is a question, its
  body one sentence on what happens, and its actions Cancel and the verb. Every
  button has an icon except Cancel and Close. Signing out always asks first.
- Fields use `color.border.field` and controls that must be seen to be used use
  `color.border.outline`, both at least 3:1 against cards; the accent stroke of
  a switch that is on and of the selected tab is `color.border.accentLine`.
  Placeholders are the field's text colour at 68%. Descriptions and dialog
  paragraphs use `text-wrap: pretty`, so no line ends on a lone word.
- Decorative flourishes are excluded: no gradient or blob backgrounds, tinted
  icon tiles, pill chips, illustrated empty states, or shadows on static cards.

### States

Every section uses one states pattern:

- after 300 ms without an answer, skeleton rows shaped like the content appear;
  pages never show a spinner, and only a busy button spins;
- at 8 s a "Still waiting for {institution}…" note offers Try again;
- at 15 s the read fails inline in its section with Try again;
- a failed refresh keeps the rows already shown and adds a note;
- an empty section is one plain sentence, plus its action when there is one;
- offline, actions are disabled rather than hidden.

Every read ends with an answer, a failure or the deadline: `PageRead` in
`workbench/browser/authenticated/pages` owns the deadline for every area, and the
observation bridge delivers a failure response rather than dropping an answer. A
refusal shows its sentence without Try again, since trying again cannot change
it.

### Proctor controls

LaunchWindow and AuthenticatedWindow use the Proctor-owned controls in
`src/prctr/base/browser/ui/`:

- `ButtonControl` kinds are `brand`/`primary` for the main action, `secondary`,
  `ghost`, `danger` only for the confirming action of a destructive dialog, and
  `dangerGhost` for a destructive action that opens a confirmation. Sizes are
  small, default and large. A busy ring replaces the button's icon so the label
  stays put.
- `MenuControl` entries carry icons. Destructive entries come last after a
  separator and end in "…".
- `SegmentedControl`, `SwitchControl`, `StepperControl` and `SelectControl` (a
  styled native select) are the form controls.
- `BannerControl` states a lasting page condition. `ToastHost` reports the
  result of an action, bottom right, one at a time, on the window's own theme
  surface; success closes after 5 s and failure stays until dismissed. Tooltips
  are the one inverse surface.
- `PagerControl` sits at the foot of any list that can hold more than ten items
  (a list the server pages shows the rows' range without a total):
  ten a page, Previous and Next, the first, last, current and neighbouring page
  numbers with gaps, and the current page in the accent colour without a fill.
  Without a known total it numbers the pages reached so far. Narrow lists show
  "Page 3 of 25" instead of numbers.
- A Copy button confirms in place: for two seconds it reads Copied with a check
  and keeps its width; no line appears beside it.

Every action, menu item and sidebar entry has an icon. An icon-only button has
an accessible name and a tooltip. `buttonControl.css` is Proctor-owned; no
VS Code port supplies these controls.

## Modern UI and floating panels

VS Code Modern UI is the required presentation target when copying, adapting,
updating, or reviewing VS Code-derived UI, which today serves CandidateWindow.
It is not a target for LaunchWindow or AuthenticatedWindow. Include the applicable Modern UI code
alongside the underlying control implementation and base styles. Preserve its
composition, spacing relationships, typography hierarchy, states, interaction,
and layout behavior; map branding, owner namespaces, and semantic tokens to
Proctor. A token mapping is not permission to redesign the element or simplify
its implementation because Proctor currently has fewer features. Any required
product or security divergence must be explicit and verified under the
[VS Code source policy](../upstream/vscode.md).

Floating panels are the accepted shell composition for IDE workbench regions,
currently CandidateWindow. AuthenticatedWindow uses the rail-and-sidebar frame
described above instead:

- A continuous window background remains visible around inset workbench surfaces.
- Sidebar, content/editor, and applicable panel surfaces have their own background,
  subtle boundary, and rounded outer corners, with consistent inter-region gaps
  and perimeter gutters.
- Connected regions preserve the upstream shared-edge treatment: border ownership,
  adjoining corners, activity-rail alignment, and density-dependent seams.
- Headers, rows, hover/selection areas, and controls use the corresponding internal
  insets. Scrollbars, resize targets, and content clipping remain correctly placed.
- Layout measurements account for margins, borders, minimum sizes, and density
  together with the CSS. Rounded corners alone do not implement this composition.

This is Proctor's product baseline, not an opt-in upstream experiment. Apply it
to the IDE regions admitted by each workbench composition. LaunchWindow keeps its
centered sign-in composition and AuthenticatedWindow its frame; this decision does not add editor/sidebar regions
there or permit detached windows, arbitrary docking, or changes to Candidate
security. Floating panels are surfaces inside the existing window.

For source intake, inspect these upstream entry points at the selected cluster
revision and follow their dependencies and registrations:

- `src/vs/workbench/contrib/modernUI/browser/modernUI.contribution.ts` and its
  applicable `media/` modules;
- `src/vs/workbench/browser/media/floatingPanels.css`,
  `src/vs/workbench/browser/layout.ts`,
  `src/vs/workbench/browser/parts/paneCompositePart.ts`, and
  `src/vs/workbench/services/layout/browser/layoutService.ts`;
- the relevant workbench parts and Agents window composition under
  `src/vs/sessions/browser/` where behavior differs by composition.

A revision predating the applicable Modern UI implementation is insufficient
visual evidence. Complete cluster intake at a suitable exact revision rather
than combining unrecorded styles from another version. Existing ports must be
checked against this target when their UI is changed; their current appearance
is not authority for a new design. Non-visual source retains its own admission
boundary and does not acquire UI dependencies.

Verify the composed result against the upstream Modern UI at the recorded
revision, using the Control Explorer matrix below and computer-use inspection
of both applications. Cover default/compact density, exposed/shared edges,
resizing, zoom, clipping, native window controls, menus, focus, all themes, and
reduced motion/transparency. Record intentional differences. Source transfer
and migration remain subject to exact manifests; this accepted design does not
claim that floating panels have already been implemented.

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

LaunchWindow and AuthenticatedWindow use Proctor Light and Proctor Dark
(`resources/themes/proctor`). The `window.theme` setting (`system`, `light` or
`dark`; default `system`) picks one; System follows the operating system. High
contrast shows the GitHub high-contrast theme of the scheme on screen.
LaunchWindow opens before sign-in and uses the scheme last chosen on this
computer, which the [user-settings architecture](./user-settings.md#theme-settings)
describes.

Proctor also bundles the GitHub VS Code theme collection for CandidateWindow.
`workbench.colorTheme` is the **editor theme**; GitHub Dark Default is its
default, and it applies only to CandidateWindow. Theme names and JSON assets
belong to the packaged catalog; light, dark, high-contrast light and
high-contrast dark remain scheme categories, not a fixed list of four palettes.
The four scheme identifiers used by Attempt Configuration resolve through
catalog aliases.

`workbench.colorCustomizations` overrides preserve VS Code global,
theme-scoped, wildcard and `default` semantics; the Settings page has no
control for them. Packaged color registrations own names, descriptions, scheme
defaults and derived-color relationships. User input supplies bounded
hexadecimal colors or the default sentinel; it never registers a role, executes
code, loads an extension or supplies CSS.

The color engine preserves VS Code identifiers in theme data and settings.
Packaged theming participants use the upstream registry and pure CSS collector; the browser owner installs and disposes a constructed stylesheet. Participant code is static product source, never user-supplied CSS. Admitted Modern UI styles also consume the complete pinned size registry through the same collector, preserving typography, spacing, radius, and stroke roles under the Proctor CSS namespace. The existing presentation tokens continue to serve Proctor-owned controls. Proctor retains its system forced-colors rules; no extension environment or user-provided CSS enters this path.

Renderer CSS uses the namespaced `--prctr-theme-<color-id>` projection, with dots
replaced by hyphens. Controls consume their actual roles, including Modern UI
surface colors, rather than collapsing distinct surfaces into a shared palette.
The Proctor semantic aliases remain the interface for
product-specific feedback and non-color presentation. The `color.brand.*` roles
carry the one Proctor accent through every bundled theme; they are reserved for
the primary action, links, progress, and the product mark, and are registered
with light, dark, and high-contrast defaults. Native window controls
receive a closed, validated foreground/background projection. Native menus
retain operating-system material and selection rendering.

Proctor Light and Proctor Dark carry the warm neutral palette of the accepted
LaunchWindow design. They include the GitHub Light Default and Dark Default
themes for every role they do not set, including syntax colors. The chosen
scheme also sets the native scheme so the window material matches.
CandidateWindow keeps its Attempt Configuration scheme.
Roles VS Code has no color for (tertiary text, pending glyphs, the disabled
primary fill and the development-server stripes) are registered as `proctor.*`
colors and exposed as semantic tokens. `color.background.card` is the surface
of grouped lists (white in light, a lifted grey in dark), and
`color.border.control` is the boundary of buttons and fields.

Status glyphs are Proctor-owned SVG shapes on a 16-unit grid, distinct by shape
as well as color: success is a check in a circle, error a filled circle with a
cut-out cross, warning an exclamation in a circle, loading an arc on a quiet
track, pending a dashed circle and skipped a dash.

LaunchWindow and AuthenticatedWindow show the system's window material behind
their pages: Liquid Glass
on macOS 26 and later, `sidebar` vibrancy when glass cannot attach or on earlier
macOS, and Mica on Windows 11 22H2 and later. Reduce Transparency and Increase
Contrast make the window opaque in the theme's canvas color. Electron main owns
the material and reports it through the window chrome channel. The page marks
the document root with `data-window-material` and becomes transparent only
while a material is active; fields, panels and buttons stay opaque. In
AuthenticatedWindow the rail, sidebar and title bar strip show the material and
the content surface stays opaque; without a material they use the opaque
`color.frame.background`. AuthenticatedWindow stays resizable and maximizable.

Custom color overrides apply to AuthenticatedWindow. The current server Attempt
Configuration carries only four scheme identifiers: Candidate freezes that
scheme and uses its packaged default palette, with no live user color overrides.
Supporting a particular named palette or custom overrides in Candidate requires
an explicit versioned server configuration contract. Editor syntax/semantic
styles and file/product icon themes are separate capability admissions.

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

Application chrome uses IBM Plex Sans, bundled with the application so every
window renders the same face offline and matches the Proctor wordmark. IBM Plex
Mono is reserved for code, terminals, logs, server addresses, and data that
requires alignment. Both fall back to the operating-system stacks. Examination
content uses controlled content roles and cannot override application chrome.

| Typography role  | Font size / line height |
| ---------------- | ----------------------- |
| `label.small`    | 12px / 16px             |
| `label`          | 13px / 18px             |
| `body`           | 14px / 20px             |
| `content.body`   | 16px / 24px             |
| `heading.small`  | 16px / 22px             |
| `heading.medium` | 20px / 28px             |
| `heading.large`  | 24px / 32px             |

Use weights 400, 500 (medium, for quiet emphasis on labels and names) and 600; weight alone cannot communicate state. Whole-window
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

Callers use icon identifiers named by meaning rather than glyph names.
LaunchWindow and AuthenticatedWindow use Proctor icons from Phosphor
(`@phosphor-icons/core`, MIT): `build/generators/phosphorIcons.ts` copies a
literal list into `src/prctr/platform/theme/common/proctorIconGlyphs.generated.ts`,
`proctorIcons.ts` names them by meaning, and `createProctorIcon` or
`proctorIconFactory` in `platform/theme/browser/proctorIcon.ts` draws them.
Use the regular weight; the fill weight marks only the selected place in the
rail and sidebar. CandidateWindow keeps Codicons through semantic icons.
Standard sizes are 12, 16, 20, and 24 pixels; 16px is the normal control icon. Decorative icons are hidden from accessibility APIs, and
icons never communicate state without text or another perceivable cue.

## CSS and layout

Use the stable cascade order `reset`, `theme`, `base`, `controls`, `workbench`,
`contributions`, and `overrides`. Global CSS is limited to the reset, document
defaults, focus baseline, root theme/motion/density state, and shared overlay
infrastructure. Only packaged component owners may provide theme styling. User settings cannot
register participants or emit CSS.

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

- all four scheme categories and every bundled palette in the normal state;
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

## Notification verification boundary

Notifications retain the upstream center/header/action-bar and notification row
hierarchy, base notification CSS, and Modern UI notification/typography rules.
Adaptations map the owner namespace and Proctor tokens, with shell insets supplied
by the window. Row details precede the main row for keyboard access; the original
progress bar retains delayed display and long-running animation throttling.
Menus and plain-text hovers use the window-owned effect adapters. The list's per-instance
constructed stylesheet is scoped to its owner and removed on disposal, so focus
and selection styling work with `style-src 'self'`. There is no arbitrary global
theme participant. The workbench notification bell stays in its status-area anchor
when toast position changes. Accessible reading uses a labelled, read-only native
text area with navigation and actions; the global workbench sound engine is not
part of this cluster.

The notification Control Explorer fixture and imported list/scrollbar suites
provide real Chromium behavior evidence. The development-only
`npm run preview:notifications` displays production presenters with sample
ordinary, sticky and indefinite-progress messages. The preview is unreachable
from packaged product compositions.

Manual evidence exception: Windows/macOS screen-reader workflows, Windows forced
colors, and reviewed platform pixel baselines remain required before release of
this new pattern. The current development environment supplies macOS Chromium
interaction and visual inspection, not Windows or assistive-technology evidence.
The design-system owner owns the follow-up; release approval must include those
results. Automated semantics and theme/zoom checks are partial evidence and do
not establish accessibility conformance.
