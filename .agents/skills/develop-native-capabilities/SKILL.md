---
name: develop-native-capabilities
description: Design, implement, or review Proctor Desktop native capabilities and their OS adapters, native rules and their evaluation, the native agent and its protocol with Electron main, readiness sessions, containment inputs, permissions, candidate-window enforcement, privileged components (macOS Endpoint Security extension, Windows service), the screen evidence recorder, display, window, session, process/application, clipboard, printing, removable-storage, virtualization, network, camera or microphone facts, or real-OS and packaged platform verification. Use before adding a capability, a rule field, a native crate or dependency, an OS fact, an agent message, or a native test.
---

# Develop Native Capabilities

Report true, bounded facts; evaluate the server's rules on them; let Electron main apply the effect
and the server decide.

## 1. Load the accepted boundary

Read the [native capability architecture](../../../docs/architecture/native-capabilities.md), the
[capability contracts](../../../docs/architecture/native-capability-families.md),
[native rules](../../../docs/architecture/native-rules.md), and the
[architecture invariants](../../../docs/architecture/invariants.md). Use
[`source-code-organization`](../source-code-organization/SKILL.md) before placing source,
[`develop-toolchain`](../develop-toolchain/SKILL.md) for crates, dependencies, generation and CI,
[`develop-identity-and-exam-security`](../develop-identity-and-exam-security/SKILL.md) for policy,
readiness, posture, containment or delivery, and
[`cross-platform-validation`](../cross-platform-validation/SKILL.md) for any platform claim.

State separately whether the capability is accepted, implemented in source, proven by real-OS
tests, proven in a packaged build, and supported on a concrete OS/architecture tuple. Acceptance is
never an implementation or release claim.

The step is complete when the capability, its facts, the process that collects them, the rule
fields they expose, the effect owner and the sensitive fields are explicit.

## 2. Place the behaviour in its one owner

- **Capability module** (`prctr-capabilities`): state, change kinds, summary, rule fields,
  per-platform adapters and a fake. Adapters observe and answer "the full state now"; they never
  sequence, coalesce, evaluate rules or see policy, identity or exam content.
- **Core** (`prctr-core`): sessions, sequencing, dropping identical states, gaps, resets,
  interruptions, flow control and rule evaluation, once for every capability. No OS, threads or
  clock: time is an input.
- **OS wrappers** (`prctr-os`): every `unsafe` call, behind safe owned wrappers.
- **Agent** (`prctr-agent`): wiring, threads and the pipe to Electron main.
- **Privileged components** (`prctr-helper`): only events that need the Endpoint Security extension
  or the Windows service, forwarded through the helper messages.
- **Electron main**: launch and supervision, permission prompts, containment and other closed
  effects, wall-clock time, signing and delivery. It never evaluates rules.
- **Server**: compiles rules, re-evaluates them, opens occurrences and raises flags.

The step is complete when no adapter can receive policy, no agent message is a generic command, and
no Electron-main code interprets raw facts.

## 3. Define the facts

Write the state type so invalid states cannot be built (unavailable carries no data, counts are
bounded, identities are opaque per session or Attempt-keyed pseudonyms). Give every field a purpose
and a bound. Derive the summary only from the state. Register only the fields a rule needs.

Keep names, paths, command lines, serials, addresses, account identifiers, window titles and
content inside the adapter. Application identity is matched on the device against the signed
catalog, and only rule matches leave the agent.

When the state is small, each change carries the complete new state plus the kinds of change. Treat
OS notifications as wake-ups: re-query and report what the query found.

The step is complete when the fact catalog entry, the Rust types and the privacy limits say the same
thing.

## 4. Write the adapter per platform

Use the strongest public API each OS offers, plus the privileged components where the contract
requires them. Use the maintained `objc2` framework crates on macOS and the `windows` crate on
Windows; no hand-written message sends or C shims unless no binding can express the API. Subscribe
before the first query so nothing falls between them. APIs that need the macOS main run loop run on
the run-loop owner in `prctr-os`.

Report `unsupported`, partial certainty or `snapshot_only` coverage honestly when a platform or a
missing component cannot give the full claim; never substitute a weaker method for an enforced
claim.

The step is complete when each platform's coverage claim is written down and reachable from a test.

## 5. Register and generate

Add the module to the capability list. Run `prctr-xtask` to regenerate the JSON Schema, the
capability registry (capabilities, typed fields, reasons, baseline rules) and the conformance
vectors, then `npm run generate` for TypeScript. Add the reasons' localized texts on the Desktop
side. Nothing in the core, protocol envelope, agent or Electron main should need changing; if it
does, fix the leak instead of patching around it.

The step is complete when `npm run test:native` and `npm run check` pass with the regenerated
artifacts committed.

## 6. Prove it

- Model tests from fixtures recorded on real machines, table-driven and property-based.
- The core conformance suite through the capability's fake.
- Rule vectors for any new field semantics.
- **Real-OS tests that cause a change and check the fact** on each platform's CI runner (for example
  a clipboard write raises the counter by one; a virtual display produces `target_added`).
- Certification cases on physical machines for hardware: monitors, docks, phones, webcams,
  privileged components.

Name tests for the behaviour they prove; use input timestamps instead of sleeps. A capability is not
full on a platform until its real-OS tests prove every fact there.

The work is complete when the contracts, Rust types, generated artifacts, tests and the capability
matrix assert the same bounded behaviour.
