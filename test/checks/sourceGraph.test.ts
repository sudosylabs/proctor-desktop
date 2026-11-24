import assert from 'node:assert/strict';
import { test } from 'node:test';
import { analyzeSource, cssCheck } from '../../build/checks/source.ts';
import { VirtualRepository } from '../../build/checks/repository.ts';

const sourcePolicy = JSON.stringify({
	sourceRoot: 'src/prctr',
	layers: ['base', 'platform', 'editor', 'workbench', 'code'],
	environments: { common: ['common'] },
	testSegments: ['test'],
	productionDynamicImportAllowlist: []
});

void test('only fully erased imports and exports may use development dependencies', () => {
	const check = (source: string) =>
		analyzeSource(
			new VirtualRepository({
				'build/policies/source-boundaries.json': sourcePolicy,
				'package.json': JSON.stringify({ devDependencies: { contract: '1.0.0' } }),
				'src/prctr/base/common/owner.ts': source
			})
		).diagnostics;
	for (const source of [
		"import type { Contract } from 'contract';",
		"export type { Contract } from 'contract';"
	])
		assert.deepEqual(check(source), []);
	for (const source of [
		"import { Contract } from 'contract';",
		"import { type Contract } from 'contract';",
		"import 'contract';",
		"export { Contract } from 'contract';",
		"export * from 'contract';",
		"void import('contract');",
		"import type { Missing } from 'undeclared';"
	]) {
		const diagnostics = check(source);
		assert.equal(diagnostics.length, 1, source);
		assert.match(diagnostics[0]?.problem ?? '', /undeclared runtime package/u);
	}
});

void test('source graph rejects executable cycles even inside one admitted port cluster', () => {
	const repository = new VirtualRepository({
		'build/policies/source-boundaries.json': sourcePolicy,
		'docs/upstream/vscode-ports/cycle-port.json': '{"clusterId":"cycle-port"}',
		'package.json': '{"dependencies":{}}',
		'src/prctr/base/common/one.ts': `
      // @proctor-vscode-port cycle-port
      import './two.js';
    `,
		'src/prctr/base/common/two.ts': `
      // @proctor-vscode-port cycle-port
      import './one.js';
    `
	});
	const diagnostics = analyzeSource(repository).diagnostics;
	assert.equal(diagnostics.length, 1);
	assert.match(diagnostics[0]?.problem ?? '', /^Source cycle:/u);
});

void test('source graph still rejects unowned cycles and resolves declaration dependencies', () => {
	const repository = new VirtualRepository({
		'build/policies/source-boundaries.json': sourcePolicy,
		'package.json': '{"dependencies":{}}',
		'src/prctr/base/common/globals.d.ts': 'export interface Declared {}',
		'src/prctr/base/common/one.ts': `
      import type { Declared } from './globals.js';
      import './two.js';
      export const value: Declared = {};
    `,
		'src/prctr/base/common/two.ts': `
      import './one.js';
    `
	});
	const diagnostics = analyzeSource(repository).diagnostics;
	assert.equal(diagnostics.length, 1);
	assert.match(diagnostics[0]?.problem ?? '', /^Source cycle:/u);
});

void test('source graph applies exact aggregate environment classifications', () => {
	const repository = new VirtualRepository({
		'build/policies/source-boundaries.json': JSON.stringify({
			sourceRoot: 'src/prctr',
			layers: ['base', 'platform', 'editor', 'workbench', 'code'],
			environments: { common: ['common'], browser: ['common', 'browser'] },
			environmentOverrides: { 'src/prctr/workbench/workbench.common.main.ts': 'browser' },
			testSegments: ['test'],
			productionDynamicImportAllowlist: []
		}),
		'package.json': '{"dependencies":{}}',
		'src/prctr/workbench/workbench.common.main.ts': "import './browser/owner.js';\n",
		'src/prctr/workbench/browser/owner.ts': 'export const owner = true;\n'
	});
	assert.deepEqual(analyzeSource(repository).diagnostics, []);
});

void test('source graph gives folders without an environment segment their default environment', () => {
	const policy = JSON.stringify({
		sourceRoot: 'src/prctr',
		layers: ['base', 'platform', 'editor', 'workbench', 'code'],
		environments: {
			common: ['common'],
			browser: ['common', 'browser'],
			node: ['common', 'node']
		},
		defaultEnvironments: { 'src/prctr/workbench/contrib': 'browser' },
		testSegments: ['test'],
		productionDynamicImportAllowlist: []
	});
	const browserOnly = new VirtualRepository({
		'build/policies/source-boundaries.json': policy,
		'package.json': '{"dependencies":{}}',
		'src/prctr/workbench/contrib/owner/ownerPage.ts':
			"import '../../../base/browser/dom.js';\n",
		'src/prctr/workbench/contrib/owner/common/model.ts': "import '../ownerPage.js';\n",
		'src/prctr/base/browser/dom.ts': 'export const dom = true;\n'
	});
	const diagnostics = analyzeSource(browserOnly).diagnostics;
	assert.equal(diagnostics.length, 1);
	assert.equal(diagnostics[0]?.path, 'src/prctr/workbench/contrib/owner/common/model.ts');
	const nodeImport = new VirtualRepository({
		'build/policies/source-boundaries.json': policy,
		'package.json': '{"dependencies":{}}',
		'src/prctr/workbench/contrib/owner/ownerPage.ts': "import '../../../base/node/files.js';\n",
		'src/prctr/base/node/files.ts': 'export const files = true;\n'
	});
	assert.equal(analyzeSource(nodeImport).diagnostics.length, 1);
});

void test('contributions keep to their feature folder and import no other contribution', () => {
	const policy = JSON.stringify({
		sourceRoot: 'src/prctr',
		layers: ['base', 'platform', 'editor', 'workbench', 'code'],
		environments: { common: ['common'], browser: ['common', 'browser'] },
		defaultEnvironments: { 'src/prctr/workbench/contrib': 'browser' },
		contributionRoot: 'src/prctr/workbench/contrib',
		testSegments: ['test'],
		productionDynamicImportAllowlist: []
	});
	const problems = (files: Record<string, string>): string[] =>
		analyzeSource(
			new VirtualRepository({
				'build/policies/source-boundaries.json': policy,
				'package.json': '{"dependencies":{}}',
				...files
			})
		).diagnostics.map((value) => value.problem);
	assert.deepEqual(
		problems({
			'src/prctr/workbench/contrib/owner/ownerPage.ts': "import './common/model.js';\n",
			'src/prctr/workbench/contrib/owner/common/model.ts': 'export const model = true;\n'
		}),
		[]
	);
	assert.deepEqual(
		problems({ 'src/prctr/workbench/contrib/owner/browser/ownerPage.ts': 'export {};\n' }),
		['Contribution source sits in a browser/ environment folder.']
	);
	assert.deepEqual(
		problems({
			'src/prctr/workbench/contrib/owner/ownerPage.ts': "import '../other/otherPage.js';\n",
			'src/prctr/workbench/contrib/other/otherPage.ts': 'export {};\n'
		}),
		['Contribution owner imports contribution other.']
	);
	assert.deepEqual(
		problems({
			'src/prctr/workbench/services/owner/browser/ownerService.ts':
				"import '../../../contrib/owner/ownerPage.js';\n",
			'src/prctr/workbench/contrib/owner/ownerPage.ts': 'export {};\n'
		}),
		['Workbench shell or service imports contribution owner.']
	);
});

void test('Proctor stylesheets take colours from tokens; listed ones must still need the exception', async () => {
	const path = 'src/prctr/workbench/browser/owner.css';
	const files = (css: string, listed: readonly string[]) =>
		new VirtualRepository({
			'build/policies/source-boundaries.json': JSON.stringify({
				sourceRoot: 'src/prctr',
				layers: ['base', 'platform', 'editor', 'workbench', 'code'],
				environments: { common: ['common'], browser: ['common', 'browser'] },
				testSegments: ['test'],
				productionDynamicImportAllowlist: [],
				rawColorStylesheets: listed
			}),
			'package.json': '{"dependencies":{}}',
			'src/prctr/workbench/browser/owner.ts': "import './owner.css';\n",
			[path]: `@layer workbench { .prctr-owner { ${css} } }`
		});
	const run = (repository: VirtualRepository) =>
		cssCheck.run({ repository, registeredCheckIds: new Set([cssCheck.id]) });
	assert.deepEqual(await run(files('color: var(--prctr-color-text-default);', [])), []);
	for (const raw of [
		'color: #fff;',
		'box-shadow: 0 1px 2px rgb(0 0 0 / 8%);',
		'color: hsl(0 0% 0%);'
	])
		assert.match(
			(await run(files(raw, []))).map((value) => value.problem).join('\n'),
			/raw colour/u,
			raw
		);
	assert.deepEqual(await run(files('color: #fff;', [path])), []);
	assert.match(
		(await run(files('color: var(--prctr-color-text-default);', [path])))
			.map((value) => value.problem)
			.join('\n'),
		/holds none/u
	);
});

void test('CSS important declarations require one exact override-layer exception', async () => {
	const path = 'src/prctr/workbench/browser/owner.css';
	const selector = '.prctr-owner .compatibility';
	const repository = new VirtualRepository({
		'build/policies/source-boundaries.json': JSON.stringify({
			sourceRoot: 'src/prctr',
			layers: ['base', 'platform', 'editor', 'workbench', 'code'],
			environments: { common: ['common'], browser: ['common', 'browser'] },
			testSegments: ['test'],
			productionDynamicImportAllowlist: [],
			cssImportantOverrides: [
				{
					path,
					selector,
					property: 'opacity',
					rationale: 'Preserve the exact behavior of the packaged compatibility surface.'
				}
			]
		}),
		'package.json': '{"dependencies":{}}',
		'src/prctr/workbench/browser/owner.ts': "import './owner.css';\n",
		[path]: `@layer overrides { ${selector} { opacity: 1 !important; } }`
	});
	assert.deepEqual(
		await cssCheck.run({ repository, registeredCheckIds: new Set([cssCheck.id]) }),
		[]
	);
	const stale = new VirtualRepository({
		...Object.fromEntries(repository.files().map((file) => [file, repository.read(file)])),
		[path]: `@layer workbench { ${selector} { opacity: 1 !important; } }`
	});
	const diagnostics = await cssCheck.run({
		repository: stale,
		registeredCheckIds: new Set([cssCheck.id])
	});
	assert.equal(diagnostics.length, 2);
	assert.match(diagnostics.map((value) => value.problem).join('\n'), /override-layer|stale/u);
});

void test('CSS ownership resolves nested selectors across conditional rules', async () => {
	const path = 'src/prctr/workbench/browser/owner.css';
	const run = (css: string) =>
		cssCheck.run({
			repository: new VirtualRepository({
				'build/policies/source-boundaries.json': sourcePolicy,
				'package.json': '{"dependencies":{}}',
				'src/prctr/workbench/browser/owner.ts': "import './owner.css';\n",
				[path]: css
			}),
			registeredCheckIds: new Set([cssCheck.id])
		});
	assert.deepEqual(
		await run(
			'@layer controls { .prctr-owner { & .child + .sibling, & > .child ~ .sibling { opacity: .5; } } }'
		),
		[]
	);
	assert.deepEqual(
		await run(
			'@layer controls { .prctr-owner { &.active, &:focus { opacity: 1; } @media (width > 400px) { .child { &:hover { opacity: .5; } } } } }'
		),
		[]
	);
	for (const css of [
		'@layer controls { .prctr-owner { & + .foreign { opacity: .5; } } }',
		'@layer controls { .prctr-owner { & ~ .foreign { opacity: .5; } } }',
		'@layer controls { .prctr-owner { :is(& + .foreign, &) { opacity: .5; } } }',
		'@layer controls { .prctr-owner { :not(&) { opacity: .5; } } }',
		'@layer controls { .prctr-owner { :is(&, .foreign) { opacity: .5; } } }',
		'@layer controls { .prctr-owner { :where(&, .foreign) { opacity: .5; } } }',
		'@layer controls { .unowned { .child { opacity: 1; } } }',
		'@layer controls { .prctr-owner { .unowned & { opacity: 1; } } }',
		'@layer controls { .prctr-owner, .unowned { & .child { opacity: 1; } } }',
		'@layer controls { .prctr-owner { @supports (display: grid) { #unowned { opacity: 1; } } } }'
	])
		assert.notEqual((await run(css)).length, 0, css);
});

void test('conditional nested important rules require the global overrides layer and exact evidence', async () => {
	const path = 'src/prctr/workbench/browser/owner.css';
	const run = (css: string, selector = '&:focus') =>
		cssCheck.run({
			repository: new VirtualRepository({
				'build/policies/source-boundaries.json': JSON.stringify({
					...JSON.parse(sourcePolicy),
					cssImportantOverrides: [
						{
							path,
							selector,
							property: 'outline',
							rationale: 'Preserve the reviewed nested focus override.'
						}
					]
				}),
				'package.json': '{"dependencies":{}}',
				'src/prctr/workbench/browser/owner.ts': "import './owner.css';\n",
				[path]: css
			}),
			registeredCheckIds: new Set([cssCheck.id])
		});
	const valid =
		'@layer overrides { .prctr-owner { @media (width > 400px) { &:focus { outline: 0 !important; } } } }';
	assert.deepEqual(await run(valid), []);
	assert.notEqual((await run(valid, '&:hover')).length, 0);
	assert.notEqual((await run(valid.replace('@layer overrides', '@layer controls'))).length, 0);
	assert.notEqual((await run(`@layer controls { ${valid} }`)).length, 0);
});

void test('static assets require an exact importer and resource with the correct environment', () => {
	const importer = 'src/prctr/base/common/owner.ts';
	const resource = 'resources/grammar.json';
	const admission = {
		importer,
		resource,
		kind: 'data',
		rationale: 'Packaged grammar data for the closed worker adapter.'
	};
	const run = (source: string, admissions: object[] = [admission], owner = importer) =>
		analyzeSource(
			new VirtualRepository({
				'build/policies/source-boundaries.json': JSON.stringify({
					...JSON.parse(sourcePolicy),
					staticAssetImports: admissions
				}),
				'package.json': '{}',
				[owner]: source,
				[resource]: '{}',
				'resources/neighbor.json': '{}',
				'resources/font.woff': 'font'
			})
		).diagnostics;
	const source =
		"import grammar from '../../../../resources/grammar.json' with { type: 'json' };";
	assert.deepEqual(run(source), []);
	assert.notEqual(run(source, []).length, 0);
	assert.notEqual(run(source, [admission], 'src/prctr/base/common/other.ts').length, 0);
	assert.notEqual(run(source.replace('grammar.json', 'neighbor.json')).length, 0);
	assert.notEqual(run('', [admission]).length, 0);
	assert.notEqual(run(source, [admission, admission]).length, 0);
	assert.notEqual(run(source, [{ ...admission, kind: 'font' }]).length, 0);
	assert.notEqual(
		run(source.replace('grammar.json', 'font.woff'), [
			{ ...admission, resource: 'resources/font.woff', kind: 'font' }
		]).length,
		0
	);
});
