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
import { apiOperations } from '../../../../src/prctr/platform/serverApi/node/apiContract.js';
import type { PreparedApiRequest } from '../../../../src/prctr/platform/serverApi/node/apiRequest.js';
import { ServerApiClient } from '../../../../src/prctr/platform/serverApi/node/serverApiClient.js';
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
	readonly requests: PreparedApiRequest[];
	readonly signOuts: () => number;
	readonly dispose: () => void;
}
function harness(
	answer: (request: PreparedApiRequest, index: number) => HttpResponse | Promise<HttpResponse>,
	port: Partial<AdministrationSessionPort> = {}
): Harness {
	const requests: PreparedApiRequest[] = [];
	let signOuts = 0;
	const api = new ServerApiClient(origin, async (request) => {
		requests.push(request);
		return answer(request, requests.length - 1);
	});
	const service = new AdministrationService({
		apiForSession(value) {
			if (value.principalId !== binding.principalId || value.sessionId !== binding.sessionId)
				throw new ServerApiError('sessionEnded');
			return api;
		},
		async signOut() {
			signOuts++;
		},
		async reauthenticate() {
			return 'success';
		},
		cancelReauthentication() {},
		...port
	});
	return {
		service,
		requests,
		signOuts: () => signOuts,
		dispose: () => {
			service.dispose();
			api.dispose();
		}
	};
}
const path = (request: PreparedApiRequest) => {
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
		}) as ServerApiClient['request']
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
		const declared = apiOperations.get(operation);
		assert.ok(declared, operation);
		assert.notEqual(declared['x-proctor-auth'], 'public', operation);
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
		assert.equal(h.signOuts(), 0);
		await expect({ kind: 'enableUser', id }, { kind: 'error', reason: 'sessionEnded' });
		assert.equal(h.signOuts(), 1);
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
