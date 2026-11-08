import assert from 'node:assert';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { FileWindowAppearanceStore } from '../../../../src/prctr/platform/windows/node/windowAppearanceStore.ts';

void test('the remembered window scheme survives a restart and falls back to System', async () => {
	const directory = await mkdtemp(join(tmpdir(), 'prctr-appearance-'));
	try {
		const path = join(directory, 'nested', 'window-appearance.json');
		const first = await FileWindowAppearanceStore.open(path);
		assert.strictEqual(first.read(), 'system');
		first.write('dark');
		assert.strictEqual(first.read(), 'dark');
		await first.flush();
		assert.strictEqual((await FileWindowAppearanceStore.open(path)).read(), 'dark');
		assert.deepStrictEqual(JSON.parse(await readFile(path, 'utf8')), { scheme: 'dark' });
		for (const content of ['not json', '{"scheme":"sepia"}', '[]', 'null']) {
			await writeFile(path, content);
			assert.strictEqual(
				(await FileWindowAppearanceStore.open(path)).read(),
				'system',
				content
			);
		}
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});
