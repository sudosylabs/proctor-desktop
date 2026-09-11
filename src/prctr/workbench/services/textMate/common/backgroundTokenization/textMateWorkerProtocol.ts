/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
// @proctor-vscode-port settings-editor-textmate


import type { UriComponents } from '../../../../../base/common/uri.js';
import type { LanguageId } from '../../../../../platform/theme/common/encodedTokenAttributes.js';
import type { IModelChangedEvent } from '../../../../../editor/common/model/mirrorTextModel.js';
import type { IWebWorkerServerRequestHandler } from '../../../../../base/common/worker/webWorker.js';
import type { IValidEmbeddedLanguagesMap, IValidTokenTypeMap } from '../TMScopeRegistry.js';
import type { IRawTheme, StackDiff } from 'vscode-textmate';

export interface ICreateData {
	grammarDefinitions: IValidGrammarDefinitionDTO[];
}

export interface IValidGrammarDefinitionDTO {
	location: UriComponents;
	language?: string;
	scopeName: string;
	embeddedLanguages: IValidEmbeddedLanguagesMap;
	tokenTypes: IValidTokenTypeMap;
	injectTo?: string[];
	balancedBracketSelectors: string[];
	unbalancedBracketSelectors: string[];
	sourceExtensionId?: string;
}

export interface StateDeltas {
	startLineNumber: number;
	// null means the state for that line did not change
	stateDeltas: (StackDiff | null)[];
}

export interface IRawModelData {
	uri: UriComponents;
	versionId: number;
	lines: string[];
	EOL: string;
	languageId: string;
	encodedLanguageId: LanguageId;
	maxTokenizationLineLength: number;
	controllerId: number;
}

/** Complete renderer-facing protocol, shared without importing the worker implementation. */
export interface ITextMateTokenizationWorker extends IWebWorkerServerRequestHandler {
	$init(_createData: ICreateData): Promise<void>;
	$acceptNewModel(data: IRawModelData): void;
	$acceptModelChanged(controllerId: number, e: IModelChangedEvent): void;
	$retokenize(controllerId: number, startLineNumber: number, endLineNumberExclusive: number): void;
	$acceptModelLanguageChanged(controllerId: number, newLanguageId: string, newEncodedLanguageId: LanguageId): void;
	$acceptRemovedModel(controllerId: number): void;
	$acceptTheme(theme: IRawTheme, colorMap: string[]): Promise<void>;
	$acceptMaxTokenizationLineLength(controllerId: number, value: number): void;
}
