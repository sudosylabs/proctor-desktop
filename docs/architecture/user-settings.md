# User settings architecture

## Authority and vocabulary

User settings express portable presentation and editor preferences. They never
define product areas, grant a capability, authorize an operation, configure
exam security, or override Exam/Attempt state.

The **User Settings Document** is one server-authoritative, Principal-owned,
bounded JSONC document. Its opaque revision is the condition for mutation.
`settings.json` is the document's virtual name, not a host file or Attempt
Workspace resource. Users never edit it directly; the Settings page writes it.

Keep these other state families separate:

- packaged defaults and the static Proctor settings registry;
- device-only preferences;
- `AuthenticatedWindow` and Attempt presentation/restoration;
- authoritative Exam configuration and Exam Security Policy;
- the Attempt's frozen **Attempt Configuration**;
- stronger current platform, accessibility, and safety constraints.

## Static settings registry

Only packaged immutable declarations make a key effective. Each declaration
defines identifier, schema/default, bounds/normalization, storage scope, domain,
window applicability, language-override support, activation point, localized
editor metadata, and candidate treatment:

- `eligible` may enter Attempt Configuration;
- `policyConstrained` may enter only after authoritative constraints;
- `nonCandidateOnly` remains available in AuthenticatedWindow;
- `prohibited` is diagnosed and never effective.

Owning capabilities contribute declarations through literal Proctor manifests.
One deterministic generator derives JSON Schema, settings catalog, rejection
catalog, and registry fingerprint. Generator and runtime registry import the
same canonical serialization/fingerprint implementation so build parity cannot
drift through duplicated algorithms. Remote schemas and workspace content cannot
register behavior. Unknown keys are preserved but inactive; known prohibited
keys have no effective value.

Platform-specific defaults are explicit data in the same immutable declaration
and fingerprint. The configuration model, effective-value resolution and JSON
language schema select the current platform's default from that data; explicit
user values remain portable. Generators retain the complete platform map so
building on one OS cannot silently change another OS's defaults.

Keep credentials, tokens, keys, arbitrary paths, commands, code, visual
injection, extension identifiers, formatters, file associations, autosave
semantics, execution/terminal configuration, browser/network/proxy policy,
monitoring, evidence, telemetry, update, developer, and IPC controls outside the
registry.

## Settings and presentation scopes

Use explicit storage scopes:

- `portableUser` is the server User Settings Document;
- `device` stores safe machine-local preferences through approved storage;
- `principalComposition` stores safe AuthenticatedWindow presentation;
- `attemptPresentation` stores safe CandidateWindow layout for one Attempt;
- `windowSession` is discarded with its window.

Each category declares sensitivity, schema, lifecycle, cleanup owner, and
whether it may be cached. Generic workbench restoration stores presentation,
not setting authority. Another Principal cannot enumerate or apply protected
settings/cache data.

## Effective configuration

`UserSettingsService` is the small external interface for observing typed
effective values, inspecting bounded provenance, validating a source, and
conditionally committing the complete document. Callers do not parse JSONC,
select storage, or look up arbitrary string keys.

Resolution applies:

1. packaged default;
2. exactly one portable-user or device value;
3. applicable language override;
4. window/composition constraints;
5. authenticated Exam and security constraints;
6. platform/accessibility requirements;
7. packaged safety invariants.

Inspection reveals only requested/effective values, sanitized source category,
and bounded constraint reason. Workspace content, layout restoration, context
keys, renderer state, and remote schema never enter precedence.

The initial non-candidate settings surface may cover theme, high contrast,
zoom, typography, editor indentation/wrapping/line numbers/minimap, cursor,
approved keybindings, reduced motion, screen-reader/announcement behavior,
safe file-tree presentation, and browser presentation that does not
alter their authority. A stored preference may remain inactive when its
capability is absent.

## Account/Settings editing

Settings is one destination inside `AuthenticatedWindow`. It carries the
window's Principal/Session binding and no Attempt authority. Opening
CandidateWindow closes the entire AuthenticatedWindow, so the editing surface
cannot coexist with active candidate participation.

Settings is an Account page (`settings` in `accountPages`), opened from the
Account sidebar or Ctrl/Cmd+, (`prctr.authenticated.openSettings`). Its three
tabs — Appearance, Exam editor and Accessibility — are built from
`SETTINGS_MANIFEST` by
`src/prctr/workbench/contrib/account/settings/common/settingsPresentation.ts`. The exam
browser's zoom lives in Appearance › Size beside Interface size. Rows are built
once and updated in place, so focus stays on the control that changed. A sticky
tab bar carries Find and the save status; "Saved" appears only after a change on
that visit. Find searches titles, descriptions, choice labels and a few everyday
words of every tab. Object settings such as color and token customizations stay
in the manifest and remain effective but have no control.

`administration.lists` is an object setting with no control on this page:
Administration keeps each list's page size and up to eight saved views of Users
there, so they follow the person to any computer. It is AuthenticatedWindow-only
and `nonCandidateOnly`, and its normalizer keeps only known filters.
`IAdministrationListsService` reads it from the settings projection and saves it
through the same draft, revision and conflict path as the page.

Each control writes one key through one in-memory `SettingsDraft` and previews
the draft at once, so every window applies the change before it is saved. The
page saves about 400 ms later, sending the complete bounded source with the
acknowledged revision and an idempotency key, one save at a time. A revision
conflict adopts the newer settings and applies the page's unacknowledged changes
again on top. An ambiguous outcome is retried once. A failure shows Not saved
and a toast with Try again; the change stays applied on this computer. A changed row offers
Reset, which removes the key so the default applies. Server-unavailable state is
read-only; there is no offline mutation queue. Cache only acknowledged source in
protected Principal-bound storage.

Import/export is absent initially. Diagnostics may name safe key/reason/revision
metadata but never source JSONC, values, comments, drafts, or conflicts.

## Attempt Configuration

At initial secure join, Desktop derives the closed
[Attempt Configuration contract](../contracts/attempt-configuration.md) from:

- the exact admitted configuration manifest fingerprint;
- packaged FNV registry fingerprint and verified Desktop build/target;
- current acknowledged User Settings revision;
- normalized eligible preferences;
- current server/Exam constraints and packaged bounds.

The server validates and freezes the exact object/digest on the Attempt. The
Desktop applies that stored object on renderer restart and successful join from
ready. It never recomputes an existing Attempt from newer User Settings.
The digest binds the complete candidate object, including source revision and
build/target provenance. Re-entry preserves that provenance and admits a later
verified build when its manifest reproduces the frozen configuration. SHA-256
artifact/document digests and the FNV registry selector have distinct meanings.
Approved commands/keybindings are release-catalog IDs with validated command
relationships; raw key chords cannot enter the wire object. Pixel line height
retains its own unit and bound.

The first accepted fields are:

- theme and high-contrast selection;
- bounded UI zoom and editor font size;
- bounded line height;
- reduced motion;
- screen-reader and announcement mode;
- cursor presentation;
- approved Candidate command/keybinding identifiers.

Terminal execution, browser/network policy, extensions, executable commands,
formatters, file associations, autosave semantics, and arbitrary editor values
cannot enter Attempt Configuration. Unknown fields fail admission rather than
silently activating.

Current trusted platform, accessibility, or safety constraints may narrow an
**Effective Attempt Configuration Projection** without mutating the frozen
object or User Settings Document. Stronger constraints never grant a capability
and cannot silently rewrite later User preferences.

Candidate preload receives only the immutable effective projection and
revision/digest needed by packaged consumers. It exposes no User Settings
source, cache, draft, update, merge, or conflict operation. Attempt layout
remains `attemptPresentation`, not configuration.

## Persistence and parsing

The server owns the document and opaque revision. Desktop PUT commits the
complete bounded JSONC source with expected revision and idempotency key; its
success response is revision metadata and need not echo source. Ambiguous
completion is verified with the same key.

The parser bounds bytes, depth, properties, string lengths, nesting, and
language overrides while preserving supported JSONC comments and ordering when
the page edits a key. Duplicate keys and dangerous/confusable forms produce precise
diagnostics. A syntax-invalid acknowledged document does not become effective.

The registry has one current shape: there are no stored-format versions or
migrations, and a key the registry no longer declares is an unknown key that
never becomes effective. A registry/build that cannot reproduce a stored Attempt Configuration blocks secure re-entry
with a precise compatibility result instead of changing candidate behavior.

## Module and process seams

Keep Proctor static declarations, bounded validation, trusted
constraints, schema inputs, and immutable projections under
`src/prctr/platform/settings/common/`. The admitted VS Code configuration
models, registry, default/policy configuration, and resource editing service
retain their topology under `platform/configuration/common/`. Packaged Proctor
declarations populate that registry; remote input never registers settings.
The typed Proctor facade delegates preference resolution to the upstream models
and applies trusted constraints afterward.

The configuration engine addresses a settings URI through a resource adapter.
Storage selection belongs to composition and does not require replacing the
parser, models, override resolution, inspection, change events, or queued JSONC
editing. The editing draft supplies a working-copy adapter; the Settings page
commits its source through the privileged owner. Changing the configured
persistence policy requires specifying its authority and synchronization
semantics, but not a replacement configuration engine. The current server
authority and protected acknowledged cache remain unchanged.

Keep `UserSettingsCoordinator`,
authenticated transport, and protected cache in Electron main. The Settings page
lives with the Account pages under `src/prctr/workbench/contrib/account/settings/`.
`src/prctr/workbench/contrib/settings/` applies effective presentation (window
theme, motion, zoom, customizations) and owns the Settings keybinding. Both are
selected through the authenticated manifest and `authenticated.main.ts`
composition root.

Candidate consumers depend on an Attempt Configuration projection contract,
not the User Settings service. Editor, design system, workbench, and
browser modules request only their owned typed values.

## Verification

Verify:

- registry/schema/catalog/fingerprint parity;
- JSONC bounds/fuzzing, unknown/prohibited keys, and precedence;
- conditional writes, idempotent ambiguity, conflict merge, and cache isolation;
- Account/Settings loading, invalid, conflict, ambiguous, unavailable, autosave,
  failure, Reset, Find, keyboard/focus, themes, reduced motion, high contrast,
  and 200% zoom;
- Attempt Configuration closed schema, bounds, server validation/freeze,
  unchanged re-entry, incompatible registry/build, and stronger live constraints;
- absence of settings mutation/source/cache from Candidate preload and of
  values/source from ordinary diagnostics.

Implementation, generators, manifests, tests, and this architecture must agree
on document authority, AuthenticatedWindow placement, and the closed Attempt
Configuration subset.

## Theme settings

`window.theme` (`system`, `light` or `dark`; default `system`) picks Proctor
Light or Proctor Dark for LaunchWindow and AuthenticatedWindow; `system` follows
the operating system. `workbench.colorTheme` is the **editor theme**: it selects
from the packaged GitHub theme catalog, also accepting the four scheme
identifiers, and applies only to CandidateWindow. `workbench.colorCustomizations`
is bounded object data with optional bracketed theme scopes and has no control
on the Settings page. Color schemas and registry metadata belong to the theme
engine; a settings document cannot add a color registration.

LaunchWindow opens before sign-in, so it uses the scheme last chosen on this
computer. `FileWindowAppearanceStore`
(`src/prctr/platform/windows/node/windowAppearanceStore.ts`) remembers the
signed-in window's scheme in `window-appearance.json` under the user data
directory, and Electron main applies it through `nativeTheme.themeSource`. That
file is a device presentation cache, not a User Settings source.

Authenticated startup binds the existing settings coordinator and IPC to the
current User/Session before the renderer requests its projection. The privileged
identity owner reads `GET /api/v1/users/me/settings` and conditionally writes
`PUT` on that same fixed endpoint with DPoP and a stable SHA-256 encoding of the existing idempotency key, matching the server header alphabet without changing retry identity.
The server's `format_version` is checked at the wire boundary only.
A revision conflict refetches the authoritative source; an uncertain write
retains the existing retry identity. Closing the window disposes the binding,
and sign-out fences all pending transport responses.

While the window is open, the binding listens for the server's
`user_settings_changed` event and for lost realtime continuity. Either one
reconciles the coordinator after any save in flight. An announced revision that
is already acknowledged needs no read, so a window's own save is never read back
as a change. Otherwise the coordinator re-reads the settings, adopts a newer
revision and follows the server's writability. While an uncertain write is
unresolved, it waits for that write's retry instead. A failed read leaves the
acknowledged settings as they were.

The production adapter currently refetches on each authenticated window and
keeps acknowledged source only in bound memory. It does not introduce an
unencrypted host settings file or an offline mutation queue. Responses outside
the supported document format or Desktop parser bounds remain unavailable.
