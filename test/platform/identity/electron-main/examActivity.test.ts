import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
	validateExamActivityIntent,
	validateExamActivityResponse,
	type ExamActivityResponse
} from '../../../../src/prctr/platform/examActivity/common/examActivityProtocol.js';
import { readExamActivityWire } from '../../../../src/prctr/platform/examActivity/electron-main/examActivityWire.js';
import { ExamActivityIpcBridge } from '../../../../src/prctr/platform/examActivity/electron-main/examActivityIpc.js';
import { desktopHttpMethod } from '../../../../src/prctr/platform/identity/node/desktopAuthHttp.js';
import { ProductAccess } from '../../../../src/prctr/workbench/contrib/examActivity/common/productAccess.js';
const id = 'y'.repeat(26);
const date = '2026-09-11T08:00:00Z';
void test('exam capability rejects arbitrary paths, binding injection, unsupported actions and excessive cursors', () => {
	for (const value of [
		{ kind: 'result', attemptId: '../users/me' },
		{ kind: 'activity', principalId: id },
		{ kind: 'activity', cursor: 'a'.repeat(2049) },
		{ kind: 'enter', attemptId: id },
		{ kind: 'context', url: 'https://attacker.test' }
	])
		assert.throws(() => validateExamActivityIntent(value));
	assert.equal(desktopHttpMethod(`/api/v1/exam-attempts/${id}/result`), 'GET');
	assert.equal(
		desktopHttpMethod('/api/v1/users/me/exam-activity?limit=20&cursor=a%2Fb%3D'),
		'GET'
	);
	for (const path of [
		'/api/v1/users/me/exam-activity?limit=200',
		'/api/v1/users/me/exam-activity?limit=20&user_id=other',
		`/api/v1/exam-attempts/${id}/result?private=true`,
		'/api/v1/users/me/exam-activity?limit=20#fragment'
	])
		assert.throws(() => desktopHttpMethod(path as Parameters<typeof desktopHttpMethod>[0]));
});
void test('context and released result whitelist fields and verify immutable session/resource bindings', () => {
	const context = {
		user: { id, password_hash: 'secret' },
		current_desktop_registration_id: id,
		available_product_areas: ['account', 'settings', 'student_activity'],
		no_current_affiliation: false,
		no_assigned_access: false,
		management_scopes: [],
		management_scopes_has_more: false
	};
	assert.deepEqual(readExamActivityWire({ kind: 'context' }, context, id, id), {
		kind: 'context',
		context: {
			areas: ['account', 'settings', 'student_activity'],
			noAffiliation: false,
			noAccess: false,
			scopes: [],
			moreScopes: false
		}
	});
	assert.throws(() => readExamActivityWire({ kind: 'context' }, context, 'b'.repeat(26), id));
	assert.throws(() => readExamActivityWire({ kind: 'context' }, context, id, 'b'.repeat(26)));
	const result = {
		exam_attempt_id: id,
		released_at: date,
		student_remarks_markdown: 'Approved remarks',
		private_notes: 'private',
		grade: 'secret'
	};
	assert.deepEqual(readExamActivityWire({ kind: 'result', attemptId: id }, result, id, id), {
		kind: 'result',
		attemptId: id,
		releasedAt: date,
		remarks: 'Approved remarks'
	});
	assert.throws(() =>
		readExamActivityWire({ kind: 'result', attemptId: 'b'.repeat(26) }, result, id, id)
	);
	assert.throws(() =>
		validateExamActivityResponse({
			kind: 'result',
			attemptId: id,
			releasedAt: date,
			remarks: 'a'.repeat(8193)
		})
	);
});
void test('activity exposes no withheld review information and bounds collection state', () => {
	const entry = {
		exam_sitting_id: id,
		title: 'Algorithms',
		academic_unit: { id, display_name: 'Computing' },
		class: { id, display_name: 'Year 2' },
		scheduled_start_at: date,
		scheduled_end_at: date,
		activity_state: 'submitted',
		access_state: 'submitted',
		allowed_actions: [],
		attempt: { id },
		submission: { submitted_at: date },
		private_review: 'secret'
	};
	const response = readExamActivityWire(
		{ kind: 'activity' },
		{ server_time: date, items: [entry] },
		id,
		id
	);
	assert.equal(response.kind, 'activity');
	assert.ok(!JSON.stringify(response).includes('secret'));
	assert.throws(() =>
		readExamActivityWire(
			{ kind: 'activity' },
			{ server_time: date, items: [{ ...entry, activity_state: 'under_review' }] },
			id,
			id
		)
	);
	assert.throws(() =>
		readExamActivityWire(
			{ kind: 'activity' },
			{ server_time: date, items: Array(21).fill(entry) },
			id,
			id
		)
	);
	assert.throws(() =>
		readExamActivityWire(
			{ kind: 'activity' },
			{
				server_time: date,
				items: [{ ...entry, allowed_actions: ['view_result'], attempt: null }]
			},
			id,
			id
		)
	);
});
void test('exam IPC reauthorizes after awaits and fences window disposal', async () => {
	type InvokeEvent = import('electron/main').IpcMainInvokeEvent;
	let handler!: (event: InvokeEvent, ...args: unknown[]) => unknown;
	let complete!: (response: ExamActivityResponse) => void;
	let authorized = true,
		requests = 0,
		removed = '';
	const bridge = new ExamActivityIpcBridge(
		{
			handle(channel, callback) {
				assert.equal(channel, 'prctr:authenticated:exam-activity');
				handler = callback;
			},
			removeHandler(channel) {
				removed = channel;
			}
		},
		{ principalId: id, sessionId: id },
		{
			async examActivity(binding) {
				assert.deepEqual(binding, { principalId: id, sessionId: id });
				requests++;
				return new Promise((resolve) => {
					complete = resolve;
				});
			}
		},
		() => {
			if (!authorized) throw new Error('Wrong sender');
		}
	);
	const invoke = (...args: unknown[]) => Promise.resolve(handler({} as InvokeEvent, ...args));
	await assert.rejects(invoke({ kind: 'activity' }, 1));
	assert.equal(requests, 0);
	const first = invoke({ kind: 'activity' });
	authorized = false;
	complete({ kind: 'activity', items: [], serverTime: date });
	await assert.rejects(first, /Wrong sender/);
	authorized = true;
	const second = invoke({ kind: 'activity' });
	bridge.dispose();
	complete({ kind: 'activity', items: [], serverTime: date });
	assert.deepEqual(await second, { kind: 'error', reason: 'sessionEnded' });
	assert.equal(removed, 'prctr:authenticated:exam-activity');
	await assert.rejects(invoke({ kind: 'context' }), /closed/);
});
void test('context refresh coalesces concurrent callers, clears stale context, and ignores disposed response', async () => {
	let complete!: (response: ExamActivityResponse) => void,
		calls = 0,
		events = 0;
	const access = new ProductAccess({
		async request() {
			calls++;
			return new Promise((resolve) => {
				complete = resolve;
			});
		}
	});
	access.onDidChange(() => events++);
	const first = access.refresh();
	assert.equal(access.refresh(), first);
	assert.equal(calls, 1);
	complete({
		kind: 'context',
		context: {
			areas: ['account', 'settings'],
			noAffiliation: false,
			noAccess: true,
			scopes: [],
			moreScopes: false
		}
	});
	await first;
	assert.equal(access.state?.kind, 'context');
	const pending = access.refresh();
	assert.equal(access.state, undefined);
	const before = events;
	access.dispose();
	complete({ kind: 'error', reason: 'unavailable' });
	await pending;
	assert.equal(events, before);
	assert.equal(access.state, undefined);
});
