import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ServerHttpTransport } from '../../../../src/prctr/platform/serverApi/node/serverHttpTransport.js';
import { ServerApiError } from '../../../../src/prctr/platform/serverApi/common/serverApi.js';

const origin = 'https://institution.test';

void test('transport fences redirects, excessive bodies, cancellation and deadline separately', async () => {
	for (const response of [
		new Response(null, { status: 302, headers: { Location: 'https://other.test' } }),
		new Response('large')
	]) {
		const transport = new ServerHttpTransport(async () => response);
		await assert.rejects(
			transport.send({ url: origin, method: 'GET', maxResponseBytes: 2 }),
			ServerApiError
		);
	}
	const controller = new AbortController();
	controller.abort();
	await assert.rejects(
		new ServerHttpTransport().send({ url: origin, method: 'GET', signal: controller.signal }),
		(error: unknown) => error instanceof ServerApiError && error.kind === 'cancelled'
	);
	const transport = new ServerHttpTransport(
		(_url, options) =>
			new Promise((_resolve, reject) =>
				options?.signal?.addEventListener('abort', () => reject(new Error('aborted')))
			)
	);
	await assert.rejects(
		transport.send({ url: origin, method: 'GET', timeoutMs: 5 }),
		(error: unknown) => error instanceof ServerApiError && error.kind === 'timeout'
	);
});
