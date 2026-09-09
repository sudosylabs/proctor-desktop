import { createRequire } from 'node:module';
import { createPublicKey, createHash } from 'node:crypto';
import type {
	DesktopKeyCustody,
	DesktopSigningKey,
	DesktopPublicJwk
} from '../node/desktopSigningKey.js';
import { DesktopAuthorizationError } from '../node/desktopAuthorizationError.js';

interface NativeKeys {
	publicKey(scope: string): Uint8Array;
	signDigest(scope: string, digest: Buffer): Uint8Array;
	deleteKey(scope: string): void;
}
/** Module location comes only from the trusted process composition, never IPC. */
export function loadNativeDesktopKeyCustody(modulePath: string): DesktopKeyCustody {
	const value: unknown = createRequire(import.meta.url)(modulePath);
	if (
		!value ||
		typeof value !== 'object' ||
		!('publicKey' in value) ||
		typeof value.publicKey !== 'function' ||
		!('signDigest' in value) ||
		typeof value.signDigest !== 'function' ||
		!('deleteKey' in value) ||
		typeof value.deleteKey !== 'function'
	)
		throw new DesktopAuthorizationError('storageUnavailable');
	const native = value as NativeKeys;
	return {
		async loadOrCreate(scope): Promise<DesktopSigningKey> {
			try {
				const point = Buffer.from(native.publicKey(scope));
				if (point.length !== 65 || point[0] !== 4) throw new Error();
				const publicJwk: DesktopPublicJwk = Object.freeze({
					kty: 'EC',
					crv: 'P-256',
					x: point.subarray(1, 33).toString('base64url'),
					y: point.subarray(33).toString('base64url')
				});
				createPublicKey({ key: { ...publicJwk }, format: 'jwk' });
				return Object.freeze({
					publicJwk,
					async sign(message: Uint8Array) {
						try {
							return native.signDigest(
								scope,
								createHash('sha256').update(message).digest()
							);
						} catch {
							throw new DesktopAuthorizationError('storageUnavailable');
						}
					}
				});
			} catch {
				throw new DesktopAuthorizationError('storageUnavailable');
			}
		},
		async delete(scope) {
			try {
				native.deleteKey(scope);
			} catch {
				throw new DesktopAuthorizationError('storageUnavailable');
			}
		}
	};
}
