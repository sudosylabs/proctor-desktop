import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test } from 'node:test';
import {
	canonicalContractBytes,
	canonicalContractDigest,
	parseStrictContractJson
} from '../../../../src/prctr/platform/serverApi/node/canonicalContract.ts';

type Fixture = {
	name: string;
	input_base64: string;
	canonical_base64?: string;
	sha256?: string;
	reject?: boolean;
};
// Shared byte vectors from Proctor server internal/canonicaljson/testdata/agreement.json.
const fixtures = JSON.parse(
	readFileSync(resolve('test/platform/serverApi/node/fixtures/canonicalAgreement.json'), 'utf8')
) as Fixture[];
for (const fixture of fixtures)
	void test(`server canonical agreement: ${fixture.name}`, () => {
		const run = () => {
			const value = parseStrictContractJson(Buffer.from(fixture.input_base64, 'base64'));
			return {
				bytes: Buffer.from(canonicalContractBytes(value)).toString('base64'),
				digest: canonicalContractDigest(value)
			};
		};
		if (fixture.reject) assert.throws(run);
		else assert.deepEqual(run(), { bytes: fixture.canonical_base64, digest: fixture.sha256 });
	});

void test('canonical writer rejects coercion accessors cycles sparse arrays and byte/depth overflow', () => {
	const cyclic: Record<string, unknown> = {};
	cyclic.self = cyclic;
	for (const value of [
		undefined,
		NaN,
		Infinity,
		1.5,
		new Date(),
		cyclic,
		[undefined],
		new Array(1),
		{
			get x() {
				return assert.fail('getter must not run');
			}
		},
		{ [Symbol('secret')]: 1 },
		{ x: '\ud800' }
	]) {
		assert.throws(() => canonicalContractBytes(value), TypeError);
	}
	assert.throws(() => canonicalContractBytes({ value: 'large' }, 4), TypeError);
	assert.throws(() => parseStrictContractJson(Buffer.from('{}'), { maxBytes: 1 }), TypeError);
	assert.throws(() => parseStrictContractJson(Buffer.from('\ufeff{}')), TypeError);
});

void test('ordinary API decimals remain available without accepting duplicate keys or rounded integers', () => {
	assert.deepEqual(
		parseStrictContractJson(Buffer.from('{"amount":1.5}'), { integerNumbersOnly: false }),
		{ amount: 1.5 }
	);
	assert.throws(() =>
		parseStrictContractJson(Buffer.from('{"a":1,"a":2}'), { integerNumbersOnly: false })
	);
	assert.throws(() =>
		parseStrictContractJson(Buffer.from('9007199254740992'), { integerNumbersOnly: false })
	);
});
