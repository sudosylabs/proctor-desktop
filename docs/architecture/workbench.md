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

Account is its own space, opened by the account photo at the bottom of the area
rail; the photo carries the accent ring while Account is open. Its sidebar lists
Profile, Sign-in and security, Sessions and devices, Access tokens and Settings,
then Sign out. Settings opens its existing modal over the current page; the
registered Settings shortcut opens it too. A sign-out failure is reported beside
Sign out. There is no titlebar account trigger or account popup menu.

Each Account page is one registered WorkbenchItem resolved into one cancellable
pane: a heading, a one-line description, any page action, then titled sections.
Sections read independently through the bound account capability and present
their own loading, empty, failed and stale states; a failed refresh keeps what
was shown. Account data is window-session state and is never restored.

- Profile shows the photo, name and username, then the read-only account details
  the institution manages: name, email with its verification state, language,
  time zone, and the last sign-in, which is this window's own session. An
  unverified email offers a verification request whose reply never reveals
  delivery. Exam records due for deletion appear only when the retention read
  returns notices; notices carry identifiers rather than exam titles, so each is
  named by its record category and dates.
- Sign-in and security lists the password and linked providers, two-step
  verification and remaining recovery codes, and opens the hosted security page.
- Sessions and devices separates this computer's session, other sessions and
  registered desktops.
- Access tokens lists working tokens apart from disabled, expired and revoked
  ones, and creates tokens.

Row actions are never inline: a row with actions has one actions button that
opens the window menu. Destructive items are marked and always confirmed in a
modal alert dialog that explains the consequence; ending this computer's
session is signing out. Dialogs are native modal dialogs that make the window
inert, trap focus, and return it to their opener. One change runs at a time.
An unknown outcome locks the affected row until its list is read again.

Photo selection uses the native image chooser and an ephemeral, bounded local
crop draft before explicit Save. Cancellation before submission leaves the saved
photo unchanged. The server's normalized rendition updates both the page and the
rail photo after confirmation. A revision conflict adopts the refreshed revision
only when the person saves again; uncertain outcomes reconcile before retry.
The current server projection does not distinguish custom and default photos,
so Remove is shown only for a revision observed after a confirmed upload in this
window session. Never infer that state from the image or its URL.

A new token states its name, what it can do and an expiry. The server publishes
no scope catalogue, so the window offers only the scope its contract names and
shows any other scope as the server spells it. The window holds no Academic Unit
list, so it cannot limit a new token to one unit. The one-time credential lives
only in its dialog: it is copied through the window's privileged clipboard, is
never stored, logged or announced, and leaves the page when the dialog closes.

A capability specific to AuthenticatedWindow binds every read or action to its
immutable Principal and Session. The privileged identity owner supplies DPoP
proof and refresh; the renderer receives whitelisted account metadata. Passwords,
MFA enrollment, and recovery stay on the pinned server's hosted security page.
That browser session does not renew the desktop session's authentication assurance.

This computer's own desktop registration has no remove action; another
registered desktop is removed only after confirmation.

## Authenticated product areas

The student activity area derives these user-facing categories from the
authoritative projection:

- Upcoming;
- Available;
- In progress;
- Submitted;
- Results available;
- Past.

Withheld review state is concealed. Student activity exposes only released
results and never infers review progress, grades, or pass/fail outcomes. Teacher and Exam Manager areas span every
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
supervision, and review remain product contributions. The
kernel does not import VS Code's extension ecosystem, local-workspace model,
profiles/settings sync, Git/SCM, debugging, tasks, testing, local terminals,
notebooks, custom editors, chat/agent systems, Microsoft identity, telemetry,
update, branding, or cloud services through aggregate entrypoints.

## Shell topology

CandidateWindow's shell uses the accepted
[Modern UI floating-panel composition](./design-system.md#modern-ui-and-floating-panels);
AuthenticatedWindow uses the
[rail-and-sidebar frame](./design-system.md#authenticated-product-presentation).
Those decisions govern region surfaces and coordinated layout sizing; the parts
below retain their domain ownership.

Every workbench uses these structural regions:

- `TitlebarPart` owns window identity and trusted global window actions.
- `BannerPart` owns persistent non-blocking notices and starts hidden.
- `NavigationPart` selects composition-approved product destinations.
- `SidebarPart` presents hierarchy or context for the active destination.
- `ContentPart` hosts workbench-pane groups and policy-controlled splits.
- `StatusPart` presents concise connection and relevant product state in CandidateWindow; AuthenticatedWindow has no status bar.
- `OverlayHost` owns dialogs, notifications, context menus, gates, quick input,
  and blocking overlays; it is not a grid part.

`AuthenticatedWindow` uses `NavigationPart` as the **area rail**, `SidebarPart`
as the **contextual sidebar** for the current area, and a single central
`ContentPart` whose top bar holds Show sidebar (while the sidebar is hidden),
back and forward, and the window search field. On Windows and Linux
`TitlebarPart` is a strip above the frame with the native caption buttons; on
macOS it is the top of the rail, which holds the traffic lights. The frame in
`workbench/contrib/authenticated` owns the rail, sidebar, top bar and navigation
state; the shell owns their geometry. The selected valid destination is shown;
an unavailable selection falls back to the first available area, then Account.
Settings opens its existing modal, preserving the underlying page.

The rail lists the union of the server's available product areas: Activity,
Exams (exam management) and Administration, then the account photo. Account and
Settings remain independent of those areas. Context is a routing hint; every
operation remains bound to the privileged current session and reauthorized by the
server. Refresh and returning to the foreground refetch context, invalidate stale
page actions, and remove areas whose access was lost.

Activity uses the candidate activity projection with opaque pagination; its
sidebar lists Overview and the activity categories, and a chosen exam shows in
the page's own detail panel. Only explicitly released candidate remarks are
displayed; withheld review state and private manager content are absent. Enter
and Resume remain unavailable until the production secure participation
composition is connected. Exams and Administration currently identify their
unavailable desktop functionality and show the bounded management-scope summary;
they do not expose unfinished management actions.

Back and forward retrace places visited in this window, skipping areas no longer
available. The sidebar is resizable from 200 to 320px with a keyboard-operable
separator, hideable with its header button, Show sidebar or Ctrl/Cmd+B, and stops
docking below a 1000px window width (including at 200% zoom), where it opens over
the content and closes on Escape, a choice or work elsewhere. Ctrl/Cmd+K focuses
search; back and forward use Alt+Left/Right, or Cmd+[ and Cmd+] on macOS. These
actions are blocked by modal and security gates. This window has no status bar,
Secondary Side Bar, layout picker or notification-center entrypoint. Native title
bar dragging, double-click behavior and window-edge resizing remain available; the
rail and the top bar's empty space also move the window. CandidateWindow layout
policy is independent.

`CandidateWindow` additionally exposes a `PanelPart`, currently without a
contribution; it is reserved for the planned Run output. Candidate navigation initially has `Workspace` and `Exam
Materials`; the integrated browser opens only as a policy-controlled workbench
item in the content area. The Workspace sidebar owns the file tree, the content
area owns code-file and browser items, and the panel is reserved for Run output.
Exam Materials owns a separately authorized resource list and read-only viewers.
There is no first-release agent region.

Regions are resizable only within composition-approved placements and provide
an accessible reset. Detached content windows, arbitrary docking, renderer-
selected capability regions, arbitrary destination pinning, and unrestricted
cross-region movement are outside the initial model.

## Content seam

Workspace files, integrated-browser pages, Exam Resources, authenticated
catalog/detail pages, and authorized review surfaces may be `WorkbenchItem`s.

A `WorkbenchItem` exposes only:

- packaged type identifier and opaque logical identity;
- presentation information and accessible label;
- shell capabilities such as closability and restorability;
- identity matching and presentation-change notification.

A `WorkbenchPane` exposes only one-time DOM creation, cancellable item
assignment and clearing, visibility, layout constraints, layout, focus,
non-sensitive view state, and disposal. A registered resolver obtains the item
model. Saving, synchronization, content versions, browser enforcement,
and submission stay behind their owning capabilities.

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

AuthenticatedWindow's sidebar visibility and width persist in the non-sensitive
device-scoped `prctr.authenticated.layout` category, owned by the authenticated
frame and cleared with local application data. Responsive hiding never
overwrites an explicit preference, and unreadable storage falls back to a shown
232px sidebar for that window.

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
  changes, browser, and submission remain gated;
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
Current policy and posture gate Workspace and browser capabilities;
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

Each window owns its notification model/service, nonmodal toasts, progress and
accessible reading. CandidateWindow additionally exposes the retained center and
status indicator. AuthenticatedWindow omits the indicator and center command; its
ordinary feedback remains on the owning surface or in toasts. Ongoing operations
in that window must retain their own visible progress/cancellation affordance. Ordinary
producers use handles to update severity, text, actions and progress, then close
the handle when their operation ends. Prompt actions retain their separate
keep-open and cancellation outcomes. Notification progress is available through
the window's explicitly registered progress service.

Sticky means no automatic toast timeout. Active progress additionally prevents
ordinary row, keyboard, Clear All and Accessible View dismissal. Escape hides
presentation while retaining the notification in the center. A producer's close
or an explicit operation-owned cancellation action can end progress. Duplicate
notifications consolidate; burst limiting affects toasts without discarding
center entries. In CandidateWindow, hidden ongoing progress remains discoverable in the status area.

Notification presentation sits below modal/security gates. Candidate interaction
state and overlay visibility disable it synchronously. Notifications neither
replace gates nor grant permission. Producers supply safe localized text and
bounded source identifiers. A composition must explicitly supply and authorize
link or copy effects; the current window compositions expose neither a generic
external opener nor unrestricted clipboard access. An absent link adapter renders
plain text. Failed actions show bounded feedback without logging raw errors.

The model, message content and action closures are `windowSession` state and are
disposed with the window. The private preference adapter stores only
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
