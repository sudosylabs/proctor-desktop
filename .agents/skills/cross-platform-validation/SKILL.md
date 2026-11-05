---
name: cross-platform-validation
description: Choose and report evidence for Proctor Desktop changes that behave differently on Windows, macOS, or Linux, including native observation, enforcement, packaging, and CI. Use when a change touches platform branches, native packages, packaging, or claims that a platform works.
---

# Cross-platform validation

Proctor Desktop targets Windows and macOS for candidates. Read
[`native-capabilities`](../../../docs/architecture/native-capabilities.md) and
[`toolchain`](../../../docs/architecture/toolchain.md) for the supported matrix and
the packaged verification rules, and use `develop-native-capabilities` for the
capability itself.

## 1. Name what the change can break

List the platform branches, native crates, Electron APIs, filesystem or path
rules, and permissions the change touches. Shared contracts need evidence beyond
the development machine; a change to one platform's adapter needs that adapter's
checks plus the shared contract tests, not the whole matrix as a ritual.

This step is complete when each affected platform and capability is named.

## 2. Choose the environment

| Environment | Establishes | Does not establish |
|---|---|---|
| Native run on the development OS | That OS's behavior for the exercised paths | The other OSes |
| Linux container or CI runner | Portable code, type, lint, and headless renderer behavior | Windows or macOS native behavior, real permissions, displays, input |
| Cross-compile or link | Target compilation and ABI compatibility | Target runtime behavior |
| Native Windows or macOS runner | That OS's runtime scenarios actually run | Hardware, interactive-session, or OS versions the runner lacks |
| Packaged build on the target OS | The shipped artifact starts, enforces, and reports | Other architectures or OS versions |

Record the OS version, architecture, toolchain, and permissions each result came
from. A configured CI matrix, a successful cross-compile, or a pass on the
development machine is not evidence that another platform works.

## 3. Exercise the capability, not only the code

For native capabilities, cover the supported state, the unavailable state, real
permission denial and revocation, teardown, and fallback. Use temporary profiles
and avoid changing the machine's real grants. Passive observation sources report
facts; the coordinator applies policy, so test the boundary you changed.

## 4. Report

State, per platform, what ran, what passed, what could not run, and why. Name
missing prerequisites exactly (for example, no Windows runner, Electron not
provisioned with `npm run setup`). Finish the work that does not need the missing
environment and leave the rest explicitly unverified.
