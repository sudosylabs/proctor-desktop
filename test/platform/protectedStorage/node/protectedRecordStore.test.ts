import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, readdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import {
	EncryptedRecordStore,
	ProtectedStorageError
} from '../../../../src/prctr/platform/protectedStorage/node/protectedRecordStore.js';

void test('protected records survive reopen, encrypt bytes and authenticate key/name/scope', async () => {
	const directory = await mkdtemp(join(tmpdir(), 'proctor-record-test-'));
	const key = randomBytes(32);
	const options = {
		directory,
		key,
		scope: 'principal:attempt:workspace',
		maximumRecordBytes: 128,
		maximumTotalBytes: 256,
		maximumRecords: 2,
		authorized: () => true
	};
	let store = new EncryptedRecordStore(options);
	try {
		await store.write('one', new TextEncoder().encode('sensitive exam content'));
		await store.write('two', new Uint8Array([1, 2, 3]));
		const partition = (await readdir(directory))[0]!;
		const ciphertext = await readFile(join(directory, partition, 'one.record'));
		assert.equal(ciphertext.includes(Buffer.from('sensitive exam content')), false);
		store.dispose();
		await new Promise((resolve) => setImmediate(resolve));
		store = new EncryptedRecordStore(options);
		assert.equal(new TextDecoder().decode(await store.read('one')), 'sensitive exam content');
		await writeFile(join(directory, partition, 'two.record'), ciphertext);
		await assert.rejects(
			store.read('two'),
			(error: unknown) => error instanceof ProtectedStorageError && error.code === 'corrupt'
		);
	} finally {
		store.dispose();
		await new Promise((resolve) => setImmediate(resolve));
		await rm(directory, { recursive: true, force: true });
	}
});
void test('protected record bounds serialize writers and revocation rejects queued work', async () => {
	const directory = await mkdtemp(join(tmpdir(), 'proctor-record-test-'));
	let authorized = true;
	const store = new EncryptedRecordStore({
		directory,
		key: randomBytes(32),
		scope: 'browser',
		maximumRecordBytes: 8,
		maximumTotalBytes: 8,
		maximumRecords: 2,
		authorized: () => authorized
	});
	try {
		const results = await Promise.allSettled([
			store.write('one', new Uint8Array(6)),
			store.write('two', new Uint8Array(6))
		]);
		assert.deepEqual(
			results.map((value) => value.status),
			['fulfilled', 'rejected']
		);
		assert.deepEqual(await store.list(), ['one']);
		await assert.rejects(store.write('../escape', new Uint8Array()));
		authorized = false;
		await assert.rejects(
			store.read('one'),
			(error: unknown) => error instanceof ProtectedStorageError && error.code === 'denied'
		);
	} finally {
		store.dispose();
		await new Promise((resolve) => setImmediate(resolve));
		await rm(directory, { recursive: true, force: true });
	}
});
