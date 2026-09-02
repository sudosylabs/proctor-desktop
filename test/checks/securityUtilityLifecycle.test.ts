import { strict as assert } from 'node:assert';
import test from 'node:test';

import { SecurityUtilityLifecycle } from '../../src/prctr/platform/native/electron-main/securityUtilityLifecycle.ts';

void test('ready then immediate process exit cannot publish a dead utility as active', async () => {
	const lifecycle = new SecurityUtilityLifecycle();
	const generation = lifecycle.beginLaunch();
	if (generation === undefined) assert.fail('launch generation was not created');

	await Promise.resolve('ready');
	assert.equal(lifecycle.fail(generation), true);

	assert.equal(lifecycle.activate(generation), false);
	assert.equal(lifecycle.state, 'failed_closed');
	assert.equal(lifecycle.isActive(generation), false);
});

void test('stale utility failure cannot poison a later launch generation', () => {
	const lifecycle = new SecurityUtilityLifecycle();
	const first = lifecycle.beginLaunch();
	if (first === undefined) assert.fail('first launch generation was not created');
	assert.equal(lifecycle.activate(first), true);
	assert.equal(lifecycle.beginStopping(first), true);
	assert.equal(lifecycle.completeStop(first), true);

	const second = lifecycle.beginLaunch();
	if (second === undefined) assert.fail('second launch generation was not created');
	assert.notEqual(second, first);
	assert.equal(lifecycle.fail(first), false);
	assert.equal(lifecycle.activate(second), true);
	assert.equal(lifecycle.state, 'active');
});
