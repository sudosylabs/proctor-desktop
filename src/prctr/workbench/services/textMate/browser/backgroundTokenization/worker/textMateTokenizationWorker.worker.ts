/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
// @proctor-vscode-port settings-editor-textmate

import { URI } from '../../../../../../base/common/uri.js';
import type { LanguageId } from '../../../../../../platform/theme/common/encodedTokenAttributes.js';
import type { IModelChangedEvent } from '../../../../../../editor/common/model/mirrorTextModel.js';
import { type ICreateGrammarResult, TMGrammarFactory } from '../../../common/TMGrammarFactory.js';
import type { IValidGrammarDefinition } from '../../../common/TMScopeRegistry.js';
import type { IOnigLib, IRawTheme } from 'vscode-textmate';
import { TextMateWorkerTokenizer } from './textMateWorkerTokenizer.js';
import { PackagedTextMateAssets } from '../../../common/packagedTextMateAssets.js';
import type { IWebWorkerServer } from '../../../../../../base/common/worker/webWorker.js';
import { TextMateWorkerHost } from '../../../common/backgroundTokenization/textMateWorkerHost.js';
import type { ISerializedAnnotation } from '../../../../../../editor/common/model/tokens/annotations.js';
import type { IFontTokenOption } from '../../../../../../editor/common/textModelEvents.js';

import type { ICreateData, IRawModelData, StateDeltas, ITextMateTokenizationWorker } from '../../../common/backgroundTokenization/textMateWorkerProtocol.js';

export function create(workerServer: IWebWorkerServer): TextMateTokenizationWorker {
	return new TextMateTokenizationWorker(workerServer);
}

export class TextMateTokenizationWorker implements ITextMateTokenizationWorker {
	_requestHandlerBrand: void = undefined;

	private readonly _host: TextMateWorkerHost;
	private readonly _models = new Map</* controllerId */ number, TextMateWorkerTokenizer>();
	private readonly _grammarCache: Promise<ICreateGrammarResult>[] = [];
	private _grammarFactory: Promise<TMGrammarFactory | null> = Promise.resolve(null);

	constructor(workerServer: IWebWorkerServer) {
		this._host = TextMateWorkerHost.getChannel(workerServer);
	}

	public async $init(_createData: ICreateData): Promise<void> {
		const grammarDefinitions = _createData.grammarDefinitions.map<IValidGrammarDefinition>((def) => {
			return {
				location: URI.revive(def.location),
				language: def.language,
				scopeName: def.scopeName,
				embeddedLanguages: def.embeddedLanguages,
				tokenTypes: def.tokenTypes,
				injectTo: def.injectTo,
				balancedBracketSelectors: def.balancedBracketSelectors,
				unbalancedBracketSelectors: def.unbalancedBracketSelectors,
				sourceExtensionId: def.sourceExtensionId,
			};
		});
		this._grammarFactory = this._loadTMGrammarFactory(grammarDefinitions);
	}

	private async _loadTMGrammarFactory(grammarDefinitions: IValidGrammarDefinition[]): Promise<TMGrammarFactory> {
		const assets = new PackagedTextMateAssets();
		const [vscodeTextmate, vscodeOniguruma] = await Promise.all([assets.loadTextMate(), assets.loadOniguruma()]);

		const onigLib: Promise<IOnigLib> = Promise.resolve({
			createOnigScanner: (sources) => vscodeOniguruma.createOnigScanner(sources),
			createOnigString: (str) => vscodeOniguruma.createOnigString(str)
		});

		return new TMGrammarFactory({
			logTrace: (msg: string) => {/* console.log(msg) */ },
			logError: (msg: string, err: unknown) => console.error(msg, err),
			readFile: (resource: URI) => this._host.$readFile(resource)
		}, grammarDefinitions, vscodeTextmate, onigLib);
	}

	// These methods are called by the renderer

	public $acceptNewModel(data: IRawModelData): void {
		const uri = URI.revive(data.uri);
		const that = this;
		this._models.set(data.controllerId, new TextMateWorkerTokenizer(uri, data.lines, data.EOL, data.versionId, {
			async getOrCreateGrammar(languageId: string, encodedLanguageId: LanguageId): Promise<ICreateGrammarResult | null> {
				const grammarFactory = await that._grammarFactory;
				if (!grammarFactory) {
					return Promise.resolve(null);
				}
				if (!that._grammarCache[encodedLanguageId]) {
					that._grammarCache[encodedLanguageId] = grammarFactory.createGrammar(languageId, encodedLanguageId);
				}
				return that._grammarCache[encodedLanguageId];
			},
			setTokensAndStates(versionId: number, tokens: Uint8Array, fontTokens: ISerializedAnnotation<IFontTokenOption>[], stateDeltas: StateDeltas[]): void {
				that._host.$setTokensAndStates(data.controllerId, versionId, tokens, fontTokens, stateDeltas);
			},
			reportTokenizationTime(timeMs: number, languageId: string, sourceExtensionId: string | undefined, lineLength: number, isRandomSample: boolean): void {
				that._host.$reportTokenizationTime(timeMs, languageId, sourceExtensionId, lineLength, isRandomSample);
			},
		}, data.languageId, data.encodedLanguageId, data.maxTokenizationLineLength));
	}

	public $acceptModelChanged(controllerId: number, e: IModelChangedEvent): void {
		this._models.get(controllerId)!.onEvents(e);
	}

	public $retokenize(controllerId: number, startLineNumber: number, endLineNumberExclusive: number): void {
		this._models.get(controllerId)!.retokenize(startLineNumber, endLineNumberExclusive);
	}

	public $acceptModelLanguageChanged(controllerId: number, newLanguageId: string, newEncodedLanguageId: LanguageId): void {
		this._models.get(controllerId)!.onLanguageId(newLanguageId, newEncodedLanguageId);
	}

	public $acceptRemovedModel(controllerId: number): void {
		const model = this._models.get(controllerId);
		if (model) {
			model.dispose();
			this._models.delete(controllerId);
		}
	}

	public async $acceptTheme(theme: IRawTheme, colorMap: string[]): Promise<void> {
		const grammarFactory = await this._grammarFactory;
		grammarFactory?.setTheme(theme, colorMap);
	}

	public $acceptMaxTokenizationLineLength(controllerId: number, value: number): void {
		this._models.get(controllerId)!.acceptMaxTokenizationLineLength(value);
	}
}

