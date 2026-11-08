---
name: source-code-organization
description: Place and review Proctor Desktop source modules, services, contributions, environment-specific implementations, Electron entrypoints, tests, CSS, assets, and native packages. Use before creating or moving code under src/prctr, adding a service or contribution, choosing a layer or runtime folder, or reviewing dependency direction.
---

# Source code organization

Place code by ownership and allowed dependencies. Do not mirror an upstream path
until the local role is understood.

## 1. Identify the owner

State the behavior, its callers, the state it owns, and the process where it must
run. The step is complete when one module can own the behavior behind a small
interface.

## 2. Choose the layer

Application code lives under `src/prctr/`:

- `base`: dependency-free utilities and browser UI primitives;
- `platform`: shared service contracts and runtime adapters;
- `editor`: editor machinery independent of product workflows;
- `workbench`: shell, cross-feature services, and user-visible contributions;
- `code`: Electron entrypoints and process composition.

Dependencies flow `code → workbench → editor → platform → base`. A layer may
skip lower layers it does not need. The step is complete when the proposed path
and every new import respect this direction.

## 3. Choose the environment

Use the narrowest API set:

- `common`: environment-neutral JavaScript;
- `browser`: DOM and browser APIs;
- `node`: Node.js APIs;
- `electron-browser`: renderer plus mediated Electron integration;
- `electron-utility`: Node.js and Electron utility-process APIs;
- `electron-main`: Node.js and Electron main-process APIs.

These folders apply in `base`, `platform`, `editor`, `code`, and
`workbench/services`. A Proctor-authored `workbench/contrib/<feature>` is
renderer code without environment folders: the source policy's
`defaultEnvironments` classifies it as `browser`, and a `common/` folder inside
it holds only DOM-free modules that Node tests import. Ported VS Code clusters
keep their upstream folders.

Keep Electron, Node.js, and native handles below environment-neutral and
renderer interfaces. The step is complete when the folder name matches the APIs
actually imported.

## 4. Choose the product mechanism

Use a platform service for a stable capability shared by higher layers. Use a
workbench service for cross-feature product behavior. Use
`workbench/contrib/<name>` for one user-visible capability. A window's own frame
lives beside the shell: `workbench/browser/launch/` for LaunchWindow and
`workbench/browser/authenticated/` for AuthenticatedWindow, whose navigation
contract is `workbench/services/authenticatedNavigation`.

Lay a contribution out by what each part is, as `workbench/contrib/account/`
does:

```
contrib/<feature>/
  <feature>.contribution.ts  the registration; the window creates its class at its phase
  <feature>Pane.ts           the pane, beside its page registry, pane context and services
  <feature>Messages.ts       shared text; a page's own text lives in the page's folder
  media/                     the root's styles
  common/                    DOM-free modules that Node tests import
  widgets/                   building blocks every page uses
  <page>/                    one folder per page: the page, its dialogs, messages, media/
```

Identify each service with `createDecorator` beside its interface. Register
window services in the window's composition root under
`src/prctr/code/electron-browser/` (for AuthenticatedWindow,
`authenticatedServices.ts`) through `WorkbenchBootstrapOptions.services`; never
with `registerSingleton`. A service bound to one pane's DOM goes in a child
instantiation service the pane creates.

Place the stable identity contract and renderer projection client in
`platform/identity`; place attempt-scoped exam-security orchestration in
`workbench/services/examSecurity` and its renderer presentation in
`workbench/contrib/examSecurity`. Keep privileged implementations in the
narrowest accepted environment folder and select them from `code` composition
roots.

Give language-neutral observation protocols `platform` common ownership, the
privileged coordinator `workbench` service ownership in `electron-utility`, and
candidate-window and permission effects focused `platform` service ownership in
`electron-main`. Launch the coordinator from a `code` Electron-main composition
root. Keep platform-native implementation packages capability-first and outside
renderer dependency closure; use
[`develop-toolchain`](../develop-toolchain/SKILL.md) for their Rust workspace,
schemas, target artifacts, and package layout.

Give each contribution one registration entrypoint. Keep its implementation
private. Route cross-contribution behavior through one narrow shared contract or
an owning workbench service; `source.graph` rejects an import from one
contribution into another and from the shell or services into a contribution.
Import contributions only from Proctor-owned manifests and window composition
roots.

Keep static setting declarations, JSONC grammar, resolution,
inspection, generated-schema inputs, and immutable projections under
`src/prctr/platform/settings/common/`. Keep privileged settings transport and
protected-cache ownership in Electron main. Put the editing surface in
`src/prctr/workbench/contrib/account/settings/`, the window presentation in
`src/prctr/workbench/contrib/settings/`, and select them only from the
authenticated manifest and `src/prctr/code/electron-browser/authenticated.main.ts`.
Use [`develop-user-settings`](../develop-user-settings/SKILL.md) for its
authority, Attempt Configuration, and interface rules.

Keep browser policy/activity contracts and canonicalization under
`src/prctr/platform/integratedBrowser/common/`, privileged Electron session and
protected-spool adapters under the narrow Electron-main environment, Attempt-
scoped coordination under `src/prctr/workbench/services/integratedBrowser/`,
and the item/pane under `src/prctr/workbench/contrib/integratedBrowser/`. Use
[`develop-integrated-browser`](../develop-integrated-browser/SKILL.md).

Use these aggregate manifest locations when workbench source lands:

- `src/prctr/workbench/workbench.common.main.ts` for mechanics shared by every
  authenticated/candidate workbench;
- `src/prctr/code/electron-browser/workbench.desktop.main.ts` for shared
  Electron-renderer adapter selection;
- `src/prctr/code/electron-browser/launch.main.ts` for the signed-out
  LaunchWindow allowlist;
- `src/prctr/code/electron-browser/authenticated.main.ts` for the general
  AuthenticatedWindow allowlist;
- `src/prctr/code/electron-browser/candidate.main.ts` for the candidate
  contribution allowlist.

Place integrated-browser policy/enforcement/activity modules behind their focused skill. Their renderer contributions enter only
the candidate manifest; privileged adapters remain outside renderer closure.

Load an optional packaged capability through a literal, statically discoverable
import reachable from an approved window manifest. A remote value may select only
among packaged capabilities; it never supplies a manifest or module path.

Keep concrete adapter selection in the composition root. Create separate
native packages for accepted passive observation families. For the explicitly
accepted Electron-main identity key-custody adapter, follow the narrow exception
in [identity architecture](../../../docs/architecture/identity-and-exam-security.md#desktop-authorization-and-installation-proof)
and the [toolchain boundary](../../../docs/architecture/toolchain.md); keep that
adapter separate from observation and policy packages. Give policy
evaluation and product effects their existing privileged owners rather than
adding them to that package. Use
[`develop-native-capabilities`](../develop-native-capabilities/SKILL.md) for the
source-session, process, privacy, failure, and platform-verification contract.

## 5. Place supporting material

Co-locate renderer CSS with the owning module family, under its `media/`
folder. Put tests under root `test/`, mirroring the source path
(`test/workbench/contrib/account/common/` tests
`src/prctr/workbench/contrib/account/common/`); Chromium-harness suites live in
`test/browser/` and build the class under test through a test instantiation
service with typed doubles of its services.
Put product assets under `resources/`, build implementation under `build/`, and
human-facing commands under `scripts/`.

## 6. Verify

Inspect the resulting import direction, runtime API use, contribution
registration, adapter ownership, test surface, and CSS ownership. Update this
skill and the concise root summary when an accepted organization rule changes.

If the placement depends on VS Code behavior, also use
[`adapt-vscode`](../adapt-vscode/SKILL.md) before treating the design as settled.
