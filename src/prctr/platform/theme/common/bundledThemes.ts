import { ColorScheme } from './theme.js';
export const DEFAULT_THEME = 'GitHub Dark Default';
export const BUNDLED_THEMES = [
	{ name: 'GitHub Light Default', path: 'github/light-default.json', scheme: ColorScheme.LIGHT },
	{
		name: 'GitHub Light High Contrast',
		path: 'github/light-high-contrast.json',
		scheme: ColorScheme.HIGH_CONTRAST_LIGHT
	},
	{
		name: 'GitHub Light Colorblind (Beta)',
		path: 'github/light-colorblind.json',
		scheme: ColorScheme.LIGHT
	},
	{ name: 'GitHub Dark Default', path: 'github/dark-default.json', scheme: ColorScheme.DARK },
	{
		name: 'GitHub Dark High Contrast',
		path: 'github/dark-high-contrast.json',
		scheme: ColorScheme.HIGH_CONTRAST_DARK
	},
	{
		name: 'GitHub Dark Colorblind (Beta)',
		path: 'github/dark-colorblind.json',
		scheme: ColorScheme.DARK
	},
	{ name: 'GitHub Dark Dimmed', path: 'github/dark-dimmed.json', scheme: ColorScheme.DARK },
	{ name: 'GitHub Light', path: 'github/light.json', scheme: ColorScheme.LIGHT },
	{ name: 'GitHub Dark', path: 'github/dark.json', scheme: ColorScheme.DARK }
] as const;
export type BundledThemeName = (typeof BUNDLED_THEMES)[number]['name'];
export const LEGACY_THEME_NAMES = {
	dark: DEFAULT_THEME,
	light: 'GitHub Light Default',
	highContrastDark: 'GitHub Dark High Contrast',
	highContrastLight: 'GitHub Light High Contrast',
	hcDark: 'GitHub Dark High Contrast',
	hcLight: 'GitHub Light High Contrast'
} as const;
