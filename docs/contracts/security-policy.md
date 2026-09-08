# Authored and effective security policy

The accepted wire contract uses the [shared conventions](conventions.md).
[Contract map and implementation status](README.md) separate agreement from availability.

## Authored ExamPolicySet

The authored ExamPolicySet includes Focus Loss, Connection Loss, and the ten
explicit native family selections. Preserve the detector threshold meanings and
bounds in this complete model.

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
  native: {
    registry_digest: SHA256;
    baseline_id: 'desktop_candidate';
    families: NativeFamilyPolicy[]; // Exactly the ten families below, in fixed order.
  };
}

type NativeFamilyPolicy =
  | { id: 'process_application'; mode: NativeMode; allowed_application_ids: OpaqueID[] }
  | { id: 'interactive_session'; mode: NativeMode }
  | {
      id: 'clipboard';
      mode: NativeMode;
      strategy: 'disabled' | 'private_attempt';
      observe_os_clipboard_changes: boolean;
    }
  | {
      id: 'printing';
      mode: NativeMode;
      candidate_print_commands: 'deny' | 'not_applied';
      monitored_spooler: 'required' | 'not_required';
    }
  | {
      id: 'removable_storage';
      mode: NativeMode;
      enabled_sub_capabilities: ('removable_block_storage' | 'portable_mtp')[];
      allowed_storage_function_class_ids: OpaqueID[];
    }
  | {
      id: 'virtualization';
      mode: NativeMode;
      rule: 'not_applied' | 'block_recognized_guest' | 'require_certified_physical_environment';
    }
  | {
      id: 'network_configuration';
      mode: NativeMode;
      enabled_sub_capabilities: (
        | 'system_proxy_state'
        | 'os_managed_vpn_state'
        | 'tunnel_interface_state'
        | 'route_change'
        | 'network_source_health'
      )[];
      allowed_managed_profile_ids: OpaqueID[];
      allowed_adapter_class_ids: OpaqueID[];
      allowed_tunnel_class_ids: OpaqueID[];
    }
  | {
      id: 'camera' | 'microphone';
      mode: NativeMode;
      require_ready: boolean;
      concurrent_use_check: 'not_required' | 'supported_required';
    }
  | { id: 'external_capture'; mode: 'disabled' };
```

The fixed family order is process_application, interactive_session, clipboard,
printing, removable_storage, virtualization, network_configuration, camera,
microphone, external_capture. Every family is explicit, even disabled ones.
Each catalog-ID list has at most 256 entries, sorted in ASCII order. The whole
canonical ExamPolicySet remains bounded at 64 KiB. One client's large catalog
list does not override the whole-document ceiling.

Native family configuration is selected policy, not a program: no paths,
process names, shell commands, regex programs, arbitrary hashes, OS API names,
effect sequences, or configurable low-level timing. Registry IDs must resolve
against an authenticated catalog bound to the verified release/Institution.

## Family validation and interpretation

The language-neutral Desktop inputs are
`native/schemas/native-capability-registry.json` and
`native/schemas/native-capability-policy.schema.json`. Admit their registry
and schema contents as current server agreement data; never read another local
checkout at server runtime. The table below is normative.

| Family                | Validation and behavior                                                                                                                                                                                                                                                                                                             |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| process_application   | Disabled requires an empty allowlist. Non-disabled IDs select registered application identities. OS-essential classifications remain release-owned. A child process does not inherit authorization. Shell/interpreter/automation/remote-control/capture/local-server classes cannot be made allowed merely by registering a signer. |
| interactive_session   | Enforce requires certified coverage of all relevant human sessions, including disconnected sessions; system/service sessions are excluded. Source failure is not a misconduct finding.                                                                                                                                              |
| clipboard             | Disabled: strategy=disabled and observation=false. Observe: strategy=disabled and observation=true. Enforce: strategy=private_attempt; OS-change observation may independently be true or false. No clipboard bytes are uploaded.                                                                                                   |
| printing              | Disabled: not_applied/not_required. Observe: not_applied/required. Enforce: candidate commands=deny; spooler may be required or not_required. No claim of preventing all physical printing.                                                                                                                                         |
| removable_storage     | Disabled: both lists empty. Otherwise select at least one and at most two sub-capabilities. Allowed classes are bounded registered IDs. No mount paths or serials.                                                                                                                                                                  |
| virtualization        | Disabled requires not_applied. Otherwise choose one of the other two rules; the exact target must certify its claimed coverage. Unknown physical status never proves physical execution.                                                                                                                                            |
| network_configuration | Disabled requires all lists empty. Otherwise select at least one of the five sub-capabilities. route_change always needs observe coverage, even when the family mode is enforce; a route-change notification alone is not a violation. Only selected categories may be queried.                                                     |
| camera/microphone     | Disabled requires require_ready=false and concurrent_use_check=not_required. A non-disabled family must select at least one useful check. They are separate permission/capability selections despite sharing one source. Endpoint state only; no media content.                                                                     |
| external_capture      | Only disabled is accepted. No global external-capture detection is claimed.                                                                                                                                                                                                                                                         |

The fixed baseline requires a constrained CandidateWindow, one physical usable
display without mirrored/virtual/remote secondary targets, trusted source
supervision, and Proctor-owned content protection. It is not switchable by an
Exam Manager. The existing baseline capture-session source may verify bounded
Proctor-owned protection state; it does not authorize external capture detection
when external_capture is disabled.

Drafts initialize all ten broader families to disabled; retain existing Focus
Loss and Connection Loss defaults. Authoring, publication and persistence use
this complete model. Incompatible development records follow the single-contract
replacement rules; no historical native evidence is invented.

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
  resolved_exception_refs: OpaqueID[]; // Empty in the initial resolver scope.
  evidence_class_id: OpaqueID;
  visibility_class_id: OpaqueID;
  retention_class_id: OpaqueID;
  capabilities: NativeFamilyPolicy[];
}

interface SecurityPolicyResponse {
  server_time: Instant;
  policy: EffectiveExamSecurityPolicy;
  policy_content_digest: SHA256;
  capability_matrix_digest: SHA256;
  catalog_bindings: CatalogBinding[];
  preflight_challenge: PreflightChallenge;
  frozen_attempt_configuration: FrozenAttemptConfiguration | null;
  browser_activity_disclosure: BrowserActivityDisclosure;
}

interface CatalogBinding {
  kind:
    | 'application'
    | 'storage_function'
    | 'managed_network_profile'
    | 'network_adapter_class'
    | 'tunnel_class'
    | 'detector';
  catalog_id: OpaqueID;
  revision: Revision;
  digest: SHA256;
}
```

Policy scope is exact; at most 32 catalog bindings; total response at most
128 KiB. issued_at <= active_from <= server activation time. Policy timestamps
use millisecond precision for lossless Desktop safe-integer Unix milliseconds.

`policy.digest` hashes the policy wire object excluding digest and binds its
exact scope/timestamps. For `policy_content_digest`, construct exactly
`{ policy: P, catalog_bindings: B, capability_matrix_digest: M }`: P is the policy
with digest, scope, issued_at, and active_from removed; B is the
binding array sorted by kind then catalog_id, with unique kind/catalog_id pairs;
M is the verified matrix digest. Hash that object's canonical bytes using [wire conventions](conventions.md).
It is the explicit proof that
first-join scope rebinding did not change selections or authority. The
authenticated response binds all these values; a hash alone is not authenticity.

Keep Focus Loss duration/count/window/outcome in the existing server detector.
Projection maps disabled Focus Loss to disabled, enabled flag/flag_and_warn to
observe, and flag_and_suspend to enforce. The existing Focus Loss signal upload
continues to feed that server detector; Desktop does not rebuild its bucket
algorithm from these three mode values. This does not change Connection Loss.

## Release matrix and catalog trust

Extend verified build agreement data to bind the exact native registry, source
manifest, signed matrix digest, target tuple, detector catalog, and configuration
manifest. Use one current matrix structure with registry_digest, matrix_id,
release_id, target_tuple, and one entry per known coverage_key with
source_schema_digest, claim, component_id, adapter_version, optional
helper_build_id, required_permissions, limitations, and verification. The
registry/source-schema digests identify exact packaged artifacts. Desktop and
server adapters must use these same artifact identities rather than advertise
supported format lists. Verify signed bytes through an admitted release key;
browser/client uploads cannot register new claims.

Require passed enforce coverage for each enforced source-backed/effect-backed
claim. Observe requirements may have observe or enforce coverage. In this
protocol, observe mode permits unavailable/degraded observation and requires
explicit truthful coverage reporting; no separate optional flag is implied.
A missing observe-only claim therefore appears as claim=unavailable and
state=unavailable. It cannot be reported as a working source. The opened source
set consists of mandatory baseline sources plus certified selected sources;
unavailable observe-only sources are omitted from that set and identified in
coverage. Runtime failure of an opened observe-only source stays visible in
sources. Required effect-only claims are checked even if no source opens.
Baseline window/display/protection evidence remains mandatory independently of
the ten optional family modes. No newly signed production claim is requested
until real target-native certification exists.

CatalogBinding references immutable approved data, not arbitrary uploaded
entries. For initial delivery, accept only IDs present in a catalog whose exact
digest the Desktop release or authenticated privileged catalog adapter can
verify. If the server has no Institution application-catalog authoring/delivery
owner, report that dependency and leave nonempty Institution allowlists
unavailable. Do not approximate executable identity using process names or paths.

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

Resolve published typed selections, mandatory baseline, verified current
build/matrix/catalogs, and existing eligibility/revocation/admission fences.
Return `resolved_exception_refs: []`. Nonempty references are unsupported,
not silently ignored. Institution restriction inheritance, accommodations, and
exception authoring/revocation are explicitly excluded from this initial contract.
They must not be advertised as implemented.

Allowlist IDs must resolve through the admitted catalog owner; a missing
Institution catalog mechanism does not permit process-name/path substitutes.
Evidence/visibility/retention classes are closed server-owned classifications:
native conditions follow integrity review/retention, operational health follows
security-operational retention, and ordinary browser history follows its own
dedicated access/retention rules. Client strings cannot select broader access.

Acceptance: extended/long Sittings, extension-vs-close and renewal-vs-expiry
races, lost renewal response, stale Session, revocation, Ready rejoin, stable
active policy digest, and rejection of unimplemented exception references.

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
| Normal renewal                              | Recheck current authoritative fences and renew the existing lease. Return the existing accepted_sequence, database_time, and lease_expires_at, plus [live control](secure-participation.md#current-live-control-models-and-operations)'s coverage result.                           |
| Sitting longer than 24 hours                | Same repeated short-lease renewal. It creates no special policy boundary. Delivery quotas remain finite under [delivery budgets](protected-delivery.md#workload-assumptions-and-admission-limits).                                                                                  |
| Manager extends an Open Sitting             | Serialize extension with closure/renewal using existing Sitting fences. Subsequent authorized renewal may use the new end. The same native policy, Participation, and evidence stream remain bound.                                                                                 |
| Extension races with expiry or closure      | Whichever authoritative transition commits first governs. An extension does not resurrect an expired Participation or reopen a Closing/Closed Sitting.                                                                                                                              |
| Local uncertainty or missed response        | Desktop contains interaction using its last confirmed deadline and existing conservative reconnect/time handling. It cannot extend authority from its wall clock or an unconfirmed response.                                                                                        |
| Confirmed lease expiry                      | Existing authoritative suspension and permanent generation fencing. Recovery is authorized reallow to Ready, followed by fresh preflight and Connect. No Active-but-policy-expired state is introduced.                                                                             |
| Native containment while the lease is valid | Keep renewing, close affected interaction gates, and freeze execution under [live control](secure-participation.md#current-live-control-models-and-operations). Verified recovery may reopen permitted gates in the same generation.                                                |
| Artifact/key/policy-use revocation          | Existing authorized blocking/suspension ends live authority. Re-admission requires an admissible current policy/build; the old record remains interpretable as historical provenance.                                                                                               |

The server should return an existing Connect/renewal idempotent result on an
exact retry, subject to the current authorization rules. A response-loss retry
cannot revive an ended generation or create another lease owner. Only
Participation renewal extends lease authority; an evidence upload, source
declaration, or security control update does not.

Preflight expiry, authoritative lease expiry, and policy change/revocation are
distinct failure reasons. Historical replay uses the separate closure-based
24-hour deadline in [protected delivery](protected-delivery.md) and grants no live authority.
