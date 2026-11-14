import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import {
	NATIVE_AGENT_PROTOCOL_DIGEST,
	isAgentMessage,
	isCondition,
	isMainMessage,
	isPolicy
} from '../../../../src/prctr/platform/native/common/nativeAgentProtocol.generated.ts';

const vectors = JSON.parse(
	readFileSync('native/crates/prctr-core/conformance/rules.json', 'utf8')
) as {
	readonly cases: readonly { readonly name: string; readonly policy: unknown }[];
};

void test('the digest is the committed hash of the Rust protocol schema', () => {
	const committed = readFileSync(
		'native/crates/prctr-protocol/schema/agent-protocol.digest',
		'utf8'
	).trim();
	assert.equal(NATIVE_AGENT_PROTOCOL_DIGEST, committed);
});

void test('every conformance policy has the wire shape the agent accepts', () => {
	for (const vector of vectors.cases) assert.ok(isPolicy(vector.policy), vector.name);
});

void test('main messages accept their documented shape and refuse anything else', () => {
	assert.ok(isMainMessage({ kind: 'acknowledge', up_to: 1 }));
	assert.ok(
		isMainMessage({ kind: 'request', request_id: 2, request: { kind: 'begin_participation' } })
	);
	assert.equal(
		isMainMessage({ kind: 'acknowledge', up_to: 1, extra: true }),
		false,
		'unknown field'
	);
	assert.equal(isMainMessage({ kind: 'acknowledge', up_to: 2 ** 53 }), false, 'unsafe integer');
	assert.equal(isMainMessage({ kind: 'acknowledge', up_to: -1 }), false, 'negative count');
	assert.equal(isMainMessage({ kind: 'shutdown' }), false, 'unknown kind');
	assert.equal(
		isMainMessage({
			kind: 'request',
			request_id: 1,
			request: { kind: 'query', capability: 'Display' }
		}),
		false,
		'identifier pattern'
	);
});

void test('conditions are a closed, recursive union', () => {
	const compare = { Compare: { field: 'display.summary.active_physical', op: 'eq', value: 1 } };
	assert.ok(isCondition({ All: { conditions: [compare, { Not: { condition: compare } }] } }));
	assert.ok(isCondition({ AppsAbsent: { catalog_app_ids: ['teamviewer'] } }));
	assert.equal(
		isCondition({ All: { conditions: [], extra: 1 } }),
		false,
		'unknown field inside a group'
	);
	assert.equal(
		isCondition({ Compare: compare.Compare, All: { conditions: [] } }),
		false,
		'two variants'
	);
	assert.equal(isCondition({ Xor: { conditions: [] } }), false, 'unknown variant');
});

void test('agent notifications carry facts with any capability state', () => {
	const fact = {
		capability: 'display',
		source_instance_id: 'instance0001',
		sequence: 0,
		captured_at_ms: 10,
		envelope: { permission: 'granted', health: 'healthy', certainty: 'complete' },
		state: { targets: [] },
		summary: { active_physical: 0 },
		changes: []
	};
	assert.ok(
		isAgentMessage({
			kind: 'notification',
			message_number: 1,
			notification: { kind: 'fact', fact }
		})
	);
	assert.equal(
		isAgentMessage({
			kind: 'notification',
			message_number: 1,
			notification: {
				kind: 'fact',
				fact: { ...fact, envelope: { ...fact.envelope, health: 'fine' } }
			}
		}),
		false
	);
});
