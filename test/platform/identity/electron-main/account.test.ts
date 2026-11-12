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
	readAccountTokens,
	readAccountGrantableScopes,
	readAccountHistory,
	readAccountSecurity,
	readRevokedSessionCount,
	accountHistoryQuery
} from '../../../../src/prctr/platform/account/electron-main/accountWire.js';
import { encodeRequest } from '../../../../src/prctr/platform/serverApi/node/requestEncoding.js';
import { operationContract } from '../../../../src/prctr/platform/serverApi/node/serverContract.js';
const historyURL = (query: Parameters<typeof accountHistoryQuery>[0]) =>
	encodeRequest('https://example.test', 'listCurrentUserAuditEvents', {
		query: accountHistoryQuery(query)
	}).url;
const id = 'y'.repeat(26);
void test('account boundary rejects URLs, foreign resources, excessive data and unexpected actions', () => {
	for (const value of [
		{ kind: 'openSecurity', url: 'https://attacker.test' },
		{ kind: 'revokeDesktop', id: '../sessions' },
		{ kind: 'read', section: 'password' },
		{ kind: 'revokeAll' }
	])
		assert.throws(() => validateAccountIntent(value));
	assert.throws(() =>
		encodeRequest('https://example.test', 'revokeDesktopRegistration', {
			path: { desktop_registration_id: '../sessions' }
		})
	);
	assert.equal(operationContract('revokeDesktopRegistration').method, 'DELETE');
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
			created_at: '2025-09-01T08:00:00Z',
			password_hash: 'SECRET',
			profile_picture_url: 'https://untrusted.test/tracker',
			profile_picture_kind: 'custom'
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
			emailVerified: true,
			createdAt: Date.parse('2025-09-01T08:00:00Z'),
			photoKind: 'custom'
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
	const { ServerHttpTransport } =
		await import('../../../../src/prctr/platform/serverApi/node/serverHttpTransport.js');
	const { encodeRequest } =
		await import('../../../../src/prctr/platform/serverApi/node/requestEncoding.js');
	const { decodeResponse } =
		await import('../../../../src/prctr/platform/serverApi/node/responseDecoding.js');
	const etag = `"${'a'.repeat(64)}"`;
	const bytes = Buffer.from('RIFF0000WEBP');
	let count = 0;
	const transport = new ServerHttpTransport(async (input, init) => {
		count++;
		assert.equal(String(input), `https://example.test/api/v1/users/${id}/profile-picture`);
		assert.equal(init?.redirect, 'manual');
		if (init?.method === 'GET')
			return new Response(bytes, { headers: { 'Content-Type': 'image/webp', ETag: etag } });
		assert.equal(init?.method, 'PUT');
		assert.equal(new Headers(init.headers).get('If-Match'), etag);
		assert.deepEqual(init.body, new Uint8Array([1, 2, 3]));
		return new Response(null, { status: 204 });
	});
	const read = encodeRequest('https://example.test', 'getUserProfilePicture', {
		path: { user_id: id }
	});
	const photo = decodeResponse(read.operation, await transport.send(read));
	assert.deepEqual(Buffer.from(photo.value as Uint8Array), bytes);
	assert.equal(photo.headers.etag, etag);
	const upload = encodeRequest('https://example.test', 'uploadUserProfilePicture', {
		path: { user_id: id },
		header: { 'If-Match': etag },
		mediaType: 'image/png',
		body: new Uint8Array([1, 2, 3])
	});
	await transport.send(upload);
	assert.equal(count, 2);
	assert.throws(() =>
		encodeRequest('https://example.test', 'removeUserProfilePicture', {
			path: { user_id: 'me' }
		})
	);
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
			},
			onDidChangeSettings: () => ({ dispose() {} })
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

void test('settings changed elsewhere reach an open authenticated window until it closes', async () => {
	const { bindWindowUserSettings } =
		await import('../../../../src/prctr/platform/settings/electron-main/userSettingsWindow.js');
	type Snapshot =
		import('../../../../src/prctr/platform/settings/common/userSettingsSession.js').UserSettingsSnapshot;
	let latest: Snapshot = { acknowledged: { source: '{}', revision: 'before' }, writable: true };
	let announce: ((revision: string | undefined) => void) | undefined;
	let subscriptions = 0;
	const sent: { revision: string; source: string }[] = [];
	const contents = {
		id: 33,
		mainFrame: {},
		isDestroyed: () => false,
		send: (_channel: string, projection: { revision: string; source: string }) =>
			sent.push({ revision: projection.revision, source: projection.source })
	} as unknown as import('electron/main').WebContents;
	const binding = bindWindowUserSettings(
		{ handle: () => {}, removeHandler: () => {} },
		contents,
		{ principalId: id, sessionId: id },
		{
			readSettings: async () => latest,
			commitSettings: async () => ({ kind: 'unavailable' }),
			onDidChangeSettings: (_binding, listener) => {
				subscriptions++;
				announce = listener;
				return {
					dispose() {
						announce = undefined;
					}
				};
			}
		}
	);
	while (!announce) await new Promise((resolve) => setImmediate(resolve));
	assert.equal(subscriptions, 1);
	latest = {
		acknowledged: { source: '{"editor.fontSize":18}', revision: 'after' },
		writable: true
	};
	announce('after');
	while (sent.length === 0) await new Promise((resolve) => setImmediate(resolve));
	assert.deepEqual(sent, [{ revision: 'after', source: '{"editor.fontSize":18}' }]);
	binding.dispose();
	assert.equal(announce, undefined);
});

void test('token, verification and notice intents are exact and bounded', () => {
	const create = {
		kind: 'createToken',
		description: 'Registrar tool',
		scopes: ['exam.view'],
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
		{ ...create, scopes: ['exam.view', 'exam.view'] },
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
		scopes: ['exam.view'],
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
				scopes: ['exam.view'],
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
	assert.throws(() => readAccountTokens({ items: [{ ...raw, scopes: 'exam.view' }] }, binding));
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
		exam_title: 'Algorithms final',
		exam_sitting_id: id,
		sitting_start_at: '2025-12-20T09:00:00Z',
		sitting_end_at: '2025-12-20T12:00:00Z',
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
				examTitle: 'Algorithms final',
				examSittingId: id,
				sittingStartAt: Date.parse('2025-12-20T09:00:00Z'),
				sittingEndAt: Date.parse('2025-12-20T12:00:00Z'),
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

void test('token and verification operations have exact methods and refuse bodies on reads', () => {
	const method = (operation: Parameters<typeof operationContract>[0]) =>
		operationContract(operation).method;
	assert.equal(method('listPersonalAccessTokens'), 'GET');
	assert.equal(method('createPersonalAccessToken'), 'POST');
	assert.equal(method('revokePersonalAccessToken'), 'DELETE');
	assert.equal(method('disablePersonalAccessToken'), 'POST');
	assert.equal(method('enablePersonalAccessToken'), 'POST');
	assert.equal(method('requestEmailVerification'), 'POST');
	assert.equal(method('listRetentionNotices'), 'GET');
	assert.equal(method('listGrantablePersonalAccessTokenScopes'), 'GET');
	assert.throws(() =>
		encodeRequest('https://example.test', 'listPersonalAccessTokens', { body: {} } as never)
	);
	assert.throws(() =>
		encodeRequest('https://example.test', 'revokePersonalAccessToken', {
			path: { personal_access_token_id: '..' }
		})
	);
});

void test('sessions trust the server current mark only when it is this window’s session', () => {
	const other = 'b'.repeat(26);
	const session = (sid: string, current: boolean) => ({
		id: sid,
		user_id: id,
		current,
		client_type: 'web',
		authentication_method: 'password',
		authentication_strength: 'single_factor',
		created_at: '2026-01-01T00:00:00Z',
		last_activity_at: '2026-01-02T00:00:00Z',
		expires_at: '2026-02-01T00:00:00Z'
	});
	const data = readAccountSessions(
		{ items: [session(id, true), session(other, false)] },
		{ principalId: id, sessionId: id }
	);
	assert.ok(
		data.section === 'sessions' && data.sessions[0]!.current && !data.sessions[1]!.current
	);
	assert.throws(() =>
		readAccountSessions({ items: [session(other, true)] }, { principalId: id, sessionId: id })
	);
	assert.throws(() =>
		readAccountSessions({ items: [session(id, false)] }, { principalId: id, sessionId: id })
	);
	assert.deepEqual(readRevokedSessionCount({ revoked_session_count: 2 }), {
		kind: 'sessionsEnded',
		count: 2
	});
	// A Desktop Session carries the registration that names it and how it was verified.
	const registration = 'r'.repeat(26);
	const desktop = readAccountSessions(
		{
			items: [
				{
					...session(id, true),
					client_type: 'desktop',
					desktop_platform: 'darwin',
					device_name: 'ignored for a Desktop',
					authentication_strength: 'multi_factor',
					mfa_completed_at: '2026-01-01T00:05:00Z',
					desktop_registration_id: registration,
					desktop_registration_display_name: 'Amara’s MacBook Pro',
					device_id: 'secret-device',
					desktop_build_id: 'build'
				}
			]
		},
		{ principalId: id, sessionId: id }
	);
	assert.deepEqual(desktop, {
		section: 'sessions',
		sessions: [
			{
				id,
				current: true,
				name: 'ignored for a Desktop',
				client: 'desktop',
				platform: 'darwin',
				method: 'password',
				authenticationStrength: 'multi_factor',
				mfaCompletedAt: Date.parse('2026-01-01T00:05:00Z'),
				desktopRegistrationId: registration,
				desktopRegistrationName: 'Amara’s MacBook Pro',
				createdAt: Date.parse('2026-01-01T00:00:00Z'),
				lastActivityAt: Date.parse('2026-01-02T00:00:00Z'),
				expiresAt: Date.parse('2026-02-01T00:00:00Z')
			}
		]
	});
	assert.ok(!JSON.stringify(desktop).includes('secret-device'));
	assert.throws(() =>
		readAccountSessions(
			{ items: [{ ...session(id, true), desktop_registration_id: '../x' }] },
			{ principalId: id, sessionId: id }
		)
	);
	assert.throws(() =>
		readAccountSessions(
			{ items: [{ ...session(id, true), authentication_strength: undefined }] },
			{ principalId: id, sessionId: id }
		)
	);
	assert.throws(() => readRevokedSessionCount({ revoked_session_count: -1 }));
	assert.throws(() => readRevokedSessionCount({ revoked_session_count: 1, extra: true }));
	assert.equal(operationContract('revokeOtherCurrentUserSessions').method, 'POST');
});

void test('two-step status maps method, dates and the issued recovery-code set', () => {
	const data = readAccountSecurity(
		{ password: true, providers: [] },
		{
			service_enabled: true,
			enabled: true,
			pending: false,
			mfa_recovery_required: false,
			recovery_codes_remaining: 7,
			recovery_codes_total: 10,
			recovery_codes_generated_at: '2026-01-01T00:00:00Z',
			method: 'authenticator_app',
			enabled_at: '2025-12-01T00:00:00Z',
			password_changed_at: '2025-11-01T00:00:00Z',
			authentication_method: 'password'
		}
	);
	assert.deepEqual(data.section === 'security' && data.security.mfa, {
		available: true,
		enabled: true,
		pending: false,
		recoveryRequired: false,
		recoveryCodesRemaining: 7,
		recoveryCodesTotal: 10,
		recoveryCodesGeneratedAt: Date.parse('2026-01-01T00:00:00Z'),
		enabledAt: Date.parse('2025-12-01T00:00:00Z'),
		passwordChangedAt: Date.parse('2025-11-01T00:00:00Z'),
		method: 'authenticatorApp'
	});
	assert.throws(() =>
		readAccountSecurity(
			{ password: true, providers: [] },
			{
				service_enabled: true,
				enabled: true,
				pending: false,
				mfa_recovery_required: false,
				recovery_codes_remaining: 7,
				recovery_codes_total: 10,
				method: 'sms'
			}
		)
	);
});

void test('grantable scopes are bounded and refer only to listed Academic Units', () => {
	const unit = 'u'.repeat(26);
	const raw = {
		scopes: [
			{
				name: 'exam.view',
				title: 'View exams',
				description: 'See exams.',
				resource_types: ['exam'],
				institution_wide: false,
				academic_unit_ids: [unit]
			}
		],
		academic_units: [{ id: unit, display_name: 'Computer Science' }],
		academic_units_has_more: true
	};
	assert.deepEqual(readAccountGrantableScopes(raw), {
		section: 'grantableScopes',
		grantable: {
			scopes: [
				{
					name: 'exam.view',
					title: 'View exams',
					description: 'See exams.',
					institutionWide: false,
					academicUnitIds: [unit]
				}
			],
			academicUnits: [{ id: unit, name: 'Computer Science' }],
			moreAcademicUnits: true
		}
	});
	assert.throws(() =>
		readAccountGrantableScopes({
			...raw,
			scopes: [{ ...raw.scopes[0], academic_unit_ids: ['v'.repeat(26)] }]
		})
	);
	assert.throws(() =>
		readAccountGrantableScopes({ ...raw, scopes: [raw.scopes[0], raw.scopes[0]] })
	);
	assert.throws(() =>
		readAccountGrantableScopes({ ...raw, scopes: [{ ...raw.scopes[0], name: 'Exam View' }] })
	);
});

void test('history queries use the server filter names and parse a minimized page', () => {
	assert.equal(historyURL({}), 'https://example.test/api/v1/users/me/audits?limit=10');
	assert.equal(
		historyURL({
			createdAfter: Date.parse('2026-01-01T00:00:00Z'),
			createdBefore: Date.parse('2026-02-01T00:00:00Z'),
			events: ['sign_in.failed', 'sign_out'],
			status: 'fail',
			relation: 'subject',
			cursor: 'opaque/+='
		}),
		'https://example.test/api/v1/users/me/audits?limit=10&cursor=opaque%2F%2B%3D&created_after=2026-01-01T00%3A00%3A00.000Z&created_before=2026-02-01T00%3A00%3A00.000Z&event=sign_in.failed&event=sign_out&status=fail&relation=subject'
	);
	// The last page is read oldest first with exactly what is left over.
	assert.equal(
		historyURL({ order: 'asc', limit: 4 }),
		'https://example.test/api/v1/users/me/audits?limit=4&order=asc'
	);
	for (const intent of [
		{ kind: 'readHistory', events: ['made.up'] },
		{ kind: 'readHistory', events: [] },
		{ kind: 'readHistory', status: 'maybe' },
		{ kind: 'readHistory', createdAfter: 10, createdBefore: 10 },
		{ kind: 'readHistory', cursor: 'has space' },
		{ kind: 'readHistory', order: 'sideways' },
		{ kind: 'readHistory', limit: 0 },
		{ kind: 'readHistory', limit: 51 },
		{ kind: 'readHistory', limit: 2.5 },
		{ kind: 'readHistory', url: 'https://attacker.test' }
	])
		assert.throws(() => validateAccountIntent(intent));
	const entry = {
		id,
		created_at: '2026-01-01T00:00:00Z',
		event: 'sign_in.failed',
		status: 'fail',
		relation: 'subject',
		actor: { kind: 'self' },
		resource: { type: 'user', id },
		error_code: 'authentication.invalid_credentials',
		summary: 'Sign-in failed: wrong password.',
		client_type: 'web',
		ip_address: '81.2.69.160'
	};
	assert.deepEqual(readAccountHistory({ items: [entry], next_cursor: 'next' }), {
		section: 'history',
		entries: [
			{
				id,
				createdAt: Date.parse('2026-01-01T00:00:00Z'),
				event: 'sign_in.failed',
				failed: true,
				relation: 'subject',
				actor: 'self',
				summary: 'Sign-in failed: wrong password.',
				client: 'web',
				ipAddress: '81.2.69.160'
			}
		],
		cursor: 'next'
	});
	assert.deepEqual(
		readAccountHistory({ items: [entry], total: 10000, total_is_lower_bound: true }),
		{
			section: 'history',
			entries: [
				{
					id,
					createdAt: Date.parse('2026-01-01T00:00:00Z'),
					event: 'sign_in.failed',
					failed: true,
					relation: 'subject',
					actor: 'self',
					summary: 'Sign-in failed: wrong password.',
					client: 'web',
					ipAddress: '81.2.69.160'
				}
			],
			total: 10000,
			totalIsLowerBound: true
		}
	);
	assert.throws(() => readAccountHistory({ items: [entry], total: -1 }));
	for (const intent of [{ kind: 'reauthenticate' }, { kind: 'cancelReauthentication' }])
		assert.deepEqual(validateAccountIntent(intent), intent);
	assert.throws(() => validateAccountIntent({ kind: 'reauthenticate', url: 'https://x.test' }));
	const future = readAccountHistory({ items: [{ ...entry, event: 'passkey.added' }] });
	assert.ok(future.section === 'history' && future.entries[0]!.event === 'passkey.added');
	assert.throws(() => readAccountHistory({ items: [{ ...entry, status: 'partial' }] }));
	assert.throws(() => readAccountHistory({ items: [{ ...entry, actor: { kind: 'person' } }] }));
	assert.throws(() => readAccountHistory({ items: [entry, entry] }));
	assert.throws(() => readAccountHistory({ items: [{ ...entry, summary: undefined }] }));
	assert.throws(() => readAccountHistory({ items: [{ ...entry, summary: 'x'.repeat(2049) }] }));
});

void test('a Session or desktop rename is exact, and a Desktop Session names its registration', async () => {
	const { AccountService } =
		await import('../../../../src/prctr/platform/account/electron-main/accountService.js');
	const { SessionApi } =
		await import('../../../../src/prctr/platform/serverApi/node/sessionApi.js');
	const registration = 'r'.repeat(26);
	const other = 'b'.repeat(26);
	for (const value of [
		{ kind: 'renameSession', id: other },
		{ kind: 'renameSession', id: other, name: '' },
		{ kind: 'renameSession', id: other, name: '   ' },
		{ kind: 'renameSession', id: other, name: 'x'.repeat(129) },
		{ kind: 'renameSession', id: other, name: 'Lab\u0007PC' },
		{ kind: 'renameDesktop', id: '../sessions', name: 'Lab PC' },
		{ kind: 'renameDesktop', id: registration, name: 'Lab PC', url: 'https://x.test' }
	])
		assert.throws(() => validateAccountIntent(value), JSON.stringify(value));
	assert.deepEqual(validateAccountIntent({ kind: 'renameDesktop', id, name: 'Lab PC' }), {
		kind: 'renameDesktop',
		id,
		name: 'Lab PC'
	});
	const json = (value: unknown, status = 200) => ({
		status,
		headers: { 'content-type': 'application/json' },
		bytes: new TextEncoder().encode(JSON.stringify(value))
	});
	const problem = (code: string, fields?: Record<string, string>) =>
		json({ type: 'about:blank', title: 'Refused', status: 409, code, fields }, 409);
	const at = '2026-01-01T00:00:00Z';
	const renamedSession = json({
		id: other,
		user_id: id,
		current: false,
		client_type: 'web',
		authentication_method: 'password',
		authentication_strength: 'single_factor',
		mfa_recovery_required: false,
		mfa_enrollment_required: false,
		device_name: 'Lab PC',
		authenticated_at: at,
		created_at: at,
		updated_at: at,
		last_activity_at: at,
		idle_expires_at: at,
		expires_at: at
	});
	const renamedDesktop = json({
		id: registration,
		display_name: 'Lab PC',
		desktop_release: '1.0.0',
		desktop_build_id: 'build',
		platform: 'darwin',
		architecture: 'arm64',
		realtime_protocol: 1,
		created_at: at,
		last_used_at: at,
		status: 'active',
		current: true
	});
	const requests: { method: string; url: string; body: unknown }[] = [];
	const answers: unknown[] = [];
	const binding = { principalId: id, sessionId: id };
	const api = new SessionApi({
		binding,
		origin: 'https://example.edu',
		execute: async (request) => {
			requests.push({
				method: request.method,
				url: new URL(request.url).pathname,
				body: JSON.parse(String(request.body))
			});
			return answers.shift() as never;
		}
	});
	const service = new AccountService({
		apiForSession: () => api,
		currentRegistration: () => registration
	} as never);
	try {
		answers.push(renamedSession);
		assert.deepEqual(
			await service.account(binding, { kind: 'renameSession', id: other, name: 'Lab PC' }),
			{ kind: 'success' }
		);
		answers.push(
			problem('session.desktop_named_by_registration', {
				desktop_registration_id: registration
			})
		);
		assert.deepEqual(
			await service.account(binding, { kind: 'renameSession', id, name: 'Lab PC' }),
			{ kind: 'namedByDesktop', desktopRegistrationId: registration }
		);
		answers.push(problem('session.desktop_named_by_registration', {}));
		assert.deepEqual(
			await service.account(binding, { kind: 'renameSession', id, name: 'Lab PC' }),
			{ kind: 'error', reason: 'conflict' }
		);
		answers.push(renamedDesktop);
		assert.deepEqual(
			await service.account(binding, {
				kind: 'renameDesktop',
				id: registration,
				name: 'Lab PC'
			}),
			{ kind: 'success' }
		);
		answers.push(problem('desktop_registration.revoked'));
		assert.deepEqual(
			await service.account(binding, {
				kind: 'renameDesktop',
				id: registration,
				name: 'Lab PC'
			}),
			{ kind: 'error', reason: 'conflict' }
		);
		assert.deepEqual(requests.slice(0, 2), [
			{
				method: 'PATCH',
				url: `/api/v1/users/me/sessions/${other}`,
				body: { device_name: 'Lab PC' }
			},
			{
				method: 'PATCH',
				url: `/api/v1/users/me/sessions/${id}`,
				body: { device_name: 'Lab PC' }
			}
		]);
		assert.deepEqual(requests[3], {
			method: 'PATCH',
			url: `/api/v1/users/me/desktop-registrations/${registration}`,
			body: { display_name: 'Lab PC' }
		});
	} finally {
		api.dispose();
	}
});

void test('Sessions and registered desktops refresh on the server event that covers both', async () => {
	const { AccountService } =
		await import('../../../../src/prctr/platform/account/electron-main/accountService.js');
	const subscriptions: string[] = [];
	const polls: number[] = [];
	const refreshed: unknown[] = [];
	const api = {
		reads: {
			observe: (
				_k: unknown,
				_r: unknown,
				_l: unknown,
				options: { pollIntervalMs: number }
			) => {
				polls.push(options.pollIntervalMs);
				return { dispose() {} };
			},
			refresh: (key: unknown) => void refreshed.push(key)
		},
		events: {
			on: (name: string, _scope: undefined, listener: () => void) => {
				subscriptions.push(name);
				listener();
				return { accepted: Promise.resolve(true), dispose() {} };
			}
		}
	};
	const service = new AccountService({
		apiForSession: () => api as never,
		currentRegistration: () => id,
		signOut: async () => {},
		endRevokedDesktop: async () => {},
		reauthenticate: async () => 'success',
		cancelReauthentication: () => {}
	} as never);
	const binding = { principalId: id, sessionId: id };
	for (const section of ['sessions', 'desktops', 'profile', 'security'] as const)
		service.observeAccount(binding, { kind: 'read', section }, () => {}).dispose();
	assert.deepEqual(subscriptions, [
		'current_user.sessions.changed',
		'current_user.sessions.changed',
		'user_profile_picture_changed'
	]);
	assert.deepEqual(polls, [300_000, 300_000, 300_000, 60_000]);
	assert.equal(refreshed.length, 3);
});
