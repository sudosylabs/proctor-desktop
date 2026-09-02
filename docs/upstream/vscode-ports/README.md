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
- [`editor-core`](./editor-core.json) — positions, ranges, selections, piece-tree text, edits, EOL, word boundaries, and search.
- [`electron-window-skeleton`](./electron-window-skeleton.json) — trusted product windows, immutable descriptors, preloads, and secure transitions.
- [`integrated-browser-client`](./integrated-browser-client.json) — policy-enforced Candidate browser and minimized ordered activity.
- [`localization-runtime`](./localization-runtime.json) — named messages, packaged catalogs, and the private upstream compatibility seam.
- [`performance-foundation`](./performance-foundation.json) — monotonic marks and static local performance budgets.
- [`platform-commands`](./platform-commands.json) — static command registration, validation, execution, events, and disposal.
- [`platform-context-conditions`](./platform-context-conditions.json) — parsing, normalization, implication, comparison, regex, and serialization of context expressions.
- [`platform-instantiation-registry`](./platform-instantiation-registry.json) — constructor injection, scopes, delayed services, cycle detection, and disposal.
- [`platform-keybindings`](./platform-keybindings.json) — platform keybinding resolution, conflicts, chords, IME, labels, and dispatch.
- [`remote-terminal-client`](./remote-terminal-client.json) — one Workspace-fenced, policy-gated, xterm-backed remote PTY.
- [`shared-browser-controls`](./shared-browser-controls.json) — reusable native-DOM controls and deterministic Control Explorer evidence.
- [`themes-design-tokens`](./themes-design-tokens.json) — static semantic tokens and four immutable Proctor themes.
- [`user-settings-common`](./user-settings-common.json) — bounded JSONC settings, typed resolution, and frozen Attempt Configuration.
- [`workbench-kernel`](./workbench-kernel.json) — executable compositions, lifecycle, shell, layout, items, panes, restoration, and overlays.

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
