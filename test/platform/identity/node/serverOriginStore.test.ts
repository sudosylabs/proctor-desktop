import assert from 'node:assert';
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { FileServerOriginStore } from '../../../../src/prctr/platform/identity/node/serverOriginStore.ts';

void test('the remembered server survives a restart, is forgotten on request, and ignores damage', async () => {
	const directory = await mkdtemp(join(tmpdir(), 'prctr-server-origin-'));
	try {
		const path = join(directory, 'nested', 'institution-server.json');
		const first = await FileServerOriginStore.open(path);
		assert.strictEqual(first.read(), undefined);
		first.write('https://exams.example.edu');
		await first.flush();
		const second = await FileServerOriginStore.open(path);
		assert.strictEqual(second.read(), 'https://exams.example.edu');
		assert.deepStrictEqual(JSON.parse(await readFile(path, 'utf8')), {
			origin: 'https://exams.example.edu'
		});
		second.clear();
		assert.strictEqual(second.read(), undefined);
		await second.flush();
		await assert.rejects(access(path), 'forgetting removes the file');
		assert.strictEqual((await FileServerOriginStore.open(path)).read(), undefined);
		for (const content of [
			'not json',
			'{"origin":7}',
			'{"origin":""}',
			`{"origin":"${'a'.repeat(2049)}"}`,
			'[]',
			'null'
		]) {
			await writeFile(path, content);
			assert.strictEqual((await FileServerOriginStore.open(path)).read(), undefined, content);
		}
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});
