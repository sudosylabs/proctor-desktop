import assert from 'node:assert';
import { test } from 'node:test';

import { Color } from '../../../../src/prctr/base/common/color.ts';
import {
	asCssVariable,
	asCssVariableName,
	getDesignTokenDefinitions
} from '../../../../src/prctr/platform/theme/common/tokens.ts';
import {
	getDensityTokenOverrides,
	getTheme,
	getThemes
} from '../../../../src/prctr/platform/theme/common/themes.ts';

test('four immutable packaged themes resolve every static semantic token', () => {
	const definitions = getDesignTokenDefinitions();
	const themes = getThemes();
	assert.deepStrictEqual(themes.map(theme => theme.id), [
		'dark', 'highContrastDark', 'highContrastLight', 'light'
	]);
	assert.strictEqual(new Set(definitions.map(definition => definition.id)).size, definitions.length);
	for (const definition of definitions) {
		assert.ok(/^[a-z]+(?:\.[a-z][A-Za-z]*)+$/u.test(definition.id));
		assert.ok(/^--prctr-/u.test(asCssVariableName(definition.id)));
		assert.strictEqual(asCssVariable(definition.id), `var(${asCssVariableName(definition.id)})`);
	}
	for (const theme of themes) {
		assert.ok(Object.isFrozen(theme));
		assert.ok(Object.isFrozen(theme.values));
		assert.deepStrictEqual(Object.keys(theme.values).sort(), definitions.map(definition => definition.id).sort());
	}
});

test('theme foregrounds meet ordinary text contrast against their canvases', () => {
	for (const theme of getThemes()) {
		const background = Color.Format.CSS.parseHex(theme.values['color.background.canvas']);
		const foreground = Color.Format.CSS.parseHex(theme.values['color.text.primary']);
		assert.ok(background !== null && foreground !== null);
		assert.ok(background.getContrastRatio(foreground) >= 4.5, `${theme.id} primary text contrast`);
		if (theme.isHighContrast) {
			assert.strictEqual(theme.values['elevation.modal'], 'none');
		}
	}
});

test('compact density uses explicit scale mappings without changing hit-area tokens', () => {
	assert.deepStrictEqual(getDensityTokenOverrides('default'), {});
	assert.deepStrictEqual(getDensityTokenOverrides('compact'), {
		'spacing.control.inline': '6px',
		'spacing.control.block': '4px',
		'spacing.content.medium': '6px',
		'spacing.content.large': '12px',
		'spacing.region': '16px'
	});
	assert.strictEqual(getTheme('light').values['icon.size.medium'], '16px');
});
