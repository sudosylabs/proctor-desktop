/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
// @proctor-vscode-port editor-core

import type { Event } from '../../base/common/event.js';
import type { IDisposable } from '../../base/common/lifecycle.js';
import type { Position } from './core/position.js';
import type { IRange, Range } from './core/range.js';
import { TextChange } from './core/textChange.js';
import type { WordCharacterClassifier } from './core/wordCharacterClassifier.js';

export const enum EndOfLinePreference { TextDefined = 0, LF = 1, CRLF = 2 }
export const enum DefaultEndOfLine { LF = 1, CRLF = 2 }
export const enum EndOfLineSequence { LF = 0, CRLF = 1 }
export interface ISingleEditOperationIdentifier { major: number; minor: number }
export interface IIdentifiedSingleEditOperation { range: IRange; text: string | null; forceMoveMarkers?: boolean; identifier?: ISingleEditOperationIdentifier | null; isAutoWhitespaceEdit?: boolean; _isTracked?: boolean }
export interface IValidEditOperation { identifier: ISingleEditOperationIdentifier | null; range: Range; text: string; textChange: TextChange }
export class FindMatch { _findMatchBrand: void = undefined; constructor(public readonly range: Range, public readonly matches: string[] | null) {} }
export interface ITextSnapshot { read(): string | null }
export interface ITextBufferBuilder { acceptChunk(chunk: string): void; finish(): ITextBufferFactory }
export interface ITextBufferFactory { create(defaultEOL: DefaultEndOfLine): { textBuffer: ITextBuffer; disposable: IDisposable }; getFirstLineText(lengthLimit: number): string }
export class ValidAnnotatedEditOperation implements IIdentifiedSingleEditOperation {
	constructor(public readonly identifier: ISingleEditOperationIdentifier | null, public readonly range: Range, public readonly text: string | null, public readonly forceMoveMarkers: boolean, public readonly isAutoWhitespaceEdit: boolean, public readonly _isTracked: boolean) {}
}
export interface IReadonlyTextBuffer {
	readonly onDidChangeContent: Event<void>;
	equals(other: ITextBuffer): boolean; mightContainRTL(): boolean; mightContainUnusualLineTerminators(): boolean; resetMightContainUnusualLineTerminators(): void; mightContainNonBasicASCII(): boolean;
	getBOM(): string; getEOL(): string; getOffsetAt(lineNumber: number, column: number): number; getPositionAt(offset: number): Position; getRangeAt(offset: number, length: number): Range;
	getValueInRange(range: Range, eol: EndOfLinePreference): string; createSnapshot(preserveBOM: boolean): ITextSnapshot; getValueLengthInRange(range: Range, eol: EndOfLinePreference): number; getCharacterCountInRange(range: Range, eol: EndOfLinePreference): number;
	getLength(): number; getLineCount(): number; getLinesContent(): string[]; getLineContent(lineNumber: number): string; getLineCharCode(lineNumber: number, index: number): number; getCharCode(offset: number): number; getLineLength(lineNumber: number): number; getLineMinColumn(lineNumber: number): number; getLineMaxColumn(lineNumber: number): number; getLineFirstNonWhitespaceColumn(lineNumber: number): number; getLineLastNonWhitespaceColumn(lineNumber: number): number;
	findMatchesLineByLine(searchRange: Range, searchData: SearchData, captureMatches: boolean, limitResultCount: number): FindMatch[]; getNearestChunk(offset: number): string;
}
export class SearchData { constructor(public readonly regex: RegExp, public readonly wordSeparators: WordCharacterClassifier | null, public readonly simpleSearch: string | null) {} }
export interface ITextBuffer extends IReadonlyTextBuffer, IDisposable { setEOL(newEOL: '\r\n' | '\n'): void; applyEdits(rawOperations: ValidAnnotatedEditOperation[], recordTrimAutoWhitespace: boolean, computeUndoEdits: boolean): ApplyEditsResult }
export class ApplyEditsResult { constructor(public readonly reverseEdits: IValidEditOperation[] | null, public readonly changes: IInternalModelContentChange[], public readonly trimAutoWhitespaceLineNumbers: number[] | null) {} }
export interface IModelContentChange { readonly range: IRange; readonly rangeOffset: number; readonly rangeLength: number; readonly text: string }
export interface IInternalModelContentChange extends IModelContentChange { range: Range; forceMoveMarkers: boolean }
