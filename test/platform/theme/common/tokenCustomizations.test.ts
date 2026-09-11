import assert from 'node:assert';
import { test } from 'node:test';
import {
	normalizeTokenColorCustomizations,
	normalizeSemanticTokenColorCustomizations
} from '../../../../src/prctr/platform/theme/common/tokenCustomizations.js';
import { resolveTokenColorCustomizations } from '../../../../src/prctr/platform/theme/common/tokenColorConfiguration.js';
import { getTheme } from '../../../../src/prctr/platform/theme/common/themes.js';
import { ColorThemeData } from '../../../../src/prctr/platform/theme/common/colorThemeData.js';
import { settingsRegistry } from '../../../../src/prctr/platform/settings/common/settingsRegistry.js';
import { parseSettingsDocument } from '../../../../src/prctr/platform/settings/common/settingsDocument.js';

void test('the source token schemas validate rules and preserve immutable theme scopes', () => {
	const setting = {
		comments: '#123456',
		textMateRules: [
			{
				scope: ['string.quoted.double.json', 'constant.numeric.json'],
				settings: { foreground: '#abcdef', fontStyle: 'italic bold', fontSize: 1.2 }
			}
		],
		'[GitHub Dark*]': { strings: '#fedcba' }
	};
	const normalized = normalizeTokenColorCustomizations(setting);
	assert.ok(normalized);
	assert.equal(JSON.stringify(normalized), JSON.stringify(setting));
	assert.ok(Object.isFrozen(normalized));
	assert.ok(Object.isFrozen(normalized.textMateRules![0]!.settings));
	setting.textMateRules[0]!.settings.foreground = '#000000';
	assert.equal(normalized.textMateRules![0]!.settings.foreground, '#abcdef');
	const inherited = resolveTokenColorCustomizations(normalized);
	assert.equal(inherited.textMateRules![0]!.settings.lineHeight, 1.2);
	assert.equal(normalized.textMateRules![0]!.settings.lineHeight, undefined);
	assert.ok(
		normalizeSemanticTokenColorCustomizations({
			enabled: true,
			rules: { 'variable.readonly:jsonc': { foreground: '#123456', bold: true } },
			'[GitHub Dark Default]': { enabled: false }
		})
	);
});

void test('malformed, executable, recursive and oversized token customization data is rejected', () => {
	const invalid = [
		null,
		[],
		12,
		{ comments: 'red' },
		{ textMateRules: [{ scope: 'string', settings: { foreground: 'url(https://invalid)' } }] },
		{ textMateRules: [{ settings: { fontStyle: 'boldish' } }] },
		{ comments: () => '#123456' },
		{ textMateRules: new Array(8193) },
		{
			textMateRules: [
				{ scope: 'x'.repeat(256 * 1024 + 1), settings: { foreground: '#123456' } }
			]
		},
		JSON.parse('{"__proto__":{"comments":"#123456"}}')
	];
	for (const value of invalid) assert.equal(normalizeTokenColorCustomizations(value), undefined);
	for (const value of [
		{ enabled: 'yes' },
		{ rules: { variable: { bold: 'yes' } } },
		{ rules: { variable: 'url(x)' } }
	])
		assert.equal(normalizeSemanticTokenColorCustomizations(value), undefined);
	const recursive: Record<string, unknown> = {};
	recursive.comments = recursive;
	assert.equal(normalizeTokenColorCustomizations(recursive), undefined);
	const shared = { foreground: '#123456' };
	assert.ok(normalizeTokenColorCustomizations({ comments: shared, strings: shared }));
});

void test('bundled theme customization honors source scope precedence and resets to the original palette', () => {
	const base = getTheme('GitHub Dark Default');
	const custom = getTheme(
		'GitHub Dark Default',
		{},
		{
			comments: '#111111',
			'[GitHub Dark*]': { comments: '#222222' },
			'[GitHub Dark Default]': { comments: '#333333' }
		},
		{
			enabled: true,
			rules: { 'variable.readonly:jsonc': { foreground: '#445566', bold: true } }
		}
	);
	assert.ok(custom.colorTheme instanceof ColorThemeData);
	assert.equal(custom.colorTheme.resolveScopes([['comment']])?.foreground?.toString(), '#333333');
	const style = custom.colorTheme.getTokenStyleMetadata('variable', ['readonly'], 'jsonc');
	assert.ok(style);
	assert.equal(style.bold, true);
	assert.equal(custom.colorTheme.tokenColorMap[style.foreground!], '#445566');
	assert.deepStrictEqual(custom.colors, base.colors);
	assert.deepStrictEqual(
		getTheme('GitHub Dark Default').colorTheme.tokenColors,
		base.colorTheme.tokenColors
	);
	assert.ok(
		settingsRegistry.normalize('editor.tokenColorCustomizations', { comments: '#abcdef' })
	);
	assert.ok(
		parseSettingsDocument('{"editor.tokenColorCustomizations":{"comments":"#abcdef"}}').valid
	);
	assert.ok(
		!parseSettingsDocument('{"editor.semanticTokenColorCustomizations":{"enabled":"yes"}}')
			.valid
	);
});
