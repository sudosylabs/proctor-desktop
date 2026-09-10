import assert from 'node:assert';
import { test } from 'node:test';

import { Color } from '../../../../src/prctr/base/common/color.ts';
import { BUNDLED_THEMES } from '../../../../src/prctr/platform/theme/common/bundledThemes.ts';
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

void test('four immutable packaged themes resolve every static semantic token', () => {
	const definitions = getDesignTokenDefinitions();
	const themes = getThemes();
	assert.deepStrictEqual(
		themes.map((theme) => theme.id),
		['dark', 'highContrastDark', 'highContrastLight', 'light']
	);
	assert.strictEqual(
		new Set(definitions.map((definition) => definition.id)).size,
		definitions.length
	);
	for (const definition of definitions) {
		assert.ok(/^[a-z]+(?:\.[a-z][A-Za-z]*)+$/u.test(definition.id));
		assert.ok(/^--prctr-/u.test(asCssVariableName(definition.id)));
		assert.strictEqual(
			asCssVariable(definition.id),
			`var(${asCssVariableName(definition.id)})`
		);
	}
	for (const theme of themes) {
		assert.ok(Object.isFrozen(theme));
		assert.ok(Object.isFrozen(theme.values));
		assert.deepStrictEqual(
			Object.keys(theme.values).sort(),
			definitions.map((definition) => definition.id).sort()
		);
	}
});

void test('theme foregrounds meet ordinary text contrast against their canvases', () => {
	for (const theme of getThemes()) {
		const background = Color.Format.CSS.parseHex(theme.values['color.background.canvas']);
		const foreground = Color.Format.CSS.parseHex(theme.values['color.text.primary']);
		assert.ok(background !== null && foreground !== null);
		assert.ok(
			background.getContrastRatio(foreground) >= 4.5,
			`${theme.id} primary text contrast`
		);
		if (theme.isHighContrast) {
			assert.strictEqual(theme.values['elevation.modal'], 'none');
		}
	}
});

void test('compact density uses explicit scale mappings without changing hit-area tokens', () => {
	assert.deepStrictEqual(getDensityTokenOverrides('default'), {});
	assert.deepStrictEqual(getDensityTokenOverrides('compact'), {
		'spacing.workbench.gap': '0px',
		'spacing.workbench.rowInset': '2px',
		'spacing.control.inline': '6px',
		'spacing.control.block': '4px',
		'spacing.content.medium': '6px',
		'spacing.content.large': '12px',
		'spacing.region': '16px'
	});
	assert.strictEqual(getTheme('light').values['icon.size.medium'], '16px');
});

void test('hover and pressed aliases preserve absent high-contrast fills and explicit overrides', () => {
	for (const entry of BUNDLED_THEMES) {
		const theme = getTheme(entry.name);
		for (const [token, role] of [
			['color.interaction.hover', 'toolbar.hoverBackground'],
			['color.interaction.active', 'toolbar.activeBackground']
		] as const) {
			assert.strictEqual(theme.values[token], theme.colors[role] ?? 'transparent');
			if (theme.isHighContrast) {
				assert.strictEqual(theme.colors[role], undefined);
				assert.strictEqual(theme.values[token], 'transparent');
				assert.strictEqual(
					getTheme(entry.name, { [role]: '#12345678' }).values[token],
					'#12345678'
				);
				assert.strictEqual(
					getTheme(entry.name, { [role]: 'default' }).values[token],
					'transparent'
				);
			}
		}
	}
});

void test('bundled button contrast tracks the documented upstream hover exception', () => {
	for (const theme of getThemes()) {
		const foreground = Color.Format.CSS.parseHex(theme.values['color.text.inverse'])!;
		for (const token of [
			'color.interaction.accent',
			'color.interaction.accentHover',
			'color.interaction.accentActive'
		] as const) {
			const background = Color.Format.CSS.parseHex(theme.values[token])!;
			if (
				theme.settingsId === 'GitHub Dark Default' &&
				token !== 'color.interaction.accent'
			) {
				// Preserve the selected upstream palette. Its hover is a tracked accessibility exception.
				assert.strictEqual(theme.colors['button.hoverBackground'], '#2ea043');
				assert.strictEqual(theme.colors['button.foreground'], '#ffffff');
				assert.ok(
					Math.abs(background.getContrastRatio(foreground) - 3.37295213620302) < 0.000001
				);
				continue;
			}
			assert.ok(
				background.getContrastRatio(foreground) >= 4.5,
				`${theme.id} ${token} text contrast`
			);
		}
	}
});
