/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
// @proctor-vscode-port settings-editor-presentation

import type { Event } from '../../../../../../base/common/event.js';
import { derived, type IObservable } from '../../../../../../base/common/observable.js';
import { setTimeout0 } from '../../../../../../base/common/platform.js';
import { type InlineCompletionsModel, isSuggestionInViewport } from '../../model/inlineCompletionsModel.js';
import type { InlineSuggestHint } from '../../model/inlineSuggestionItem.js';
import type { InlineCompletionEditorType } from '../../model/provideInlineCompletions.js';
import type { InlineCompletionViewData, InlineCompletionViewKind, InlineEditTabAction } from './inlineEditsViewInterface.js';
import type { InlineEditWithChanges } from './inlineEditWithChanges.js';

/**
 * Warning: This is not per inline edit id and gets created often.
 * @deprecated TODO@hediet remove
*/
export class ModelPerInlineEdit {

	readonly editorType: InlineCompletionEditorType;

	readonly displayLocation: InlineSuggestHint | undefined;


	/** Determines if the inline suggestion is fully in the view port */
	readonly inViewPort: IObservable<boolean>;

	readonly onDidAccept: Event<void>;

	constructor(
		private readonly _model: InlineCompletionsModel,
		readonly inlineEdit: InlineEditWithChanges,
		readonly tabAction: IObservable<InlineEditTabAction>,
	) {
		this.editorType = this._model.editorType;

		this.displayLocation = this.inlineEdit.inlineCompletion.hint;

		this.inViewPort = derived(this, reader => isSuggestionInViewport(this._model.editor, this.inlineEdit.inlineCompletion, reader));
		this.onDidAccept = this._model.onDidAccept;
	}

	accept(alternativeAction?: boolean) {
		this._model.accept(undefined, alternativeAction);
	}

	handleInlineEditShownNextFrame(viewKind: InlineCompletionViewKind, viewData: InlineCompletionViewData) {
		const item = this.inlineEdit.inlineCompletion;
		const timeWhenShown = Date.now();
		item.addRef();
		setTimeout0(() => {
			this._model.handleInlineSuggestionShown(item, viewKind, viewData, timeWhenShown);
			item.removeRef();
		});
	}
}
