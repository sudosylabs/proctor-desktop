import {
	createDesktopAuthCallbackPages,
	callbackPageMessages
} from '../../../../src/prctr/workbench/node/desktopAuthCallbackPage.js';
import { createLocalization } from '../../../../src/prctr/base/common/localization.js';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
	generateKeyPairSync,
	randomBytes,
	sign,
	createHash,
	createPublicKey,
	verify
} from 'node:crypto';
import { request as httpRequest } from 'node:http';
import {
	CancellationTokenSource,
	CancellationToken
} from '../../../../src/prctr/base/common/cancellation.js';
import { LoopbackAuthServer } from '../../../../src/prctr/platform/identity/node/loopbackAuthServer.js';
import { DesktopAuthHttp } from '../../../../src/prctr/platform/identity/node/desktopAuthHttp.js';
import { DesktopAuthorizationService } from '../../../../src/prctr/platform/identity/electron-main/desktopAuthorizationService.js';
import {
	createDPoPProof,
	type DesktopSigningKey
} from '../../../../src/prctr/platform/identity/node/desktopSigningKey.js';
import { DesktopAuthorizationError } from '../../../../src/prctr/platform/identity/node/desktopAuthorizationError.js';
import type { StoredDesktopSession } from '../../../../src/prctr/platform/identity/node/desktopCredentialStore.js';

const callbackPages = createDesktopAuthCallbackPages(
	createLocalization({ requestedLocale: 'en', messages: Object.values(callbackPageMessages) }),
	resolve('resources/branding/source/lockup')
);

const random = (): string => randomBytes(32).toString('base64url');
function softwareTestKey(): DesktopSigningKey {
	const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
	const jwk = publicKey.export({ format: 'jwk' });
	return {
		publicJwk: { kty: 'EC', crv: 'P-256', x: jwk.x!, y: jwk.y! },
		async sign(message) {
			return sign('sha256', message, { key: privateKey, dsaEncoding: 'ieee-p1363' });
		}
	};
}
void test('callback uses an exact random loopback route, rejects duplicates, and accepts one state-bound code', async () => {
	const state = random();
	const listener = await LoopbackAuthServer.start(state, callbackPages, CancellationToken.None);
	try {
		const url = new URL(listener.callbackURL);
		assert.equal(url.hostname, '127.0.0.1');
		assert.match(url.pathname, /^\/[A-Za-z0-9_-]{43}$/);
		assert.equal((await fetch(`${url.origin}/other`)).status, 404);
		const code = random();
		url.searchParams.set('state', state);
		url.searchParams.set('code', code);
		const response = await fetch(url);
		assert.equal(response.status, 200);
		assert.equal(await response.text(), callbackPages.received);
		assert.match(response.headers.get('content-type')!, /text\/html/);
		assert.ok(
			response.headers
				.get('content-security-policy')!
				.includes(`'sha256-${callbackPages.styleHash}'`)
		);
		assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
		assert.ok(!callbackPages.received.includes(code));
		assert.ok(!callbackPages.received.includes(state));
		assert.equal(await listener.waitForCode(), code);
		const reused = await fetch(url);
		assert.equal(reused.status, 410);
		assert.equal(await reused.text(), callbackPages.expired);
	} finally {
		await listener.stop();
		await listener.stop();
	}
});
void test('callback rejects wrong Host without consuming the transaction and rejects duplicate state terminally', async () => {
	const state = random();
	const listener = await LoopbackAuthServer.start(state, callbackPages, CancellationToken.None);
	try {
		assert.equal(
			await new Promise<number>((resolve, reject) => {
				const req = httpRequest(
					listener.callbackURL,
					{ headers: { Host: 'attacker.example' } },
					(res) => {
						res.resume();
						resolve(res.statusCode!);
					}
				);
				req.on('error', reject);
				req.end();
			}),
			400
		);
		const url = new URL(listener.callbackURL);
		url.searchParams.append('state', state);
		url.searchParams.append('state', state);
		url.searchParams.set('code', random());
		const invalid = await fetch(url);
		assert.equal(invalid.status, 400);
		assert.equal(await invalid.text(), callbackPages.invalid);
		await assert.rejects(listener.waitForCode(), /callbackInvalid/);
	} finally {
		await listener.stop();
	}
});
void test('cancellation closes the listener and settles its result', async () => {
	const token = new CancellationTokenSource();
	const listener = await LoopbackAuthServer.start(random(), callbackPages, token.token);
	token.cancel();
	await assert.rejects(listener.waitForCode(), /cancelled/);
	await listener.stop();
	token.dispose();
	await assert.rejects(fetch(listener.callbackURL));
});
void test('callback deadline closes unanswered transactions', async () => {
	const listener = await LoopbackAuthServer.start(
		random(),
		callbackPages,
		CancellationToken.None,
		25
	);
	await assert.rejects(listener.waitForCode(), /timedOut/);
	await listener.stop();
});
void test('DPoP proofs bind method, canonical URI, nonce and access token with a fresh signature and ID', async () => {
	const key = softwareTestKey();
	const nonce = random();
	const secret = random();
	const proof = await createDPoPProof(
		key,
		'GET',
		'https://example.edu/api/v1/users/me/context?ignored=true',
		nonce,
		secret
	);
	const [header, payload, signature] = proof.split('.');
	const claims = JSON.parse(Buffer.from(payload!, 'base64url').toString());
	assert.equal(claims.htm, 'GET');
	assert.equal(claims.htu, 'https://example.edu/api/v1/users/me/context');
	assert.equal(claims.nonce, nonce);
	assert.equal(claims.ath, createHash('sha256').update(secret).digest('base64url'));
	assert.ok(
		verify(
			'sha256',
			Buffer.from(`${header}.${payload}`),
			{
				key: createPublicKey({ format: 'jwk', key: { ...key.publicJwk } }),
				dsaEncoding: 'ieee-p1363'
			},
			Buffer.from(signature!, 'base64url')
		)
	);
	assert.notEqual(
		proof,
		await createDPoPProof(
			key,
			'GET',
			'https://example.edu/api/v1/users/me/context',
			nonce,
			secret
		)
	);
	const refresh = await createDPoPProof(
		key,
		'POST',
		'https://example.edu/api/v1/auth/refresh',
		nonce
	);
	assert.equal(
		JSON.parse(Buffer.from(refresh.split('.')[1]!, 'base64url').toString()).ath,
		undefined
	);
});

const id = 'a'.repeat(26);
const sessionId = 'b'.repeat(26);
const registration = 'c'.repeat(26);
const target = {
	release: '1.0.0',
	buildId: 'test',
	platform: 'darwin',
	architecture: 'arm64',
	realtimeProtocol: 1,
	authorizationProtocol: 1
};
const identity = {
	origin: 'https://example.edu',
	institutionId: id,
	installationId: 'installation',
	institutionName: 'Example University',
	developmentOrigin: false
};
function tokens() {
	return {
		session: {
			id: sessionId,
			user_id: id,
			desktop_registration_id: registration,
			client_type: 'desktop',
			mfa_recovery_required: false
		},
		tokens: {
			token_type: 'DPoP',
			access_token: random(),
			refresh_token: random(),
			access_expires_at: new Date(Date.now() + 300000).toISOString(),
			refresh_expires_at: new Date(Date.now() + 3600000).toISOString()
		}
	};
}
function response(value: unknown, status = 200, nonce = random(), type = 'application/json') {
	return new Response(JSON.stringify(value), {
		status,
		headers: { 'Content-Type': type, 'DPoP-Nonce': nonce }
	});
}
function context() {
	return {
		user: {
			id,
			username: 'candidate',
			display_name: 'Candidate',
			profile_picture_reference: ''
		},
		current_desktop_registration_id: registration,
		available_product_areas: ['account', 'settings'],
		no_current_affiliation: true,
		no_assigned_access: true,
		management_scopes: [],
		management_scopes_has_more: false,
		session_management_available: true,
		unresolved_attempt: null
	};
}
void test('hosted authorization uses exact wire fields, persists only refresh custody and hands off sanitized identity', async () => {
	const key = softwareTestKey();
	let started: Record<string, unknown>;
	let stored: StoredDesktopSession | undefined;
	let authenticated: unknown;
	let startCount = 0;
	let exchangeCount = 0;
	let refreshCount = 0;
	const http = new DesktopAuthHttp(async (input, init) => {
		const path = new URL(String(input)).pathname;
		assert.equal(init?.credentials, 'omit');
		assert.equal(init?.redirect, 'manual');
		if (path.endsWith('/authorizations')) {
			startCount++;
			started = JSON.parse(String(init?.body));
			return response(
				{
					authorization_url: 'https://example.edu/desktop/authorize?handle=safe',
					expires_at: new Date(Date.now() + 60000).toISOString()
				},
				201
			);
		}
		if (path.endsWith('/token')) {
			exchangeCount++;
			const body = JSON.parse(String(init?.body));
			assert.equal(body.state, started.state);
			assert.equal(
				createHash('sha256').update(body.code_verifier).digest('base64url'),
				started.code_challenge
			);
			assert.deepEqual(body.public_jwk, key.publicJwk);
			return response(tokens());
		}
		if (path.endsWith('/context')) return response(context());
		if (path.endsWith('/refresh')) {
			refreshCount++;
			assert.equal(stored?.phase, 'rotationPending');
			return response(tokens());
		}
		if (path.endsWith('/logout')) return new Response(null, { status: 204 });
		throw Error('Unexpected route');
	});
	const service = new DesktopAuthorizationService({
		target,
		keys: {
			async loadOrCreate() {
				return key;
			},
			async delete() {}
		},
		credentials: {
			async read() {
				return stored;
			},
			async write(_scope, value) {
				stored = value;
			},
			async delete() {
				stored = undefined;
			}
		},
		http,
		callbackPages,
		async openBrowser() {
			const url = new URL(String(started.callback_url));
			url.searchParams.set('state', String(started.state));
			url.searchParams.set('code', random());
			assert.equal((await fetch(url)).status, 200);
		},
		async onAuthenticated(value) {
			authenticated = value;
		}
	});
	try {
		await service.start(identity, CancellationToken.None);
		assert.equal(startCount, 1);
		assert.equal(exchangeCount, 1);
		assert.equal(stored?.phase, 'usable');
		assert.equal((authenticated as { principalId: string }).principalId, id);
		assert.ok(!JSON.stringify(authenticated).includes(stored!.refreshToken));
		assert.ok(!('accessToken' in stored!));
		await Promise.all([service.refresh(), service.refresh()]);
		assert.equal(refreshCount, 1);
		await service.signOut();
		assert.equal(stored, undefined);
	} finally {
		service.dispose();
	}
});
void test('nonce challenge is retried once with a fresh proof, while ambiguous refresh remains fenced', async () => {
	for (const failure of ['network', 'storage'] as const) {
		const key = softwareTestKey();
		let start: Record<string, unknown>;
		let stored: StoredDesktopSession | undefined;
		const proofs: string[] = [];
		let exchanged = 0;
		let revoked = false;
		let rotating = false;
		const http = new DesktopAuthHttp(async (input, init) => {
			const path = new URL(String(input)).pathname;
			if (path.endsWith('/authorizations')) {
				start = JSON.parse(String(init?.body));
				return response(
					{
						authorization_url: 'https://example.edu/authorize',
						expires_at: new Date(Date.now() + 60000).toISOString()
					},
					201
				);
			}
			if (path.endsWith('/token')) {
				proofs.push(new Headers(init?.headers).get('DPoP')!);
				if (++exchanged === 1)
					return response(
						{ code: 'authentication.dpop.use_nonce' },
						401,
						random(),
						'application/problem+json'
					);
				return response(tokens());
			}
			if (path.endsWith('/context')) return response(context());
			if (path.endsWith('/refresh')) {
				if (failure === 'network') throw Error('Response lost after server rotation');
				return response(tokens());
			}
			if (path.endsWith('/logout')) {
				revoked = true;
				return new Response(null, { status: 204 });
			}
			throw Error('Unexpected route');
		});
		const service = new DesktopAuthorizationService({
			target,
			keys: {
				async loadOrCreate() {
					return key;
				},
				async delete() {}
			},
			credentials: {
				async read() {
					return stored;
				},
				async write(_scope, value) {
					if (rotating && failure === 'storage' && value.phase === 'usable')
						throw new DesktopAuthorizationError('storageUnavailable');
					stored = value;
				},
				async delete() {
					stored = undefined;
				}
			},
			http,
			callbackPages,
			async openBrowser() {
				const url = new URL(String(start.callback_url));
				url.searchParams.set('state', String(start.state));
				url.searchParams.set('code', random());
				await fetch(url);
			},
			async onAuthenticated() {}
		});
		const outcomes: import('../../../../src/prctr/platform/identity/common/desktopSessionOutcome.js').DesktopSessionOutcome[] =
			[];
		const subscription = service.onDidEndSession((value) => outcomes.push(value));
		try {
			await service.start(identity, CancellationToken.None);
			assert.equal(exchanged, 2);
			assert.notEqual(proofs[0], proofs[1]);
			rotating = true;
			await assert.rejects(
				service.refresh(),
				failure === 'network' ? /verificationRequired/ : /storageUnavailable/
			);
			assert.equal(stored?.phase, 'rotationPending');
			assert.equal(outcomes.length, 1);
			assert.equal(
				outcomes[0]?.credentialReadiness,
				failure === 'storage' ? 'unavailable' : 'locked'
			);
			assert.equal(revoked, false);
		} finally {
			subscription.dispose();
			service.dispose();
		}
	}
});

void test('ordinary shutdown drains pending rotation and sign-out without restoring credentials', async () => {
	const key = softwareTestKey();
	let started: Record<string, unknown>;
	let stored: StoredDesktopSession | undefined;
	let rotating = false;
	let releaseWrite!: () => void;
	let reachedWrite!: () => void;
	const waiting = new Promise<void>((resolve) => {
		reachedWrite = resolve;
	});
	const barrier = new Promise<void>((resolve) => {
		releaseWrite = resolve;
	});
	const http = new DesktopAuthHttp(async (input, init) => {
		const path = new URL(String(input)).pathname;
		if (path.endsWith('/authorizations')) {
			started = JSON.parse(String(init?.body));
			return response(
				{
					authorization_url: 'https://example.edu/authorize',
					expires_at: new Date(Date.now() + 60000).toISOString()
				},
				201
			);
		}
		if (path.endsWith('/context')) return response(context());
		if (path.endsWith('/logout')) throw Error('Server unavailable');
		return response(tokens());
	});
	const service = new DesktopAuthorizationService({
		target,
		keys: {
			async loadOrCreate() {
				return key;
			},
			async delete() {}
		},
		credentials: {
			async read() {
				return stored;
			},
			async write(_scope, value) {
				if (rotating && value.phase === 'usable') {
					reachedWrite();
					await barrier;
				}
				stored = value;
			},
			async delete() {
				stored = undefined;
			}
		},
		http,
		callbackPages,
		async openBrowser() {
			const url = new URL(String(started.callback_url));
			url.searchParams.set('state', String(started.state));
			url.searchParams.set('code', random());
			await fetch(url);
		},
		async onAuthenticated() {}
	});
	const outcomes: import('../../../../src/prctr/platform/identity/common/desktopSessionOutcome.js').DesktopSessionOutcome[] =
		[];
	const subscription = service.onDidEndSession((value) => outcomes.push(value));
	try {
		await service.start(identity, CancellationToken.None);
		rotating = true;
		const refresh = service.refresh();
		const rejected = assert.rejects(refresh, /cancelled/);
		await waiting;
		const signedOut = service.signOut();
		let drained = false;
		const shutdown = service.shutdown();
		assert.equal(service.shutdown(), shutdown);
		void shutdown.then(() => {
			drained = true;
		});
		await assert.rejects(service.start(identity, CancellationToken.None), /rejected/);
		await new Promise<void>((resolve) => setImmediate(resolve));
		assert.equal(drained, false);
		assert.equal(outcomes.at(-1)?.authentication, 'ending');
		releaseWrite();
		await Promise.all([rejected, signedOut, shutdown]);
		assert.equal(drained, true);
		assert.equal(outcomes.at(-1)?.localCleanup, 'cleared');
		assert.equal(outcomes.at(-1)?.remoteRevocation, 'unconfirmed');
		assert.equal(stored, undefined);
	} finally {
		releaseWrite();
		subscription.dispose();
		service.dispose();
	}
});

void test('server expiry shortens the callback deadline', async () => {
	const listener = await LoopbackAuthServer.start(
		random(),
		callbackPages,
		CancellationToken.None
	);
	listener.expireAt(Date.now() + 20);
	await assert.rejects(listener.waitForCode(), /timedOut/);
	await listener.stop();
});

void test('identity HTTP rejects redirects, oversized JSON, and malformed nonce headers without exposing bodies', async () => {
	for (const result of [
		new Response(null, { status: 302, headers: { Location: 'https://other.example' } }),
		response({ privateServerDetail: 'x'.repeat(65536) }),
		new Response('{}', {
			headers: { 'Content-Type': 'application/json', 'DPoP-Nonce': 'invalid' }
		})
	]) {
		const http = new DesktopAuthHttp(async () => result);
		await assert.rejects(
			http.request(identity.origin, '/api/v1/users/me/context', CancellationToken.None),
			(error) => error instanceof Error && error.message === 'Desktop authorization rejected'
		);
	}
});

void test('native custody failure stops sign-in before authorization or browser launch', async () => {
	let crossedBoundary = false;
	const service = new DesktopAuthorizationService({
		target,
		keys: {
			async loadOrCreate() {
				throw new Error('Native key unavailable');
			},
			async delete() {}
		},
		credentials: {
			async read() {
				crossedBoundary = true;
				throw Error('Unexpected storage access');
			},
			async write() {},
			async delete() {}
		},
		http: new DesktopAuthHttp(async () => {
			crossedBoundary = true;
			throw Error('Unexpected request');
		}),
		callbackPages,
		async openBrowser() {
			assert.fail('Unexpected browser');
		},
		async onAuthenticated() {
			assert.fail('Unexpected handoff');
		}
	});
	try {
		await assert.rejects(
			service.start(identity, CancellationToken.None),
			/Desktop authorization unavailable/
		);
		assert.equal(crossedBoundary, false);
	} finally {
		service.dispose();
	}
});

void test('sign-out preserves separate local cleanup and remote revocation outcomes, including stale-access 401', async () => {
	for (const scenario of [
		'success',
		'staleAccess',
		'networkLost',
		'localDelete',
		'both',
		'barrierOnly'
	] as const) {
		const key = softwareTestKey();
		let started: Record<string, unknown>;
		let stored: StoredDesktopSession | undefined;
		let cleanup = false;
		const outcomes: import('../../../../src/prctr/platform/identity/common/desktopSessionOutcome.js').DesktopSessionOutcome[] =
			[];
		const http = new DesktopAuthHttp(async (input, init) => {
			const path = new URL(String(input)).pathname;
			if (path.endsWith('/authorizations')) {
				started = JSON.parse(String(init?.body));
				return response(
					{
						authorization_url: 'https://example.edu/authorize',
						expires_at: new Date(Date.now() + 60000).toISOString()
					},
					201
				);
			}
			if (path.endsWith('/context')) return response(context());
			if (path.endsWith('/logout')) {
				if (scenario === 'networkLost') throw Error('Lost response');
				// The server invalidates the old access token during refresh. This does not revoke the Session.
				if (scenario === 'staleAccess' || scenario === 'both')
					return response(
						{ code: 'authentication.credentials.invalid' },
						401,
						random(),
						'application/problem+json'
					);
				return new Response(null, { status: 204 });
			}
			return response(tokens());
		});
		const service = new DesktopAuthorizationService({
			target,
			keys: {
				async loadOrCreate() {
					return key;
				},
				async delete() {}
			},
			credentials: {
				async read() {
					return stored;
				},
				async write(_scope, value) {
					if (cleanup && scenario === 'barrierOnly') throw Error('Barrier failure');
					stored = value;
				},
				async delete() {
					if (scenario === 'localDelete' || scenario === 'both')
						throw Error('Delete failure');
					stored = undefined;
				}
			},
			http,
			callbackPages,
			async openBrowser() {
				const url = new URL(String(started.callback_url));
				url.searchParams.set('state', String(started.state));
				url.searchParams.set('code', random());
				await fetch(url);
			},
			async onAuthenticated() {}
		});
		const subscription = service.onDidEndSession((value) => outcomes.push(value));
		try {
			await service.start(identity, CancellationToken.None);
			cleanup = true;
			const ending = service.signOut();
			assert.equal(outcomes[0]?.authentication, 'ending');
			await assert.rejects(service.refresh(), /rejected/);
			await ending;
			assert.equal(outcomes.length, 2);
			const final = outcomes[1]!;
			assert.equal(final.authentication, 'signedOut');
			assert.equal(final.origin, identity.origin);
			assert.equal(
				final.localCleanup,
				scenario === 'localDelete' || scenario === 'both' ? 'failed' : 'cleared'
			);
			const revoked =
				scenario === 'success' || scenario === 'localDelete' || scenario === 'barrierOnly';
			assert.equal(final.remoteRevocation, revoked ? 'confirmed' : 'unconfirmed');
			assert.equal(final.sessionValidity, revoked ? 'revoked' : 'verificationRequired');
			assert.ok(!JSON.stringify(outcomes).includes(key.publicJwk.x));
		} finally {
			subscription.dispose();
			service.dispose();
		}
	}
});

void test('callback presentation embeds approved branding, escapes translations and supports every theme', () => {
	for (const theme of ['dark', 'light', 'highContrastDark', 'highContrastLight'] as const) {
		const localization = createLocalization({
			requestedLocale: 'en',
			messages: Object.values(callbackPageMessages),
			catalogs: [
				{
					locale: 'en',
					direction: 'rtl',
					messages: {
						'identity.callback.received.title':
							'<script>alert("secret")</script> & Continue'
					}
				}
			]
		});
		const pages = createDesktopAuthCallbackPages(
			localization,
			resolve('resources/branding/source/lockup'),
			theme
		);
		for (const html of [pages.received, pages.invalid, pages.expired]) {
			assert.match(html, /<main /);
			assert.match(html, /<h1 /);
			assert.match(html, /<img src="data:image\/svg\+xml;base64,/);
			assert.match(html, /width="768" height="576" alt="" aria-hidden="true"/);
			assert.ok(html.includes(`data-prctr-theme="${theme}"`));
			assert.ok(html.includes('dir="rtl"'));
			assert.doesNotMatch(html, /<script|<link|<iframe|<form|https?:/);
			const css = html.match(/<style>([\s\S]*?)<\/style>/)![1]!;
			assert.equal(createHash('sha256').update(css).digest('base64'), pages.styleHash);
			assert.ok(Buffer.byteLength(html) < 131072);
		}
		assert.ok(
			pages.received.includes(
				'&lt;script&gt;alert(&quot;secret&quot;)&lt;/script&gt; &amp; Continue'
			)
		);
	}
});

void test('account reads and actions are bound, DPoP signed, nonce retried once, and fenced after sign-out', async () => {
	const key = softwareTestKey();
	let started: Record<string, unknown> = {};
	let stored: StoredDesktopSession | undefined;
	const seen: { path: string; method: string; proof: Record<string, unknown> }[] = [];
	let nonceRejected = false;
	let revokeMode = 'strong';
	let revokeCount = 0;
	let opened = '';
	let profileMode = 'success';
	let profileReads = 0;
	let settingsMode = 'success';
	let settingsWrites = 0;
	const settingsSource = '{\n  "workbench.colorTheme": "GitHub Dark Dimmed"\n}';
	const http = new DesktopAuthHttp(async (input, init) => {
		const path = new URL(String(input)).pathname;
		if (path.endsWith('/authorizations')) {
			started = JSON.parse(String(init?.body));
			return response(
				{
					authorization_url: 'https://example.edu/desktop/authorize',
					expires_at: new Date(Date.now() + 60000).toISOString()
				},
				201
			);
		}
		if (path.endsWith('/token') || path.endsWith('/refresh')) {
			const value = tokens();
			value.session.desktop_registration_id = 'd'.repeat(26);
			return response(value);
		}
		if (path.endsWith('/context'))
			return response({ ...context(), current_desktop_registration_id: 'd'.repeat(26) });
		if (path.endsWith('/logout')) return new Response(null, { status: 204 });
		const proof = JSON.parse(
			Buffer.from(
				new Headers(init?.headers).get('DPoP')!.split('.')[1]!,
				'base64url'
			).toString()
		);
		seen.push({ path, method: String(init?.method), proof });
		assert.equal(proof.htm, init?.method);
		assert.equal(proof.htu, `https://example.edu${path}`);
		assert.equal(typeof proof.ath, 'string');
		if (path === `/api/v1/users/me/desktop-registrations/${'d'.repeat(26)}`)
			return new Response(null, { status: 204 });
		if (path === '/api/v1/users/me/settings') {
			if (init?.method === 'GET')
				return response({
					source: settingsSource,
					revision: 'r'.repeat(26),
					format_version: 1,
					updated_at: new Date(Date.now()).toISOString(),
					writable: true
				});
			settingsWrites++;
			assert.equal(
				new Headers(init?.headers).get('Idempotency-Key'),
				createHash('sha256').update('settings:proof-test').digest('hex')
			);
			assert.deepEqual(JSON.parse(String(init?.body)), {
				source: settingsSource,
				format_version: 1,
				expected_revision: 'r'.repeat(26)
			});
			if (settingsMode === 'conflict')
				return response(
					{
						type: 'about:blank',
						title: 'Conflict',
						status: 409,
						code: 'user_settings.revision_conflict'
					},
					409
				);
			if (settingsMode === 'ambiguous') throw new Error('lost settings acknowledgement');
			return response({
				revision: 't'.repeat(26),
				format_version: 1,
				updated_at: new Date(Date.now()).toISOString(),
				changed: true
			});
		}
		if (path === '/api/v1/users/me') {
			profileReads++;
			if (profileMode === 'malformed') return response({});
			if (profileMode === 'gateway') {
				profileMode = 'success';
				return new Response('<html>proxy</html>', {
					status: 503,
					headers: { 'Content-Type': 'text/html', 'Retry-After': '1' }
				});
			}
			if (!nonceRejected) {
				nonceRejected = true;
				return response({ code: 'authentication.dpop.use_nonce' }, 401);
			}
			return response({
				id,
				username: 'candidate',
				display_name: 'Candidate',
				first_name: '',
				last_name: '',
				created_at: '1970-01-01T00:00:00Z',
				updated_at: '1970-01-01T00:00:00Z',
				profile_picture_url: '',
				password_hash: 'never project'
			});
		}
		if (path === '/api/v1/users/me/sessions/revoke') {
			revokeCount++;
			if (revokeMode === 'network') throw new Error('Lost response');
			return response(
				{
					type: 'about:blank',
					title: 'Strong authentication required',
					status: 403,
					code: 'authentication.strong_required'
				},
				403
			);
		}
		throw new Error('Unexpected route');
	});
	const service = new DesktopAuthorizationService({
		target,
		keys: {
			async loadOrCreate() {
				return key;
			},
			async delete() {}
		},
		credentials: {
			async read() {
				return stored;
			},
			async write(_scope, value) {
				stored = value;
			},
			async delete() {
				stored = undefined;
			}
		},
		http,
		callbackPages,
		async openBrowser(url) {
			if (url.endsWith('/account/security')) {
				opened = url;
				return;
			}
			const callback = new URL(String(started.callback_url));
			callback.searchParams.set('state', String(started.state));
			callback.searchParams.set('code', random());
			await fetch(callback);
		},
		async onAuthenticated() {}
	});
	try {
		await service.start(identity, CancellationToken.None);
		const binding = { principalId: id, sessionId };
		assert.deepEqual(
			await service.account(
				{ ...binding, sessionId: 'foreign' },
				{ kind: 'read', section: 'profile' }
			),
			{ kind: 'error', reason: 'sessionEnded' }
		);
		assert.equal(seen.length, 0);
		const profile = await service.account(binding, { kind: 'read', section: 'profile' });
		assert.equal(profile.kind, 'data');
		assert.ok(!JSON.stringify(profile).includes('never project'));
		assert.equal(seen.length, 2);
		assert.notEqual(seen[0]!.proof.jti, seen[1]!.proof.jti);
		await service.apiForSession(binding).invalidate();
		profileMode = 'malformed';
		const beforeMalformed = profileReads;
		assert.deepEqual(await service.account(binding, { kind: 'read', section: 'profile' }), {
			kind: 'error',
			reason: 'unavailable'
		});
		assert.equal(
			profileReads,
			beforeMalformed + 1,
			'invalid DTOs must not be retried as network failures'
		);
		profileMode = 'gateway';
		const beforeGateway = profileReads;
		const retrying = service.account(binding, { kind: 'read', section: 'profile' });
		await new Promise((resolve) => setTimeout(resolve, 100));
		assert.equal(profileReads, beforeGateway + 1, 'Retry-After prevents immediate retries');
		assert.equal((await retrying).kind, 'data');
		assert.equal(
			profileReads,
			beforeGateway + 2,
			'gateway failures remain classified as transient'
		);

		assert.equal(await service.readSettings({ ...binding, sessionId: 'foreign' }), undefined);
		const settings = await service.readSettings(binding);
		assert.equal(settings?.acknowledged.source, settingsSource);
		const write = {
			source: settingsSource,
			expectedRevision: 'r'.repeat(26),
			idempotencyKey: 'settings:proof-test'
		};
		assert.deepEqual(await service.commitSettings(binding, write), {
			kind: 'success',
			revision: 't'.repeat(26)
		});
		settingsMode = 'conflict';
		assert.deepEqual(await service.commitSettings(binding, write), {
			kind: 'conflict',
			latest: settings!.acknowledged
		});
		settingsMode = 'ambiguous';
		assert.deepEqual(await service.commitSettings(binding, write), { kind: 'ambiguous' });
		assert.equal(settingsWrites, 3);
		await service.account(binding, { kind: 'openSecurity' });
		assert.equal(opened, 'https://example.edu/account/security');
		assert.deepEqual(
			await service.account(binding, { kind: 'revokeSession', id: 'y'.repeat(26) }),
			{ kind: 'error', reason: 'strongAuthenticationRequired' }
		);
		revokeMode = 'network';
		assert.deepEqual(
			await service.account(binding, { kind: 'revokeSession', id: 'y'.repeat(26) }),
			{ kind: 'error', reason: 'unconfirmed' }
		);
		assert.equal(revokeCount, 2);
		const outcomes: string[] = [];
		const subscription = service.onDidEndSession((outcome) =>
			outcomes.push(`${outcome.authentication}:${outcome.remoteRevocation}`)
		);
		assert.deepEqual(
			await service.account(binding, { kind: 'revokeDesktop', id: 'd'.repeat(26) }),
			{ kind: 'success' }
		);
		subscription.dispose();
		assert.deepEqual(outcomes, ['ending:pending', 'signedOut:confirmed']);
		assert.equal(stored, undefined);
		const count = seen.length;
		assert.equal(await service.readSettings(binding), undefined);
		assert.deepEqual(await service.commitSettings(binding, write), { kind: 'unavailable' });
		assert.deepEqual(await service.account(binding, { kind: 'read', section: 'profile' }), {
			kind: 'error',
			reason: 'sessionEnded'
		});
		assert.equal(seen.length, count);
	} finally {
		service.dispose();
	}
});
