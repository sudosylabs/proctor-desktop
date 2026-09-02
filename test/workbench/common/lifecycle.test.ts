import assert from 'node:assert';
import { test } from '../../base/common/upstream/testAdapter.ts';
import { WorkbenchContributionActivator, WorkbenchLifecycleService, type WorkbenchContribution } from '../../../src/prctr/workbench/common/lifecycle.ts';

test('lifecycle is strictly monotonic', () => {
	const lifecycle = new WorkbenchLifecycleService(); const phases: string[] = []; lifecycle.onDidAdvancePhase(phase => phases.push(phase)); lifecycle.advance('starting'); lifecycle.advance('ready'); assert.throws(() => lifecycle.advance('ready'), /cannot move/u); assert.deepStrictEqual(phases, ['starting', 'ready']); lifecycle.dispose();
});

test('activator respects dependencies, activates once, and isolates failure', async () => {
	const calls: string[] = []; const contributions: WorkbenchContribution[] = [
		{ id: 'prctr.a', phase: 'starting', blocksPhase: true, activate: () => { calls.push('a'); } },
		{ id: 'prctr.b', phase: 'ready', dependencies: ['prctr.a'], activate: () => { calls.push('b'); throw new Error('failure'); } },
		{ id: 'prctr.c', phase: 'ready', dependencies: ['prctr.b'], activate: () => { calls.push('c'); } },
		{ id: 'prctr.d', phase: 'ready', activate: () => { calls.push('d'); } }
	];
	const activator = new WorkbenchContributionActivator(contributions, new Set(['prctr.a'])); await activator.activateThrough('ready'); await activator.activateThrough('eventually');
	assert.deepStrictEqual(calls, ['a', 'b', 'd']); assert.deepStrictEqual(activator.results.map(result => [result.id, result.state]), [['prctr.a', 'activated'], ['prctr.b', 'failed'], ['prctr.c', 'skipped'], ['prctr.d', 'activated']]);
});
