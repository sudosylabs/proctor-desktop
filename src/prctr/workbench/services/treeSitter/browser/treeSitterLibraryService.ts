/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
// @proctor-vscode-port settings-editor-runtime-services


import type { Parser, Language, Query } from '@vscode/tree-sitter-wasm';
import { type IReader, ObservablePromise } from '../../../../base/common/observable.js';
import type { ITreeSitterLibraryService } from '../../../../editor/common/services/treeSitter/treeSitterLibraryService.js';
import { Lazy } from '../../../../base/common/lazy.js';
import { ITreeSitterAssets } from './treeSitterAssets.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { observableConfigValue } from '../../../../platform/observable/common/platformObservableUtils.js';
import { CachedFunction } from '../../../../base/common/cache.js';
import { Disposable } from '../../../../base/common/lifecycle.js';

export const EDITOR_EXPERIMENTAL_PREFER_TREESITTER = 'editor.experimental.preferTreeSitter';
export const TREESITTER_ALLOWED_SUPPORT = ['css', 'typescript', 'ini', 'regex'];

export class TreeSitterLibraryService extends Disposable implements ITreeSitterLibraryService {
	_serviceBrand: undefined;

	private readonly _treeSitterImport = new Lazy(() => this._assets.loadRuntime());

	private readonly _supportsLanguage = new CachedFunction((languageId: string) => {
		return observableConfigValue(`${EDITOR_EXPERIMENTAL_PREFER_TREESITTER}.${languageId}`, false, this._configurationService);
	});

	private readonly _languagesCache = new CachedFunction((languageId: string) => {
		return ObservablePromise.fromFn(async () => {
			const [treeSitter, languageFile] = await Promise.all([
				this._treeSitterImport.value,
				this._assets.loadGrammar(languageId)
			]);

			const Language = treeSitter.Language;
			const language = await Language.load(languageFile);
			return language;
		});
	});

	private readonly _injectionQueries = new CachedFunction({ getCacheKey: JSON.stringify }, (arg: { languageId: string; kind: 'injections' | 'highlights' }) => {
		const loadQuerySource = () => this._assets.loadQuery(arg.languageId, arg.kind);

		return ObservablePromise.fromFn(async () => {
			const [
				querySource,
				language,
				treeSitter
			] = await Promise.all([
				loadQuerySource(),
				this._languagesCache.get(arg.languageId).promise,
				this._treeSitterImport.value,
			]);

			if (querySource === undefined) {
				return null;
			}

			const Query = treeSitter.Query;
			return new Query(language, querySource);
		}).resolvedValue;
	});

	constructor(
		@IConfigurationService private readonly _configurationService: IConfigurationService,
		@ITreeSitterAssets private readonly _assets: ITreeSitterAssets,
	) {
		super();
	}

	supportsLanguage(languageId: string, reader: IReader | undefined): boolean {
		return this._supportsLanguage.get(languageId).read(reader);
	}

	async getParserClass(): Promise<typeof Parser> {
		const treeSitter = await this._treeSitterImport.value;
		return treeSitter.Parser;
	}

	getLanguage(languageId: string, ignoreSupportsCheck: boolean, reader: IReader | undefined): Language | undefined {
		if (!ignoreSupportsCheck && !this.supportsLanguage(languageId, reader)) {
			return undefined;
		}
		const lang = this._languagesCache.get(languageId).resolvedValue.read(reader);
		return lang;
	}

	async getLanguagePromise(languageId: string): Promise<Language | undefined> {
		return this._languagesCache.get(languageId).promise;
	}

	getInjectionQueries(languageId: string, reader: IReader | undefined): Query | null | undefined {
		if (!this.supportsLanguage(languageId, reader)) {
			return undefined;
		}
		const query = this._injectionQueries.get({ languageId, kind: 'injections' }).read(reader);
		return query;
	}

	getHighlightingQueries(languageId: string, reader: IReader | undefined): Query | null | undefined {
		if (!this.supportsLanguage(languageId, reader)) {
			return undefined;
		}
		const query = this._injectionQueries.get({ languageId, kind: 'highlights' }).read(reader);
		return query;
	}

	async createQuery(language: Language, querySource: string): Promise<Query> {
		const treeSitter = await this._treeSitterImport.value;
		return new treeSitter.Query(language, querySource);
	}
}

