/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
// @proctor-vscode-port settings-editor-textmate

import { DisposableStore, type IDisposable, toDisposable } from '../../../../../base/common/lifecycle.js';
import type { IObservable } from '../../../../../base/common/observable.js';
import { URI, type UriComponents } from '../../../../../base/common/uri.js';
import type { IBackgroundTokenizationStore, IBackgroundTokenizer } from '../../../../../editor/common/languages.js';
import { ILanguageService } from '../../../../../editor/common/languages/language.js';
import type { ITextModel } from '../../../../../editor/common/model.js';
import { IConfigurationService } from '../../../../../platform/configuration/common/configuration.js';
import { ITextMateAssets } from '../../common/packagedTextMateAssets.js';
import { INotificationService } from '../../../../../platform/notification/common/notification.js';
import { ITelemetryService } from '../../../../../platform/telemetry/common/telemetry.js';
import type { ICreateData, StateDeltas, ITextMateTokenizationWorker } from '../../common/backgroundTokenization/textMateWorkerProtocol.js';
import { TextMateWorkerHost } from '../../common/backgroundTokenization/textMateWorkerHost.js';
import { TextMateWorkerTokenizerController } from './textMateWorkerTokenizerController.js';
import type { IValidGrammarDefinition } from '../../common/TMScopeRegistry.js';
import type { IRawTheme } from 'vscode-textmate';
import { WebWorkerDescriptor } from '../../../../../platform/webWorker/browser/webWorkerDescriptor.js';
import { IWebWorkerService } from '../../../../../platform/webWorker/browser/webWorkerService.js';
import type { IWebWorkerClient, Proxied } from '../../../../../base/common/worker/webWorker.js';
import type { ISerializedAnnotation } from '../../../../../editor/common/model/tokens/annotations.js';
import type { IFontTokenOption } from '../../../../../editor/common/textModelEvents.js';

export class ThreadedBackgroundTokenizerFactory implements IDisposable {
	static readonly workerDescriptor = new WebWorkerDescriptor({
		esmModuleLocation: URI.parse('proctor-asset:/workers/textMateWorker.js'),
		label: 'TextMateWorker'
	});
	private static _reportedMismatchingTokens = false;

	private _workerProxyPromise: Promise<Proxied<ITextMateTokenizationWorker> | null> | null = null;
	private _worker: IWebWorkerClient<ITextMateTokenizationWorker> | null = null;
	private _workerProxy: Proxied<ITextMateTokenizationWorker> | null = null;
	private readonly _workerTokenizerControllers = new Map</* backgroundTokenizerId */number, TextMateWorkerTokenizerController>();

	private _currentTheme: IRawTheme | null = null;
	private _currentTokenColorMap: string[] | null = null;
	private _grammarDefinitions: IValidGrammarDefinition[] = [];

	constructor(
		private readonly _reportTokenizationTime: (timeMs: number, languageId: string, sourceExtensionId: string | undefined, lineLength: number, isRandomSample: boolean) => void,
		private readonly _shouldTokenizeAsync: () => boolean,
		@ITextMateAssets private readonly _assets: ITextMateAssets,
		@IConfigurationService private readonly _configurationService: IConfigurationService,
		@ILanguageService private readonly _languageService: ILanguageService,
		@INotificationService private readonly _notificationService: INotificationService,
		@ITelemetryService private readonly _telemetryService: ITelemetryService,
		@IWebWorkerService private readonly _webWorkerService: IWebWorkerService,
	) {
	}

	public dispose(): void {
		this._disposeWorker();
	}

	// Will be recreated after worker is disposed (because tokenizer is re-registered when languages change)
	public createBackgroundTokenizer(textModel: ITextModel, tokenStore: IBackgroundTokenizationStore, maxTokenizationLineLength: IObservable<number>): IBackgroundTokenizer | undefined {
		// fallback to default sync background tokenizer
		if (!this._shouldTokenizeAsync() || textModel.isTooLargeForSyncing()) { return undefined; }

		const store = new DisposableStore();
		const controllerContainer = this._getWorkerProxy().then((workerProxy) => {
			if (store.isDisposed || !workerProxy) { return undefined; }

			const controllerContainer = { controller: undefined as undefined | TextMateWorkerTokenizerController, worker: this._worker };
			store.add(keepAliveWhenAttached(textModel, () => {
				const controller = new TextMateWorkerTokenizerController(textModel, workerProxy, this._languageService.languageIdCodec, tokenStore, this._configurationService, maxTokenizationLineLength);
				controllerContainer.controller = controller;
				this._workerTokenizerControllers.set(controller.controllerId, controller);
				return toDisposable(() => {
					controllerContainer.controller = undefined;
					this._workerTokenizerControllers.delete(controller.controllerId);
					controller.dispose();
				});
			}));
			return controllerContainer;
		});

		return {
			dispose() {
				store.dispose();
			},
			requestTokens: async (startLineNumber, endLineNumberExclusive) => {
				const container = await controllerContainer;

				// If there is no controller, the model has been detached in the meantime.
				// Only request the proxy object if the worker is the same!
				if (container?.controller && container.worker === this._worker) {
					container.controller.requestTokens(startLineNumber, endLineNumberExclusive);
				}
			},
			reportMismatchingTokens: (lineNumber) => {
				if (ThreadedBackgroundTokenizerFactory._reportedMismatchingTokens) {
					return;
				}
				ThreadedBackgroundTokenizerFactory._reportedMismatchingTokens = true;

				this._notificationService.error({
					message: 'Async Tokenization Token Mismatch in line ' + lineNumber,
					name: 'Async Tokenization Token Mismatch',
				});

				this._telemetryService.publicLog2<{}, { owner: 'hediet'; comment: 'Used to see if async tokenization is bug-free' }>('asyncTokenizationMismatchingTokens', {});
			},
		};
	}

	public setGrammarDefinitions(grammarDefinitions: IValidGrammarDefinition[]): void {
		this._grammarDefinitions = grammarDefinitions;
		this._disposeWorker();
	}

	public acceptTheme(theme: IRawTheme, colorMap: string[]): void {
		this._currentTheme = theme;
		this._currentTokenColorMap = colorMap;
		if (this._currentTheme && this._currentTokenColorMap && this._workerProxy) {
			this._workerProxy.$acceptTheme(this._currentTheme, this._currentTokenColorMap);
		}
	}

	private _getWorkerProxy(): Promise<Proxied<ITextMateTokenizationWorker> | null> {
		if (!this._workerProxyPromise) {
			this._workerProxyPromise = this._createWorkerProxy();
		}
		return this._workerProxyPromise;
	}

	private async _createWorkerProxy(): Promise<Proxied<ITextMateTokenizationWorker> | null> {
		const createData: ICreateData = { grammarDefinitions: this._grammarDefinitions };
		const worker = this._worker = this._webWorkerService.createWorkerClient<ITextMateTokenizationWorker>(
			ThreadedBackgroundTokenizerFactory.workerDescriptor
		);
		TextMateWorkerHost.setChannel(worker, {
			$readFile: async (_resource: UriComponents): Promise<string> => {
				const resource = URI.revive(_resource);
				return this._assets.readGrammar(resource);
			},
			$setTokensAndStates: async (controllerId: number, versionId: number, tokens: Uint8Array, fontTokens: ISerializedAnnotation<IFontTokenOption>[], lineEndStateDeltas: StateDeltas[]): Promise<void> => {
				const controller = this._workerTokenizerControllers.get(controllerId);
				// When a model detaches, it is removed synchronously from the map.
				// However, the worker might still be sending tokens for that model,
				// so we ignore the event when there is no controller.
				if (controller) {
					controller.setTokensAndStates(controllerId, versionId, tokens, fontTokens, lineEndStateDeltas);
				}
			},
			$reportTokenizationTime: (timeMs: number, languageId: string, sourceExtensionId: string | undefined, lineLength: number, isRandomSample: boolean): void => {
				this._reportTokenizationTime(timeMs, languageId, sourceExtensionId, lineLength, isRandomSample);
			}
		});
		await worker.proxy.$init(createData);

		if (this._worker !== worker) {
			// disposed in the meantime
			return null;
		}
		this._workerProxy = worker.proxy;
		if (this._currentTheme && this._currentTokenColorMap) {
			this._workerProxy.$acceptTheme(this._currentTheme, this._currentTokenColorMap);
		}
		return worker.proxy;
	}

	private _disposeWorker(): void {
		for (const controller of this._workerTokenizerControllers.values()) {
			controller.dispose();
		}
		this._workerTokenizerControllers.clear();

		if (this._worker) {
			this._worker.dispose();
			this._worker = null;
		}
		this._workerProxy = null;
		this._workerProxyPromise = null;
	}
}

function keepAliveWhenAttached(textModel: ITextModel, factory: () => IDisposable): IDisposable {
	const disposableStore = new DisposableStore();
	const subStore = disposableStore.add(new DisposableStore());

	function checkAttached() {
		if (textModel.isAttachedToEditor()) {
			subStore.add(factory());
		} else {
			subStore.clear();
		}
	}

	checkAttached();
	disposableStore.add(textModel.onDidChangeAttached(() => {
		checkAttached();
	}));
	return disposableStore;
}
