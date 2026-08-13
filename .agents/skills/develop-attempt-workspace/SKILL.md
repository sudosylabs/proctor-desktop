---
name: develop-attempt-workspace
description: Design, implement, or review Proctor Desktop Attempt Workspace hierarchy, content, providers, URI projection, working state, save or revert, mutations, acknowledgements, recovery, caching, reconciliation, conflicts, capability state, Exam Resource reads, or submission readiness. Use before changing workspace files, file trees, working copies, remote persistence, protected local data, or VS Code filesystem integration.
---

# Develop Attempt Workspace

Preserve remote-first authority and protected local recovery behind one deep
module.

## 1. Load authority

Read the [Attempt Workspace architecture](../../../docs/architecture/attempt-workspace.md),
[product model](../../../docs/product/model.md), and
[architecture invariants](../../../docs/architecture/invariants.md). Use
[`source-code-organization`](../source-code-organization/SKILL.md) before placing
source. Use [`develop-workbench`](../develop-workbench/SKILL.md) for file-tree,
editor-pane, status, merge-surface, or lifecycle presentation.

For VS Code-derived behavior, also use
[`adapt-vscode`](../adapt-vscode/SKILL.md). Use
[`develop-identity-and-exam-security`](../develop-identity-and-exam-security/SKILL.md)
for production key custody, access gating, blocked-state reconciliation, or
secure-exam enforcement. Use
[`develop-native-capabilities`](../develop-native-capabilities/SKILL.md) before
specifying a protected native adapter, native package placement, process
supervision, or anti-tamper guarantee.

The step is complete when the caller, process, authoritative owner, and every
unresolved dependency of the change are explicit.

## 2. Preserve the external seam

Keep mutable workspace behavior behind one attempt-scoped
`AttemptWorkspaceSession` with four operation families: observe immutable
projections, read exact or current content, accept closed local changes, and
settle a precise Workspace View Generation. Keep disposal explicit.

Keep Exam Resources behind a separate read-only `ExamResourceCatalog`. Share
private content mechanics where useful without sharing mutation, overlay,
recovery, or submission semantics.

Keep mutation construction, idempotency keys, expected conditions, overlap
scheduling, Workspace Cursor reduction, overlay rebase, checkpoint timing,
cache policy, URI mapping, and provider-error translation inside the workspace
implementation. Keep text edit coordinates and transport DTOs out of the
external interface; text adapters publish immutable binary-safe content.

The step is complete when deleting the module would force these rules back into
multiple callers and tests can exercise them through the same interface.

## 3. Model identity and working state

Use stable Workspace Entry References and mutable case-sensitive POSIX-relative
Workspace Paths. Use opaque Workspace Content Versions without assuming a
server File Revision is created per save. Keep host paths and symbolic links out
of the workspace contract.

Project authoritative snapshot plus Working Workspace Overlay. Keep content
relation, remote mutation, recovery protection, availability, and access as
independent facts. Derive user-facing state from their combination. Reserve
“saved to server” for acknowledged content and “protected on this device” for a
complete Recovery Record.

The step is complete when rename preserves identity and no recovery, cache,
provider, URI, or presentation state can become authority.

## 4. Coordinate changes and durability

Accept local change into the overlay before remote acknowledgement and assign a
Workspace View Generation. Compile it internally into the closed Workspace
Mutation family with one idempotency key and operation-specific expectations.
Order overlapping entry and path scopes while allowing bounded concurrency for
independent files.

Fence protect, persist, reconcile, interruption-protection, and
submission-readiness settlements through a captured generation. Preserve exact
dispatch outcomes and reuse the same key after an unknown result. Keep
conflicted, rejected, and unknown local work protected until acknowledged
replacement or explicit discard.

Make Revert reconcile possible in-flight results before discarding the selected
local state. Make interruption and shutdown handling protect captured work
without depending indefinitely on the network; application-close permission is
owned by identity and exam security. Keep submission outside this module and
permit only acknowledged state at an authoritative Workspace Cursor to become
ready.

The step is complete when a caller cannot mistake local acceptance, local
protection, transport completion, provider events, or editor cleanliness for
authoritative acknowledgement.

## 5. Place adapters correctly

Keep the owned server transport behind an internal authoritative-workspace port
with production and in-memory adapters. Keep protected content behind an
internal port with privileged native and in-memory adapters. The workspace
module owns policy and ordering; adapters own transport or storage mechanics.

Place the VS Code-compatible filesystem provider outside the module as a
caller-side adapter. Use separate Proctor URI scopes for Attempt Workspace and
Exam Resources. Translate rich results only at that edge, reauthorize every
operation, and derive provider events after reconciliation. Keep the Recovery
Store unregistered and expose no raw native path.

The step is complete when production behavior can change transport, storage, or
VS Code compatibility without changing the external workspace interface.

## 6. Reconcile and preserve conflicts

Apply acknowledgements and authoritative changes through one Workspace
Cursor-ordered reducer. Deduplicate repeats; refresh the full snapshot and
reapply the overlay after a gap, expired history, or inconsistency.

Preserve base, local, and authoritative content for conflicts. Allow a
deterministic non-overlapping text rebase to create a new modified version. Send
overlaps to an explicit merge surface. Require explicit resolution for binary,
path, deletion, and local-create conflicts. Treat authorization, lifecycle,
policy, quota, size, and unsupported failures as typed rejections.

The step is complete when no conflict or refresh path silently overwrites,
duplicates, authorizes, or discards protected work.

## 7. Verify through the interface

Use the real module with in-memory authority and protected-store adapters. Cover
stable identity across rename, exact reads, local edit and checkpoint,
acknowledgement of an older local version, identical retry, cancellation before
and after dispatch, cursor gap, overlay reapplication, overlapping subtree
operations, revocation, storage exhaustion, conflict families, interruption
protection, Exam Resource read-only behavior, and submission blockers.

Review diagnostics for sensitive paths, content, identity, policy, and storage
metadata. When source derives from VS Code, complete intake and provenance only
after the local interface tests are defined.

The work is complete when implementation, adapters, provider projection, tests,
product wording, and the architecture topic describe the same observable
durability behavior.
