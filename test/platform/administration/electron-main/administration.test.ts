/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { IpcMainInvokeEvent } from 'electron/main';
import {
	administrationChanges,
	administrationReads,
	validateAdministrationIntent,
	validateAdministrationResponse,
	type AdministrationIntent
} from '../../../../src/prctr/platform/administration/common/administrationProtocol.js';
import {
	AdministrationService,
	administrationOperationOf,
	administrationOperations,
	guardAdministrationApi,
	requiresIdempotencyKey,
	type AdministrationSessionPort
} from '../../../../src/prctr/platform/administration/electron-main/administrationService.js';
import { AdministrationIpcBridge } from '../../../../src/prctr/platform/administration/electron-main/administrationIpc.js';
import {
	ServerApiError,
	type ApiOperationId
} from '../../../../src/prctr/platform/serverApi/common/serverApi.js';
import { operationContract } from '../../../../src/prctr/platform/serverApi/node/serverContract.js';
import type { EncodedApiRequest } from '../../../../src/prctr/platform/serverApi/node/requestEncoding.js';
import { SessionApi } from '../../../../src/prctr/platform/serverApi/node/sessionApi.js';
import type { HttpResponse } from '../../../../src/prctr/platform/serverApi/node/serverHttpTransport.js';

const id = 'y'.repeat(26);
const other = 'b'.repeat(26);
const binding = Object.freeze({ principalId: id, sessionId: other });
const origin = 'https://example.edu';
const at = '2026-01-01T00:00:00Z';

function json(value: unknown, status = 200): HttpResponse {
	return {
		status,
		headers: { 'content-type': 'application/json' },
		bytes: new TextEncoder().encode(JSON.stringify(value))
	};
}
function problem(status: number, code: string, fields?: Record<string, string>): HttpResponse {
	return json(
		{
			type: 'about:blank',
			title: 'Refused',
			status,
			code,
			...(fields ? { fields } : {})
		},
		status
	);
}
function userDto(overrides: Record<string, unknown> = {}) {
	return {
		id,
		username: 'ada',
		display_name: 'Ada\u0007 Lovelace',
		first_name: 'Ada',
		last_name: 'Lovelace',
		email: 'ada@example.edu',
		email_verified: true,
		created_at: at,
		updated_at: at,
		profile_picture_kind: 'custom',
		profile_picture_url: 'https://tracker.example/pixel',
		...overrides
	};
}
const retentionPolicyDto = {
	revision: 3,
	audit_retention_days: 365,
	browser_activity_retention_days: 30,
	deletion_grace_days: 7,
	export_retention_days: 7,
	integrity_retention_days: 365,
	security_operational_retention_days: 90,
	submission_retention_days: 365,
	candidate_notices: true,
	automatic_deletion_enabled: false,
	created_at: at,
	updated_at: at
};

interface Harness {
	readonly service: AdministrationService;
	readonly requests: EncodedApiRequest[];
	readonly dispose: () => void;
}
function harness(
	answer: (request: EncodedApiRequest, index: number) => HttpResponse | Promise<HttpResponse>,
	port: Partial<AdministrationSessionPort> = {}
): Harness {
	const requests: EncodedApiRequest[] = [];
	const api = new SessionApi({
		binding,
		origin: origin,
		execute: async (request) => {
			requests.push(request);
			return answer(request, requests.length - 1);
		}
	});
	const service = new AdministrationService({
		apiForSession(value) {
			if (value.principalId !== binding.principalId || value.sessionId !== binding.sessionId)
				throw new ServerApiError('sessionEnded');
			return api;
		},
		institutionId: () => id,
		async reauthenticate() {
			return 'success';
		},
		cancelReauthentication() {},
		...port
	});
	return {
		service,
		requests,
		dispose: () => {
			service.dispose();
			api.dispose();
		}
	};
}
const path = (request: EncodedApiRequest) => {
	const url = new URL(request.url);
	return `${request.method} ${url.pathname}${url.search}`;
};

void test('administration boundary accepts only exact, bounded intents and freezes them', () => {
	for (const value of [
		{ kind: 'users', limit: 10, url: 'https://attacker.test' },
		{ kind: 'users' },
		{ kind: 'users', limit: 11 },
		{ kind: 'users', limit: 0 },
		{ kind: 'user', id: '../sessions' },
		{ kind: 'searchUsers', limit: 10 },
		{ kind: 'operation', operationId: 'replaceCurrentUserSettings' },
		{ kind: 'jobs', limit: 10, status: ['queued', 'queued', 'unknown'] },
		{ kind: 'disableUser', id, note: 'extra' },
		{ kind: 'createAffiliation', userId: id, affiliation: 'student', startAt: 10, endAt: 10 },
		{
			kind: 'resetUserMfa',
			userId: id,
			identityVerified: false,
			reason: 'Lost phone',
			verificationReference: 'Desk 4'
		},
		{ kind: 'createRootUnit', name: '   ', displayName: 'Science' },
		{ kind: 'createRootUnit', name: 'sci\u0000', displayName: 'Science' },
		{
			kind: 'uploadImport',
			mode: 'institution',
			scopeType: 'institution',
			scopeId: id,
			csv: new Uint8Array(10 * 1024 * 1024 + 1)
		},
		{ kind: 'startMfaRekey', retiringKeyId: 'not-hex' },
		{ kind: 'reauthenticate', binding }
	])
		assert.throws(
			() => validateAdministrationIntent(value),
			JSON.stringify(value).slice(0, 80)
		);
	const csv = new Uint8Array([97, 44, 98]);
	const intent = validateAdministrationIntent({
		kind: 'uploadImport',
		mode: 'institution',
		scopeType: 'institution',
		scopeId: id,
		csv
	});
	csv[0] = 0;
	assert.equal((intent as { csv: Uint8Array }).csv[0], 97);
	assert.ok(Object.isFrozen(intent));
	assert.deepEqual(validateAdministrationIntent({ kind: 'users', limit: 10, q: undefined }), {
		kind: 'users',
		limit: 10
	});
	// Read and change kinds never overlap, so every intent is one or the other.
	for (const kind of Object.keys(administrationReads))
		assert.ok(!Object.hasOwn(administrationChanges, kind), kind);
});

void test('administration replies are closed shapes with at most one page of items', () => {
	const item = { id, kind: 'student', startAt: 1 };
	assert.ok(
		validateAdministrationResponse({
			kind: 'data',
			data: { resource: 'affiliations', value: { items: [item] } }
		})
	);
	for (const value of [
		{ kind: 'data', data: { resource: 'operation', value: {} } },
		{ kind: 'data', data: { resource: 'affiliations', value: { items: [item], count: 1 } } },
		{
			kind: 'data',
			data: { resource: 'affiliations', value: { items: Array(11).fill(item) } }
		},
		{ kind: 'data', data: { resource: 'affiliations', value: { items: [item, item] } } },
		{
			kind: 'data',
			data: { resource: 'affiliations', value: { items: [{ ...item, secret: 'x' }] } }
		},
		{ kind: 'error', reason: 'stack trace' },
		{ kind: 'error', reason: 'invalid', fields: ['email address<script>'] },
		{ kind: 'created', id: 'not-an-id' },
		{ kind: 'success', detail: 'extra' }
	])
		assert.throws(() => validateAdministrationResponse(value));
});

void test('only allow-listed operations can be sent, and every route is on the list', async () => {
	let calls = 0;
	const guarded = guardAdministrationApi({
		request: (async () => {
			calls++;
			throw new Error('reached');
		}) as SessionApi['request']
	});
	for (const operation of [
		'replaceCurrentUserSettings',
		'connectWebSocket',
		'createPersonalAccessToken',
		'refreshSession'
	] as ApiOperationId[])
		await assert.rejects(
			guarded.request(operation, {} as never),
			(error: unknown) => error instanceof ServerApiError && error.kind === 'invalidRequest'
		);
	assert.equal(calls, 0);
	for (const kind of [
		...Object.keys(administrationReads),
		...Object.keys(administrationChanges)
	]) {
		if (kind === 'reauthenticate' || kind === 'cancelReauthentication') continue;
		const operation = administrationOperationOf(kind as never);
		assert.ok(administrationOperations.has(operation), `${kind} → ${operation}`);
	}
	for (const operation of administrationOperations) {
		const declared = operationContract(operation);
		assert.notEqual(declared.auth, 'public', operation);
		assert.ok(!declared.path.startsWith('/api/v1/users/me'), operation);
	}
});

void test('reads are whitelist projections bound to one page and one cached query', async () => {
	const h = harness((request) => {
		assert.equal(
			path(request),
			'GET /api/v1/users?q=ada&include_disabled=true&limit=10&cursor=next'
		);
		return json({
			items: [userDto({ last_login_at: at, archived_at: at })],
			next_cursor: 'after'
		});
	});
	try {
		const intent: AdministrationIntent = {
			kind: 'users',
			q: 'ada',
			includeDisabled: true,
			limit: 10,
			cursor: 'next'
		};
		const response = await h.service.administration(binding, intent);
		assert.deepEqual(response, {
			kind: 'data',
			data: {
				resource: 'users',
				value: {
					items: [
						{
							id,
							username: 'ada',
							displayName: 'Ada  Lovelace',
							firstName: 'Ada',
							lastName: 'Lovelace',
							email: 'ada@example.edu',
							emailVerified: true,
							photoKind: 'custom',
							createdAt: Date.parse(at),
							lastLoginAt: Date.parse(at)
						}
					],
					cursor: 'after'
				}
			}
		});
		assert.ok(!JSON.stringify(response).includes('tracker'));
		assert.deepEqual(await h.service.administration(binding, intent), response);
		assert.equal(h.requests.length, 1);
		assert.deepEqual(
			await h.service.administration({ principalId: other, sessionId: other }, intent),
			{ kind: 'error', reason: 'sessionEnded' }
		);
	} finally {
		h.dispose();
	}
});

void test('the directory carries summaries and totals, and counts leave out what is hidden', async () => {
	const unit = 'u'.repeat(26);
	const h = harness((request) => {
		const route = path(request);
		if (route.startsWith('GET /api/v1/users?'))
			return json({
				items: [
					userDto({
						summary: {
							affiliations: [
								{
									kind: 'student',
									academic_units: [{ id: unit, name: 'Computer Science' }],
									academic_units_more: 2
								}
							],
							affiliations_more: 0,
							roles: [
								{
									role_id: unit,
									display_name: 'Teacher',
									scope_type: 'academic_unit',
									scope_id: unit,
									scope_name: 'Computer Science'
								}
							],
							roles_more: 1
						}
					})
				],
				total: 10000,
				total_is_lower_bound: true
			});
		if (route === 'GET /api/v1/administration/counts')
			return json({ failed_jobs: 2, failed_jobs_is_lower_bound: false });
		throw new Error(`Unexpected ${route}`);
	});
	try {
		const users = await h.service.administration(binding, {
			kind: 'users',
			affiliation: ['student', 'staff'],
			academicUnitId: unit,
			limit: 10
		});
		assert.equal(
			path(h.requests[0]!),
			`GET /api/v1/users?affiliation=student&affiliation=staff&academic_unit_id=${unit}&limit=10`
		);
		assert.ok(users.kind === 'data' && users.data.resource === 'users');
		assert.equal(users.data.value.total, 10000);
		assert.equal(users.data.value.totalAtLeast, true);
		assert.deepEqual(users.data.value.items[0]!.summary, {
			affiliations: [
				{
					kind: 'student',
					units: [{ id: unit, name: 'Computer Science' }],
					unitsMore: 2
				}
			],
			affiliationsMore: 0,
			roles: [
				{
					roleId: unit,
					displayName: 'Teacher',
					scopeType: 'academic_unit',
					scopeName: 'Computer Science'
				}
			],
			rolesMore: 1
		});
		assert.deepEqual(await h.service.administration(binding, { kind: 'counts' }), {
			kind: 'data',
			data: { resource: 'counts', value: { failedJobs: { count: 2, atLeast: false } } }
		});
	} finally {
		h.dispose();
	}
});

void test('a disable sends its reason, and academic batches carry a key and per-item results', async () => {
	const h = harness((request) => {
		const route = path(request);
		if (route === `POST /api/v1/users/${id}/disable`) return json(userDto({ disabled_at: at }));
		if (route === 'POST /api/v1/academic-administration-batches')
			return json({
				operation: 'class.enroll',
				succeeded: 1,
				failed: 1,
				no_op: 0,
				items: [
					{ index: 0, status: 'succeeded', resource_id: other },
					{
						index: 1,
						status: 'failed',
						error_code: 'class_member.student_affiliation_required'
					}
				]
			});
		throw new Error(`Unexpected ${route}`);
	});
	try {
		assert.deepEqual(
			await h.service.administration(binding, {
				kind: 'disableUser',
				id,
				reason: 'Left the programme.'
			}),
			{ kind: 'success' }
		);
		assert.deepEqual(JSON.parse(String(h.requests[0]!.body)), {
			reason: 'Left the programme.'
		});
		assert.throws(() =>
			validateAdministrationIntent({ kind: 'disableUser', id, reason: 'x'.repeat(501) })
		);
		const result = await h.service.administration(binding, {
			kind: 'runAcademicBatch',
			operation: 'class.enroll',
			scopeType: 'class',
			scopeId: other,
			items: [
				{ key: 'a', userId: id },
				{ key: 'b', userId: other }
			]
		});
		assert.match(h.requests[1]!.headers?.['Idempotency-Key'] ?? '', /^[A-Za-z0-9_-]{43}$/u);
		assert.deepEqual(result, {
			kind: 'batchResult',
			result: {
				operation: 'class.enroll',
				succeeded: 1,
				failed: 1,
				noOp: 0,
				items: [
					{ index: 0, status: 'succeeded', resourceId: other },
					{
						index: 1,
						status: 'failed',
						errorCode: 'class_member.student_affiliation_required'
					}
				]
			}
		});
	} finally {
		h.dispose();
	}
});

void test('the access policy sends the two-step rule and session lengths, null keeping a default', async () => {
	const h = harness((request) => {
		assert.equal(path(request), 'POST /api/v1/access-policy/preflight');
		return json({
			blockers: [{ code: 'mfa_unavailable' }],
			role_holders_without_mfa_count: 14,
			role_holder_single_factor_session_count: 41
		});
	});
	try {
		const result = await h.service.administration(binding, {
			kind: 'preflightAccessPolicy',
			expectedRevision: 3,
			localLogin: true,
			publicRegistration: false,
			invitationAdmission: true,
			invitationLocalCredential: true,
			desktopAuthorization: true,
			providerAdmissions: [],
			roleHolderMfaRequired: true,
			sessionIdleMinutes: 720,
			revokeExistingSessions: false
		});
		const sent = JSON.parse(String(h.requests[0]!.body)) as Record<string, unknown>;
		assert.equal(sent.role_holder_mfa_required, true);
		assert.equal(sent.session_idle_minutes, 720);
		assert.equal(sent.session_absolute_minutes, null);
		assert.deepEqual(result, {
			kind: 'data',
			data: {
				resource: 'accessPolicyPreflight',
				value: {
					blockers: [{ code: 'mfa_unavailable' }],
					roleHoldersWithoutMfa: 14,
					singleFactorSessions: 41
				}
			}
		});
	} finally {
		h.dispose();
	}
});

void test('changes that the contract deduplicates send a fresh key and reuse it on the retry', async () => {
	let failFirst = true;
	const h = harness((request) => {
		if (request.method === 'PUT') {
			if (failFirst) {
				failFirst = false;
				return problem(503, 'service.unavailable');
			}
			return json(retentionPolicyDto);
		}
		if (path(request) === `POST /api/v1/users/${id}/disable`) return problem(503, 'down');
		throw new Error(`Unexpected ${path(request)}`);
	});
	try {
		assert.ok(requiresIdempotencyKey('replaceRetentionPolicy'));
		assert.ok(!requiresIdempotencyKey('disableUser'));
		const change: AdministrationIntent = {
			kind: 'replaceRetentionPolicy',
			expectedRevision: 3,
			auditDays: 365,
			browserActivityDays: 30,
			deletionGraceDays: 7,
			exportDays: 7,
			integrityDays: 365,
			securityOperationalDays: 90,
			submissionDays: 365,
			candidateNotices: true
		};
		assert.deepEqual(await h.service.administration(binding, change), { kind: 'success' });
		assert.equal(h.requests.length, 2);
		const [first, retry] = h.requests.map((request) => request.headers?.['Idempotency-Key']);
		assert.match(first!, /^[A-Za-z0-9_-]{43}$/u);
		assert.equal(retry, first);
		assert.deepEqual(JSON.parse(String(h.requests[0]!.body)), {
			expected_revision: 3,
			audit_retention_days: 365,
			browser_activity_retention_days: 30,
			deletion_grace_days: 7,
			export_retention_days: 7,
			integrity_retention_days: 365,
			security_operational_retention_days: 90,
			submission_retention_days: 365,
			candidate_notices: true
		});
		failFirst = true;
		await h.service.administration(binding, change);
		assert.notEqual(h.requests[2]!.headers?.['Idempotency-Key'], first);
		// A change the server does not deduplicate is never resent and has no key.
		const before = h.requests.length;
		assert.deepEqual(await h.service.administration(binding, { kind: 'disableUser', id }), {
			kind: 'error',
			reason: 'unconfirmed'
		});
		assert.equal(h.requests.length, before + 1);
		assert.equal(h.requests.at(-1)!.headers?.['Idempotency-Key'], undefined);
	} finally {
		h.dispose();
	}
});

void test('server refusals become closed reasons, and a rejected credential ends the session', async () => {
	const answers = new Map<string, HttpResponse>([
		['GET /api/v1/roles?limit=10', problem(403, 'authorization.denied')],
		['GET /api/v1/jobs?limit=10', problem(404, 'resource.not_found')],
		[`GET /api/v1/users/${id}`, problem(404, 'resource.not_found')],
		[`POST /api/v1/users/${id}/mfa/reset`, problem(403, 'authentication.strong_required')],
		[`PUT /api/v1/users/${id}/email`, problem(403, 'authentication.reauthentication_required')],
		[`POST /api/v1/invitations/${id}/revoke`, problem(409, 'invitation.conflict')],
		[
			`POST /api/v1/academic-units`,
			problem(400, 'request.invalid', { name: 'Taken', 'display name!': 'x' })
		],
		[`POST /api/v1/jobs/${id}/retry`, problem(500, 'internal')],
		['GET /api/v1/institution', problem(500, 'internal')],
		[`POST /api/v1/users/${id}/enable`, problem(401, 'authentication.invalid_token')]
	]);
	const h = harness((request) => {
		const answer = answers.get(path(request));
		if (!answer) throw new Error(`Unexpected ${path(request)}`);
		return answer;
	});
	try {
		const expect = async (intent: AdministrationIntent, expected: unknown) =>
			assert.deepEqual(
				await h.service.administration(binding, intent),
				expected,
				intent.kind
			);
		await expect({ kind: 'roles', limit: 10 }, { kind: 'error', reason: 'noAccess' });
		await expect({ kind: 'jobs', limit: 10 }, { kind: 'error', reason: 'noAccess' });
		await expect({ kind: 'user', id }, { kind: 'error', reason: 'notFound' });
		await expect(
			{
				kind: 'resetUserMfa',
				userId: id,
				identityVerified: true,
				reason: 'Lost phone',
				verificationReference: 'Desk 4'
			},
			{ kind: 'error', reason: 'strongRequired' }
		);
		await expect(
			{ kind: 'changeUserEmail', userId: id, email: 'ada@example.edu' },
			{ kind: 'error', reason: 'reauthenticationRequired' }
		);
		await expect(
			{ kind: 'revokeInvitation', id, expectedRevision: 2 },
			{ kind: 'error', reason: 'conflict' }
		);
		await expect(
			{ kind: 'createRootUnit', name: 'sci', displayName: 'Science' },
			{ kind: 'error', reason: 'invalid', fields: ['name'] }
		);
		await expect({ kind: 'retryJob', id }, { kind: 'error', reason: 'unconfirmed' });
		await expect({ kind: 'institution' }, { kind: 'error', reason: 'unavailable' });
		await expect({ kind: 'enableUser', id }, { kind: 'error', reason: 'sessionEnded' });
	} finally {
		h.dispose();
	}
});

void test('one change runs at a time, confirmation maps to closed reasons, and disposal ends it', async () => {
	let release: (() => void) | undefined;
	let cancelled = 0;
	let outcome: 'success' | 'strongAuthenticationRequired' | 'cancelled' = 'success';
	const h = harness(
		async () => {
			await new Promise<void>((resolve) => {
				release = resolve;
			});
			return json({
				id,
				type: 'onboarding_import.execute',
				status: 'queued',
				revision: 1,
				attempt_count: 0,
				maximum_attempts: 3,
				available_at: at,
				created_at: at,
				updated_at: at
			});
		},
		{
			async reauthenticate() {
				return outcome;
			},
			cancelReauthentication() {
				cancelled++;
			}
		}
	);
	try {
		const pending = h.service.administration(binding, { kind: 'cancelJob', id });
		assert.deepEqual(await h.service.administration(binding, { kind: 'retryJob', id }), {
			kind: 'error',
			reason: 'unavailable'
		});
		assert.deepEqual(
			await h.service.administration(binding, { kind: 'cancelReauthentication' }),
			{ kind: 'success' }
		);
		assert.equal(cancelled, 1);
		while (!release) await new Promise((resolve) => setImmediate(resolve));
		release();
		assert.deepEqual(await pending, { kind: 'success' });
		assert.deepEqual(await h.service.administration(binding, { kind: 'reauthenticate' }), {
			kind: 'success'
		});
		outcome = 'strongAuthenticationRequired';
		assert.deepEqual(await h.service.administration(binding, { kind: 'reauthenticate' }), {
			kind: 'error',
			reason: 'strongRequired'
		});
		outcome = 'cancelled';
		assert.deepEqual(await h.service.administration(binding, { kind: 'reauthenticate' }), {
			kind: 'error',
			reason: 'cancelled'
		});
		h.service.dispose();
		assert.deepEqual(await h.service.administration(binding, { kind: 'institution' }), {
			kind: 'error',
			reason: 'sessionEnded'
		});
		assert.throws(() =>
			h.service.observeAdministration(binding, { kind: 'institution' }, () => {})
		);
	} finally {
		h.dispose();
	}
});

void test('administration IPC binds identity, rejects extra arguments, rechecks the sender and fences closed windows', async () => {
	let handler: ((event: IpcMainInvokeEvent, ...args: unknown[]) => unknown) | undefined;
	let authorized = true;
	let calls = 0;
	let finish: ((value: { kind: 'success' }) => void) | undefined;
	const removed: string[] = [];
	const bridge = new AdministrationIpcBridge(
		{
			handle(channel, listener) {
				if (channel === 'prctr:authenticated:administration') handler = listener;
			},
			removeHandler(channel) {
				removed.push(channel);
			}
		},
		{ principalId: id, sessionId: other },
		{
			async administration(value, intent) {
				assert.deepEqual(value, { principalId: id, sessionId: other });
				assert.deepEqual(intent, { kind: 'disableUser', id });
				calls++;
				return new Promise((resolve) => {
					finish = resolve;
				});
			},
			observeAdministration() {
				return { dispose() {} };
			}
		},
		() => {
			if (!authorized) throw new Error('Unauthorized sender');
		}
	);
	const event = {} as IpcMainInvokeEvent;
	const invoke = (...args: unknown[]) => Promise.resolve(handler!(event, ...args));
	authorized = false;
	await assert.rejects(invoke({ kind: 'disableUser', id }), /Unauthorized/);
	authorized = true;
	await assert.rejects(invoke({ kind: 'disableUser', id }, 'extra'), /Expected one/);
	await assert.rejects(invoke({ kind: 'disableUser', id, url: 'https://attacker.test' }));
	assert.equal(calls, 0);
	const pending = invoke({ kind: 'disableUser', id });
	await new Promise((resolve) => setImmediate(resolve));
	authorized = false;
	finish?.({ kind: 'success' });
	await assert.rejects(pending, /Unauthorized/);
	authorized = true;
	const late = invoke({ kind: 'disableUser', id });
	await new Promise((resolve) => setImmediate(resolve));
	bridge.dispose();
	finish?.({ kind: 'success' });
	assert.deepEqual(await late, { kind: 'error', reason: 'sessionEnded' });
	assert.deepEqual(removed.sort(), [
		'prctr:authenticated:administration',
		'prctr:authenticated:administration:observe'
	]);
	await assert.rejects(invoke({ kind: 'disableUser', id }), /closed/);
	bridge.dispose();
});

void test('pages a server event keeps current subscribe on the Institution and poll less; others poll', async () => {
	const subscriptions: { name: string; scope: unknown }[] = [];
	const polls: number[] = [];
	const refreshed: unknown[] = [];
	const listeners: (() => void)[] = [];
	let accept = true;
	const api = {
		reads: {
			observe: (
				_key: unknown,
				_read: unknown,
				_listener: unknown,
				options: { pollIntervalMs: number }
			) => {
				polls.push(options.pollIntervalMs);
				return { dispose() {} };
			},
			refresh: (key: unknown) => void refreshed.push(key)
		},
		events: {
			on: (name: string, scope: unknown, listener: () => void) => {
				subscriptions.push({ name, scope });
				listeners.push(listener);
				return { accepted: Promise.resolve(scope === undefined || accept), dispose() {} };
			}
		}
	};
	const service = new AdministrationService({
		apiForSession: () => api as never,
		institutionId: () => id,
		async reauthenticate() {
			return 'success';
		},
		cancelReauthentication() {}
	});
	try {
		const institution = (action: string) => ({
			action,
			resourceType: 'institution',
			resourceId: id
		});
		const jobs = service.observeAdministration(binding, { kind: 'jobs', limit: 10 }, () => {});
		assert.deepEqual(subscriptions, [{ name: 'job.changed', scope: institution('job.view') }]);
		assert.deepEqual(polls, [300_000]);
		listeners[0]!();
		assert.equal(refreshed.length, 1);
		jobs.dispose();

		subscriptions.length = 0;
		polls.length = 0;
		service
			.observeAdministration(binding, { kind: 'onboardingImports', limit: 10 }, () => {})
			.dispose();
		assert.deepEqual(subscriptions, [
			{ name: 'onboarding_import.changed', scope: institution('onboarding_batch.view') },
			{ name: 'onboarding_import.changed', scope: undefined }
		]);
		assert.deepEqual(polls, [300_000]);

		subscriptions.length = 0;
		polls.length = 0;
		service
			.observeAdministration(binding, { kind: 'invitations', limit: 10 }, () => {})
			.dispose();
		assert.deepEqual(subscriptions, [
			{ name: 'invitation.changed', scope: institution('invitation.view') }
		]);
		assert.deepEqual(polls, [300_000]);

		subscriptions.length = 0;
		polls.length = 0;
		service.observeAdministration(binding, { kind: 'users', limit: 10 }, () => {}).dispose();
		assert.deepEqual(subscriptions, []);
		assert.deepEqual(polls, [60_000]);
	} finally {
		service.dispose();
	}
});

void test('list orders, page sizes and filters are closed sets from the contract', () => {
	for (const value of [
		{ kind: 'users', limit: 20 },
		{ kind: 'users', limit: 100 },
		{ kind: 'users', limit: 10, sort: 'email' },
		{ kind: 'users', limit: 10, dir: 'up' },
		{ kind: 'users', limit: 10, state: 'archived' },
		{ kind: 'users', limit: 10, roleIds: Array(17).fill(id) },
		{ kind: 'users', limit: 10, lastActiveAfter: 20, lastActiveBefore: 10 },
		{ kind: 'classMembers', classId: id, limit: 10, sort: 'since' },
		{ kind: 'unitMembers', unitId: id, limit: 10, sort: 'enrolled' },
		{ kind: 'unitProgrammes', unitId: id, limit: 10, dir: 'asc' },
		{ kind: 'mailDeliveries', limit: 10, sort: 'name' },
		{ kind: 'audits', limit: 10, dir: 'asc' },
		{ kind: 'audits', limit: 10, order: 'newest' },
		{ kind: 'audits', limit: 10, status: 'failed' },
		{ kind: 'audits', limit: 10, actions: Array(33).fill('user.disable') },
		{ kind: 'audits', limit: 10, createdAfter: 10, createdBefore: 10 },
		{ kind: 'jobs', limit: 10, sort: 'created' }
	])
		assert.throws(
			() => validateAdministrationIntent(value),
			JSON.stringify(value).slice(0, 90)
		);
	for (const limit of [10, 25, 50])
		assert.equal(
			(validateAdministrationIntent({ kind: 'users', limit }) as { limit: number }).limit,
			limit
		);
	assert.deepEqual(
		validateAdministrationIntent({
			kind: 'users',
			limit: 25,
			sort: 'last_active',
			dir: 'desc',
			roleIds: [id, other],
			state: 'active',
			neverSignedIn: true
		}),
		{
			kind: 'users',
			limit: 25,
			roleIds: [id, other],
			state: 'active',
			neverSignedIn: true,
			sort: 'last_active',
			dir: 'desc'
		}
	);
});

void test('lists send their order and filters in the server names', async () => {
	const h = harness(() => json({ items: [] }));
	try {
		const sent = async (intent: AdministrationIntent) => {
			await h.service.administration(binding, intent);
			return path(h.requests.at(-1)!);
		};
		const after = Date.parse('2026-01-01T00:00:00Z');
		const before = Date.parse('2026-02-01T00:00:00Z');
		const iso = (value: number) => encodeURIComponent(new Date(value).toISOString());
		assert.equal(
			await sent({
				kind: 'users',
				limit: 50,
				roleIds: [id, other],
				state: 'disabled',
				neverSignedIn: true,
				lastActiveAfter: after,
				lastActiveBefore: before,
				sort: 'last_active',
				dir: 'desc'
			}),
			`GET /api/v1/users?role_id=${id}&role_id=${other}&state=disabled&never_signed_in=true` +
				`&last_active_after=${iso(after)}&last_active_before=${iso(before)}` +
				'&sort=last_active&dir=desc&limit=50'
		);
		assert.equal(
			await sent({
				kind: 'audits',
				limit: 25,
				subjectUserId: id,
				actions: ['user.manage', 'user.mfa.reset'],
				status: 'fail',
				createdBefore: before,
				order: 'asc'
			}),
			`GET /api/v1/audits?limit=25&subject_user_id=${id}&action=user.manage&action=user.mfa.reset` +
				`&status=fail&created_before=${iso(before)}&order=asc`
		);
		assert.equal(
			await sent({
				kind: 'mailDeliveries',
				limit: 10,
				recipientUserId: id,
				createdBefore: before,
				sort: 'created',
				dir: 'asc'
			}),
			`GET /api/v1/mail/deliveries?limit=10&recipient_user_id=${id}` +
				`&created_before=${iso(before)}&sort=created&dir=asc`
		);
		assert.equal(
			await sent({ kind: 'classMembers', classId: id, limit: 10, sort: 'name', dir: 'desc' }),
			`GET /api/v1/classes/${id}/members?sort=name&dir=desc&limit=10`
		);
		assert.equal(
			await sent({ kind: 'unitMembers', unitId: id, limit: 10, sort: 'since', dir: 'asc' }),
			`GET /api/v1/academic-units/${id}/members?sort=since&dir=asc&limit=10`
		);
		assert.equal(
			await sent({ kind: 'unitClasses', unitId: id, limit: 10, dir: 'desc' }),
			`GET /api/v1/academic-units/${id}/classes?dir=desc&limit=10`
		);
		assert.equal(
			await sent({ kind: 'levelClasses', levelId: id, limit: 10, dir: 'desc' }),
			`GET /api/v1/programme-levels/${id}/classes?dir=desc&limit=10`
		);
		assert.equal(
			await sent({ kind: 'audits', limit: 10, auditKind: 'change' }),
			'GET /api/v1/audits?limit=10&kind=change'
		);
		assert.equal(
			await sent({ kind: 'roleBindings', limit: 10, roleIds: [id, other] }),
			`GET /api/v1/role-bindings?role_id=${id}&role_id=${other}&limit=10`
		);
		assert.equal(
			await sent({ kind: 'jobs', limit: 10, order: 'asc' }),
			'GET /api/v1/jobs?limit=10&order=asc'
		);
		assert.equal(
			await sent({ kind: 'onboardingImports', limit: 10, order: 'asc' }),
			'GET /api/v1/onboarding-imports?limit=10&order=asc'
		);
	} finally {
		h.dispose();
	}
});

void test('roles count who holds them, and mail names its recipient when the viewer may see them', async () => {
	const role = {
		id,
		name: 'teacher',
		display_name: 'Teacher',
		description: '',
		built_in: true,
		permissions: ['class.view'],
		created_at: at,
		updated_at: at
	};
	const delivery = {
		id,
		occurrence_id: other,
		state: 'failed',
		masked_recipient: 'a***@example.test',
		template_key: 'identity.verify_email',
		template_digest: 'd'.repeat(64),
		attempt_count: 2,
		message_id: '<m@example.test>',
		message_date: at,
		created_at: at,
		updated_at: at,
		deadline: at
	};
	const h = harness((request) => {
		const route = path(request);
		if (route.startsWith('GET /api/v1/roles'))
			return json({
				items: [
					{
						...role,
						holders: {
							bindings: 30,
							bindings_is_lower_bound: false,
							users: 23,
							users_is_lower_bound: false,
							scopes: 6,
							scopes_is_lower_bound: false
						}
					},
					{ ...role, id: other, name: 'auditor', display_name: 'Auditor' }
				]
			});
		if (route.startsWith('GET /api/v1/mail/deliveries'))
			return json({
				items: [
					{ ...delivery, target_user_id: other, recipient_display_name: 'Ada Lovelace' },
					{ ...delivery, id: other, target_invitation_id: id }
				]
			});
		throw new Error(`Unexpected ${route}`);
	});
	try {
		const roles = await h.service.administration(binding, { kind: 'roles', limit: 10 });
		assert.ok(roles.kind === 'data' && roles.data.resource === 'roles');
		assert.deepEqual(roles.data.value.items[0]!.holders, {
			bindings: 30,
			bindingsIsLowerBound: false,
			users: 23,
			usersIsLowerBound: false,
			scopes: 6,
			scopesIsLowerBound: false
		});
		// A viewer who may see no bindings gets no counts, not zero.
		assert.equal(roles.data.value.items[1]!.holders, undefined);

		const mail = await h.service.administration(binding, { kind: 'mailDeliveries', limit: 10 });
		assert.ok(mail.kind === 'data' && mail.data.resource === 'mailDeliveries');
		assert.deepEqual(
			mail.data.value.items.map((item) => [
				item.recipientName,
				item.targetUserId,
				item.recipient
			]),
			[
				['Ada Lovelace', other, 'a***@example.test'],
				[undefined, undefined, 'a***@example.test']
			]
		);
	} finally {
		h.dispose();
	}
});

void test('audits carry their summary, classes their student count, and first pages their total', async () => {
	const unit = 'u'.repeat(26);
	const classDto = (n: number) => ({
		id: `${String.fromCharCode(97 + n)}`.repeat(26),
		name: `c${n}`,
		display_name: `Class ${n}`,
		description: '',
		revision: 1,
		programme_level_id: unit,
		academic_period_id: unit,
		created_at: at,
		updated_at: at
	});
	const h = harness((request) => {
		const route = path(request);
		if (route.startsWith('GET /api/v1/audits'))
			return json({
				items: [
					{
						id,
						action: 'user.disable',
						status: 'success',
						summary: 'Ada Lovelace disabled Grace Hopper\u0007.',
						created_at: at,
						updated_at: at,
						resource: { type: 'user', id: other },
						request_id: 'internal'
					}
				]
			});
		if (route.startsWith(`GET /api/v1/academic-units/${unit}/classes`))
			return json({
				items: [
					{ ...classDto(0), student_count: 10000, student_count_is_lower_bound: true },
					{ ...classDto(1), student_count: 3, student_count_is_lower_bound: false },
					classDto(2)
				],
				total: 3,
				total_is_lower_bound: false
			});
		if (route.startsWith(`GET /api/v1/classes/${unit}/members`))
			return json({
				items: Array.from({ length: 11 }, (_, n) => ({
					id: `${String.fromCharCode(97 + n)}`.repeat(26),
					user_id: id,
					class_id: unit,
					academic_period_id: unit,
					start_at: at,
					created_at: at,
					updated_at: at,
					user: { id }
				})),
				total: 11
			});
		if (route.startsWith('GET /api/v1/role-bindings'))
			return json({ items: [], total: 0, total_is_lower_bound: false });
		throw new Error(`Unexpected ${route}`);
	});
	try {
		const audits = await h.service.administration(binding, { kind: 'audits', limit: 10 });
		assert.ok(audits.kind === 'data' && audits.data.resource === 'audits');
		assert.equal(audits.data.value.items[0]!.summary, 'Ada Lovelace disabled Grace Hopper .');
		assert.ok(!JSON.stringify(audits).includes('internal'));

		const classes = await h.service.administration(binding, {
			kind: 'unitClasses',
			unitId: unit,
			limit: 10
		});
		assert.ok(classes.kind === 'data' && classes.data.resource === 'unitClasses');
		assert.deepEqual(
			classes.data.value.items.map((item) => [item.studentCount, item.studentCountAtLeast]),
			[
				[10000, true],
				[3, false],
				[undefined, undefined]
			]
		);
		assert.equal(classes.data.value.total, 3);
		assert.equal(classes.data.value.totalAtLeast, false);

		// A page longer than the one asked for is refused, and the same page fits a larger size.
		assert.deepEqual(
			await h.service.administration(binding, {
				kind: 'classMembers',
				classId: unit,
				limit: 10
			}),
			{ kind: 'error', reason: 'unavailable' }
		);
		const members = await h.service.administration(binding, {
			kind: 'classMembers',
			classId: unit,
			limit: 25
		});
		assert.ok(members.kind === 'data' && members.data.resource === 'classMembers');
		assert.equal(members.data.value.items.length, 11);
		assert.equal(members.data.value.total, 11);

		const bindings = await h.service.administration(binding, {
			kind: 'roleBindings',
			limit: 10
		});
		assert.ok(bindings.kind === 'data' && bindings.data.resource === 'roleBindings');
		assert.equal(bindings.data.value.total, 0);
	} finally {
		h.dispose();
	}
});

void test('a filter preview is created, read, listed by group, committed once and cancelled', async () => {
	const preview = 'p'.repeat(26);
	const job = 'j'.repeat(26);
	const digest = 'a'.repeat(64);
	const role = 'r'.repeat(26);
	const previewDto = {
		id: preview,
		operation: 'role_binding.create',
		state: 'preview_ready',
		scope_type: 'institution',
		scope_id: id,
		role_id: role,
		filter: { affiliation: ['teacher'], never_signed_in: true, last_active_before: at },
		revision: 2,
		preview_digest: digest,
		total_rows: 3,
		succeeded_rows: 0,
		failed_rows: 0,
		skipped_rows: 1,
		no_op_rows: 1,
		summary: {
			will_change: 1,
			no_op: 1,
			skipped: 1,
			skip_reasons: [{ reason: 'academic_administration_preview.self', rows: 1 }]
		},
		preview_job_id: job,
		created_at: at,
		updated_at: at,
		expires_at: at,
		preview_expires_at: at
	};
	const answers: HttpResponse[] = [];
	const h = harness(() => answers.shift()!);
	try {
		for (const value of [
			{
				kind: 'createAcademicPreview',
				operation: 'class.transfer',
				scopeType: 'class',
				scopeId: id,
				filter: {}
			},
			{
				kind: 'createAcademicPreview',
				operation: 'user.disable',
				scopeType: 'institution',
				scopeId: id,
				filter: { roleIds: Array(17).fill(id) }
			},
			{
				kind: 'createAcademicPreview',
				operation: 'user.disable',
				scopeType: 'institution',
				scopeId: id,
				filter: { lastActiveAfter: 5, lastActiveBefore: 5 }
			},
			{
				kind: 'academicPreviewRows',
				id: preview,
				group: 'no_op',
				reason: 'academic_administration_preview.self',
				limit: 10
			},
			{ kind: 'academicPreviewRows', id: preview, group: 'all', limit: 10 },
			{ kind: 'commitAcademicPreview', id: preview, expectedRevision: 2 }
		])
			assert.throws(() => validateAdministrationIntent(value), JSON.stringify(value));

		answers.push(json(previewDto, 202));
		assert.deepEqual(
			await h.service.administration(binding, {
				kind: 'createAcademicPreview',
				operation: 'role_binding.create',
				scopeType: 'institution',
				scopeId: id,
				roleId: role,
				filter: {
					affiliation: ['teacher'],
					neverSignedIn: true,
					lastActiveBefore: Date.parse(at)
				}
			}),
			{ kind: 'created', id: preview }
		);
		assert.equal(path(h.requests[0]!), 'POST /api/v1/academic-administration-previews');
		assert.deepEqual(JSON.parse(String(h.requests[0]!.body)), {
			operation: 'role_binding.create',
			scope_type: 'institution',
			scope_id: id,
			filter: {
				affiliation: ['teacher'],
				never_signed_in: true,
				last_active_before: '2026-01-01T00:00:00.000Z'
			},
			role_id: role
		});

		answers.push(json(previewDto));
		assert.deepEqual(
			await h.service.administration(binding, { kind: 'academicPreview', id: preview }),
			{
				kind: 'data',
				data: {
					resource: 'academicPreview',
					value: {
						id: preview,
						operation: 'role_binding.create',
						state: 'preview_ready',
						scopeType: 'institution',
						scopeId: id,
						filter: {
							affiliation: ['teacher'],
							neverSignedIn: true,
							lastActiveBefore: Date.parse(at)
						},
						roleId: role,
						revision: 2,
						previewDigest: digest,
						totalRows: 3,
						succeededRows: 0,
						failedRows: 0,
						skippedRows: 1,
						noOpRows: 1,
						summary: {
							willChange: 1,
							noOp: 1,
							skipped: 1,
							skipReasons: [
								{ reason: 'academic_administration_preview.self', rows: 1 }
							]
						},
						previewJobId: job,
						createdAt: Date.parse(at),
						updatedAt: Date.parse(at),
						expiresAt: Date.parse(at),
						commitBy: Date.parse(at)
					}
				}
			}
		);

		answers.push(
			json({
				items: [
					{
						row: 3,
						user_id: id,
						username: 'ada',
						display_name: 'Ada Lovelace',
						group: 'skipped',
						status: 'skipped',
						reason: 'academic_administration_preview.self'
					}
				],
				next_cursor: 'more'
			})
		);
		const rows = await h.service.administration(binding, {
			kind: 'academicPreviewRows',
			id: preview,
			group: 'skipped',
			reason: 'academic_administration_preview.self',
			limit: 25
		});
		assert.equal(
			path(h.requests[2]!),
			`GET /api/v1/academic-administration-previews/${preview}/rows` +
				'?group=skipped&reason=academic_administration_preview.self&limit=25'
		);
		assert.deepEqual(rows, {
			kind: 'data',
			data: {
				resource: 'academicPreviewRows',
				value: {
					items: [
						{
							row: 3,
							userId: id,
							username: 'ada',
							displayName: 'Ada Lovelace',
							group: 'skipped',
							status: 'skipped',
							reason: 'academic_administration_preview.self'
						}
					],
					cursor: 'more'
				}
			}
		});

		assert.ok(requiresIdempotencyKey('commitAcademicAdministrationPreview'));
		answers.push(json({ ...previewDto, state: 'executing' }, 202));
		assert.deepEqual(
			await h.service.administration(binding, {
				kind: 'commitAcademicPreview',
				id: preview,
				expectedRevision: 2,
				previewDigest: digest
			}),
			{ kind: 'success' }
		);
		const commit = h.requests[3]!;
		assert.equal(
			path(commit),
			`POST /api/v1/academic-administration-previews/${preview}/commit`
		);
		assert.match(commit.headers?.['Idempotency-Key'] ?? '', /^[A-Za-z0-9_-]{43}$/u);
		assert.deepEqual(JSON.parse(String(commit.body)), {
			expected_revision: 2,
			preview_digest: digest
		});

		answers.push(json({ ...previewDto, state: 'canceled' }));
		assert.deepEqual(
			await h.service.administration(binding, {
				kind: 'cancelAcademicPreview',
				id: preview
			}),
			{ kind: 'success' }
		);
		assert.equal(
			path(h.requests[4]!),
			`POST /api/v1/academic-administration-previews/${preview}/cancel`
		);
	} finally {
		h.dispose();
	}
});

void test('an expired preview and lost access to its filter have reasons of their own', async () => {
	const preview = 'p'.repeat(26);
	const answers: HttpResponse[] = [];
	const h = harness(() => answers.shift()!);
	try {
		const commit: AdministrationIntent = {
			kind: 'commitAcademicPreview',
			id: preview,
			expectedRevision: 2,
			previewDigest: 'a'.repeat(64)
		};
		answers.push(problem(410, 'academic_administration_preview.expired'));
		assert.deepEqual(await h.service.administration(binding, commit), {
			kind: 'error',
			reason: 'expired'
		});
		answers.push(problem(409, 'academic_administration_preview.authorization_lost'));
		assert.deepEqual(await h.service.administration(binding, commit), {
			kind: 'error',
			reason: 'accessChanged'
		});
		answers.push(problem(409, 'academic_administration_preview.authorization_lost'));
		assert.deepEqual(
			await h.service.administration(binding, { kind: 'academicPreview', id: preview }),
			{ kind: 'error', reason: 'accessChanged' }
		);
		answers.push(problem(409, 'academic_administration_preview.revision_mismatch'));
		assert.deepEqual(await h.service.administration(binding, commit), {
			kind: 'error',
			reason: 'conflict'
		});
		answers.push(problem(404, 'resource.not_found'));
		assert.deepEqual(
			await h.service.administration(binding, {
				kind: 'academicPreviewRows',
				id: preview,
				group: 'will_change',
				limit: 10
			}),
			{ kind: 'error', reason: 'notFound' }
		);
		assert.ok(validateAdministrationResponse({ kind: 'error', reason: 'accessChanged' }));
	} finally {
		h.dispose();
	}
});
