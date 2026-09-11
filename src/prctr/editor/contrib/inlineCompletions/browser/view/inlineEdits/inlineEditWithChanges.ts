/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
// @proctor-vscode-port settings-editor-presentation

import { LineReplacement } from '../../../../../common/core/edits/lineEdit.js';
import type { TextEdit } from '../../../../../common/core/edits/textEdit.js';
import type { Position } from '../../../../../common/core/position.js';
import { LineRange } from '../../../../../common/core/ranges/lineRange.js';
import type { InlineCompletionCommand } from '../../../../../common/languages.js';
import type { InlineSuggestionAction, InlineSuggestionItem } from '../../model/inlineSuggestionItem.js';
import type { TextModelValueReference } from '../../model/textModelValueReference.js';

export class InlineEditWithChanges {
	// TODO@hediet: Move the next 3 fields into the action
	public get lineEdit(): LineReplacement {
		if (this.action?.kind === 'jumpTo') {
			return new LineReplacement(LineRange.ofLength(this.action.position.lineNumber, 0), []);
		} else if (this.action?.kind === 'edit') {
			return LineReplacement.fromSingleTextEdit(this.edit!.toReplacement(this.originalText), this.originalText);
		}

		return new LineReplacement(new LineRange(1, 1), []);
	}

	public get originalLineRange(): LineRange { return this.lineEdit.lineRange; }
	public get modifiedLineRange(): LineRange { return this.lineEdit.toLineEdit().getNewLineRanges()[0]; }

	public get displayRange(): LineRange {
		return this.originalText.lineRange.intersect(
			this.originalLineRange.join(
				LineRange.ofLength(this.originalLineRange.startLineNumber, this.lineEdit.newLines.length)
			)
		)!;
	}

	constructor(
		public readonly originalText: TextModelValueReference,
		public readonly action: InlineSuggestionAction | undefined,
		public readonly edit: TextEdit | undefined,
		public readonly cursorPosition: Position,
		public readonly multiCursorPositions: readonly Position[],
		public readonly commands: readonly InlineCompletionCommand[],
		public readonly inlineCompletion: InlineSuggestionItem,
	) {
	}
}
