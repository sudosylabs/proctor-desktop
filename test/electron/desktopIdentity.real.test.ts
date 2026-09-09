import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { test } from 'node:test';
import { electronExecutable } from '../../build/lib/electron.ts';
import { repositoryRoot } from '../../build/lib/paths.ts';

void test('native signing custody, encrypted refresh persistence, and isolated authenticated handoff', () => {
	const result = JSON.parse(
		execFileSync(electronExecutable(), ['.build/desktop-identity-tests'], {
			cwd: repositoryRoot,
			encoding: 'utf8',
			timeout: 45000
		}).trim()
	);
	assert.deepEqual(result, {
		exclusiveCustody: true,
		nativeSignature: true,
		persistentKey: true,
		encryptedRefresh: true,
		authenticatedHandoff: true,
		signedOut: true
	});
});
