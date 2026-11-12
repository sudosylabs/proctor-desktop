/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { createElementFactory } from '../../../../base/browser/documentElements.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { SCHEME_THEME_NAMES } from '../../../../platform/theme/common/bundledThemes.js';
import { getTheme } from '../../../../platform/theme/common/themes.js';

/** The editor settings the preview draws with. */
export interface EditorPreviewState {
	readonly theme: string;
	readonly fontSize: number;
	readonly lineHeight: number;
	readonly tabSize: number;
	readonly lineNumbers: string;
	/** The visible label above the code, such as “Preview · GitHub Dark Default, 14 px”. */
	readonly label: string;
}

type TokenKind = '' | 'keyword' | 'function' | 'number';

/** One run of preview text; `text` receives the indentation of one level. */
interface PreviewToken {
	readonly kind: TokenKind;
	readonly text: (indent: string) => string;
}

const fixed = (kind: TokenKind, text: string): PreviewToken => ({ kind, text: () => text });

/** A short Python function; the cursor sits on its third line. */
const PREVIEW_LINES: readonly (readonly PreviewToken[])[] = [
	[fixed('keyword', 'def'), fixed('', ' '), fixed('function', 'mean'), fixed('', '(values):')],
	[{ kind: '', text: (indent) => indent }, fixed('keyword', 'if not'), fixed('', ' values:')],
	[
		{ kind: '', text: (indent) => indent + indent },
		fixed('keyword', 'return'),
		fixed('', ' '),
		fixed('number', '0')
	],
	[
		{ kind: '', text: (indent) => `${indent}total = ` },
		fixed('function', 'sum'),
		fixed('', '(values)')
	],
	[
		{ kind: '', text: (indent) => indent },
		fixed('keyword', 'return'),
		fixed('', ' total / '),
		fixed('function', 'len'),
		fixed('', '(values)')
	]
];

/** The preview line that holds the cursor, from 0; relative line numbers count from it. */
const PREVIEW_CURSOR_LINE = 2;

/**
 * A few lines of code drawn with the editor settings as chosen, in the chosen editor theme
 * whatever the window theme is. Built once; `update` rewrites its text and colours.
 */
export class EditorPreview extends Disposable {
	readonly element: HTMLElement;
	private readonly label: HTMLElement;
	private readonly code: HTMLElement;
	private readonly numbers: readonly HTMLElement[];
	private readonly tokens: readonly {
		readonly token: PreviewToken;
		readonly span: HTMLElement;
	}[];

	constructor(host: HTMLElement, accessibleLabel: string) {
		super();
		const $ = createElementFactory(host.ownerDocument);
		this.label = $('span.prctr-settings-page__preview-label');
		this.code = $('div.prctr-settings-page__code', {
			attrs: { 'aria-label': accessibleLabel }
		});
		const numbers: HTMLElement[] = [];
		const tokens: { readonly token: PreviewToken; readonly span: HTMLElement }[] = [];
		PREVIEW_LINES.forEach((line, index) => {
			const number = $('span.prctr-settings-page__number', {
				data: { current: String(index === PREVIEW_CURSOR_LINE) },
				attrs: { 'aria-hidden': 'true' }
			});
			numbers.push(number);
			const element = $('div.prctr-settings-page__line', {}, number);
			for (const token of line) {
				const span = $('span', token.kind === '' ? {} : { data: { token: token.kind } });
				tokens.push({ token, span });
				element.append(span);
			}
			this.code.append(element);
		});
		this.numbers = numbers;
		this.tokens = tokens;
		this.element = $('div.prctr-settings-page__preview', {}, this.label, this.code);
		host.append(this.element);
	}

	update(state: EditorPreviewState): void {
		this.label.textContent = state.label;
		this.code.style.fontSize = `${state.fontSize}px`;
		this.code.style.lineHeight = `${state.lineHeight}px`;
		const palette = editorPalette(state.theme);
		setColor(this.code, '--prctr-preview-background', palette.background);
		setColor(this.code, '--prctr-preview-foreground', palette.foreground);
		setColor(this.code, '--prctr-preview-border', palette.border);
		setColor(this.code, '--prctr-preview-line-number', palette.lineNumber);
		setColor(this.code, '--prctr-preview-line-number-active', palette.activeLineNumber);
		setColor(this.code, '--prctr-preview-keyword', palette.keyword);
		setColor(this.code, '--prctr-preview-function', palette.function);
		setColor(this.code, '--prctr-preview-number', palette.number);
		this.updateNumbers(state.lineNumbers);
		const indent = ' '.repeat(state.tabSize);
		for (const { token, span } of this.tokens) span.textContent = token.text(indent);
	}

	private updateNumbers(lineNumbers: string): void {
		this.numbers.forEach((number, index) => {
			number.hidden = lineNumbers === 'off';
			// Relative numbers count from the line holding the cursor, which keeps its own.
			const relative = lineNumbers === 'relative' && index !== PREVIEW_CURSOR_LINE;
			number.textContent = String(
				relative ? Math.abs(index - PREVIEW_CURSOR_LINE) : index + 1
			);
		});
	}
}

/** A chip of an editor theme's background, edged with its function colour. */
export class ThemeSwatch {
	readonly element: HTMLElement;

	constructor(document: Document) {
		this.element = createElementFactory(document)('span.prctr-settings-page__swatch', {
			attrs: { 'aria-hidden': 'true' }
		});
	}

	update(theme: string): void {
		const palette = editorPalette(theme);
		setColor(this.element, '--prctr-swatch-background', palette.background);
		setColor(this.element, '--prctr-swatch-border', palette.border);
		setColor(this.element, '--prctr-swatch-accent', palette.function);
	}
}

/** A scheme alias such as `dark` is shown as the theme it stands for. */
export function editorThemeName(value: unknown): string {
	const name = String(value);
	return name in SCHEME_THEME_NAMES
		? SCHEME_THEME_NAMES[name as keyof typeof SCHEME_THEME_NAMES]
		: name;
}

/** The colours of an editor theme that the preview and the theme chip need. */
interface EditorPalette {
	readonly background?: string;
	readonly foreground?: string;
	readonly border?: string;
	readonly lineNumber?: string;
	readonly activeLineNumber?: string;
	readonly keyword?: string;
	readonly function?: string;
	readonly number?: string;
}

/** Reads a bundled editor theme's colours; an unknown theme gives none, and defaults apply. */
function editorPalette(name: string): EditorPalette {
	try {
		const theme = getTheme(name);
		const token = (wanted: string): string | undefined =>
			theme.colorTheme.tokenColors.find((entry) =>
				(Array.isArray(entry.scope) ? entry.scope : [entry.scope]).some(
					(scope) => typeof scope === 'string' && scope.split(/[,\s]+/).includes(wanted)
				)
			)?.settings.foreground;
		return {
			background: theme.colors['editor.background'],
			foreground: theme.colors['editor.foreground'],
			border: theme.colors['editorGroup.border'] ?? theme.colors['panel.border'],
			lineNumber: theme.colors['editorLineNumber.foreground'],
			activeLineNumber: theme.colors['editorLineNumber.activeForeground'],
			keyword: token('keyword'),
			function: token('entity.name.function'),
			number: token('constant.numeric') ?? token('constant')
		};
	} catch {
		return {};
	}
}

function setColor(element: HTMLElement, property: string, value: string | undefined): void {
	if (value === undefined) element.style.removeProperty(property);
	else element.style.setProperty(property, value);
}
