import type { ITextModel, ITextSnapshot } from '../../../../editor/common/model.js';
import type { IResolvedTextEditorModel } from '../../../../editor/common/services/resolverService.js';
import { EditorModel } from '../../../common/editor/editorModel.js';

/** A resolver reference never owns the working copy's source or undo history. */
export class SettingsResolvedTextModel extends EditorModel implements IResolvedTextEditorModel {
	constructor(
		readonly textEditorModel: ITextModel,
		private readonly readonlyState: () => boolean
	) {
		super();
		this._register(textEditorModel.onWillDispose(() => this.dispose()));
	}
	override isResolved(): boolean {
		return !this.isDisposed() && !this.textEditorModel.isDisposed();
	}
	override async resolve(): Promise<void> {
		if (!this.isResolved()) throw new Error('The Settings document is closed.');
	}
	createSnapshot(): ITextSnapshot {
		if (!this.isResolved()) throw new Error('The Settings document is closed.');
		return this.textEditorModel.createSnapshot(true);
	}
	isReadonly(): boolean {
		return this.readonlyState();
	}
	getLanguageId(): string | undefined {
		return this.isResolved() ? this.textEditorModel.getLanguageId() : undefined;
	}
	override dispose(): void {
		if (!this.isDisposed()) super.dispose();
	}
}
