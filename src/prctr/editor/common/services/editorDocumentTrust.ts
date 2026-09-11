import type { Event } from '../../../base/common/event.js';
import { createDecorator } from '../../../platform/instantiation/common/instantiation.js';
import type { ITextModel } from '../model.js';

/** Presentation classification for Unicode highlighting; never grants execution or workspace authority. */
export const IEditorDocumentTrust = createDecorator<IEditorDocumentTrust>('editorDocumentTrust');
export interface IEditorDocumentTrust {
	readonly _serviceBrand: undefined;
	readonly onDidChangeTrust: Event<void>;
	isTrusted(model: ITextModel): boolean;
}
