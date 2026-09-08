# Execution projection contract

The accepted wire contract uses the [shared conventions](conventions.md).
[Contract map and implementation status](README.md) separate agreement from availability.

## Projection behavior and protective guards

Keep protective Apply/directory refusals until the pinned reusable host passes
the conformance cases below. Resetting the whole watcher baseline after a save
or interpreting an ambiguous directory event stream is not safe projection.

An ordinary Desktop save projects into the current remote
Execution Environment and its existing PTY/process continues. Terminal-created
files and directories, ordinary descendant deletes, directory moves, and recursive
deletes become acknowledged Workspace changes with the same stable identity and
conflict rules as Desktop changes. Execution files remain a projection plus
unacknowledged guest work; the VM filesystem never becomes Workspace authority.

## Required host contract

Upgrade the reusable execenv dependency and adapter through a released, pinned
version or the server repository's accepted dependency workflow. Preserve its
remote isolated-host boundary; no runtime dependency on a local Desktop checkout.
The exact upstream method names may differ, but return a mapping to this port:

```typescript
interface ProjectionFence {
  execution_grant_id: OpaqueID;
  environment_epoch: OpaqueID;
  fence_revision: PositiveInt;
}
interface ProjectionApply {
  fence: ProjectionFence;
  mutation_id: OpaqueID; // Stable idempotency ID for this exact projection commit.
  from_workspace_cursor: SafeInt;
  through_workspace_cursor: SafeInt;
  expected_host_cursor: SafeInt;
  // The existing acknowledged Workspace journal mutations, with stable entry
  // IDs, expected versions, node kinds, paths, and bounded content references.
  mutations: ProjectionMutation[];
}
interface ProjectionApplyReceipt {
  fence: ProjectionFence;
  mutation_id: OpaqueID;
  applied_workspace_cursor: SafeInt;
  host_cursor: SafeInt;
}
interface ProjectionMutation {
  journal_cursor: PositiveInt;
  entry_id: ID;
  operation: 'create' | 'write' | 'rename' | 'move' | 'delete';
  kind: 'file' | 'directory';
  path: string;
  destination_path?: string;
  expected_content_version?: Revision;
  resulting_content_version?: Revision;
  recursive?: boolean;
  content?: { size: SafeInt; digest: SHA256; transfer_id: OpaqueID };
}
```

These are privileged server-to-host port records, never Candidate wire payloads
or new public Workspace mutations. Apply carries 1..128 consecutive journal
mutations and at most 256 KiB of metadata. Content is separately bounded by
existing Workspace limits and authenticated streaming transfer; transfer IDs
are host/grant/epoch scoped, single-purpose, and never arbitrary URLs or paths.
Use the server's existing Workspace content-version representation when mapping
Revision. File create/write requires content and resulting version; write
requires expected version. Directory create has no content/version. Rename/move
requires destination_path and preserves all descendant IDs/versions; file
rename/move also binds its expected version. Delete declares recursive=true for
a nonempty directory and binds file version for a file. Reject irrelevant fields.
Paths use existing Workspace validation, confinement, and ignored-path rules.

Apply atomically validates the full fence, cursor, expected versions, and
idempotency binding before publishing the projection receipt. It must coordinate
with guest observation so that concurrent unrelated guest changes remain
observable. It cannot reset the whole watcher baseline to current disk contents.
Expected-host-cursor conflict causes reconciliation of pending observations and
retry; it is not permission to overwrite an unobserved guest change. Reusing a
mutation ID with different bytes conflicts; exact replay returns its receipt.

The observation contract must distinguish semantic directory operations:

```typescript
interface ExecutionObservation {
  fence: ProjectionFence;
  host_sequence: PositiveInt;
  based_on_workspace_cursor: SafeInt;
  operation: 'create_file' | 'create_directory' | 'write_file' | 'move' | 'delete';
  node_identity: OpaqueID; // Stable within the epoch, including across a move.
  kind: 'file' | 'directory';
  path: string;
  destination_path?: string;
  expected_content_version?: Revision;
  recursive?: boolean;
  content?: { size: SafeInt; digest: SHA256; transfer_id: OpaqueID };
  origin_projection_mutation_id?: OpaqueID;
}
```

File create/write includes immutable content associated with that observation,
not a later live Open(path) that may return different bytes. Move is one semantic
operation with the previous path and destination; directory moves preserve the
subtree identity/version map atomically. A true recursive deletion is one
explicit recursive directory delete. An ordinary file deletion below a
directory ancestor is distinguishable from a directory move and can be accepted.
Directory creation precedes child creation in the ordered stream. File write,
move, and file delete bind the previously projected version; creating a node
must not overwrite an existing authority identity.

An origin_projection_mutation_id is valid only if it matches a known Apply and
its exact expected effects. Suppress only those projection echoes; never suppress
an unrelated guest event that happened nearby. Maintain a durable processed
host-sequence watermark. A host must expose cursor gaps or lost identity as a
typed resynchronization failure, not synthesize a set of plausible deletes.
Keep unacknowledged content reachable until the server records its outcome or
retires the grant. Bound retention with the existing guest workspace quotas.

If the reusable host cannot establish these semantics on a target, report that
capability unavailable and leave the corresponding safety guards in place.
Record the unavailable capability and its pinned release dependency in project
status. Filesystem heuristics cannot substitute for these guarantees.

## Authoritative persistence and conflicts

Translate each validated semantic observation through existing Workspace
create/write/rename/move/delete commands and their idempotency boundary.
Directory moves/deletes use the existing atomic subtree behavior; this is not
a request for a public arbitrary Workspace transaction/batch API.

Use the observation's durable projected identity/version/cursor baseline for
preconditions. Reading the latest Workspace manifest and using its newest
version as if the guest had observed it can erase a competing Desktop edit.
When an unrelated authoritative change advanced the cursor, reconcile the
journal and revalidate the affected identities. When the same file/topology
changed incompatibly, return an explicit conflict and preserve acknowledged
Workspace state; fence the guest path or grant using existing conflict recovery.
Never acknowledge the guest edit by silently choosing the newer live bytes.

On success, record the host observation identity, idempotency receipt, resulting
Workspace cursor/versions, and projection suppression mapping so replay cannot
repeat or lose the mutation. A lost response is resolved by the same key/outcome,
not a new create at a new path. Directory/file kind changes and ignored-tree
boundary moves require an explicitly supported atomic mapping; otherwise reject
before any partial authoritative mutation. Ordinary supported directory work
inside the Attempt Files projection must pass.

Preserve true failure behavior: host transport loss, unknown cursor gap,
unrecoverable projection conflict, obsolete generation, or revoked grant fences
input and retires/reconstructs only through a fresh authorized environment.
Ordinary successful projection and a healthy watcher do not retire the PTY.

## Desktop-visible projection readiness

Keep one server-authorized remote PTY, existing terminal transport bounds,
initial directory rules, and continuous Participation. Extend the current
terminal-open command with `expected_workspace_cursor: SafeInt`: Desktop sends
the latest cursor whose writes it has confirmed as server-persisted. The server
opens/attaches only once the current environment has applied through that cursor.
A future/unacknowledged cursor is invalid; a lagging projection yields a typed
retryable `execution.projection_pending` outcome without accepting PTY input.

Return these additional fields on successful terminal open and current
Execution capability detail:

```typescript
interface ExecutionProjectionStatus {
  environment_epoch: OpaqueID;
  applied_workspace_cursor: SafeInt;
  projection_state: 'synchronizing' | 'ready' | 'conflict' | 'unavailable';
}
```

An environment that must be initialized may accept the authorized open request
to initialize it; do not require an already-open PTY to make the first open
eligible. Distinguish temporary projection lag from security denial and permanent
host unavailability. Desktop waits for working-overlay persistence, then server
projection readiness, then sends terminal input. A save while a command runs
updates the projection without restarting that command.

Preserve the existing selected terminal/connection identity and generation
fences on input, output, resize, close, and delayed callbacks. If the current
wire cannot distinguish replacement PTYs, add an opaque `terminal_id` to open
results and every current terminal frame; reject frames from a
retired ID. No late output/close from the prior PTY may affect its replacement.
No request is made here to rewrite the established base64/stream framing or to
add multiple PTYs. Do not fabricate exit codes where the host reports only a
transport close; report a bounded terminal-loss reason instead.

## Acceptance tests

- Run a long-lived process, save an unrelated file in Desktop, and prove both
  the same environment epoch and same PTY/process survive while bytes update.
- Concurrent unrelated guest write during Apply is subsequently acknowledged
  once; a same-file competing write conflicts without silently losing either
  acknowledged authority or the fact of the guest conflict.
- Directory create with nested children, move/rename with descendants, recursive
  delete, and ordinary descendant file deletion preserve the correct Workspace
  IDs, content versions, ordered journal, and replay result.
- No partial delete when a directory move is observed; no live-content race
  between event receipt and content read; no symlink/ignored-path escape.
- Exact Apply/observation retry after lost receipt is idempotent; conflicting
  retry, host-cursor gap, grant revocation, and stale epoch/generation are fenced.
- Initial open, projection pending, Desktop saves before open, terminal correction
  freeze, and temporary host failure expose distinct recoverable states.
- Replacement PTY rejects stale input/resize/output/close callbacks. Submission,
  suspension, disconnect containment, and policy block preserve their current
  privileged close/freeze behavior.

## Host authority and durable fences

Use ProjectionFence in host Apply,
receipts, observation, and terminal-related work. Proctor owns the durable
mapping from this opaque grant fence to Attempt/Participation/Session/lifecycle.
The host receives none of those domain identifiers. fence_revision is monotonic
within its grant and changes when its authorized state changes; it is not a
renamed Participation generation.

The highest applied fence must survive any host restart that preserves the same
live epoch, or that epoch must become unusable. The host cannot reset its fence
counter and accept delayed commands. Revoke is terminal for that grant/epoch;
only a newly authorized successor can become usable. Every effect acknowledgement
is matched against the current durable fence before opening a gate. Checking a
fence only at request construction is insufficient.

Immutable observation-content, semantic directory, expected-version,
Workspace-authority, and same-PTY incremental projection requirements all apply.
Keep protective refusals until the pinned reusable implementation passes actual
adapter/host tests. A missing host release is an activation dependency, not a
request to remove safety guards or to expose exam identities to execenv.
