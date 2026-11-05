import assert from 'node:assert';
import { suite, test } from '../../../base/common/upstream/testAdapter.ts';
import {
	SettingsDraft,
	mergeSettingsSources
} from '../../../../src/prctr/platform/settings/common/settingsDraft.ts';
import { migrateSettingsDocument } from '../../../../src/prctr/platform/settings/common/settingsMigration.ts';

suite('Settings migration and draft', () => {
	test('migrates a legacy property deterministically while retaining surrounding comments', () => {
		const source =
			'{\n  // legacy tree presentation\n  "explorer.tree.indent": 12,\n  "future.key": true\n}';
		const first = migrateSettingsDocument(source, 1);
		const second = migrateSettingsDocument(source, 1);
		assert.strictEqual(first.source, second.source);
		assert.strictEqual(first.changed, true);
		assert.ok(first.source.includes('// legacy tree presentation'));
		assert.ok(first.source.includes('"workbench.tree.indent": 12'));
		assert.ok(first.source.includes('"future.key": true'));
	});

	test('structured and JSONC editing share one source', async () => {
		const draft = new SettingsDraft('{\n  // font\n  "editor.fontSize": 14\n}', 'rev-1');
		await draft.set('editor.fontSize', 18);
		assert.ok(draft.source.includes('// font'));
		assert.strictEqual(draft.validation.values.get('editor.fontSize'), 18);
		draft.replaceSource('{"editor.fontSize":16}');
		assert.strictEqual(draft.validation.values.get('editor.fontSize'), 16);
		draft.dispose();
	});

	test('merges disjoint known paths and makes ambiguous conflicts explicit', () => {
		const base = '{\n  // base\n  "editor.fontSize": 14,\n  "window.zoomLevel": 100\n}';
		const merged = mergeSettingsSources(
			base,
			base.replace('14', '16'),
			base.replace('100', '120')
		);
		assert.deepStrictEqual(merged.conflicts, []);
		assert.ok(merged.merged?.includes('"editor.fontSize": 16'));
		assert.ok(merged.merged?.includes('"window.zoomLevel": 120'));
		assert.strictEqual(
			mergeSettingsSources(base, base.replace('14', '16'), base.replace('14', '18'))
				.conflicts[0]?.reason,
			'same-path'
		);
		assert.strictEqual(
			mergeSettingsSources('{}', '{"future.key":1}', '{}').conflicts[0]?.reason,
			'unknown-property'
		);
	});

	test('merges disjoint values without dropping draft JSONC comments', () => {
		const base = '{\n  // base font\n  "editor.fontSize": 14,\n  "window.zoomLevel": 100\n}';
		const draft = base.replace('// base font', '// candidate font choice').replace('14', '16');
		const latest = base.replace('100', '120');
		const result = mergeSettingsSources(base, draft, latest);
		assert.deepStrictEqual(result.conflicts, []);
		assert.ok(result.merged?.includes('// candidate font choice'));
		assert.ok(result.merged?.includes('"editor.fontSize": 16'));
		assert.ok(result.merged?.includes('"window.zoomLevel": 120'));
		const triviaOnly = mergeSettingsSources(
			base,
			base.replace('// base font', '// retained note'),
			latest
		);
		assert.deepStrictEqual(triviaOnly.conflicts, []);
		assert.ok(triviaOnly.merged?.includes('// retained note'));
		assert.ok(triviaOnly.merged?.includes('"window.zoomLevel": 120'));
		const mixed = mergeSettingsSources(
			base,
			base.replace('// base font', '// candidate note').replace('100', '110'),
			base.replace('14', '18')
		);
		assert.deepStrictEqual(mixed.conflicts, []);
		assert.ok(mixed.merged?.includes('// candidate note'));
		assert.ok(mixed.merged?.includes('"window.zoomLevel": 110'));
		assert.ok(mixed.merged?.includes('"editor.fontSize": 18'));
	});
});
