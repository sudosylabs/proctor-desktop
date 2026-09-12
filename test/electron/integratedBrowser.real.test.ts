import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import test from 'node:test';
import { electronExecutable } from '../../build/lib/electron.ts';
import { repositoryRoot } from '../../build/lib/paths.ts';

void test('native integrated browser isolates documents and destroys the runtime on pause', () => {
	const result = JSON.parse(
		execFileSync(electronExecutable(), ['.build/integrated-browser-tests'], {
			cwd: repositoryRoot,
			encoding: 'utf8',
			timeout: 30_000
		}).trim()
	);
	assert.deepEqual(result, {
		passed: true,
		sandboxed: true,
		networkDenied: true,
		popupDenied: true,
		pauseDestroyed: true,
		ephemeralResume: true
	});
});
