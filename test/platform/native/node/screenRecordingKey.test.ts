/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import {
	ScreenRecordingKeyError,
	ScreenRecordingKeys,
	type RecordingKeySeal
} from '../../../../src/prctr/platform/native/node/screenRecordingKey.ts';

/** A reversible stand-in for the OS keystore. */
const seal: RecordingKeySeal = {
	isEncryptionAvailable: () => true,
	encryptString: (plain) => Buffer.from(`sealed:${plain}`).reverse(),
	decryptString: (sealed) => {
		const text = Buffer.from(sealed).reverse().toString();
		if (!text.startsWith('sealed:')) throw new Error('not sealed');
		return text.slice('sealed:'.length);
	}
};

void test('an Attempt keeps one recording and key across relaunches, and delete removes both', async () => {
	const root = mkdtempSync(join(tmpdir(), 'prctr-keys-'));
	try {
		const keys = new ScreenRecordingKeys(root, seal);
		const first = await keys.open('attempt-1');
		assert.match(first.key, /^[A-Za-z0-9_-]{43}$/);
		assert.match(first.recording_id, /^recording-[A-Za-z0-9_-]{32}$/);
		assert.ok(!first.recording_id.includes('attempt-1'), 'the Attempt ID is not on disk');
		const again = await new ScreenRecordingKeys(root, seal).open('attempt-1');
		assert.deepEqual(again, first, 'a relaunch resumes the same recording');
		const other = await keys.open('attempt-2');
		assert.notEqual(other.key, first.key);
		writeFileSync(join(first.directory, '..', 'stray'), 'x');
		await keys.delete('attempt-1');
		assert.ok(!existsSync(join(first.directory, '..')));
		assert.notDeepEqual(await keys.open('attempt-1'), first, 'a new key after deletion');
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

void test('no keystore or an unreadable key refuses to record rather than store a plain key', async () => {
	const root = mkdtempSync(join(tmpdir(), 'prctr-keys-'));
	try {
		const unavailable = new ScreenRecordingKeys(root, {
			...seal,
			isEncryptionAvailable: () => false
		});
		await assert.rejects(
			unavailable.open('attempt-1'),
			(error: unknown) =>
				error instanceof ScreenRecordingKeyError && error.reason === 'keystore_unavailable'
		);
		const keys = new ScreenRecordingKeys(root, seal);
		const start = await keys.open('attempt-1');
		writeFileSync(join(start.directory, '..', 'recording.key'), 'garbage');
		await assert.rejects(
			keys.open('attempt-1'),
			(error: unknown) =>
				error instanceof ScreenRecordingKeyError && error.reason === 'key_unreadable'
		);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});
