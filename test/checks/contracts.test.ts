import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Check, Diagnostic } from '../../build/checks/types.ts';
import { checks, checkMap } from '../../build/checks/registry.ts';
import { FileSystemRepository, VirtualRepository } from '../../build/checks/repository.ts';

type Mutation = (files: Record<string, string | Uint8Array | { symlink: string }>) => void;

const real = new FileSystemRepository(process.cwd());
function snapshot(mutation?: Mutation): VirtualRepository {
  const files: Record<string, string | Uint8Array | { symlink: string }> = {};
  for (const path of real.files()) {
    const link = real.readLink(path);
    files[path] = link === undefined ? real.readBytes(path) : { symlink: link };
  }
  mutation?.(files);
  return new VirtualRepository(files);
}

async function run(check: Check, repository: VirtualRepository): Promise<readonly Diagnostic[]> {
  return check.run({ repository, registeredCheckIds: new Set(checks.map(entry => entry.id)) });
}

const failures: Readonly<Record<string, { mutate: Mutation; expectedPath: string; expectedProblem: RegExp }>> = {
  'policy.schemas': {
    mutate: files => { files['build/policies/assurance.json'] = String(files['build/policies/assurance.json']).replace('"controls": [', '"controls": [], "unused": ['); },
    expectedPath: 'build/policies/assurance.json', expectedProblem: /must NOT have additional properties|must NOT have fewer/
  },
  'assurance.coverage': {
    mutate: files => { files['docs/architecture/invariants.md'] = String(files['docs/architecture/invariants.md']).replace('`product.exam-workbench`', '`product.renamed`'); },
    expectedPath: 'build/policies/assurance.json', expectedProblem: /unknown invariant product\.exam-workbench/
  },
  'dependencies.admission': {
    mutate: files => { const manifest = JSON.parse(String(files['package.json'])) as { devDependencies: Record<string, string> }; manifest.devDependencies['unreviewed-package'] = '1.0.0'; files['package.json'] = `${JSON.stringify(manifest, null, 2)}\n`; },
    expectedPath: 'package.json', expectedProblem: /unreviewed-package is not admitted/
  },
  'repository.documentation': {
    mutate: files => { files['docs/README.md'] = `${String(files['docs/README.md'])}\n[broken](missing.md)\n`; },
    expectedPath: 'docs/README.md', expectedProblem: /does not exist/
  },
  'repository.hygiene': {
    mutate: files => { files['docs/README.md'] = `${String(files['docs/README.md']).trimEnd()}  \n`; },
    expectedPath: 'docs/README.md', expectedProblem: /trailing whitespace/
  },
  'ci.actions-pinned': {
    mutate: files => { files['.github/workflows/foundation.yml'] = 'jobs:\n  check:\n    steps:\n      - uses: actions/checkout@v4\n'; },
    expectedPath: '.github/workflows/foundation.yml', expectedProblem: /not pinned/
  },
  'generated.parity': {
    mutate: files => { files['notes.ts'] = `// ${'@generated'} by missing.owner\n`; },
    expectedPath: 'notes.ts', expectedProblem: /unregistered owner/
  },
  'upstream.provenance': {
    mutate: files => { files['src/prctr/base/common/example.ts'] = `// ${'@proctor-vscode-port'} orphan-cluster\n`; },
    expectedPath: 'src/prctr/base/common/example.ts', expectedProblem: /unowned cluster/
  },
  'source.graph': {
    mutate: files => { files['src/prctr/base/common/lower.ts'] = "import '../../platform/common/higher.js';\n"; files['src/prctr/platform/common/higher.ts'] = 'export const higher = true;\n'; },
    expectedPath: 'src/prctr/base/common/lower.ts', expectedProblem: /imports upward/
  },
  'source.compositions': {
    mutate: files => { files['src/prctr/code/common/main.ts'] = 'export {};\n'; },
    expectedPath: 'build/policies/compositions.json', expectedProblem: /without declared compositions/
  },
  'source.css': {
    mutate: files => { files['src/prctr/base/browser/ui/control.ts'] = "import './control.css';\n"; files['src/prctr/base/browser/ui/control.css'] = '@layer controls { #bad { color: red; } }\n'; },
    expectedPath: 'src/prctr/base/browser/ui/control.css', expectedProblem: /uses an id/
  }
};

test('every registered checker has a pass/fail virtual repository contract', async t => {
  const map = checkMap();
  assert.deepEqual([...map.values()].filter(check => check.contractRequired).map(check => check.id).sort(), Object.keys(failures).sort());
  for (const check of map.values()) {
    await t.test(check.id, async () => {
      const passing = await run(check, snapshot());
      assert.deepEqual(passing, [], `baseline should pass ${check.id}`);
      const contract = failures[check.id];
      assert.ok(contract);
      const failing = await run(check, snapshot(contract.mutate));
      assert.ok(failing.some(item => item.checkId === check.id && item.path === contract.expectedPath && contract.expectedProblem.test(item.problem)), JSON.stringify(failing, null, 2));
    });
  }
});
