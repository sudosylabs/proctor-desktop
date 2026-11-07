import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
	validateAccountIntent,
	validateAccountResponse
} from '../../../../src/prctr/platform/account/common/accountProtocol.js';
import {
	readAccountProfile,
	readAccountSessions,
	readAccountDesktops,
	readAccountNotices,
	readAccountToken,
	readAccountTokenCreation,
	readAccountTokens
} from '../../../../src/prctr/platform/account/electron-main/accountWire.js';
import { desktopHttpMethod } from '../../../../src/prctr/platform/identity/node/desktopAuthHttp.js';
const id = 'y'.repeat(26);
void test('account boundary rejects URLs, foreign resources, excessive data and unexpected actions', () => {
	for (const value of [
		{ kind: 'openSecurity', url: 'https://attacker.test' },
		{ kind: 'revokeDesktop', id: '../sessions' },
		{ kind: 'read', section: 'password' },
		{ kind: 'revokeAll' }
	])
		assert.throws(() => validateAccountIntent(value));
	assert.throws(() => desktopHttpMethod('/api/v1/users/me/desktop-registrations/../sessions'));
	assert.equal(desktopHttpMethod(`/api/v1/users/me/desktop-registrations/${id}`), 'DELETE');
	assert.throws(() =>
		readAccountProfile({ id: 'b'.repeat(26) }, { principalId: id, sessionId: id })
	);
	assert.throws(() =>
		validateAccountResponse({
			kind: 'data',
			data: { section: 'sessions', sessions: Array(257).fill({}) }
		})
	);
	assert.throws(() =>
		readAccountSessions([{ user_id: 'b'.repeat(26) }], { principalId: id, sessionId: id })
	);
	assert.throws(() => readAccountDesktops([{ id, current: false, status: 'active' }], id));
});
void test('profile response is a bounded whitelist, never a raw server user or provider credential', () => {
	const data = readAccountProfile(
		{
			id,
			username: 'name',
			display_name: 'Name',
			first_name: '',
			last_name: '',
			email: 'name@example.test',
			email_verified: true,
			password_hash: 'SECRET',
			profile_picture_url: 'https://untrusted.test/tracker'
		},
		{ principalId: id, sessionId: id }
	);
	assert.deepEqual(data, {
		section: 'profile',
		profile: {
			username: 'name',
			displayName: 'Name',
			firstName: '',
			lastName: '',
			email: 'name@example.test',
			emailVerified: true
		}
	});
	assert.ok(!JSON.stringify(data).includes('SECRET'));
	assert.ok(!JSON.stringify(data).includes('untrusted'));
});

void test('account IPC binds identity, rejects extra arguments, rechecks the sender and fences closed windows', async () => {
	const { AccountIpcBridge } =
		await import('../../../../src/prctr/platform/account/electron-main/accountIpc.js');
	type InvokeEvent = import('electron/main').IpcMainInvokeEvent;
	let handler: ((event: InvokeEvent, ...args: unknown[]) => unknown) | undefined;
	let authorized = true;
	let calls = 0;
	let finish: ((value: { kind: 'success' }) => void) | undefined;
	let removed = '';
	const bridge = new AccountIpcBridge(
		{
			handle(channel, listener) {
				assert.equal(channel, 'prctr:authenticated:account');
				handler = listener;
			},
			removeHandler(channel) {
				removed = channel;
			}
		},
		{ principalId: id, sessionId: id },
		{
			async account(binding) {
				assert.deepEqual(binding, { principalId: id, sessionId: id });
				calls++;
				return new Promise((resolve) => {
					finish = resolve;
				});
			}
		},
		() => {
			if (!authorized) throw new Error('Unauthorized sender');
		}
	);
	const event = {} as InvokeEvent;
	const invoke = (...args: unknown[]) => Promise.resolve(handler!(event, ...args));
	authorized = false;
	await assert.rejects(invoke({ kind: 'openSecurity' }), /Unauthorized/);
	assert.equal(calls, 0);
	authorized = true;
	await assert.rejects(invoke({ kind: 'openSecurity' }, 'extra'), /Expected one/);
	assert.equal(calls, 0);
	const pending = invoke({ kind: 'openSecurity' });
	bridge.dispose();
	finish?.({ kind: 'success' });
	assert.deepEqual(await pending, { kind: 'error', reason: 'sessionEnded' });
	assert.equal(removed, 'prctr:authenticated:account');
	await assert.rejects(invoke({ kind: 'openSecurity' }), /closed/);
	bridge.dispose();
});

void test('profile photo intents bound bytes, media types and exact strong revisions', () => {
	const etag = `"${'a'.repeat(64)}"`;
	const bytes = new Uint8Array([1, 2, 3]);
	const intent = validateAccountIntent({
		kind: 'uploadPhoto',
		bytes,
		mediaType: 'image/png',
		etag
	});
	bytes[0] = 9;
	assert.equal(intent.kind, 'uploadPhoto');
	if (intent.kind === 'uploadPhoto') assert.equal(intent.bytes[0], 1);
	for (const value of [
		{
			kind: 'uploadPhoto',
			bytes: new Uint8Array(5 * 1024 * 1024 + 1),
			mediaType: 'image/png',
			etag
		},
		{ kind: 'uploadPhoto', bytes, mediaType: 'image/svg+xml', etag },
		{ kind: 'removePhoto', etag: '*' },
		{ kind: 'removePhoto', etag, principalId: 'other' }
	])
		assert.throws(() => validateAccountIntent(value));
	assert.throws(() =>
		validateAccountResponse({ kind: 'photo', dataUrl: 'https://attacker.test/tracker', etag })
	);
	assert.throws(() =>
		validateAccountResponse({ kind: 'photo', dataUrl: 'data:image/svg+xml;base64,AAA=', etag })
	);
});

void test('profile photo transport binds image bytes and If-Match without following remote image URLs', async () => {
	const { DesktopAuthHttp } =
		await import('../../../../src/prctr/platform/identity/node/desktopAuthHttp.js');
	const { CancellationToken } = await import('../../../../src/prctr/base/common/cancellation.js');
	const etag = `"${'a'.repeat(64)}"`;
	const bytes = Buffer.from('RIFF0000WEBP');
	let count = 0;
	const http = new DesktopAuthHttp(async (input, init) => {
		count++;
		assert.equal(String(input), `https://example.test/api/v1/users/${id}/profile-picture`);
		assert.equal(init?.redirect, 'manual');
		if (init?.method === 'GET')
			return new Response(bytes, { headers: { 'Content-Type': 'image/webp', ETag: etag } });
		assert.equal(init?.method, 'PUT');
		assert.equal(new Headers(init.headers).get('If-Match'), etag);
		assert.deepEqual(init.body, Buffer.from([1, 2, 3]));
		return new Response('{}', { headers: { 'Content-Type': 'application/json' } });
	});
	const read = await http.request(
		'https://example.test',
		`/api/v1/users/${id}/profile-picture`,
		CancellationToken.None,
		{ photo: { operation: 'GET' } }
	);
	assert.deepEqual(read.value, {
		kind: 'photo',
		dataUrl: `data:image/webp;base64,${bytes.toString('base64')}`,
		etag
	});
	await http.request(
		'https://example.test',
		`/api/v1/users/${id}/profile-picture`,
		CancellationToken.None,
		{
			photo: {
				operation: 'PUT',
				bytes: new Uint8Array([1, 2, 3]),
				mediaType: 'image/png',
				etag
			}
		}
	);
	assert.equal(count, 2);
	await assert.rejects(
		http.request('https://example.test', '/api/v1/users/me', CancellationToken.None, {
			photo: { operation: 'DELETE' }
		})
	);
});

void test('native account menu accepts only an anchor and fences selection by sender and lifetime', async () => {
	const { AccountMenuIpcBridge } =
		await import('../../../../src/prctr/platform/account/electron-main/accountMenuIpc.js');
	const { validateAccountMenuAnchor, validateAccountMenuAction } =
		await import('../../../../src/prctr/platform/account/common/accountMenu.js');
	for (const value of [
		null,
		{ x: NaN, y: 1 },
		{ x: 1, y: Infinity },
		{ x: 100001, y: 1 },
		{ x: 1, y: 2, items: [] }
	])
		assert.throws(() => validateAccountMenuAnchor(value));
	assert.throws(() => validateAccountMenuAction('runCommand'));
	type InvokeEvent = import('electron/main').IpcMainInvokeEvent;
	type Action =
		import('../../../../src/prctr/platform/account/common/accountMenu.js').AccountMenuAction;
	let handler: ((event: InvokeEvent, ...args: unknown[]) => unknown) | undefined;
	let choose: ((action: Action) => void) | undefined;
	let close: (() => void) | undefined;
	let authorized = true,
		opened = 0,
		closed = 0;
	let removed = '';
	const bridge = new AccountMenuIpcBridge(
		{
			handle(channel, listener) {
				assert.equal(channel, 'prctr:authenticated:account-menu');
				handler = listener;
			},
			removeHandler(channel) {
				removed = channel;
			}
		},
		{
			popup(anchor, selected, dismissed) {
				assert.deepEqual(anchor, { x: 10, y: 20 });
				opened++;
				choose = selected;
				close = dismissed;
				return {
					dispose() {
						closed++;
					}
				};
			}
		},
		() => {
			if (!authorized) throw new Error('Unauthorized');
		}
	);
	const invoke = (...args: unknown[]) => Promise.resolve(handler!({} as InvokeEvent, ...args));
	authorized = false;
	await assert.rejects(invoke({ x: 10, y: 20 }), /Unauthorized/);
	assert.equal(opened, 0);
	authorized = true;
	await assert.rejects(invoke({ x: 10, y: 20 }, 'extra'), /Expected one/);
	const pending = invoke({ x: 10, y: 20 });
	assert.equal(await invoke({ x: 10, y: 20 }), undefined);
	assert.equal(opened, 1);
	choose?.('sessions');
	close?.();
	assert.equal(await pending, 'sessions');
	assert.equal(closed, 1);
	const cancelled = invoke({ x: 10, y: 20 });
	close?.();
	assert.equal(await cancelled, undefined);
	const stale = invoke({ x: 10, y: 20 });
	authorized = false;
	choose?.('logout');
	await assert.rejects(stale, /Unauthorized/);
	authorized = true;
	const disposed = invoke({ x: 10, y: 20 });
	bridge.dispose();
	choose?.('profile');
	assert.equal(await disposed, undefined);
	assert.equal(removed, 'prctr:authenticated:account-menu');
	await assert.rejects(invoke({ x: 10, y: 20 }), /closed/);
	bridge.dispose();
	assert.equal(closed, 4);
});

void test('closing an authenticated window fences settings requests waiting for the initial server read', async () => {
	const { bindWindowUserSettings } =
		await import('../../../../src/prctr/platform/settings/electron-main/userSettingsWindow.js');
	type InvokeEvent = import('electron/main').IpcMainInvokeEvent;
	type Snapshot =
		import('../../../../src/prctr/platform/settings/common/userSettingsSession.js').UserSettingsSnapshot;
	let release!: (snapshot: Snapshot) => void;
	const read = new Promise<Snapshot>((resolve) => {
		release = resolve;
	});
	const handlers = new Map<string, (event: InvokeEvent, ...args: unknown[]) => unknown>();
	const frame = {};
	const contents = {
		id: 32,
		mainFrame: frame,
		isDestroyed: () => false,
		send: () => {
			throw new Error('A closed window received settings');
		}
	} as unknown as import('electron/main').WebContents;
	const event = { sender: contents, senderFrame: frame } as InvokeEvent;
	let commits = 0;
	const binding = bindWindowUserSettings(
		{
			handle: (name, handler) => {
				handlers.set(name, handler);
			},
			removeHandler: (name) => {
				handlers.delete(name);
			}
		},
		contents,
		{ principalId: id, sessionId: id },
		{
			readSettings: async () => read,
			commitSettings: async () => {
				commits++;
				return { kind: 'success', revision: 'revision' };
			}
		}
	);
	const pending = Promise.resolve(
		handlers.get('prctr:authenticated:settings:commit')!(event, {
			source: '{}',
			expectedRevision: 'before',
			idempotencyKey: 'settings-pending'
		})
	);
	const rejected = assert.rejects(pending, /bound AuthenticatedWindow/);
	binding.dispose();
	release({
		acknowledged: { source: '{}', revision: 'before' },
		writable: true
	});
	await rejected;
	assert.equal(commits, 0);
	assert.equal(handlers.size, 0);
});

void test('token, verification and notice intents are exact and bounded', () => {
	const create = {
		kind: 'createToken',
		description: 'Registrar tool',
		scopes: ['examinations:read'],
		expiresAt: 1798761600000
	};
	assert.deepEqual(validateAccountIntent(create), create);
	assert.deepEqual(validateAccountIntent({ ...create, academicUnitId: id }), {
		...create,
		academicUnitId: id
	});
	assert.deepEqual(validateAccountIntent({ kind: 'requestEmailVerification' }), {
		kind: 'requestEmailVerification'
	});
	for (const kind of ['disableToken', 'enableToken', 'revokeToken'])
		assert.deepEqual(validateAccountIntent({ kind, id }), { kind, id });
	for (const section of ['tokens', 'notices'])
		assert.deepEqual(validateAccountIntent({ kind: 'read', section }), {
			kind: 'read',
			section
		});
	for (const value of [
		{ ...create, credential: 'x' },
		{ ...create, description: '' },
		{ ...create, description: '   ' },
		{ ...create, description: 'a'.repeat(257) },
		{ ...create, description: 'line\nbreak' },
		{ ...create, scopes: [] },
		{ ...create, scopes: ['examinations:read', 'examinations:read'] },
		{ ...create, scopes: ['Examinations Read'] },
		{ ...create, scopes: Array.from({ length: 65 }, (_, i) => `scope${i}`) },
		{ ...create, expiresAt: '2026-01-01T00:00:00Z' },
		{ ...create, expiresAt: 0 },
		{ ...create, academicUnitId: '../units' },
		{ kind: 'createToken' },
		{ kind: 'revokeToken', id: '../me' },
		{ kind: 'enableToken', id, extra: true },
		{ kind: 'requestEmailVerification', email: 'other@example.test' }
	])
		assert.throws(() => validateAccountIntent(value));
});

void test('token and notice wire parsers whitelist fields and bind the principal', () => {
	const binding = { principalId: id, sessionId: id };
	const raw = {
		id,
		user_id: id,
		description: 'Tool',
		scopes: ['examinations:read'],
		academic_unit_id: id,
		expires_at: '2027-01-01T00:00:00Z',
		last_used_at: '2026-03-01T00:00:00Z',
		revoked_at: '2026-04-01T00:00:00Z',
		created_at: '2026-01-01T00:00:00Z',
		updated_at: '2026-01-01T00:00:00Z',
		credential: 'SECRET'
	};
	assert.deepEqual(readAccountTokens({ items: [raw] }, binding), {
		section: 'tokens',
		tokens: [
			{
				id,
				description: 'Tool',
				scopes: ['examinations:read'],
				academicUnitId: id,
				expiresAt: Date.parse('2027-01-01T00:00:00Z'),
				lastUsedAt: Date.parse('2026-03-01T00:00:00Z'),
				revokedAt: Date.parse('2026-04-01T00:00:00Z'),
				createdAt: Date.parse('2026-01-01T00:00:00Z')
			}
		]
	});
	assert.ok(!JSON.stringify(readAccountTokens({ items: [raw] }, binding)).includes('SECRET'));
	assert.throws(() =>
		readAccountTokens({ items: [{ ...raw, user_id: 'b'.repeat(26) }] }, binding)
	);
	assert.throws(() => readAccountTokens({ items: [raw, raw] }, binding));
	assert.throws(() =>
		readAccountTokens({ items: [{ ...raw, scopes: 'examinations:read' }] }, binding)
	);
	assert.throws(() => readAccountToken(raw, binding, 'b'.repeat(26)));
	for (const stale of [{ disabled_at: 0 }, { revoked_at: null }, { created_at: 1 }])
		assert.throws(() => readAccountTokens({ items: [{ ...raw, ...stale }] }, binding));
	const credential = `pat_${'x'.repeat(40)}`;
	const created = readAccountTokenCreation({ token: raw, credential }, binding);
	assert.equal(created.kind, 'tokenCreated');
	for (const value of [
		{ token: raw },
		{ token: raw, credential: 'short' },
		{ token: raw, credential: `${credential} ` },
		{ token: raw, credential, extra: 1 }
	])
		assert.throws(() => readAccountTokenCreation(value, binding));
	const notice = {
		retirement_id: id,
		exam_id: id,
		exam_sitting_id: id,
		submission_id: id,
		category: 'browser_activity',
		state: 'canceled',
		created_at: '2026-01-01T00:00:00Z',
		retire_after: '2026-01-01T23:00:00Z',
		delivery_state: 'canceled',
		canceled_at: '2026-01-01T12:00:00.5Z',
		delivery_error_code: 'mail.unavailable'
	};
	assert.deepEqual(readAccountNotices({ items: [notice] }), {
		section: 'notices',
		notices: [
			{
				retirementId: id,
				examId: id,
				examSittingId: id,
				submissionId: id,
				category: 'browser_activity',
				state: 'canceled',
				createdAt: Date.parse('2026-01-01T00:00:00Z'),
				retireAfter: Date.parse('2026-01-01T23:00:00Z'),
				deliveryState: 'canceled',
				canceledAt: Date.parse('2026-01-01T12:00:00.5Z')
			}
		],
		more: false
	});
	for (const value of [
		{},
		{ items: [{ ...notice, category: 'other' }] },
		{ items: [{ ...notice, created_at: 'yesterday' }] },
		{ items: [{ ...notice, created_at: 1 }] },
		{ items: [{ ...notice, state: 'cancelled' }] },
		{ items: [{ ...notice, canceled_at: null }] },
		{ items: [notice, notice] },
		{ items: Array(201).fill(notice) },
		{ items: [], next_cursor: 'x'.repeat(257) }
	])
		assert.throws(() => readAccountNotices(value));
	assert.throws(() =>
		validateAccountResponse({
			kind: 'data',
			data: { section: 'notices', notices: [], more: 'yes' }
		})
	);
});

void test('token and verification routes map to exact methods and reject bodies on reads', () => {
	assert.equal(desktopHttpMethod('/api/v1/users/me/tokens'), 'GET');
	assert.equal(desktopHttpMethod('/api/v1/users/me/tokens', undefined, undefined, true), 'POST');
	assert.equal(desktopHttpMethod(`/api/v1/users/me/tokens/${id}`), 'DELETE');
	assert.equal(desktopHttpMethod(`/api/v1/users/me/tokens/${id}/disable`), 'POST');
	assert.equal(desktopHttpMethod(`/api/v1/users/me/tokens/${id}/enable`), 'POST');
	assert.equal(desktopHttpMethod('/api/v1/auth/email-verification/request'), 'POST');
	assert.equal(desktopHttpMethod('/api/v1/users/me/retention-notices?limit=200'), 'GET');
	assert.throws(() => desktopHttpMethod(`/api/v1/users/me/tokens/${id}/rotate`));
	assert.throws(() => desktopHttpMethod('/api/v1/users/me/tokens/../sessions'));
	assert.throws(() =>
		desktopHttpMethod(`/api/v1/users/me/tokens/${id}`, undefined, undefined, true)
	);
});
