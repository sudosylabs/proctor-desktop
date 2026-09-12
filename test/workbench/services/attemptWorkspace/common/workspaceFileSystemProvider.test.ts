import assert from 'node:assert';
import { test } from '../../../../base/common/upstream/testAdapter.ts';
import { WORKSPACE_V1_DEFAULT_LIMITS } from '../../../../../src/prctr/workbench/services/attemptWorkspace/common/attemptWorkspace.ts';
import { createAttemptWorkspaceSession } from '../../../../../src/prctr/workbench/services/attemptWorkspace/common/attemptWorkspaceSession.ts';
import { workspacePath } from '../../../../../src/prctr/workbench/services/attemptWorkspace/common/path.ts';
import { createExamResourceCatalog } from '../../../../../src/prctr/workbench/services/attemptWorkspace/common/examResourceCatalog.ts';
import {
	AttemptWorkspaceFileSystemProvider,
	ExamResourceFileSystemProvider,
	workspaceUri
} from '../../../../../src/prctr/workbench/contrib/attemptWorkspace/browser/workspaceFileSystemProvider.ts';
import {
	DeterministicWorkspaceIds,
	InMemoryExamResourcePort,
	InMemoryProtectedContent,
	InMemoryWorkspaceAuthority
} from './inMemoryAdapters.ts';

test('filesystem provider maps acknowledged mutations, scoped URIs and invalidation events', async () => {
	const authority = new InMemoryWorkspaceAuthority([
		{ reference: 'entry:a', path: 'answer.txt', content: 'one' }
	]);
	const session = await createAttemptWorkspaceSession({
		authority,
		protectedContent: new InMemoryProtectedContent(),
		ids: new DeterministicWorkspaceIds(),
		limits: WORKSPACE_V1_DEFAULT_LIMITS
	});
	const provider = new AttemptWorkspaceFileSystemProvider('attempt-one', session);
	const events: string[] = [];
	const watch = provider.watch('prctr-workspace://attempt-one/', { recursive: true });
	provider.onDidChangeFile((changes) =>
		events.push(...changes.map((change) => `${change.type}:${change.uri}`))
	);
	const answer = workspaceUri('attempt-one', workspacePath('answer.txt'));
	await provider.writeFile(answer, new TextEncoder().encode('two'), {
		create: false,
		overwrite: true,
		mediaType: 'text/plain'
	});
	assert.strictEqual(new TextDecoder().decode(await provider.readFile(answer)), 'two');
	const folder = workspaceUri('attempt-one', workspacePath('src'));
	await provider.createDirectory(folder);
	const created = workspaceUri('attempt-one', workspacePath('src/main.ts'));
	await provider.writeFile(created, new TextEncoder().encode('code'), {
		create: true,
		overwrite: false,
		mediaType: 'text/typescript'
	});
	assert.deepStrictEqual(provider.readDirectory('prctr-workspace://attempt-one/'), [
		['answer.txt', 'file'],
		['src', 'directory']
	]);
	assert.deepStrictEqual(provider.readDirectory(folder), [['main.ts', 'file']]);
	const renamed = workspaceUri('attempt-one', workspacePath('src/index.ts'));
	await provider.rename(created, renamed, false);
	assert.strictEqual(provider.stat(renamed).type, 'file');
	await provider.delete(renamed, false);
	assert.throws(() => provider.stat(renamed), /does not exist/u);
	assert.strictEqual(
		events.some((value) => value.startsWith('added:')),
		true
	);
	assert.strictEqual(
		events.some((value) => value.startsWith('deleted:')),
		true
	);
	await assert.rejects(
		provider.readFile('prctr-workspace://another/answer.txt'),
		/authorized scope/u
	);
	watch.dispose();
	provider.dispose();
	session.dispose();
});

test('exam resource provider synthesizes its immutable hierarchy for editor consumers', async () => {
	const content = new TextEncoder().encode('reference');
	const catalog = await createExamResourceCatalog(
		new InMemoryExamResourcePort([
			{
				reference: 'resource:one',
				path: 'docs/api/reference.txt',
				version: 'v1',
				mediaType: 'text/plain',
				byteSize: content.byteLength,
				title: 'Reference',
				content
			}
		])
	);
	const provider = new ExamResourceFileSystemProvider('attempt-one', catalog);
	assert.deepStrictEqual(provider.readDirectory('prctr-exam-resource://attempt-one/'), [
		['docs', 'directory']
	]);
	assert.deepStrictEqual(provider.readDirectory('prctr-exam-resource://attempt-one/docs'), [
		['api', 'directory']
	]);
	assert.strictEqual(
		provider.stat('prctr-exam-resource://attempt-one/docs/api').type,
		'directory'
	);
	assert.strictEqual(
		new TextDecoder().decode(
			await provider.readFile('prctr-exam-resource://attempt-one/docs/api/reference.txt')
		),
		'reference'
	);
	provider.dispose();
	catalog.dispose();
});

test('filesystem writes reject local-only durability and retain protected work', async () => {
	const authority = new InMemoryWorkspaceAuthority([
		{ reference: 'entry:a', path: 'answer.txt', content: 'one' }
	]);
	authority.dispatchBehaviors.push('transportUnavailable');
	const protectedContent = new InMemoryProtectedContent();
	const session = await createAttemptWorkspaceSession({
		authority,
		protectedContent,
		ids: new DeterministicWorkspaceIds(),
		limits: WORKSPACE_V1_DEFAULT_LIMITS
	});
	const provider = new AttemptWorkspaceFileSystemProvider('attempt-one', session);
	await assert.rejects(
		provider.writeFile(
			workspaceUri('attempt-one', workspacePath('answer.txt')),
			new TextEncoder().encode('local'),
			{ create: false, overwrite: true, mediaType: 'text/plain' }
		),
		/not acknowledged/u
	);
	assert.strictEqual(protectedContent.records.size, 1);
	provider.dispose();
	session.dispose();
});
