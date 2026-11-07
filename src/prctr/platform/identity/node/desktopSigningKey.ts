import { createHash, randomBytes, createPublicKey, verify } from 'node:crypto';
import { DesktopAuthorizationError } from './desktopAuthorizationError.js';

export interface DesktopPublicJwk {
	readonly kty: 'EC';
	readonly crv: 'P-256';
	readonly x: string;
	readonly y: string;
}
/** A native key reference. This interface has deliberately no private-key export. */
export interface DesktopSigningKey {
	readonly publicJwk: DesktopPublicJwk;
	sign(message: Uint8Array): Promise<Uint8Array>;
}
export interface DesktopKeyCustody {
	loadOrCreate(scope: string): Promise<DesktopSigningKey>;
	delete(scope: string): Promise<void>;
}
/**
 * The custody scope of one installation key. It includes the application identity, so a
 * development build and an installed release on one computer never share a key.
 */
export function installationKeyScope(
	applicationId: string,
	origin: string,
	institutionId: string
): string {
	return createHash('sha256')
		.update(JSON.stringify([applicationId, origin, institutionId]))
		.digest('hex');
}
export async function createDPoPProof(
	key: DesktopSigningKey,
	method: string,
	target: string,
	nonce: string,
	accessToken?: string
): Promise<string> {
	const url = new URL(target);
	if (
		!/^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS|TRACE)$/u.test(method) ||
		url.username ||
		url.password ||
		url.hash ||
		!/^[A-Za-z0-9_-]{43}$/.test(nonce)
	)
		throw new DesktopAuthorizationError('rejected');
	url.search = '';
	const publicJwk = key.publicJwk;
	if (
		publicJwk.kty !== 'EC' ||
		publicJwk.crv !== 'P-256' ||
		!/^[A-Za-z0-9_-]{43}$/.test(publicJwk.x) ||
		!/^[A-Za-z0-9_-]{43}$/.test(publicJwk.y) ||
		Object.keys(publicJwk).length !== 4
	)
		throw new DesktopAuthorizationError('storageUnavailable');
	const header = Buffer.from(
		JSON.stringify({ typ: 'dpop+jwt', alg: 'ES256', jwk: publicJwk })
	).toString('base64url');
	const claims = Buffer.from(
		JSON.stringify({
			htm: method,
			htu: url.href,
			iat: Math.floor(Date.now() / 1000),
			jti: randomBytes(32).toString('base64url'),
			nonce,
			...(accessToken === undefined
				? {}
				: { ath: createHash('sha256').update(accessToken).digest('base64url') })
		})
	).toString('base64url');
	const input = `${header}.${claims}`;
	const signature = Buffer.from(await key.sign(Buffer.from(input)));
	if (
		signature.length !== 64 ||
		!verify(
			'sha256',
			Buffer.from(input),
			{
				key: createPublicKey({ key: { ...publicJwk }, format: 'jwk' }),
				dsaEncoding: 'ieee-p1363'
			},
			signature
		)
	)
		throw new DesktopAuthorizationError('storageUnavailable');
	return `${input}.${signature.toString('base64url')}`;
}
