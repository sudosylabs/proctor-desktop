import assert from 'node:assert';
import { test } from '../../../../base/common/upstream/testAdapter.ts';
import {
	createExamResourceCatalog,
	EXAM_RESOURCE_CATALOG_LIMITS
} from '../../../../../src/prctr/workbench/contrib/attemptWorkspace/common/examResourceCatalog.ts';
import {
	ExamResourceFileSystemProvider,
	examResourceUri
} from '../../../../../src/prctr/workbench/contrib/attemptWorkspace/browser/workspaceFileSystemProvider.ts';
import type { ExamResourceEntry } from '../../../../../src/prctr/workbench/contrib/attemptWorkspace/common/attemptWorkspace.ts';
import type { ExamResourcePort } from '../../../../../src/prctr/workbench/contrib/attemptWorkspace/common/internalPorts.ts';
import { InMemoryExamResourcePort } from './inMemoryAdapters.ts';

test('Exam Resources remain a separately authorized read-only catalog and URI provider', async () => {
	const content = new TextEncoder().encode('Reference');
	const catalog = await createExamResourceCatalog(
		new InMemoryExamResourcePort([
			{
				reference: 'resource:1',
				path: 'materials/reference.txt',
				version: 'r1',
				mediaType: 'text/plain',
				byteSize: content.byteLength,
				title: 'Reference',
				order: 1,
				content
			}
		])
	);
	const provider = new ExamResourceFileSystemProvider('attempt-one', catalog);
	const uri = examResourceUri('attempt-one', 'materials/reference.txt');
	assert.strictEqual(new TextDecoder().decode(await provider.readFile(uri)), 'Reference');
	assert.strictEqual(provider.stat(uri).contentVersion, 'r1');
	assert.throws(() => provider.writeFile(), /read only/u);
	await assert.rejects(
		provider.readFile('prctr-exam-resource://other/materials/reference.txt'),
		/authorized scope/u
	);
	provider.dispose();
	catalog.dispose();
});

test('Exam Resource catalogs and reads are exact, bounded, and identity preserving', async () => {
	const entry: ExamResourceEntry = Object.freeze({
		reference: 'resource:1',
		path: 'materials/reference.txt',
		version: 'r1',
		mediaType: 'text/plain',
		byteSize: 1,
		title: 'Reference'
	});
	const duplicate: ExamResourcePort = {
		list: async () => [entry, { ...entry, path: 'materials/other.txt' }],
		read: async () => ({ ...entry, content: new Uint8Array([65]) })
	};
	await assert.rejects(createExamResourceCatalog(duplicate), /duplicate/u);
	const oversized: ExamResourcePort = {
		list: async () =>
			Array.from({ length: EXAM_RESOURCE_CATALOG_LIMITS.entries + 1 }, (_value, index) => ({
				...entry,
				reference: `resource:${index}`,
				path: `materials/${index}.txt`
			})),
		read: async () => ({ ...entry, content: new Uint8Array([65]) })
	};
	await assert.rejects(createExamResourceCatalog(oversized), /bounds/u);
	const mismatched: ExamResourcePort = {
		list: async () => [entry],
		read: async () => ({ ...entry, version: 'r2', content: new Uint8Array([65]) })
	};
	const catalog = await createExamResourceCatalog(mismatched);
	await assert.rejects(catalog.read(entry.reference), /does not match/u);
	catalog.dispose();
	const wrongSize: ExamResourcePort = {
		list: async () => [entry],
		read: async () => ({ ...entry, content: new Uint8Array([65, 66]) })
	};
	const sizeCatalog = await createExamResourceCatalog(wrongSize);
	await assert.rejects(sizeCatalog.read(entry.reference), /does not match/u);
	sizeCatalog.dispose();
});

test('an Exam Resource read cannot complete after catalog disposal', async () => {
	const entry: ExamResourceEntry = Object.freeze({
		reference: 'resource:1',
		path: 'materials/reference.txt',
		version: 'r1',
		mediaType: 'text/plain',
		byteSize: 1,
		title: 'Reference'
	});
	let release = () => {};
	const barrier = new Promise<void>((resolve) => {
		release = resolve;
	});
	let reading = false;
	const port: ExamResourcePort = {
		list: async () => [entry],
		read: async () => {
			reading = true;
			await barrier;
			return { ...entry, content: new Uint8Array([65]) };
		}
	};
	const catalog = await createExamResourceCatalog(port);
	const pending = catalog.read(entry.reference);
	while (!reading) await Promise.resolve();
	catalog.dispose();
	release();
	await assert.rejects(pending, /disposed/u);
});
