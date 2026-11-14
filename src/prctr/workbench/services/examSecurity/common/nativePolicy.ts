/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import type { components } from '../../../../platform/serverApi/common/serverApi.generated.js';
import {
	isPolicy,
	type Policy
} from '../../../../platform/native/common/nativeAgentProtocol.generated.js';

export type EffectiveExamSecurityPolicy = components['schemas']['EffectiveExamSecurityPolicy'];

/** The server's policy cannot be run by this agent; Start must not proceed. */
export class NativePolicyError extends Error {
	public constructor(message: string) {
		super(message);
		this.name = 'NativePolicyError';
	}
}

/**
 * The agent's policy from the server's frozen policy: its activations and compiled rules,
 * unchanged. The server compiles both in the rule grammar the agent publishes, so this is a
 * validated projection; anything the agent's protocol would refuse is refused here first.
 */
export function agentPolicy(
	policy: Pick<EffectiveExamSecurityPolicy, 'activations' | 'rules'>
): Policy {
	const candidate: unknown = {
		activations: policy.activations.map((activation) => ({
			capability: activation.capability,
			categories: [...activation.categories]
		})),
		rules: policy.rules.map((rule) => ({
			rule_id: rule.rule_id,
			capability: rule.capability,
			mode: rule.mode,
			phase: rule.phase,
			reason: rule.reason,
			requirement: rule.requirement
		}))
	};
	if (!isPolicy(candidate))
		throw new NativePolicyError('the policy is outside the native agent protocol');
	return candidate;
}

/** Whether the policy records the screen on the device. */
export function recordsScreen(
	policy: Pick<EffectiveExamSecurityPolicy, 'screen_recording'>
): boolean {
	return policy.screen_recording.enabled;
}
