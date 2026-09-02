import assert from 'node:assert';
import { test } from 'node:test';
import {
	PerformanceBudgetRegistry,
	PerformanceService
} from '../../../../src/prctr/platform/performance/common/performance.ts';

void test('performance snapshots retain marks, missing evidence, and budget failures', () => {
	const registry = new PerformanceBudgetRegistry();
	registry.register({
		id: 'prctr.test.firstFrame',
		owner: 'fixture',
		startMark: 'prctr/test/start',
		endMark: 'prctr/test/end',
		maximumDurationMs: 10
	});
	registry.register({
		id: 'prctr.test.missing',
		owner: 'fixture',
		startMark: 'prctr/test/missing-start',
		endMark: 'prctr/test/missing-end',
		maximumDurationMs: 5
	});
	const service = new PerformanceService(registry);
	service.clear();
	service.mark('prctr/test/start', 100);
	service.mark('prctr/test/end', 112);

	const snapshot = service.snapshot();
	assert.strictEqual(snapshot.measurements.length, 1);
	assert.strictEqual(snapshot.measurements[0]?.durationMs, 12);
	assert.strictEqual(snapshot.measurements[0]?.withinBudget, false);
	assert.strictEqual(snapshot.missingBudgets[0]?.id, 'prctr.test.missing');
	assert.strictEqual(Object.isFrozen(snapshot.marks), true);
	assert.strictEqual(Object.isFrozen(snapshot.marks[0]), true);
	assert.throws(() => {
		(snapshot.marks[0] as { name: string }).name = 'mutated';
	});
	assert.throws(() =>
		registry.register({
			id: 'prctr.test.firstFrame',
			owner: 'duplicate',
			startMark: 'prctr/test/start',
			endMark: 'prctr/test/end',
			maximumDurationMs: 1
		})
	);
	service.clear();
});
