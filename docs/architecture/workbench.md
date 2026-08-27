# Workbench architecture

## Product windows

Proctor Desktop ships one binary with three trusted window kinds:

- `LaunchWindow` is the minimal signed-out surface. It accepts a Proctor Server
  URL, replaces the input with safe Institution availability and compatibility,
  offers `Sign in to <Institution>` when usable, keeps `Change server`
  available, and provides bounded diagnostics and exit. It renders no
  authentication method, provider, password, recovery, MFA, or invitation form.
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
kinds. A current student sees student exam activity plus account/settings. A
non-student User may have overlapping teacher, Exam Manager, Academic Unit, and
system-administration responsibilities; the server projects available areas and
each operation reauthorizes its actual Action and Resource.

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
- student, mixed non-student, disabled, unaffiliated, and no-access navigation;
- item resolution, cancellation, pane lifecycle, focus, zoom, and restoration;
- LaunchWindow unavailable/incompatible/change-server/authentication states;
- first join, pause, suspension ordering, ready rejoin, submission, and relaunch;
- immediate local gating before authoritative refetch;
- absence of credentials, content, browser activity, and evidence from generic
  state or diagnostics;
- production exclusion of developer and deferred agent capabilities.

Implementation, manifests, tests, and this architecture must describe the same
three windows and transition behavior.
