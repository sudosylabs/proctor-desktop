# Secure admission and live participation

The accepted wire contract uses the [shared conventions](conventions.md).
[Contract map and implementation status](README.md) separate agreement from availability.

## Prepare a challenge before first join or ready rejoin

Operation:

`POST /exam-sittings/{sitting_id}/security-preflights`

Require the registered Desktop Session, current candidate eligibility, compatible
verified release, and an Idempotency-Key. Body:

```typescript
interface PrepareSecurityPreflight {
  attempt_id?: ID; // Present for ready rejoin; absent for first admission.
  native_registry_digest: SHA256;
  source_manifest_digest: SHA256;
  configuration_manifest_fingerprint: SHA256; // Exact current packaged manifest.
}
interface PreflightChallenge {
  preflight_id: OpaqueID;
  challenge: string; // 32 random bytes encoded base64url without padding.
  issued_at: Instant;
  expires_at: Instant; // Challenge lifetime: 120 seconds.
}
```

Return SecurityPolicyResponse, including its frozen_attempt_configuration
member from [Attempt Configuration](attempt-configuration.md).
For rejoin, the response returns the existing immutable configuration to this
candidate through privileged transport. First admission returns null. Account
settings source and arbitrary workspace content are not part of preflight.

Preparation creates a bounded short-lived preflight transaction, not an Attempt,
Workspace, Participation, or account Session lock. Its server record binds User,
Session, registered key, verified build, Sitting/current revision, optional
existing Attempt, resolved policy, matrix, catalog bindings, challenge, and
expiry. Limit one pending preflight per Session/Sitting; superseding it invalidates
the old transaction. Rate limiting and bounded expired-transaction cleanup must
not change an Attempt's lifecycle. Replays return the same transaction while
valid, and an expired transaction returns a typed expired result.

An existing suspended Attempt must first be reallowed to ready. An active
Participation reconnect uses its existing scope and lease instead of obtaining
a replacement preflight. The candidate-wide unresolved-Attempt check remains
in authoritative Connect; preflight is not a reservation that bypasses it.

## Report that Desktop sends

Desktop verifies the effective policy, signed matrix, catalogs, source selection,
permissions, complete initial snapshots, and closed baseline effects in its
privileged processes. It uploads only a minimized report; raw native snapshots
never leave the device.

`POST /security-preflights/{preflight_id}/report`

Registered Desktop Session plus Idempotency-Key; body:

```typescript
type NativeSourceID =
  | 'display-topology'
  | 'candidate-window'
  | 'capture-session'
  | 'process-application'
  | 'interactive-session'
  | 'clipboard'
  | 'print-spooler'
  | 'removable-storage'
  | 'virtualization'
  | 'network-configuration'
  | 'media-device';
type SourceCategory =
  | 'os-clipboard-change'
  | 'removable-block-storage'
  | 'portable-mtp'
  | 'system-proxy-state'
  | 'os-managed-vpn-state'
  | 'tunnel-interface-state'
  | 'route-change'
  | 'network-source-health'
  | 'camera'
  | 'microphone';
type SourceHealth = 'starting' | 'healthy' | 'degraded' | 'failed' | 'recovering' | 'stopped';
type NativePermissionState = 'denied' | 'granted' | 'not_determined' | 'restricted' | 'unavailable';

interface SourceCoverage {
  source_id: NativeSourceID;
  source_instance_id: OpaqueID;
  sequence: SafeInt;
  source_schema_digest: SHA256;
  adapter_version: OpaqueID;
  health: SourceHealth;
  permission: NativePermissionState;
  complete: boolean;
  gap_count: SafeInt;
}
interface CoverageClaim {
  coverage_key: OpaqueID;
  source_schema_digest: SHA256;
  claim: 'enforce' | 'observe' | 'unavailable';
  state: 'ready' | 'degraded' | 'unavailable';
}
interface SecurityPreflightReport {
  challenge: string;
  policy_digest: SHA256;
  policy_content_digest: SHA256;
  capability_matrix_digest: SHA256;
  security_session_id: OpaqueID; // New local privileged coordinator lifetime.
  source_manifest_digest: SHA256;
  selected_source_categories: SourceCategory[];
  sources: SourceCoverage[]; // <=11; exact selected source set in manifest order.
  coverage: CoverageClaim[]; // <=64; exact required claim set, sorted by coverage_key.
  baseline: {
    constrained_window: 'verified' | 'unavailable';
    single_physical_display: 'verified' | 'unavailable';
    content_protection: 'verified' | 'unavailable';
  };
  posture: 'compliant' | 'degraded' | 'contained' | 'failed';
  reported_at: Instant;
}
interface SecurityPreflightResult {
  preflight_id: OpaqueID;
  report_digest: SHA256;
  admission: 'eligible' | 'blocked';
  reason_codes: SecurityReasonCode[]; // <=16, registered codes, no raw facts.
  server_time: Instant;
  expires_at: Instant; // Never later than the original challenge expiry.
}
type SecurityReasonCode =
  | 'policy_changed'
  | 'unsupported_capability'
  | 'source_unavailable'
  | 'permission_required'
  | 'baseline_unavailable'
  | 'preflight_expired'
  | 'preflight_superseded'
  | 'posture_blocked'
  | 'configuration_unsupported'
  | 'session_changed';
```

The report is bounded at 64 KiB. Hash its canonical bytes for report_digest;
the server computes this itself. Body identity and key identity must match the
prepared transaction. Permission/source state may only assert the matrix's
actual capabilities; it cannot introduce a new adapter, helper, claim, or schema.
Validate source/category selection against resolved policy, not against the
client's self-selected list. A shared media source cannot conceal one denied
selected endpoint behind another granted endpoint: per-capability coverage must
also be complete. Effect-only requirements appear in coverage/baseline even
when no source backs them.

Eligible means every enforced requirement is ready, every baseline requirement
is verified, no confirmed enforced condition is active, and the source lifetime
is fresh. Degraded observe-only coverage may be eligible under the observe-mode
rule in [release matrix and catalog trust](security-policy.md#release-matrix-and-catalog-trust). A permission-required result is not an instruction for
server-side permission prompting. Desktop's candidate-initiated preflight owns
prompts. A blocked report creates neither a misconduct Flag nor an Attempt.

## Consume preflight in the existing Connect transaction

Extend existing `exam_attempt.connect` request with required member
`security: ConnectSecurity` in the current realtime request:

```typescript
type ConnectSecurity =
  | { kind: 'preflight'; preflight_id: OpaqueID; report_digest: SHA256 }
  | { kind: 'resume'; participation_id: ID; generation: PositiveInt; policy_digest: SHA256 };
```

Keep the existing Sitting selector, continuity credential, Idempotency-Key,
and optional initial_configuration ([Attempt Configuration](attempt-configuration.md)). Replace the supported-manifest
list with required `configuration_manifest_fingerprint: SHA256`, identifying
the one current packaged configuration manifest.
For first admission and ready rejoin, lock/consume the eligible preflight in the
same named aggregate transaction that creates/activates the Attempt, freezes
configuration, selects the Session, revokes other Sessions, and creates the
Participation generation. Recheck all admission fences at commit: Session/key,
verified build/revocation, eligibility, Sitting/pause/end, current policy and
catalog digests, the reported preflight source lifetime, preflight expiry, unresolved Attempt,
and configuration. Reserve the security stream/control owner metadata in that
same transaction under [metadata reservations](protected-delivery.md#metadata-reservation-and-accounting). Capacity refusal consumes no preflight and creates
no Participation or Active Attempt; preserve an existing Ready Attempt.
Do not use report acceptance as later authorization.
Connect must arrive within 30 seconds of the server receiving the eligible
report, and before challenge expiry. Desktop rechecks live posture immediately
before Connect and aborts if its source lifetime or enforced state changed.
The server checks report/session bindings; it cannot independently attest OS
state merely because the report is authenticated.

Preflight is single-use. Exact Connect replay returns the recorded outcome;
changing its payload with the same key conflicts. A consumed preflight under a
new command cannot create a second Participation. Losing the response does not
force the client to invent a new key. Queries for preflight/Connect outcome are
scope-authorized and reveal only the retained result.

For first join, the prepared policy had admission scope. Connect produces a
successor envelope with the new Attempt scope while preserving exactly the
same policy_content_digest, matrix, catalogs, and selections. Its full digest
changes because scope changed. Return an authenticated binding receipt:

```typescript
interface AdmittedSecurity {
  policy: EffectiveExamSecurityPolicy; // scope.kind='attempt'.
  policy_content_digest: SHA256;
  preflight_id: OpaqueID;
  preflight_report_digest: SHA256;
  preflight_policy_digest: SHA256;
  participation_id: ID;
  generation: PositiveInt;
  security_session_id: OpaqueID;
  delivery_stream_id: OpaqueID;
  renewal_interval_seconds: PositiveInt;
}
```

Desktop verifies content equivalence and source continuity, binds its local
coordinator to the returned Attempt/generation/policy digest, and only then
publishes usable Candidate capabilities. The consumed admission scope is kept
as provenance and grants no future operation. Ready rejoin resolves fresh policy
but preserves the frozen configuration. Same-generation transport resume must
match its existing Session/key, security_session_id, continuity proof, policy,
and unexpired lease; it must not fabricate a new preflight or new source lifetime.
If privileged continuity was lost, use suspension/reallow/fresh preflight.

Add `GET /exam-attempts/{attempt_id}/security-policy` for the owning
registered Desktop Session to recover the exact active envelope/receipt after
transport ambiguity. Ready re-entry obtains policy/configuration through
preflight instead. Neither read allows another candidate's policy or evidence.

## Admission acceptance tests

- Exact current codec roundtrip; duplicate/unknown fields; every family disabled,
  observe, enforce, cross-field contradiction, size/list bound, and unknown ID.
- Previous policy shapes are rejected; publication and current fixtures use the
  same complete model and freeze exact selections and catalog bindings.
- Capability mismatch, missing baseline, lost permission, insufficient claim,
  unsupported target, spoofed release/matrix, and wrong source/category set fail.
- Admission report replay across User, key, Session, Sitting, Attempt, challenge,
  build, source lifetime, or expired transaction fails without creating an Attempt.
- Concurrent Connect consumes one preflight once and preserves the existing
  candidate-wide exclusion and account Session lock.
- First-join scope rebinding changes the envelope digest but not policy content;
  a one-field capability/catalog change between report and commit rejects join.
- Reallow/ready rejoin requires fresh preflight; within-lease transport resume
  retains the original generation only with continuous privileged ownership.
- Preflight/source failures never become automatic misconduct evidence.

## Current live-control models and operations

```typescript
interface NativeSourceReset {
  kind: 'source_reset';
  reset_id: OpaqueID;
  source_id: NativeSourceID;
  previous_source_instance_id: OpaqueID;
  previous_final_sequence: SafeInt;
  new_source_instance_id: OpaqueID;
  reason: 'restart' | 'resume' | 'permission_changed';
  occurred_at: Instant;
}
interface DeliveryWatermark {
  family: 'native' | 'browser';
  source_id: string; // Native stream OpaqueID or BrowserSourceID, respectively.
  allocated_through_sequence: SafeInt;
  acknowledged_through_sequence: SafeInt; // Actual contiguous receipts only.
}
interface SecurityCoverageRenewal {
  control_sequence: PositiveInt;
  policy_digest: SHA256;
  security_session_id: OpaqueID;
  stream_id: OpaqueID;
  posture: 'checking' | 'compliant' | 'degraded' | 'contained' | 'failed';
  sources: SourceCoverage[]; // Exact admitted set, <=11.
  coverage: CoverageClaim[]; // Exact required set, <=64.
  source_resets: NativeSourceReset[]; // <=11, canonical source order.
  delivery_watermarks: DeliveryWatermark[]; // <=50: current native + browser sources.
}
interface SourceResetReceipt {
  reset_id: OpaqueID;
  reset_digest: SHA256;
}
interface SecurityCoverageResult {
  processed_control_sequence: SafeInt;
  processed_control_digest: SHA256 | null;
  coverage_result: 'accepted' | 'stale_control' | 'reset_required' | 'reset_conflict';
  source_reset_receipts: SourceResetReceipt[];
  security_interaction_allowed: boolean;
  delivery_watermark_rejections: {
    family: 'native' | 'browser';
    source_id: string;
    reason: 'closed_source' | 'position_limit';
  }[];
}
```

Continue carrying security_coverage in `exam_attempt.renew`. Extend its result
with `security_coverage: SecurityCoverageResult`; keep the existing lease result
fields and renewal-sequence behavior. Add `exam_attempt.security.update`, using
the existing connection/continuity/generation envelope and a security_coverage
body. It changes current coverage/containment without extending the lease.
Both operations share one live-control owner and the same control_sequence.
The processed-control ordering section governs faults and successful snapshots.
The whole request remains bounded at 64 KiB.

security_interaction_allowed reports the shared security/continuity gates only.
The existing per-capability projection still applies [live corrections](live-corrections.md) and all other
operation-specific rules. A browser-only pending acknowledgement must not turn
this shared field false and thereby gate unrelated Workspace operations.

Desktop assigns a new control_sequence for each changed control body, including
a periodic snapshot; exact replay preserves bytes. [processed control ordering](secure-participation.md#processed-control-ordering) orders every processed
outcome, including coverage faults.

Lease renewal remains independent: a structurally valid, authenticated renewal
with reset_required/reset_conflict/stale_control can renew the lease while the
latest safe coverage gates remain closed as needed. reset_required or
reset_conflict closes the shared security gate until a greater processed control
establishes continuity; retaining an older healthy snapshot cannot bypass that
fault. Invalid authentication or ended Participation still denies renewal.
A foreign source selector is not a recoverable coverage gap. An unaccepted allocated watermark may produce its
bounded rejection while valid coverage/renewal proceeds; it cannot move a closed
source boundary or bypass quota. FinalDeliveryDeclaration handles any late tail.

Send a blocking posture update immediately through security.update; do not
wait for the next heartbeat or append queue. Coalesce redundant current-state
updates. Status, control, and lease processing have reserved bounded workers
and capacity distinct from historical append. Preserve rate limiting against
abuse, but do not spend the append token buckets on these operations.

## Reset validation before historical delivery

A reset applies only to the currently admitted source and selected categories.
Its old instance must match the latest accepted live source instance; its new
instance must be fresh, and its previous_final_sequence cannot precede the
last server-observed source watermark. A reported later final sequence is
source provenance, not receipt of raw observations. Require complete truthful
current coverage for the new instance before reopening any enforced gate.

Reset reason does not authorize arbitrary startup or a new policy. Preserve the
packaged supervisor's admitted restart limits; the current Desktop allows only
one automatic restart per source in a security-session lifetime. This contract
adds no extra native restarts. Policy/scope/generation replacement requires its
own admission flow and cannot use a source reset.

Commit the accepted reset edge, digest receipt, and latest live coverage
atomically. The corresponding NativeSourceReset in a later native batch carries
the same reset_id and exact fields. It links to the retained edge without
reapplying it or spending another restart allowance. A historical reset received
after closure may establish an evidence-only edge after the same source/budget
validation; it cannot mutate current live coverage or authorize a new source.
Missing historical edges remain explicit uncertainty.

A lost reset acknowledgement is recovered by replaying the same control/reset
IDs. Source reset receipts and current source identities are also returned by
`GET /exam-attempts/{attempt_id}/security-policy` for the currently owning active
Desktop, alongside the original admitted policy/receipt. Historical batch
arrival, replay, or a lower control_sequence never rolls the live head backward.

## Containment and recovery

Local containment closes Desktop dispatch immediately. On the authenticated
blocking control, the server durably closes its operation gates before emitting
transient effects. Pending historical batches play no role in that decision.

Reopening requires all current gates: usable native coverage, current lease/key/
Session/generation, appropriate Sitting state, and no applicable correction. A
delayed prior effect or observer callback cannot contradict a newer durable
decision.

Registered-key proof authenticates the sending installation credential. Matrix
validation restricts the claimed capabilities. Neither proves the physical OS
facts or independently proves utility-process continuity. Server guarantees
are authorization, validation, fencing, finite leases, and truthful provenance;
packaged/native correctness requires its own platform verification.

Tests: delayed historical reset with healthy new live snapshot; lost live reset
response; stale control after containment; unknown or reused source identity;
reset quota; exhausted evidence storage with continuing valid renewal; reordered
containment effects; and confirmed lease expiry despite unprocessed historical uploads.

## Processed control ordering

Maintain a processed-control boundary independently of the last usable coverage
snapshot. A control can be durably processed without establishing usable
coverage. Both `renew` and `security.update` use this one ordering boundary.

1. Validate encoding, authentication, current Participation authority, policy
   binding, and selector ownership first. Malformed or unauthorized requests
   do not advance the boundary or mutate coverage.
2. For a new greater sequence, atomically commit its sequence, canonical digest,
   bounded outcome, and resulting gates. This includes `reset_required` and
   `reset_conflict`. A delivery-watermark rejection also cannot make an otherwise
   processed control disappear from the ordering history.
3. A lower sequence never changes coverage, source identities, reset faults,
   or delivery watermarks. A matching retained replay remains
   idempotent; an unknown older sequence returns `stale_control`. Conflicting
   bytes at a retained sequence fail without installing either body.
4. Recovery after a processed fault requires a greater sequence than that fault,
   a valid snapshot for the current source identities, and all current gates.
   Keeping the last usable snapshot for provenance does not authorize reuse of
   its healthy result over the fault.
5. Exact replay returns the retained command outcome together with a fresh
   current gate projection. It never returns an old `true` gate as
   current authority. Desktop applies response projections monotonically by
   their processed-control sequence; an older response cannot undo newer local
   containment or a newer received server state. Other authority can become
   stricter without a new control, so the sequence itself never grants access.
6. Keep the proposed 128 recent sequence/digest receipts. Evicting a receipt does
   not erase the highest processed boundary. Persist it across application-node
   restart. Control-cache expiry does not make an old sequence fresh again.

The live-control array and request bounds above apply. Sequence zero and null digest
mean no control has yet been processed; the admitted preflight still supplies
the initial coverage state. `coverage_result` describes this command's outcome;
the processed boundary and gate fields describe current server state.
A retained replay can therefore report its original accepted outcome alongside
a newer processed boundary and a currently closed gate.

This changes neither the existing Participation renewal sequence nor its
idempotency rules. A valid renewal carrying a stale or faulted control can still
renew the unexpired lease under [live control](secure-participation.md#current-live-control-models-and-operations); it cannot restore interaction by doing so.

Shared acceptance cases: 9 healthy → 11 reset fault → delayed 10; successful
control replay after a newer fault; response reordering; conflicting same-sequence
bodies; receipt eviction and server restart; newer valid recovery; and unaffected
lease renewal while the security gate remains closed.

A source reset whose edge cannot fit the metadata reservation/capacity check
commits processed reset_required, closes required security gates, and preserves
valid lease renewal. It cannot establish usable source continuity; see [metadata reservations](protected-delivery.md#metadata-reservation-and-accounting).
