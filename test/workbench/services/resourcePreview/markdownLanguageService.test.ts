import assert from 'node:assert/strict';
import test from 'node:test';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { CancellationToken } from '../../../../src/prctr/base/common/cancellation.js';
import { Event } from '../../../../src/prctr/base/common/event.js';
import { MarkdownLanguageService } from '../../../../src/prctr/workbench/services/resourcePreview/browser/markdownLanguageService.js';
import type { PreviewTextSnapshot } from '../../../../src/prctr/workbench/services/resourcePreview/common/resourcePreview.js';

function workspace(documents: readonly PreviewTextSnapshot[]): MarkdownLanguageService {
	const index = new Map(documents.map((document) => [document.resource, document]));
	return new MarkdownLanguageService({
		roots: ['prctr-workspace://attempt/'],
		onDidChangeDocument: Event.None,
		onDidCreateDocument: Event.None,
		onDidDeleteDocument: Event.None,
		allMarkdownDocuments: async () => documents,
		hasMarkdownDocument: (resource) => index.has(resource),
		readMarkdownDocument: async (resource) => index.get(resource),
		stat: async (resource) => (index.has(resource) ? { isDirectory: false } : undefined),
		readDirectory: async () => []
	});
}

void test('upstream Markdown language features resolve heading fragments and reject executable links', async () => {
	const document = {
		resource: 'prctr-workspace://attempt/notes.md',
		version: 1,
		text: '# First\n\n## Second heading\n'
	};
	const service = workspace([document]);
	try {
		const target = await service.resolveLink(document.resource, '#second-heading');
		assert.equal(target?.kind, 'file');
		assert.equal(target?.resource, document.resource);
		assert.equal(target?.line, 2);
		assert.equal(await service.resolveLink(document.resource, 'command:run'), undefined);
		assert.equal(
			await service.resolveLink(document.resource, '#first', CancellationToken.Cancelled),
			undefined
		);
		const symbols = await service.languageFeatures.getDocumentSymbols(
			TextDocument.create(document.resource, 'markdown', 1, document.text),
			{},
			CancellationToken.None
		);
		assert.equal(symbols[0]?.name, '# First');
		assert.equal(symbols[0]?.children?.[0]?.name, '## Second heading');
	} finally {
		service.dispose();
	}
});

void test('file rename uses upstream workspace link edits with document versions', async () => {
	const document = {
		resource: 'prctr-workspace://attempt/readme.md',
		version: 7,
		text: '[Read](old.md#heading)\n'
	};
	const target = {
		resource: 'prctr-workspace://attempt/new.md',
		version: 2,
		text: '# Heading\n'
	};
	const service = workspace([document, target]);
	try {
		const edits = await service.renameLinks([
			{ oldResource: 'prctr-workspace://attempt/old.md', newResource: target.resource }
		]);
		assert.equal(edits.length, 1);
		assert.equal(edits[0]?.resource, document.resource);
		assert.equal(edits[0]?.text, 'new.md#heading');
		assert.equal(edits[0]?.version, 7);
		assert.equal(edits[0]?.startLine, 0);
		assert.equal(edits[0]?.startCharacter, 7);
	} finally {
		service.dispose();
	}
});
