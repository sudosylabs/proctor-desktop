/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
// @proctor-vscode-port editor-text-model

import { DisposableStore, type IDisposable } from '../../../../src/prctr/base/common/lifecycle.js';
import type { URI } from '../../../../src/prctr/base/common/uri.js';
import type { BracketPairColorizationOptions, DefaultEndOfLine, ITextBufferFactory, ITextModelCreationOptions } from '../../../../src/prctr/editor/common/model.js';
import { TextModel } from '../../../../src/prctr/editor/common/model/textModel.js';
import { ILanguageConfigurationService } from '../../../../src/prctr/editor/common/languages/languageConfigurationRegistry.js';
import { ILanguageService } from '../../../../src/prctr/editor/common/languages/language.js';
import { LanguageService } from '../../../../src/prctr/editor/common/services/languageService.js';
import { ITextResourcePropertiesService } from '../../../../src/prctr/editor/common/services/textResourceConfiguration.js';
import { TestLanguageConfigurationService } from './modes/testLanguageConfigurationService.js';
import { IConfigurationService } from '../../../../src/prctr/platform/configuration/common/configuration.js';
import { TestConfigurationService } from '../../../platform/configuration/common/upstream/testConfigurationService.js';
import { IDialogService } from '../../../../src/prctr/platform/dialogs/common/dialogs.js';
import { TestDialogService } from '../../../platform/dialogs/common/upstream/testDialogService.js';
import type { IInstantiationService } from '../../../../src/prctr/platform/instantiation/common/instantiation.js';
import { ILogService, NullLogService } from '../../../../src/prctr/platform/log/common/log.js';
import { INotificationService } from '../../../../src/prctr/platform/notification/common/notification.js';
import { TestNotificationService } from '../../../platform/notification/common/upstream/testNotificationService.js';
import { IThemeService } from '../../../../src/prctr/platform/theme/common/themeService.js';
import { TestThemeService } from '../../../platform/theme/common/upstream/testThemeService.js';
import { IUndoRedoService } from '../../../../src/prctr/platform/undoRedo/common/undoRedo.js';
import { UndoRedoService } from '../../../../src/prctr/platform/undoRedo/common/undoRedoService.js';
import { TestTextResourcePropertiesService } from './services/testTextResourcePropertiesService.js';
import { IModelService } from '../../../../src/prctr/editor/common/services/model.js';
import { ModelService } from '../../../../src/prctr/editor/common/services/modelService.js';
import { createServices, type ServiceIdCtorPair, type TestInstantiationService } from '../../../platform/instantiation/common/upstream/instantiationServiceMock.js';
import { PLAINTEXT_LANGUAGE_ID } from '../../../../src/prctr/editor/common/languages/modesRegistry.js';
import { ILanguageFeatureDebounceService, LanguageFeatureDebounceService } from '../../../../src/prctr/editor/common/services/languageFeatureDebounce.js';
import { ILanguageFeaturesService } from '../../../../src/prctr/editor/common/services/languageFeatures.js';
import { LanguageFeaturesService } from '../../../../src/prctr/editor/common/services/languageFeaturesService.js';
import { IEnvironmentService } from '../../../../src/prctr/platform/environment/common/environment.js';
import { mock } from '../../../base/common/upstream/mock.js';
import { ITreeSitterLibraryService } from '../../../../src/prctr/editor/common/services/treeSitter/treeSitterLibraryService.js';
import { TestTreeSitterLibraryService } from './services/testTreeSitterLibraryService.js';

class TestTextModel extends TextModel {
	public registerDisposable(disposable: IDisposable): void {
		this._register(disposable);
	}
}

export function withEditorModel(text: string[], callback: (model: TextModel) => void): void {
	const model = createTextModel(text.join('\n'));
	callback(model);
	model.dispose();
}

export interface IRelaxedTextModelCreationOptions {
	tabSize?: number;
	indentSize?: number | 'tabSize';
	insertSpaces?: boolean;
	detectIndentation?: boolean;
	trimAutoWhitespace?: boolean;
	defaultEOL?: DefaultEndOfLine;
	isForSimpleWidget?: boolean;
	largeFileOptimizations?: boolean;
	bracketColorizationOptions?: BracketPairColorizationOptions;
}

function resolveOptions(_options: IRelaxedTextModelCreationOptions): ITextModelCreationOptions {
	const defaultOptions = TextModel.DEFAULT_CREATION_OPTIONS;
	return {
		tabSize: (typeof _options.tabSize === 'undefined' ? defaultOptions.tabSize : _options.tabSize),
		indentSize: (typeof _options.indentSize === 'undefined' ? defaultOptions.indentSize : _options.indentSize),
		insertSpaces: (typeof _options.insertSpaces === 'undefined' ? defaultOptions.insertSpaces : _options.insertSpaces),
		detectIndentation: (typeof _options.detectIndentation === 'undefined' ? defaultOptions.detectIndentation : _options.detectIndentation),
		trimAutoWhitespace: (typeof _options.trimAutoWhitespace === 'undefined' ? defaultOptions.trimAutoWhitespace : _options.trimAutoWhitespace),
		defaultEOL: (typeof _options.defaultEOL === 'undefined' ? defaultOptions.defaultEOL : _options.defaultEOL),
		isForSimpleWidget: (typeof _options.isForSimpleWidget === 'undefined' ? defaultOptions.isForSimpleWidget : _options.isForSimpleWidget),
		largeFileOptimizations: (typeof _options.largeFileOptimizations === 'undefined' ? defaultOptions.largeFileOptimizations : _options.largeFileOptimizations),
		bracketPairColorizationOptions: (typeof _options.bracketColorizationOptions === 'undefined' ? defaultOptions.bracketPairColorizationOptions : _options.bracketColorizationOptions),
	};
}

export function createTextModel(text: string | ITextBufferFactory, languageId: string | null = null, options: IRelaxedTextModelCreationOptions = TextModel.DEFAULT_CREATION_OPTIONS, uri: URI | null = null): TextModel {
	const disposables = new DisposableStore();
	const instantiationService = createModelServices(disposables);
	const model = instantiateTextModel(instantiationService, text, languageId, options, uri);
	model.registerDisposable(disposables);
	return model;
}

export function instantiateTextModel(instantiationService: IInstantiationService, text: string | ITextBufferFactory, languageId: string | null = null, _options: IRelaxedTextModelCreationOptions = TextModel.DEFAULT_CREATION_OPTIONS, uri: URI | null = null): TestTextModel {
	const options = resolveOptions(_options);
	return instantiationService.createInstance(TestTextModel, text, languageId || PLAINTEXT_LANGUAGE_ID, options, uri);
}

export function createModelServices(disposables: DisposableStore, services: ServiceIdCtorPair<any>[] = []): TestInstantiationService {
	return createServices(disposables, services.concat([
		[INotificationService, TestNotificationService],
		[IDialogService, TestDialogService],
		[IUndoRedoService, UndoRedoService],
		[ILanguageService, LanguageService],
		[ILanguageConfigurationService, TestLanguageConfigurationService],
		[IConfigurationService, TestConfigurationService],
		[ITextResourcePropertiesService, TestTextResourcePropertiesService],
		[IThemeService, TestThemeService],
		[ILogService, NullLogService],
		[IEnvironmentService, new class extends mock<IEnvironmentService>() {
			override isBuilt: boolean = true;
			override isExtensionDevelopment: boolean = false;
		}],
		[ILanguageFeatureDebounceService, LanguageFeatureDebounceService],
		[ILanguageFeaturesService, LanguageFeaturesService],
		[IModelService, ModelService],
		[IModelService, ModelService],
		[ITreeSitterLibraryService, TestTreeSitterLibraryService],
	]));
}
