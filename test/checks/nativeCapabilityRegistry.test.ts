import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import {
	NATIVE_CAPABILITY_REGISTRY,
	NativeCapabilityMatrixError,
	getNativeCapability,
	nativeCoverageKeys,
	verifyNativeCapabilityMatrix,
	type NativeCapabilityMatrix
} from '../../src/prctr/platform/native/common/nativeCapabilityRegistry.ts';

void test('native capability registry has stable unique family and coverage identities', () => {
	assert.equal(
		new Set(NATIVE_CAPABILITY_REGISTRY.map((entry) => entry.id)).size,
		NATIVE_CAPABILITY_REGISTRY.length
	);
	assert.equal(new Set(nativeCoverageKeys()).size, nativeCoverageKeys().length);
	assert.equal(getNativeCapability('clipboard')?.sourceId, 'clipboard');
	assert.deepEqual(getNativeCapability('external_capture')?.modes, ['disabled']);
	assert.deepEqual(getNativeCapability('process_application')?.permissions, {
		windows: [],
		macos: ['full_disk_access', 'endpoint_security'],
		linux: []
	});
	assert.equal(getNativeCapability('unknown'), undefined);
	assert.equal(
		NATIVE_CAPABILITY_REGISTRY.every(
			(entry) =>
				entry.privacy === 'mechanical_state_no_content' &&
				(entry.id === 'external_capture'
					? entry.modes.join(',') === 'disabled'
					: entry.modes.join(',') === 'disabled,observe,enforce') &&
				entry.configurationSchema.startsWith(
					'native/schemas/native-capability-policy.schema.json#/$defs/'
				) &&
				entry.subCapabilities.every((subCapability) =>
					Object.values(subCapability.platformCoverageKeys).every(
						(coverageKey) => coverageKey === subCapability.coverageKey
					)
				)
		),
		true
	);
});

void test('native policy schemas expose only closed catalog choices', () => {
	const schema = JSON.parse(
		readFileSync(
			new URL('../../native/schemas/native-capability-policy.schema.json', import.meta.url),
			'utf8'
		)
	) as {
		readonly $defs: Record<
			string,
			{
				readonly properties?: Record<string, unknown>;
				readonly allOf?: readonly unknown[];
			}
		>;
	};
	const processProperties = schema.$defs.ProcessApplicationPolicy?.properties ?? {};
	assert.deepEqual(Object.keys(processProperties), ['mode', 'allowed_application_ids']);
	const networkProperties = schema.$defs.NetworkConfigurationPolicy?.properties ?? {};
	assert.equal(Object.hasOwn(networkProperties, 'vpn_allowed'), false);
	assert.equal(Object.hasOwn(networkProperties, 'allowed_managed_profile_ids'), true);
	assert.equal(
		Object.hasOwn(
			schema.$defs.RemovableStoragePolicy?.properties ?? {},
			'allowed_storage_function_class_ids'
		),
		true
	);
	assert.deepEqual(
		(
			schema.$defs.RemovableStoragePolicy?.properties as
				| {
						readonly enabled_sub_capabilities?: {
							readonly items?: { readonly enum?: readonly string[] };
						};
				  }
				| undefined
		)?.enabled_sub_capabilities?.items?.enum,
		['removable_block_storage', 'portable_mtp']
	);
	assert.equal(
		JSON.stringify(schema.$defs.NetworkConfigurationPolicy?.allOf).includes(
			'"enabled_sub_capabilities":{"minItems":1}'
		),
		true
	);
	for (const policy of [
		'ProcessApplicationPolicy',
		'ClipboardPolicy',
		'PrintingPolicy',
		'RemovableStoragePolicy',
		'VirtualizationPolicy',
		'NetworkConfigurationPolicy',
		'MediaDevicePolicy'
	]) {
		assert.ok(
			Array.isArray((schema.$defs[policy] as { readonly allOf?: unknown }).allOf),
			`${policy} must close disabled-mode contradictions`
		);
	}
});

void test('signed capability matrix accepts only exact registry coverage and target identity', () => {
	const matrix = matrixFixture();
	const payload = JSON.stringify(matrix);
	let verifiedPayload: string | undefined;
	const verified = verifyNativeCapabilityMatrix(
		{ payload, signature: 'test-signature', key_id: 'release-key-v1' },
		matrixExpectation(matrix),
		(candidate) => {
			verifiedPayload = candidate;
			return true;
		}
	);

	assert.equal(verifiedPayload, payload);
	assert.deepEqual(verified, matrix);
	assert.equal(Object.isFrozen(verified), true);
	assert.equal(Object.isFrozen(verified.entries), true);
	assert.equal(Object.isFrozen(verified.entries[0]), true);
});

void test('generated capability authority is deeply immutable at runtime', () => {
	assert.equal(Object.isFrozen(NATIVE_CAPABILITY_REGISTRY), true);
	assert.equal(Object.isFrozen(NATIVE_CAPABILITY_REGISTRY[0]), true);
	assert.equal(Object.isFrozen(NATIVE_CAPABILITY_REGISTRY[0]?.subCapabilities), true);
});

void test('Windows matrix claims use static Windows requirements without live grant state', () => {
	const base = matrixFixture();
	const entries = base.entries.map((entry) => {
		const family = NATIVE_CAPABILITY_REGISTRY.find((candidate) =>
			candidate.subCapabilities.some((sub) => sub.coverageKey === entry.coverage_key)
		);
		return {
			...entry,
			required_permissions: family?.permissions.windows ?? []
		};
	});
	const processIndex = entries.findIndex(
		(entry) => entry.coverage_key === 'native.process_application_lifecycle.v1'
	);
	entries[processIndex] = {
		...entries[processIndex]!,
		claim: 'observe',
		verification: 'passed'
	};
	const matrix: NativeCapabilityMatrix = {
		...base,
		target_tuple: 'windows-x64-test',
		entries
	};
	const verified = verifyNativeCapabilityMatrix(
		{
			payload: JSON.stringify(matrix),
			signature: 'test-signature',
			key_id: 'release-key-v1'
		},
		matrixExpectation(matrix),
		() => true
	);
	assert.deepEqual(verified.entries[processIndex]?.required_permissions, []);
});

void test('matrix verification rejects invalid signatures, unavailable claims, and stale targets', () => {
	const matrix = matrixFixture();
	const envelope = {
		payload: JSON.stringify(matrix),
		signature: 'test-signature',
		key_id: 'release-key-v1'
	};
	assert.throws(
		() => verifyNativeCapabilityMatrix(envelope, matrixExpectation(matrix), () => false),
		(error) => hasMatrixError(error, 'matrix_signature_invalid')
	);

	const externalCaptureIndex = matrix.entries.findIndex(
		(entry) => entry.coverage_key === 'native.external_capture_detection.v1'
	);
	assert.notEqual(externalCaptureIndex, -1);
	const invalidEntries = [...matrix.entries];
	invalidEntries[externalCaptureIndex] = {
		...invalidEntries[externalCaptureIndex]!,
		claim: 'enforce',
		verification: 'passed'
	};
	assert.throws(
		() =>
			verifyNativeCapabilityMatrix(
				{ ...envelope, payload: JSON.stringify({ ...matrix, entries: invalidEntries }) },
				matrixExpectation(matrix),
				() => true
			),
		(error) => hasMatrixError(error, 'matrix_payload_invalid')
	);

	const invalidPermissionEntries = [...matrix.entries];
	invalidPermissionEntries[0] = {
		...invalidPermissionEntries[0]!,
		required_permissions: []
	};
	assert.throws(
		() =>
			verifyNativeCapabilityMatrix(
				{
					...envelope,
					payload: JSON.stringify({ ...matrix, entries: invalidPermissionEntries })
				},
				matrixExpectation(matrix),
				() => true
			),
		(error) => hasMatrixError(error, 'matrix_payload_invalid')
	);

	assert.throws(
		() =>
			verifyNativeCapabilityMatrix(
				envelope,
				{ ...matrixExpectation(matrix), targetTuple: 'windows-x64-test' },
				() => true
			),
		(error) => hasMatrixError(error, 'matrix_identity_mismatch')
	);

	const mismatchedRuntime = matrixExpectation(matrix);
	assert.throws(
		() =>
			verifyNativeCapabilityMatrix(
				envelope,
				{
					...mismatchedRuntime,
					runtimeIdentities: mismatchedRuntime.runtimeIdentities.map((identity, index) =>
						index === 0
							? { ...identity, adapter_version: 'different-adapter-v1' }
							: identity
					)
				},
				() => true
			),
		(error) => hasMatrixError(error, 'matrix_identity_mismatch')
	);
});

function matrixFixture(): NativeCapabilityMatrix {
	return {
		schema_version: 2,
		registry_version: 1,
		matrix_id: 'development-matrix-v1',
		release_id: 'desktop-test-v1',
		target_tuple: 'macos-arm64-test',
		entries: NATIVE_CAPABILITY_REGISTRY.flatMap((family) =>
			family.subCapabilities.map((subCapability) => ({
				coverage_key: subCapability.coverageKey,
				schema_version: subCapability.schemaVersion,
				claim: subCapability.permittedClaims.includes('unavailable')
					? ('unavailable' as const)
					: (subCapability.permittedClaims[0] ?? 'unavailable'),
				component_id: `component-${family.id}`,
				adapter_version: 'adapter-v1',
				helper_build_id: null,
				required_permissions: family.permissions.macos,
				limitations: [],
				verification: 'unavailable' as const
			}))
		)
	};
}

function matrixExpectation(matrix: NativeCapabilityMatrix) {
	return {
		releaseId: matrix.release_id,
		targetTuple: matrix.target_tuple,
		runtimeIdentities: matrix.entries.map((entry) => ({
			coverage_key: entry.coverage_key,
			component_id: entry.component_id,
			adapter_version: entry.adapter_version,
			helper_build_id: entry.helper_build_id
		}))
	} as const;
}

function hasMatrixError(error: unknown, code: NativeCapabilityMatrixError['code']): boolean {
	return error instanceof NativeCapabilityMatrixError && error.code === code;
}
