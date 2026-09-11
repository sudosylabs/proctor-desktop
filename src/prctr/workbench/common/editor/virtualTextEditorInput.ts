import type { URI } from '../../../base/common/uri.js';
import type { IResolvedTextEditorModel } from '../../../editor/common/services/resolverService.js';
import { EditorInput } from './editorInput.js';

/** Workbench-owned virtual text resources resolve through a model owner, never a local file factory. */
export abstract class VirtualTextEditorInput extends EditorInput {
	abstract override get resource(): URI;
	abstract override resolve(): Promise<IResolvedTextEditorModel>;
}
