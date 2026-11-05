import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { hygieneCheck } from '../../build/checks/documentation.ts';
import { VirtualRepository } from '../../build/checks/repository.ts';

const context = (files: Readonly<Record<string, string>>) => ({
	repository: new VirtualRepository(files),
	registeredCheckIds: new Set<string>()
});
const usersRoot = `/${'Users'}/`;
const fileScheme = `file:${'//'}`;

void test('hygiene rejects unowned absolute paths', () => {
	const diagnostics = hygieneCheck.run(
		context({
			'src/prctr/platform/common/example.ts': `export const path = '${usersRoot}example/checkout/file.ts';\n`
		})
	);
	assert.ok(Array.isArray(diagnostics));
	assert.match(diagnostics[0]?.problem ?? '', /machine-specific absolute path/);
});

void test('hygiene permits exact upstream path fixtures only in the admitted base area', () => {
	const diagnostics = hygieneCheck.run(
		context({
			'src/prctr/base/common/example.ts': `// @proctor-vscode-port base-common-runtime\nexport const fixture = '${fileScheme}${usersRoot}example/file.ts';\n`
		})
	);
	assert.deepStrictEqual(diagnostics, []);
});

void test('hygiene permits provenance-owned upstream fixtures in admitted platform clusters', () => {
	const diagnostics = hygieneCheck.run(
		context({
			'src/prctr/platform/contextkey/common/example.ts': `// @proctor-vscode-port platform-context-conditions\nexport const scheme = '${fileScheme}';\n`,
			'test/platform/contextkey/common/upstream/example.test.ts': `// @proctor-vscode-port platform-context-conditions\nexport const path = '${fileScheme}${usersRoot}fixture/file.ts';\n`
		})
	);
	assert.deepStrictEqual(diagnostics, []);
});

void test('hygiene does not permit markers to exempt unrelated test locations', () => {
	const diagnostics = hygieneCheck.run(
		context({
			'test/platform/contextkey/common/example.test.ts': `// @proctor-vscode-port platform-context-conditions\nexport const path = '${usersRoot}example/checkout/file.ts';\n`
		})
	);
	assert.ok(Array.isArray(diagnostics));
	assert.match(diagnostics[0]?.problem ?? '', /machine-specific absolute path/);
});

void test('exact copied JSON assets preserve upstream JSONC and terminal whitespace without exempting drift', () => {
	const asset = 'src/prctr/editor/common/example.json';
	const source = '{\n // pinned comment\n "value": 1,\n}';
	const record =
		JSON.stringify({
			items: [
				{
					disposition: 'copied',
					category: 'asset',
					localPath: asset,
					localSha256: createHash('sha256').update(source).digest('hex')
				}
			]
		}) + '\n';
	const files = { 'docs/upstream/vscode-ports/example.json': record, [asset]: source };
	assert.deepEqual(hygieneCheck.run(context(files)), []);
	assert.notDeepEqual(hygieneCheck.run(context({ ...files, [asset]: source + ' ' })), []);
	const invalid = '{not JSONC';
	const invalidRecord =
		JSON.stringify({
			items: [
				{
					disposition: 'copied',
					category: 'asset',
					localPath: asset,
					localSha256: createHash('sha256').update(invalid).digest('hex')
				}
			]
		}) + '\n';
	assert.notDeepEqual(
		hygieneCheck.run(
			context({ 'docs/upstream/vscode-ports/example.json': invalidRecord, [asset]: invalid })
		),
		[]
	);
});

void test('hygiene rejects authored comments that cite repository guidance', () => {
	const cited = (comment: string) => {
		const diagnostics = hygieneCheck.run(
			context({
				'src/prctr/platform/common/example.ts': `${comment}\nexport const value = 1;\n`
			})
		);
		assert.ok(Array.isArray(diagnostics));
		return diagnostics;
	};
	for (const comment of [
		'// See docs/architecture/workbench.md for the lifecycle.',
		'/** Described in .agents/skills/example/SKILL.md */',
		' * Tracked under .scratch/plan.md'
	])
		assert.match(cited(comment)[0]?.problem ?? '', /cites repository guidance/, comment);
	for (const comment of [
		'// See https://www.electronjs.org/docs/latest/api/accelerator.',
		'// Owns the lifecycle of each window.'
	])
		assert.deepStrictEqual(cited(comment), [], comment);
});

void test('hygiene leaves comments in admitted upstream ports alone', () => {
	assert.deepStrictEqual(
		hygieneCheck.run(
			context({
				'src/prctr/platform/common/example.ts':
					'// @proctor-vscode-port base-common-runtime\n// See docs/monitoring/guide.md\n'
			})
		),
		[]
	);
});
