import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import test from 'node:test';
import { electronExecutable } from '../../build/lib/electron.ts';
import { repositoryRoot } from '../../build/lib/paths.ts';

void test('packaged editor workers and tokenizers retain language features and bounded asset access in the sandbox', () => {
	const result: unknown = JSON.parse(
		execFileSync(electronExecutable(), ['.build/editor-worker-tests'], {
			cwd: repositoryRoot,
			encoding: 'utf8',
			timeout: 25_000
		}).trim()
	);
	assert.deepEqual(result, { passed: true, cycles: 3, hasNode: false });
});
