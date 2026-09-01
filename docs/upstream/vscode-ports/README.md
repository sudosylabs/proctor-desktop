# VS Code ports registry

This registry is the canonical record of copied, adapted, and behaviorally
reimplemented VS Code material in Proctor Desktop. It contains no speculative
catalog: create `<cluster-id>.json` only in the change that admits or updates
the corresponding behavior cluster.

Admitted clusters:

- [`base-common-runtime`](./base-common-runtime.json) — the complete admitted
  base-common dependency closure for lifecycle, events, cancellation, async
  scheduling, resources, and observables, with upstream owner suites.
- [`localization-runtime`](./localization-runtime.json) — Proctor named-message
  runtime and deterministic packaged catalog generation, plus the private
  positional compatibility seam used by admitted VS Code modules.

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
