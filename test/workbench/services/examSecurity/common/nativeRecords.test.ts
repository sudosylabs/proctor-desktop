/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert';

import { test } from '../../../../base/common/upstream/testAdapter.ts';
import type {
	Fact,
	Policy,
	RuleStatus
} from '../../../../../src/prctr/platform/native/common/nativeAgentProtocol.generated.ts';
import {
	AgentClock,
	NativeRecordMapper
} from '../../../../../src/prctr/workbench/services/examSecurity/common/nativeRecords.ts';

const policy: Policy = {
	activations: [{ capability: 'display', categories: [] }],
	rules: [
		{
			rule_id: 'baseline.single_display',
			capability: 'display',
			mode: 'enforce',
			phase: 'both',
			reason: 'display.single_display_required',
			requirement: {
				Compare: { field: 'display.summary.active_physical', op: 'eq', value: 1 }
			}
		},
		{
			rule_id: 'screen_recording.free_space',
			capability: 'screen_recording',
			mode: 'enforce',
			phase: 'readiness',
			reason: 'screen_recording.low_disk_space',
			requirement: {
				Compare: { field: 'screen_recording.summary.free_space_mib', op: 'ge', value: 3072 }
			}
		}
	]
};

const fact: Fact = {
	capability: 'display',
	source_instance_id: 'display00001',
	sequence: 4,
	captured_at_ms: 2_000,
	envelope: { permission: 'granted', health: 'healthy', certainty: 'complete' },
	state: { displays: [] },
	summary: { active_physical: 1 },
	changes: []
};

function status(rule_id: string, value: RuleStatus['status']): RuleStatus {
	return { rule_id, status: value, local_effect: 'none' };
}

test('a fact keeps its envelope and is stamped in wall time from the agent clock', () => {
	let now = 1_000_000;
	const clock = new AgentClock(() => now);
	clock.heartbeat(1_500);
	now = 1_000_900;
	const record = new NativeRecordMapper(policy, clock, () => now).fact(fact);
	assert.deepStrictEqual(record, {
		kind: 'capability_fact',
		observed_at: new Date(1_000_500).toISOString(),
		capability: 'display',
		source_instance_id: 'display00001',
		sequence: 4,
		permission: 'granted',
		health: 'healthy',
		certainty: 'complete',
		state: { displays: [] },
		summary: { active_physical: 1 }
	});
});

test('rule statuses are reported only for participation rules, after confirmation, on change', () => {
	const mapper = new NativeRecordMapper(policy, new AgentClock(() => 0), () => 0);
	const statuses = [
		status('baseline.single_display', 'met'),
		status('screen_recording.free_space', 'not_met')
	];
	assert.deepStrictEqual(mapper.rules(statuses, false), [], 'nothing before confirmation');
	assert.strictEqual(mapper.participationConfirmed().kind, 'participation_confirmed');
	const first = mapper.rules(statuses, false);
	assert.deepStrictEqual(
		first.map((record) => (record.kind === 'rule_status' ? record.rule_id : '')),
		['baseline.single_display'],
		'readiness-only rules are never reported'
	);
	assert.deepStrictEqual(
		mapper.rules(statuses, false),
		[],
		'an unchanged status is not repeated'
	);
	assert.strictEqual(mapper.rules(statuses, true).length, 1, 'a containment change is reported');
});

test('gap reasons map onto the server vocabulary', () => {
	const mapper = new NativeRecordMapper(policy, new AgentClock(() => 0), () => 0);
	const record = mapper.gap({
		capability: 'display',
		source_instance_id: 'display00001',
		first_sequence: 2,
		last_sequence: 3,
		reason: 'flow_control'
	});
	assert.strictEqual(record.kind === 'source_gap' ? record.reason : '', 'overflow');
});
