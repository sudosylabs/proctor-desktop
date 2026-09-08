import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import {
	FileSystemRepository,
	VirtualRepository,
	resolveRepositoryPath
} from '../../build/checks/repository.ts';
import { checkMap } from '../../build/checks/registry.ts';
import { validateGeneratorRegistry } from '../../build/generators/registry.ts';

void test('virtual repository normalizes paths and models directories and symlinks', () => {
	const repository = new VirtualRepository({
		'a/b.txt': 'value\n',
		link: { symlink: 'a/b.txt' }
	});
	assert.equal(repository.read('a/./b.txt'), 'value\n');
	assert.equal(repository.kind('a'), 'directory');
	assert.equal(repository.readLink('link'), 'a/b.txt');
	assert.equal(resolveRepositoryPath('docs/a.md', '../AGENTS.md'), 'AGENTS.md');
	assert.throws(() => repository.read('../../outside'));
});

void test('real repository preserves canonical agent alias topology', () => {
	const repository = new FileSystemRepository(process.cwd());
	assert.equal(repository.readLink('.github/copilot-instructions.md'), '../AGENTS.md');
	assert.equal(repository.readLink('.github/skills'), '../.agents/skills');
	assert.equal(repository.readLink('.claude/skills'), '../.agents/skills');
});

void test('real repository excludes unstaged deletions without changing the index', () => {
	const root = mkdtempSync(join(tmpdir(), 'proctor-repository-deletions-'));
	const git = (...args: string[]) => execFileSync('git', args, { cwd: root });
	try {
		git('init', '--quiet');
		writeFileSync(join(root, 'kept.txt'), 'kept\n');
		writeFileSync(join(root, 'removed.txt'), 'removed\n');
		git('add', '--', 'kept.txt', 'removed.txt');
		const indexBefore = git('ls-files', '--stage');
		unlinkSync(join(root, 'removed.txt'));
		writeFileSync(join(root, 'new.txt'), 'new\n');
		const repository = new FileSystemRepository(root);
		assert.deepEqual(repository.files(), ['kept.txt', 'new.txt']);
		assert.deepEqual(
			repository.files().map((path) => repository.read(path)),
			['kept\n', 'new\n']
		);
		assert.equal(repository.exists('removed.txt'), false);
		assert.deepEqual(git('ls-files', '--stage'), indexBefore);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

void test('check and generator registries reject duplicate ownership', () => {
	assert.throws(() =>
		checkMap([
			{ id: 'same', category: 'source', contractRequired: false, run: () => [] },
			{ id: 'same', category: 'source', contractRequired: false, run: () => [] }
		])
	);
	const generator = (id: string) => ({
		id,
		inputs: [],
		committedOutputs: ['same.txt'],
		buildOutputs: [],
		generate: () => undefined
	});
	assert.deepEqual(validateGeneratorRegistry([generator('one'), generator('two')]), [
		'output same.txt is owned by both one and two'
	]);
});
