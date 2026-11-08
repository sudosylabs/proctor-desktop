/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import {
	normalizeTokenColorCustomizations,
	normalizeSemanticTokenColorCustomizations
} from './tokenCustomizations.js';
import { resolveTokenColorCustomizations } from './tokenColorConfiguration.js';
import type {
	ITokenColorCustomizations,
	ISemanticTokenColorCustomizations
} from './workbenchThemeService.js';
import type { IWorkbenchColorTheme } from './workbenchThemeService.js';
import { Color } from '../../../base/common/color.js';
import type { IColorCustomizations } from './colorCustomizations.js';
import { restorePackagedTheme } from './packagedThemeLoader.js';
import { BUNDLED_THEMES, SCHEME_THEME_NAMES } from './bundledThemes.js';
import { bundledThemeSnapshots } from './bundledThemeSnapshots.generated.js';
import { getColorRegistry } from './colorRegistry.js';
import './workbenchColors.js';
import './colors/brandColors.js';
import './colors/proctorColors.js';
import { normalizeColorCustomizations } from './colorCustomizations.js';
import { ColorScheme, isDark, isHighContrast } from './theme.js';
import { type DesignTokenId } from './tokens.js';

export type ThemeId = 'dark' | 'highContrastDark' | 'highContrastLight' | 'light';
export type Density = 'compact' | 'default';
export type MotionPreference = 'full' | 'reduced';
export type TransparencyPreference = 'full' | 'reduced';

export interface ResolvedTheme {
	readonly id: ThemeId;
	readonly settingsId: string;
	readonly colorTheme: IWorkbenchColorTheme;
	readonly colors: Readonly<Record<string, string>>;
	readonly scheme: ColorScheme;
	readonly isDark: boolean;
	readonly isHighContrast: boolean;
	readonly labelMessageId: `theme.${ThemeId}.label`;
	readonly values: Readonly<Record<DesignTokenId, string>>;
}

const foundations = {
	'spacing.workbench.gutter': '4px',
	'spacing.workbench.gap': '4px',
	'spacing.workbench.rowInset': '4px',
	'typography.font.application':
		'"IBM Plex Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
	'typography.font.monospace':
		'"IBM Plex Mono", ui-monospace, "SFMono-Regular", Consolas, "Liberation Mono", monospace',
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
	'typography.weight.medium': '500',
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

const semanticColorRoles = {
	'color.background.canvas': 'titleBar.activeBackground',
	'color.background.surface': 'surface.background',
	'color.background.raised': 'editorWidget.background',
	'color.background.card': 'proctor.cardBackground',
	'color.text.primary': 'foreground',
	'color.text.secondary': 'descriptionForeground',
	'color.text.tertiary': 'proctor.tertiaryForeground',
	'color.text.disabled': 'disabledForeground',
	'color.text.inverse': 'button.foreground',
	'color.text.link': 'textLink.foreground',
	'color.brand.accent': 'proctor.brandAccent',
	'color.brand.accentHover': 'proctor.brandAccentHover',
	'color.brand.onAccent': 'proctor.brandAccentForeground',
	'color.brand.link': 'proctor.brandLink',
	'color.brand.mark': 'proctor.brandMark',
	'color.border.default': 'surface.border',
	'color.border.strong': 'surface.border',
	'color.border.control': 'input.border',
	'color.border.focus': 'focusBorder',
	'color.interaction.accent': 'button.background',
	'color.interaction.accentHover': 'button.hoverBackground',
	'color.interaction.accentActive': 'button.hoverBackground',
	'color.interaction.hover': 'toolbar.hoverBackground',
	'color.interaction.active': 'toolbar.activeBackground',
	'color.interaction.selected': 'list.activeSelectionBackground',
	'color.interaction.disabled': 'proctor.disabledBackground',
	'color.selection.background': 'selection.background',
	'color.selection.foreground': 'list.activeSelectionForeground',
	'color.feedback.success': 'charts.green',
	'color.feedback.successBackground': 'editor.background',
	'color.feedback.warning': 'editorWarning.foreground',
	'color.feedback.warningBackground': 'inputValidation.warningBackground',
	'color.feedback.error': 'errorForeground',
	'color.feedback.errorBackground': 'inputValidation.errorBackground',
	'color.feedback.pending': 'proctor.pendingForeground',
	'color.development.background': 'proctor.developmentBackground',
	'color.development.stripe': 'proctor.developmentStripe',
	'color.development.foreground': 'proctor.developmentForeground',
	'color.feedback.info': 'editorInfo.foreground',
	'color.feedback.infoBackground': 'inputValidation.infoBackground',
	'color.editor.background': 'editor.background',
	'color.editor.foreground': 'editor.foreground',
	'color.terminal.background': 'terminal.background',
	'color.terminal.foreground': 'terminal.foreground',
	'color.overlay.backdrop': 'widget.shadow',
	'color.scrollbar.thumb': 'scrollbarSlider.background',
	'color.scrollbar.thumbHover': 'scrollbarSlider.hoverBackground',
	'color.scrollbar.thumbActive': 'scrollbarSlider.activeBackground',
	'color.frame.background': 'proctor.frameBackground',
	'color.frame.sidebar': 'proctor.frameSidebarBackground',
	'color.frame.divider': 'proctor.frameDivider',
	'color.navigation.selected': 'proctor.navigationSelectedBackground',
	'color.navigation.selectedForeground': 'proctor.navigationSelectedForeground',
	'color.avatar.background': 'proctor.avatarBackground',
	'color.avatar.foreground': 'proctor.avatarForeground'
} as const;

export function getTheme(
	selection: string,
	customizations: IColorCustomizations = {},
	tokenCustomizations: ITokenColorCustomizations = {},
	semanticCustomizations?: ISemanticTokenColorCustomizations
): ResolvedTheme {
	const name = SCHEME_THEME_NAMES[selection as keyof typeof SCHEME_THEME_NAMES] ?? selection;
	const entry = BUNDLED_THEMES.find((theme) => theme.name === name);
	if (!entry) throw new Error(`Unknown bundled theme: ${selection}`);
	const custom = normalizeColorCustomizations(customizations);
	if (!custom) throw new TypeError('Invalid theme color customizations');
	const model = restorePackagedTheme(bundledThemeSnapshots[name]!);
	const source = JSON.parse(bundledThemeSnapshots[name]!).colorMap as Record<string, string>;
	model.setCustomColors(custom);
	const tokens = normalizeTokenColorCustomizations(tokenCustomizations);
	const semantic =
		semanticCustomizations === undefined
			? undefined
			: normalizeSemanticTokenColorCustomizations(semanticCustomizations);
	if (!tokens || (semanticCustomizations !== undefined && !semantic))
		throw new TypeError('Invalid token customizations');
	model.setCustomTokenColors(resolveTokenColorCustomizations(tokens));
	model.setCustomSemanticTokenColors(semantic);
	const colors: Record<string, string> = Object.create(null);
	// Keep all packaged theme colors, even when their consuming capability is not yet registered.
	for (const id of new Set([
		...getColorRegistry()
			.getColors()
			.map((item) => item.id),
		...Object.keys(source)
	])) {
		const color = model.getColor(id);
		if (color) colors[id] = Color.Format.CSS.formatHexA(color, true);
	}
	const values = { ...foundations } as Record<DesignTokenId, string>;
	for (const [token, role] of Object.entries(semanticColorRoles)) {
		// VS Code deliberately leaves these backgrounds unset in high contrast.
		// A semantic alias must preserve the absence of a fill, not replace
		// it with foreground (which makes dark-theme hover states nearly white).
		if (role === 'toolbar.hoverBackground' || role === 'toolbar.activeBackground') {
			values[token as DesignTokenId] = colors[role] ?? 'transparent';
			continue;
		}
		const fallback =
			token.includes('background') || token.includes('Background')
				? 'editor.background'
				: 'foreground';
		values[token as DesignTokenId] = colors[role] ?? colors[fallback]!;
	}
	const id: ThemeId =
		entry.scheme === ColorScheme.LIGHT
			? 'light'
			: entry.scheme === ColorScheme.HIGH_CONTRAST_LIGHT
				? 'highContrastLight'
				: entry.scheme === ColorScheme.HIGH_CONTRAST_DARK
					? 'highContrastDark'
					: 'dark';
	if (isHighContrast(entry.scheme)) {
		values['elevation.raised'] =
			values['elevation.overlay'] =
			values['elevation.modal'] =
				'none';
	}
	return Object.freeze({
		id,
		settingsId: name,
		colorTheme: model,
		scheme: entry.scheme,
		isDark: isDark(entry.scheme),
		isHighContrast: isHighContrast(entry.scheme),
		labelMessageId: `theme.${id}.label`,
		values: Object.freeze(values),
		colors: Object.freeze(colors)
	});
}

/** Representative schemes for the presentation matrix. The bundled catalog owns all choices. */
export function getThemes(): readonly ResolvedTheme[] {
	return Object.freeze(
		['dark', 'highContrastDark', 'highContrastLight', 'light'].map((id) => getTheme(id))
	);
}
export function getDensityTokenOverrides(
	density: Density
): Readonly<Partial<Record<DesignTokenId, string>>> {
	if (density === 'default') return Object.freeze({});
	return Object.freeze({
		'spacing.workbench.gap': '0px',
		'spacing.workbench.rowInset': '2px',
		'spacing.control.inline': '6px',
		'spacing.control.block': '4px',
		'spacing.content.medium': '6px',
		'spacing.content.large': '12px',
		'spacing.region': '16px'
	});
}
