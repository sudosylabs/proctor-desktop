import assert from 'node:assert/strict';
import { test } from 'node:test';
import { generateKeyPairSync, randomBytes, sign } from 'node:crypto';
import { ServerApiError } from '../../../../src/prctr/platform/serverApi/common/serverApi.js';
import { encodeRequest } from '../../../../src/prctr/platform/serverApi/node/requestEncoding.js';
import { ServerHttpTransport } from '../../../../src/prctr/platform/serverApi/node/serverHttpTransport.js';
import {
	SessionRequestSigner,
	type SessionCredentials
} from '../../../../src/prctr/platform/identity/electron-main/sessionRequestSigner.js';
import type { DesktopSigningKey } from '../../../../src/prctr/platform/identity/node/desktopSigningKey.js';

const origin = 'https://example.edu';
const random = (): string => randomBytes(32).toString('base64url');
function testKey(): DesktopSigningKey {
	const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
	const jwk = publicKey.export({ format: 'jwk' });
	return {
		publicJwk: { kty: 'EC', crv: 'P-256', x: jwk.x!, y: jwk.y! },
		async sign(message) {
			return sign('sha256', message, { key: privateKey, dsaEncoding: 'ieee-p1363' });
		}
	};
}
const problem = (status: number, code: string, nonce?: string) =>
	new Response(JSON.stringify({ type: 'about:blank', title: 'Refused', status, code }), {
		status,
		headers: {
			'Content-Type': 'application/problem+json',
			...(nonce ? { 'DPoP-Nonce': nonce } : {})
		}
	});

function harness(answer: (headers: Headers, count: number) => Response) {
	const sent: Headers[] = [];
	let credentials: SessionCredentials | undefined = {
		key: testKey(),
		accessToken: random(),
		accessExpiresAt: Date.now() + 300_000,
		nonce: random()
	};
	let refreshes = 0;
	let ended = 0;
	const signer = new SessionRequestSigner(
		new ServerHttpTransport(async (_input, init) => {
			const headers = new Headers(init?.headers);
			sent.push(headers);
			return answer(headers, sent.length);
		}),
		{
			credentials: () => credentials,
			recordNonce(nonce) {
				credentials = credentials && { ...credentials, nonce };
			},
			async refresh() {
				refreshes++;
				credentials = credentials && { ...credentials, accessToken: random() };
			},
			refreshing: false,
			endSession() {
				ended++;
				credentials = undefined;
			}
		}
	);
	return {
		signer,
		sent,
		get credentials() {
			return credentials;
		},
		get refreshes() {
			return refreshes;
		},
		get ended() {
			return ended;
		}
	};
}
const profile = () => encodeRequest(origin, 'getCurrentUserProfile', {});

void test('a nonce challenge is answered once with a fresh proof and the new nonce is kept', async () => {
	const fresh = random();
	const h = harness((_headers, count) =>
		count === 1
			? problem(401, 'authentication.dpop.use_nonce', fresh)
			: problem(401, 'authentication.dpop.use_nonce', random())
	);
	await assert.rejects(h.signer.execute(profile()), /sessionEnded/);
	assert.equal(h.sent.length, 2, 'a second challenge is never answered');
	assert.notEqual(h.sent[0]!.get('DPoP'), h.sent[1]!.get('DPoP'));
	assert.match(h.sent[0]!.get('Authorization')!, /^DPoP /u);
});

void test('an invalid access token refreshes once; a credential still refused ends the Session', async () => {
	const h = harness(() => problem(401, 'authentication.invalid_token'));
	await assert.rejects(
		h.signer.execute(profile()),
		(error) => error instanceof ServerApiError && error.kind === 'sessionEnded'
	);
	assert.equal(h.refreshes, 1);
	assert.equal(h.sent.length, 2);
	assert.notEqual(h.sent[0]!.get('Authorization'), h.sent[1]!.get('Authorization'));
	assert.equal(h.ended, 1);
	await assert.rejects(h.signer.execute(profile()), /sessionEnded/);
	assert.equal(h.sent.length, 2, 'nothing is sent once the Session ended');
});

void test('a refreshed request succeeds without ending the Session', async () => {
	const h = harness((_headers, count) =>
		count === 1
			? problem(401, 'authentication.invalid_token')
			: new Response('{}', { headers: { 'Content-Type': 'application/json' } })
	);
	const response = await h.signer.execute(profile());
	assert.equal(response.status, 200);
	assert.equal(h.refreshes, 1);
	assert.equal(h.ended, 0);
});

void test('a malformed server nonce is refused and never recorded', async () => {
	const h = harness(
		() =>
			new Response('{}', {
				headers: { 'Content-Type': 'application/json', 'DPoP-Nonce': 'short' }
			})
	);
	const before = h.credentials!.nonce;
	await assert.rejects(
		h.signer.execute(profile()),
		(error) => error instanceof ServerApiError && error.kind === 'invalidResponse'
	);
	assert.equal(h.credentials!.nonce, before);
});

void test('public operations go unsigned and refresh-credential operations are refused', async () => {
	const h = harness(
		() => new Response('{}', { headers: { 'Content-Type': 'application/json' } })
	);
	await h.signer.execute(encodeRequest(origin, 'getPublicAccessDiscovery', {}));
	assert.equal(h.sent[0]!.get('Authorization'), null);
	assert.equal(h.sent[0]!.get('DPoP'), null);
	await assert.rejects(
		h.signer.execute(encodeRequest(origin, 'refreshSession', {})),
		(error) => error instanceof ServerApiError && error.kind === 'invalidRequest'
	);
	assert.equal(h.sent.length, 1);
});

void test('the realtime upgrade is signed for GET with the current access token', async () => {
	const h = harness(() => new Response(null, { status: 500 }));
	const challenged = random();
	const headers = await h.signer.authorizeUpgrade(`${origin}/api/v1/websocket`, {
		nonce: challenged
	});
	assert.equal(headers.Authorization, `DPoP ${h.credentials!.accessToken}`);
	assert.equal(h.credentials!.nonce, challenged);
	const [, payload] = headers.DPoP!.split('.');
	const claims = JSON.parse(Buffer.from(payload!, 'base64url').toString());
	assert.equal(claims.htm, 'GET');
	assert.equal(claims.nonce, challenged);
	assert.ok(claims.ath);
});
