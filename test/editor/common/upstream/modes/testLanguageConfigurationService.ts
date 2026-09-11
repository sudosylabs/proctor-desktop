/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
// @proctor-vscode-port editor-text-model
import { Emitter } from '../../../../../src/prctr/base/common/event.js';
import { Disposable, type IDisposable } from '../../../../../src/prctr/base/common/lifecycle.js';
import type { LanguageConfiguration } from '../../../../../src/prctr/editor/common/languages/languageConfiguration.js';
import { type ILanguageConfigurationService, LanguageConfigurationRegistry, LanguageConfigurationServiceChangeEvent, ResolvedLanguageConfiguration } from '../../../../../src/prctr/editor/common/languages/languageConfigurationRegistry.js';

export class TestLanguageConfigurationService extends Disposable implements ILanguageConfigurationService {
	_serviceBrand: undefined;

	private readonly _registry = this._register(new LanguageConfigurationRegistry());

	private readonly _onDidChange = this._register(new Emitter<LanguageConfigurationServiceChangeEvent>());
	public readonly onDidChange = this._onDidChange.event;

	constructor() {
		super();
		this._register(this._registry.onDidChange((e) => this._onDidChange.fire(new LanguageConfigurationServiceChangeEvent(e.languageId))));
	}

	register(languageId: string, configuration: LanguageConfiguration, priority?: number): IDisposable {
		return this._registry.register(languageId, configuration, priority);
	}

	getLanguageConfiguration(languageId: string): ResolvedLanguageConfiguration {
		return this._registry.getLanguageConfiguration(languageId) ??
			new ResolvedLanguageConfiguration('unknown', {});
	}
}
