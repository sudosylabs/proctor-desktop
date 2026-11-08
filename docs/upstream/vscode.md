# VS Code source policy

Visual Studio Code is architecture evidence and an eligible source reference.
Proctor's product model, security requirements, and module interfaces decide
which upstream behavior belongs in Proctor Desktop.

## Reviewed baseline

- Repository: <https://github.com/microsoft/vscode>
- Revision: `e4cb02e7392fc625904eb30cc88a31a002f63a7c`
- Repository license: MIT

The revision is an inspection baseline, not a global source pin. Every admitted
cluster records the exact revision from which it was reviewed and transferred.

## Source relationship

Proctor uses a selective, Proctor-owned transplant. Landed source lives under
`src/prctr/`; builds and runtime do not depend on an upstream checkout. A fork,
subtree, submodule, vendor branch, pristine source snapshot, or patch queue is
not the maintenance unit.

Preserve upstream architectural and runtime topology when it carries dependency
meaning. Proctor owns product names, interfaces, seams, aggregate manifests, and
composition. Never copy an upstream aggregate entrypoint to select Proctor's
services or contributions.

Proctor narrows product scope through explicit exclusions, not lower-fidelity
substitutes. Once a behavior is admitted, preserve the relevant upstream
correctness, lifecycle, cancellation, disposal, failure, performance,
accessibility, and test obligations. A smaller Proctor interface or simpler
implementation is acceptable only when it preserves the admitted observable
behavior and evidence. A Proctor product or security constraint may require a
stronger or intentionally different result; record that divergence and its
verification in the cluster manifest.

## UI presentation target

For UI source, apply the required
[Modern UI and floating panels baseline](../architecture/design-system.md#modern-ui-and-floating-panels).
That baseline covers CandidateWindow and other VS Code-derived UI.
LaunchWindow and AuthenticatedWindow use Proctor-owned controls, icons and
pages; VS Code UI is not a source for them.
The intake must recover the relevant Modern UI styles, base-control dependencies,
layout calculations, activation, states, and tests together. Use that baseline
when choosing the source revision and reviewing an existing port; copying only
the pre-Modern-UI implementation is incomplete. Record Proctor token/namespace
adaptations and verified product divergences through the normal manifest process.
A non-visual cluster does not need Modern UI dependencies.

## Admission gate

Admit a behavior cluster only for a concrete Proctor workflow and caller after
recovering:

- the small Proctor interface callers need and the leverage it provides;
- the complete upstream interface and its product assumptions;
- source and type dependencies, callers, registrations, tests, styles, assets,
  localization, configuration, schemas, and generated material;
- process, trust, lifecycle, persistence, cancellation, disposal, failure,
  performance, and accessibility obligations;
- applicable copyright, license, and notice material.

Classify every reviewed item as **copied**, **adapted**, **behaviorally
reimplemented**, **evidence only**, **excluded**, **locally satisfied**, or
**external**. Architectural inspiration without recognizable source expression
or a compatibility obligation creates no provenance record.

The dependency walk stops only at an accepted Proctor interface, a previously
admitted compatible module, a standard platform interface, or a reviewed
external dependency. Directory edges and file proximity are not stopping
rules. Upstream tests are behavioral evidence; transfer them only when Proctor
intentionally preserves the exact lower-level behavior. Excluding an upstream
test case requires an explicit behavior exclusion or verified Proctor
divergence; current product breadth alone is not a reason to weaken an admitted
behavior.

## Treatment and maintenance

Copied material permits only the deterministic transformations declared in its
cluster manifest. A semantic, structural, identifier, formatting, or
compatibility edit makes the affected material adapted. Keep adapted divergence
concentrated behind Proctor-owned seams. A behavioral reimplementation has no
textual synchronization promise; its local interface and tests are
authoritative.

One admitted cluster and its transferred closure use one exact upstream commit.
Independent clusters may use different commits. Reuse a local module derived
from another revision only through an accepted interface, an explicit
compatibility decision, and focused verification.

Update by re-running intake for the complete cluster against a new commit:
recompute closure, review changed assumptions and registrations, reclassify
items, update provenance, and verify the Proctor interface. An isolated
upstream patch does not silently change the recorded revision.

## Provenance

The [VS Code ports registry](./vscode-ports/README.md) is the sole tracked owner
of exact source relationships. Create one manifest only when a cluster is
admitted. Preserve applicable source headers and notices, and check separately
attributed nested material independently.

Use the repository
[`adapt-vscode`](../../.agents/skills/adapt-vscode/SKILL.md) skill for boundary
grilling, intake, transfer, audit, and updates.
