/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
// @proctor-vscode-port settings-editor-model-host

import { CancellationToken, CancellationTokenSource } from '../../../../base/common/cancellation.js';
import { Disposable, IDisposable, toDisposable } from '../../../../base/common/lifecycle.js';
import { LinkedList } from '../../../../base/common/linkedList.js';
import { ResourceMap } from '../../../../base/common/map.js';
import { URI } from '../../../../base/common/uri.js';
import { ICodeEditor } from '../../../../editor/browser/editorBrowser.js';
import { IBulkEditOptions, IBulkEditPreviewHandler, IBulkEditResult, IBulkEditService, ResourceEdit, ResourceTextEdit } from '../../../../editor/browser/services/bulkEditService.js';
import { ICodeEditorService } from '../../../../editor/browser/services/codeEditorService.js';
import { WorkspaceEdit } from '../../../../editor/common/languages.js';
import { localize } from '../../../../base/common/vscodeNls.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { IProgress, IProgressStep, Progress } from '../../../../platform/progress/common/progress.js';
import { UndoRedoGroup, UndoRedoSource } from '../../../../platform/undoRedo/common/undoRedo.js';
import { BulkTextEdits } from './bulkTextEdits.js';
import { TextModelEditSource } from '../../../../editor/common/textModelEditSource.js';

function liftEdits(edits: ResourceEdit[]): ResourceEdit[] {
	return edits.map(edit => {
		if (ResourceTextEdit.is(edit)) {
			return ResourceTextEdit.lift(edit);
		}
		throw new Error('Unsupported edit');
	});
}

class BulkEdit {

	constructor(
		private readonly _label: string | undefined,
		private readonly _code: string | undefined,
		private readonly _editor: ICodeEditor | undefined,
		private readonly _progress: IProgress<IProgressStep>,
		private readonly _token: CancellationToken,
		private readonly _edits: ResourceEdit[],
		private readonly _undoRedoGroup: UndoRedoGroup,
		private readonly _undoRedoSource: UndoRedoSource | undefined,

		@IInstantiationService private readonly _instaService: IInstantiationService,
		@ILogService private readonly _logService: ILogService,
	) {

	}

	ariaMessage(): string {

		const textEditResources = new ResourceMap<boolean>();
		let textEditCount = 0;
		for (const edit of this._edits) {
			if (edit instanceof ResourceTextEdit) {
				textEditCount += 1;
				textEditResources.set(edit.resource, true);
			}
		}
		if (this._edits.length === 0) {
			return localize('summary.0', "Made no edits");
		} else {
			if (textEditCount > 1 && textEditResources.size > 1) {
				return localize('summary.nm', "Made {0} text edits in {1} files", textEditCount, textEditResources.size);
			} else {
				return localize('summary.n0', "Made {0} text edits in one file", textEditCount);
			}
		}
	}

	async perform(reason?: TextModelEditSource): Promise<readonly URI[]> {

		if (this._edits.length === 0) {
			return [];
		}

		const ranges: number[] = [1];
		for (let i = 1; i < this._edits.length; i++) {
			if (Object.getPrototypeOf(this._edits[i - 1]) === Object.getPrototypeOf(this._edits[i])) {
				ranges[ranges.length - 1]++;
			} else {
				ranges.push(1);
			}
		}

		// Show infinte progress when there is only 1 item since we do not know how long it takes
		const increment = this._edits.length > 1 ? 0 : undefined;
		this._progress.report({ increment, total: 100 });
		// Increment by percentage points since progress API expects that
		const progress: IProgress<void> = { report: _ => this._progress.report({ increment: 100 / this._edits.length }) };

		const resources: (readonly URI[])[] = [];
		let index = 0;
		for (const range of ranges) {
			if (this._token.isCancellationRequested) {
				break;
			}
			const group = this._edits.slice(index, index + range);
			if (group[0] instanceof ResourceTextEdit) {
				resources.push(await this._performTextEdits(<ResourceTextEdit[]>group, this._undoRedoGroup, this._undoRedoSource, progress, reason));
			} else {
				throw new Error('Unsupported edit');
			}
			index = index + range;
		}

		return resources.flat();
	}

	private async _performTextEdits(edits: ResourceTextEdit[], undoRedoGroup: UndoRedoGroup, undoRedoSource: UndoRedoSource | undefined, progress: IProgress<void>, reason: TextModelEditSource | undefined): Promise<readonly URI[]> {
		this._logService.debug('_performTextEdits', edits.length);
		const model = this._instaService.createInstance(BulkTextEdits, this._label || localize('workspaceEdit', "Workspace Edit"), this._code || 'undoredo.workspaceEdit', this._editor, undoRedoGroup, undoRedoSource, progress, this._token, edits);
		return await model.apply(reason);
	}

}

export class BulkEditService extends Disposable implements IBulkEditService {

	declare readonly _serviceBrand: undefined;

	private readonly _activeUndoRedoGroups = new LinkedList<UndoRedoGroup>();
	private _previewHandler?: IBulkEditPreviewHandler;

	constructor(
		@IInstantiationService private readonly _instaService: IInstantiationService,
		@ILogService private readonly _logService: ILogService,
		@ICodeEditorService private readonly _editorService: ICodeEditorService,
	) { super(); }

	setPreviewHandler(handler: IBulkEditPreviewHandler): IDisposable {
		this._previewHandler = handler;
		return toDisposable(() => {
			if (this._previewHandler === handler) {
				this._previewHandler = undefined;
			}
		});
	}

	hasPreviewHandler(): boolean {
		return Boolean(this._previewHandler);
	}

	async apply(editsIn: ResourceEdit[] | WorkspaceEdit, options?: IBulkEditOptions): Promise<IBulkEditResult> {
		if (this._store.isDisposed) throw new Error('Settings editing is closed.');
		let edits = liftEdits(Array.isArray(editsIn) ? editsIn : editsIn.edits);

		if (edits.length === 0) {
			return { ariaSummary: localize('nothing', "Made no edits"), isApplied: false };
		}

		if (this._previewHandler && (options?.showPreview || edits.some(value => value.metadata?.needsConfirmation))) {
			edits = await this._previewHandler(edits, options);
		}

		if (this._store.isDisposed) throw new Error('Settings editing is closed.');
		edits = liftEdits(edits);
		const codeEditor = options?.editor ?? this._editorService.getActiveCodeEditor() ?? undefined;

		// undo-redo-group: if a group id is passed then try to find it
		// in the list of active edits. otherwise (or when not found)
		// create a separate undo-redo-group
		let undoRedoGroup: UndoRedoGroup | undefined;
		let undoRedoGroupRemove = () => { };
		if (typeof options?.undoRedoGroupId === 'number') {
			for (const candidate of this._activeUndoRedoGroups) {
				if (candidate.id === options.undoRedoGroupId) {
					undoRedoGroup = candidate;
					break;
				}
			}
		}
		if (!undoRedoGroup) {
			undoRedoGroup = new UndoRedoGroup();
			undoRedoGroupRemove = this._activeUndoRedoGroups.push(undoRedoGroup);
		}

		const cancellation = new CancellationTokenSource(options?.token);
		const cancellationOwner = this._register(toDisposable(() => cancellation.dispose(true)));
		const label = options?.quotableLabel || options?.label;
		try {
		const bulkEdit = this._instaService.createInstance(
			BulkEdit,
			label,
			options?.code,
			codeEditor,
			options?.progress ?? Progress.None,
			cancellation.token,
			edits,
			undoRedoGroup,
			options?.undoRedoSource
		);

			const resources = await bulkEdit.perform(options?.reason);
			return { ariaSummary: bulkEdit.ariaMessage(), isApplied: resources.length > 0 };
		} catch (err) {
			this._logService.error('Settings edit failed.');
			throw err;
		} finally {
			this._store.delete(cancellationOwner);
			undoRedoGroupRemove();
		}
	}

}
