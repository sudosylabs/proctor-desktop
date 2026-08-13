---
name: adapt-vscode
description: Evaluate, compare, admit, copy, adapt, behaviorally reimplement, update, or audit Visual Studio Code source and behavior for Proctor Desktop. Use for any task involving microsoft/vscode, a local VS Code checkout, an upstream subsystem or path, a VS Code-derived file, or the Proctor VS Code ports registry.
---

# Adapt VS Code

Treat VS Code as evidence. Proctor owns the interface, seam, namespace, and
product composition.

## 1. Load Proctor authority

Read [`docs/upstream/vscode.md`](../../../docs/upstream/vscode.md), the relevant
product and architecture topics, and
[`docs/project/status.md`](../../../docs/project/status.md). For an existing
cluster, also read its manifest under `docs/upstream/vscode-ports/`.

Stop at an unresolved product or architecture decision. Open an ignored
`.scratch/<effort>/` grill rather than letting nearby upstream code settle it.
This step is complete when the Proctor workflow, caller, and accepted decision
owner are known.

## 2. Grill a new boundary

Challenge the Proctor workflow and caller, upstream interface and assumptions,
product conflicts, process and trust placement, lifecycle and persistence,
failure and performance, accessibility, dependency closure, registrations, and
all available treatments.

Format every VS Code-informed decision as:

```text
❓ Question — the Proctor decision
🧭 VS Code — pinned behavior and exact source paths
➡️ Proctor recommendation — answer and match/diverge rationale
```

Inspect the pinned source before describing it. Name composition-specific
exceptions. This step is complete only when the user accepts the boundary and
its tracked owner is clear. A deferred or rejected cluster receives no
manifest.

## 3. Recover the pinned cluster

Pin one full upstream commit for the proposed cluster. Inspect entrypoints,
callers, exports, tests, registrations, configuration, localization, CSS,
assets, generated inputs and outputs, environment APIs, errors, cancellation,
disposal, performance, accessibility, and licenses.

Classify every discovered item using the dispositions defined by the
[registry](../../../docs/upstream/vscode-ports/README.md). Continue until each
transitive edge reaches transferred material, an accepted local interface, a
reviewed platform or external dependency, evidence, or an explicit exclusion.
This step is complete when the reviewed graph is closed and no aggregate import
has selected product behavior implicitly.

## 4. Design the Proctor module

Design the small Proctor interface before transferring implementation. Use
[`source-code-organization`](../source-code-organization/SKILL.md) to place it
under `src/prctr/`. Keep upstream registries, identifiers, DTOs, and lifecycle
machinery internal unless callers need them. Select concrete adapters in
process composition roots.

Choose copied, adapted, behavioral reimplementation, or exclusion for each
exact item. Treat any non-mechanical local edit as adaptation. This step is
complete when callers and tests can use the same Proctor-owned interface and
every imported dependency respects local layer and runtime direction.

## 5. Create the provenance record

Create or update `<cluster-id>.json` beside the registry schema. Record the
admission, exact revision and blobs, reviewed items, local paths and digests,
declared mechanical transformations, dependency stopping points, licenses,
divergences, and verification required by
[`schema.json`](../../../docs/upstream/vscode-ports/schema.json).

Preserve applicable headers and nested attribution. Add
`@proctor-vscode-port <cluster-id>` after the license header in each
comment-capable copied or adapted file. This step is complete when every
transferred path has exactly one manifest owner and marker parity holds.

## 6. Validate locally

Run the repository provenance validator when available. Otherwise inspect the
same obligations and report the missing automation. Establish schema validity,
unique identifiers and local-path ownership, repository-relative paths, local
existence and SHA-256 digests, marker parity, license references, verification
paths, namespace and aggregate-entrypoint rules, and disposition of every
statically discoverable local dependency.

This step is complete when validation needs neither a VS Code checkout nor
network access and every failure is fixed or reported.

## 7. Audit upstream

Resolve the canonical repository at the manifest revision. Verify each recorded
path and blob, reproduce copied files using only declared transformations,
produce comparisons for adapted files, recompute the static upstream closure,
and inspect applicable licenses and notices. Use generated diffs as review
evidence, not as patch-queue authority.

This step is complete when the exact upstream evidence can reconstruct every
source relationship in the manifest. Application build and runtime remain
independent of the checkout.

## 8. Verify and review

Test observable behavior through the Proctor interface. Compare upstream tests
for missing cases while expressing Proctor requirements. Verify layer and
environment direction, process isolation, contribution composition,
accessibility, divergence, and provenance completeness.

For an update, rerun the complete cluster intake at the new commit. Reopen the
product boundary only when its interface, assumptions, or Proctor use changed.
The work is complete when policy, manifest, attribution, local validation,
upstream audit, and focused verification agree.
