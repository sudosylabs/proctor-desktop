# Repository enforcement

Repository controls make the accepted foundation difficult to violate without
pretending that static analysis proves runtime, packaged, or physical behavior.
This document owns the enforcement model; configuration and command help own
exact executable details.

## Assurance model

Every numbered rule in [`invariants.md`](./invariants.md) has a stable semantic
identifier. [`build/policies/assurance.json`](../../build/policies/assurance.json)
maps those identifiers to one or more controls of these kinds:

- `source` for repository graph and metadata facts;
- `generation` for deterministic authority/output parity;
- `test` for observable behavior through a public interface;
- `package` for the exact artifact and supported target;
- `review` for product or architecture judgment that cannot be automated.

Controls are either active or objectively deferred. A deferred control names
its owner, future kind, rationale, and repository condition that activates it.
Once source, a composition layer, CSS, a settings registry, a native package,
or a packaged target satisfies that condition, the missing control is a hard
failure. There are no permanent waivers and no warning baseline.

The catalog is an index, not a second copy of architecture prose. `npm run
inspect` reports active and deferred controls; `npm run check:assurance`
validates exact invariant coverage, registered implementations, evidence paths,
and activation conditions.

## Checker kernel

Typed check modules under `build/checks/` consume the same narrow `Repository`
interface in production and fixture tests. Checks have literal stable IDs and
return deterministic diagnostics containing check ID, path, optional location,
problem, and remediation. The registry rejects duplicate IDs. Exact `--check`
selection is for focused work; the full repository remains authoritative.

The active cheap controls cover:

- JSON policy schemas and assurance coverage;
- exact dependency admission and lifecycle-script decisions;
- Markdown links, skill metadata, canonical symlink aliases, portable tracked
  paths, UTF-8 and whitespace hygiene, and full-SHA GitHub Actions;
- TypeScript imports, local resolution, NodeNext extensions, source namespace,
  layer/runtime/test direction, cycles, and literal dynamic imports;
- literal composition activation and transitive required/forbidden roots;
- CSS ownership, cascade names/order, Proctor roots and variables, selector
  scope, and prohibited selectors or unreviewed `!important`;
- deterministic generator ownership and byte parity;
- offline VS Code port schema, digest, marker, license, and unique-owner parity.

The source graph rejects executable cycles, including cycles within one admitted
cluster. Type-only edges remain visible to architecture checks without creating
runtime cycles. A separate tooling graph check covers build modules and command
wrappers; production source boundaries remain independently enforced.

Runtime classification normally comes from an explicit environment folder. An
aggregate whose accepted product name cannot encode that folder uses one exact
path classification in `source-boundaries.json`; the shared
`workbench.common.main.ts` aggregate is therefore checked as browser source.
This classification changes which dependency rules apply and is not a waiver
from layer, runtime, composition, or cycle checking.

The text-hygiene check permits absolute-path and `file:` URI literals only in
marked base-common port source and its transferred owner tests, where those
literals are behavioral fixtures covered by an exact manifest digest. Unmarked
files and all other repository areas retain the portable-path prohibition;
runtime dependencies on another checkout remain forbidden.

Static checks never claim keyboard behavior, visual meaning, authoritative
server behavior, Electron isolation, packaged security, native capability, or
physical-device conformance. The assurance catalog keeps those obligations
visible until the appropriate test or package control exists.

## Authorities and exceptions

Machine-readable policy lives under `build/policies/` and every JSON authority
has a checked-in Draft 2020-12 schema. Executable check and generator ownership
lives in typed registries. Generated outputs have exactly one generator and are
written only by `npm run generate`; normal checking never silently rewrites the
worktree.

There are no inline architecture disables. Source layering, runtime direction,
composition, provenance, generated ownership, and security boundaries are not
suppressible. A future suppressible check must opt in explicitly and use one
central exact exception record with an owner, rationale, evidence, and objective
removal condition. Orphan exceptions fail. The initial exception registry is
empty.

VS Code port validation is deliberately split. `check:provenance` is offline
and belongs to the normal gate. `audit:upstream` takes an explicit VS Code
checkout, resolves the recorded commit, and verifies every recorded upstream
blob. Intake review still owns transformations, closure, and notices; this
checkout-dependent work is never hidden inside the local check.

## Dependency and CI discipline

The root is one private exact-version npm graph. `.nvmrc`, `packageManager`,
engine declarations, the lockfile, and dependency admission records move
together. npm lifecycle scripts are denied by default and any future allowed
script requires an explicit package-level decision in both package metadata and
the admission record.

The `foundation` GitHub Actions job runs on every pull request and main push
without path filters, with read-only permissions, concurrency cancellation,
exact Node/npm setup, `npm ci`, and the full cheap `npm run check`. External
actions use reviewed full commit SHAs. Required branch protection remains
external repository administration until configured.

Dependabot opens bounded weekly npm and GitHub Actions updates. It does not
auto-merge. A dependency update is incomplete until the exact manifest,
lockfile, admission record, lifecycle decision, and focused evidence agree.
Runtime and security-sensitive dependencies must remain separately reviewable
when they arrive.

## Test contract

Every registered repository checker has a passing and intentionally failing
virtual repository case through the same public interface, with an exact check
ID, path, and problem assertion. A meta-test rejects missing contracts. Focused
kernel tests cover path normalization, real symlink topology, duplicate check
IDs, and overlapping generator output ownership. New checks must land their
contract in the same change.

An optional explicitly enabled hook checks staged hygiene, formatting and syntax
without rewriting source or staging. It is never installed by npm lifecycle
hooks. CI remains the required authority. See the
[development environment](../project/development.md) for the ownership boundary.
Electron and esbuild now support the isolated security-utility composition:
the cheap `check` gate runs its process-neutral protocol tests, and the native
macOS/Windows jobs run its real Electron/Node-API lifecycle test. Forge,
Playwright, packaging, and packaged-target gates remain absent. A real
sandboxed Chromium renderer harness covers browser-owned controls and
workbench interactions, and a real Electron harness verifies the isolated
product-window skeleton and capability-specific preloads. The Rust workspace,
native addon, and development-runtime Electron evidence activate
source/runtime controls only; they establish no packaged-target claim.
