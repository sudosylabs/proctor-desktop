/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
// @proctor-vscode-port resource-preview

import type MarkdownIt from 'markdown-it';
import type { Options } from 'markdown-it/lib/index.mjs';
import type StateBlock from 'markdown-it/lib/rules_block/state_block.mjs';
import type Token from 'markdown-it/lib/token.mjs';
import * as l10n from '@vscode/l10n';
import * as yaml from 'yaml';
import { escapeHtml } from '../../util/dom.js';

export type FrontMatterRenderStyle = 'hide' | 'codeBlock' | 'table';

const FRONT_MATTER_TOKEN = 'front_matter';
const MARKER = '---';
const FRONT_MATTER_CONTEXT = JSON.stringify({ webviewSection: 'frontMatter' });

interface IFrontMatterMeta {
	readonly content: string;
}

/**
 * Extends a `markdown-it` instance with parsing and rendering support for YAML
 * frontmatter at the start of a Markdown document.
 *
 * Frontmatter is delimited by lines containing only `---`. How (or whether) the parsed
 * frontmatter is rendered in the preview is controlled by the `markdown.preview.frontMatter`
 * setting.
 */
export function extendMarkdownIt(
	md: MarkdownIt,
	getStyle: () => FrontMatterRenderStyle
): MarkdownIt {
	md.block.ruler.before('fence', FRONT_MATTER_TOKEN, frontMatterRule, {
		alt: ['paragraph', 'reference', 'blockquote', 'list']
	});

	md.renderer.rules[FRONT_MATTER_TOKEN] = (tokens, idx, options) =>
		renderFrontMatter(tokens, idx, options, getStyle());

	return md;
}

const frontMatterRule = (
	state: StateBlock,
	startLine: number,
	endLine: number,
	silent: boolean
): boolean => {
	if (startLine !== 0 || state.tShift[startLine] !== 0) {
		return false;
	}

	const firstLineStart = state.bMarks[startLine];
	const firstLineEnd = state.eMarks[startLine];
	const firstLine = state.src.slice(firstLineStart, firstLineEnd).replace(/\s+$/, '');

	if (firstLine !== MARKER) {
		return false;
	}

	let nextLine = startLine + 1;
	let foundEnd = false;
	for (; nextLine < endLine; nextLine++) {
		if (state.tShift[nextLine] !== 0) {
			continue;
		}
		const lineStart = state.bMarks[nextLine];
		const lineEnd = state.eMarks[nextLine];
		const line = state.src.slice(lineStart, lineEnd).replace(/\s+$/, '');
		if (line === MARKER) {
			foundEnd = true;
			break;
		}
	}

	if (!foundEnd) {
		return false;
	}

	if (silent) {
		return true;
	}

	const contentStart = state.bMarks[startLine + 1];
	const contentEnd = state.bMarks[nextLine];
	const rawContent = state.src.slice(contentStart, contentEnd).replace(/\n$/, '');

	const token = state.push(FRONT_MATTER_TOKEN, '', 0);
	token.block = true;
	token.hidden = false;
	token.markup = MARKER;
	token.map = [startLine, nextLine + 1];
	const meta: IFrontMatterMeta = { content: rawContent };
	token.meta = meta;

	state.line = nextLine + 1;
	return true;
};

function renderFrontMatter(
	tokens: Token[],
	idx: number,
	options: Options,
	style: FrontMatterRenderStyle
): string {
	const meta = tokens[idx].meta as IFrontMatterMeta | undefined;
	if (!meta) {
		return '';
	}

	switch (style) {
		case 'codeBlock':
			return renderAsCodeBlock(meta, options);
		case 'table':
			return renderAsTable(meta);
		case 'hide':
		default:
			return '';
	}
}

function renderAsCodeBlock(meta: IFrontMatterMeta, options: Options): string {
	let highlighted: string | undefined;
	if (typeof options.highlight === 'function') {
		try {
			highlighted = options.highlight(meta.content, 'yaml', '') || undefined;
		} catch {
			highlighted = undefined;
		}
	}
	if (highlighted?.startsWith('<pre')) {
		return highlighted.replace(/^<pre\b/, `<pre ${frontMatterAttributes()}`) + '\n';
	}
	const body = highlighted ?? escapeHtml(meta.content);
	return `<pre class="frontmatter hljs" ${frontMatterAttributes()}><code class="language-yaml">${body}</code></pre>\n`;
}

function renderAsTable(meta: IFrontMatterMeta): string {
	const result = parseEntries(meta);
	if (result.error !== undefined) {
		return renderError(result.error);
	}
	if (!result.entries.length) {
		return '';
	}
	const rows = result.entries
		.map(
			([key, value]) =>
				`<tr><th>${escapeHtml(key)}</th><td>${formatValueHtml(value)}</td></tr>`
		)
		.join('');
	return `<table class="frontmatter" ${frontMatterAttributes()}><tbody>${rows}</tbody></table>\n`;
}

function renderError(message: string): string {
	const label = l10n.t('Failed to parse frontmatter');
	return `<div class="frontmatter-error" role="alert" ${frontMatterAttributes()}><strong>${escapeHtml(label)}</strong><pre>${escapeHtml(message)}</pre></div>\n`;
}

function frontMatterAttributes(): string {
	const label = escapeHtml(l10n.t('Frontmatter'));
	return `title="${label}" data-vscode-context='${escapeHtml(FRONT_MATTER_CONTEXT)}'`;
}

interface IParseResult {
	readonly entries: readonly [string, unknown][];
	readonly error?: string;
}

function parseEntries(meta: IFrontMatterMeta): IParseResult {
	try {
		const parsed = yaml.parse(meta.content);
		if (parsed === null || parsed === undefined) {
			return { entries: [] };
		}
		if (typeof parsed !== 'object' || Array.isArray(parsed)) {
			return { entries: [['', parsed]] };
		}
		return { entries: Object.entries(parsed as Record<string, unknown>) };
	} catch (e) {
		return { entries: [], error: e instanceof Error ? e.message : String(e) };
	}
}

function formatValueHtml(value: unknown): string {
	if (value === null || value === undefined) {
		return '';
	}
	if (Array.isArray(value)) {
		if (!value.length) {
			return '';
		}
		return `<ul>${value.map((v) => `<li>${formatValueHtml(v)}</li>`).join('')}</ul>`;
	}
	if (typeof value === 'object') {
		return `<code>${escapeHtml(yaml.stringify(value).trimEnd())}</code>`;
	}
	return escapeHtml(formatScalar(value));
}

function formatScalar(value: unknown): string {
	if (value instanceof Date) {
		return value.toISOString();
	}
	return String(value);
}
