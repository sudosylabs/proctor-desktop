import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RuleTester } from 'eslint';
import tseslint from 'typescript-eslint';
import ts from 'typescript';
import { upstreamDirectives } from '../../build/lint/upstreamDirectives.ts';
import { stockElectronExecutable } from '../../build/lib/electron.ts';
import { VirtualRepository } from '../../build/checks/repository.ts';
import { formattingIgnore } from '../../build/lib/formatOwnership.ts';
import { readIndex, stagedPaths } from '../../build/lib/indexRepository.ts';
import { repositoryPath, repositoryRoot, selectFiles } from '../../build/lib/paths.ts';
import { selectSuites, testSuites, type TestSuite } from '../../build/lib/testSuites.ts';
import {
	declareServiceBrand,
	disposableOwnership,
	noNewInjectable,
	noFocusedTests,
	noSynchronousFileSystem,
	noUnsafeDoubleAssertion,
	preferDomHelpers,
	preferElementFactory,
	requireLeakCheckedTests
} from '../../build/lint/rules.ts';

void test('test commands include every Node suite and close each Electron prerequisite', () => {
	assert.deepEqual(selectSuites('unit'), [
		'checks',
		'base',
		'platform',
		'editor',
		'security-utility',
		'native-agent'
	]);
	assert.deepEqual(selectSuites('electron'), [
		'browser',
		'window-skeleton',
		'integrated-browser',
		'resource-preview',
		'editor-worker',
		'desktop-identity',
		'electron-security'
	]);
	assert.throws(() => selectSuites('typo'), /Unknown/);
	const selected = new Set<string>();
	for (const suite of Object.values(testSuites)) {
		for (const path of selectFiles(suite.patterns)) {
			assert.ok(!selected.has(path), `duplicate test ${path}`);
			selected.add(path);
		}
		if (suite.runtime === 'electron') assert.ok('build' in suite);
	}
	const expected = selectFiles(['test/**/*.test.ts']).filter(
		(path) => !path.startsWith('test/browser/')
	);
	assert.deepEqual([...selected].sort(), expected);
	for (const suite of Object.values(testSuites) as TestSuite[])
		if (suite.build) assert.ok(readFileSync(repositoryPath(suite.build)).length);
});

void test('portable selectors reject unmatched and duplicate selections', () => {
	assert.throws(() => selectFiles(['test/no-such-suite-*.ts']), /matched no files/);
	assert.throws(() => selectFiles([]), /empty file selection/);
	assert.throws(
		() =>
			selectFiles([
				'test/checks/developerTooling.test.ts',
				'test/checks/developerTooling.test.ts'
			]),
		/more than once/
	);
	assert.throws(() => repositoryPath('../outside'), /relative repository path/);
});

void test('format protection derives from exact port and generator ownership', () => {
	const repository = new VirtualRepository({
		'docs/upstream/vscode-ports/sample.json': JSON.stringify({
			items: [{ localPath: 'src/prctr/base/common/transferred.ts' }]
		})
	});
	const ignore = formattingIgnore(repository, ['src/prctr/base/common/catalog.generated.ts']);
	assert.ok(ignore.includes('/src/prctr/base/common/transferred.ts\n'));
	assert.ok(ignore.includes('/src/prctr/base/common/catalog.generated.ts\n'));
	assert.ok(!ignore.split('\n').includes('src/'));
});

void test('index reads preserve partial staging, spaces, and working-copy content', () => {
	const root = mkdtempSync(join(tmpdir(), 'proctor-staged-test-'));
	const git = (...args: string[]) => execFileSync('git', args, { cwd: root });
	try {
		git('init', '--quiet');
		mkdirSync(join(root, 'folder'));
		const file = join(root, 'folder', 'space name.ts');
		writeFileSync(file, 'export const value = 1;\n');
		git('add', '--', 'folder/space name.ts');
		writeFileSync(file, 'export const value = 2;\n');
		const indexBefore = git('write-tree').toString();
		assert.deepEqual(stagedPaths(root), ['folder/space name.ts']);
		assert.equal(readIndex(root).read('folder/space name.ts'), 'export const value = 1;\n');
		assert.equal(readFileSync(file, 'utf8'), 'export const value = 2;\n');
		assert.equal(git('write-tree').toString(), indexBefore);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

void test('the editor discovers configured projects without Node ambient types in browser source', () => {
	const noop = () => {};
	const service = new ts.server.ProjectService({
		host: {
			...ts.sys,
			watchFile: () => ({ close: noop }),
			watchDirectory: () => ({ close: noop }),
			setTimeout,
			clearTimeout,
			setImmediate,
			clearImmediate
		},
		logger: {
			close: noop,
			hasLevel: () => false,
			loggingEnabled: () => false,
			perftrc: noop,
			info: noop,
			startGroup: noop,
			endGroup: noop,
			msg: noop,
			getLogFileName: () => undefined
		},
		cancellationToken: { isCancellationRequested: () => false },
		useSingleInferredProject: false,
		useInferredProjectPerProjectRoot: true,
		session: undefined
	});
	for (const path of [
		'build/lib/paths.ts',
		'src/prctr/base/browser/dom.ts',
		'test/electron/browserHarness.real.test.ts'
	]) {
		const file = repositoryPath(path);
		service.openClientFile(file, undefined, undefined, repositoryRoot);
		const project = service.getDefaultProjectForFile(ts.server.toNormalizedPath(file), true);
		assert.ok(project, path);
		assert.ok(!project.getProjectName().includes('inferredProject'), project.getProjectName());
		if (path.includes('/browser/')) {
			assert.deepEqual(project.getCompilerOptions().types, [
				'trusted-types',
				'@webgpu/types',
				'wicg-file-system-access'
			]);
			assert.ok(
				!project.getFileNames().some((file) => /node_modules\/@types\/node\//.test(file)),
				'Browser project acquired Node ambient declarations'
			);
		}
		service.closeClientFile(file);
	}
	service.closeLog();
});

void test('lint rules reject unsafe forms and accept the supported counterparts', () => {
	const tester = new RuleTester({ languageOptions: { parser: tseslint.parser } });
	tester.run('no-focused-tests', noFocusedTests, {
		valid: ["test('case', () => {});"],
		invalid: [
			{ code: "test.only('case', () => {});", errors: [{ messageId: 'focused' }] },
			{ code: "test('case', { only: true }, () => {});", errors: [{ messageId: 'focused' }] }
		]
	});
	tester.run('disposable-ownership', disposableOwnership, {
		valid: [
			'const store = new DisposableStore();',
			'class Owner { readonly store = new DisposableStore(); }'
		],
		invalid: [
			{ code: 'let store = new DisposableStore();', errors: [{ messageId: 'mutable' }] },
			{
				code: 'class Owner { store = new MutableDisposable(); }',
				errors: [{ messageId: 'mutable' }]
			}
		]
	});
	tester.run('no-new-injectable', noNewInjectable, {
		valid: [
			'class Plain { constructor(readonly value: number) {} }\nnew Plain(1);',
			'class Page { constructor(@IAccountService readonly account: IAccountService) {} }\ninstantiationService.createInstance(Page);'
		],
		invalid: [
			{
				code: 'class Page { constructor(host: HTMLElement, @IAccountService readonly account: IAccountService) {} }\nnew Page(host, account);',
				errors: [{ messageId: 'injectable' }]
			},
			{
				code: 'class Page { constructor(@IAccountService account: IAccountService) {} }\nnew Page(account);',
				errors: [{ messageId: 'injectable' }]
			}
		]
	});
	tester.run('declare-service-brand', declareServiceBrand, {
		valid: ['class Service { declare readonly _serviceBrand: undefined; }'],
		invalid: [
			{
				code: 'class Service { readonly _serviceBrand: undefined; }',
				errors: [{ messageId: 'brand' }]
			},
			{
				code: 'class Service { declare _serviceBrand: undefined; }',
				errors: [{ messageId: 'brand' }]
			}
		]
	});
	tester.run('require-leak-checked-tests', requireLeakCheckedTests, {
		valid: [
			"import { x } from './other.ts';",
			"import { DisposableStore } from '../src/prctr/base/common/lifecycle.ts';\nensureNoDisposablesAreLeakedInTestSuite();",
			"import type { IDisposable } from '../src/prctr/base/common/lifecycle.ts';"
		],
		invalid: [
			{
				code: "import { DisposableStore } from '../src/prctr/base/common/lifecycle.ts';",
				errors: [{ messageId: 'missing' }]
			}
		]
	});
	tester.run('prefer-dom-helpers', preferDomHelpers, {
		valid: [
			"const node = h('div.card').root;",
			"function build(document: Document) { return document.createElement('div'); }",
			"const node = host.ownerDocument.createElement('div');"
		],
		invalid: [
			{
				code: "const node = document.createElement('div');",
				errors: [{ messageId: 'global' }]
			}
		]
	});
	tester.run('prefer-element-factory', preferElementFactory, {
		valid: ["const $ = createElementFactory(document);\nconst node = $('div.card');"],
		invalid: [
			{
				code: "const node = host.ownerDocument.createElement('div');",
				errors: [{ messageId: 'raw' }]
			}
		]
	});
	tester.run('no-sync-fs', noSynchronousFileSystem, {
		valid: ["await readFile('a');", "await fs.promises.readFile('a');", 'syncState();'],
		invalid: [
			{ code: "readFileSync('a');", errors: [{ messageId: 'synchronous' }] },
			{ code: "fs.existsSync('a');", errors: [{ messageId: 'synchronous' }] }
		]
	});
	tester.run('no-unsafe-double-assertion', noUnsafeDoubleAssertion, {
		valid: ['const data: unknown = input;'],
		invalid: [
			{ code: 'const data = input as any as Payload;', errors: [{ messageId: 'assertion' }] }
		]
	});
});

void test('upstream directive interpretation preserves locations and never rewrites fixtures', () => {
	const literal = 'const fixture = "// eslint-disable-next-line local/code-no-any-casts";';
	const original = `${literal}\n// eslint-disable-next-line local/code-no-potentially-unsafe-disposables\nlet store = new DisposableStore();\n// eslint-disable-next-line no-debugger\ndebugger;\n/* eslint-disable local/code-no-any-casts */\nif (value) {\n // eslint-disable-next-line local/code-no-any-casts\n} else if (other) {\n}\n`;
	const processed = upstreamDirectives.preprocess?.(original, 'example.ts')[0];
	assert.equal(typeof processed, 'string');
	if (typeof processed !== 'string') throw new Error('Expected one textual lint input.');
	assert.equal(processed.length, original.length);
	assert.equal(processed.split('\n').length, original.split('\n').length);
	assert.ok(processed.startsWith(literal));
	assert.ok(processed.includes('eslint-disable-next-line proctor/disposable-ownership'));
	assert.ok(processed.includes('eslint-disable-next-line no-debugger'));
	assert.ok(processed.includes('/* ported-disable local/code-no-any-casts */'));
	assert.equal(processed.indexOf('let store'), original.indexOf('let store'));
	assert.ok(processed.includes('ported-disable-next-line local/code-no-any-casts\n} else'));
});

void test('missing Electron runtime is diagnosed without acquisition or filesystem mutation', () => {
	const root = mkdtempSync(join(tmpdir(), 'proctor-runtime-test-'));
	try {
		assert.throws(() => stockElectronExecutable(root), /npm run setup/);
		assert.throws(() => readFileSync(join(root, 'path.txt')), /ENOENT/);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});
