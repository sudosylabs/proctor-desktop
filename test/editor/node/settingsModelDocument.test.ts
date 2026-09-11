import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DisposableStore } from '../../../src/prctr/base/common/lifecycle.js';
import { IModelService } from '../../../src/prctr/editor/common/services/model.js';
import { IUndoRedoService } from '../../../src/prctr/platform/undoRedo/common/undoRedo.js';
import { EndOfLineSequence } from '../../../src/prctr/editor/common/model.js';
import { Range } from '../../../src/prctr/editor/common/core/range.js';
import { SettingsDraft } from '../../../src/prctr/platform/settings/common/settingsDraft.js';
import { userSettingsResource } from '../../../src/prctr/platform/settings/common/settingsResource.js';
import { SettingsModelDocument } from '../../../src/prctr/workbench/services/settings/common/settingsModelDocument.js';
import { createModelServices } from '../common/upstream/testTextModel.js';

function fixture(source: string) {
	const store = new DisposableStore();
	const services = createModelServices(store);
	const models = services.get(IModelService);
	const model = store.add(models.createModel(source, null, userSettingsResource));
	const document = store.add(new SettingsModelDocument(model, models, services.get(IUndoRedoService), source));
	const draft = store.add(new SettingsDraft(source, 'revision-1', document));
	return { store, models, model, document, draft };
}

test('Settings controls and JSON typing share the original model and undo stack', async () => {
	const source = '{\n\t// retain this comment\n\t"editor.fontSize": 14,\n\t"unknown.setting": "preserve"\n}\n';
	const f = fixture(source);
	try {
		const identity = f.model.id;
		await f.draft.set('editor.fontSize', 18);
		const structured = f.model.getValue();
		assert.equal(f.draft.source, structured);
		assert.match(structured, /"editor.fontSize": 18/);
		assert.match(structured, /retain this comment/);
		assert.match(structured, /"unknown.setting": "preserve"/);
		f.model.pushEditOperations(null, [{ range: new Range(1, 2, 1, 2), text: '\n// JSON edit' }], () => null);
		f.model.pushStackElement();
		assert.equal(f.draft.source, f.model.getValue());
		await f.model.undo();
		assert.equal(f.draft.source, structured);
		await f.model.undo();
		assert.equal(f.draft.source, source);
		await f.model.redo();
		assert.equal(f.draft.source, structured);
		assert.equal(f.model.id, identity);
	} finally { f.store.dispose(); }
});

test('JSON typing fences a queued structured edit instead of overwriting it', async () => {
	const f = fixture('{"editor.fontSize":14}');
	try {
		const pending = f.draft.set('editor.fontSize', 18);
		f.model.pushEditOperations(null, [{ range: new Range(1, 2, 1, 2), text: '"unknown": true, ' }], () => null);
		await assert.rejects(pending, /changed during the edit/);
		assert.match(f.draft.source, /"unknown": true/);
		assert.match(f.draft.source, /"editor.fontSize":14/);
	} finally { f.store.dispose(); }
});

for (const [before, after] of [
	['{"unknown":"😀"}', '{"unknown":"😁"}'],
	['{\r\n"unknown": 1\r\n}', '{\r\n"unknown": 2\r\n}'],
	['{\n"unknown": 1\n}', '{\r\n"unknown": 2\r\n}']
]) test(`Model updates preserve exact source and undo across Unicode and EOL: ${JSON.stringify(before)}`, async () => {
	const f = fixture(before!);
	try {
		f.draft.replaceSource(after!);
		assert.equal(f.draft.source, after);
		await f.model.undo();
		assert.equal(f.draft.source, before);
	} finally { f.store.dispose(); }
});

test('Disposal makes a model document unreadable and does not destroy a borrowed model', async () => {
	const f = fixture('{}');
	try {
		f.document.dispose();
		assert.throws(() => f.document.value, /disposed/);
		await assert.rejects(f.document.write('{"unknown":true}'), /disposed/);
		assert.equal(f.model.isDisposed(), false);
	} finally { f.store.dispose(); }
});

test('A mismatched base cannot attach to a working document', () => {
	const f = fixture('{}');
	try { assert.throws(() => new SettingsDraft('{"unknown":true}', 'other', f.document), /does not match/); }
	finally { f.store.dispose(); }
});

for (const source of ['{\r\n\t"editor.fontSize": 14,\n\t"unknown": "😀"\r}\n', '\uFEFF{\r\n"unknown": 1\n}\r\n']) {
	test('Opening and editing retains original mixed line endings and BOM: ' + JSON.stringify(source), async () => {
		const f = fixture(source);
		try {
			assert.equal(f.document.value, source);
			const firstLine = f.model.getLineContent(1);
			f.model.pushEditOperations(null, [{ range: new Range(1, firstLine.length + 1, 1, firstLine.length + 1), text: ' ' }], () => null);
			f.model.pushStackElement();
			assert.equal(f.document.value, source.replace('{', '{ '));
			await f.model.undo();
			assert.equal(f.document.value, source);
			await f.model.redo();
			assert.equal(f.document.value, source.replace('{', '{ '));
		} finally { f.store.dispose(); }
	});
}

test('A structured edit preserves untouched mixed endings and undo/redo serialization', async () => {
	const source = '{\r\n\t"editor.fontSize": 14,\n\t"unknown": true\r\n}\n';
	const f = fixture(source);
	try {
		await f.draft.set('editor.fontSize', 18);
		assert.equal(f.document.value, source.replace('14', '18'));
		await f.model.undo();
		assert.equal(f.document.value, source);
		await f.model.redo();
		assert.equal(f.document.value, source.replace('14', '18'));
	} finally { f.store.dispose(); }
});

test('Serialization-only changes participate in the same model undo stack', async () => {
	const source = '{\r\n"unknown": true\n}\n';
	const next = '{\n"unknown": true\n}\n';
	const f = fixture(source);
	try {
		f.document.replace(next);
		assert.equal(f.document.value, next);
		await f.model.undo();
		assert.equal(f.document.value, source);
		await f.model.redo();
		assert.equal(f.document.value, next);
	} finally { f.store.dispose(); }
});

for (const [before, after] of [['\uFEFF{\n}', '{\n}'], ['{\n}', '\uFEFF{\n}']]) {
	test('EOL change retains independently edited BOM and its undo history: ' + JSON.stringify(before), async () => {
		const f = fixture(before!);
		try {
			f.document.replace(after!);
			f.model.pushStackElement();
			f.model.pushEOL(EndOfLineSequence.CRLF);
			f.model.pushStackElement();
			await Promise.resolve();
			assert.equal(f.document.value, after!.replace('\n', '\r\n'));
			await f.model.undo(); assert.equal(f.document.value, after);
			await f.model.undo(); assert.equal(f.document.value, before);
			await f.model.redo(); assert.equal(f.document.value, after);
			await f.model.redo(); assert.equal(f.document.value, after!.replace('\n', '\r\n'));
		} finally { f.store.dispose(); }
	});
}

test('Structured changes preserve exact value ranges and neighbouring model decorations', async () => {
	const source = '{"editor.fontSize":14,"unknown":"preserve"}';
	const f = fixture(source);
	try {
		const events: { rangeOffset: number; rangeLength: number; text: string }[] = [];
		f.store.add(f.model.onDidChangeContent(event => events.push(...event.changes)));
		await f.draft.set('editor.fontSize', 18);
		assert.deepEqual(events.map(({ rangeOffset, rangeLength, text }) => ({ rangeOffset, rangeLength, text })), [{ rangeOffset: 19, rangeLength: 2, text: '18' }]);
		await f.model.undo(); assert.equal(f.document.value, source);
	} finally { f.store.dispose(); }
});

test('Acknowledging captured A retains later B as dirty without splitting model undo history', async () => {
	const f = fixture('{"editor.fontSize":14}');
	try {
		await f.draft.set('editor.fontSize', 18);
		const submitted = f.draft.source;
		await f.draft.set('editor.fontSize', 20);
		const later = f.draft.source;
		f.draft.acknowledge(submitted, 'revision-2');
		assert.equal(f.draft.baseRevision, 'revision-2');
		assert.equal(f.draft.baseSource, submitted);
		assert.equal(f.draft.source, later);
		await f.model.undo(); assert.equal(f.draft.source, submitted);
		await f.model.redo(); assert.equal(f.draft.source, later);
	} finally { f.store.dispose(); }
});

test('Discarded undo branches do not resurrect their mixed-EOL serialization', async () => {
	const source = '{\r\n"unknown":true\n}\n';
	const f = fixture(source);
	try {
		f.document.replace(source.replace('true', 'false').replace('\r\n', '\n'));
		await Promise.resolve();
		await f.model.undo();
		f.document.replace(source.replace('true', 'null'));
		await Promise.resolve();
		assert.equal(f.model.canRedo(), false);
		await f.model.undo(); assert.equal(f.document.value, source);
		await f.model.redo(); assert.equal(f.document.value, source.replace('true', 'null'));
	} finally { f.store.dispose(); }
});
