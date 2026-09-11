import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SettingsEditorConfiguration } from '../../../src/prctr/workbench/services/settings/common/settingsEditorConfiguration.js';
import { SettingsDraft } from '../../../src/prctr/platform/settings/common/settingsDraft.js';
import { ConfigurationTarget } from '../../../src/prctr/platform/configuration/common/configuration.js';

void test('editor configuration activates only declared preferences and preserves source through draft edits', async () => {
	const source =
		'{\n // keep this\n "editor.fontSize": 16, "unregistered.flag": true, "[jsonc]": { "editor.fontSize": 19 }\n}';
	const draft = new SettingsDraft(source, 'revision');
	const configuration = new SettingsEditorConfiguration(source);
	try {
		await configuration.initialize();
		configuration.bindDraft(draft);
		assert.equal(configuration.getValue('unregistered.flag'), undefined);
		assert.equal(configuration.getValue('editor.fontSize'), 16);
		assert.equal(
			configuration.getValue('editor.fontSize', { overrideIdentifier: 'jsonc' }),
			19
		);
		const events: string[] = [];
		const listener = configuration.onDidChangeConfiguration((event) => {
			if (event.affectsConfiguration('editor.fontSize')) events.push('font');
		});
		await configuration.updateValue('editor.fontSize', 18);
		assert.match(draft.source, /keep this/);
		assert.match(draft.source, /"unregistered.flag": true/);
		assert.equal(configuration.getValue('editor.fontSize'), 18);
		assert.ok(events.length > 0);
		await configuration.updateValue('editor.fontSize', undefined, {
			overrideIdentifier: 'jsonc'
		});
		assert.equal(
			configuration.getValue('editor.fontSize', { overrideIdentifier: 'jsonc' }),
			18
		);
		assert.equal(configuration.inspect('editor.fontSize').defaultValue, 14);
		listener.dispose();
	} finally {
		configuration.dispose();
		draft.dispose();
	}
});

void test('invalid edits retain last valid runtime settings, and excluded targets cannot mutate the draft', async () => {
	const source = '{"editor.fontSize":16}';
	const draft = new SettingsDraft(source, 'revision');
	const configuration = new SettingsEditorConfiguration(source);
	try {
		await configuration.initialize();
		configuration.bindDraft(draft);
		draft.replaceSource('{"editor.fontSize":');
		await configuration.refresh();
		assert.equal(configuration.getValue('editor.fontSize'), 16);
		draft.replaceSource(source);
		for (const target of [
			ConfigurationTarget.WORKSPACE,
			ConfigurationTarget.WORKSPACE_FOLDER,
			ConfigurationTarget.USER_REMOTE
		]) {
			await assert.rejects(configuration.updateValue('editor.fontSize', 20, target));
		}
		await assert.rejects(configuration.updateValue('unregistered.flag', true));
		assert.equal(draft.source, source);
		configuration.bindDraft(undefined);
		await assert.rejects(configuration.updateValue('editor.fontSize', 20));
	} finally {
		configuration.dispose();
		draft.dispose();
	}
});
