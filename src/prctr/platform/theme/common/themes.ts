/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { Color } from '../../../base/common/color.js';
import { ColorScheme, isDark, isHighContrast } from './theme.js';
import { getDesignTokenDefinitions, type DesignTokenId, type DesignTokenKind } from './tokens.js';

export type ThemeId = 'dark' | 'highContrastDark' | 'highContrastLight' | 'light';
export type Density = 'compact' | 'default';
export type MotionPreference = 'full' | 'reduced';
export type TransparencyPreference = 'full' | 'reduced';

export interface ResolvedTheme {
	readonly id: ThemeId;
	readonly scheme: ColorScheme;
	readonly isDark: boolean;
	readonly isHighContrast: boolean;
	readonly labelMessageId: `theme.${ThemeId}.label`;
	readonly values: Readonly<Record<DesignTokenId, string>>;
}

const foundations = {
	'typography.font.application': '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
	'typography.font.monospace':
		'ui-monospace, "SFMono-Regular", Consolas, "Liberation Mono", monospace',
	'typography.label.small.size': '12px',
	'typography.label.small.lineHeight': '16px',
	'typography.label.size': '13px',
	'typography.label.lineHeight': '18px',
	'typography.body.size': '14px',
	'typography.body.lineHeight': '20px',
	'typography.content.body.size': '16px',
	'typography.content.body.lineHeight': '24px',
	'typography.heading.small.size': '16px',
	'typography.heading.small.lineHeight': '22px',
	'typography.heading.medium.size': '20px',
	'typography.heading.medium.lineHeight': '28px',
	'typography.heading.large.size': '24px',
	'typography.heading.large.lineHeight': '32px',
	'typography.weight.regular': '400',
	'typography.weight.semibold': '600',
	'spacing.control.inline': '8px',
	'spacing.control.block': '6px',
	'spacing.content.small': '4px',
	'spacing.content.medium': '8px',
	'spacing.content.large': '16px',
	'spacing.region': '24px',
	'shape.radius.small': '2px',
	'shape.radius.medium': '4px',
	'shape.radius.large': '8px',
	'shape.radius.circle': '9999px',
	'shape.stroke.default': '1px',
	'shape.stroke.strong': '2px',
	'icon.size.small': '12px',
	'icon.size.medium': '16px',
	'icon.size.large': '20px',
	'icon.size.xlarge': '24px',
	'elevation.raised': '0 1px 2px rgb(0 0 0 / 18%)',
	'elevation.overlay': '0 4px 14px rgb(0 0 0 / 24%)',
	'elevation.modal': '0 12px 32px rgb(0 0 0 / 32%)',
	'motion.duration.instant': '0ms',
	'motion.duration.fast': '80ms',
	'motion.duration.normal': '140ms',
	'motion.duration.slow': '200ms'
} as const;

const lightColors = {
	'color.background.canvas': '#f7f7f8',
	'color.background.surface': '#ffffff',
	'color.background.raised': '#ffffff',
	'color.text.primary': '#1f2328',
	'color.text.secondary': '#59636e',
	'color.text.disabled': '#818b98',
	'color.text.inverse': '#ffffff',
	'color.text.link': '#0550ae',
	'color.border.default': '#d0d7de',
	'color.border.strong': '#8c959f',
	'color.border.focus': '#7526ba',
	'color.interaction.accent': '#5c00aa',
	'color.interaction.accentHover': '#6b15b6',
	'color.interaction.accentActive': '#4c008c',
	'color.interaction.hover': '#f0f3f6',
	'color.interaction.active': '#e6ebf0',
	'color.interaction.selected': '#ddf4ff',
	'color.selection.background': '#0969da',
	'color.selection.foreground': '#ffffff',
	'color.feedback.success': '#1a7f37',
	'color.feedback.successBackground': '#dafbe1',
	'color.feedback.warning': '#9a6700',
	'color.feedback.warningBackground': '#fff8c5',
	'color.feedback.error': '#cf222e',
	'color.feedback.errorBackground': '#ffebe9',
	'color.feedback.info': '#0969da',
	'color.feedback.infoBackground': '#ddf4ff',
	'color.editor.background': '#ffffff',
	'color.editor.foreground': '#24292f',
	'color.terminal.background': '#ffffff',
	'color.terminal.foreground': '#24292f',
	'color.overlay.backdrop': '#1f232866',
	'color.scrollbar.thumb': '#8c959f99',
	'color.scrollbar.thumbHover': '#8c959fb3',
	'color.scrollbar.thumbActive': '#646464cc'
} as const;

const darkColors = {
	'color.background.canvas': '#0d1117',
	'color.background.surface': '#161b22',
	'color.background.raised': '#21262d',
	'color.text.primary': '#f0f6fc',
	'color.text.secondary': '#b1bac4',
	'color.text.disabled': '#7d8590',
	'color.text.inverse': '#ffffff',
	'color.text.link': '#58a6ff',
	'color.border.default': '#30363d',
	'color.border.strong': '#6e7681',
	'color.border.focus': '#b889f0',
	'color.interaction.accent': '#8750c9',
	'color.interaction.accentHover': '#9059cf',
	'color.interaction.accentActive': '#7f46c2',
	'color.interaction.hover': '#21262d',
	'color.interaction.active': '#30363d',
	'color.interaction.selected': '#1f6feb55',
	'color.selection.background': '#1f6feb',
	'color.selection.foreground': '#ffffff',
	'color.feedback.success': '#3fb950',
	'color.feedback.successBackground': '#12361f',
	'color.feedback.warning': '#d29922',
	'color.feedback.warningBackground': '#3b2e0a',
	'color.feedback.error': '#f85149',
	'color.feedback.errorBackground': '#490d12',
	'color.feedback.info': '#58a6ff',
	'color.feedback.infoBackground': '#0c2d6b',
	'color.editor.background': '#0d1117',
	'color.editor.foreground': '#e6edf3',
	'color.terminal.background': '#0d1117',
	'color.terminal.foreground': '#e6edf3',
	'color.overlay.backdrop': '#00000099',
	'color.scrollbar.thumb': '#6e768199',
	'color.scrollbar.thumbHover': '#8b949eb3',
	'color.scrollbar.thumbActive': '#b1bac4b3'
} as const;

const highContrastLightColors = {
	...lightColors,
	'color.background.canvas': '#ffffff',
	'color.background.surface': '#ffffff',
	'color.background.raised': '#ffffff',
	'color.text.primary': '#000000',
	'color.text.secondary': '#000000',
	'color.text.disabled': '#545454',
	'color.text.inverse': '#ffffff',
	'color.text.link': '#0000ee',
	'color.border.default': '#000000',
	'color.border.strong': '#000000',
	'color.border.focus': '#000000',
	'color.interaction.accent': '#000000',
	'color.interaction.accentHover': '#222222',
	'color.interaction.accentActive': '#333333',
	'color.interaction.hover': '#e5e5e5',
	'color.interaction.active': '#cccccc',
	'color.interaction.selected': '#ffff00',
	'color.selection.background': '#000000',
	'color.selection.foreground': '#ffffff',
	'color.feedback.success': '#006400',
	'color.feedback.successBackground': '#ffffff',
	'color.feedback.warning': '#6b4700',
	'color.feedback.warningBackground': '#ffffff',
	'color.feedback.error': '#b00020',
	'color.feedback.errorBackground': '#ffffff',
	'color.feedback.info': '#0000ee',
	'color.feedback.infoBackground': '#ffffff',
	'color.editor.background': '#ffffff',
	'color.editor.foreground': '#000000',
	'color.terminal.background': '#ffffff',
	'color.terminal.foreground': '#000000',
	'color.overlay.backdrop': '#ffffffcc',
	'color.scrollbar.thumb': '#000000',
	'color.scrollbar.thumbHover': '#000000',
	'color.scrollbar.thumbActive': '#000000'
} as const;

const highContrastDarkColors = {
	...darkColors,
	'color.background.canvas': '#000000',
	'color.background.surface': '#000000',
	'color.background.raised': '#000000',
	'color.text.primary': '#ffffff',
	'color.text.secondary': '#ffffff',
	'color.text.disabled': '#a6a6a6',
	'color.text.inverse': '#000000',
	'color.text.link': '#00ffff',
	'color.border.default': '#ffffff',
	'color.border.strong': '#ffffff',
	'color.border.focus': '#ffff00',
	'color.interaction.accent': '#ffffff',
	'color.interaction.accentHover': '#e6e6e6',
	'color.interaction.accentActive': '#cccccc',
	'color.interaction.hover': '#1a1a1a',
	'color.interaction.active': '#333333',
	'color.interaction.selected': '#ffff00',
	'color.selection.background': '#ffff00',
	'color.selection.foreground': '#000000',
	'color.feedback.success': '#00ff00',
	'color.feedback.successBackground': '#000000',
	'color.feedback.warning': '#ffff00',
	'color.feedback.warningBackground': '#000000',
	'color.feedback.error': '#ff8080',
	'color.feedback.errorBackground': '#000000',
	'color.feedback.info': '#00ffff',
	'color.feedback.infoBackground': '#000000',
	'color.editor.background': '#000000',
	'color.editor.foreground': '#ffffff',
	'color.terminal.background': '#000000',
	'color.terminal.foreground': '#ffffff',
	'color.overlay.backdrop': '#000000cc',
	'color.scrollbar.thumb': '#ffffff',
	'color.scrollbar.thumbHover': '#ffffff',
	'color.scrollbar.thumbActive': '#ffffff'
} as const;

const themeSources = {
	dark: { scheme: ColorScheme.DARK, colors: darkColors },
	highContrastDark: { scheme: ColorScheme.HIGH_CONTRAST_DARK, colors: highContrastDarkColors },
	highContrastLight: { scheme: ColorScheme.HIGH_CONTRAST_LIGHT, colors: highContrastLightColors },
	light: { scheme: ColorScheme.LIGHT, colors: lightColors }
} as const;

const themes = Object.freeze(
	Object.fromEntries(
		Object.entries(themeSources).map(([id, source]) => {
			const values = {
				...foundations,
				...source.colors,
				...(isHighContrast(source.scheme)
					? {
							'elevation.raised': 'none',
							'elevation.overlay': 'none',
							'elevation.modal': 'none'
						}
					: {})
			} as Record<DesignTokenId, string>;
			validateTheme(id as ThemeId, values);
			return [
				id,
				Object.freeze({
					id: id as ThemeId,
					isDark: isDark(source.scheme),
					isHighContrast: isHighContrast(source.scheme),
					labelMessageId: `theme.${id}.label`,
					scheme: source.scheme,
					values: Object.freeze(values)
				})
			];
		})
	) as Record<ThemeId, ResolvedTheme>
);

export function getTheme(id: ThemeId): ResolvedTheme {
	return themes[id];
}

export function getThemes(): readonly ResolvedTheme[] {
	return Object.freeze((Object.keys(themes) as ThemeId[]).map((id) => themes[id]));
}

export function getDensityTokenOverrides(
	density: Density
): Readonly<Partial<Record<DesignTokenId, string>>> {
	if (density === 'default') return Object.freeze({});
	return Object.freeze({
		'spacing.control.inline': '6px',
		'spacing.control.block': '4px',
		'spacing.content.medium': '6px',
		'spacing.content.large': '12px',
		'spacing.region': '16px'
	});
}

function validateTheme(id: ThemeId, values: Record<DesignTokenId, string>): void {
	for (const definition of getDesignTokenDefinitions()) {
		const value = values[definition.id];
		if (typeof value !== 'string' || value.length === 0) {
			throw new Error(`Theme ${id} is missing ${definition.id}.`);
		}
		validateValue(definition.kind, definition.id, value);
	}
	if (Object.keys(values).length !== getDesignTokenDefinitions().length) {
		throw new Error(`Theme ${id} contains an undeclared token.`);
	}
}

function validateValue(kind: DesignTokenKind, id: DesignTokenId, value: string): void {
	let valid = true;
	switch (kind) {
		case 'color':
			valid = /^#[\da-f]{3,8}$/iu.test(value) && Color.Format.CSS.parseHex(value) !== null;
			break;
		case 'dimension':
			valid = /^(?:0|\d+(?:\.\d+)?px|9999px)$/u.test(value);
			break;
		case 'duration':
			valid = /^\d+ms$/u.test(value);
			break;
		case 'font-weight':
			valid = /^(?:400|600)$/u.test(value);
			break;
		case 'font-family':
			valid = !/[;{}]/u.test(value);
			break;
		case 'shadow':
			valid = value === 'none' || /^0 .+rgb\(.+\)$/u.test(value);
			break;
	}
	if (!valid) {
		throw new Error(`Token ${id} has invalid ${kind} value ${value}.`);
	}
}
