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
