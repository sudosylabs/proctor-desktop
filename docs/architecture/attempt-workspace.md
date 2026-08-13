# Attempt Workspace architecture

## Scope and authority

An Attempt Workspace is the remote-first hierarchy of working files for one
Exam Attempt. The Proctor Server owns its authoritative contents, lifecycle,
authorization, and acknowledged state. The desktop owns a temporary working
projection and protected recovery; neither becomes a second workspace authority.

The architecture is transport-neutral. It does not require the server to create
a File Revision or File Rendition entity for every code-file save. The desktop
observes opaque provider-issued versions and acknowledgements while the server
remains free to implement them with counters, digests, object versions, retained
revisions, or another persistence mechanism.

Four states remain distinct:

- the authoritative Workspace Snapshot held by the server;
- the desktop Working Workspace Overlay;
- protected local recovery and evictable acknowledged-content cache;
- the filesystem projection in an isolated remote execution environment.

Disconnect, recovery, or execution-environment change does not itself mutate
authoritative Exam Attempt lifecycle state.

## Resource model

A `Workspace Entry Reference` is the stable identity of a file or directory
within one Attempt Workspace. It survives rename and move. It is opaque to
callers and is not a host path.

A `Workspace Path` is mutable hierarchy metadata. It is normalized,
POSIX-relative, case-sensitive, and unique within the workspace. It never
contains or resolves to a desktop or remote-VM host path. Empty directories are
supported. Symbolic links are excluded until their escape, cycle,
authorization, and execution-projection semantics are separately accepted.

A `Workspace Content Version` is an opaque provider-issued comparison token for
one exact acknowledged content state of a workspace file. It supports
optimistic mutation, acknowledgement, reconciliation, exact reads, and
submission readiness. It does not imply that the server retains a corresponding
File Revision entity.

Canonical file content is binary-safe. Text adapters own explicit decoding,
encoding, byte-order-mark, and line-ending behavior. Network transport may use
strings, raw bodies, compression, chunks, streams, or ranges without exposing
that representation through the workspace interface.

Exam Resources are a separately authorized, read-only collection outside the
Attempt Workspace. Each exposes stable identity, an opaque resource version,
media type, display metadata, and optional hierarchy or order. Server File
Revisions and File Renditions may represent retained originals and derived
previews; the client uses them only when the provider contract exposes them.
Exam Resources never enter the Working Workspace Overlay or Submission.

## Deep modules

The accepted external seam is an attempt-scoped `AttemptWorkspaceSession`. The
names below describe interface roles; exact TypeScript types wait for source and
toolchain work.

```ts
interface AttemptWorkspaceSession {
  observe(query: WorkspaceQuery): WorkspaceObservation;
  read(request: WorkspaceRead): Promise<WorkspaceReadResult>;
  change(intent: WorkspaceChange): WorkspaceChangeResult;
  settle(request: WorkspaceSettlement): Promise<WorkspaceSettlementResult>;
  dispose(): void;
}

interface ExamResourceCatalog {
  observe(query: ExamResourceQuery): ExamResourceObservation;
  read(request: ExamResourceRead): Promise<ExamResourceReadResult>;
  dispose(): void;
}
```

`observe` atomically exposes an immutable current projection and subscribes to
later projections, avoiding a snapshot/subscription race. A local monotonic
`Workspace View Generation` orders visible authoritative and overlay changes;
it is distinct from the server-issued Workspace Cursor.

`read` addresses a stable reference and either an exact content version or
`current`. Every successful result identifies the exact version returned,
media type, byte size, and relevant text metadata. Normal source reads use
bounded buffers. Large files and renditions may use cancellable streams or
ranges under explicit size and range capabilities.

`change` expresses a closed local intent: replace file content, create a file or
directory, move or rename, delete, apply a bounded atomic workspace edit,
resolve a conflict, or revert. Acceptance means the intent is installed in the
Working Workspace Overlay and receives a local generation. It does not mean the
server has acknowledged the change.

`settle` requests a condition through an exact Workspace View Generation:

- `protect` requires complete Recovery Records through that generation;
- `persist` requests authoritative acknowledgement through that generation;
- `reconcile` resolves authoritative changes and unknown outcomes;
- `controlledClose` requires recovery protection without waiting indefinitely
  for network acknowledgement;
- `submissionReadiness` reports the acknowledged Workspace Cursor and blockers
  but never submits.

The Exam Resource Catalog has no mutation or settlement interface. Internally it
may share binary content-reading and protected-cache mechanics with the Attempt
Workspace module without sharing authority, overlay, or submission semantics.

## Provider and adapter seams

The Attempt Workspace implementation owns two internal seams:

- an authoritative workspace port with a production server-transport adapter
  and a deterministic in-memory adapter;
- a protected-content port with a privileged native encrypted-store adapter and
  an in-memory adapter.

The authoritative port supplies snapshots, exact and current reads, mutation
dispatch and result lookup, ordered changes after a Workspace Cursor,
capabilities, and Exam Resource reads where applicable. Transport routes, DTOs,
authentication headers, serialization, and replay strategy remain inside its
production adapter.

The protected-content adapter performs encrypted, authenticated, atomic record
operations under opaque identifiers and returns no raw path. Key custody and
access gating follow the
[identity and exam-security architecture](./identity-and-exam-security.md);
native adapters also follow the
[native-capability architecture](./native-capabilities.md). Tests exercise the
real workspace module through its external interface using the two in-memory
adapters rather than testing past the seam.

A VS Code-compatible filesystem provider is a caller-side adapter over the
Attempt Workspace session. A distinct read-only provider projects Exam
Resources. Their Proctor-owned hierarchical URIs contain an opaque scope and
logical Workspace Path so selected file-tree, editor, and working-copy mechanics
can operate. URI possession, provider registration, connectivity, context keys,
and provider capability flags never authorize access.

The compatibility adapter translates rich results into filesystem operations,
events, and coarser errors. It resolves a canonical write as successful only
after authoritative acknowledgement; local recovery alone cannot clear the
editor's server-durability obligation. Provider events are UI invalidation
hints, not acknowledgements or authority. The Recovery Store is never registered
as a workspace provider.

## Working state and protected storage

The Working Workspace Overlay sits above an authoritative Workspace Snapshot.
It contains modified file versions, locally created files and directories,
pending moves and deletions, mutation intent and idempotency keys, and the
Workspace Cursor from which it diverged. New entries use a temporary Local Entry
Key until acknowledgement supplies a stable Workspace Entry Reference.

Working state uses independent facts:

- content relation: `unchanged` or `modified`;
- remote mutation: `idle`, `queued`, `inFlight`, `outcomeUnknown`,
  `conflicted`, or `rejected`;
- recovery protection: `notRequired`, `pending`, `protected`, or `failed`;
- availability: `online`, `reconnecting`, `offline`, or `unavailable`;
- current authoritative access capabilities.

Presentation derives from those facts. “Saved to server” requires an
acknowledgement covering the local version. “Protected on this device” means a
complete Recovery Record exists and makes no server-durability claim. Conflict,
rejection, unknown outcome, authorization loss, and read-only transition retain
protected local work.

One privileged encrypted storage module owns two logical record classes:

- a Recovery Record contains the content and mutation intent needed to restore
  unacknowledged overlay state;
- Cached Content contains exact-version acknowledged content as an evictable
  optimization.

Records use opaque storage identifiers rather than workspace names or paths and
are scoped to installation, Principal, Exam Attempt, stable entry or local key,
base content version, and local content version. The renderer receives bounded
content and checkpoint, recover, or discard capabilities rather than a generic
filesystem interface.

Recovery checkpointing uses a short bounded debounce plus lifecycle barriers; it
does not block every keystroke on native I/O. A checkpoint is discarded only
after an acknowledgement covers that local version or a later one. Recovery
Records have priority over cache and are non-evictable while they are the only
durable copy of unacknowledged work. If neither server persistence nor protected
recovery can accept new work, the workspace activates a durability gate before
accepting further edits.

Authentication loss locks potentially recoverable records instead of exposing
or immediately destroying them. Another Principal cannot enumerate or decrypt
them. Authoritative lifecycle state and a packaged maximum-retention policy
govern cleanup. Cleanup first makes records inaccessible through key or
tombstone state, then removes blobs.

## Mutations, acknowledgements, and ordering

The module compiles accepted local intents into a closed Workspace Mutation
family: file or directory creation, content replacement, move or rename,
deletion, and bounded atomic batch. Callers never create idempotency keys,
expected conditions, or mutation scopes.

Every mutation has one immutable idempotency key and explicit expectations:

- replacement expects its base Workspace Content Version;
- creation expects destination absence;
- move expects stable identity, current path, and destination absence;
- deletion expects stable identity and current content version where relevant;
- directory move applies atomically to its subtree;
- a batch declares its complete scope and is all-or-nothing.

Acknowledgement means the result is durably authoritative. It returns resulting
identities, paths and content versions plus an opaque Workspace Cursor. An
identical retry with the same idempotency key returns the recorded result;
different input under that key conflicts.

A mutation produces one precise result: `acknowledged`, `conflicted`,
`rejected`, `notDispatched`, `outcomeUnknown`, `transportUnavailable`, or
`invalidCommand`. Cancellation before dispatch is `notDispatched`. Cancellation
after possible dispatch is `outcomeUnknown` unless an authoritative cancellation
or other result is confirmed. Retry of unknown work retains its key.

Content changes for one file serialize by local version. Mutations with
overlapping stable-entry or path scopes serialize, including subtree moves and
deletes; independent files may persist concurrently. Failure leaves independent
work running. Dependent queued work rebases onto acknowledged state or becomes
an explicit conflict. Callers receive no generic lock or transaction interface.

Explicit Save requests immediate persistence through a captured generation; it
does not establish a separate durability model. Unsent obsolete content versions
may coalesce, while in-flight and outcome-unknown versions remain identifiable.
An acknowledgement for an older local version advances the base without
clearing a newer local edit. Undo or redo reaching acknowledged content makes the
file unchanged.

## Reconciliation and conflict

An authoritative Workspace Snapshot carries a Workspace Cursor. Ordered changes
after that cursor identify stable entries, old and new paths, resulting content
versions, originating mutation keys where applicable, and the next cursor.
Acknowledgements and remote changes pass through one reducer. Duplicates are
idempotent. A gap, expired history, or inconsistency forces a full snapshot
refresh followed by overlay reapplication.

Conflicts distinguish advanced content, destination collision, authoritative
deletion with local modification, incompatible subtree movement, and local
creation collision. Protected local content is never overwritten or discarded
automatically.

Text conflicts retain base, local, and authoritative versions. A deterministic
non-overlapping three-way merge may create a new modified local version and
reports that rebase. Overlapping changes use a packaged merge surface and write
no conflict markers without explicit acceptance. Binary conflicts require an
explicit version choice or authorized new path. Deletion and path conflicts
similarly require explicit authorized resolution or discard.

Authorization, lifecycle, policy, quota, size, and unsupported-operation
failures are typed rejections rather than content conflicts. Revert is an
explicit destructive operation: it first reconciles in-flight or unknown
mutations, then discards the selected protected local state and reloads
authoritative content.

## Capability and lifecycle rules

A versioned, deny-by-default Workspace Capability Snapshot projects technical
and authoritative operation availability at workspace, subtree, or stable-entry
scope. It covers hierarchy and content read, creation, replacement, move,
deletion, and bounded batch. Exam Resources expose only authorized hierarchy,
metadata, and content reads.

Capabilities control presentation and dispatch eligibility. The authoritative
operation owner reauthorizes every mutation against current state; stale
capability causes safe rejection and refresh. Revocation may cancel
undispatched work but never discards protected changes.

Only acknowledged authoritative workspace state can enter a Submission. The
desktop blocks submission readiness while included work is queued, in flight,
outcome-unknown, conflicted, rejected, or only locally protected. The server
seals the state at an expected Workspace Cursor using its own persistence model.
The resource module never performs Submit, Suspend, Reopen, or Terminate and
cannot complete submission offline. Close, crash, disconnect, or a clean-looking
editor never implies submission.

## VS Code relationship

At the reviewed VS Code baseline, `src/vs/platform/files/common/files.ts` and
`fileService.ts` provide scheme-routed filesystem operations and provider
capabilities. `src/vs/workbench/services/workingCopy/common/workingCopy.ts` and
`storedFileWorkingCopy.ts` provide useful dirty-state, serialized-save,
concurrent-edit, backup, conflict, and revert behavior. Browser backup roots
under `vscode-userdata:/User/Backups` through
`src/vs/workbench/services/workingCopy/browser/workingCopyBackupService.ts`,
while canonical saves still target the original resource provider.

These are implementation evidence, not an admitted source cluster. VS Code's
URI identity, filesystem-wide interface, mtime-and-size etag, provider
availability, coarse errors, and separate remote-connection state cannot express
Proctor's stable workspace identity, provider-defined content token,
acknowledgement, unknown outcome, authoritative cursor, protected overlay, or
submission boundary. Any future intake starts from the Proctor interfaces above
and follows the VS Code admission procedure.

## Unresolved dependencies

The server transport, token and cursor representations, ordered-change delivery,
protected-record retention durations, content-size limits, and
execution-environment synchronization protocol remain unresolved. The identity
architecture governs key custody and secure-exam gating; native-capability work
must still settle concrete privileged placement, administrative threat
assumptions, anti-tamper behavior, and OS-specific enforcement before production
adapters are designed.
