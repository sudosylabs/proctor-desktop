import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, symlinkSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import { WindowsNativeServiceInventoryBuilder } from '../../build/lib/windowsNativeServicePackage.ts';

void test('Windows service inventory binds every exact client byte with deterministic relative paths', (t) => {
	const root = realpathSync(mkdtempSync(join(tmpdir(), 'prctr-win-inventory-')));
	t.after(() => rmSync(root, { recursive: true, force: true }));
	writeFileSync(join(root, 'Proctor.exe'), 'client');
	mkdirSync(join(root, 'resources'));
	writeFileSync(join(root, 'resources/app.asar'), 'archive');
	const builder = new WindowsNativeServiceInventoryBuilder();
	const first = builder.build(root, 'test-release-1', 'Proctor.exe');
	assert.equal(first.schema_version, 1);
	assert.deepEqual(
		first.files.map((file) => file.relative_path),
		['Proctor.exe', 'resources/app.asar']
	);
	assert.deepEqual(builder.build(root, 'test-release-1', 'Proctor.exe'), first);
	writeFileSync(join(root, 'resources/app.asar'), 'changed');
	assert.notEqual(
		builder.build(root, 'test-release-1', 'Proctor.exe').files[1]?.sha256,
		first.files[1]?.sha256
	);
});

void test('Windows service inventory rejects aliases, links, missing main and unsafe release paths', (t) => {
	const root = realpathSync(mkdtempSync(join(tmpdir(), 'prctr-win-inventory-')));
	t.after(() => rmSync(root, { recursive: true, force: true }));
	writeFileSync(join(root, 'Proctor.exe'), 'client');
	const builder = new WindowsNativeServiceInventoryBuilder();
	for (const release of ['../release', '', 'a'.repeat(65)])
		assert.throws(() => builder.build(root, release, 'Proctor.exe'));
	for (const executable of ['../Proctor.exe', 'Other.exe', 'C:/Proctor.exe', 'CON.exe'])
		assert.throws(() => builder.build(root, 'release', executable));
	symlinkSync(resolve(root, 'Proctor.exe'), join(root, 'extra.node'));
	assert.throws(() => builder.build(root, 'release', 'Proctor.exe'), /symlink/);
});

void test('Windows inventory rejects empty physical directories that the native closure cannot admit', (t) => {
	const root = realpathSync(mkdtempSync(join(tmpdir(), 'prctr-win-inventory-')));
	t.after(() => rmSync(root, { recursive: true, force: true }));
	writeFileSync(join(root, 'Proctor.exe'), 'client');
	mkdirSync(join(root, 'empty'));
	assert.throws(
		() => new WindowsNativeServiceInventoryBuilder().build(root, 'release', 'Proctor.exe'),
		/Empty package directory/
	);
});

void test('Windows build inventory respects the native retained-directory limit', (t) => {
	const root = realpathSync(mkdtempSync(join(tmpdir(), 'prctr-win-inventory-')));
	t.after(() => rmSync(root, { recursive: true, force: true }));
	writeFileSync(join(root, 'Proctor.exe'), 'client');
	for (let index = 0; index < 1366; index++) {
		const nested = join(root, `g${index}`, 'a', 'b');
		mkdirSync(nested, { recursive: true });
		writeFileSync(join(nested, 'data'), 'x');
	}
	assert.throws(
		() => new WindowsNativeServiceInventoryBuilder().build(root, 'release', 'Proctor.exe'),
		/native directory bound/
	);
});
