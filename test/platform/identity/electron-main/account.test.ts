import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
	validateAccountIntent,
	validateAccountResponse
} from '../../../../src/prctr/platform/account/common/accountProtocol.js';
import {
	readAccountProfile,
	readAccountSessions,
	readAccountDesktops
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
		acknowledged: { source: '{}', revision: 'before', registryVersion: 1 },
		writable: true
	});
	await rejected;
	assert.equal(commits, 0);
	assert.equal(handlers.size, 0);
});
