import { RunOnceScheduler } from '../../../../base/common/async.js';
import { CancellationToken, CancellationTokenSource } from '../../../../base/common/cancellation.js';
import { CancellationError, isCancellationError } from '../../../../base/common/errors.js';
import { Emitter } from '../../../../base/common/event.js';
import { Disposable, MutableDisposable } from '../../../../base/common/lifecycle.js';
import type { Diagnostic } from 'vscode-languageserver/browser';
import { Range } from '../../../common/core/range.js';
import * as Editor from '../../../common/languages.js';
import type { ITextModel } from '../../../common/model.js';
import { ILanguageFeaturesService } from '../../../common/services/languageFeatures.js';
import { JsonLanguageClient } from './jsonLanguageClient.js';
import {
	fromProtocolCompletion, fromProtocolEdit, fromProtocolHover, fromProtocolRange,
	fromProtocolSelection, fromProtocolSymbol, toProtocolPosition, toProtocolRange
} from './jsonProtocolConversions.js';

import { ExtensionIdentifier } from '../../../../platform/extensions/common/extensions.js';

export interface JsonValidationResult { readonly version: number; readonly diagnostics: readonly Diagnostic[]; }

/** Static provider registration against the original Monaco registries for one owned model. */
export class JsonLanguageFeatures extends Disposable {
	private readonly validated = this._register(new Emitter<JsonValidationResult>());
	readonly onDidValidate = this.validated.event;
	private readonly validation = this._register(new MutableDisposable<CancellationTokenSource>());
	private readonly validationScheduler = this._register(new RunOnceScheduler(() => { void this.validate(); }, 200));
	private readonly actionVersions = new WeakMap<Editor.CodeAction, number>();
	private disposed = false;

	constructor(readonly client: JsonLanguageClient, @ILanguageFeaturesService features: ILanguageFeaturesService) {
		super();
		const model = client.model;
		const selector = { language: 'jsonc', scheme: model.uri.scheme, pattern: model.uri.path };
		this._register(features.completionProvider.register(selector, {
			_debugDisplayName: 'Packaged JSON', triggerCharacters: ['"', ':'],
			provideCompletionItems: (candidate, position, context, token) => this.forModel(candidate, async () => {
				const word = candidate.getWordUntilPosition(position);
				const fallback = new Range(position.lineNumber, word.startColumn, position.lineNumber, word.endColumn);
				const result = await client.request('textDocument/completion', { position: toProtocolPosition(position),
					context: { triggerKind: context.triggerKind === Editor.CompletionTriggerKind.Invoke ? 1 : context.triggerKind === Editor.CompletionTriggerKind.TriggerCharacter ? 2 : 3,
						triggerCharacter: context.triggerCharacter } }, token);
				return result ? { suggestions: result.items.map(item => fromProtocolCompletion(item, position, fallback, result.itemDefaults)), incomplete: result.isIncomplete } : undefined;
			})
		}));
		this._register(features.hoverProvider.register(selector, {
			provideHover: (candidate, position, token) => this.forModel(candidate, async () => {
				const value = await client.request('textDocument/hover', { position: toProtocolPosition(position) }, token);
				return value ? fromProtocolHover(value) : undefined;
			})
		}));
		this._register(features.documentFormattingEditProvider.register(selector, {
			displayName: 'JSON', extensionId: new ExtensionIdentifier('prctr.json'), provideDocumentFormattingEdits: (candidate, options, token) => this.forModel(candidate, async () =>
				(await client.request('textDocument/formatting', { options: { ...options } }, token)).map(fromProtocolEdit))
		}));
		this._register(features.documentRangeFormattingEditProvider.register(selector, {
			displayName: 'JSON', extensionId: new ExtensionIdentifier('prctr.json'), provideDocumentRangeFormattingEdits: (candidate, range, options, token) => this.forModel(candidate, async () =>
				(await client.request('textDocument/rangeFormatting', { range: toProtocolRange(range), options: { ...options } }, token)).map(fromProtocolEdit))
		}));
		this._register(features.documentSymbolProvider.register(selector, {
			displayName: 'JSON', provideDocumentSymbols: (candidate, token) => this.forModel(candidate, async () =>
				(await client.request('textDocument/documentSymbol', {}, token)).map(fromProtocolSymbol))
		}));
		this._register(features.colorProvider.register(selector, {
			provideDocumentColors: (candidate, token) => this.forModel(candidate, async () =>
				(await client.request('textDocument/documentColor', {}, token)).map(value => ({ color: value.color, range: fromProtocolRange(value.range) }))),
			provideColorPresentations: (candidate, info, token) => this.forModel(candidate, async () =>
				(await client.request('textDocument/colorPresentation', { color: info.color, range: toProtocolRange(info.range) }, token)).map(value => ({
					label: value.label, textEdit: value.textEdit ? fromProtocolEdit(value.textEdit) : undefined,
					additionalTextEdits: value.additionalTextEdits?.map(fromProtocolEdit)
				})))
		}));
		this._register(features.foldingRangeProvider.register(selector, {
			id: 'prctr.json', provideFoldingRanges: (candidate, _context, token) => this.forModel(candidate, async () =>
				(await client.request('textDocument/foldingRange', {}, token)).map(value => ({ start: value.startLine + 1, end: value.endLine + 1,
					kind: value.kind ? Editor.FoldingRangeKind.fromValue(value.kind) : undefined })))
		}));
		this._register(features.selectionRangeProvider.register(selector, {
			provideSelectionRanges: (candidate, positions, token) => this.forModel(candidate, async () =>
				(await client.request('textDocument/selectionRange', { positions: positions.map(toProtocolPosition) }, token)).map(fromProtocolSelection))
		}));
		this._register(features.linkProvider.register(selector, {
			provideLinks: (candidate, token) => this.forModel(candidate, async () => ({ links:
				(await client.request('textDocument/documentLink', {}, token)).filter(value => value.target && isSafeDocumentationLink(value.target))
					.map(value => ({ range: fromProtocolRange(value.range), url: value.target!, tooltip: value.tooltip }))
			}))
		}));
		this._register(features.codeActionProvider.register(selector, {
			displayName: 'JSON', providedCodeActionKinds: ['source.sort.json'],
			provideCodeActions: (candidate, range, context, token) => this.forModel(candidate, async () => {
				const version = candidate.getVersionId();
				const result = await client.request('textDocument/codeAction', { range: toProtocolRange(range),
					context: { diagnostics: [], ...(context.only ? { only: [context.only] } : {}), triggerKind: context.trigger } }, token);
				const actions = result.map(action => {
					if (action.command?.command !== 'json.sort' || action.command.arguments?.length || action.edit)
						throw new Error('JSON returned an unregistered code action.');
					const value: Editor.CodeAction = { title: action.command.title, kind: action.kind, isPreferred: action.isPreferred,
						disabled: action.disabled?.reason };
					this.actionVersions.set(value, version);
					return value;
				});
				return { actions, dispose() {} };
			}),
			resolveCodeAction: async (action, token) => {
				const version = this.actionVersions.get(action);
				if (this.disposed || model.isDisposed() || version === undefined || model.getVersionId() !== version) throw new CancellationError();
				const options = model.getOptions();
				const edits = await client.request('json/sort', { options: { tabSize: options.tabSize, insertSpaces: options.insertSpaces } }, token);
				return { ...action, edit: { edits: edits.map(edit => ({ resource: model.uri, versionId: version, textEdit: fromProtocolEdit(edit) })) } };
			}
		}));
		this._register(model.onDidChangeContent(() => {
			this.validation.value?.cancel();
			this.validationScheduler.schedule();
		}));
		this._register(model.onWillDispose(() => this.dispose()));
		this.validationScheduler.schedule(0);
	}

	private forModel<T>(model: ITextModel, task: () => Promise<T>): Promise<T> | undefined {
		if (this.disposed || model !== this.client.model) return undefined;
		return task();
	}

	async validate(token = CancellationToken.None): Promise<void> {
		if (this.disposed || this.client.model.isDisposed()) return;
		this.validationScheduler.cancel();
		this.validation.value?.cancel();
		const cancellation = this.validation.value = new CancellationTokenSource(token);
		const version = this.client.model.getVersionId();
		try {
			const diagnostics = await this.client.request('json/validate', {}, cancellation.token);
			if (!this.disposed && !cancellation.token.isCancellationRequested) this.validated.fire({ version, diagnostics });
		} catch (error) {
			if (!isCancellationError(error)) {
				// The client reports capability failure; do not replace known diagnostics with a false success.
				return;
			}
		}
	}

	override dispose(): void {
		if (this.disposed) return;
		this.disposed = true;
		this.validation.value?.cancel();
		super.dispose();
	}
}

function isSafeDocumentationLink(value: string): boolean {
	try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password; }
	catch { return false; }
}
