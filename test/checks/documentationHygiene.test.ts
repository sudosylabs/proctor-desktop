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

test('hygiene rejects unowned absolute paths', () => {
  const diagnostics = hygieneCheck.run(context({
    'src/prctr/platform/common/example.ts': `export const path = '${usersRoot}example/checkout/file.ts';\n`
  }));
  assert.ok(Array.isArray(diagnostics));
  assert.match(diagnostics[0]?.problem ?? '', /machine-specific absolute path/);
});

test('hygiene permits exact upstream path fixtures only in the admitted base area', () => {
  const diagnostics = hygieneCheck.run(context({
    'src/prctr/base/common/example.ts': `// @proctor-vscode-port base-common-runtime\nexport const fixture = '${fileScheme}${usersRoot}example/file.ts';\n`
  }));
  assert.deepStrictEqual(diagnostics, []);
});
