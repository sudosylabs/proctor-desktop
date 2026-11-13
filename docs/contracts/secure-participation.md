# Secure admission and live participation

The accepted wire contract uses the [shared conventions](conventions.md).
[Contract map and implementation status](README.md) separate agreement from availability.

## Prepare a challenge before first join or ready rejoin

Operation:

`POST /exam-sittings/{sitting_id}/security-preflights` (`prepareSecurityPreflight`)

Require the registered Desktop Session, current candidate eligibility, compatible
verified release, and an Idempotency-Key. Body:

```typescript
interface PrepareSecurityPreflight {
  attempt_id?: ID; // Present for ready rejoin; absent for first admission.
  native_registry_digest: SHA256;
  configuration_manifest_fingerprint: SHA256; // Exact current packaged manifest.
}
interface PreflightChallenge {
  preflight_id: OpaqueID;
  challenge: string; // 32 random bytes encoded base64url without padding (43 characters).
  issued_at: Instant;
  expires_at: Instant; // Challenge lifetime: 120 seconds.
}
```

Return [SecurityPolicyResponse](security-policy.md#effective-policy-response),
including its frozen_attempt_configuration member from
[Attempt Configuration](attempt-configuration.md), its readiness_digest, and its
screen_recording_disclosure. For rejoin, the response returns the existing
immutable configuration to this candidate through privileged transport. First
admission returns null. Account settings source and arbitrary workspace content
are not part of preflight. Desktop compares readiness_digest with the
[readiness overview](security-policy.md#readiness-overview) it showed and
refreshes the overview when they differ.

Preparation fails closed when an Institution catalog is unavailable
(`exam.security.catalog_missing`) or an enforce selection needs a capability
the release does not certify for enforcement on the candidate's target
(`exam.security.unsupported_capability`; see
[release certification](security-policy.md#release-certification-and-catalog-trust)).

Preparation creates a bounded short-lived preflight transaction, not an Attempt,
Workspace, Participation, or account Session lock. Its server record binds User,
Session, registered key, verified build, Sitting/current revision, optional
existing Attempt, resolved policy, certification, catalog bindings, challenge,
and expiry. Limit one pending preflight per Session/Sitting; superseding it
invalidates the old transaction. Rate limiting and bounded expired-transaction
cleanup must not change an Attempt's lifecycle. Replays return the same
transaction while valid, and an expired transaction returns a typed expired
result.

An existing suspended Attempt must first be reallowed to ready. An active
Participation reconnect uses its existing scope and lease instead of obtaining
a replacement preflight. The candidate-wide unresolved-Attempt check remains
in authoritative Connect; preflight is not a reservation that bypasses it.

## Report that Desktop sends

Desktop verifies the effective policy, certification and catalogs, starts the
activated capabilities, obtains permissions, and evaluates the readiness rules
in its privileged processes. It uploads only a minimized report; inventories,
media, clipboard bytes and OS errors never leave the device.

`POST /security-preflights/{preflight_id}/report` (`reportSecurityPreflight`)

Registered Desktop Session plus Idempotency-Key; body (RegistryName is defined in
[compiled activations and rules](security-policy.md#compiled-activations-and-rules)):

```typescript
type NativeHealth = 'unsupported' | 'healthy' | 'degraded' | 'failed' | 'stopped';
type NativePermission = 'not_determined' | 'granted' | 'denied' | 'restricted' | 'unavailable';
type NativeCertainty = 'complete' | 'partial' | 'unknown';
type NativeRuleStatus = 'met' | 'not_met' | 'unknown';
type NativeUnknownCause =
  'unavailable' | 'gap' | 'unhealthy' | 'permission' | 'partial' | 'checking';

interface NativeCapabilityReadiness {
  capability: RegistryName;
  source_instance_id: OpaqueID;
  sequence: SafeInt; // The sequence the capability's event stream continues from.
  permission: NativePermission;
  health: NativeHealth;
  certainty: NativeCertainty;
  state: object; // Valid against the capability's published state schema; <=16 KiB.
  summary: object; // Valid against its published summary schema; <=16 KiB.
}
interface NativeRuleReport {
  rule_id: string; // <=128.
  status: NativeRuleStatus;
  unknown_cause?: NativeUnknownCause; // Present only when status is unknown.
}
interface SecurityPreflightReport {
  challenge: string;
  policy_digest: SHA256;
  policy_content_digest: SHA256;
  security_session_id: OpaqueID; // New local privileged native-agent lifetime.
  capabilities: NativeCapabilityReadiness[]; // <=32; one fresh fact per activation, in activation order.
  rules: NativeRuleReport[]; // <=64; Desktop's status for every readiness rule.
  reported_at: Instant;
}
interface SecurityPreflightResult {
  preflight_id: OpaqueID;
  report_digest: SHA256;
  admission: 'eligible' | 'blocked';
  reason_codes: ('preflight_expired' | 'native_rule_unmet')[]; // <=16, unique.
  rules: NativeRuleReport[]; // <=64; the server's status for every readiness rule.
  server_time: Instant;
  expires_at: Instant; // Never later than the original challenge expiry.
}
```

A field named `<capability>.<name>` is read from `state.<name>`, and
`<capability>.summary.<name>` from `summary.<name>`. The report is bounded at
128 KiB. The server computes report_digest from its canonical bytes. Body
identity and key identity must match the prepared transaction. Client
reported_at is provenance; server time controls challenge expiry and admission
freshness.

The server evaluates every readiness-phase rule (`readiness` or `both`) on the
reported facts. Every enforce and baseline rule must be met; an unknown status
blocks. Observe rules never block. Where its status differs from Desktop's, the
server's decides admission. A permission problem is not an instruction for
server-side permission prompting; Desktop's candidate-initiated preflight owns
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
catalog digests, preflight expiry, unresolved Attempt, and configuration.
Reserve the security stream/control owner metadata in that same transaction
under [metadata reservations](protected-delivery.md#metadata-reservation-and-accounting).
Capacity refusal consumes no preflight and creates no Participation or Active
Attempt; preserve an existing Ready Attempt. Do not use report acceptance as
later authorization.

Connect must arrive within 30 seconds of the server receiving the eligible
report, and before challenge expiry. Desktop rechecks its readiness rule
statuses immediately before Connect and aborts if a capability's source instance
changed or an enforce rule stopped being met. At Connect the server begins
tracking each capability from the report's facts. It checks report/session
bindings; it cannot independently attest OS state merely because the report is
authenticated.

Preflight is single-use. Exact Connect replay returns the recorded outcome;
changing its payload with the same key conflicts. A consumed preflight under a
new command cannot create a second Participation. Losing the response does not
force the client to invent a new key. Queries for preflight/Connect outcome are
scope-authorized and reveal only the retained result.

For first join, the prepared policy had admission scope. Connect produces a
successor envelope with the new Attempt scope while preserving exactly the
same policy_content_digest, certification, catalogs, and selections. Its full
digest changes because scope changed. Return an authenticated binding receipt:

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
  renewal_interval_seconds: 5;
}
```

Desktop verifies content equivalence and source continuity, binds its native
agent to the returned Attempt/generation/policy digest, and only then publishes
usable Candidate capabilities. When the CandidateWindow mounts it sends
`participation_confirmed` once on the native stream
([native records](protected-delivery.md#native-record-ownership)); before it the
server applies readiness-phase rules, from it participation-phase rules. The
consumed admission scope is kept as provenance and grants no future operation.
Ready rejoin resolves fresh policy but preserves the frozen configuration.
Same-generation transport resume must match its existing Session/key,
security_session_id, continuity proof, policy, and unexpired lease; it must not
fabricate a new preflight or new source lifetime. If privileged continuity was
lost, use suspension/reallow/fresh preflight.

## Recover the admitted binding

`GET /exam-attempts/{attempt_id}/security-policy` (`recoverExamSecurityPolicy`)
returns the exact active Participation binding to its owning registered Desktop
Session after transport ambiguity:

```typescript
interface SecurityPolicyRecovery {
  server_time: Instant;
  security: AdmittedSecurity;
  frozen_attempt_configuration: FrozenAttemptConfiguration;
  security_control: SecurityControlResult;
}
```

It checks current Session, key, compatibility, eligibility and lease; an open
transport Connection is not required. It creates no authority and never renews
the lease. Ready re-entry obtains policy/configuration through preflight
instead. Neither read allows another candidate's policy or evidence.

## Admission acceptance tests

- Exact current codec roundtrip; duplicate/unknown fields; every family disabled,
  observe, enforce, flag and flag_and_suspend, cross-field contradiction,
  size/list bound, and unknown ID.
- Previous policy shapes are rejected; publication and current fixtures use the
  same complete model and freeze exact selections, compiled rules and catalog
  bindings.
- A missing capability fact, facts out of activation order, a fact failing its
  published schema, an unmet or unknown enforce or baseline rule, lost
  permission, an uncertified enforce selection, and a spoofed release or
  certification fail.
- Admission report replay across User, key, Session, Sitting, Attempt, challenge,
  build, source instance, or expired transaction fails without creating an Attempt.
- Concurrent Connect consumes one preflight once and preserves the existing
  candidate-wide exclusion and account Session lock.
- First-join scope rebinding changes the envelope digest but not policy content;
  a one-field selection/catalog change between report and commit rejects join.
- Reallow/ready rejoin requires fresh preflight; within-lease transport resume
  retains the original generation only with continuous privileged ownership.
- Preflight and capability failures never become automatic misconduct evidence.

## Security control on renewal

Both `exam_attempt.renew` and `exam_attempt.security.update` carry a required
`security_control` member and return a `security_control` result:

```typescript
interface DeliveryWatermark {
  family: 'native' | 'browser';
  source_id: string; // Native stream OpaqueID or BrowserSourceID, respectively.
  allocated_through_sequence: SafeInt;
  acknowledged_through_sequence: SafeInt; // Actual contiguous receipts only.
}
interface SecurityControl {
  control_sequence: PositiveInt;
  policy_digest: SHA256;
  security_session_id: OpaqueID;
  stream_id: OpaqueID;
  delivery_watermarks: DeliveryWatermark[]; // <=50: current native + browser sources.
}
interface SecurityControlResult {
  processed_control_sequence: SafeInt;
  processed_control_digest: SHA256 | null;
  security_interaction_allowed: boolean;
  delivery_watermark_rejections: {
    family: 'native' | 'browser';
    source_id: string; // <=128.
    reason: 'closed_source' | 'position_limit';
  }[]; // <=50.
}
```

`security_control` is bounded at 16 KiB. `exam_attempt.renew` keeps the existing
lease result fields and renewal-sequence behavior. `exam_attempt.security.update`
uses the existing connection/continuity/generation envelope and carries only
`security_control`; it reports delivery watermarks without extending the lease.
Both operations share one control owner and the same control_sequence.

A renewal never changes whether the candidate may interact; only closing native
delivery does. Native rule statuses travel on the native stream, never in the
control. A control whose policy_digest is not the Participation's current policy
is refused with `exam.security.policy_changed`.

security_interaction_allowed reports the shared security/continuity gates only.
The existing per-capability projection still applies [live corrections](live-corrections.md) and all other
operation-specific rules. A browser-only pending acknowledgement must not turn
this shared field false and thereby gate unrelated Workspace operations.

Desktop assigns a new control_sequence for each changed control body, including
a periodic snapshot; exact replay preserves bytes.
[Processed control ordering](#processed-control-ordering) orders every
processed outcome.

An unaccepted allocated watermark may produce its bounded rejection while the
control and renewal proceed; it cannot move a closed source boundary or bypass
quota. FinalDeliveryDeclaration handles any late tail. A foreign source selector
is refused. Invalid authentication or an ended Participation still denies
renewal.

Coalesce redundant updates. Control and lease processing have reserved bounded
workers and capacity distinct from historical append. Preserve rate limiting
against abuse, but do not spend the append token buckets on these operations.

## Containment and recovery

Desktop contains the CandidateWindow locally while an enforce participation rule
is not met or unknown, and reports that in `rule_status` records
([native records](protected-delivery.md#native-record-ownership)). Containment
closes Desktop dispatch immediately; it does not wait for the server or for
pending batches. Lease renewal continues while contained.

The server's own rule evaluation is authoritative for occurrences, Flags and
suspension ([native outcomes](security-policy.md#native-outcomes)). A
`flag_and_suspend` occurrence suspends the Attempt; recovery from suspension is
the ordinary reallow to Ready, fresh preflight and Connect. Desktop's statuses
are compared with the server's and any discrepancy is counted, never applied.

Reopening interaction requires all current gates: met enforce rules on the
device, current lease/key/Session/generation, appropriate Sitting state, and no
applicable correction. A delayed prior effect or observer callback cannot
contradict a newer durable decision.

Registered-key proof authenticates the sending installation credential.
Certification restricts which capabilities may enforce. Neither proves the
physical OS facts or independently proves native-agent continuity. Server
guarantees are authorization, validation, fencing, finite leases, and truthful
provenance; packaged/native correctness requires its own platform verification.

Tests: lost renewal response; stale control after containment; a non-current
policy digest; exhausted evidence storage with continuing valid renewal; Desktop
and server rule-status disagreement; flag_and_suspend suspension while
contained; and confirmed lease expiry despite unprocessed historical uploads.

## Processed control ordering

Maintain one processed-control boundary. Both `renew` and `security.update` use
it.

1. Validate encoding, authentication, current Participation authority, policy
   binding, and selector ownership first. Malformed or unauthorized requests
   do not advance the boundary or change watermarks.
2. For a new greater sequence, atomically commit its sequence, canonical digest,
   and resulting delivery watermarks. A delivery-watermark rejection cannot make
   an otherwise processed control disappear from the ordering history.
3. A lower sequence never changes delivery watermarks. A matching retained
   replay remains idempotent; an unknown older sequence changes nothing.
   Conflicting bytes at a retained sequence fail
   (`exam.security.control_conflict`) without installing either body.
4. Exact replay returns the retained command outcome together with a fresh
   current gate projection. It never returns an old `true` gate as current
   authority. Desktop applies response projections monotonically by their
   processed-control sequence; an older response cannot undo newer local
   containment or a newer received server state. Other authority can become
   stricter without a new control, so the sequence itself never grants access.
5. Keep the proposed 128 recent sequence/digest receipts. Evicting a receipt does
   not erase the highest processed boundary. Persist it across application-node
   restart. Control-cache expiry does not make an old sequence fresh again.

Sequence zero and null digest mean no control has yet been processed. The
processed boundary and gate fields describe current server state.

This changes neither the existing Participation renewal sequence nor its
idempotency rules. A valid renewal carrying a stale control still renews the
unexpired lease; it cannot restore interaction by doing so.

Shared acceptance cases: response reordering; conflicting same-sequence bodies;
receipt eviction and server restart; a delayed older control after a newer one;
and unaffected lease renewal while delivery is closed.
