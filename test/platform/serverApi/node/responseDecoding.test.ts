import assert from 'node:assert/strict';
import { test } from 'node:test';
import { operationContract } from '../../../../src/prctr/platform/serverApi/node/serverContract.js';
import { decodeResponse } from '../../../../src/prctr/platform/serverApi/node/responseDecoding.js';
import type { HttpResponse } from '../../../../src/prctr/platform/serverApi/node/serverHttpTransport.js';
import { ServerApiError } from '../../../../src/prctr/platform/serverApi/common/serverApi.js';

const json = (value: unknown, status = 200, headers = {}): HttpResponse => ({
	status,
	headers: { 'content-type': 'application/json', ...headers },
	bytes: new TextEncoder().encode(JSON.stringify(value))
});

void test('errors preserve problem fields and Retry-After while malformed responses fail validation', () => {
	const operation = operationContract('getCurrentUserProfile');
	const problem = {
		type: 'about:blank',
		title: 'Invalid',
		status: 429,
		code: 'authentication.rate_limited',
		fields: { name: 'required' },
		request_id: 'request-1'
	};
	assert.throws(
		() => decodeResponse(operation, json(problem, 429, { 'retry-after': '3' })),
		(error: unknown) =>
			error instanceof ServerApiError &&
			error.problem?.fields?.name === 'required' &&
			error.retryAfterMs === 3000
	);
	assert.throws(
		() => decodeResponse(operation, json({}, 200)),
		(error: unknown) => error instanceof ServerApiError && error.kind === 'invalidResponse'
	);
	assert.throws(() => decodeResponse(operation, json({ ...problem, status: 400 }, 429)));
});

void test('binary and 304 responses preserve their transport meaning', () => {
	const operation = operationContract('getUserProfilePicture');
	const bytes = new Uint8Array([0, 255, 10]);
	assert.deepEqual(
		decodeResponse(operation, {
			status: 200,
			bytes,
			headers: { 'content-type': 'image/webp', etag: 'v1' }
		}).value,
		bytes
	);
	assert.equal(
		decodeResponse(operation, {
			status: 304,
			bytes: new Uint8Array(),
			headers: { etag: 'v1' }
		}).value,
		undefined
	);
	assert.throws(() =>
		decodeResponse(operation, { status: 200, bytes, headers: { 'content-type': 'text/html' } })
	);
});

void test('gateway failures retain HTTP status and backoff without exposing HTML or inconsistent problem details', () => {
	const operation = operationContract('getCurrentUserProfile');
	for (const response of [
		{
			status: 503,
			headers: { 'content-type': 'text/html', 'retry-after': '4' },
			bytes: new TextEncoder().encode('<html>private proxy</html>')
		},
		json({ status: 400, title: 'bad' }, 503, { 'retry-after': '4' })
	]) {
		assert.throws(
			() => decodeResponse(operation, response),
			(e: unknown) =>
				e instanceof ServerApiError &&
				e.kind === 'server' &&
				e.status === 503 &&
				e.retryAfterMs === 4000 &&
				e.problem === undefined &&
				!e.message.includes('private')
		);
	}
});
