import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FileSystemRepository, VirtualRepository, resolveRepositoryPath } from '../../build/checks/repository.ts';
import { checkMap } from '../../build/checks/registry.ts';
import { validateGeneratorRegistry } from '../../build/generators/registry.ts';

test('virtual repository normalizes paths and models directories and symlinks', () => {
  const repository = new VirtualRepository({ 'a/b.txt': 'value\n', link: { symlink: 'a/b.txt' } });
  assert.equal(repository.read('a/./b.txt'), 'value\n');
  assert.equal(repository.kind('a'), 'directory');
  assert.equal(repository.readLink('link'), 'a/b.txt');
  assert.equal(resolveRepositoryPath('docs/a.md', '../AGENTS.md'), 'AGENTS.md');
  assert.throws(() => repository.read('../../outside'));
});

test('real repository preserves canonical agent alias topology', () => {
  const repository = new FileSystemRepository(process.cwd());
  assert.equal(repository.readLink('.github/copilot-instructions.md'), '../AGENTS.md');
  assert.equal(repository.readLink('.github/skills'), '../.agents/skills');
  assert.equal(repository.readLink('.claude/skills'), '../.agents/skills');
});

test('check and generator registries reject duplicate ownership', () => {
  assert.throws(() => checkMap([{ id: 'same', category: 'source', contractRequired: false, run: () => [] }, { id: 'same', category: 'source', contractRequired: false, run: () => [] }]));
  const generator = (id: string) => ({ id, inputs: [], committedOutputs: ['same.txt'], buildOutputs: [], generate: () => undefined });
  assert.deepEqual(validateGeneratorRegistry([generator('one'), generator('two')]), ['output same.txt is owned by both one and two']);
});
