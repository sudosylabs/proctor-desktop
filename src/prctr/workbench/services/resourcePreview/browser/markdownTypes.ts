import type { URI } from '../../../../base/common/uri.js';

export interface MarkdownDocument {
	readonly uri: URI;
	readonly version: number;
	getText(): string;
}

export interface MarkdownEngineConfiguration {
	readonly breaks: boolean;
	readonly linkify: boolean;
	readonly typographer: boolean;
	readonly frontMatter: 'hide' | 'codeBlock' | 'table';
}

export interface MarkdownResourceProvider {
	resolve(source: URI, reference: string): string | undefined;
}

export const defaultMarkdownConfiguration: MarkdownEngineConfiguration = Object.freeze({
	breaks: false,
	linkify: true,
	typographer: false,
	frontMatter: 'table'
});
