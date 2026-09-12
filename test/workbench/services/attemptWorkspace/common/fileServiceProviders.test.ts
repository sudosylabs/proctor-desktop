import { Emitter } from '../../../../../src/prctr/base/common/event.js';
import assert from 'node:assert';
import { test } from '../../../../base/common/upstream/testAdapter.ts';
import { URI } from '../../../../../src/prctr/base/common/uri.js';
import { VSBuffer } from '../../../../../src/prctr/base/common/buffer.js';
import { FileService } from '../../../../../src/prctr/platform/files/common/fileService.js';
import { NullLogService } from '../../../../../src/prctr/platform/log/common/log.js';
import { WorkspaceFileServiceProvider } from '../../../../../src/prctr/workbench/contrib/attemptWorkspace/browser/fileServiceProviders.js';
import { createAttemptWorkspaceSession } from '../../../../../src/prctr/workbench/services/attemptWorkspace/common/attemptWorkspaceSession.js';
import { WORKSPACE_V1_DEFAULT_LIMITS } from '../../../../../src/prctr/workbench/services/attemptWorkspace/common/attemptWorkspace.js';
import {
	InMemoryWorkspaceAuthority,
	InMemoryProtectedContent,
	DeterministicWorkspaceIds
} from './inMemoryAdapters.ts';

test('real FileService reads and mutates the remote workspace through the session adapter', async () => {
	const authority = new InMemoryWorkspaceAuthority([
		{ reference: 'file-one', path: 'answer.txt', content: 'first' }
	]);
	const session = await createAttemptWorkspaceSession({
		authority,
		protectedContent: new InMemoryProtectedContent(),
		ids: new DeterministicWorkspaceIds(),
		limits: WORKSPACE_V1_DEFAULT_LIMITS
	});
	const provider = new WorkspaceFileServiceProvider('attempt-one', session);
	const files = new FileService(new NullLogService());
	const registration = files.registerProvider('prctr-workspace', provider);
	const resource = URI.parse('prctr-workspace://attempt-one/answer.txt');
	try {
		assert.equal((await files.readFile(resource)).value.toString(), 'first');
		await files.writeFile(resource, VSBuffer.fromString('second'));
		assert.equal((await files.readFile(resource)).value.toString(), 'second');
		await files.createFolder(URI.parse('prctr-workspace://attempt-one/src'));
		await files.move(resource, URI.parse('prctr-workspace://attempt-one/src/answer.txt'));
		assert.equal(await files.exists(resource), false);
		assert.equal(
			(await files.resolve(URI.parse('prctr-workspace://attempt-one/src'))).children?.length,
			1
		);
		await files.del(URI.parse('prctr-workspace://attempt-one/src'), { recursive: true });
		assert.equal(session.observe().current.entries.length, 0);
	} finally {
		registration.dispose();
		files.dispose();
		provider.dispose();
		session.dispose();
	}
});

test('preview leases read through FileService and reject cross-root, changed authority and cancelled reads', async () => {
	const { FilePreviewResourceAccess } =
		await import('../../../../../src/prctr/workbench/services/attemptWorkspace/browser/previewResourceAccess.js');
	const { CancellationToken, CancellationTokenSource } =
		await import('../../../../../src/prctr/base/common/cancellation.js');
	const authority = new InMemoryWorkspaceAuthority([
		{ reference: 'image-one', path: 'docs/image.png', content: 'image bytes' }
	]);
	const session = await createAttemptWorkspaceSession({
		authority,
		protectedContent: new InMemoryProtectedContent(),
		ids: new DeterministicWorkspaceIds(),
		limits: WORKSPACE_V1_DEFAULT_LIMITS
	});
	const provider = new WorkspaceFileServiceProvider('attempt-one', session);
	const files = new FileService(new NullLogService());
	const registration = files.registerProvider('prctr-workspace', provider);
	let epoch = 1;
	const revoked = new Emitter<void>();
	const links: string[] = [];
	const access = new FilePreviewResourceAccess({
		files,
		onDidRevoke: revoked.event,
		roots: [URI.parse('prctr-workspace://attempt-one/')],
		maximumBytes: 100,
		authorize: () => ({ epoch, revision: '1', mediaType: 'image/png' }),
		openLink: async (_source, link) => {
			links.push(link);
		}
	});
	const source = 'prctr-workspace://attempt-one/docs/readme.md';
	try {
		const lease = await access.readRelative(source, 'image.png', CancellationToken.None);
		assert.equal(new TextDecoder().decode(lease.bytes), 'image bytes');
		lease.dispose();
		assert.ok(lease.bytes.every((value) => value === 0));
		await assert.rejects(
			access.readRelative(source, 'prctr-workspace://other/image.png', CancellationToken.None)
		);
		await assert.rejects(
			access.readRelative(source, 'https://server/image.png', CancellationToken.None)
		);
		await assert.rejects(
			access.readRelative(
				source,
				URI.from({ scheme: 'file', path: '/outside' }).toString(),
				CancellationToken.None
			)
		);
		const cancellation = new CancellationTokenSource();
		cancellation.cancel();
		await assert.rejects(access.readRelative(source, 'image.png', cancellation.token));
		cancellation.dispose();
		let release = () => {};
		authority.readBarrier = new Promise<void>((resolve) => {
			release = resolve;
		});
		const pending = access.readRelative(source, 'image.png', CancellationToken.None);
		await new Promise((resolve) => setTimeout(resolve, 0));
		epoch++;
		release();
		await assert.rejects(pending, /changed/);
		await access.openLink(source, 'https://permitted.example');
		assert.deepEqual(links, ['https://permitted.example']);
		const retained = await access.readRelative(source, 'image.png', CancellationToken.None);
		revoked.fire();
		assert.ok(retained.bytes.every((value) => value === 0));
		await assert.rejects(access.readRelative(source, 'image.png', CancellationToken.None));
	} finally {
		revoked.dispose();
		access.dispose();
		registration.dispose();
		files.dispose();
		provider.dispose();
		session.dispose();
	}
});

test('Exam Resource metadata and content are fenced immediately with the catalog authorization', async () => {
	const { createExamResourceCatalog } =
		await import('../../../../../src/prctr/workbench/services/attemptWorkspace/common/examResourceCatalog.js');
	const { ExamResourceFileServiceProvider } =
		await import('../../../../../src/prctr/workbench/contrib/attemptWorkspace/browser/fileServiceProviders.js');
	const changes = new Emitter<void>();
	let allowed = true;
	const value = {
		reference: 'resource-one',
		path: 'instructions.pdf',
		title: 'Instructions',
		version: 'one',
		mediaType: 'application/pdf',
		byteSize: 1
	};
	const catalog = await createExamResourceCatalog(
		{
			list: async () => [value],
			read: async () => ({ ...value, content: new Uint8Array([1]) })
		},
		{ current: () => allowed, onDidChange: changes.event }
	);
	const provider = new ExamResourceFileServiceProvider('attempt-one', catalog);
	const uri = URI.parse('prctr-exam-resource://attempt-one/instructions.pdf');
	try {
		assert.equal((await provider.stat(uri)).size, 1);
		allowed = false;
		changes.fire();
		assert.equal(catalog.observe().current.available, false);
		await assert.rejects(provider.stat(uri));
		await assert.rejects(provider.readdir(URI.parse('prctr-exam-resource://attempt-one/')));
		await assert.rejects(provider.readFile(uri));
	} finally {
		provider.dispose();
		catalog.dispose();
		changes.dispose();
	}
});

test('conditional FileService reads see same-size remote changes after reconciliation', async () => {
	const authority = new InMemoryWorkspaceAuthority([
		{ reference: 'file-one', path: 'answer.txt', content: 'first' }
	]);
	const session = await createAttemptWorkspaceSession({
		authority,
		protectedContent: new InMemoryProtectedContent(),
		ids: new DeterministicWorkspaceIds(),
		limits: WORKSPACE_V1_DEFAULT_LIMITS
	});
	const provider = new WorkspaceFileServiceProvider('attempt-one', session);
	const files = new FileService(new NullLogService());
	const registration = files.registerProvider('prctr-workspace', provider);
	const uri = URI.parse('prctr-workspace://attempt-one/answer.txt');
	try {
		const before = await files.readFile(uri);
		authority.replaceExternally('file-one', 'other');
		await session.settle({
			kind: 'reconcile',
			throughGeneration: session.observe().current.generation
		});
		const after = await files.readFile(uri, { etag: before.etag });
		assert.equal(after.value.toString(), 'other');
		assert.notStrictEqual(after.etag, before.etag);
	} finally {
		registration.dispose();
		files.dispose();
		provider.dispose();
		session.dispose();
	}
});
