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
- protected local recovery and evictable acknowledged-content cache.

Disconnect or recovery does not itself mutate
authoritative Exam Attempt lifecycle state.

## Resource model

A `Workspace Entry Reference` is the stable identity of a file or directory
within one Attempt Workspace. It survives rename and move. It is opaque to
callers and is not a host path.

A `Workspace Path` is mutable hierarchy metadata. It is normalized,
POSIX-relative, case-sensitive, and unique within the workspace. It never
contains or resolves to a desktop or remote-VM host path. Empty directories are
supported. Symbolic links are excluded until their escape, cycle,
and authorization semantics are separately accepted.

A `Workspace Content Version` is an opaque provider-issued comparison token for
one exact acknowledged content state of a workspace file. It supports
optimistic mutation, acknowledgement, reconciliation, and submission
readiness. Workspace v1 reads only current content; the token does not promise a
server-retained historical version or File Revision entity.

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

`read` addresses a stable reference at `current`. Every successful result
identifies the version returned, media type, byte size, and relevant text
metadata. The production v1 adapter reads the whole current file with bounded
streaming transport where available. Monaco/VS Code may build its piece tree
from a stream, but the full logical text model exists only after that stream
completes; this is not range-backed editing. The initial packaged editor model
limit is 10 MiB even if a server permits a larger file.

`change` expresses a closed local intent: replace file content, create a file or
directory, move or rename, delete, resolve a local conflict, or discard/revert a
selected part of the Working Workspace Overlay. Acceptance means the intent is
installed locally and receives a generation. It does not mean the server has
acknowledged the change. V1 has no server batch, resolve-conflict, or revert
mutation.

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
The packaged catalog admits at most 2,048 unique resource identities and paths,
bounds each whole-resource read at 100 MiB, and requires the read response to
match the authorized catalog identity, version, media type, display metadata,
and byte size exactly. Disposal fences in-flight reads before publication.

## Provider and adapter seams

The Attempt Workspace implementation owns two internal seams:

- an authoritative workspace port with a production server-transport adapter
  and a deterministic in-memory adapter;
- a protected-content port with a privileged native encrypted-store adapter and
  an in-memory adapter.

The authoritative port supplies snapshots, current reads, single-mutation
dispatch and result lookup, ordered changes after an integer Workspace Cursor,
and Exam Resource reads where applicable. Transport routes, DTOs,
authentication headers, serialization, and replay strategy remain inside its
production adapter. Rich local capability state must not imply a server
capability-snapshot endpoint.

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
directory enumeration, scoped recursive or non-recursive watches, events, and
coarser errors. It resolves a canonical write as successful only
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

The module compiles accepted local intents into the five Workspace v1 mutation
families: create directory, create file, replace file content, move or rename,
and delete. Callers never create idempotency keys or expected conditions. The
Desktop scheduler may coordinate several local intents, but it cannot represent
them to the server as one atomic batch.

Every mutation has one immutable idempotency key and explicit expectations:

- replacement expects its base Workspace Content Version;
- creation expects destination absence;
- move expects stable identity, current path, and destination absence;
- deletion expects stable identity and current content version where relevant;
- directory move applies atomically to its subtree;

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

Workspace View facts remain independent. `contentRelation` becomes `modified`
only for a local file creation or content replacement; a move, rename, or
directory operation changes remote-mutation and recovery facts without claiming
that bytes changed. A directory move projects its latest mutation/recovery state
to every visible descendant while preserving each descendant's prior content
relation. Projection replays the bounded operation overlay once and builds the
fact index during that replay; it does not rescan the operation journal for
every Workspace entry.

Explicit Save requests immediate persistence through a captured generation; it
does not establish a separate durability model. Unsent obsolete content versions
may coalesce, while in-flight and outcome-unknown versions remain identifiable.
An acknowledgement for an older local version advances the base without
clearing a newer local edit. Undo or redo reaching acknowledged content makes the
file unchanged.

## Reconciliation and conflict

An authoritative Workspace Snapshot carries an integer Workspace Cursor.
Ordered changes after that cursor identify stable entries, old and new paths,
resulting content versions, and the next cursor. Workspace v1 journal entries do
not promise originating mutation keys, so acknowledgements and refresh changes
are reconciled through recorded mutation results and one reducer. Duplicates are
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
failures are typed rejections rather than content conflicts. Revert is a local
explicit destructive operation: it first reconciles in-flight or unknown
mutations, protects anything still needed for recovery, discards the selected
overlay state, and reloads current authoritative content.

## Capability and lifecycle rules

A deny-by-default local Workspace Capability Projection combines packaged
support, current Attempt/Participation state, and purpose-specific server
results. V1 provides no per-entry server Capability Snapshot. The projection
covers current hierarchy/content read and the five supported mutations. Exam
Resources expose only authorized hierarchy, metadata, and content reads.

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

## Production v1 and unresolved extensions

The first production adapter pins integer Workspace Cursors, whole current-file
reads, ordered journal refresh, idempotent results, and the five single
mutations above. The server defaults are 10 MiB per file and 50 MiB total, with
hard configurable maxima of 100 MiB per file and 1 GiB total. Clients treat
server-advertised effective limits as authority and enforce their independent
10 MiB initial editor-model limit before opening a text model. Desktop also
rejects a single in-memory protected-recovery restore envelope above a packaged
512 MiB safety ceiling. That ceiling is an implementation input bound, not the
still-unresolved protected-record retention policy.

Atomic batch, historical-version reads, range-backed models, server conflict
resolution/revert, journal mutation keys, and per-entry capability snapshots are
deferred extensions. Protected-record retention remains unresolved. Code
execution is absent: the server removed execution hosts, and the planned Run
capability will read acknowledged Workspace state rather than own a filesystem
projection. Identity/security governs key custody and candidate gates, and native capability
work owns privileged placement and platform enforcement.
