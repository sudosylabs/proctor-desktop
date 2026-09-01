import assert from 'node:assert/strict';
import { test } from 'node:test';
import { analyzeSource } from '../../build/checks/source.ts';
import { VirtualRepository } from '../../build/checks/repository.ts';

const sourcePolicy = JSON.stringify({
  sourceRoot: 'src/prctr',
  layers: ['base', 'platform', 'editor', 'workbench', 'code'],
  environments: { common: ['common'] },
  testSegments: ['test'],
  productionDynamicImportAllowlist: []
});

test('source graph preserves cycles wholly internal to one admitted port cluster', () => {
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
  assert.deepEqual(analyzeSource(repository).diagnostics, []);
});

test('source graph still rejects unowned cycles and resolves declaration dependencies', () => {
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
