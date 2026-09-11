/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
// @proctor-vscode-port settings-editor-textmate

import { ITextMateAssets } from '../common/packagedTextMateAssets.js';
import type { StyleSheetHandle } from '../../../../base/browser/styleSheetHandle.js';
import { IEditorThemeService } from '../../editor/browser/editorThemeService.js';
import * as domStylesheets from '../../../../base/browser/domStylesheets.js';
import { equals as equalArray } from '../../../../base/common/arrays.js';
import { Color } from '../../../../base/common/color.js';
import { CancellationError, isCancellationError, onUnexpectedError } from '../../../../base/common/errors.js';
import { Disposable, DisposableStore, type IDisposable, MutableDisposable } from '../../../../base/common/lifecycle.js';
import { type IObservable, observableFromEvent } from '../../../../base/common/observable.js';
import type { URI } from '../../../../base/common/uri.js';
import { type ITokenizationSupport, LazyTokenizationSupport, TokenizationRegistry } from '../../../../editor/common/languages.js';
import { ILanguageService } from '../../../../editor/common/languages/language.js';
import { generateTokensCSSForColorMap, generateTokensCSSForFontMap } from '../../../../platform/theme/common/tokenization.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { ITelemetryService } from '../../../../platform/telemetry/common/telemetry.js';
import type { ITextMateTokenizationService } from './textMateTokenizationFeature.js';
import { TextMateTokenizationSupport } from '../common/tokenizationSupport/textMateTokenizationSupport.js';
import { TokenizationSupportWithLineLimit } from '../common/tokenizationSupport/tokenizationSupportWithLineLimit.js';
import { ThreadedBackgroundTokenizerFactory } from './backgroundTokenization/threadedBackgroundTokenizerFactory.js';
import { TMGrammarFactory, missingTMGrammarErrorMessage } from '../common/TMGrammarFactory.js';
import type { IValidGrammarDefinition } from '../common/TMScopeRegistry.js';
import type { ITextMateThemingRule, IWorkbenchColorTheme } from '../../../../platform/theme/common/workbenchThemeService.js';
import type { IGrammar, IOnigLib, IRawTheme } from 'vscode-textmate';
import type { IFontTokenOptions } from '../../../../platform/theme/common/themeService.js';

export class TextMateTokenizationFeature extends Disposable implements ITextMateTokenizationService {
	private static reportTokenizationTimeCounter = { sync: 0, async: 0 };
	public _serviceBrand: undefined;

	private readonly _styleElement: StyleSheetHandle;
	private readonly _createdModes: string[];
	private readonly _encounteredLanguages: boolean[];


	private _grammarDefinitions: IValidGrammarDefinition[] | null;
	private readonly _grammarFactoryOwner = this._register(new MutableDisposable<TMGrammarFactory>());
	private get _grammarFactory(): TMGrammarFactory | null { return this._grammarFactoryOwner.value ?? null; }
	private set _grammarFactory(value: TMGrammarFactory | null) { this._grammarFactoryOwner.value = value ?? undefined; }
	private readonly _tokenizersRegistrations;
	private _currentTheme: IRawTheme | null;
	private _currentTokenColorMap: string[] | null;
	private _currentTokenFontMap: IFontTokenOptions[] | null;
	private readonly _threadedBackgroundTokenizerFactory;

	constructor(
		@ILanguageService private readonly _languageService: ILanguageService,
		@IEditorThemeService private readonly _themeService: IEditorThemeService,
		@ITextMateAssets private readonly _assets: ITextMateAssets,
		@ILogService private readonly _logService: ILogService,
		@IConfigurationService private readonly _configurationService: IConfigurationService,
		@IInstantiationService private readonly _instantiationService: IInstantiationService,
		@ITelemetryService private readonly _telemetryService: ITelemetryService,
	) {
		super();
		this._createdModes = [];
		this._encounteredLanguages = [];
		this._grammarDefinitions = null;
		this._grammarFactory = null;
		this._tokenizersRegistrations = this._register(new DisposableStore());
		this._currentTheme = null;
		this._currentTokenColorMap = null;
		this._currentTokenFontMap = null;
		this._threadedBackgroundTokenizerFactory = this._register(this._instantiationService.createInstance(
			ThreadedBackgroundTokenizerFactory,
			(timeMs, languageId, sourceExtensionId, lineLength, isRandomSample) => this._reportTokenizationTime(timeMs, languageId, sourceExtensionId, lineLength, true, isRandomSample),
			() => this.getAsyncTokenizationEnabled(),
		));
		this._vscodeOniguruma = null;

		this._styleElement = this._register(domStylesheets.createStyleSheet());
		this._styleElement.anchor.data = 'prctr-tokens-styles';

		this._handleGrammars(this._assets.grammars);

		this._updateTheme(this._themeService.getColorTheme(), true);
		this._register(this._themeService.onDidColorThemeChange(() => {
			this._updateTheme(this._themeService.getColorTheme(), false);
		}));

		this._register(this._languageService.onDidRequestRichLanguageFeatures((languageId) => {
			this._createdModes.push(languageId);
		}));
	}

	private getAsyncTokenizationEnabled(): boolean {
		return !!this._configurationService.getValue<boolean>('editor.experimental.asyncTokenization');
	}

	private getAsyncTokenizationVerification(): boolean {
		return !!this._configurationService.getValue<boolean>('editor.experimental.asyncTokenizationVerification');
	}

	private _handleGrammars(grammars: readonly IValidGrammarDefinition[]): void {
		this._grammarDefinitions = null;
		this._grammarFactory = null;
		this._tokenizersRegistrations.clear();
		this._grammarDefinitions = [...grammars];
		for (const grammar of this._grammarDefinitions) {
			if (grammar.language && this._languageService.isRegisteredLanguageId(grammar.language)) {
				const lazyTokenizationSupport = new LazyTokenizationSupport(() => this._createTokenizationSupport(grammar.language!));
				this._tokenizersRegistrations.add(lazyTokenizationSupport);
				this._tokenizersRegistrations.add(TokenizationRegistry.registerFactory(grammar.language, lazyTokenizationSupport));
			}
		}
		this._threadedBackgroundTokenizerFactory.setGrammarDefinitions(this._grammarDefinitions);
		for (const createdMode of this._createdModes) TokenizationRegistry.getOrCreate(createdMode);
	}

	private _canCreateGrammarFactory(): boolean {
		// Check if extension point is ready
		return !!this._grammarDefinitions;
	}
	private async _getOrCreateGrammarFactory(): Promise<TMGrammarFactory> {
		if (this._store.isDisposed) throw new CancellationError();
		if (this._grammarFactory) {
			return this._grammarFactory;
		}

		const [vscodeTextmate, vscodeOniguruma] = await Promise.all([this._assets.loadTextMate(), this._getVSCodeOniguruma()]);
		if (this._store.isDisposed) throw new CancellationError();
		const onigLib: Promise<IOnigLib> = Promise.resolve({
			createOnigScanner: (sources: string[]) => vscodeOniguruma.createOnigScanner(sources),
			createOnigString: (str: string) => vscodeOniguruma.createOnigString(str)
		});

		// Avoid duplicate instantiations
		if (this._grammarFactory) {
			return this._grammarFactory;
		}

		this._grammarFactory = new TMGrammarFactory({
			logTrace: (msg: string) => this._logService.trace(msg),
			logError: (msg: string, err: unknown) => this._logService.error(msg, err),
			readFile: (resource: URI) => this._assets.readGrammar(resource)
		}, this._grammarDefinitions || [], vscodeTextmate, onigLib);

		this._updateTheme(this._themeService.getColorTheme(), true);

		return this._grammarFactory;
	}

	private async _createTokenizationSupport(languageId: string): Promise<ITokenizationSupport & IDisposable | null> {
		if (!this._languageService.isRegisteredLanguageId(languageId)) {
			return null;
		}
		if (!this._canCreateGrammarFactory()) {
			return null;
		}

		try {
			const grammarFactory = await this._getOrCreateGrammarFactory();
			if (!grammarFactory.has(languageId)) {
				return null;
			}
			const encodedLanguageId = this._languageService.languageIdCodec.encodeLanguageId(languageId);
			const r = await grammarFactory.createGrammar(languageId, encodedLanguageId);
			if (this._store.isDisposed) return null;
			if (!r.grammar) {
				return null;
			}
			const maxTokenizationLineLength = observableConfigValue<number>(
				'editor.maxTokenizationLineLength',
				languageId,
				-1,
				this._configurationService
			);
			const store = new DisposableStore();
			const tokenization = store.add(new TextMateTokenizationSupport(
				r.grammar,
				r.initialState,
				r.containsEmbeddedLanguages,
				(textModel, tokenStore) => this._threadedBackgroundTokenizerFactory.createBackgroundTokenizer(textModel, tokenStore, maxTokenizationLineLength),
				() => this.getAsyncTokenizationVerification(),
				(timeMs, lineLength, isRandomSample) => {
					this._reportTokenizationTime(timeMs, languageId, r.sourceExtensionId, lineLength, false, isRandomSample);
				},
				true,
			));
			store.add(tokenization.onDidEncounterLanguage((encodedLanguageId) => {
				if (!this._encounteredLanguages[encodedLanguageId]) {
					const languageId = this._languageService.languageIdCodec.decodeLanguageId(encodedLanguageId);
					this._encounteredLanguages[encodedLanguageId] = true;
					this._languageService.requestBasicLanguageFeatures(languageId);
				}
			}));

			return new TokenizationSupportWithLineLimit(encodedLanguageId, tokenization, store, maxTokenizationLineLength);
		} catch (err) {
			if (isCancellationError(err) || this._store.isDisposed) return null;
			if (err.message && err.message === missingTMGrammarErrorMessage) {
				// Don't log this error message
				return null;
			}
			onUnexpectedError(err);
			return null;
		}
	}

	private _updateTheme(colorTheme: IWorkbenchColorTheme, forceUpdate: boolean): void {
		if (!forceUpdate && this._currentTheme && this._currentTokenColorMap && equalsTokenRules(this._currentTheme.settings, colorTheme.tokenColors)
			&& equalArray(this._currentTokenColorMap, colorTheme.tokenColorMap) && this._currentTokenFontMap && equalArray(this._currentTokenFontMap, colorTheme.tokenFontMap)) {
			return;
		}
		this._currentTheme = { name: colorTheme.label, settings: colorTheme.tokenColors };
		this._currentTokenColorMap = colorTheme.tokenColorMap;
		this._currentTokenFontMap = colorTheme.tokenFontMap;

		this._grammarFactory?.setTheme(this._currentTheme, this._currentTokenColorMap);
		const colorMap = toColorMap(this._currentTokenColorMap);
		const colorCssRules = generateTokensCSSForColorMap(colorMap);
		const fontCssRules = generateTokensCSSForFontMap(this._currentTokenFontMap);

		this._styleElement.textContent = colorCssRules + fontCssRules;
		TokenizationRegistry.setColorMap(colorMap);

		if (this._currentTheme && this._currentTokenColorMap) {
			this._threadedBackgroundTokenizerFactory.acceptTheme(this._currentTheme, this._currentTokenColorMap);
		}
	}

	public async createTokenizer(languageId: string): Promise<IGrammar | null> {
		if (!this._languageService.isRegisteredLanguageId(languageId)) {
			return null;
		}
		const grammarFactory = await this._getOrCreateGrammarFactory();
		if (!grammarFactory.has(languageId)) {
			return null;
		}
		const encodedLanguageId = this._languageService.languageIdCodec.encodeLanguageId(languageId);
		const { grammar } = await grammarFactory.createGrammar(languageId, encodedLanguageId);
		return this._store.isDisposed ? null : grammar;
	}

	private _vscodeOniguruma: Promise<typeof import('vscode-oniguruma')> | null;
	private _getVSCodeOniguruma(): Promise<typeof import('vscode-oniguruma')> {
		if (!this._vscodeOniguruma) this._vscodeOniguruma = this._assets.loadOniguruma().catch(error => {
			this._vscodeOniguruma = null;
			throw error;
		});
		return this._vscodeOniguruma;
	}

	private _reportTokenizationTime(timeMs: number, languageId: string, sourceExtensionId: string | undefined, lineLength: number, fromWorker: boolean, isRandomSample: boolean): void {
		const key = fromWorker ? 'async' : 'sync';

		// 50 events per hour (one event has a low probability)
		if (TextMateTokenizationFeature.reportTokenizationTimeCounter[key] > 50) {
			// Don't flood telemetry with too many events
			return;
		}
		if (TextMateTokenizationFeature.reportTokenizationTimeCounter[key] === 0) {
			setTimeout(() => {
				TextMateTokenizationFeature.reportTokenizationTimeCounter[key] = 0;
			}, 1000 * 60 * 60);
		}
		TextMateTokenizationFeature.reportTokenizationTimeCounter[key]++;

		this._telemetryService.publicLog2<{
			timeMs: number;
			languageId: string;
			lineLength: number;
			fromWorker: boolean;
			sourceExtensionId: string | undefined;
			isRandomSample: boolean;
			tokenizationSetting: number;
		}, {
			owner: 'hediet';

			timeMs: { classification: 'SystemMetaData'; purpose: 'FeatureInsight'; comment: 'To understand how long it took to tokenize a random line' };
			languageId: { classification: 'SystemMetaData'; purpose: 'FeatureInsight'; comment: 'To relate the performance to the language' };
			lineLength: { classification: 'SystemMetaData'; purpose: 'FeatureInsight'; comment: 'To relate the performance to the line length' };
			fromWorker: { classification: 'SystemMetaData'; purpose: 'FeatureInsight'; comment: 'To figure out if this line was tokenized sync or async' };
			sourceExtensionId: { classification: 'SystemMetaData'; purpose: 'FeatureInsight'; comment: 'To figure out which extension contributed the grammar' };
			isRandomSample: { classification: 'SystemMetaData'; purpose: 'FeatureInsight'; comment: 'To figure out if this is a random sample or measured because of some other condition.' };
			tokenizationSetting: { classification: 'SystemMetaData'; purpose: 'FeatureInsight'; comment: 'To understand if the user has async tokenization enabled. 0=sync, 1=async, 2=verification' };

			comment: 'This event gives insight about the performance certain grammars.';
		}>('editor.tokenizedLine', {
			timeMs,
			languageId,
			lineLength,
			fromWorker,
			sourceExtensionId,
			isRandomSample,
			tokenizationSetting: this.getAsyncTokenizationEnabled() ? (this.getAsyncTokenizationVerification() ? 2 : 1) : 0,
		});
	}
}

function toColorMap(colorMap: string[]): Color[] {
	const result: Color[] = [null!];
	for (let i = 1, len = colorMap.length; i < len; i++) {
		result[i] = Color.fromHex(colorMap[i]);
	}
	return result;
}

function equalsTokenRules(a: ITextMateThemingRule[] | null, b: ITextMateThemingRule[] | null): boolean {
	if (!b || !a || b.length !== a.length) {
		return false;
	}
	for (let i = b.length - 1; i >= 0; i--) {
		const r1 = b[i];
		const r2 = a[i];
		if (r1.scope !== r2.scope) {
			return false;
		}
		const s1 = r1.settings;
		const s2 = r2.settings;
		if (s1 && s2) {
			if (s1.fontStyle !== s2.fontStyle || s1.foreground !== s2.foreground || s1.background !== s2.background || s1.lineHeight !== s2.lineHeight || s1.fontSize !== s2.fontSize || s1.fontFamily !== s2.fontFamily) {
				return false;
			}
		} else if (!s1 || !s2) {
			return false;
		}
	}
	return true;
}

function observableConfigValue<T>(key: string, languageId: string, defaultValue: T, configurationService: IConfigurationService): IObservable<T> {
	return observableFromEvent(
		(handleChange) => configurationService.onDidChangeConfiguration(e => {
			if (e.affectsConfiguration(key, { overrideIdentifier: languageId })) {
				handleChange(e);
			}
		}),
		() => configurationService.getValue<T>(key, { overrideIdentifier: languageId }) ?? defaultValue,
	);
}
