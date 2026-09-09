# Workbench architecture

## Product windows

Proctor Desktop ships one binary with three trusted window kinds:

- `LaunchWindow` is the minimal signed-out surface. It accepts a Proctor Server
  URL, replaces the input with safe Institution availability and compatibility,
  offers a compact `Sign in` action below the verified Institution when usable,
  and places a muted `Change server` button directly beneath it when a server has
  been submitted. It provides bounded diagnostics and exit. It renders no
  authentication method, provider, password, recovery, MFA, or invitation form.
  Its lockup, Institution, and action form one centered group on a continuous
  canvas with integrated native window controls. Exit and bounded connection
  diagnostics live in native application menus; its initial window is normal
  and resizable. The initial theme is dark. The server origin remains available
  in native diagnostics without repeating it in the main content.
- `AuthenticatedWindow` is the normal signed-in application. It contains every
  currently authorized student, teacher/Exam Manager, administration, account,
  and settings area. Navigation and server projections never grant authority.
- `CandidateWindow` is the constrained secure workbench for one active Exam
  Attempt. It is not the student's home and contains no unrelated authenticated
  area.

Electron main selects the window kind from trusted identity and Attempt state
before renderer bootstrap. Each window is permanently bound to one launch
descriptor, Institution origin, User, and server Session as applicable.
Renderer state, remote content, URLs, restored state, and context keys cannot
change those bindings.

Opening `CandidateWindow` closes `AuthenticatedWindow`. Returning from a
suspension or authorized departure destroys `CandidateWindow` before opening
`AuthenticatedWindow` at the relevant Attempt. Relaunch never restores or
focuses a previous CandidateWindow: the User signs in and navigates from the
normal authenticated home again.

Account and settings are pages in `AuthenticatedWindow`, not separate window
kinds. A User may see student exam activity alongside authorized teacher,
Exam Manager, Academic Unit, or system-administration areas. Institutional
affiliations are non-exclusive; the server projects all available areas and each
operation reauthorizes its actual Action and Resource. Entering CandidateWindow
still closes the entire AuthenticatedWindow regardless of those responsibilities.

## Own-account destination

The titlebar displays Proctor. A compact account trigger on the right of the
titlebar shows the user's photo and display name. It sits before right-side
native window controls, using the chrome owner's reserved control space. At
constrained widths it retains the avatar and accessible full name. A sidebar
visibility toggle precedes the account trigger and uses the visible/hidden
Codicon for the sidebar’s physical side. The shell owns actual visibility and
notifies the control after responsive layout and navigation changes. Explicit
choices persist as the non-sensitive device-scoped `prctr.authenticated.layout`
category (schema 1), owned by authenticated navigation and cleared with local
application data. Responsive hiding never overwrites that choice. Its menu
contains Profile, Sessions, Settings, then a separated Log out action. macOS uses an Electron
native popup so the OS owns material, selection, accessibility and dismissal;
other platforms use the window-owned menu control. The native capability accepts
only a bounded anchor and returns a closed action identifier, with sender
validation and window-disposal cancellation. It cannot execute arbitrary commands
or accept a renderer-defined menu tree.

Account hosts Profile (including security) and Sessions & devices through one
registered WorkbenchItem resolver and cancellable pane. Profile-photo reads,
uploads, and removals use the signed-in User and exact image revision. Other
presentation fields use the server’s administrative User management operation;
the own-account destination presents them read-only. Account data is
window-session state and is never restored as authoritative data.

A capability specific to AuthenticatedWindow binds every read or action to its
immutable Principal and Session. The privileged identity owner supplies DPoP
proof and refresh; the renderer receives whitelisted account metadata. Passwords,
MFA enrollment, and recovery stay on the pinned server's hosted security page.
That browser session does not renew the desktop session's authentication assurance.

Ending a session or revoking a desktop requires an explicit confirmation.
Revoking the current desktop uses the same immediate window teardown and protected
credential cleanup as sign-out, with server revocation already confirmed.
Unknown mutation outcomes require a fresh read before another attempt.

## Authenticated product areas

The student activity area derives these user-facing categories from the
authoritative projection:

- Upcoming;
- Available;
- In progress;
- Submitted;
- Under review;
- Results available;
- Past.

Withheld review is coarse and does not expose private integrity evidence,
remarks, or unreleased results. Teacher and Exam Manager areas span every
currently manageable Academic Unit and guide the User through authoring,
delivery, supervision, review, and permitted student search/actions without
exposing Exam Draft, Exam Revision, and Exam Sitting as the primary navigation
structure. Administration areas are available only through current server-
authorized capabilities and may include Role, Academic Unit, Programme,
Programme Level, and other institutional management when the current User has
the corresponding actions.

The live Sitting board presents one row per student with authoritative Attempt
state, connection/Participation health, safe suspension reason, submission, and
available manager action. It does not expose multiple hidden Attempt/session
identities. Reallow moves a suspended student to ready; the board reports active
only after that student successfully joins again.

The same `AuthenticatedWindow` may change its displayed areas when a fresh
self-context projection changes. That projection is a routing input, not a
grant. Disabled account, no current affiliation, and no assigned access receive
distinct presentations.

## Manifests and contribution loading

`WorkbenchComposition` is an immutable description of window identity,
shell-part policy, layout policy, and restoration policy. Proctor-owned literal
manifests select all executable contributions:

- the common workbench manifest registers mechanics shared by authenticated
  and candidate workbenches;
- the Electron desktop manifest selects shared renderer adapters;
- the authenticated manifest admits general signed-in product contributions;
- the candidate manifest admits only secure Attempt contributions.

The
[`source-code-organization`](../../.agents/skills/source-code-organization/SKILL.md)
skill owns exact source placement.

Each user-visible capability has one registration entrypoint. Trusted remote
data may create authorized instances of a packaged destination or capability;
it cannot provide a manifest, module path, command implementation, or generic
conditional registration. The initial architecture has no extension host or
public extension interface.

## Shared kernel

The shared workbench kernel contains only reusable mechanics:

- lifecycle, disposal, composition validation, and contribution activation;
- shell layout, focus, navigation, and content history;
- context keys, commands, actions, menus, and packaged keybinding dispatch;
- theme, accessibility, localization, and first-frame bootstrap;
- workbench items, panes, resolvers, groups, and safe layout restoration;
- notifications, banners, dialogs, gates, quick input, and progress;
- non-sensitive presentation storage and redacted diagnostics.

Student activity, academic management, administration, settings, Attempt
Workspace, Exam Resources, editor behavior, exam security, integrated browser,
remote terminal, supervision, and review remain product contributions. The
kernel does not import VS Code's extension ecosystem, local-workspace model,
profiles/settings sync, Git/SCM, debugging, tasks, testing, local terminals,
notebooks, custom editors, chat/agent systems, Microsoft identity, telemetry,
update, branding, or cloud services through aggregate entrypoints.

## Shell topology

The shell uses the accepted
[Modern UI floating-panel composition](./design-system.md#modern-ui-and-floating-panels).
That decision governs region surfaces, gutters, shared edges, internal insets,
and coordinated layout sizing; the parts below retain their domain ownership.

Every workbench uses these structural regions:

- `TitlebarPart` owns window identity and trusted global window actions.
- `BannerPart` owns persistent non-blocking notices and starts hidden.
- `NavigationPart` selects composition-approved product destinations.
- `SidebarPart` presents hierarchy or context for the active destination.
- `ContentPart` hosts workbench-pane groups and policy-controlled splits.
- `StatusPart` presents concise connection and relevant product state.
- `OverlayHost` owns dialogs, notifications, context menus, gates, quick input,
  and blocking overlays; it is not a grid part.

`AuthenticatedWindow` configures these regions for its current authorized
areas. Account/settings use ordinary destinations inside that composition.
Its sections use fixed sizing with a single content group and no resize handles
or split actions. Native titlebar dragging, double-click behavior and window-edge
resizing remain available. At constrained viewport widths the sidebar becomes a
titlebar disclosure, giving the active content the available width and restoring
focus when a destination is chosen. The product sidebar destination list scrolls independently. Floating gutters and borders reduce each original
grid slot once before the pane host measures its inner content.

`CandidateWindow` additionally exposes a `PanelPart` for the policy-gated
remote terminal. Candidate navigation initially has `Workspace` and `Exam
Materials`; the integrated browser opens only as a policy-controlled workbench
item in the content area. The Workspace sidebar owns the file tree, the content
area owns code-file and browser items, and the panel owns the single remote PTY.
Exam Materials owns a separately authorized resource list and read-only viewers.
There is no first-release agent region.

Regions are resizable only within composition-approved placements and provide
an accessible reset. Detached content windows, arbitrary docking, renderer-
selected capability regions, arbitrary destination pinning, and unrestricted
cross-region movement are outside the initial model.

## Content seam

Workspace files, integrated-browser pages, Exam Resources, authenticated
catalog/detail pages, and authorized review surfaces may be `WorkbenchItem`s.
The terminal remains owned by `PanelPart`.

A `WorkbenchItem` exposes only:

- packaged type identifier and opaque logical identity;
- presentation information and accessible label;
- shell capabilities such as closability and restorability;
- identity matching and presentation-change notification.

A `WorkbenchPane` exposes only one-time DOM creation, cancellable item
assignment and clearing, visibility, layout constraints, layout, focus,
non-sensitive view state, and disposal. A registered resolver obtains the item
model. Saving, synchronization, content versions, browser enforcement,
submission, and terminal lifetime stay behind their owning capabilities.

The internal layout model may support controlled groups and editor splits.
Compositions expose policy rather than generic grid mutation. A failed or
superseded item is isolated and cannot stop the shell.

## Restoration and local presentation state

Restoration is convenience, never product authority. Minimal item references
contain packaged type, opaque identity, safe view state, and restoration
eligibility. Generic layout storage never contains credentials, authorization,
answers, source content, exam material, browser activity, security observation,
evidence, or authoritative revision.

Unknown, obsolete, unauthorized, or malformed references are omitted. Required
Attempt content is reconstructed from authoritative state. CandidateWindow is
never a restorable application entrypoint.

Non-sensitive presentation state declares one scope:

- `device` for application presentation such as window bounds;
- `principalComposition` for one Principal in AuthenticatedWindow;
- `attemptPresentation` for safe layout within one Exam Attempt;
- `windowSession` for state discarded with a window.

Every category declares sensitivity, schema version, and cleanup owner.
Attempt-presentation data is removed after authoritative completion and cannot
cross to another Principal or Attempt.

## Lifecycle and secure transitions

Renderer contributions use `Starting`, `Ready`, `Restored`, and `Eventually`.
Only a reviewed allowlist may block early phases. Authentication, server
availability, Attempt loading, connectivity, and secure-exam readiness remain
explicit product gates. Startup failure enters a minimal recovery surface.

Electron main owns composition-aware window and shutdown coordination:

- first successful secure join opens CandidateWindow only after current
  Attempt admission and preflight establish active state;
- pause keeps CandidateWindow open beneath a blocking overlay while
  Participation renewal and the active Session lock continue; workspace
  changes, browser, terminal, and submission remain gated;
- suspension first closes privileged operation gates, presents a blocking
  overlay, protects work, then destroys CandidateWindow and opens
  AuthenticatedWindow at the suspended Attempt;
- manager reallow changes authoritative state to ready; only a later successful
  secure join creates active state and CandidateWindow;
- submitted state and another authoritative departure permission allow normal
  CandidateWindow closure.

When an authoritative event indicates a blocking transition, local mutation
gates close before refetch and presentation. Ordinary close/quit is vetoed while
active participation forbids departure. Force Quit, crash, power loss, or
trusted-process loss never implies submission or automatic re-entry.

## Identity and security integration

The detailed rules live in the
[identity and exam-security architecture](./identity-and-exam-security.md).
Authentication, navigation projection, Attempt admission, operation
authorization, Secure Exam Posture, and authoritative Attempt lifecycle remain
independent. Credentials, installation private keys, and protected-store handles
stay privileged. Preload exposes only window-specific projections and intents.

Candidate security state distinguishes local posture from authoritative Attempt
state. A renderer cannot mark itself ready, active, reallowed, or submitted.
Current policy and posture gate Workspace, browser, and terminal capabilities;
the underlying operation owner reauthorizes each request.

## Interaction, accessibility, and external input

Commands express intent and use the `prctr.` namespace. Context keys control
visibility, enablement, and routing only. Services and privileged adapters
perform authorization. Menus, keybindings, quick input, and overlays come from
static registrations and localized labels.

The executable kernel instantiates the admitted context-key, instantiation,
command, menu, and keybinding services in every workbench renderer. Product
controls resolve their action through the same menu/precondition path used by
packaged keybindings; direct DOM callbacks do not become a second command path.
Window kind, lifecycle phase, focused part, modal state, direction, contrast,
motion, and bounded Candidate interaction availability are live context values.

Dialogs trap focus for one bounded decision. Gates block one region or window
while preserving reason, consequence, allowed recovery, and protected-work
state. Persistent corrections use banners; required acknowledgement is a
separate authorized action. No critical state depends on color, icon, or motion.

Electron main treats inbound URLs, file-open events, and command-line arguments
as untrusted. The exact ephemeral loopback authentication callback belongs only
to the privileged identity transaction. Candidate rejects local file/workspace
open, generic navigation, external-application launch, and arbitrary schemes.
The integrated browser follows its separately accepted policy.

Production builds expose no DevTools, reload, evaluation, storage dumping, or
developer command. Development variants are visually distinct and cannot enter
a production candidate Attempt. Diagnostics remain bounded and redacted.

## Verification

Verify through the owning interfaces:

- manifest and preload allowlists for all three windows;
- student, overlapping student/teacher/management, disabled, unaffiliated, and
  no-access navigation;
- item resolution, cancellation, pane lifecycle, focus, zoom, and restoration;
- LaunchWindow unavailable/incompatible/change-server/authentication states;
- first join, pause, suspension ordering, ready rejoin, submission, and relaunch;
- immediate local gating before authoritative refetch;
- absence of credentials, content, browser activity, and evidence from generic
  state or diagnostics;
- production exclusion of developer and deferred agent capabilities.

Implementation, manifests, tests, and this architecture must describe the same
three windows and transition behavior.

## In-app notifications

AuthenticatedWindow and CandidateWindow each own one notification model/service and its nonmodal toast, retained
center, status indicator, progress and accessible-reading presenters. Ordinary
producers use handles to update severity, text, actions and progress, then close
the handle when their operation ends. Prompt actions retain their separate
keep-open and cancellation outcomes. Notification progress is available through
the window's explicitly registered progress service.

Sticky means no automatic toast timeout. Active progress additionally prevents
ordinary row, keyboard, Clear All and Accessible View dismissal. Escape hides
presentation while retaining the notification in the center. A producer's close
or an explicit operation-owned cancellation action can end progress. Duplicate
notifications consolidate; burst limiting affects toasts without discarding
center entries. Hidden ongoing progress remains discoverable in the status area.

Notification presentation sits below modal/security gates. Candidate interaction
state and overlay visibility disable it synchronously. Notifications neither
replace gates nor grant permission. Producers supply safe localized text and
bounded source identifiers. A composition must explicitly supply and authorize
link or copy effects; the current window compositions expose neither a generic
external opener nor unrestricted clipboard access. An absent link adapter renders
plain text. Failed actions show bounded feedback without logging raw errors.

The model, message content and action closures are `windowSession` state and are
disposed with the window. The private preference adapter stores only versioned
booleans, bounded source-filter records and one validated position. Application
suppression and placement use `device`; profile suppression is bound to
Institution/principal `principalComposition`; workspace suppression is bound to
Institution/principal/Attempt `attemptPresentation`. Missing bindings or storage
failures use window memory. These records never restore authority or shadow
server User Settings. Account/Attempt bindings prevent cross-context preference
reuse; stale records are inert and are removed with application browser storage.

LaunchWindow keeps readiness and authentication feedback within its central task.
It does not mount a notification center, toast layer, or notification bell, and its
`workbench/common` prohibition has no notification exception.
The source relationship and complete selected dependency closure are owned by
[the notification port](../upstream/vscode-ports/workbench-notifications.json).
