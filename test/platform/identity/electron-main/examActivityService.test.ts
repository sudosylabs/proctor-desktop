import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ServerApiError } from '../../../../src/prctr/platform/serverApi/common/serverApi.js';
import { SessionApi } from '../../../../src/prctr/platform/serverApi/node/sessionApi.js';
import type { EncodedApiRequest } from '../../../../src/prctr/platform/serverApi/node/requestEncoding.js';
import type { HttpResponse } from '../../../../src/prctr/platform/serverApi/node/serverHttpTransport.js';
import { ExamActivityService } from '../../../../src/prctr/platform/examActivity/electron-main/examActivityService.js';

const id = 'y'.repeat(26);
const binding = Object.freeze({ principalId: id, sessionId: 's'.repeat(26) });
const problem = (status: number): HttpResponse => ({
	status,
	headers: { 'content-type': 'application/problem+json' },
	bytes: new TextEncoder().encode(
		JSON.stringify({ type: 'about:blank', title: 'Refused', status, code: 'refused' })
	)
});

function harness(answer: (request: EncodedApiRequest) => HttpResponse) {
	const requests: EncodedApiRequest[] = [];
	const api = new SessionApi({
		binding,
		origin: 'https://example.test',
		execute: async (request) => {
			requests.push(request);
			return answer(request);
		}
	});
	const service = new ExamActivityService({
		apiForSession(value) {
			if (value.sessionId !== binding.sessionId) throw new ServerApiError('sessionEnded');
			return api;
		},
		currentRegistration: () => id
	});
	return { service, requests, dispose: () => api.dispose() };
}

void test('exam activity failures become closed reasons for the intent that failed', async () => {
	const statuses = new Map([
		['/result', 404],
		['/exam-activity', 400],
		['/context', 403]
	]);
	const h = harness((request) => {
		const path = new URL(request.url).pathname;
		const match = [...statuses].find(([suffix]) => path.endsWith(suffix));
		return problem(match?.[1] ?? 500);
	});
	try {
		assert.deepEqual(await h.service.examActivity(binding, { kind: 'result', attemptId: id }), {
			kind: 'error',
			reason: 'notFound'
		});
		assert.deepEqual(
			await h.service.examActivity(binding, { kind: 'activity', cursor: 'next' }),
			{ kind: 'error', reason: 'invalidCursor' }
		);
		assert.deepEqual(await h.service.examActivity(binding, { kind: 'activity' }), {
			kind: 'error',
			reason: 'unavailable'
		});
		assert.deepEqual(await h.service.examActivity(binding, { kind: 'context' }), {
			kind: 'error',
			reason: 'restricted'
		});
		assert.ok(
			h.requests.every((request) => request.method === 'GET'),
			'Exam Activity only reads'
		);
	} finally {
		h.dispose();
	}
});

void test('exam activity is bound to its Session and sends nothing for another one', async () => {
	const h = harness(() => assert.fail('Nothing is sent for a foreign Session'));
	try {
		assert.deepEqual(
			await h.service.examActivity(
				{ ...binding, sessionId: 'f'.repeat(26) },
				{ kind: 'context' }
			),
			{ kind: 'error', reason: 'sessionEnded' }
		);
		assert.equal(h.requests.length, 0);
	} finally {
		h.dispose();
	}
});
