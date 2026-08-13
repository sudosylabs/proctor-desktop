# User settings architecture

Proctor gives every authenticated user one durable settings document for
approved IDE and presentation preferences. Settings personalize packaged
behavior; they never define the product, grant a capability, authorize an
operation, or weaken examination and accessibility requirements.

## Authority and vocabulary

The **User Settings Document** is one server-authoritative, Principal-owned,
bounded JSONC document. It has an opaque optimistic revision and a separate
grammar format version. `settings.json` is its familiar user-facing virtual
representation. It is not a host file, an Attempt Workspace resource, or a
general file-service target.

The server exposes purpose-specific settings operations. It may reuse File
Entry, File Revision, File Rendition, VFS, or other storage mechanics
internally, but those concepts do not cross the settings interface. The source
document is authoritative user intent; parsed values, normalized values,
schemas, catalogs, caches, and effective settings are derived state.

A protected local cache may supply the last acknowledged document for first
paint or bounded recovery. It cannot authorize offline editing, become the
current revision, or be read by another Principal. If protected persistence is
unavailable, the client fetches from the server and never silently stores
plaintext.

## Static settings registry

A frozen Proctor-owned registry defines every setting that can affect the
application. Familiar VS Code identifiers are retained only when Proctor
deliberately supports their meaning. Neither VS Code, an extension, remote
content, an examination, a server-supplied schema, nor restored state can add a
setting or executable behavior.

Each declaration identifies:

- dotted identifier, type, accepted values, bounds, normalization, packaged
  default, and safe fallback;
- domain: appearance, accessibility, editor behavior, workbench placement, or
  capability presentation;
- storage: portable user or device-local;
- applicable packaged compositions;
- candidate treatment: `eligible`, `policyConstrained`, `nonCandidateOnly`, or
  `prohibited`;
- activation: live outside candidate mode, next window, or next Attempt;
- global-only or approved language-override support;
- current, deprecated, migrated, or retained-but-unsupported lifecycle;
- localized editing, search, diagnostic, and replacement metadata.

Eligibility permits a candidate composition to consume a value; it never
permits mutation. Policy can narrow only a registered `policyConstrained`
setting. A known prohibited identifier exists only to produce a precise
diagnostic and never has an effective value. Unknown identifiers survive safe
round trips for forward compatibility but remain inactive.

Sensitive values are ineligible for registration. The rejection catalog
includes credentials, tokens and cookies; arbitrary filesystem paths;
executables, commands, arguments and environments; proxies, certificates,
origins and navigation allowlists; runtime module or formatter-provider
selection; injected CSS, palettes, token maps, themes and icon packs; and
developer, update, telemetry, IPC, security and native-monitoring controls.

Owning capabilities export immutable declarations. One Proctor settings
manifest imports them through literal paths, validates identifier/default/type/
migration/applicability consistency, and freezes the registry. Build tooling
derives the JSON Schema, SettingsWindow catalog, rejection catalog, and registry
fingerprint from that manifest. Registration has no side effects and cannot be
mutated after composition.

## Settings and presentation scopes

The User Settings Document contains portable preferences as flat dotted keys
and approved VS Code-style `[language]` blocks. It contains no role,
composition, device, Attempt, authority, or policy section. Proctor initially
has one settings document per User and no multiple settings profiles.

State outside that document retains its existing owner:

- `device` stores genuinely device-specific presentation such as window bounds;
- `principalComposition` stores exact role-workbench restoration and geometry;
- `attemptPresentation` stores safe layout for one candidate Attempt;
- `windowSession` stores ephemeral interaction state;
- Exam configuration and Exam Security Policy own creator-selected constraints
  and capabilities;
- authoritative identity, authorization, lifecycle, monitoring, integrity, and
  evidence state is never a setting.

An explicit preference such as explorer side may be portable. Exact sidebar
width, collapsed regions, open items, selected destination, and editor splits
are restoration state. Attempt Workspace content, including
`.vscode/settings.json` or any other settings-looking file, cannot configure the
application. User keybinding customization and multiple profiles are outside
the initial architecture.

## Effective configuration

Resolution has two stages. Selection chooses:

1. the packaged default, specialized only by trusted packaged composition;
2. exactly one registered portable-user or device value;
3. an applicable frozen language override.

Constraints then apply:

1. static composition applicability and registered bounds;
2. authenticated Exam configuration and Exam Security Policy after the owning
   authority has resolved accommodations;
3. current platform and operating-system accessibility requirements;
4. non-negotiable packaged safety and accessibility invariants.

Attempt Workspace files and restoration never enter this chain. An examination
may narrow or force only a statically registered value. A setting cannot enable
the terminal, browser, agent, filesystem, monitoring, or another capability;
those require their own current authorization.

Constraints do not rewrite user intent. Inspection returns requested and
effective values, a sanitized source category, and a bounded reason such as
`unsupported`, `compositionRestricted`, `examConstrained`,
`accessibilityAdjusted`, or `frozen`. It reveals no raw policy, accommodation,
detector, evidence, or authorization material.

## Initial preference surface

Appearance supports only the packaged `system`, `light`, `dark`, `hc-light`,
and `hc-dark` theme preferences; bounded whole-window zoom; default or compact
density; system-aware reduced motion and transparency; packaged monospace font
identifiers; bounded editor and terminal font metrics and ligatures; and safe
editor presentation. Application chrome retains the platform UI font. Control
Explorer evidence fixes numeric bounds before release.

Portable layout preference may place the file-tree sidebar left or right, the
terminal panel at bottom, left, or right, and the future agent region left or
right. Composition-owned layout resolves collisions and supplies an accessible
reset. Settings cannot move or hide the titlebar, destination switcher, status,
gates, mandatory IDE workspace, Exam Materials destination, or overlay host;
detach content; or create arbitrary docking.

The initial editor surface includes indentation, wrapping, line numbers,
whitespace, rulers, minimap, guides, folding, bracket presentation,
cursor/selection presentation, and bounded packaged suggestion/completion
presentation. Approved editor settings may have language overrides. Formatting
is policy-constrained and can use only a formatter already selected by packaged
or authoritative examination capability. Settings cannot select an extension,
executable, command, or module.

Autosave remains deferred until the editor-to-Attempt-Workspace working-state
contract is accepted. Protected recovery and server acknowledgement never
depend on a preference. User keybindings, code actions on save, task execution,
and local tool discovery remain unsupported initially.

Optional-capability settings affect presentation only after the capability is
separately available. Terminal settings may cover packaged font, size, cursor,
and bounded scrollback; browser settings may cover bounded page zoom and safe
presentation; agent settings may cover layout and presentation. They cannot
select shells, processes, PTY targets, paths, proxy or navigation policy,
browser retention, AI provider/model/prompt/tool permissions, network access,
or data retention. A preference remains stored when its capability is absent
but is omitted from the effective projection.

## SettingsWindow and editing

`SettingsWindow` is a trusted authenticated window kind outside the launch,
candidate, and proctor workbench compositions. It is permanently bound to one
User and server Session and is destroyed when either changes. It loads no
Attempt, role authority, editor workspace, terminal, browser, agent,
monitoring, enforcement, or examination contribution.

The window may coexist with an authorized proctor workbench. Electron main
prevents it during active candidate participation and closes it before
candidate preflight. This rule is enforced by trusted composition state, not by
renderer visibility.

A structured searchable editor and an advanced virtual `settings.json` JSONC
editor operate on one in-memory `SettingsDraft` containing source text and the
base server revision. They never persist independently. Explicit **Save
settings** performs the only commit. Theme, zoom, and density may preview only
within SettingsWindow and revert on cancel or failure. Reset deletes a key
rather than storing its default.

Syntax and registered-value errors block save and link the structured field to
the source location. Unknown keys are retained with an inactive warning.
Prohibited keys must be removed. Deprecated keys expose replacement or
migration. Server unavailability permits a marked read-only acknowledged cache,
not an offline draft. Unsaved drafts are memory-only initially, require close
confirmation, and are cleared on sign-out or Session replacement. Import and
export are deferred.

The complete workflow is keyboard-operable and provides accessible validation,
focus restoration, all four themes, and 200% zoom reflow. It distinguishes
requested values, effective values, constraints, unsaved state, verifying
state, conflicts, and committed state without relying on color or icons.

## Candidate baseline

A **Candidate Settings Baseline** freezes validated user choices for an entire
Exam Attempt at its first successful admission. It identifies the User and
Attempt, source User Settings Document revision, registry and application build,
candidate composition version, normalized registered values, and applicable
language overrides. Authoritative admission fences the source revision.
Protected local state may help reconstruct the baseline but is not its sole
authority.

The same baseline survives renderer restart, full Participation Interruption,
and teacher-authorized re-entry into the Attempt. A new participation generation
does not reread newer user settings. Remote document changes apply to future
non-candidate windows and future Attempts only.

An **Effective Candidate Settings Projection** derives typed values from the
baseline under current trusted policy, platform, accessibility, and packaged
safety constraints. Stronger trusted constraints can change this projection
immediately without mutating the baseline. Language values already present in
the baseline may activate as the active editor language changes.

The candidate renderer receives only the immutable projection and revision. It
has no settings source, draft, cache, update, or conflict operation. Safe
resizing, collapsing, approved relocation, and splitting remain
`attemptPresentation`. Closed accessibility actions may temporarily adjust
bounded zoom or select packaged high contrast for the Attempt without changing
behavior, capability, or the User Settings Document.

Attempt-scoped presentation and the baseline follow authoritative Attempt
completion cleanup. The next Attempt captures the then-current document.
Corrupt or unsupported settings never block entry: candidate mode uses packaged
defaults plus trusted accessibility requirements and emits a sanitized
diagnostic while preserving the original server revision for repair.

## Persistence, conflicts, and format

Proctor has no separate Settings Sync subsystem. A purpose-specific read returns
source JSONC, grammar format version, and opaque revision. Conditional replace
sends the complete source, expected revision, and idempotency key. Success
returns exact committed source and a new revision. An ambiguous outcome is
verified or retried with the same key; it is never guessed.

SettingsWindow retains base, draft, and latest-remote forms. A syntax-aware
three-way merge may combine unambiguous disjoint setting paths and language
entries while preserving comments and formatting. Same-path edits,
delete-versus-modify, or uncertain comment/trivia placement produce explicit
conflicts. One clean merge may retry against the latest revision. There is no
last-write-wins or offline mutation queue.

The grammar is valid UTF-8 JSONC with one top-level object, comments and
trailing commas, unique keys, dotted setting identifiers, and approved language
blocks. It admits no executable expressions, includes, references, or
substitutions. Initial bounds are 256 KiB source, nesting depth 8, 2,048 setting
paths, 256 UTF-8 bytes per key, 16 KiB per string, and 256 elements per
collection.

Grammar `formatVersion` is server metadata rather than a document envelope. The
server validates authentication, ownership, expected revision, grammar and
bounds. The packaged desktop registry validates known types, applicability,
prohibition and behavior. A malicious or newer client can therefore store only
bounded structural data and cannot make an unregistered setting effective.

Registry migrations are packaged, deterministic, pure, and identified by
registry version. Candidate admission may migrate in memory but never silently
rewrites remote source. SettingsWindow shows a migration and commits it through
normal conditional save. A newer unsupported grammar opens read-only and
preserves its source.

## Module and process seams

Environment-neutral registry, parsing, migration, resolution, inspection,
schema/catalog inputs, and immutable projections belong under
`src/prctr/platform/settings/common/`. Callers use typed setting descriptors,
not arbitrary string keys.

A privileged Electron-main `UserSettingsCoordinator` owns authenticated reads
and writes, acknowledged cache lifecycle, idempotency, unknown-outcome
verification, editor sessions, and ordinary-window projections. Attempt
admission and the Exam Security Coordinator own baseline fencing and trusted
constraint inputs; they call the resolver rather than exposing policy objects
to it.

`src/prctr/workbench/contrib/settings/` owns the SettingsWindow editing surface.
A dedicated `src/prctr/code/electron-browser/settings.main.ts` manifest selects
only its renderer contributions, and the Electron-main composition root creates
the bound window and capability-specific preload.

Ordinary callers can observe immutable effective values and changes and request
sanitized inspection where needed. SettingsWindow alone receives a closed
editor-session interface for open, validate, conditional save, conflict
reconciliation, discard, and disposal. Privileged admission receives a separate
baseline-capture operation. There is no universal configuration service joining
all roles.

## Diagnostics and verification

Ordinary diagnostics never contain JSONC, comments, setting values, user text,
conflict source, or cache contents. They may contain bounded setting
identifiers, registry/document versions, result categories, and sanitized
migration or constraint reasons.

Verification covers:

- registry uniqueness and freezing, schema/catalog parity, fingerprints, and
  rejection-catalog completeness;
- grammar limits, duplicate keys, fuzzing, comments, minimal edits, and unknown
  key preservation;
- exact selection/constraint precedence and sanitized inspection;
- deterministic idempotent migrations and unsupported-version preservation;
- optimistic concurrency, idempotent retries, ambiguous outcomes, three-way
  merges, and conflicts;
- cache isolation, sign-out cleanup, and protected-storage failure;
- Attempt-wide baseline stability across remote edits, crashes, and authorized
  re-entry, plus live stronger constraints without baseline mutation;
- absence of mutation capability from candidate preload and production role
  manifests;
- proof that workspace files, restoration, and remote schemas cannot affect
  configuration;
- SettingsWindow keyboard, focus, validation, conflict, theme, and zoom
  behavior.

VS Code's useful evidence is its registry, layered models, inspection and
change mechanics, JSONC experience, and three-way conflict handling. Proctor
behaviorally reimplements those concepts behind its own authority and process
seams. No VS Code settings source cluster is admitted by this architecture.
