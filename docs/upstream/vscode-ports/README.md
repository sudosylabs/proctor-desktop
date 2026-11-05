# VS Code ports registry

This registry is the canonical record of copied, adapted, and behaviorally
reimplemented VS Code material in Proctor Desktop. It contains no speculative
catalog: create `<cluster-id>.json` only in the change that admits or updates
the corresponding behavior cluster.

Admitted clusters (the manifest files remain authoritative for exact paths,
revision, disposition, dependencies, divergence, and evidence):

- [`actions-menus`](./actions-menus.json) — observable actions and static Proctor menu contributions.
- [`attempt-workspace-core`](./attempt-workspace-core.json) — Attempt Workspace overlay, recovery, persistence, reconciliation, providers, and Exam Resources.
- [`base-common-runtime`](./base-common-runtime.json) — lifecycle, events, cancellation, scheduling, resources, and observables.
- [`browser-interaction`](./browser-interaction.json) — DOM lifecycle, focus, input, geometry, scheduling, resize, touch, and safe CSS values.
- [`codicons-semantic-icons`](./codicons-semantic-icons.json) — complete pinned Codicon assets behind Proctor semantic icon identifiers.
- [`desktop-authorization`](./desktop-authorization.json) — hosted browser callback lifecycle, native key custody, and privileged Session handoff.
- [`editor-core`](./editor-core.json) — positions, ranges, selections, piece-tree text, edits, EOL, word boundaries, and search.
- [`settings-file-icons`](./settings-file-icons.json) — complete bundled Seti font and file associations through the source file-icon theme loader, without extension loading.
- [`theme-size-registry`](./theme-size-registry.json) — complete Modern UI size registry, default typography, spacing and corner-radius variables.
- [`editor-text-edits`](./editor-text-edits.json) — complete text/string/array edit composition, inversion, rebasing, ranges and position-offset transformations for the Monaco settings working copy.
- [`json-language-server`](./json-language-server.json) — complete JSON/JSONC server and browser-worker startup, validation, completion, formatting and structural language providers with bounded packaged schema/localization adapters.
- [`editor-token-themes`](./editor-token-themes.json) — complete token-theme parser and matching trie, encoded token metadata, TextMate scope matching and plist parsing with upstream token-theme regression tests.
- [`color-theme-engine`](./color-theme-engine.json) — bundled color-theme loading, registered defaults, scoped settings overrides, and Modern UI color roles.
- [`electron-window-skeleton`](./electron-window-skeleton.json) — trusted product windows, immutable descriptors, native integrated chrome, preloads, and secure transitions.
- [`integrated-browser-client`](./integrated-browser-client.json) — policy-enforced Candidate browser and minimized ordered activity.
- [`localization-runtime`](./localization-runtime.json) — named messages, packaged catalogs, and the private upstream compatibility seam.
- [`modern-workbench`](./modern-workbench.json) — AuthenticatedWindow floating surfaces, default/compact seams, coordinated insets, resize grips, and Modern UI part spacing.
- [`performance-foundation`](./performance-foundation.json) — monotonic marks and static local performance budgets.
- [`platform-commands`](./platform-commands.json) — static command registration, validation, execution, events, and disposal.
- [`platform-context-conditions`](./platform-context-conditions.json) — parsing, normalization, implication, comparison, regex, and serialization of context expressions.
- [`platform-instantiation-registry`](./platform-instantiation-registry.json) — constructor injection, scopes, delayed services, cycle detection, and disposal.
- [`platform-keybindings`](./platform-keybindings.json) — platform keybinding resolution, conflicts, chords, IME, labels, and dispatch.
- [`resource-preview`](./resource-preview.json) — complete image and Markdown document rendering mechanics behind an isolated reusable host, with separately packaged PDF.js decoding.
- [`shared-browser-controls`](./shared-browser-controls.json) — reusable native-DOM controls and deterministic Control Explorer evidence.
- [`themes-design-tokens`](./themes-design-tokens.json) — static semantic tokens and the four color-scheme classifications and non-color presentation tokens.
- [`user-settings-common`](./user-settings-common.json) — bounded JSONC settings, typed resolution, and frozen Attempt Configuration.
- [`workbench-notifications`](./workbench-notifications.json) — window-owned notifications, prompts, progress, retained center, accessibility, and complete virtual list/scrollbar mechanics.
- [`workbench-kernel`](./workbench-kernel.json) — executable compositions, lifecycle, shell, layout, items, panes, restoration, and overlays.

- [`complete-theme-model`](./complete-theme-model.json) — Provide the full upstream color, TextMate and semantic theme model to the Settings editor and existing Proctor chrome from one owner.
- [`editor-browser-core`](./editor-browser-core.json) — Provide the actual Monaco browser editor for virtual Settings JSONC, retaining original DOM, keyboard/composition input, cursor/selection, rendering, scroll/minimap/decorations and worker contracts.
- [`editor-browser-services`](./editor-browser-services.json) — Supply the concrete upstream code-editor, accessibility, interaction, marker, icon-theme and worker services behind Proctor-owned window configuration and resource boundaries.
- [`editor-text-model`](./editor-text-model.json) — Provide one complete Monaco text-model mechanism for Settings JSONC and graphical edits, preserving versioned events, edits, undo/redo, search, tokenization, decorations, bracket state and language-service ownership.
- [`settings-editor-browser-host`](./settings-editor-browser-host.json) — Provide source native menu and clipboard behavior through capability-specific isolated Settings transports.
- [`settings-editor-contributions`](./settings-editor-contributions.json) — Retain the Monaco editing contributions and provider machinery selected by the closed Settings composition.
- [`settings-editor-controls`](./settings-editor-controls.json) — Supply the actual control hierarchy consumed by SettingsEditor2 and modal editor services, preserving complete tree, input, selection, button, toolbar, hover, menu, dialog and layout implementations.
- [`settings-editor-icon-styles`](./settings-editor-icon-styles.json) — Generate dynamic registered Codicon CSS and font dependencies within the editor theme scope.
- [`settings-editor-json-navigation`](./settings-editor-json-navigation.json) — Reveal and edit a setting in the same authorized JSON working copy using source Preferences navigation and renderer behavior.
- [`settings-editor-language-configuration`](./settings-editor-language-configuration.json) — Validate and register the complete packaged JSON/JSONC language configuration through the source extraction algorithms.
- [`settings-editor-local-search`](./settings-editor-local-search.json) — Complete local Settings matching, filter parsing, TF-IDF ranking and provider caching with no online/AI search service.
- [`settings-editor-modal-services`](./settings-editor-modal-services.json) — Supply editor resolution, resource labels, dialogs, Quick Input and explicit Settings commands to the modal composition.
- [`settings-editor-model-host`](./settings-editor-model-host.json) — Resolve, retain and edit the authorized virtual Settings text model, including model references, undo/redo and bounded bulk text edits.
- [`settings-editor-modern-ui`](./settings-editor-modern-ui.json) — Full pinned Modern UI activation, fourteen stylesheet modules and coordinated pane-header, scrollbar and notification density metrics.
- [`settings-editor-presentation`](./settings-editor-presentation.json) — Preserve complete SettingsEditor2, renderers and modal EditorPart/group presentation with their exact source contracts and dependency topology. Product-specific exclusions and service adapters remain explicit; copying source alone is not runtime completion.
- [`settings-editor-runtime-services`](./settings-editor-runtime-services.json) — Full file, dialog, text-resource and optional Tree-sitter mechanisms behind settings-only resource and native window boundaries.
- [`settings-editor-textmate`](./settings-editor-textmate.json) — Full source TextMate tokenization, scope registration, line limits, state deltas, theme propagation and background model controllers with static packaged JSON grammars.
- [`settings-modal-composition`](./settings-modal-composition.json) — Host graphical Settings and JSON in the source modal editor with scoped editor groups, services and disposal.
- [`settings-token-customization`](./settings-token-customization.json) — Preserve theme-scoped TextMate and semantic token configuration schemas, types and font-size inheritance for bundled themes.

## Record identity

Each manifest validates against [`schema.json`](./schema.json) and uses a
stable, lowercase, hyphenated `clusterId`. The manifest filename equals that
identifier. One manifest owns each transferred local path.

`admission` identifies the Proctor workflow, callers, local interface, and
tracked decision that justify the cluster. `upstream` identifies the canonical
repository and one full commit SHA. Git history owns chronology; manifests
describe current relationships.

## Reviewed items

List every item needed to understand the cluster's closure, not only transferred
files. Each item records an upstream path and blob, category, disposition,
rationale, and applicable license references.

The dispositions mean:

- `copied` — source expression is preserved with only declared deterministic
  transformations;
- `adapted` — recognizable source remains but Proctor changes its interface,
  semantics, structure, dependencies, or behavior;
- `behaviorally-reimplemented` — upstream behavior informs a new Proctor
  implementation without a textual synchronization promise;
- `evidence-only` — the item informs requirements or verification but does not
  land;
- `excluded` — omission is deliberate and architecturally significant;
- `locally-satisfied` — an accepted Proctor interface supplies the dependency;
- `external` — a reviewed platform or package contract supplies it.

Copied and adapted files record their local path, local SHA-256 digest, and
mechanical transformations. Adapted semantic differences live in `divergences`.
Behaviorally reimplemented items point to local source but carry no
source-synchronization digest.

`erasable-syntax-rewrite` records behavior-neutral TypeScript assertion syntax
rewrites required by Proctor's `erasableSyntaxOnly` compilation policy.

## Source markers and attribution

Place this marker immediately after the applicable copyright and license header
in every comment-capable copied or adapted file:

```text
@proctor-vscode-port <cluster-id>
```

The marker only routes to the manifest. The manifest owns revision, paths,
treatment, and divergence. Commentless and binary material is discoverable from
the manifest. Preserve nested attribution in addition to the upstream source
header.

## Dependencies, divergence, and verification

`dependencies` records accepted local interfaces, external packages, and
platform interfaces at which the closure stops. `divergences` records current
intentional incompatibility rather than edit history. `verification` names the
tests, checks, and reviews that exercise the Proctor interface and protect each
divergence.

Use [`adapt-vscode`](../../../.agents/skills/adapt-vscode/SKILL.md) to create or
update a manifest. Local validation must not require an upstream checkout; the
separate upstream audit resolves the recorded commit, blobs, transformations,
closure, and notices.
