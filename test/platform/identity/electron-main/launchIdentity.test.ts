import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { test } from 'node:test';
import type { IpcMain, IpcMainInvokeEvent, WebContents } from 'electron/main';
import {
	CancellationToken,
	CancellationTokenSource
} from '../../../../src/prctr/base/common/cancellation.js';
import { DesktopIdentityCoordinator } from '../../../../src/prctr/platform/identity/electron-main/desktopIdentityCoordinator.js';
import { HttpServerReadinessTransport } from '../../../../src/prctr/platform/identity/electron-main/httpServerReadinessTransport.js';
import { LaunchIdentityIpcBridge } from '../../../../src/prctr/platform/identity/electron-main/launchIdentityIpc.js';
import { LAUNCH_IDENTITY_CHANNELS } from '../../../../src/prctr/platform/windows/common/windowChannels.js';
import {
	validateLaunchIdentityIntent,
	validateLaunchIdentityProjection
} from '../../../../src/prctr/platform/identity/common/launchIdentity.js';
import {
	evaluateServerReadiness,
	normalizeServerOrigin,
	validateDesktopReleaseTarget,
	type ServerReadinessProbe
} from '../../../../src/prctr/platform/identity/electron-main/serverReadiness.js';

const target = Object.freeze({
	release: '1.2.3',
	buildId: 'build-123',
	platform: 'darwin',
	architecture: 'arm64',
	realtimeProtocol: 1,
	authorizationProtocol: 1
});
const origin = 'https://institution.example.test';
const serverTime = '2026-09-03T10:00:00Z';
function probe(
	system: Record<string, unknown> = {},
	discovery: Record<string, unknown> = {}
): ServerReadinessProbe {
	return {
		system: {
			ok: true,
			value: {
				schema_version: 1,
				server_time: serverTime,
				availability: 'ready',
				reason: 'ready',
				compatibility: 'compatible',
				compatibility_reason: 'compatible',
				...system
			}
		},
		discovery: {
			ok: true,
			value: {
				discovery_version: 1,
				canonical_origin: origin,
				installation_id: 'institution-1',
				initialized: true,
				institution: {
					id: 'institution-1',
					name: 'Internal',
					display_name: 'Example University'
				},
				capabilities: {
					desktop_authorization: true,
					local_login: true,
					public_registration: true
				},
				providers: [{ id: 'secret-provider', name: 'Do not project' }],
				policy_revision: 99,
				desktop_authorization: {
					protocol: 'proctor-desktop-authorization',
					minimum_version: 1,
					maximum_version: 1
				},
				...discovery
			}
		}
	};
}
function evaluate(value: ServerReadinessProbe) {
	return evaluateServerReadiness(origin, target, value, Date.parse(serverTime));
}
function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((accept) => {
		resolve = accept;
	});
	return { promise, resolve };
}

void test('origin input normalizes HTTPS and permits only explicitly enabled HTTP loopback', () => {
	assert.equal(normalizeServerOrigin(' Institution.Example.test:443/ ', false), origin);
	assert.equal(normalizeServerOrigin('http://localhost:8080', true), 'http://localhost:8080');
	assert.equal(normalizeServerOrigin('http://[::1]:8080', true), 'http://[::1]:8080');
	for (const value of [
		'',
		'http://localhost:8080',
		'https://user:password@institution.example.test',
		origin + '/api',
		origin + '?q=x',
		origin + '#x',
		'ftp://invalid-server',
		'https://bad host',
		'https://example.test\\evil'
	]) {
		assert.throws(() => normalizeServerOrigin(value, false), value);
	}
	for (const value of [
		'http://example.test',
		'http://localhost.example.test',
		'http://127.0.0.2'
	])
		assert.throws(() => normalizeServerOrigin(value, true));
	assert.throws(() => validateDesktopReleaseTarget({ ...target, buildId: 'bad:build' }));
	assert.throws(() => validateDesktopReleaseTarget({ ...target, realtimeProtocol: 0 }));
});

void test('server remains compatibility authority and unrelated discovery fields never enter the projection', async () => {
	const value = probe({ minimum_desktop_release: '99.0.0', extra: true });
	assert.equal(evaluate(value).state, 'ready'); // Catalog decision, not local range recomputation.
	const coordinator = new DesktopIdentityCoordinator({
		target,
		transport: { probe: async () => value },
		allowDevelopmentLoopback: false
	});
	try {
		await coordinator.handleIntent({ kind: 'selectServer', address: origin });
		const projection = coordinator.projection();
		assert.equal(projection.state, 'ready');
		assert.equal(projection.institutionName, 'Example University');
		assert.equal(projection.canSignIn, false);
		assert.equal(projection.authorizationAvailable, false);
		assert.ok(Object.isFrozen(projection));
		assert.deepEqual(projection.build, { release: '1.2.3', platform: 'macos' });
		assert.deepEqual(
			Object.keys(projection).sort(),
			[
				'authorizationAvailable',
				'build',
				'canSignIn',
				'developmentOrigin',
				'institutionName',
				'origin',
				'revision',
				'state'
			].sort()
		);
		await assert.rejects(coordinator.handleIntent({ kind: 'signIn' }));
	} finally {
		coordinator.dispose();
	}
});

void test('both public contracts gate readiness without leaking setup or internal health information', () => {
	const cases: [ServerReadinessProbe, string][] = [
		[probe({ availability: 'maintenance' }), 'maintenance'],
		[probe({ availability: 'temporarily_unavailable' }), 'unavailable'],
		[probe({ availability: 'unknown' }), 'serverIncompatible'],
		[probe({ schema_version: 2 }), 'serverIncompatible'],
		[probe({}, { discovery_version: 2 }), 'serverIncompatible'],
		[probe({}, { canonical_origin: 'https://other.example.test' }), 'originMismatch'],
		[
			probe({}, { initialized: false, institution: undefined, installation_id: undefined }),
			'unavailable'
		],
		[probe({}, { institution: {} }), 'invalidResponse'],
		[probe({}, { capabilities: { desktop_authorization: false } }), 'authorizationDisabled'],
		[probe({}, { capabilities: {} }), 'invalidResponse'],
		[
			probe(
				{},
				{
					desktop_authorization: {
						protocol: 'other',
						minimum_version: 1,
						maximum_version: 1
					}
				}
			),
			'authorizationUnsupported'
		],
		[
			probe(
				{},
				{
					desktop_authorization: {
						protocol: 'proctor-desktop-authorization',
						minimum_version: 2,
						maximum_version: 2
					}
				}
			),
			'authorizationUnsupported'
		],
		[
			probe({ compatibility: 'update_required', compatibility_reason: 'build_revoked' }),
			'updateRequired'
		],
		[probe({ compatibility: 'server_incompatible' }), 'serverIncompatible'],
		[probe({ compatibility: 'unsupported_target' }), 'unsupportedTarget'],
		[probe({ compatibility: 'future_decision' }), 'serverIncompatible'],
		[probe({ server_time: 'invalid' }), 'invalidResponse'],
		[probe({ administrator_message: 'x'.repeat(2049) }), 'invalidResponse']
	];
	for (const [value, state] of cases) assert.equal(evaluate(value).state, state);
	const retryAt = '2026-11-03T10:00:00Z';
	assert.equal(
		evaluate(probe({ availability: 'maintenance', retry_at: retryAt })).retryAt,
		Date.parse(retryAt)
	);
	assert.equal(evaluate(probe({ retry_at: '2026-09-01T10:00:00Z' })).retryAt, undefined);
	assert.equal(
		evaluate(probe({ compatibility: 'update_required', compatibility_reason: 'build_revoked' }))
			.compatibilityReason,
		'buildRevoked'
	);
	assert.equal(
		evaluate(probe({ compatibility: 'update_required', compatibility_reason: 'future_reason' }))
			.compatibilityReason,
		'unknown'
	);
	const partial = evaluate({ ...probe(), system: { ok: false, reason: 'timedOut' } });
	assert.equal(partial.institutionName, 'Example University');
	assert.equal(partial.state, 'timedOut');
	assert.deepEqual(evaluate(probe({}, { initialized: false })), { state: 'unavailable' });
});

void test('new server selection cancels outstanding checks and fences stale completions', async () => {
	const first = deferred<ServerReadinessProbe>();
	let firstToken = CancellationToken.None;
	let calls = 0;
	const coordinator = new DesktopIdentityCoordinator({
		target,
		allowDevelopmentLoopback: false,
		transport: {
			probe: async (_origin, _target, token) => {
				calls++;
				firstToken = token;
				return first.promise;
			}
		}
	});
	try {
		const pending = coordinator.handleIntent({ kind: 'selectServer', address: origin });
		assert.equal(coordinator.projection().state, 'checking');
		await coordinator.handleIntent({ kind: 'retry' });
		assert.equal(calls, 1);
		await coordinator.handleIntent({ kind: 'changeServer' });
		assert.ok(firstToken.isCancellationRequested);
		first.resolve(probe());
		await pending;
		assert.equal(coordinator.projection().state, 'selectingServer');
		assert.equal(coordinator.projection().origin, undefined);
	} finally {
		coordinator.dispose();
	}
});

void test('sign-in rechecks readiness and delivers only freshly verified identity to the privileged handoff', async () => {
	let calls = 0;
	let starts = 0;
	let next = probe();
	let authToken = CancellationToken.None;
	const authorization = deferred<void>();
	const coordinator = new DesktopIdentityCoordinator({
		target,
		allowDevelopmentLoopback: false,
		transport: {
			probe: async () => {
				calls++;
				return next;
			}
		},
		authorization: {
			start: async (identity, token) => {
				starts++;
				authToken = token;
				assert.equal(identity.origin, origin);
				assert.equal(identity.installationId, 'institution-1');
				await authorization.promise;
			},
			reopenBrowser: async () => {}
		}
	});
	try {
		await coordinator.handleIntent({ kind: 'selectServer', address: origin });
		assert.equal(coordinator.projection().canSignIn, true);
		next = probe({ availability: 'maintenance' });
		await coordinator.handleIntent({ kind: 'signIn' });
		assert.equal(starts, 0);
		assert.equal(calls, 2);
		assert.equal(coordinator.projection().state, 'maintenance');
		next = probe();
		await coordinator.handleIntent({ kind: 'retry' });
		const pending = coordinator.handleIntent({ kind: 'signIn' });
		await Promise.resolve();
		assert.equal(starts, 1);
		assert.equal(coordinator.projection().state, 'authorizing');
		await assert.rejects(coordinator.handleIntent({ kind: 'signIn' }));
		await coordinator.handleIntent({ kind: 'changeServer' });
		assert.ok(authToken.isCancellationRequested);
		authorization.resolve();
		await pending;
		assert.equal(coordinator.projection().state, 'selectingServer');
	} finally {
		coordinator.dispose();
		authorization.resolve();
	}
});

void test('cancel stops a check or a browser sign-in and is ignored otherwise', async () => {
	const check = deferred<ServerReadinessProbe>();
	let useDeferred = false;
	let authToken = CancellationToken.None;
	const reopened: string[] = [];
	const coordinator = new DesktopIdentityCoordinator({
		target,
		allowDevelopmentLoopback: false,
		transport: {
			probe: async () => (useDeferred ? check.promise : probe())
		},
		authorization: {
			start: async (_identity, token) =>
				new Promise<void>((resolve) => {
					authToken = token;
					token.onCancellationRequested(() => resolve());
				}),
			reopenBrowser: async () => {
				reopened.push(coordinator.projection().state);
			}
		}
	});
	try {
		useDeferred = true;
		const checking = coordinator.handleIntent({ kind: 'selectServer', address: origin });
		assert.equal(coordinator.projection().state, 'checking');
		await coordinator.handleIntent({ kind: 'cancel' });
		assert.equal(coordinator.projection().state, 'selectingServer');
		check.resolve(probe());
		await checking;
		assert.equal(coordinator.projection().state, 'selectingServer', 'a late result is dropped');

		useDeferred = false;
		await coordinator.handleIntent({ kind: 'selectServer', address: origin });
		await coordinator.handleIntent({ kind: 'reopenBrowser' });
		await coordinator.handleIntent({ kind: 'cancel' });
		assert.equal(coordinator.projection().state, 'ready', 'cancel does nothing when idle');
		assert.deepEqual(reopened, [], 'reopen does nothing before sign-in');

		const signingIn = coordinator.handleIntent({ kind: 'signIn' });
		await new Promise((resolve) => setImmediate(resolve));
		assert.equal(coordinator.projection().state, 'authorizing');
		await coordinator.handleIntent({ kind: 'reopenBrowser' });
		assert.deepEqual(reopened, ['authorizing']);
		await coordinator.handleIntent({ kind: 'cancel' });
		await signingIn;
		assert.ok(authToken.isCancellationRequested);
		const cancelled = coordinator.projection();
		assert.equal(cancelled.state, 'authorizationFailed');
		assert.equal(cancelled.authorizationFailure, 'cancelled');
		assert.equal(cancelled.origin, origin);
		assert.equal(cancelled.institutionName, 'Example University');
	} finally {
		coordinator.dispose();
	}
});

void test('sign-in never silently follows a replaced Institution at the same origin', async () => {
	let next = probe();
	let starts = 0;
	const coordinator = new DesktopIdentityCoordinator({
		target,
		allowDevelopmentLoopback: false,
		transport: { probe: async () => next },
		authorization: {
			start: async () => {
				starts++;
			},
			reopenBrowser: async () => {}
		}
	});
	try {
		await coordinator.handleIntent({ kind: 'selectServer', address: origin });
		next = probe(
			{},
			{
				installation_id: 'replacement',
				institution: { id: 'replacement', name: 'Replacement University' }
			}
		);
		await coordinator.handleIntent({ kind: 'signIn' });
		assert.equal(starts, 0);
		assert.equal(coordinator.projection().state, 'identityChanged');
		assert.equal(coordinator.projection().canSignIn, false);
	} finally {
		coordinator.dispose();
	}
});

void test('disposal and reentrant change-server cannot leave a live or late check', async () => {
	let calls = 0;
	const coordinator = new DesktopIdentityCoordinator({
		target,
		allowDevelopmentLoopback: false,
		transport: {
			probe: async () => {
				calls++;
				return probe();
			}
		}
	});
	const subscription = coordinator.onDidChange((value) => {
		if (value.state === 'checking') void coordinator.handleIntent({ kind: 'changeServer' });
	});
	await coordinator.handleIntent({ kind: 'selectServer', address: origin });
	assert.equal(calls, 0);
	assert.equal(coordinator.projection().state, 'selectingServer');
	subscription.dispose();
	coordinator.dispose();
	await assert.rejects(coordinator.handleIntent({ kind: 'retry' }));
});

void test('protocol validators enforce closed intents and strip arbitrary projection fields', () => {
	for (const kind of ['cancel', 'reopenBrowser'])
		assert.deepEqual(validateLaunchIdentityIntent({ kind }), { kind });
	for (const value of [
		{ kind: 'signIn', target },
		{ kind: 'cancel', operation: 'checking' },
		{ kind: 'reopenBrowser', url: origin },
		{ kind: 'selectServer', address: origin, ready: true },
		{ kind: 'selectServer', address: 123 },
		{ kind: 'get', url: origin }
	])
		assert.throws(() => validateLaunchIdentityIntent(value));
	const base = {
		revision: 0,
		state: 'selectingServer',
		developmentOrigin: false,
		canSignIn: false,
		authorizationAvailable: false
	};
	assert.deepEqual(validateLaunchIdentityProjection({ ...base, credentials: 'private' }), base);
	assert.throws(() => validateLaunchIdentityProjection({ ...base, canSignIn: true }));
	assert.throws(() =>
		validateLaunchIdentityProjection({ ...base, retryAt: Number.MAX_SAFE_INTEGER })
	);
	for (const build of [
		{ release: '1.0.0', platform: 'darwin' },
		{ release: '1.0.0 beta', platform: 'macos' },
		{ release: '1.0.0', platform: 'macos', arch: 'arm64' }
	])
		assert.throws(() => validateLaunchIdentityProjection({ ...base, build }));
});

void test('HTTP adapter sends exactly the existing public selectors, omits credentials and never follows redirects', async (t) => {
	const requests: {
		path: string;
		cookie: string | undefined;
		authorization: string | undefined;
	}[] = [];
	const server = createServer((request, response) => {
		requests.push({
			path: request.url ?? '',
			cookie: request.headers.cookie,
			authorization: request.headers.authorization
		});
		response.setHeader('Content-Type', 'application/json');
		response.end(JSON.stringify({ public: true }));
	});
	t.after(() => {
		server.closeAllConnections();
		server.close();
	});
	server.listen(0, '127.0.0.1');
	await once(server, 'listening');
	const address = server.address();
	assert.ok(address && typeof address !== 'string');
	const localOrigin = 'http://127.0.0.1:' + address.port;
	const transport = new HttpServerReadinessTransport();
	const result = await transport.probe(localOrigin, target, CancellationToken.None);
	assert.ok(result.system.ok && result.discovery.ok);
	assert.equal(requests.length, 2);
	assert.ok(
		requests.every(
			(request) => request.cookie === undefined && request.authorization === undefined
		)
	);
	const ping = new URL(
		requests.find((request) => request.path.includes('/system/ping'))!.path,
		localOrigin
	);
	assert.deepEqual(Object.fromEntries(ping.searchParams), {
		desktop_release: '1.2.3',
		desktop_build_id: 'build-123',
		platform: 'darwin',
		architecture: 'arm64',
		realtime_protocol: '1'
	});
	assert.ok(requests.some((request) => request.path === '/api/v1/discovery'));
	server.removeAllListeners('request');
	server.on('request', (_request, response) => {
		response.writeHead(302, { location: '/private' });
		response.end();
	});
	assert.deepEqual((await transport.probe(localOrigin, target, CancellationToken.None)).system, {
		ok: false,
		reason: 'redirectBlocked'
	});
});

void test('HTTP adapter rejects malformed, oversized, redirected and non-JSON bodies', async () => {
	const factories = [
		() => new Response('<html>private</html>', { headers: { 'content-type': 'text/html' } }),
		() => new Response('invalid', { headers: { 'content-type': 'application/json' } }),
		() =>
			new Response(new Uint8Array([255]), {
				headers: { 'content-type': 'application/json' }
			}),
		() => new Response('x'.repeat(65537), { headers: { 'content-type': 'application/json' } }),
		() =>
			new Response('{}', {
				headers: { 'content-type': 'application/json', 'content-length': '9999999' }
			})
	];
	for (const factory of factories) {
		const transport = new HttpServerReadinessTransport(async (_input, options) => {
			assert.equal(options?.redirect, 'manual');
			assert.equal(options?.credentials, 'omit');
			assert.equal(options?.cache, 'no-store');
			return factory();
		});
		const result = await transport.probe(origin, target, CancellationToken.None);
		assert.deepEqual(result.system, { ok: false, reason: 'invalidResponse' });
	}
});

void test('HTTP adapter aborts on deadline and owner cancellation', async () => {
	const request: typeof fetch = async (_input, options) =>
		new Promise((_resolve, reject) => {
			const abort = () => reject(new Error('aborted'));
			if (options?.signal?.aborted) abort();
			else options?.signal?.addEventListener('abort', abort, { once: true });
		});
	const timed = await new HttpServerReadinessTransport(request, 5).probe(
		origin,
		target,
		CancellationToken.None
	);
	assert.deepEqual(timed.system, { ok: false, reason: 'timedOut' });
	const cancellation = new CancellationTokenSource();
	try {
		const pending = new HttpServerReadinessTransport(request).probe(
			origin,
			target,
			cancellation.token
		);
		cancellation.cancel();
		assert.deepEqual((await pending).discovery, { ok: false, reason: 'unreachable' });
	} finally {
		cancellation.dispose();
	}
});

void test('Launch IPC authorizes the bound main frame, rejects extra arguments, forwards bounded state, and cleans up', async () => {
	const handlers = new Map<string, (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown>();
	const sent: unknown[] = [];
	const ipc: Pick<IpcMain, 'handle' | 'removeHandler'> = {
		handle: (channel, handler) => {
			handlers.set(channel, handler);
		},
		removeHandler: (channel) => {
			handlers.delete(channel);
		}
	};
	const frame = {};
	const contents = {
		id: 1,
		mainFrame: frame,
		isDestroyed: () => false,
		send: (_channel: string, value: unknown) => sent.push(value)
	} as unknown as WebContents;
	const event = { sender: contents, senderFrame: frame } as IpcMainInvokeEvent;
	const coordinator = new DesktopIdentityCoordinator({
		target,
		allowDevelopmentLoopback: false,
		transport: { probe: async () => probe() }
	});
	const bridge = new LaunchIdentityIpcBridge(ipc, contents, coordinator);
	try {
		const projection = handlers.get(LAUNCH_IDENTITY_CHANNELS.projection)!;
		const intent = handlers.get(LAUNCH_IDENTITY_CHANNELS.intent)!;
		assert.throws(() => projection({ ...event, senderFrame: {} } as IpcMainInvokeEvent));
		assert.throws(() => projection({ ...event, sender: { id: 2 } } as IpcMainInvokeEvent));
		assert.throws(() => projection(event, {}));
		assert.throws(() => intent(event));
		await assert.rejects(Promise.resolve().then(() => intent(event, { kind: 'signIn' })));
		await intent(event, { kind: 'selectServer', address: origin });
		assert.equal(sent.length, 2);
		assert.equal((projection(event) as { state: string }).state, 'ready');
	} finally {
		bridge.dispose();
		coordinator.dispose();
	}
	assert.equal(handlers.size, 0);
	bridge.dispose();
});

void test('partial Launch IPC registration rolls back only its installed handlers', () => {
	const removed: string[] = [];
	let calls = 0;
	const ipc: Pick<IpcMain, 'handle' | 'removeHandler'> = {
		handle: () => {
			if (++calls === 2) throw new Error('registration failed');
		},
		removeHandler: (channel) => {
			removed.push(channel);
		}
	};
	const coordinator = new DesktopIdentityCoordinator({
		target,
		allowDevelopmentLoopback: false,
		transport: { probe: async () => probe() }
	});
	try {
		assert.throws(() => new LaunchIdentityIpcBridge(ipc, {} as WebContents, coordinator));
	} finally {
		coordinator.dispose();
	}
	assert.deepEqual(removed, [LAUNCH_IDENTITY_CHANNELS.projection]);
});

void test('Session loss retains the Institution and separates validity, custody, and cleanup outcomes', async () => {
	const coordinator = new DesktopIdentityCoordinator({
		target,
		allowDevelopmentLoopback: false,
		transport: { probe: async () => probe() }
	});
	const ended = {
		sequence: 1,
		origin,
		institutionName: 'Example Institution',
		authentication: 'signedOut',
		sessionValidity: 'verificationRequired',
		credentialReadiness: 'locked',
		reason: 'refreshFailed',
		localCleanup: 'notRequested',
		remoteRevocation: 'notRequested'
	} as const;
	try {
		coordinator.acceptSessionOutcome(ended);
		// The window checks the server again, so its checklist is never stale.
		assert.equal(coordinator.projection().state, 'checking');
		await settle();
		assert.equal(coordinator.projection().state, 'ready');
		assert.equal(coordinator.projection().origin, origin);
		assert.equal(
			coordinator.projection().sessionOutcome?.sessionValidity,
			'verificationRequired'
		);
		assert.equal(coordinator.projection().sessionOutcome?.credentialReadiness, 'locked');
		const pending = {
			...ended,
			sequence: 2,
			authentication: 'ending',
			reason: 'signOut',
			localCleanup: 'pending',
			remoteRevocation: 'pending'
		} as const;
		coordinator.acceptSessionOutcome(pending);
		assert.equal(coordinator.projection().state, 'authorizationFailed');
		await coordinator.handleIntent({ kind: 'changeServer' });
		assert.equal(coordinator.projection().sessionOutcome?.authentication, 'ending');
		const settled = {
			...pending,
			authentication: 'signedOut',
			credentialReadiness: 'unavailable',
			localCleanup: 'failed',
			remoteRevocation: 'unconfirmed'
		} as const;
		coordinator.acceptSessionOutcome(settled);
		await settle();
		assert.equal(coordinator.projection().state, 'ready');
		assert.deepEqual(coordinator.projection().sessionOutcome, settled);
		coordinator.acceptSessionOutcome(ended);
		assert.equal(coordinator.projection().sessionOutcome?.sequence, 2);
		await coordinator.handleIntent({ kind: 'retry' });
		assert.equal(coordinator.projection().state, 'ready');
		assert.equal(coordinator.projection().sessionOutcome, undefined);
	} finally {
		coordinator.dispose();
	}
});

/** Lets a check the coordinator started by itself finish. */
async function settle(): Promise<void> {
	await new Promise<void>((resolve) => setImmediate(resolve));
}
