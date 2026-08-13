# Workbench architecture

## Product compositions

Proctor Desktop has one application binary and shared platform with four
trusted window kinds:

- `LaunchWindow` is the minimal signed-out surface. It supports authentication,
  bounded recovery and diagnostics, and application exit. It is not a workbench
  composition and loads no exam, editor, monitoring, or native-enforcement
  contribution.
- `candidate` is the student programming-examination composition. Every
  candidate Exam Attempt includes an IDE workspace and a separate read-only
  exam-materials destination.
- `proctor` is the staff monitoring and review composition. Desktop authoring
  and administration remain outside the initial desktop compositions.
- `SettingsWindow` is an authenticated non-workbench surface for every User's
  approved IDE and presentation preferences. It carries no role or Attempt
  contribution and cannot exist during active candidate participation.

Electron main selects the window kind from trusted authentication and
authorization state before renderer bootstrap. A role workbench is permanently
bound to one Principal and one composition. Renderer state, remote content,
URLs, restored state, and context keys cannot select or change it. A role change
opens a new window.

SettingsWindow is permanently bound to one User and server Session and is
destroyed when either changes. It may coexist with an authorized proctor window.
Electron main closes it before candidate preflight and prevents it from opening
while candidate participation is active. The detailed document, registry,
editing, and candidate-freezing rules live in the
[user-settings architecture](./user-settings.md).

`WorkbenchComposition` is an immutable description of composition identity,
shell-part policy, layout policy, and restoration policy. Registrations,
constructors, concrete adapters, and dependency injection remain internal to
the composition roots rather than becoming part of this interface.

## Manifests and contribution loading

Proctor-owned aggregate manifests select the application:

- the common workbench manifest registers mechanics required by every role
  workbench;
- the Electron desktop manifest selects shared renderer adapters;
- the candidate and proctor manifests own their respective contribution
  allowlists.

The
[`source-code-organization`](../../.agents/skills/source-code-organization/SKILL.md)
skill owns their exact source placement.

Each user-visible capability has one registration entrypoint. A composition may
instantiate an allowlisted contribution by lifecycle phase, workbench-item type,
or trusted local capability state. A literal, statically discoverable import
loads an optional packaged module; remote data can select only among packaged
capabilities. There is no server-supplied or generic conditional manifest.

The initial architecture has no runtime extension host or public extension
interface. Registries remain internal workbench machinery.

## Shared kernel

The shared workbench kernel contains only reusable mechanics:

- lifecycle, disposal, composition validation, and contribution activation;
- shell layout, focus, navigation, and content history;
- context keys, commands, actions, menus, and packaged keybinding dispatch;
- theme and accessibility bootstrap;
- workbench items, panes, resolvers, groups, and safe layout restoration;
- notifications, banners, dialogs, gates, quick input, and progress;
- non-sensitive presentation storage and redacted diagnostics.

Candidate attempt behavior, workspace files, exam materials, editor behavior,
security presentation, policy-gated browser, terminal and agent surfaces,
proctor monitoring, and review are product contributions rather than kernel
mechanics.

The following VS Code product systems are not pulled into the kernel through an
aggregate import: the extension ecosystem, the local-workspace product model,
profiles and settings sync, Git and SCM, debugging, tasks, testing, local
processes and terminal, notebooks, custom editors, chat, MCP, and Microsoft
identity, telemetry, update, branding, or cloud services. Selected file,
working-copy, editor, browser, or terminal mechanics require their own accepted
Proctor seam rather than arriving through an aggregate import.

## Shell topology

Every role workbench creates these core structural regions:

- `TitlebarPart` owns window identity and trusted global window actions.
- `BannerPart` presents exceptional persistent, non-blocking notices and starts
  hidden.
- `NavigationPart` selects composition-approved product destinations.
- `SidebarPart` presents the hierarchy or context within the active destination.
- `ContentPart` hosts workbench-pane groups and policy-controlled splits.
- `StatusPart` presents concise connection, attempt, and integrity state.
- `OverlayHost` owns dialogs, notifications, context menus, gates, quick input,
  and other overlays; it is not a grid part.

The candidate composition additionally creates two initially collapsible
regions:

- `PanelPart` owns the policy-gated remote terminal below the editor area.
- `AuxiliaryPart` owns the future policy-gated agent view beside the editor
  area.

Static contributions register destination types. Authorized remote data may
populate destination instances but cannot define executable destinations.
Candidate navigation has exactly two initial destinations, `Workspace` and
`Exam Materials`. Their accessible switcher is presented in a non-draggable,
keyboard-operable titlebar region while `NavigationPart` retains selection and
routing ownership. Proctor navigation exposes authorized monitoring and review
scopes. Arbitrary destination installation and pinning are outside the initial
model.

In `Workspace`, `SidebarPart` owns the file tree, `ContentPart` owns editor
groups containing code-file and permitted integrated-browser items,
`PanelPart` owns the optional remote terminal, and `AuxiliaryPart` owns the
optional agent view. In `Exam Materials`, the sidebar owns the authorized
material list and the content area owns read-only viewers. Switching
destinations preserves safe per-attempt presentation state and never changes
resource authority or capability policy.

Candidate regions are resizable and may be relocated only among
composition-approved placements, with an accessible reset action. Arbitrary
docking, detached content windows, and renderer-selected capability regions are
outside the initial model.

## Content seam

Workspace files, integrated-browser pages, read-only exam resources, and
proctor review surfaces are workbench items. Terminal and agent activity use
their owning shell regions rather than becoming generic central items.

A `WorkbenchItem` exposes only:

- a packaged type identifier and opaque logical identity;
- presentation information and an accessible label;
- shell-level capabilities such as closability and restorability;
- identity matching and presentation-change notification.

A `WorkbenchPane` exposes only:

- one-time DOM creation;
- cancellable item assignment and clearing;
- visibility, layout constraints, layout, and focus;
- non-sensitive view-state extraction and disposal.

A registered resolver obtains the item model. The workbench owns resolution
cancellation and safely replaces failed or superseded results. Saving,
synchronization, content versions, recovery, submission, and terminal lifetime
remain behind capability-specific interfaces. Workspace items use the
[Attempt Workspace architecture](./attempt-workspace.md) rather than teaching
the workbench kernel file durability.

The internal layout model may support groups and splits, but compositions expose
policies rather than arbitrary grid operations. Candidate starts with one
primary editor group and may permit controlled editor splitting and movement
within the content area. Proctor may expose richer predefined multi-pane
layouts. Detached content windows and unrestricted cross-region docking are
outside the initial interface.

## Restoration and local presentation state

Layout restoration is convenience state, never authority for an Exam Attempt.
A resolver maps an eligible item to a minimal `WorkbenchItemReference` containing
its packaged type, opaque identity, non-sensitive view state, and restoration
eligibility. Generic layout storage never contains credentials, authorization,
answers, source contents, exam material, security observations, evidence, or
remote revisions.

Unknown, malformed, obsolete, or ineligible references are omitted and pruned.
Temporary resolution failures produce safe retryable panes. Authorization loss
closes the item and routes to the appropriate gate. One failed item cannot stop
the rest of the shell from restoring. Required attempt content is reopened from
authoritative attempt state rather than trusted because it appeared in a local
layout.

Non-sensitive presentation state uses four explicit scopes:

- `device` for application presentation such as window bounds;
- `principalComposition` for preferences isolated by Principal and composition;
- `attemptPresentation` for candidate layout isolated by Exam Attempt;
- `windowSession` for ephemeral state discarded with the window.

Every stored category declares its scope, sensitivity, schema version, and
cleanup owner. Attempt presentation is removed after authoritative completion.
Principal-bound state is unavailable while signed out and never crosses to a
different Principal.

## Lifecycle and failure containment

Renderer contributions target four ordered phases:

- `Starting` validates the immutable launch descriptor and constructs essential
  platform modules.
- `Ready` creates the shell and applies initial theme and accessibility state
  before restoration.
- `Restored` begins after initial layout and eligible references resolve or
  produce explicit placeholders.
- `Eventually` runs idle, non-essential work.

Only a reviewed allowlist may block `Starting` or `Ready`. Authentication,
attempt loading, connectivity, and secure-exam readiness are visible product
gates rather than invisible startup tasks. A bootstrap failure enters a minimal
recovery shell. Later contribution failures are isolated from the workbench.

Electron main owns composition-aware window and shutdown coordination. Candidate
has one window and no concurrent Exam Attempts; proctor may have multiple
windows for distinct authorized scopes. Reopening an existing scope focuses its
window unless duplicate views are explicitly supported later.

Candidate application close and quit are prohibited while the authoritative
Attempt state still permits examination participation. Electron main vetoes
ordinary close requests; the candidate first completes the normal
server-authorized examination workflow until application departure is allowed.
A forced close, process termination, crash, or authentication loss is a
participation interruption and never implies submission. Work durability is
continuous rather than deferred to shutdown. Cleanup participants have bounded
time. An authorized recovery restart repeats authentication, authorization,
participation re-entry, reconciliation, and secure-exam preflight before
eligible presentation restores.

## Identity and secure-exam integration

The detailed rules live in the
[identity and exam-security architecture](./identity-and-exam-security.md).
Authentication establishes a Principal; role authorization, resource
authorization, and candidate secure-exam readiness remain separate decisions.
Credentials and credential-store handles stay in a privileged authentication
module. The renderer receives only sanitized identity and state projections.
Secure persistence requires an approved OS-backed adapter and never silently
falls back to plaintext.

Candidate security state distinguishes `notApplicable`, `checking`, `ready`,
`restricted`, and `blocked`. A privileged coordinator owns the authoritative
state, evaluates policy and native signals, and projects sanitized reason codes
and recovery actions. The candidate cannot declare itself ready or dismiss
required enforcement.

Capability revocation precedes presentation changes. Authentication loss and
blocked security state use gates; restricted state exposes only the operations
allowed by policy. Renderer context keys mirror state for presentation and
routing but never authorize an operation. Native observations may inform later
policy and Integrity Flags, but neither the workbench nor a raw observation
determines guilt.

Native package, operating-system capability, process-supervision, and platform
test boundaries remain owned by the native-capability foundation track.

## Interaction and presentation rules

A command represents executable intent, an action presents a command, a menu
places actions, and a keybinding invokes a command. Only packaged,
composition-allowlisted contributions register Proctor-namespaced commands.
Execution validates arguments and rechecks privileged capabilities. Context
keys control visibility, enablement, and routing only.

The initial product has packaged, composition-specific keybindings and no user
keybinding file or general Command Palette. Keyboard-layout handling, chords,
focus behavior, and accessible navigation remain shared mechanics. OS shortcut
observation and restriction belong to native security policy.

Feedback surfaces have distinct meanings:

- a notification is transient and non-critical;
- a banner is persistent but non-blocking;
- a dialog requests one bounded decision while trapping focus;
- a gate represents authoritative blocking or restricting product state.

Theme and accessibility are mandatory bootstrap behavior. The first visible
frame uses validated presentation state, respects platform accessibility and
reduced-motion preferences, and never communicates security state by color
alone. Detailed tokens, CSS conventions, controls, and customization belong to
the [design-system architecture](./design-system.md).

Portable preferences and candidate effective configuration follow the
[user-settings architecture](./user-settings.md). Attempt Workspace settings
files and restored layout never participate in effective-setting precedence.

## External input and production diagnostics

Electron main treats inbound URLs, file-open events, and command-line arguments
as untrusted input. It accepts only versioned Proctor intents with strict schema
and size validation. Authentication callbacks remain in the privileged flow;
other intents wait for authentication and are reauthorized. An intent cannot
select a composition, execute an arbitrary command, supply credentials, or
restore arbitrary content.

Candidate rejects arbitrary local file and workspace opens. Renderer navigation
is blocked. Candidate external links are denied by default and require explicit
exam-security policy; proctor links require an approved scheme and deliberate
user action. Diagnostics record sanitized route and rejection categories only.

Production packages expose no renderer-callable DevTools, reload, arbitrary
evaluation, inspectors, storage dumping, or developer commands. Development
capability is selected by trusted build and launch policy, uses visibly distinct
application identity, and cannot enter a real candidate attempt. Production
diagnostics are bounded and redacted in every composition.

## Representative flows

A candidate attempt enters through authentication, authorization, and
secure-exam preflight, then opens its mandatory IDE workspace. The candidate can
switch to `Exam Materials` to preview authorized PDFs, images, Markdown, and
other supported read-only files, then return without changing durable attempt
state. Browser, remote-terminal, and agent contributions appear only when the
trusted attempt configuration and current security policy allow them;
revocation closes and disposes the affected surface before presentation state
changes.
