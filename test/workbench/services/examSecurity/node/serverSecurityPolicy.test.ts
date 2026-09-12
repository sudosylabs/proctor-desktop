import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
	NATIVE_BASELINE_CAPABILITIES,
	NATIVE_CAPABILITY_REGISTRY_DIGEST,
	type NativeCapabilityMatrix
} from '../../../../../src/prctr/platform/native/common/nativeCapabilityRegistry.js';
import {
	canonicalContractBytes,
	canonicalContractDigest
} from '../../../../../src/prctr/platform/serverApi/node/canonicalContract.js';
import {
	decodeServerSecurityPolicy,
	type SecurityPolicyExpectation
} from '../../../../../src/prctr/workbench/services/examSecurity/node/serverSecurityPolicy.js';

const digest = `sha256:${'a'.repeat(64)}`;
const id = 'y'.repeat(26);
function fixture() {
	const policy = {
		policy_id: 'policy:one',
		revision: '1',
		ordinal: 1,
		digest,
		institution_id: id,
		exam_revision_id: id,
		sitting_id: id,
		scope: { kind: 'admission', admission_scope_id: 'scope:one' },
		issued_at: '2026-01-01T00:00:00Z',
		active_from: '2026-01-01T00:00:00Z',
		application_release_id: 'desktop:one',
		matrix_id: 'matrix:one',
		target_tuple: 'macos:arm64',
		registry_digest: NATIVE_CAPABILITY_REGISTRY_DIGEST,
		focus_loss_mode: 'observe',
		connection_loss_mode: 'enforce',
		resolved_exception_refs: [],
		evidence_class_id: 'native_integrity',
		visibility_class_id: 'examiner_restricted',
		retention_class_id: 'native_minimized',
		capabilities: [
			{ id: 'process_application', mode: 'disabled', allowed_application_ids: [] },
			{ id: 'interactive_session', mode: 'disabled' },
			{
				id: 'clipboard',
				mode: 'disabled',
				strategy: 'disabled',
				observe_os_clipboard_changes: false
			},
			{
				id: 'printing',
				mode: 'disabled',
				candidate_print_commands: 'not_applied',
				monitored_spooler: 'not_required'
			},
			{
				id: 'removable_storage',
				mode: 'disabled',
				enabled_sub_capabilities: [],
				allowed_storage_function_class_ids: []
			},
			{ id: 'virtualization', mode: 'disabled', rule: 'not_applied' },
			{
				id: 'network_configuration',
				mode: 'disabled',
				enabled_sub_capabilities: [],
				allowed_managed_profile_ids: [],
				allowed_adapter_class_ids: [],
				allowed_tunnel_class_ids: []
			},
			{
				id: 'camera',
				mode: 'disabled',
				require_ready: false,
				concurrent_use_check: 'not_required'
			},
			{
				id: 'microphone',
				mode: 'disabled',
				require_ready: false,
				concurrent_use_check: 'not_required'
			},
			{ id: 'external_capture', mode: 'disabled' }
		]
	};
	const binding = {
		kind: 'detector' as const,
		catalog_id: 'native.detectors',
		revision: digest,
		digest
	};
	const response = {
		server_time: '2026-09-12T12:00:00Z',
		policy,
		policy_content_digest: digest,
		capability_matrix_digest: digest,
		catalog_bindings: [binding],
		preflight_challenge: {
			preflight_id: 'preflight:one',
			challenge: 'A'.repeat(43),
			issued_at: '2026-09-12T12:00:00Z',
			expires_at: '2026-09-12T12:02:00Z'
		},
		frozen_attempt_configuration: null,
		browser_activity_disclosure: {
			audience: 'exam_managers_with_browser_activity_permission',
			browser_activity_retention_days: 30,
			may_create_integrity_evidence: true,
			notice_id: 'integrated_browser_activity',
			retention_anchor: 'eligible_closed_sitting_records_completion',
			retention_policy_revision: 1
		}
	};
	const matrix: NativeCapabilityMatrix = {
		registry_digest: NATIVE_CAPABILITY_REGISTRY_DIGEST,
		matrix_id: 'matrix:one',
		release_id: 'desktop:one',
		target_tuple: 'macos:arm64',
		entries: NATIVE_BASELINE_CAPABILITIES.map((item) => ({
			coverage_key: item.coverageKey,
			source_schema_digest: item.sourceSchemaDigest,
			claim: 'enforce',
			component_id: 'component:one',
			adapter_version: '1',
			required_permissions: [],
			limitations: [],
			verification: 'passed'
		}))
	};
	const expectation: SecurityPolicyExpectation = {
		institutionId: id,
		examRevisionId: id,
		sittingId: id,
		scope: { kind: 'admission', admissionScopeId: 'scope:one' },
		matrix,
		matrixDigest: digest,
		catalogs: [{ binding, entryIds: new Set() }]
	};
	const seal = (): Uint8Array => {
		const { digest: _digest, ...unsigned } = response.policy;
		response.policy.digest = canonicalContractDigest(unsigned);
		const { scope: _scope, issued_at: _issued, active_from: _active, ...content } = unsigned;
		response.policy_content_digest = canonicalContractDigest({
			policy: content,
			catalog_bindings: response.catalog_bindings,
			capability_matrix_digest: response.capability_matrix_digest
		});
		return canonicalContractBytes(response);
	};
	return { response, expectation, seal };
}

void test('authenticated policy maps exact wire fields, retains no expiry and binds release/scope/content', () => {
	const { response, expectation, seal } = fixture();
	const decoded = decodeServerSecurityPolicy(seal(), expectation);
	assert.equal(decoded.policy.policyId, response.policy.policy_id);
	assert.equal(decoded.policy.activeFromUnixMs, Date.parse(response.policy.active_from));
	assert.equal(decoded.policyContentDigest, response.policy_content_digest);
	assert.equal('expiresAtUnixMs' in decoded.policy, false);
	assert.equal(Object.isFrozen(decoded.preflightChallenge), true);
	assert.deepEqual(decoded.selection.selectedSources, [
		'display-topology',
		'candidate-window',
		'capture-session'
	]);
	assert.throws(
		() => decodeServerSecurityPolicy(seal(), { ...expectation, sittingId: 'b'.repeat(26) }),
		/scope/u
	);
	assert.throws(
		() => decodeServerSecurityPolicy(seal(), { ...expectation, catalogs: [] }),
		/catalog trust/u
	);
});

void test('rejects nested unknown fields, duplicate members, weak prefix-only families and digest tampering', () => {
	const { response, expectation, seal } = fixture();
	const bytes = seal();
	assert.throws(() =>
		decodeServerSecurityPolicy(
			new TextEncoder().encode(
				new TextDecoder()
					.decode(bytes)
					.replace(
						'"server_time":',
						'"server_time":"2026-09-12T12:00:00Z","server_time":'
					)
			),
			expectation
		)
	);
	Object.assign(response.policy.capabilities[1]!, { arbitrary_program: 'denied' });
	assert.throws(() => decodeServerSecurityPolicy(seal(), expectation));
	delete (response.policy.capabilities[1] as Record<string, unknown>).arbitrary_program;
	response.policy.capabilities[1]!.mode = 'unknown';
	assert.throws(() => decodeServerSecurityPolicy(seal(), expectation));
	response.policy.capabilities[1]!.mode = 'disabled';
	Object.assign(response.policy, { expires_at: '2026-09-13T12:00:00Z' });
	assert.throws(() => decodeServerSecurityPolicy(seal(), expectation));
	delete (response.policy as Record<string, unknown>).expires_at;
	seal();
	response.policy.ordinal++;
	assert.throws(
		() => decodeServerSecurityPolicy(canonicalContractBytes(response), expectation),
		/policy digest/u
	);
});

void test('expired challenge blocks while unavailable observe coverage remains explicit without opening a source', () => {
	const { response, expectation, seal } = fixture();
	response.preflight_challenge.expires_at = response.server_time;
	assert.throws(() => decodeServerSecurityPolicy(seal(), expectation), /preflight time/u);
	response.preflight_challenge.expires_at = '2026-09-12T12:02:00Z';
	Object.assign(response.policy.capabilities[7]!, { mode: 'observe', require_ready: true });
	const decoded = decodeServerSecurityPolicy(seal(), expectation);
	assert.deepEqual(decoded.selection.unavailableCoverageKeys, ['native.camera_ready.v1']);
	assert.equal(decoded.selection.selectedSources.includes('media-device'), false);
	assert.deepEqual(decoded.selection.selectedSourceCategories, []);
	assert.deepEqual(decoded.selection.requestedSourceCategories, ['camera']);
	Object.assign(response.policy.capabilities[7]!, { mode: 'enforce' });
	assert.throws(() => decodeServerSecurityPolicy(seal(), expectation), /cannot satisfy/u);
});
