---
name: develop-native-capabilities
description: Design, implement, or review Proctor Desktop native observation sources, OS adapters, source sessions, native permissions, candidate-window enforcement, security-utility supervision, private native IPC, display/process/session/connectivity monitoring, source health or backpressure, and Windows/macOS conformance. Use before adding a native package, helper, addon, proctoring OS event, Electron main/utility native boundary, or native-capability test.
---

# Develop Native Capabilities

Keep native packages passive, bounded, and mechanically truthful while the
privileged exam-security module owns interpretation and policy.

## 1. Load the accepted boundary

Read the
[native capability architecture](../../../docs/architecture/native-capabilities.md),
[identity and exam-security architecture](../../../docs/architecture/identity-and-exam-security.md),
and [architecture invariants](../../../docs/architecture/invariants.md). Use
[`source-code-organization`](../source-code-organization/SKILL.md) before
placing source or packages. Use
[`develop-identity-and-exam-security`](../develop-identity-and-exam-security/SKILL.md)
when changing policy, posture, containment, participation, evidence, or
renderer projection. Use [`adapt-vscode`](../adapt-vscode/SKILL.md) for any VS
Code comparison or source relationship. Use
[`develop-toolchain`](../develop-toolchain/SKILL.md) for Rust workspace,
schema generation, FFI, packaged artifacts, signing, or platform release work.

The step is complete when the caller, process, mechanical fact, policy owner,
effect owner, platform claim, and sensitive fields are explicit.

## 2. Classify the capability

Place behavior in exactly one role:

- a passive observation source produces mechanical snapshots, events, states,
  health, gaps, and resets;
- the `ExamSecurityCoordinator` normalizes facts and evaluates authenticated
  policy and packaged detectors;
- a closed enforcement adapter applies one product effect;
- the permission broker requests disclosed OS permission during setup or
  preflight;
- the composition root launches and wires concrete packaged adapters.

Keep exam identity, policy, accommodations, detector rules, posture, and
controls out of observation packages. Keep renderer presentation and intents
out of native protocols.

The step is complete when the proposed interface cannot become a generic native
host or shift policy into a source.

## 3. Define a race-free source session

Open one session that returns source/adapter/schema versions, platform and
permission state, a fresh source-instance identifier, health, and a complete
snapshot at sequence `N`. Deliver ordered observations strictly after `N` and
buffer transitions produced while the snapshot is built.

Use per-source monotonic sequences, device wall and monotonic time, bounded
payloads, explicit gaps and resets, and idempotent disposal. Give the source
only an opaque collection-session identifier, requested schema, selected
mechanical categories, and resource limits. Let the coordinator attach trusted
Session, Attempt, participation, and policy provenance.

The step is complete when startup, steady state, restart, overflow, and disposal
have unambiguous sequences without a query-subscribe race.

## 4. Minimize collection and throughput

Give every field a mechanical purpose, classification, bound, and retention
path. Normalize high-volume facts before they become evidence. Keep raw
inventories ephemeral and keep content-bearing fields out unless a separately
accepted capability explicitly requires them.

Use fixed queues. Keep OS callbacks non-blocking, prioritize health and effect
acknowledgements, coalesce replaceable state, preserve meaningful transition
order, and emit a missing range on overflow. Treat required-source overflow as
source failure rather than misconduct.

The step is complete when memory, CPU, event rate, payload size, logging, and
loss behavior remain bounded under a sustained event storm.

## 5. Place the privilege boundary

Keep orchestration in the dedicated exam-security utility process. Keep
BrowserWindow lifecycle and other Electron-main-only effects in closed main
adapters. Introduce a signed helper only for required privilege or entitlement,
native fault isolation, or a materially different security boundary.

Launch exact packaged entrypoints and connect them through fixed, typed,
versioned, bounded private protocols. Verify build and source manifests,
protocol/schema compatibility, participation generation, and a single-use
challenge. Keep secrets out of arguments and environment variables and keep
ports undiscoverable by renderers.

The step is complete when every process can be killed independently with one
defined non-authorizing result and no renderer can select a module, channel,
command, path, or native handle.

## 6. Preserve failure and cleanup semantics

Block on required source, permission, process, port, heartbeat, topology, or
effect-verification loss. Make bounded restart create a new source instance and
gap, then repeat all preflight checks; restart never restores readiness alone.

On authoritative departure, stop input, record the terminal sequence, seal the
session, finish permitted delivery, remove callbacks, close handles and ports,
erase queues and session material, then release candidate-window constraints.
Keep abnormal loss on the containment and participation-interruption path.

The step is complete when normal departure, renderer restart, source restart,
utility crash, forced process loss, shutdown, and partial cleanup each have one
idempotent outcome.

## 7. Verify the real claim

Add contract tests, a shared adapter conformance suite, packaged Windows/macOS
integration tests, hostile cross-process tests, and product security scenarios.
Cover snapshot ordering, gaps, permissions, display and mirror topology,
virtual/remote targets, process and session changes, candidate-window drift,
hot-plug, overload, hang, crash, restart, renderer isolation, sensitive-data
absence, normal release, and forced-loss re-entry.

Use mocks for coordinator behavior, not for a native platform guarantee. Update
the release capability matrix for every supported OS/version, architecture,
adapter, permission, limitation, and physical-device verification result.

The work is complete when implementation, schemas, packaged adapters, process
composition, diagnostics, tests, and the capability matrix assert the same
bounded behavior.
