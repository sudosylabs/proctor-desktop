/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
// @proctor-vscode-port resource-preview

import type MarkdownIt from 'markdown-it';
import type { Options, PluginSimple } from 'markdown-it/lib/index.mjs';
import type Token from 'markdown-it/lib/token.mjs';
import { URI } from '../../../../../../base/common/uri.js';
import { extendMarkdownIt as extendMarkdownItWithFrontMatter } from './extensions/yamlPreamble/yamlPreamble.js';

import { ISlugifier, SlugBuilder } from './slugify.js';
import type {
	MarkdownDocument,
	MarkdownEngineConfiguration,
	MarkdownResourceProvider
} from '../../markdownTypes.js';
type ITextDocument = MarkdownDocument;
type WebviewResourceProvider = MarkdownResourceProvider;

/**
 * Adds begin line index to the output via the 'data-line' data attribute.
 */
const pluginSourceMap: PluginSimple = (md): void => {
	// Set the attribute on every possible token.
	md.core.ruler.push('source_map_data_attribute', (state): void => {
		for (const token of state.tokens) {
			if (token.map && token.type !== 'inline') {
				token.attrSet('data-line', String(token.map[0]));
				token.attrJoin('class', 'code-line');
				token.attrJoin('dir', 'auto');
			}
		}
	});

	// The 'html_block' renderer doesn't respect `attrs`. We need to insert a marker.
	const originalHtmlBlockRenderer = md.renderer.rules['html_block'];
	if (originalHtmlBlockRenderer) {
		md.renderer.rules['html_block'] = (tokens, idx, options, env, self) =>
			`<div ${self.renderAttrs(tokens[idx])} ></div>\n` +
			originalHtmlBlockRenderer(tokens, idx, options, env, self);
	}
};

/**
 * The markdown-it options that we expose in the settings.
 */
type MarkdownItConfig = Readonly<Required<Pick<Options, 'breaks' | 'linkify' | 'typographer'>>>;

class TokenCache {
	#cachedDocument?: {
		readonly uri: URI;
		readonly version: number;
		readonly config: MarkdownItConfig;
	};
	#tokens?: Token[];

	public tryGetCached(document: ITextDocument, config: MarkdownItConfig): Token[] | undefined {
		if (
			this.#cachedDocument &&
			this.#cachedDocument.uri.toString() === document.uri.toString() &&
			document.version >= 0 &&
			this.#cachedDocument.version === document.version &&
			this.#cachedDocument.config.breaks === config.breaks &&
			this.#cachedDocument.config.linkify === config.linkify &&
			this.#cachedDocument.config.typographer === config.typographer
		) {
			return this.#tokens;
		}
		return undefined;
	}

	public update(document: ITextDocument, config: MarkdownItConfig, tokens: Token[]) {
		this.#cachedDocument = {
			uri: document.uri,
			version: document.version,
			config
		};
		this.#tokens = tokens;
	}

	public clean(): void {
		this.#cachedDocument = undefined;
		this.#tokens = undefined;
	}
}

export interface RenderOutput {
	html: string;
	containingImages: Set<string>;
}

interface RenderEnv {
	readonly containingImages: Set<string>;
	readonly currentDocument: URI | undefined;
	readonly resourceProvider: WebviewResourceProvider | undefined;
	readonly slugifier: SlugBuilder;
}

export interface IMdParser {
	readonly slugifier: ISlugifier;

	tokenize(document: ITextDocument): Promise<Token[]>;
}

export class MarkdownItEngine implements IMdParser {
	#md?: Promise<MarkdownIt>;

	readonly #tokenCache = new TokenCache();

	public readonly slugifier: ISlugifier;

	public constructor(
		readonly configuration: () => MarkdownEngineConfiguration,
		slugifier: ISlugifier
	) {
		this.slugifier = slugifier;
	}

	public async getEngine(resource: URI | undefined): Promise<MarkdownIt> {
		const config = this.#getConfig(resource);
		return this.#getEngine(config);
	}

	async #getEngine(config: MarkdownItConfig): Promise<MarkdownIt> {
		if (!this.#md) {
			this.#md = (async () => {
				const markdownIt = await import('markdown-it');
				let md: MarkdownIt = markdownIt.default(await getMarkdownOptions(() => md));
				md.linkify.set({ fuzzyLink: false });

				md = extendMarkdownItWithFrontMatter(md, () => this.configuration().frontMatter);

				this.#addImageRenderer(md);
				this.#addFencedRenderer(md);
				this.#addLinkValidator(md);
				this.#addNamedHeaders(md);
				this.#addLinkRenderer(md);
				md.use(pluginSourceMap);
				return md;
			})();
		}

		const md = await this.#md!;
		md.set(config);
		return md;
	}

	public reloadPlugins() {
		this.#md = undefined;
	}

	#tokenizeDocument(
		document: ITextDocument,
		config: MarkdownItConfig,
		engine: MarkdownIt
	): Token[] {
		const cached = this.#tokenCache.tryGetCached(document, config);
		if (cached) {
			return cached;
		}

		const tokens = this.#tokenizeString(document.getText(), engine);
		this.#tokenCache.update(document, config, tokens);
		return tokens;
	}

	#tokenizeString(text: string, engine: MarkdownIt) {
		const env: RenderEnv = {
			currentDocument: undefined,
			containingImages: new Set<string>(),
			slugifier: this.slugifier.createBuilder(),
			resourceProvider: undefined
		};
		return engine.parse(text, env);
	}

	public async render(
		input: ITextDocument | string,
		resourceProvider?: WebviewResourceProvider
	): Promise<RenderOutput> {
		const config = this.#getConfig(typeof input === 'string' ? undefined : input.uri);
		const engine = await this.#getEngine(config);

		const tokens =
			typeof input === 'string'
				? this.#tokenizeString(input, engine)
				: this.#tokenizeDocument(input, config, engine);

		const env: RenderEnv = {
			containingImages: new Set<string>(),
			currentDocument: typeof input === 'string' ? undefined : input.uri,
			resourceProvider,
			slugifier: this.slugifier.createBuilder()
		};

		const html = engine.renderer.render(
			tokens,
			{
				...engine.options,
				...config
			},
			env
		);

		return {
			html,
			containingImages: env.containingImages
		};
	}

	public async tokenize(document: ITextDocument): Promise<Token[]> {
		const config = this.#getConfig(document.uri);
		const engine = await this.#getEngine(config);
		return this.#tokenizeDocument(document, config, engine);
	}

	public cleanCache(): void {
		this.#tokenCache.clean();
	}

	#getConfig(_resource?: URI): MarkdownItConfig {
		const config = this.configuration();
		return { breaks: config.breaks, linkify: config.linkify, typographer: config.typographer };
	}

	#addImageRenderer(md: MarkdownIt): void {
		const original = md.renderer.rules.image;
		md.renderer.rules.image = (tokens: Token[], idx: number, options, env: RenderEnv, self) => {
			const token = tokens[idx];
			const src = token.attrGet('data-src') ?? token.attrGet('src');
			if (src) {
				env.containingImages?.add(src);

				{
					token.attrSet(
						'src',
						this.#toResourceUri(src, env.currentDocument, env.resourceProvider)
					);
					token.attrSet('data-src', src);
				}
			}

			if (original) {
				return original(tokens, idx, options, env, self);
			} else {
				return self.renderToken(tokens, idx, options);
			}
		};
	}

	#addFencedRenderer(md: MarkdownIt): void {
		const original = md.renderer.rules['fenced'];
		md.renderer.rules['fenced'] = (tokens: Token[], idx: number, options, env, self) => {
			const token = tokens[idx];
			if (token.map?.length) {
				token.attrJoin('class', 'hljs');
			}

			if (original) {
				return original(tokens, idx, options, env, self);
			} else {
				return self.renderToken(tokens, idx, options);
			}
		};
	}

	#addLinkValidator(md: MarkdownIt): void {
		const validateLink = md.validateLink;
		md.validateLink = (link: string) =>
			validateLink(link) &&
			!/^(?:file|command|vscode|vscode-insiders|data|javascript|vbscript):/i.test(link);
	}

	#addNamedHeaders(md: MarkdownIt): void {
		const original = md.renderer.rules.heading_open;
		md.renderer.rules.heading_open = (
			tokens: Token[],
			idx: number,
			options,
			env: unknown,
			self
		) => {
			const title = this.#tokenToPlainText(tokens[idx + 1]);
			const slug = (env as RenderEnv).slugifier
				? (env as RenderEnv).slugifier.add(title)
				: this.slugifier.fromHeading(title);
			tokens[idx].attrSet('id', slug.value);

			if (original) {
				return original(tokens, idx, options, env, self);
			} else {
				return self.renderToken(tokens, idx, options);
			}
		};
	}

	#tokenToPlainText(token: Token): string {
		if (token.children) {
			return token.children.map((x) => this.#tokenToPlainText(x)).join('');
		}

		switch (token.type) {
			case 'text':
			case 'emoji':
			case 'code_inline':
				return token.content;
			default:
				return '';
		}
	}

	#addLinkRenderer(md: MarkdownIt): void {
		const original = md.renderer.rules.link_open;

		md.renderer.rules.link_open = (tokens: Token[], idx: number, options, env, self) => {
			const token = tokens[idx];
			const href = token.attrGet('href');
			// A string, including empty string, may be `href`.
			if (typeof href === 'string') {
				token.attrSet('data-href', href);
			}
			if (original) {
				return original(tokens, idx, options, env, self);
			} else {
				return self.renderToken(tokens, idx, options);
			}
		};
	}

	#toResourceUri(
		href: string,
		currentDocument: URI | undefined,
		resourceProvider: WebviewResourceProvider | undefined
	): string {
		// The caller supplies only previously authorized in-memory asset URLs.
		return currentDocument && resourceProvider
			? (resourceProvider.resolve(currentDocument, href) ?? '')
			: '';
	}
}

async function getMarkdownOptions(md: () => MarkdownIt): Promise<Options> {
	const hljs = (await import('highlight.js')).default;
	return {
		html: true,
		highlight: (str: string, lang?: string) => {
			lang = normalizeHighlightLang(lang);
			if (lang && hljs.getLanguage(lang)) {
				try {
					return hljs.highlight(str, {
						language: lang,
						ignoreIllegals: true
					}).value;
				} catch (error) {}
			}
			return md().utils.escapeHtml(str);
		}
	};
}

function normalizeHighlightLang(lang: string | undefined) {
	switch (lang?.toLowerCase()) {
		case 'shell':
			return 'sh';

		case 'py3':
			return 'python';

		case 'tsx':
		case 'typescriptreact':
			// Workaround for highlight not supporting tsx: https://github.com/isagalaev/highlight.js/issues/1155
			return 'jsx';

		case 'json5':
		case 'jsonc':
			return 'json';

		case 'c#':
		case 'csharp':
			return 'cs';

		default:
			return lang;
	}
}
