/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { parseStrictContractJson } from '../../serverApi/node/canonicalContract.js';
import { createHash, createPublicKey, verify, type KeyObject } from 'node:crypto';
import {
	NativeCapabilityMatrixError,
	verifyNativeCapabilityMatrix,
	type NativeCapabilityMatrix,
	type NativeCapabilityMatrixExpectation,
	type SignedNativeCapabilityMatrix
} from '../common/nativeCapabilityRegistry.js';

export interface NativeReleaseVerificationKey {
	readonly keyId: string;
	readonly publicKeyPem: string;
}

export interface PackagedNativeMatrixExpectation extends NativeCapabilityMatrixExpectation {
	/** Exact artifact identity supplied by the trusted packaged release manifest. */
	readonly matrixDigest: string;
}

/**
 * Privileged release-key adapter. Callers provide packaged trust roots, never a
 * key from the envelope, Institution settings, or a renderer. No network key
 * discovery or development signature bypass exists here.
 */
export class NativeCapabilityMatrixVerifier {
	readonly #keys = new Map<string, KeyObject>();

	public constructor(keys: readonly NativeReleaseVerificationKey[]) {
		if (keys.length < 1 || keys.length > 16) throw new TypeError('Invalid native release keys');
		for (const key of keys) {
			if (
				!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(key.keyId) ||
				this.#keys.has(key.keyId) ||
				key.publicKeyPem.length > 4096 ||
				!key.publicKeyPem.startsWith('-----BEGIN PUBLIC KEY-----')
			)
				throw new TypeError('Invalid native release key');
			let publicKey: KeyObject;
			try {
				publicKey = createPublicKey(key.publicKeyPem);
			} catch {
				throw new TypeError('Invalid native release key');
			}
			if (publicKey.asymmetricKeyType !== 'ed25519') {
				throw new TypeError('Native release keys must use Ed25519');
			}
			this.#keys.set(key.keyId, publicKey);
		}
	}

	public verify(
		envelope: SignedNativeCapabilityMatrix,
		expectation: PackagedNativeMatrixExpectation
	): NativeCapabilityMatrix {
		const matrix = verifyNativeCapabilityMatrix(
			envelope,
			expectation,
			(payload, signature, keyId) => {
				const key = this.#keys.get(keyId);
				// Ed25519 signatures are exactly 64 bytes in canonical unpadded base64url.
				if (key === undefined || !/^[A-Za-z0-9_-]{86}$/u.test(signature)) return false;
				const bytes = Buffer.from(signature, 'base64url');
				if (bytes.length !== 64 || bytes.toString('base64url') !== signature) return false;
				try {
					return verify(null, Buffer.from(payload, 'utf8'), key, bytes);
				} catch {
					return false;
				}
			}
		);
		try {
			if (!envelope.payload.isWellFormed()) throw new TypeError('Invalid UTF-8 source');
			parseStrictContractJson(new TextEncoder().encode(envelope.payload), {
				maxBytes: 65_536,
				integerNumbersOnly: true
			});
		} catch {
			throw new NativeCapabilityMatrixError('matrix_payload_invalid');
		}
		if (
			!/^sha256:[a-f0-9]{64}$/u.test(expectation.matrixDigest) ||
			`sha256:${createHash('sha256').update(envelope.payload, 'utf8').digest('hex')}` !==
				expectation.matrixDigest
		)
			throw new NativeCapabilityMatrixError('matrix_identity_mismatch');
		return matrix;
	}
}
