# Toolchain and release architecture

## Scope

The toolchain preserves Proctor's source, process, security, and verification
boundaries from a developer edit through a signed desktop release. It favors a
small inspectable graph over VS Code's historical build estate.

The renderer remains plain TypeScript, DOM APIs, and owned CSS. Build tools do
not select product contributions, weaken process isolation, or turn source
layers into separately versioned packages.

## Package and toolchain authority

Desktop TypeScript, build modules, and tests use one private root npm package
and one committed root lockfile. `base`, `platform`, `editor`, `workbench`, and
`code` remain source-graph layers rather than npm packages. npm workspaces are
not part of the initial architecture.

The repository currently pins exact Node, npm, Electron, TypeScript, esbuild,
and Rust releases. Electron Forge remains the accepted packaging owner but has
not been admitted or pinned yet. CI installs JavaScript dependencies with `npm
ci`. Dependency lifecycle scripts use an exact deny-by-default allowlist.

Native source uses one pinned Rust workspace and lockfile. The workspace is a
dependency and reproducibility authority, not one native product: each
capability package remains independently buildable, testable, signable, and
shippable. Shared crates contain only bounded protocols or runtime mechanics
behind narrow independently reviewable contracts. Such a crate may land with
its first capability consumer when the boundary is authoritative and intended
for reuse; capability-specific OS behavior remains in the capability package.

## TypeScript and module graph

Application TypeScript is one strict NodeNext ESM graph under `src/prctr/`.
Imports are relative, include their output `.js` extension, and use no path
aliases. A TypeScript module imports CSS only when it owns the corresponding
DOM. Static checks independently enforce the accepted layer direction and the
runtime-folder API boundaries.

TypeScript checks correctness without emitting application code. Separate
environment projects cover:

- `common`;
- `browser`;
- `worker`;
- `node`;
- `electron-browser`;
- `electron-main`;
- `electron-utility`.

Project references and declaration boundaries require measured graph pressure;
they are not used to manufacture package APIs between the five source layers.
The root solution-style configuration is an editor discovery index only: it
references the independent no-emit runtime projects without composite builds,
emitted declarations, or inter-layer package boundaries.

esbuild is the only application emitter and bundler. It produces incremental,
unbundled development output for focused debugging and explicit production
bundles for Electron main, every preload, each utility process, and every
approved renderer composition. Type checking remains an independent gate.
Node's built-in TypeScript stripping is limited to small build modules that use
erasable syntax and valid runtime imports.

## Entrypoints, CSS, and assets

Every production process and renderer starts from a closed Proctor-owned
entrypoint manifest. A remote value may select only among packaged capabilities;
it cannot provide a module path or contribution manifest. Package checks prove
AuthenticatedWindow and CandidateWindow exclusions as well as inclusions.

esbuild follows owned CSS, fonts, icons, images, and other static assets from
the entrypoint graph. The design-system cascade and DOM ownership remain source
contracts; bundling must preserve their deterministic order. Pure JavaScript
dependencies are bundled into their owning process output. Electron and Node
built-ins, declared native addons, and separately signed helpers are the only
external runtime dependencies.

## Deterministic generation and localization

Handwritten typed manifests remain authorities.
Deterministic generators derive runtime catalogs, lookup tables, fingerprints,
schemas, and package metadata without a parallel hand-maintained registry.

Stable human-reviewed or externally consumed interfaces, including the User
Settings JSON Schema, are committed and checked by clean regeneration. Internal
runtime artifacts remain build outputs. Every generated file names its source
authority and is never edited manually. One generator invocation produces the
committed and packaged views so they cannot drift.

User-visible messages have stable identifiers, English defaults, and validated
named placeholders. A deterministic extractor owns the translation catalog.
Translations are checked for identifier and placeholder parity and packaged
inside the signed application; candidate mode does not fetch catalogs. Locale
is resolved before composition and active candidate behavior follows the
Attempt's frozen Attempt Configuration plus current accessibility constraints.
Fallback, expansion, RTL, and privileged-process messages receive explicit
tests.

The implemented `localization-runtime` cluster exposes immutable Proctor
contexts with stable dotted identifiers and named placeholders. The registered
catalog generator statically extracts literal declarations and owns the
committed English runtime and translator views. A private positional adapter
preserves admitted VS Code module behavior without making VS Code NLS the
product interface; extension language packs and runtime catalog fetching remain
excluded.

The implemented `base-common-runtime` cluster retains the full reviewed static
closure rooted at lifecycle, events, cancellation, async scheduling, and
observables. Explicit modules remain the interface; there is no aggregate
barrel. Dedicated compiler projects retain the upstream class-field, namespace,
decorator, DOM, and unchecked-index semantics, while the pinned esbuild test
build executes the transferred owner suites under Node 24. Proctor substitutes
only the admitted localization and resource-root seams, and records
experimental APIs outside the closure as exclusions rather than replacing
admitted behavior with smaller implementations.

## Native and private protocol artifacts

Language-neutral JSON Schema files are authoritative for native observation and
enforcement DTOs, including the fixed privileged-helper handshake, source
configuration, and normalized event envelope. One generator registry produces
TypeScript and Rust types plus runtime validators. Generated types improve
callers but never replace validation. Generated Rust deserializers reject
unknown object fields rather than accepting an extension at a security
boundary.

Electron MessagePorts carry only schema-valid JSON-compatible structured-clone
values. Node-API bindings expose the same bounded DTO shapes. A separately
signed helper uses size-prefixed UTF-8 JSON frames on a private inherited
channel and rejects excessive frames before parsing. Each capability manifest
declares bounds, compatibility fixtures, target tuple, build toolchain, source
revision, artifact hash, and signature.

Observation Node-API modules belong only to passive sources in the security
utility process. The separate identity key-custody adapter is the narrow
Electron-main exception defined by the
[identity architecture](./identity-and-exam-security.md#desktop-authorization-and-installation-proof):
it exposes a public key, bounded digest signing and deletion, with no private-key
export or observation/policy behavior. Required privilege, entitlement, native stability, or a
materially different fault boundary justifies a signed helper. A small
platform-native shim requires evidence that Rust cannot safely express the
needed operating-system API. Native code is never compiled at runtime and no
generic native bridge reaches a renderer.

## Electron packaging and hardening

Implementation begins on the current supported stable Electron patch, which is
then pinned with its checksum. Every Electron major or native ABI change
requalifies packaged Electron, preload, IPC, native, visual, and physical-device
behavior.

A pinned stable Electron Forge 7 release owns Electron acquisition, native
rebuilding, ASAR assembly, platform makers, signing hooks, and notarization
hooks. Forge uses no renderer-framework or bundler plugin; esbuild completes the
application graph before packaging. Proctor-owned checks remain authoritative
for entrypoints, inventories, security, and release evidence.

Production JavaScript and owned resources live in `app.asar`. Native addons,
signed helpers, and resources requiring ordinary filesystem semantics are
explicitly unpacked. The inventory rejects undeclared files, development
dependencies, upstream checkouts, source files, source maps, symbols, dumps,
and unexpected native binaries.

Before platform signing, package-time fuses:

- enable embedded ASAR integrity and cookie encryption;
- disable `runAsNode`, `NODE_OPTIONS`, and command-line inspector arguments;
- restrict application loading to the packaged ASAR.

Packaged tests verify the fuse values and ASAR integrity from the resulting
binary. Helper processes are explicit signed executables and never depend on
`ELECTRON_RUN_AS_NODE`.

## Supported release targets and updates

Initial secure-candidate platform families are Windows x64 and macOS arm64/x64;
macOS ships as a universal application. Linux is not a secure-candidate target,
and Windows arm64 requires a later support decision. Exact supported OS-version
ranges are not claimed until the signed release capability matrix records
packaged conformance. Unknown or unproven combinations fail candidate preflight.

The matrix records `enforce`, `observe`, or `unavailable` per native sub-
capability, schema, packaged adapter/helper identity, permission, OS version,
and architecture. Compilation or a passing mock never creates a claim. A failed,
skipped, flaky, stale, or absent required target result removes that entry or
blocks release instead of inheriting a prior result.

Central Proctor distribution owns the signed installers and update feeds.
Windows uses signed Squirrel installation and update packages. macOS uses a
hardened, signed, notarized DMG and a signed ZIP update feed. Stable and pilot
are the only release channels initially. An Institution server publishes safe
Desktop compatibility and build-revocation policy; it does not distribute
executables. The accepted process/session expansion includes one signed,
version-matched Windows service and one entitled macOS Endpoint Security
component with required approvals. Their installation, update, rollback,
signature, service/extension lifecycle, and removal are explicit installer and
release responsibilities rather than hidden lifecycle hooks. Neither component
starts observation outside an admitted native source session.

The privileged main-process updater verifies central feed identity, channel,
signature, version direction, compatibility, and payload hash. It may download
and stage only outside active or paused participation. Installation and restart
are forbidden while CandidateWindow is active or continuity is unresolved.
Institution system ping supplies the supported Desktop release range; candidate
admission additionally requires the applicable signed capability matrix. A
critical mid-Attempt revocation follows exam-security policy rather than
silently restarting the product. Downgrade requires an explicitly approved,
signed release.

The server evolves `/api/v1` additively and Desktop tolerates unknown additive
fields/events/reasons. An Institution may still raise its minimum Desktop
release for security. A too-new result remains explicit even though backward-
compatible server releases should make it rare.

Security policy, native source, enum, schema, and capability-matrix values are a
stricter boundary: an unknown required value fails explicitly instead of being
ignored as an additive field.

## Verification ladder

Verification follows the narrowest runtime capable of proving the behavior:

1. Node's built-in runner covers environment-neutral and Node interfaces.
2. Real Chromium covers DOM behavior and Control Explorer fixtures.
3. Real Electron covers preload, IPC, lifecycle, renderer isolation, and window
   enforcement.
4. The final package receives smoke, inventory, fuse, integrity, and security
   tests.
5. Target-native Windows and macOS jobs run adapter and package conformance.
6. Physical devices certify display, permission, session, window, and other
   behavior virtualized CI cannot prove.

Chromium is the supported browser engine because Electron ships it. Firefox and
WebKit compatibility are not product claims.

Windows 11 x64 Electron and macOS arm64 Electron own canonical product visual
baselines. Shared controls additionally use deterministic Chromium fixtures
with the Electron Chromium major, fonts, scale, locale, timezone, motion, and
color profile pinned. macOS x64 receives semantic, interaction, accessibility,
and targeted visual coverage; a separate full baseline is added only for
observed rendering differences. High contrast, forced colors, zoom, reduced
motion, focus, and critical candidate-security states have explicit evidence.
Baseline changes require reviewed artifact diffs.

## Dependency and release provenance

Every production dependency has a reviewed admission record containing its
purpose, owning process, local-alternative rationale, exact version, source,
license, lifecycle scripts, native and network behavior, transitive risk,
bundle treatment, and update/removal owner. Automated vulnerability and license
checks complement this review. CI actions are pinned to full commit SHAs.

Reproducibility means repeatable inputs and unsigned package payloads, not
byte-identical signed installers. A release records:

- the clean repository revision and pinned toolchains;
- dependency locks and downloaded-input hashes;
- generated-artifact parity;
- target OS and architecture;
- native schema, protocol, and artifact identities;
- an unsigned package-content manifest and SBOM;
- signing, notarization, and installer attestations;
- final distributable hashes.

Production source maps and native symbols are stored privately by build
identity and never shipped. Renderer symbolication follows privacy filtering.
Security-utility/native symbols and crash dumps are more restricted evidence;
dumps require explicit support authorization and are never uploaded
automatically.

GitHub Actions owns initial CI. Linux may run inexpensive source checks but
cannot establish supported-platform behavior. Current Windows and macOS jobs
run native-source verification and the real Electron security-utility bridge;
that development-runtime evidence establishes no packaged platform claim.
Windows x64 and macOS arm64/x64 jobs will own package and native claims once the
packaged target gates exist. Unsigned verified payloads enter protected signing
jobs whose credentials are unavailable to pull requests and ordinary builds.
Releases are produced only by clean protected CI workflows.

## Command contract

The foundation currently exposes `check`, focused repository checks,
`check:types`, `generate`, `inspect`, the checker test suite, and a typed
`test:native` entrypoint. `build:security-utility` compiles the native Node-API
addon and exact Electron-main/utility test bundles. `test:security-utility`
proves the process-neutral private protocol, while `test:electron` runs the
real Electron/Node-API lifecycle. `build:browser-harness` bundles a sandboxed
plain-DOM fixture against Electron's exact Chromium major, and `test:browser`
verifies DOM execution, locale/direction control, and absence of ambient Node.js
through that real renderer. `test:base` compiles and executes the localization
tests and transferred base-common owner suites, including deterministic virtual
time, disposal/leak tracking, cancellation, event ordering, async scheduling,
resources, URI behavior, and observables. These are development-runtime commands,
not package or release gates. Native tests accept an exact workspace-package focus and a
built-in Rust target selector; command help and configuration own their exact
flags and implemented behavior.

As their first real consumers land, the root package will extend that small
cross-platform vocabulary with:

- `dev` and `build`;
- additional focused runtime checks where an independent boundary needs one;
- `test:package` and focused browser-fixture selectors when multiple fixture
  families justify them;
- `package` for one declared target;
- `check:release` for the exhaustive packaged target gate.

Scripts call typed platform-neutral build modules rather than containing large
shell programs. Failures name the owning module, manifest, schema, capability,
or target. `check` remains fast enough for normal local use;
`check:release` proves the final package. Configuration and command help own
exact flags once implemented.

## Deferred release facts

The release capability matrix will name exact supported OS-version ranges and
physical-device evidence. Signing identities/providers, central artifact
publication, and support-artifact retention remain deployment decisions.
Institution compatibility endpoints carry policy metadata only. These facts may
specialize this architecture but cannot weaken its package, admission, update,
privacy, or evidence boundaries.

VS Code supplied build and verification evidence for these decisions. Exact
admitted source relationships live only in the VS Code ports registry.
