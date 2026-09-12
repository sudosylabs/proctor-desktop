import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { test } from 'node:test';
import {
	NATIVE_BASELINE_CAPABILITIES,
	NATIVE_CAPABILITY_REGISTRY,
	NATIVE_CAPABILITY_REGISTRY_DIGEST,
	NativeCapabilityMatrixError,
	type NativeCapabilityMatrix
} from '../../../../src/prctr/platform/native/common/nativeCapabilityRegistry.ts';
import { NativeCapabilityMatrixVerifier } from '../../../../src/prctr/platform/native/node/nativeCapabilityMatrixVerifier.ts';

function fixture() {
	const key = generateKeyPairSync('ed25519');
	const matrix: NativeCapabilityMatrix = {
		registry_digest: NATIVE_CAPABILITY_REGISTRY_DIGEST,
		matrix_id: 'synthetic-matrix',
		release_id: 'test-release',
		target_tuple: 'macos-arm64-test',
		entries: [
			...NATIVE_CAPABILITY_REGISTRY,
			...NATIVE_BASELINE_CAPABILITIES.map((baseline) => ({
				id: baseline.id,
				permissions: baseline.permissions,
				subCapabilities: [baseline]
			}))
		]
			.flatMap((family) =>
				family.subCapabilities.map((sub) => ({
					coverage_key: sub.coverageKey,
					source_schema_digest: sub.sourceSchemaDigest,
					claim: 'unavailable' as const,
					component_id: `component-${family.id}`,
					adapter_version: 'test-v1',
					required_permissions: family.permissions.macos,
					limitations: [],
					verification: 'unavailable' as const
				}))
			)
			.sort((a, b) => a.coverage_key.localeCompare(b.coverage_key))
	};
	const payload = JSON.stringify(matrix);
	const envelope = {
		payload,
		signature: sign(null, Buffer.from(payload), key.privateKey).toString('base64url'),
		key_id: 'release-key'
	};
	const expectation = {
		releaseId: matrix.release_id,
		targetTuple: matrix.target_tuple,
		runtimeIdentities: matrix.entries,
		matrixDigest: `sha256:${createHash('sha256').update(payload).digest('hex')}`
	};
	const verifier = new NativeCapabilityMatrixVerifier([
		{
			keyId: 'release-key',
			publicKeyPem: key.publicKey.export({ type: 'spki', format: 'pem' }).toString()
		}
	]);
	return { matrix, envelope, expectation, verifier, key };
}

void test('packaged native matrix verifies exact signed artifact using pinned Ed25519 key', () => {
	const f = fixture();
	assert.deepEqual(f.verifier.verify(f.envelope, f.expectation), f.matrix);
	assert.equal(Object.isFrozen(f.verifier.verify(f.envelope, f.expectation).entries), true);
});

void test('native matrix rejects tampering, unknown keys, signature ambiguity and artifact substitution', () => {
	const f = fixture();
	for (const envelope of [
		{ ...f.envelope, payload: f.envelope.payload.replace('test-release', 'evil-release') },
		{ ...f.envelope, key_id: 'untrusted-key' },
		{ ...f.envelope, signature: `${f.envelope.signature}==` },
		{ ...f.envelope, signature: 'a'.repeat(86) },
		{
			...f.envelope,
			signature: sign(
				null,
				Buffer.from(f.envelope.payload),
				generateKeyPairSync('ed25519').privateKey
			).toString('base64url')
		}
	])
		assert.throws(
			() => f.verifier.verify(envelope, f.expectation),
			NativeCapabilityMatrixError
		);
	assert.throws(
		() =>
			f.verifier.verify(f.envelope, {
				...f.expectation,
				matrixDigest: `sha256:${'0'.repeat(64)}`
			}),
		NativeCapabilityMatrixError
	);
});

void test('even trusted signatures cannot substitute schema registry or running adapter identities', () => {
	const f = fixture();
	const payload = JSON.stringify({
		...f.matrix,
		entries: f.matrix.entries.map((entry, index) =>
			index === 0 ? { ...entry, source_schema_digest: `sha256:${'0'.repeat(64)}` } : entry
		)
	});
	assert.throws(
		() =>
			f.verifier.verify(
				{
					...f.envelope,
					payload,
					signature: sign(null, Buffer.from(payload), f.key.privateKey).toString(
						'base64url'
					)
				},
				{
					...f.expectation,
					matrixDigest: `sha256:${createHash('sha256').update(payload).digest('hex')}`
				}
			),
		NativeCapabilityMatrixError
	);
	assert.throws(
		() =>
			f.verifier.verify(f.envelope, {
				...f.expectation,
				runtimeIdentities: f.matrix.entries.map((entry, index) =>
					index === 0 ? { ...entry, adapter_version: 'substitute' } : entry
				)
			}),
		NativeCapabilityMatrixError
	);
});

void test('native release verifier rejects empty duplicate malformed and non-Ed25519 trust roots', () => {
	assert.throws(() => new NativeCapabilityMatrixVerifier([]), TypeError);
	const publicKeyPem = generateKeyPairSync('ed25519')
		.publicKey.export({ type: 'spki', format: 'pem' })
		.toString();
	assert.throws(
		() =>
			new NativeCapabilityMatrixVerifier([
				{ keyId: 'key', publicKeyPem },
				{ keyId: 'key', publicKeyPem }
			]),
		TypeError
	);
	assert.throws(
		() => new NativeCapabilityMatrixVerifier([{ keyId: 'key', publicKeyPem: 'invalid' }]),
		TypeError
	);
	const other = generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
		.publicKey.export({ type: 'spki', format: 'pem' })
		.toString();
	assert.throws(
		() => new NativeCapabilityMatrixVerifier([{ keyId: 'key', publicKeyPem: other }]),
		TypeError
	);
});

void test('a trusted signature still rejects duplicate matrix members before returning claims', () => {
	const f = fixture();
	const payload = f.envelope.payload.replace(
		'"matrix_id":',
		'"matrix_id":"ignored-duplicate","matrix_id":'
	);
	assert.throws(
		() =>
			f.verifier.verify(
				{
					...f.envelope,
					payload,
					signature: sign(null, Buffer.from(payload), f.key.privateKey).toString(
						'base64url'
					)
				},
				{
					...f.expectation,
					matrixDigest: `sha256:${createHash('sha256').update(payload).digest('hex')}`
				}
			),
		NativeCapabilityMatrixError
	);
});
