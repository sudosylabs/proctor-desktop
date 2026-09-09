# Development environment

Use the Node version in `.nvmrc` and the npm version in `package.json`. Install
the locked graph with `npm ci`, then use `npm run setup` to explicitly prepare
the pinned Electron distribution. Installation does not format source, install
Git hooks, change Git preferences, or build native code.

Run `npm run doctor` to inspect prerequisites. If npm refuses an incompatible
runtime before launching the script, run `node scripts/doctor.ts` directly.
The doctor only reads local state and queries installed tools; it does not
download Electron or install a Rust toolchain. Native builds additionally need
the components in `rust-toolchain.toml` and platform compiler tools.

## Editing and verification

Accept the workspace TypeScript SDK when the editor prompts. The root
`tsconfig.json` is an editor discovery index; each referenced runtime remains
an independent no-emit compiler check. It is not a `tsc --build` graph and does
not introduce declaration boundaries or Node globals into browser projects.

`npm run check` runs types, correctness lint, formatting verification, repository
controls, licenses and all Node suites. `npm run check:all` additionally runs
real Electron and native verification. Linux Electron tests need a graphical
session or `xvfb-run`. These commands provide development-runtime evidence, not
packaged platform certification. Use `node scripts/test.ts --help` for focused
suites; each suite builds its own prerequisites and rejects empty selections.

## Formatting and lint ownership

Prettier formats handwritten Proctor files; `npm run format:check` is read-only
and `npm run format` writes reviewed mechanical changes. The generated
`.prettierignore` derives exact transferred-file paths from port manifests and
generated outputs from the generator registry. Run `npm run generate` when
those authorities change. Transferred code retains its recorded formatting;
generated code retains its generator's bytes. Existing provenance and generation
checks remain authoritative. Neither formatter nor lint fixes refresh hashes.

Correctness lint covers source, tests and tooling. Proctor-authored TypeScript
also receives type-aware promise checks. Transferred implementations retain an
upstream-compatible syntax/lifecycle profile, not an exemption from lint.
Applicable upstream lint directives are interpreted only inside manifest-owned
files, with source locations preserved; directives for uninstalled upstream
product rules are inert. Their original bytes remain digest-checked. Upstream
test fixtures deliberately exercise constant truth tables and unusual control
flow; Proctor's stricter authoring rules do not rewrite those test contracts.

Node's test runner owns top-level registration promises, which are explicitly
discarded with `void`; asynchronous assertions and cleanup remain awaited.
Lint's optional `--fix` command only writes handwritten, non-transferred files
and rechecks the actual disk contents afterward.

## Optional commit check

`npm run hooks:enable` opts this checkout into the tracked check-only hook.
It refuses to replace another configured hook. `npm run hooks:disable` removes
only that local opt-in. Nothing enables hooks during dependency installation.

The hook reads staged bytes, checks hygiene, formatting and syntax-level lint,
and never rewrites files or changes staging. Tooling/configuration must match
between the index and working copy so the executed policy is unambiguous.
Type-aware analysis and the complete test suite belong to `npm run check` and
CI, not to a misleading mixture of staged source and unstaged dependency types.

## Real-server identity development

`npm run dev -- --allow-http-loopback` builds the native identity adapter and
opens LaunchWindow with real ping, discovery and authentication requests. Omit
`--allow-http-loopback` for HTTPS-only operation. HTTP is limited to loopback,
and cannot enter a production Candidate Attempt. Use `--release` and `--build-id`
when the Institution build catalog requires specific selectors; `npm run dev --
--help` describes their defaults. The server must advertise a compatible Desktop
Authorization protocol and a matching canonical public origin.

This entrypoint uses a separate Proctor Development application data directory.
A single-instance lock protects its rotating credentials; another launch focuses
the existing window.
Native non-exportable key custody and OS-encrypted refresh storage are mandatory.
`npm run preview:launch` remains a visual fixture with sample responses and cannot
prove server sign-in. `npm run test:desktop-identity` builds and exercises actual
native signing, encrypted storage and the sandboxed window transition against
isolated contract responses. Run that gate on each supported target; macOS results
do not establish Windows or signed-package conformance.
