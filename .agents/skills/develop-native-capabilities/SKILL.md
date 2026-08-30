---
name: develop-native-capabilities
description: Design, implement, or review Proctor Desktop native observation sources, OS adapters, source sessions, permissions, candidate-window enforcement, security-utility supervision, private IPC, display, process/application, interactive-session, clipboard, printing, removable-storage, virtualization, network, camera/microphone, source-health, backpressure, or packaged platform conformance. Use before adding a native package, helper, addon, proctoring OS fact, Electron main/utility native boundary, or native-capability test.
---

# Develop Native Capabilities

Keep native packages passive, bounded, and mechanically truthful while the
privileged exam-security module owns interpretation and policy.

## 1. Load the accepted boundary

Read the
[native capability architecture](../../../docs/architecture/native-capabilities.md),
[native capability family contracts](../../../docs/architecture/native-capability-families.md),
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

Before implementation, state separately whether the capability is accepted,
implemented in source, proven in a packaged build, and supported on a concrete
OS/architecture tuple. Architecture acceptance alone is never an implementation
or release claim.

Inspect the generated source manifest and
`src/prctr/platform/native/common/nativeCapabilityRegistry.ts` before adding a
family or sub-capability. Observation and helper wire changes start in
`native/schemas/`; generated Rust/TypeScript files are never edited directly.

## 2. Classify the capability

First classify the exact sub-capability, policy mode, and target claim. The
accepted first-release families include the existing window/display/permission/
remote-session baseline plus process/application, interactive OS sessions,
private clipboard and clipboard-change observation, printing, removable
storage, bounded virtualization/network state, and camera/microphone endpoint
state. Global external screen-capture detection is unavailable on the initial
targets; content collection, keystroke logging, packet/DNS capture, and general
system-browser history are outside this boundary.

Use `disabled`, `observe`, or `enforce` exactly as defined by the family
contracts. State `enforce`, `observe`, or `unavailable` per sub-capability,
schema, packaged adapter/helper, permission, OS version, and architecture.
Never infer family-wide support from one working fact.

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
host or shift policy into a source, and every requested claim is either backed
by the target matrix or explicitly unavailable.

## 3. Define a race-free source session

Open one session that returns source/adapter/schema versions, platform and
permission state, a fresh source-instance identifier, health, and a complete
snapshot at sequence `N`. Deliver ordered observations strictly after `N` and
buffer transitions produced while the snapshot is built.

Use per-source monotonic sequence/time, bounded payloads, explicit gaps and
resets, and idempotent disposal. Let the privileged delivery layer add wall-
clock context. Give the source only an opaque collection-session identifier,
requested schema, selected mechanical categories, adapter variant, and resource
limits. Let the coordinator attach trusted Session, Attempt, participation, and
policy provenance.

Treat notifications as reconciliation wakeups. Require a complete snapshot after
startup, resume, helper/source restart, session or namespace change, permission
change, and detected event loss. Fence the old generation before accepting the
replacement.

The step is complete when startup, steady state, restart, overflow, and disposal
have unambiguous sequences without a query-subscribe race.

## 4. Minimize collection and throughput

Give every field a mechanical purpose, classification, bound, and retention
path. Normalize high-volume facts before they become evidence. Keep raw
inventories ephemeral and keep content-bearing fields out unless a separately
accepted capability explicitly requires them.

Keep clipboard content, frames, audio, keystrokes, command lines, arbitrary
paths, window/document/printer names, account identifiers, device serials,
mount paths, SSIDs, network addresses, proxy URLs, packets, DNS history, and
general system-browser history out of native DTOs. Use registered catalog IDs,
relative classifications, and Attempt-scoped pseudonyms where the accepted
family contract permits them.

Use fixed queues. Keep OS callbacks non-blocking, prioritize health and effect
acknowledgements, coalesce replaceable state, preserve meaningful transition
order, and emit a missing range on overflow. Treat required-source overflow as
source failure rather than misconduct.

During an initial platform probe, degrade only an ordinary backend discovery
failure from the authoritative initial query to explicit unavailable coverage.
Register the worker or callback before that query and roll it back before
opening the unavailable subscription. Do not use a successful preliminary
probe to excuse failure of a later initial query. Propagate worker setup,
inventory, protocol, queue, and cleanup failures unchanged. Recheck the
process-wide poison fence after every completed source open, including the final
selected source, before publishing readiness.

Carry independently selectable storage, network, clipboard, and media categories
through the private source-open contract. Require a non-empty category selection
for every selected multi-category source and no categories for an unselected
source. Keep the category type and fixed order generated from the shared native
observation schema for both TypeScript and Rust; do not duplicate that contract
inside a bridge or validator. Do not query or emit a native category that the
frozen selection omitted.

The step is complete when memory, CPU, event rate, payload size, logging, and
loss behavior remain bounded under a sustained event storm and raw fields
cannot escape through diagnostics, evidence, or renderer projection.

## 5. Place the privilege boundary

Keep orchestration in the dedicated exam-security utility process. Keep
BrowserWindow lifecycle and other Electron-main-only effects in closed main
adapters. Full accepted process/session coverage uses the signed Windows ETW/WTS
service or approved macOS Endpoint Security component described by the
architecture. Keep either installed but dormant outside source sessions; a
missing service, entitlement, approval, Full Disk Access grant, version, or
signature makes its dependent claim unavailable.

Snapshot-only process or session adapters may support observe-mode
reconciliation when their DTOs carry partial certainty and unavailable
executable identity. They never substitute for lifecycle coverage, application
authorization, or enforced session exclusivity. Keep raw PIDs, creation times,
account values, application pointers, and platform session identifiers inside
the adapter and emit only opaque source-session identities and bounded relative
classifications. Require PID plus a stable OS creation/launch generation for
snapshot process correlation; omit an entry rather than falling back to PID-only
or a transient platform object address. Treat only `WTSActive` as Windows
console ownership while retaining other human sessions in the bounded inventory.

Treat camera and microphone as two permission capabilities even though they
share the `media-device` source lifecycle. Electron main may inspect both and
may request them only through the explicit candidate preflight action. A media
source may inspect current permission state but must never invoke an OS prompt
or open a content stream as a side effect of observation. Bind inspection,
requests, and the seal to the exact selected source/category set, and reject a
launch whose selection differs from the sealed preflight. Derive any shared
media snapshot permission conservatively from the selected endpoint categories;
it must not report granted while a selected endpoint is denied, restricted,
undetermined, or unavailable.

Launch exact packaged entrypoints and connect them through fixed, typed,
versioned, bounded private protocols. Verify build and source manifests,
protocol/schema compatibility, peer code identity, OS access control,
participation generation, and a broker-generated single-use nonce. Bind peer
identity to the live process or to a verified non-replaceable executable handle
retained across spawn; a second path lookup is not a post-spawn identity proof.
Use one absolute launch deadline across executable verification, spawn, live-
process verification, private-channel setup, and handshake. Give every later
request/response its own absolute deadline, terminally fence and kill on
the first protocol/transport failure, and return an ordered close tail with the
final snapshot. Helper queues have capacity for both a survivor and an explicit
overflow gap. Use literal discriminated client and server envelopes. Give
helpers bounded event classes and limits rather than policy
or product identity. Keep secrets
out of arguments and environment variables and keep ports undiscoverable by
renderers.

Never treat a kill request as proof of helper exit. Observe termination within
the fixed deadline; kill failure, unobserved exit, or a verifier worker that
outlives startup poisons the utility and forbids another helper launch until the
supervisor replaces the process. Keep `inventory_overflow` distinct on helper
failure wires. Clear transient native identity buffers within a fixed bound;
oversized cleanup runs only behind the shared cleanup deadline and poisons the
utility when completion cannot be proved.

Use `prctr-native-helper-protocol` only for the generated process/session helper
handshake, operational source configuration, frame boundary, verified-peer
binding, and normalized facts. Its presence does not imply that a helper
executable, OS peer verification, entitlement, signed service, or platform
claim exists.

The step is complete when every process can be killed independently with one
defined non-authorizing result and no renderer can select a module, channel,
command, path, or native handle.

## 6. Keep interpretation and effects closed

Let the `ExamSecurityCoordinator` validate the server-frozen effective policy,
compare the signed target matrix, match catalogs, run deterministic detectors,
manage occurrences, derive posture, request containment, and minimize evidence.
Let Electron main own permission prompts and Proctor-owned effects. Native
sources never receive policy modes, allowlists, exceptions, consequences, or
server identity.

Apply provisional `checking` containment for a high-confidence event only while
complete reconciliation runs; create no occurrence until the condition is
confirmed. Keep observe-mode conditions non-blocking. Aggregate independent
enforce conditions into one safe correction overlay without suspicion scoring.
Automatically mutate only CandidateWindow gates, private clipboard, candidate
print commands, and content protection.

The step is complete when policy tests can replace every native source with a
mechanical in-memory port and effect tests can replace the coordinator without
either side acquiring the other's authority.

## 7. Preserve failure and cleanup semantics

Block on required source, permission, process, port, heartbeat, topology, or
effect-verification loss. Permit one bounded automatic restart, create a new
source instance/generation and gap, then repeat all preflight checks; restart
never restores readiness alone and repeated failure cannot loop.

On authoritative departure, stop callback intake, fence the generation, drain
accepted facts, remove subscriptions, close handles and ports, emit terminal
health/cleanup, erase raw/queue/detector/private-clipboard state, seal permitted
delivery, then release Proctor-owned constraints. Leave applications, OS
sessions, devices, print jobs, networking, and host clipboard untouched. Keep
abnormal loss on the containment and participation-interruption path.

The step is complete when normal departure, renderer restart, source restart,
utility crash, forced process loss, shutdown, and partial cleanup each have one
idempotent outcome.

## 8. Verify the real claim

Add contract tests, a shared adapter conformance suite, packaged Windows/macOS
integration tests, hostile cross-process tests, and product security scenarios.
Cover snapshot ordering, gaps, permissions, display and mirror topology,
virtual/remote targets, remote sessions, rapid process bursts, multiple and
disconnected user sessions, clipboard generations, print retries, removable/
MTP reconnects, virtualization uncertainty, route churn, virtual media devices,
candidate-window drift, hot-plug, overload, hang, crash, restart, renderer
isolation, sensitive-data absence, normal release, and forced-loss re-entry.
Treat global external-capture detection as unavailable instead of approximating
it through process names, permissions, or UI indicators.

Use mocks for coordinator behavior, not for a native platform guarantee. Update
the release capability matrix per sub-capability for every OS/version,
architecture, packaged adapter/helper, permission, limitation, and physical-
device verification result. A failed, skipped, flaky, stale, or absent required
target result removes the claim or blocks release.

The work is complete when implementation, schemas, packaged adapters, process
composition, diagnostics, tests, and the capability matrix assert the same
bounded behavior.
