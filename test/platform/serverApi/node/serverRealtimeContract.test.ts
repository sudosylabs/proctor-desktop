import assert from 'node:assert/strict';
import { test } from 'node:test';
import { serverEventCatalog } from '../../../../src/prctr/platform/serverApi/common/serverEvents.generated.js';
import { isValidServerEventPayload } from '../../../../src/prctr/platform/serverApi/node/serverRealtimeContract.js';

void test('every event copy in the packaged realtime contract has an executable payload schema', () => {
	const variants = Object.values(serverEventCatalog).flatMap((copies) => Object.values(copies));
	assert.ok(variants.length >= 44);
	for (const schema of variants)
		assert.equal(typeof isValidServerEventPayload(schema, {}), 'boolean');
});

void test('a payload is checked against its schema and tolerates fields a newer server adds', () => {
	const settings = {
		revision: 'ybndrfg8ejkmcpqxot1uwisza3',
		format_version: 1,
		changed_at: '2026-11-12T09:30:00Z'
	};
	assert.equal(isValidServerEventPayload('user_settings_changed', settings), true);
	assert.equal(
		isValidServerEventPayload('user_settings_changed', { ...settings, added: true }),
		true
	);
	assert.equal(
		isValidServerEventPayload('user_settings_changed', { ...settings, revision: 7 }),
		false
	);
	assert.equal(isValidServerEventPayload('not_a_schema', settings), false);
	assert.equal(isValidServerEventPayload(null, undefined), true);
	assert.equal(isValidServerEventPayload(null, { unexpected: true }), false);
});
