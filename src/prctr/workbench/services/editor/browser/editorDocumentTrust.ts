import { Event } from '../../../../base/common/event.js';
import type { URI } from '../../../../base/common/uri.js';
import type { ITextModel } from '../../../../editor/common/model.js';
import { IModelService } from '../../../../editor/common/services/model.js';
import type { IEditorDocumentTrust } from '../../../../editor/common/services/editorDocumentTrust.js';

/** Only the live, explicitly admitted account documents receive trusted-document presentation. */
export class EditorDocumentTrust implements IEditorDocumentTrust {
	declare readonly _serviceBrand: undefined;
	readonly onDidChangeTrust: Event<void>;
	private readonly resources: ReadonlySet<string>;
	constructor(
		resources: readonly URI[],
		@IModelService private readonly models: IModelService
	) {
		this.resources = new Set(resources.map((resource) => resource.toString()));
		this.onDidChangeTrust = Event.any(
			Event.map(models.onModelAdded, () => undefined),
			Event.map(models.onModelRemoved, () => undefined)
		);
	}
	isTrusted(model: ITextModel): boolean {
		return (
			!model.isDisposed() &&
			this.resources.has(model.uri.toString()) &&
			this.models.getModel(model.uri) === model
		);
	}
}
