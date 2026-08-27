---
name: develop-toolchain
description: Design, implement, or review Proctor Desktop package metadata, dependencies, TypeScript or esbuild configuration, generated artifacts, localization, test harnesses, Electron Forge packaging, native builds or schemas, fuses, signing, updates, CI, release provenance, or supported-platform matrices. Use before changing the build, test, package, or release graph.
---

# Develop the toolchain

Preserve the accepted source and security boundaries through the exact artifact
that ships.

## 1. Load the owning contracts

Read the [toolchain architecture](../../../docs/architecture/toolchain.md),
[repository enforcement](../../../docs/architecture/repository-enforcement.md),
[architecture invariants](../../../docs/architecture/invariants.md), and the
configuration or command help that currently owns the affected behavior. Load
[`source-code-organization`](../source-code-organization/SKILL.md) for
entrypoints or environment placement,
[`develop-native-capabilities`](../develop-native-capabilities/SKILL.md) for a
native package or private protocol, and the owning domain skill for generated
product data. Use [`adapt-vscode`](../adapt-vscode/SKILL.md) before deriving a
tool or implementation from VS Code.

Classify the change as dependency, source compilation, generation, test
runtime, native target, package assembly, update, signing, CI, or release
evidence. The step is complete when its authority, consuming process, target
tuple, and smallest proving gate are explicit.

For compatibility/update work, separate central Proctor distribution of signed
artifacts from each Institution server's safe ping metadata: supported Desktop
release/protocol range and build revocation. Exact OS-version support requires a
signed packaged conformance matrix; architecture text or a generic CI run does
not establish it.

Keep `/api/v1` consumption additive by tolerating unknown fields, events, and
reasons while honoring an Institution's security-raised minimum release and
explicit too-new incompatibility.

## 2. Preserve one build graph

Keep one private npm application graph, one lock, strict NodeNext ESM, relative
`.js` imports, independent no-emit type checking, runtime-specific checks, and
esbuild emission. Keep production entrypoints literal and closed. Make CSS and
assets reachable only through their owners and make package inventories prove
composition exclusions.

Use typed cross-platform build modules behind the supported root commands.
Introduce a package, workspace, compiler, bundler, alias, or emitted declaration
boundary only when its independent ownership and measured benefit exceed the
new graph and maintenance cost.

The step is complete when the fast development path and release path consume
the same authorities without acquiring different module semantics.

## 3. Admit dependencies deliberately

For every production dependency, record purpose, owning process, exact
version/source/license, local-alternative rationale, lifecycle scripts,
native/network/transitive risk, bundle treatment, and update/removal owner.
Update the lock immutably and keep lifecycle scripts deny-by-default. Bundle
pure JavaScript into the owning process; declare every external native artifact.

Treat an Electron major, native ABI, Rust toolchain, protocol schema, Forge
maker, or packaging-layout change as release requalification. The step is
complete when affected runtime, packaged, platform, provenance, and license
gates are identified and pass.

## 4. Generate from one authority

Derive schemas, catalogs, fingerprints, validators, localization indexes, and
package metadata deterministically from their handwritten authority. Commit
only stable reviewed or externally consumed artifacts and fail clean
regeneration on drift. Produce TypeScript and Rust native-protocol views from
the same language-neutral schema and retain runtime validation.

The step is complete when source, committed artifacts, runtime output, and
package inventory agree and no generated file has a second editor.

## 5. Prove the narrow runtime first

Run the smallest focused gate, then widen according to the boundary crossed:

1. interface-focused Node test;
2. real Chromium fixture or interaction test;
3. real Electron process test;
4. final-package inventory, fuse, integrity, smoke, and security test;
5. target-native Windows/macOS conformance;
6. physical-device certification for claims CI cannot reproduce.

Keep visual evidence pinned to the accepted renderer/platform matrix and review
baseline changes as artifacts. Linux checks never establish a supported native
claim. The step is complete when the exact shipping shape, rather than only
development output, proves every changed security or platform property.

## 6. Package and release closed artifacts

Let esbuild finish explicit process bundles before Forge packaging. Keep
application code in ASAR and unpack only declared native/helper resources.
Apply and verify accepted fuses before signing. Audit the complete payload for
source, maps, symbols, dumps, development files, undeclared binaries, notices,
SBOM entries, and target-specific inclusions and exclusions.

Keep unsigned payload verification separate from protected signing and
notarization. Record the clean revision, tools, locks, input hashes, generated
parity, target tuple, native identities, unsigned manifest, attestations, and
final hashes. Never install, restart, or downgrade through the updater during
active, paused, or continuity-unresolved participation, and do not stage an
update while CandidateWindow is active.

The work is complete when a clean protected CI run can reproduce the unsigned
payload, establish the declared platform evidence, and trace every shipped file
to an accepted authority.
