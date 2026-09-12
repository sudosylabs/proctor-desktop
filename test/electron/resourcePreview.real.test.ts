import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import test from 'node:test';
import { electronExecutable } from '../../build/lib/electron.ts';
import { repositoryRoot } from '../../build/lib/paths.ts';
void test('authorized Markdown image and PDF hosts render inside isolated native runtime', () => {
	const result = JSON.parse(
		execFileSync(electronExecutable(), ['.build/resource-preview-tests'], {
			cwd: repositoryRoot,
			encoding: 'utf8',
			timeout: 30000
		}).trim()
	);
	assert.deepEqual(result, {
		passed: true,
		markdown: true,
		image: true,
		pdfTextLayer: true,
		isolated: true
	});
});
