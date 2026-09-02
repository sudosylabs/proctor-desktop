import assert from 'node:assert';
import { test } from 'node:test';
import {
	ContextKeyExpr,
	RawContextKey,
	type ContextKeyValue
} from '../../../../src/prctr/platform/contextkey/common/contextkey.ts';
import {
	CandidateInteractionAllowedContext,
	WorkbenchDirectionContext,
	WorkbenchWindowKindContext
} from '../../../../src/prctr/workbench/common/contextKeys.ts';

void test('Proctor context keys are namespaced and remain expression inputs', () => {
	assert.strictEqual(WorkbenchWindowKindContext.key, 'prctr.workbench.windowKind');
	assert.strictEqual(
		CandidateInteractionAllowedContext.key,
		'prctr.candidate.interactionAllowed'
	);
	assert.strictEqual(WorkbenchDirectionContext.key, 'prctr.localization.direction');

	const expression = ContextKeyExpr.and(
		WorkbenchWindowKindContext.isEqualTo('candidate'),
		CandidateInteractionAllowedContext
	);
	const values: Record<string, ContextKeyValue> = {
		'prctr.workbench.windowKind': 'candidate',
		'prctr.candidate.interactionAllowed': true
	};
	assert.strictEqual(
		expression?.evaluate({
			getValue<T extends ContextKeyValue>(key: string): T | undefined {
				return values[key] as T | undefined;
			}
		}),
		true
	);
	assert.ok([...RawContextKey.all()].some((info) => info.key === 'prctr.workbench.windowKind'));
});
