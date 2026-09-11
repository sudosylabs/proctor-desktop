import assert from 'node:assert';
import { test } from 'node:test';
import { BUNDLED_THEMES } from '../../../../src/prctr/platform/theme/common/bundledThemes.ts';
import { bundledThemeResources } from '../../../../src/prctr/platform/theme/common/bundledThemeResources.generated.ts';
import { bundledThemeSnapshots } from '../../../../src/prctr/platform/theme/common/bundledThemeSnapshots.generated.ts';
import { ColorThemeData } from '../../../../src/prctr/platform/theme/common/colorThemeData.ts';
import {
	loadPackagedTheme,
	restorePackagedTheme,
	ThemeSnapshotStorage
} from '../../../../src/prctr/platform/theme/common/packagedThemeLoader.ts';

void test('all packaged snapshots preserve the complete resource-loaded token and semantic theme', async () => {
	for (const entry of BUNDLED_THEMES) {
		const loaded = await loadPackagedTheme(entry.name, bundledThemeResources);
		const restored = restorePackagedTheme(bundledThemeSnapshots[entry.name]!);
		assert.strictEqual(restored.settingsId, loaded.settingsId);
		assert.strictEqual(restored.type, loaded.type);
		assert.strictEqual(restored.semanticHighlighting, loaded.semanticHighlighting);
		assert.deepStrictEqual(restored.tokenColors, loaded.tokenColors);
		assert.deepStrictEqual(restored.tokenColorMap, loaded.tokenColorMap);
		assert.deepStrictEqual(restored.tokenFontMap, loaded.tokenFontMap);
		assert.ok(loaded.tokenColors.length > 20, entry.name);
		for (const scopes of [
			['comment'],
			['string.quoted.double.json'],
			['constant.numeric.json'],
			['support.type.property-name.json']
		]) {
			assert.deepStrictEqual(
				restored.resolveScopes([scopes]),
				loaded.resolveScopes([scopes])
			);
		}
		for (const type of ['variable', 'class', 'function', 'property']) {
			assert.deepStrictEqual(
				restored.getTokenStyleMetadata(type, ['readonly'], 'typescript'),
				loaded.getTokenStyleMetadata(type, ['readonly'], 'typescript')
			);
		}
		const storage = new ThemeSnapshotStorage();
		loaded.toStorage(storage);
		assert.strictEqual(storage.serialize(), bundledThemeSnapshots[entry.name]);
	}
});

void test('token and semantic customization invalidates loaded style caches and resets cleanly', async () => {
	const theme = await loadPackagedTheme('GitHub Dark Default', bundledThemeResources);
	const initial = theme.tokenColors;
	theme.setCustomTokenColors({
		textMateRules: [
			{
				scope: 'string.quoted.double.json',
				settings: {
					foreground: '#123456',
					fontStyle: 'italic bold underline strikethrough'
				}
			}
		]
	});
	assert.strictEqual(JSON.stringify(theme.tokenColors) === JSON.stringify(initial), false);
	assert.strictEqual(
		theme.resolveScopes([['string.quoted.double.json']])?.foreground?.toString(),
		'#123456'
	);
	theme.setCustomSemanticTokenColors({
		enabled: true,
		rules: { 'variable.readonly:typescript': { foreground: '#abcdef', bold: true } }
	});
	const style = theme.getTokenStyleMetadata('variable', ['readonly'], 'typescript');
	assert.ok(style);
	assert.strictEqual(style.bold, true);
	assert.strictEqual(theme.tokenColorMap[style.foreground!], '#ABCDEF');
	theme.setCustomTokenColors({});
	theme.setCustomSemanticTokenColors({});
	assert.deepStrictEqual(theme.tokenColors, initial);
});

void test('theme snapshot and resource adapters enforce their bounded catalog', async () => {
	assert.throws(() => restorePackagedTheme('{'));
	assert.throws(() => restorePackagedTheme('{}'));
	const storage = new ThemeSnapshotStorage();
	assert.throws(() => storage.serialize());
	assert.throws(() => storage.get('another-account', 0));
	assert.throws(() => storage.store(ColorThemeData.STORAGE_KEY, '{}', 1, 0));
	await assert.rejects(loadPackagedTheme('Unknown', bundledThemeResources));
	const entry = BUNDLED_THEMES[0]!;
	for (const include of [
		'https://example.test/theme.json',
		'../../outside.json',
		'missing.json'
	]) {
		await assert.rejects(
			loadPackagedTheme(entry.name, { [entry.path]: JSON.stringify({ include }) })
		);
	}
});
