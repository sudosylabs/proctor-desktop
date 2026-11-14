# Authored and effective security policy

The accepted wire contract uses the [shared conventions](conventions.md).
[Contract map and implementation status](README.md) separate agreement from availability.

## Authored ExamPolicySet

The authored ExamPolicySet includes Focus Loss, Connection Loss, the ten
explicit native family selections, and the screen recorder switch. Preserve the
detector threshold meanings and bounds in this complete model.

```typescript
interface ExamPolicySet {
  connection_loss: { outcome: 'flag_and_suspend' };
  focus_loss: {
    enabled: boolean;
    minimum_duration_milliseconds: number; // Existing 500..300000 bound.
    incident_count: number; // Existing 1..100 bound.
    window_milliseconds: number; // Existing 10000..14400000 bound.
    outcome: 'flag' | 'flag_and_warn' | 'flag_and_suspend';
  };
  native: NativeSecurityPolicy;
}

interface NativeSecurityPolicy {
  registry_digest: SHA256; // The release capability registry; the only accepted value.
  baseline_id: 'desktop_candidate'; // The release baseline rule set; cannot be disabled.
  families: NativeFamilyPolicy[]; // Exactly the ten families below, in fixed order.
  screen_recording: { enabled: boolean };
}

type NativeFamilyOutcome = 'flag' | 'flag_and_suspend';
type NativeFamilyPolicy = { mode: NativeMode; outcome: NativeFamilyOutcome } & (
  | { id: 'process_application'; allowed_application_ids: OpaqueID[] }
  | { id: 'interactive_session' }
  | {
      id: 'clipboard';
      strategy: 'disabled' | 'private_attempt';
      observe_os_clipboard_changes: boolean;
    }
  | {
      id: 'printing';
      candidate_print_commands: 'deny' | 'not_applied';
      monitored_spooler: 'required' | 'not_required';
    }
  | {
      id: 'removable_storage';
      enabled_sub_capabilities: ('removable_block_storage' | 'portable_mtp')[];
    }
  | {
      id: 'virtualization';
      rule: 'not_applied' | 'block_recognized_guest' | 'require_certified_physical_environment';
    }
  | {
      id: 'network_configuration';
      enabled_sub_capabilities: (
        'system_proxy_state' | 'os_managed_vpn_state' | 'tunnel_interface_state'
      )[];
    }
  | {
      id: 'camera' | 'microphone';
      require_ready: boolean;
      concurrent_use_check: 'not_required' | 'supported_required';
    }
  | { id: 'external_capture'; mode: 'disabled' }
);
```

The fixed family order is process_application, interactive_session, clipboard,
printing, removable_storage, virtualization, network_configuration, camera,
microphone, external_capture. Every family is explicit, even disabled ones.
`allowed_application_ids` has at most 256 entries, sorted in ASCII order and
unique. The whole canonical ExamPolicySet remains bounded at 64 KiB.

Operation: `PUT /exams/{exam_id}/draft/policies/native`
(`configureExamDraftNativePolicy`), body
`{ expected_revision: PositiveInt; native: NativeSecurityPolicy }`, with an
Idempotency-Key. It replaces the complete native policy at the expected Draft
revision. Publication freezes these selections; a Draft edit never changes a
live Participation.

Native family configuration is selected policy, not a program: no paths,
process names, shell commands, regex programs, arbitrary hashes, OS API names,
effect sequences, or configurable low-level timing. Catalog IDs must resolve
against the release's application catalog when the policy is resolved for
admission.

## Family validation and interpretation

The language-neutral Desktop inputs are the release capability registry and its
published fact, rule and catalog schemas. Admit their contents as current server
agreement data; never read another local checkout at server runtime. The table
below is normative.

| Family                | Validation and behavior                                                                                                                                                                                                                                                      |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| process_application   | Disabled requires an empty allowlist. Non-disabled IDs are catalog applications the catalog marks allowable; empty adds no allowlist. While the family is on, the catalog's never-allowable applications are always blocked. A child process does not inherit authorization. |
| interactive_session   | Selects the interactive-session capability beyond the baseline session rule. Source failure is not a misconduct finding.                                                                                                                                                     |
| clipboard             | Disabled: strategy=disabled and observation=false. Observe: strategy=disabled and observation=true. Enforce: strategy=private_attempt; OS-change observation may independently be true or false. No clipboard bytes are uploaded.                                            |
| printing              | Disabled: not_applied/not_required. Observe: not_applied/required. Enforce: candidate commands=deny; spooler may be required or not_required. No claim of preventing all physical printing.                                                                                  |
| removable_storage     | Disabled: an empty list. Otherwise select one or both sub-capabilities. No mount paths or serials.                                                                                                                                                                           |
| virtualization        | Disabled requires not_applied. Otherwise choose one of the other two rules. Unknown physical status never proves physical execution.                                                                                                                                         |
| network_configuration | Disabled requires an empty list. Otherwise select one to three sub-capabilities. Only selected categories are queried.                                                                                                                                                       |
| camera/microphone     | Disabled requires require_ready=false and concurrent_use_check=not_required. A non-disabled family must select at least one check. They are separate selections despite sharing one device source. Endpoint state only; no media content.                                    |
| external_capture      | Only disabled is accepted. No global external-capture detection is claimed.                                                                                                                                                                                                  |

`outcome` is `flag` unless the family's mode is enforce; `flag_and_suspend`
requires enforce. An observe family never contains, flags, or suspends.

Drafts initialize all ten families to disabled with outcome `flag`, and the
screen recorder to off; retain existing Focus Loss and Connection Loss defaults.
Authoring, publication and persistence use this complete model. Incompatible
development records follow the single-contract replacement rules; no native
evidence is invented for them.

## Compiled activations and rules

The server compiles the frozen family selections into the effective policy's
`activations` and `rules`, in the rule grammar the Desktop release publishes.
Rule semantics, three-valued evaluation and the baseline rules are defined in
[native rules](../architecture/native-rules.md).

```typescript
type RegistryName = string; // ^[a-z][a-z0-9_]{0,63}$; a name the capability registry defines.
interface NativeActivation {
  capability: RegistryName;
  categories: RegistryName[]; // <=16 sub-categories; empty means every registered one.
}
interface NativeRule {
  rule_id: string; // <=128; ^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)*$, unique in the policy.
  capability: RegistryName; // Must be activated.
  mode: 'enforce' | 'observe';
  phase: 'readiness' | 'participation' | 'both';
  reason: string; // <=128; registered for the capability. Desktop owns its localized text.
  requirement: NativeCondition;
}
type NativeCondition =
  | {
      Compare: {
        field: string;
        op: 'eq' | 'ne' | 'lt' | 'le' | 'gt' | 'ge' | 'in' | 'not_in';
        value: unknown;
      };
    }
  | { All: { conditions: NativeCondition[] } } // 1..16 conditions.
  | { Any: { conditions: NativeCondition[] } } // 1..16 conditions.
  | { Not: { condition: NativeCondition } }
  | { AppsAbsent: { catalog_app_ids: RegistryName[] } } // 1..256, ASCII order.
  | { AppsOnly: { catalog_app_ids: RegistryName[] } }; // 1..256, ASCII order.
```

`field` is a registered field name (at most 128 bytes); `value` is a whole
number, one of an enumerated field's values, a boolean, or a list of them for
`in` and `not_in`. A policy has at most 32 activations and 64 rules. `rules`
begins with the release baseline, unchanged, followed by the rules compiled
from the family selections. The server can neither remove nor weaken the
baseline; the baseline rules always run. Any rule, field, value, reason,
capability or catalog application the registry does not define is refused.

Desktop evaluates the rules on the device; the server evaluates the same rules
again on the facts Desktop delivers, and its evaluation is authoritative.

## Native outcomes

An enforce rule that is not met opens an occurrence on the server, and an
enforce occurrence that opens raises that rule's native Flag (one per rule per
Participation generation, kind `native.<capability>`, with `native_rule_id`). When the
family's outcome is `flag_and_suspend`, that enforce occurrence also suspends
the Attempt exactly as a Focus Loss suspension does, with candidate reason
`native_policy_review_required`. Observe rules are recorded only. A rule that is
not met is not a misconduct finding by itself; its Flag is reviewed like any
other. Unknown status, gaps, permission problems and failed capabilities are
operational facts and never become misconduct evidence.

## Screen recording

`screen_recording.enabled` is off by default. When on, Desktop records the
candidate's screen on the device for the whole session and uploads only the
ranges the server requests ([screen clips](protected-delivery.md#screen-clips)).
The compiled policy then activates the `screen_recording` capability and adds
the rule `screen_recording.free_space`: mode enforce, phase readiness, reason
`screen_recording.low_disk_space`, requiring the reported free space to be at
least 3072 MiB (`free_space_mib` `ge` 3072). Start is therefore refused unless
the recorder is permitted and the device has that space. The candidate is told
before the Attempt starts through `screen_recording_disclosure`.

## Effective policy response

The privileged wire object maps into Desktop's
`EffectiveExamSecurityPolicy` in
`src/prctr/workbench/services/examSecurity/common/effectivePolicy.ts`:

```typescript
interface EffectiveExamSecurityPolicy {
  policy_id: OpaqueID;
  revision: Revision;
  ordinal: PositiveInt;
  digest: SHA256;
  institution_id: ID;
  exam_revision_id: ID;
  sitting_id: ID;
  scope: { kind: 'admission'; admission_scope_id: OpaqueID } | { kind: 'attempt'; attempt_id: ID };
  issued_at: Instant;
  active_from: Instant;
  application_release_id: OpaqueID;
  matrix_id: OpaqueID;
  target_tuple: OpaqueID;
  registry_digest: SHA256;
  focus_loss_mode: NativeMode;
  connection_loss_mode: 'enforce';
  resolved_exception_refs: []; // Always empty in the initial resolver scope.
  evidence_class_id: 'native_integrity';
  visibility_class_id: 'examiner_restricted';
  retention_class_id: 'native_minimized';
  capabilities: NativeFamilyPolicy[]; // The ten frozen family selections.
  screen_recording: { enabled: boolean };
  activations: NativeActivation[]; // <=32.
  rules: NativeRule[]; // <=64; baseline first.
}

interface SecurityPolicyResponse {
  server_time: Instant;
  policy: EffectiveExamSecurityPolicy;
  policy_content_digest: SHA256;
  readiness_digest: SHA256;
  capability_matrix_digest: SHA256;
  catalog_bindings: CatalogBinding[]; // <=32.
  preflight_challenge: PreflightChallenge;
  frozen_attempt_configuration: FrozenAttemptConfiguration | null;
  browser_activity_disclosure: BrowserActivityDisclosure;
  screen_recording_disclosure: ScreenRecordingDisclosure | null;
}

interface CatalogBinding {
  kind: 'application'; // The bundled application catalog is the only catalog.
  catalog_id: OpaqueID;
  revision: Revision;
  digest: SHA256;
}

interface ScreenRecordingDisclosure {
  notice_id: 'screen_recording';
  local_recording: 'whole_session_deleted_at_submission';
  uploads: 'requested_and_flagged_ranges_only';
  audience: 'exam_managers_of_the_sitting';
  clip_retention_days: number; // Integer 0..36500; 0 means no configured automatic expiry.
  retention_anchor: 'eligible_closed_sitting_records_completion';
  retention_policy_revision: PositiveInt;
}
```

Policy scope is exact; catalog bindings are unique and sorted by kind then
catalog_id; total response at most 128 KiB. issued_at <= active_from <= server
activation time. Policy timestamps use millisecond precision for lossless
Desktop safe-integer Unix milliseconds.

`screen_recording_disclosure` is required and is null when the policy's
recorder is off. Like `browser_activity_disclosure`, it carries identifiers that
Desktop turns into its own localized notice; it is neither consent nor playback
authority. Uploaded clips are integrity evidence and follow its retention; holds
still apply.

`policy.digest` hashes the policy wire object excluding digest and binds its
exact scope/timestamps. For `policy_content_digest`, construct exactly
`{ policy: P, catalog_bindings: B, capability_matrix_digest: M }`: P is the policy
with digest, scope, issued_at, and active_from removed; B is the
binding array sorted by kind then catalog_id, with unique kind/catalog_id pairs;
M is the certification digest. Hash that object's canonical bytes using
[wire conventions](conventions.md). It is the explicit proof that first-join
scope rebinding did not change selections or authority. The authenticated
response binds all these values; a hash alone is not authenticity.

`readiness_digest` identifies what the readiness overview shows and Desktop
enforces. It is the SHA-256 of the canonical bytes of exactly
`{ activations, rules, capabilities, screen_recording, focus_loss_mode,
connection_loss_mode, registry_digest, capability_matrix_digest,
catalog_bindings }`, taken from the policy and its resolution. It leaves out the
policy's own identity, so the overview and the preflight prepared at Start carry
the same value exactly when nothing that matters changed.

Keep Focus Loss duration/count/window/outcome in the existing server detector.
Projection maps disabled Focus Loss to disabled, enabled flag/flag_and_warn to
observe, and flag_and_suspend to enforce. The existing Focus Loss signal upload
continues to feed that server detector; Desktop does not rebuild its bucket
algorithm from these three mode values. This does not change Connection Loss.

## Readiness overview

Operation: `GET /exam-sittings/{sitting_id}/security-policy`
(`getSecurityPolicyOverview`).

```typescript
interface SecurityPolicyOverviewResponse {
  server_time: Instant;
  policy: EffectiveExamSecurityPolicy;
  readiness_digest: SHA256;
  capability_matrix_digest: SHA256;
  catalog_bindings: CatalogBinding[]; // <=32.
  browser_activity_disclosure: BrowserActivityDisclosure;
  screen_recording_disclosure: ScreenRecordingDisclosure | null;
}
```

It resolves the Sitting's current native policy under the same eligibility
checks as preparing a preflight, for the overview Desktop shows before Start:
the capabilities it activates, the rules it checks, the recorder switch and the
disclosures. It creates no preflight, records nothing and grants nothing, so the
overview may hold it while open. At Start, Desktop compares its readiness_digest
with the one the prepared preflight returns and refreshes the overview when they
differ.

## Release certification and catalog trust

Verified build agreement data binds the exact capability registry, application
catalog, configuration manifest, and a signed certification document for each
release target. The certification is part of the release agreement and is
verified through an admitted release key; browser/client uploads cannot register
new claims. `capability_matrix_digest` is the SHA-256 of the document's exact
signed bytes, and `matrix_id` names it.

```typescript
interface NativeCertification {
  registry_digest: SHA256;
  matrix_id: OpaqueID;
  release_id: OpaqueID;
  target_tuple: OpaqueID;
  capabilities: { capability: RegistryName; enforce_certified: boolean }[];
}
```

`capabilities` names every registry capability exactly once, sorted by
capability. Nothing is certified when `target_tuple` starts with `linux`.
Development builds certify every capability.

An enforce rule compiled from a family selection, and any `flag_and_suspend`
family, requires `enforce_certified` for its capability on the Attempt's target;
otherwise preparing a preflight fails closed with
`exam.security.unsupported_capability` and Start is refused. Observe mode runs
on every target. The baseline rules always run.

CatalogBinding references immutable approved data, not arbitrary uploaded
entries. Accept only IDs present in a catalog whose exact digest the Desktop
release or authenticated privileged catalog adapter can verify. An unavailable
Institution catalog fails closed with `exam.security.catalog_missing`. Do not
approximate executable identity using process names or paths.

## Policy replacement and emergency blocking

Freeze effective semantics for one active Participation generation. Reallow to
Ready and fresh join may resolve a successor policy. Preserve prior policy
provenance for evidence interpretation. [Live corrections](live-corrections.md)
can update instructions, resources and browser policy without rewriting native
security policy.

For the initial contract, provide emergency blocking through the existing
authorized Attempt suspension operation, including its reason, strong assurance,
idempotency, and audit requirements. It atomically suspends/fences the affected
Participation and emits the ordinary safe invalidation. Do not add a second
state machine or require a new route when that operation already supplies these
guarantees. A changed native policy is resolved
at the next ready join. An emergency block cannot weaken the frozen policy or
implicitly reallow a candidate. Selective live strengthening is outside the initial contract.

## Initial resolver scope

Resolve published typed selections, the release baseline, verified current
build/certification/catalogs, and existing eligibility/revocation/admission
fences. Return `resolved_exception_refs: []`. Nonempty references are unsupported,
not silently ignored. Institution restriction inheritance, accommodations, and
exception authoring/revocation are explicitly excluded from this initial contract.
They must not be advertised as implemented.

Allowlist IDs must resolve through the admitted catalog owner; a missing
Institution catalog mechanism does not permit process-name/path substitutes.
Evidence/visibility/retention classes are closed server-owned classifications:
native conditions follow integrity review/retention, operational native records
follow security-operational retention, and ordinary browser history follows its
own dedicated access/retention rules. Client strings cannot select broader access.

Acceptance: extended/long Sittings, extension-vs-close and renewal-vs-expiry
races, lost renewal response, stale Session, revocation, Ready rejoin, stable
active policy digest, uncertified enforce selections, and rejection of
unimplemented exception references.

## One frozen policy, existing renewable authority

The policy has no independent expiry or 24-hour lifetime maximum. issued_at and
active_from are server-owned provenance. The closed decoder rejects expires_at.
The AdmittedSecurity receipt binds the policy to its Participation; the policy
cannot authorize an operation on its own.

Use the existing `lease_expires_at`, renewal sequence, database time, Attempt
state, current Sitting state/deadline, registered Session/key, verified release,
and revocation checks to determine whether interaction is authorized. An active
policy digest is stable for that generation. Changing a lease deadline changes
neither the policy nor any source/evidence binding.

| Situation                                   | Required behavior                                                                                                                                                                                                                                                                   |
| ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| First admission or Ready rejoin             | Validate the current published policy and artifacts, candidate eligibility, and current Open/joinable Sitting at commit. Issue the existing short Participation lease, bounded by the current Sitting end. There is no requirement for a policy envelope to span the whole Sitting. |
| Preflight                                   | Use the 120-second challenge and Connect-within-30-seconds-of-report bounds. An expired preflight requires another preflight; no Attempt exists solely because preparation succeeded.                                                                                               |
| Normal renewal                              | Recheck current authoritative fences and renew the existing lease. Return the existing accepted_sequence, database_time, and lease_expires_at, plus the [security control](secure-participation.md#security-control-on-renewal) result.                                             |
| Sitting longer than 24 hours                | Same repeated short-lease renewal. It creates no special policy boundary. Delivery quotas remain finite under [delivery budgets](protected-delivery.md#workload-assumptions-and-admission-limits).                                                                                  |
| Manager extends an Open Sitting             | Serialize extension with closure/renewal using existing Sitting fences. Subsequent authorized renewal may use the new end. The same native policy, Participation, and evidence stream remain bound.                                                                                 |
| Extension races with expiry or closure      | Whichever authoritative transition commits first governs. An extension does not resurrect an expired Participation or reopen a Closing/Closed Sitting.                                                                                                                              |
| Local uncertainty or missed response        | Desktop contains interaction using its last confirmed deadline and existing conservative reconnect/time handling. It cannot extend authority from its wall clock or an unconfirmed response.                                                                                        |
| Confirmed lease expiry                      | Existing authoritative suspension and permanent generation fencing. Recovery is authorized reallow to Ready, followed by fresh preflight and Connect. No Active-but-policy-expired state is introduced.                                                                             |
| Native containment while the lease is valid | Desktop contains the CandidateWindow locally while an enforce rule is not met or unknown, and keeps renewing. Renewal never changes interaction. A `flag_and_suspend` occurrence suspends the Attempt under [native outcomes](#native-outcomes).                                    |
| Artifact/key/policy-use revocation          | Existing authorized blocking/suspension ends live authority. Re-admission requires an admissible current policy/build; the old record remains interpretable as historical provenance.                                                                                               |

The server should return an existing Connect/renewal idempotent result on an
exact retry, subject to the current authorization rules. A response-loss retry
cannot revive an ended generation or create another lease owner. Only
Participation renewal extends lease authority; an evidence upload or security
update does not.

Preflight expiry, authoritative lease expiry, and policy change/revocation are
distinct failure reasons. Historical replay uses the separate closure-based
24-hour deadline in [protected delivery](protected-delivery.md) and grants no live authority.
