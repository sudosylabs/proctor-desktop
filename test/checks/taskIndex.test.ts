import assert from 'node:assert/strict';
import { test } from 'node:test';
import { packageScripts, renderTaskIndex, tasks } from '../../build/tasks.ts';

void test('every npm script is described exactly once and no description is stale', () => {
	const scripts = new Set(packageScripts().filter((name) => name !== 'tasks'));
	assert.deepEqual(
		[...scripts].filter((name) => !(name in tasks)),
		[],
		'scripts missing from build/tasks.ts'
	);
	assert.deepEqual(
		Object.keys(tasks).filter((name) => !scripts.has(name)),
		[],
		'described tasks without a package.json script'
	);
});

void test('the index groups tasks and names each description', () => {
	const index = renderTaskIndex();
	assert.match(index, /^verify\n/);
	assert.match(index, /check:docs\s+Documentation/);
});
