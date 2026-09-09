import assert from 'node:assert';
import { suite, test } from '../../../base/common/upstream/testAdapter.ts';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../base/common/upstream/upstreamTestUtils.ts';
import { Event } from '../../../../src/prctr/base/common/event.ts';
import { URI } from '../../../../src/prctr/base/common/uri.ts';
import { ConfigurationService } from '../../../../src/prctr/platform/configuration/common/configurationService.ts';
import { NullPolicyService } from '../../../../src/prctr/platform/policy/common/policy.ts';
import { NullLogService } from '../../../../src/prctr/platform/settings/common/configurationPorts.ts';
import { SettingsDraft } from '../../../../src/prctr/platform/settings/common/settingsDraft.ts';
import { registerSettingsConfiguration } from '../../../../src/prctr/platform/settings/common/settingsConfigurationRegistry.ts';
import {
	SettingsDraftStorage,
	SettingsResourceFileService,
	userSettingsResource
} from '../../../../src/prctr/platform/settings/common/settingsResource.ts';

suite('Proctor settings configuration adapters', () => {
	const disposables = ensureNoDisposablesAreLeakedInTestSuite();

	test('structured edits preserve comments, queue updates, remove defaults, and edit language overrides', async () => {
		const draft = disposables.add(
			new SettingsDraft('{\n  // user font\n  "editor.fontSize": 18\n}', 'r1')
		);
		await Promise.all([
			draft.set('editor.fontSize', 20),
			draft.set('editor.tabSize', 8, 'typescript')
		]);
		assert.ok(draft.source.includes('// user font'));
		assert.strictEqual(draft.validation.values.get('editor.fontSize'), 20);
		assert.strictEqual(
			draft.validation.languageValues.get('typescript')?.get('editor.tabSize'),
			8
		);
		await draft.set('editor.fontSize', 14);
		assert.strictEqual(draft.validation.values.has('editor.fontSize'), false);
	});

	test('a JSONC edit during an asynchronous structured edit cannot be overwritten', async () => {
		const draft = disposables.add(new SettingsDraft('{"editor.fontSize":18}', 'r1'));
		const editing = draft.set('editor.fontSize', 20);
		await Promise.resolve();
		draft.replaceSource('{"editor.fontSize":22}');
		await assert.rejects(editing, /changed during the edit/u);
		assert.strictEqual(draft.source, '{"editor.fontSize":22}');
	});

	test('restoring the original JSONC text still fences an earlier structured edit', async () => {
		const source = '{"editor.fontSize":18}';
		const draft = disposables.add(new SettingsDraft(source, 'r1'));
		const editing = draft.set('editor.fontSize', 20);
		await Promise.resolve();
		draft.replaceSource('{"editor.fontSize":22}');
		draft.replaceSource(source);
		await assert.rejects(editing, /changed during the edit/u);
		assert.strictEqual(draft.source, source);
	});

	test('a disposed draft cannot accept a pending edit', async () => {
		const draft = disposables.add(new SettingsDraft('{}', 'r1'));
		const editing = draft.set('editor.fontSize', 20);
		draft.dispose();
		await assert.rejects(editing, /disposed/u);
		assert.strictEqual(draft.source, '{}');
	});

	test('the same upstream service reloads storage changes and reports affected keys', async () => {
		registerSettingsConfiguration();
		const storage = disposables.add(new SettingsDraftStorage('{"editor.fontSize":18}'));
		const files = disposables.add(new SettingsResourceFileService(storage));
		const service = disposables.add(
			new ConfigurationService(
				userSettingsResource,
				files,
				new NullPolicyService(),
				new NullLogService()
			)
		);
		await service.initialize();
		assert.strictEqual(service.getValue('editor.fontSize'), 18);
		const changed = Event.toPromise(service.onDidChangeConfiguration);
		storage.replace('{"editor.fontSize":20}');
		const event = await changed;
		assert.strictEqual(event.affectsConfiguration('editor.fontSize'), true);
		assert.strictEqual(event.affectsConfiguration('window.zoomLevel'), false);
		assert.strictEqual(service.getValue('editor.fontSize'), 20);
		await assert.rejects(
			files.readFile(URI.from({ scheme: 'proctor-settings', path: '/another.json' })),
			/Unknown settings resource/u
		);
	});

	test('storage write failure propagates without changing the configuration', async () => {
		registerSettingsConfiguration();
		const files = disposables.add(
			new SettingsResourceFileService({
				onDidChange: Event.None,
				async read() {
					return '{"editor.fontSize":18}';
				},
				async write() {
					throw new Error('storage unavailable');
				}
			})
		);
		const service = disposables.add(
			new ConfigurationService(
				userSettingsResource,
				files,
				new NullPolicyService(),
				new NullLogService()
			)
		);
		await service.initialize();
		await assert.rejects(service.updateValue('editor.fontSize', 20), /storage unavailable/u);
		assert.strictEqual(service.getValue('editor.fontSize'), 18);
	});
});
