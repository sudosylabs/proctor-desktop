import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { Generator } from './registry.ts';

/*
 * The Plum palette (accepted 2026-11-23): one tinted neutral and one accent, 12 steps each, made
 * in OKLCH so every step weighs the same in Light and Dark. Step jobs: 1 app background, 2 subtle
 * background, 3–5 element rest/hover/selected, 6–8 borders, 9–10 solid, 11–12 text.
 */

const paletteOutput = 'src/prctr/platform/theme/common/plumPalette.generated.ts';
const lightThemeOutput = 'resources/themes/proctor/light.json';
const darkThemeOutput = 'resources/themes/proctor/dark.json';

/** The neutral leans toward plum (hue 318) with a faint chroma, a little stronger at the ends. */
const NEUTRAL_HUE = 318;
const NEUTRAL_CHROMA = 0.0075;
const NEUTRAL_LIGHTNESS = {
	light: [0.994, 0.978, 0.958, 0.94, 0.922, 0.895, 0.86, 0.79, 0.64, 0.6, 0.505, 0.235],
	dark: [0.185, 0.212, 0.245, 0.268, 0.292, 0.32, 0.365, 0.44, 0.54, 0.585, 0.76, 0.945]
} as const;
/** Dark neutrals carry slightly more chroma, so they don't read as plain grey. */
const DARK_CHROMA_FACTOR = 1.15;

const ACCENT_HUE = 303;
/** Lightness and chroma per accent step. */
const ACCENT_STEPS = {
	light: [
		[0.985, 0.012],
		[0.965, 0.025],
		[0.93, 0.05],
		[0.89, 0.075],
		[0.84, 0.1],
		[0.77, 0.13],
		[0.68, 0.16],
		[0.6, 0.19],
		[0.425, 0.215],
		[0.39, 0.2],
		[0.42, 0.21],
		[0.3, 0.15]
	],
	dark: [
		[0.2, 0.03],
		[0.23, 0.05],
		[0.28, 0.08],
		[0.32, 0.1],
		[0.36, 0.12],
		[0.42, 0.14],
		[0.5, 0.16],
		[0.58, 0.18],
		[0.5, 0.21],
		[0.56, 0.2],
		[0.8, 0.12],
		[0.93, 0.04]
	]
} as const;

/** Status hues, generated at the same weight: text for words, soft for tinted surfaces. */
const SEMANTIC = {
	red: { hue: 27, light: [0.48, 0.14], dark: [0.78, 0.12] },
	amber: { hue: 70, light: [0.5, 0.11], dark: [0.78, 0.11] },
	green: { hue: 150, light: [0.48, 0.14], dark: [0.78, 0.12] }
} as const;
const SOFT = { light: [0.955, 0.025], dark: [0.27, 0.04] } as const;

/**
 * Values the boards fix by hand rather than by step: the desk behind the window, the window
 * glass, the selected row, and the solid red of a destructive button.
 */
const FIXED = {
	light: {
		desk: '#DCD5E0',
		glass: '#F4EFF6CC',
		glassEdge: '#201C221A',
		glassSelected: '#201C2212',
		selectedRow: '#F6F0FC',
		redSolid: '#B3261E',
		shadow: '#00000029'
	},
	dark: {
		desk: '#0E0B10',
		glass: '#1B171DCC',
		glassEdge: '#FFFFFF1A',
		glassSelected: '#FFFFFF17',
		selectedRow: '#2A2338',
		redSolid: '#C9463D',
		shadow: '#0000008C'
	}
} as const;

type Mode = 'light' | 'dark';

export interface PlumMode {
	readonly neutral: readonly string[];
	readonly accent: readonly string[];
	readonly red: string;
	readonly redSoft: string;
	readonly redSolid: string;
	readonly amber: string;
	readonly amberSoft: string;
	readonly green: string;
	readonly greenSoft: string;
	readonly desk: string;
	readonly glass: string;
	readonly glassEdge: string;
	readonly glassSelected: string;
	readonly selectedRow: string;
	readonly shadow: string;
}

export function plumPalette(): Readonly<Record<Mode, PlumMode>> {
	const make = (mode: Mode): PlumMode => {
		const chroma = NEUTRAL_CHROMA * (mode === 'dark' ? DARK_CHROMA_FACTOR : 1);
		const semantic = (name: keyof typeof SEMANTIC) => {
			const [lightness, c] = SEMANTIC[name][mode];
			return {
				text: oklchToHex(lightness, c, SEMANTIC[name].hue),
				soft: oklchToHex(SOFT[mode][0], SOFT[mode][1], SEMANTIC[name].hue)
			};
		};
		const red = semantic('red');
		const amber = semantic('amber');
		const green = semantic('green');
		return {
			neutral: NEUTRAL_LIGHTNESS[mode].map((lightness, index) =>
				oklchToHex(
					lightness,
					chroma * (1 + (0.6 * Math.abs(index - 5.5)) / 5.5),
					NEUTRAL_HUE
				)
			),
			accent: ACCENT_STEPS[mode].map(([lightness, c]) =>
				oklchToHex(lightness, c, ACCENT_HUE)
			),
			red: red.text,
			redSoft: red.soft,
			amber: amber.text,
			amberSoft: amber.soft,
			green: green.text,
			greenSoft: green.soft,
			...FIXED[mode]
		};
	};
	return { light: make('light'), dark: make('dark') };
}

/** The colours of one Proctor theme, by VS Code colour id, from its palette. */
function themeColors(mode: Mode, p: PlumMode): Record<string, string> {
	const n = (step: number) => p.neutral[step - 1] as string;
	const a = (step: number) => p.accent[step - 1] as string;
	const dark = mode === 'dark';
	const surface = n(2);
	const card = dark ? n(3) : n(1);
	const panel = dark ? n(4) : n(3);
	const hair = dark ? n(4) : n(5);
	const ink = n(12);
	const muted = n(11);
	const faint = n(10);
	const accent = dark ? a(11) : a(9);
	return {
		foreground: ink,
		descriptionForeground: muted,
		disabledForeground: faint,
		errorForeground: p.red,
		focusBorder: dark ? a(11) : a(9),
		'widget.shadow': p.shadow,
		'titleBar.activeBackground': surface,
		'titleBar.activeForeground': ink,
		'titleBar.inactiveBackground': surface,
		'titleBar.inactiveForeground': muted,
		'editor.background': surface,
		'editor.foreground': ink,
		'surface.background': surface,
		'surface.border': hair,
		'sideBar.background': surface,
		'panel.background': surface,
		'panel.border': hair,
		'editorWidget.background': panel,
		'editorWidget.border': hair,
		'editorWarning.foreground': p.amber,
		'editorError.foreground': p.red,
		'charts.green': p.green,
		'charts.red': p.red,
		'charts.yellow': p.amber,
		'input.background': card,
		'input.border': n(9),
		'input.foreground': ink,
		'input.placeholderForeground': faint,
		'inputValidation.errorBorder': p.red,
		'inputValidation.errorForeground': p.red,
		'inputValidation.errorBackground': card,
		'inputValidation.warningBackground': panel,
		'inputValidation.warningBorder': p.amber,
		'inputValidation.infoBackground': panel,
		'button.secondaryBackground': card,
		'button.secondaryForeground': ink,
		'button.secondaryHoverBackground': panel,
		'button.border': n(6),
		'textLink.foreground': accent,
		'textLink.activeForeground': accent,
		'toolbar.hoverBackground': panel,
		'toolbar.activeBackground': hair,
		'scrollbarSlider.background': `${ink}26`,
		'scrollbarSlider.hoverBackground': `${ink}47`,
		'scrollbarSlider.activeBackground': `${ink}47`,
		'proctor.tertiaryForeground': faint,
		'proctor.pendingForeground': n(8),
		'proctor.disabledBackground': panel,
		'proctor.developmentBackground': p.amberSoft,
		'proctor.developmentStripe': dark ? '#30260D' : '#FBE6AE',
		'proctor.developmentForeground': p.amber
	};
}

export const plumPaletteGenerator: Generator = {
	id: 'theme.plum-palette',
	inputs: ['build/generators/plumPalette.ts'],
	committedOutputs: [paletteOutput, lightThemeOutput, darkThemeOutput],
	buildOutputs: [],
	generate(_repository, outputRoot) {
		const palette = plumPalette();
		const write = (path: string, content: string) => {
			mkdirSync(dirname(join(outputRoot, path)), { recursive: true });
			writeFileSync(join(outputRoot, path), content);
		};
		write(
			paletteOutput,
			'// Generated by theme.plum-palette from build/generators/plumPalette.ts. Do not edit.\n' +
				'/** The Plum palette by theme: 12 neutral and 12 accent steps, the status hues and the fixed values. */\n' +
				`export const plumPalette = ${JSON.stringify(palette, null, '\t')} as const;\n`
		);
		for (const mode of ['light', 'dark'] as const)
			write(
				mode === 'light' ? lightThemeOutput : darkThemeOutput,
				`${JSON.stringify(
					{
						name: mode === 'light' ? 'Proctor Light' : 'Proctor Dark',
						type: mode,
						include: `../github/${mode}-default.json`,
						colors: themeColors(mode, palette[mode])
					},
					null,
					2
				)}\n`
			);
	}
};

/** OKLCH to sRGB hex, clamped to the gamut. */
export function oklchToHex(lightness: number, chroma: number, hue: number): string {
	const radians = (hue * Math.PI) / 180;
	const a = chroma * Math.cos(radians);
	const b = chroma * Math.sin(radians);
	const l = (lightness + 0.3963377774 * a + 0.2158037573 * b) ** 3;
	const m = (lightness - 0.1055613458 * a - 0.0638541728 * b) ** 3;
	const s = (lightness - 0.0894841775 * a - 1.291485548 * b) ** 3;
	const linear = [
		4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
		-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
		-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s
	];
	return `#${linear
		.map((value) => {
			const x = Math.max(0, Math.min(1, value));
			const encoded = x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055;
			return Math.round(encoded * 255)
				.toString(16)
				.padStart(2, '0')
				.toUpperCase();
		})
		.join('')}`;
}
