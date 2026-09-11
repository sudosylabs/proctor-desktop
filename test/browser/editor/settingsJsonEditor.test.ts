import assert from '../upstream/assert.ts';
import { suite, test } from '../upstream/testAdapter.ts';
import { createEditorTestServices } from './editorTestServices.ts';
import { SettingsWorkingCopy } from '../../../src/prctr/workbench/services/settings/browser/settingsWorkingCopy.ts';
import { SettingsJsonEditor } from '../../../src/prctr/workbench/services/settings/browser/settingsJsonEditor.ts';

suite('Settings real Monaco view', () => {
	test('renders, edits and remounts the same real model with shared draft undo', async () => {
		const source = '{\n // preserved\n "editor.fontSize": 16\n}';
		const { store, host, instantiation, models, editors } =
			await createEditorTestServices(source);
		try {
			const copy = store.add(
				instantiation.createInstance(SettingsWorkingCopy, source, 'revision')
			);
			let view = store.add(
				instantiation.createInstance(SettingsJsonEditor, host, copy.document)
			);
			view.control.layout({ width: 600, height: 360 });
			view.control.render(true);
			assert.strictEqual(host.querySelectorAll('.monaco-editor').length, 1);
			assert.strictEqual(view.control.getModel(), copy.document.model);
			assert.strictEqual(copy.document.model.getLanguageId(), 'jsonc');
			await copy.draft.set('editor.fontSize', 20);
			assert.strictEqual(view.control.getValue().includes('20'), true);
			await copy.document.model.undo();
			assert.strictEqual(copy.draft.source, source);
			const model = view.control.getModel();
			view.dispose();
			assert.strictEqual(copy.document.model.isDisposed(), false);
			view = store.add(instantiation.createInstance(SettingsJsonEditor, host, copy.document));
			assert.strictEqual(view.control.getModel(), model);
			assert.strictEqual(editors.listCodeEditors().length, 1);
			view.dispose();
			copy.dispose();
			assert.strictEqual(models.getModels().length, 0);
			assert.strictEqual(editors.listCodeEditors().length, 0);
		} finally {
			store.dispose();
		}
	});
});
