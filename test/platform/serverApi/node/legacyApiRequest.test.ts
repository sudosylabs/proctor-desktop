import assert from 'node:assert';
import { test } from 'node:test';

import { accountHistoryPath } from '../../../../src/prctr/platform/account/electron-main/accountWire.ts';
import { encodeRequest } from '../../../../src/prctr/platform/serverApi/node/requestEncoding.ts';
import { resolveApiRoute } from '../../../../src/prctr/platform/serverApi/node/legacyApiRequest.ts';

const ORIGIN = 'https://northfield.example';

void test('a repeated query parameter reaches the request as every value it was given', () => {
	const path = accountHistoryPath({
		events: ['session.revoked', 'sign_in.succeeded'],
		createdAfter: Date.UTC(2026, 10, 1)
	});
	const { id, input } = resolveApiRoute(ORIGIN, path, 'GET');
	const prepared = encodeRequest(ORIGIN, id, input);
	const url = new URL(prepared.url);
	assert.deepStrictEqual(url.searchParams.getAll('event'), [
		'session.revoked',
		'sign_in.succeeded'
	]);
	assert.strictEqual(url.searchParams.get('limit'), '10');
});

void test('a single value of a repeated parameter is still sent as a list of one', () => {
	const { id, input } = resolveApiRoute(
		ORIGIN,
		accountHistoryPath({ events: ['session.revoked'] }),
		'GET'
	);
	const url = new URL(encodeRequest(ORIGIN, id, input).url);
	assert.deepStrictEqual(url.searchParams.getAll('event'), ['session.revoked']);
});
