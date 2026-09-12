import {
	createLanguageService,
	type IMdLanguageService,
	type ITextDocument
} from 'vscode-markdown-languageservice';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { URI as LanguageURI } from 'vscode-uri';
import { URI } from '../../../../base/common/uri.js';
import { CancellationToken } from '../../../../base/common/cancellation.js';
import { Emitter, type Event } from '../../../../base/common/event.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import type { PreviewTextSnapshot } from '../common/resourcePreview.js';
import { MarkdownItEngine } from './markdown/src/markdownEngine.js';
import { githubSlugifier } from './markdown/src/slugify.js';
import { defaultMarkdownConfiguration } from './markdownTypes.js';

export interface MarkdownWorkspaceAccess {
	readonly roots: readonly string[];
	readonly onDidChangeDocument: Event<PreviewTextSnapshot>;
	readonly onDidCreateDocument: Event<PreviewTextSnapshot>;
	readonly onDidDeleteDocument: Event<string>;
	allMarkdownDocuments(): Promise<readonly PreviewTextSnapshot[]>;
	hasMarkdownDocument(resource: string): boolean;
	readMarkdownDocument(resource: string): Promise<PreviewTextSnapshot | undefined>;
	stat(resource: string): Promise<{ readonly isDirectory: boolean } | undefined>;
	readDirectory(
		resource: string
	): Promise<readonly (readonly [string, { readonly isDirectory: boolean }])[]>;
}
export interface MarkdownLinkTarget {
	readonly kind: 'file' | 'folder' | 'external';
	readonly resource: string;
	readonly line?: number;
	readonly character?: number;
	readonly fragment?: string;
}
export interface MarkdownLinkEdit {
	readonly resource: string;
	readonly version: number | null;
	readonly startLine: number;
	readonly startCharacter: number;
	readonly endLine: number;
	readonly endCharacter: number;
	readonly text: string;
}

/** The same language service used by VS Code performs link resolution and rename edits. */
export class MarkdownLanguageService extends Disposable {
	/** Full upstream feature interface for editor registrations; returned edits are applied by the existing editor owner. */
	readonly languageFeatures: IMdLanguageService;
	private readonly engine = new MarkdownItEngine(
		() => defaultMarkdownConfiguration,
		githubSlugifier
	);
	constructor(private readonly access: MarkdownWorkspaceAccess) {
		super();
		const changed = this._register(new Emitter<ITextDocument>());
		const created = this._register(new Emitter<ITextDocument>());
		const deleted = this._register(new Emitter<LanguageURI>());
		const document = (value: PreviewTextSnapshot): ITextDocument =>
			TextDocument.create(value.resource, 'markdown', value.version, value.text);
		this._register(access.onDidChangeDocument((value) => changed.fire(document(value))));
		this._register(access.onDidCreateDocument((value) => created.fire(document(value))));
		this._register(
			access.onDidDeleteDocument((value) => deleted.fire(LanguageURI.parse(value)))
		);
		this.languageFeatures = createLanguageService({
			workspace: {
				workspaceFolders: access.roots.map((root) => LanguageURI.parse(root)),
				onDidChangeMarkdownDocument: changed.event,
				onDidCreateMarkdownDocument: created.event,
				onDidDeleteMarkdownDocument: deleted.event,
				getAllMarkdownDocuments: async () =>
					(await access.allMarkdownDocuments()).map(document),
				hasMarkdownDocument: (uri) => access.hasMarkdownDocument(uri.toString()),
				openMarkdownDocument: async (uri) => {
					const value = await access.readMarkdownDocument(uri.toString());
					return value && document(value);
				},
				stat: (uri) => access.stat(uri.toString()),
				readDirectory: (uri) => access.readDirectory(uri.toString())
			},
			parser: {
				slugifier: githubSlugifier,
				tokenize: (value) =>
					this.engine.tokenize({
						uri: URI.parse(value.uri),
						version: value.version,
						getText: () => value.getText()
					})
			},
			logger: { level: 0, log: () => {} }
		});
		this._register(this.languageFeatures);
	}
	async resolveLink(
		source: string,
		link: string,
		token = CancellationToken.None
	): Promise<MarkdownLinkTarget | undefined> {
		if (
			link.length > 8192 ||
			/^(?:file|command|data|javascript|vscode|vbscript):/i.test(link)
		) {
			return undefined;
		}
		const result = await this.languageFeatures.resolveLinkTarget(
			link,
			LanguageURI.parse(source),
			token
		);
		if (token.isCancellationRequested || !result) {
			return undefined;
		}
		const position = result.kind === 'file' ? result.positionOrRange : undefined;
		const start = position && ('start' in position ? position.start : position);
		return {
			kind: result.kind,
			resource: result.uri.toString(),
			...(start ? { line: start.line, character: start.character } : {}),
			...(result.kind === 'file' && result.fragment ? { fragment: result.fragment } : {})
		};
	}
	/** Call after FileService rename. The existing bulk-edit owner applies these versioned text edits. */
	async renameLinks(
		renames: readonly { oldResource: string; newResource: string }[],
		token = CancellationToken.None
	): Promise<readonly MarkdownLinkEdit[]> {
		if (renames.length > 1000) {
			throw new Error('Too many Markdown renames');
		}
		const versions = new Map(
			(await this.access.allMarkdownDocuments()).map((document) => [
				document.resource,
				document.version
			])
		);
		const result = await this.languageFeatures.getRenameFilesInWorkspaceEdit(
			renames.map((rename) => ({
				oldUri: LanguageURI.parse(rename.oldResource),
				newUri: LanguageURI.parse(rename.newResource)
			})),
			token
		);
		if (!result || token.isCancellationRequested) {
			return [];
		}
		const edits: MarkdownLinkEdit[] = [];
		const add = (
			resource: string,
			version: number | null,
			edit: {
				range: {
					start: { line: number; character: number };
					end: { line: number; character: number };
				};
				newText: string;
			}
		): void => {
			const expectedVersion = version ?? versions.get(resource);
			if (expectedVersion === undefined) {
				throw new Error('Markdown rename document was not captured');
			}
			edits.push({
				resource,
				version: expectedVersion,
				startLine: edit.range.start.line,
				startCharacter: edit.range.start.character,
				endLine: edit.range.end.line,
				endCharacter: edit.range.end.character,
				text: edit.newText
			});
		};
		for (const [resource, changes] of Object.entries(result.edit.changes ?? {})) {
			for (const edit of changes) {
				add(resource, null, edit);
			}
		}
		for (const change of result.edit.documentChanges ?? []) {
			if ('textDocument' in change) {
				for (const edit of change.edits) {
					if (!('newText' in edit)) {
						throw new Error('Unexpected snippet in Markdown link rename');
					}
					add(change.textDocument.uri, change.textDocument.version, edit);
				}
			}
		}
		for (const edit of edits) {
			const current = await this.access.readMarkdownDocument(edit.resource);
			if (current?.version !== edit.version) {
				throw new Error('Markdown document changed during rename');
			}
		}
		return token.isCancellationRequested ? [] : edits;
	}
	override dispose(): void {
		this.engine.cleanCache();
		super.dispose();
	}
}
