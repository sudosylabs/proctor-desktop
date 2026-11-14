/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert';

import { test } from '../../../../base/common/upstream/testAdapter.ts';

import {
	agentPolicy,
	NativePolicyError,
	recordsScreen,
	type EffectiveExamSecurityPolicy
} from '../../../../../src/prctr/workbench/services/examSecurity/common/nativePolicy.ts';
import { uncertifiedCapabilities } from '../../../../../src/prctr/workbench/services/examSecurity/common/certification.ts';

type Rule = EffectiveExamSecurityPolicy['rules'][number];

const DIGEST = 'sha256:e4c05771fa6f34c08c0f01aa98e33f88973baacf832c67d760457f2b4f9d734d';

function rule(rule_id: string, capability: string, mode: 'enforce' | 'observe'): Rule {
	return {
		rule_id,
		capability,
		mode,
		phase: 'both',
		reason: `${capability}.reason`,
		requirement: { Compare: { field: `${capability}.summary.count`, op: 'eq', value: 0 } }
	};
}

const policy: Pick<
	EffectiveExamSecurityPolicy,
	'activations' | 'rules' | 'screen_recording' | 'target_tuple' | 'registry_digest'
> = {
	activations: [
		{ capability: 'display', categories: [] },
		{ capability: 'clipboard', categories: [] }
	],
	rules: [
		rule('baseline.single_display', 'display', 'enforce'),
		rule('clipboard.quiet', 'clipboard', 'observe')
	],
	screen_recording: { enabled: true },
	target_tuple: 'x86_64-pc-windows-msvc',
	registry_digest: DIGEST
};

test('the agent policy keeps the activations and compiled rules unchanged', () => {
	const mapped = agentPolicy(policy);
	assert.deepStrictEqual(mapped.activations, policy.activations);
	assert.deepStrictEqual(
		mapped.rules.map((entry) => entry.rule_id),
		['baseline.single_display', 'clipboard.quiet']
	);
	assert.strictEqual(recordsScreen(policy), true);
});

test('a rule the agent protocol cannot express is refused before it reaches the agent', () => {
	const tooLong = { ...policy, rules: [rule(`a${'b'.repeat(70)}`, 'display', 'enforce')] };
	assert.throws(() => agentPolicy(tooLong), NativePolicyError);
});

test('development certifies every capability and missing evidence certifies none', () => {
	assert.deepStrictEqual(uncertifiedCapabilities(policy, { kind: 'development' }), []);
	assert.deepStrictEqual(uncertifiedCapabilities(policy, { kind: 'none' }), ['display']);
});

test('a signed document certifies per capability for its own target and registry only', () => {
	const document = {
		registry_digest: DIGEST,
		matrix_id: 'matrix-1',
		release_id: 'release-1',
		target_tuple: 'x86_64-pc-windows-msvc',
		capabilities: [
			{ capability: 'clipboard', enforce_certified: false },
			{ capability: 'display', enforce_certified: true }
		]
	};
	assert.deepStrictEqual(uncertifiedCapabilities(policy, { kind: 'document', document }), []);
	assert.deepStrictEqual(
		uncertifiedCapabilities(policy, {
			kind: 'document',
			document: { ...document, target_tuple: 'aarch64-apple-darwin' }
		}),
		['display'],
		'another target certifies nothing here'
	);
	assert.deepStrictEqual(
		uncertifiedCapabilities(policy, {
			kind: 'document',
			document: { ...document, registry_digest: 'sha256:' + '00'.repeat(32) }
		}),
		['display'],
		'another registry certifies nothing here'
	);
	const observeOnly = { ...policy, rules: [rule('clipboard.quiet', 'clipboard', 'observe')] };
	assert.deepStrictEqual(
		uncertifiedCapabilities(observeOnly, { kind: 'none' }),
		[],
		'observe runs anywhere'
	);
});
