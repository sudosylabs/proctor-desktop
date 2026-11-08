import assert from '../upstream/assert.ts';
import { suite, test } from '../upstream/testAdapter.ts';
import { createEditorTestServices } from './editorTestServices.ts';
import { SettingsEditorModels } from '../../../src/prctr/workbench/services/settings/browser/settingsEditorModels.ts';
import { settingsEditorLayout } from '../../../src/prctr/workbench/services/settings/browser/settingsEditorCatalog.ts';
import { settingsRegistry } from '../../../src/prctr/platform/settings/common/settingsRegistry.ts';
import { SettingsTargetsWidget } from '../../../src/prctr/workbench/contrib/preferences/browser/preferencesWidgets.ts';
import { ConfigurationTarget } from '../../../src/prctr/platform/configuration/common/configuration.ts';

suite('Graphical Settings catalog and target', () => {
	test('original Settings2EditorModel exposes exactly the packaged settings and their schema metadata', async () => {
		const f = await createEditorTestServices('{}');
		try {
			const factory = f.store.add(f.instantiation.createInstance(SettingsEditorModels));
			const model = f.store.add(factory.createGraphicalModel());
			const settings = model.settingsGroups
				.slice(1)
				.flatMap((group) => group.sections.flatMap((section) => section.settings));
			const keys = settings
				.filter((setting) => !setting.isLanguageTagSetting)
				.map((setting) => setting.key);
			// The editor theme belongs to the exam window, so this window's editor omits it.
			const authenticated = settingsRegistry.declarations
				.filter(
					(setting) =>
						setting.candidate !== 'prohibited' &&
						setting.windows.includes('authenticated')
				)
				.map((setting) => setting.id);
			assert.deepStrictEqual([...keys].sort(), [...authenticated].sort());
			const catalog = settingsEditorLayout.children!.flatMap((section) => section.settings!);
			assert.deepStrictEqual([...catalog].sort(), [...authenticated].sort());
			const size = settings.find((setting) => setting.key === 'editor.fontSize')!;
			assert.ok(size.validator?.('2'));
			assert.ok(!size.validator?.('18'));
			assert.ok(
				settings.find((setting) => setting.key === 'workbench.colorCustomizations')
					?.objectPatternProperties
			);
			assert.ok(factory.readDefaults().includes('editor.fontSize'));
		} finally {
			f.store.dispose();
		}
	});

	test('retains original tab semantics, checked state, count and language label with one user target', async () => {
		const f = await createEditorTestServices('{}');
		try {
			const target = f.store.add(
				f.instantiation.createInstance(SettingsTargetsWidget, f.host)
			);
			target.settingsTarget = ConfigurationTarget.USER_LOCAL;
			const tabs = f.host.querySelectorAll('[role="tab"]');
			assert.strictEqual(tabs.length, 1);
			assert.strictEqual(tabs[0]!.getAttribute('aria-selected'), 'true');
			target.setResultCount(ConfigurationTarget.USER_LOCAL, 7);
			assert.ok(f.host.textContent?.includes('User (7)'));
			target.updateLanguageFilterIndicators('jsonc');
			assert.ok(f.host.textContent?.includes('JSON with Comments'));
			let changed = 0;
			f.store.add(target.onDidTargetChange(() => changed++));
			await target.updateTarget(ConfigurationTarget.USER_LOCAL);
			assert.strictEqual(changed, 0);
			let rejected = false;
			try {
				await target.updateTarget(ConfigurationTarget.WORKSPACE);
			} catch {
				rejected = true;
			}
			assert.strictEqual(rejected, true);
			assert.strictEqual(target.settingsTarget, ConfigurationTarget.USER_LOCAL);
		} finally {
			f.store.dispose();
		}
	});
});

import { installSettingsControlTestServices } from './editorTestServices.ts';
import { SettingsTreeModel } from '../../../src/prctr/workbench/contrib/preferences/browser/settingsTreeModels.ts';
import {
	SettingsTree,
	SettingTreeRenderers
} from '../../../src/prctr/workbench/contrib/preferences/browser/settingsTree.ts';
import { createGroupIterator } from '../../../src/prctr/workbench/contrib/preferences/browser/settingsEditor2.ts';
import { SettingsWorkingCopy } from '../../../src/prctr/workbench/services/settings/browser/settingsWorkingCopy.ts';

suite('Original graphical Settings renderers', () => {
	test('virtualized boolean and number controls edit the shared draft and reject invalid input', async () => {
		const f = await createEditorTestServices(
			'{"editor.fontSize":18,"editor.minimap.enabled":false}'
		);
		try {
			installSettingsControlTestServices(f);
			f.host.classList.add('settings-editor');
			const body = f.host.appendChild(document.createElement('div'));
			body.className = 'settings-body';
			const treeContainer = body.appendChild(document.createElement('div'));
			treeContainer.className = 'settings-tree-container';
			const copy = f.store.add(
				f.instantiation.createInstance(
					SettingsWorkingCopy,
					'{"editor.fontSize":18,"editor.minimap.enabled":false}',
					'r1'
				)
			);
			const factory = f.store.add(f.instantiation.createInstance(SettingsEditorModels));
			const defaults = f.store.add(factory.createGraphicalModel());
			const settings = defaults.settingsGroups
				.slice(1)
				.flatMap((group) => group.sections.flatMap((section) => section.settings));
			const state = { settingsTarget: ConfigurationTarget.USER_LOCAL as const };
			const model = f.store.add(
				f.instantiation.createInstance(SettingsTreeModel, state, true)
			);
			model.update({
				id: 'editor',
				label: 'Editor',
				settings: settings.filter((setting) =>
					['editor.fontSize', 'editor.minimap.enabled'].includes(setting.key)
				)
			});
			const renderers = f.store.add(f.instantiation.createInstance(SettingTreeRenderers));
			let pending: Promise<void> = Promise.resolve();
			f.store.add(
				renderers.onDidChangeSetting((change) => {
					pending = f.configuration.updateValue(change.key, change.value);
				})
			);
			const tree = f.store.add(
				f.instantiation.createInstance(
					SettingsTree,
					treeContainer,
					state,
					renderers.allRenderers
				)
			);
			tree.layout(360, 600);
			tree.setChildren(null, createGroupIterator(model.root));
			const checkbox = f.host.querySelector<HTMLElement>('[role="checkbox"]');
			assert.ok(checkbox, 'Original Settings boolean renderer did not mount.');
			assert.strictEqual(checkbox.getAttribute('aria-checked'), 'false');
			checkbox.click();
			await pending;
			assert.strictEqual(f.configuration.getValue('editor.minimap.enabled'), true);
			assert.strictEqual(copy.draft.validation.values.has('editor.minimap.enabled'), false);
			const number = f.host.querySelector<HTMLInputElement>('input[type="number"]');
			assert.ok(number, 'Original Settings number renderer did not mount.');
			number.value = '20';
			number.dispatchEvent(new Event('input', { bubbles: true }));
			await pending;
			assert.strictEqual(copy.draft.validation.values.get('editor.fontSize'), 20);
			number.value = '2';
			number.dispatchEvent(new Event('input', { bubbles: true }));
			await pending;
			assert.strictEqual(copy.draft.validation.values.get('editor.fontSize'), 20);
			assert.ok(
				f.host.querySelector('.invalid-input .setting-item-validation-message')?.textContent
			);
			await copy.document.model.undo();
			assert.strictEqual(copy.draft.validation.values.get('editor.fontSize'), 18);
		} finally {
			f.store.dispose();
		}
	});
});
