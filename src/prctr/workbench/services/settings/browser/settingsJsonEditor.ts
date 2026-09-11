import { Disposable } from '../../../../base/common/lifecycle.js';
import { CodeEditorWidget } from '../../../../editor/browser/widget/codeEditor/codeEditorWidget.js';
import type { IEditorConstructionOptions } from '../../../../editor/browser/config/editorConfiguration.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import type { SettingsModelDocument } from '../common/settingsModelDocument.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { localize } from '../../../../base/common/vscodeNls.js';

/** A view of the shared Settings document; it has no persistence or independent draft. */
export class SettingsJsonEditor extends Disposable {
	readonly control: CodeEditorWidget;

	constructor(
		container: HTMLElement,
		document: SettingsModelDocument,
		@IConfigurationService configuration: IConfigurationService,
		@IInstantiationService instantiation: IInstantiationService
	) {
		super();
		const readOptions = (): IEditorConstructionOptions => ({
			...configuration.getValue<IEditorConstructionOptions>('editor', { resource: document.model.uri, overrideIdentifier: document.model.getLanguageId() }),
			ariaLabel: localize('proctorSettingsJsonEditor', 'Settings JSON'),
			automaticLayout: true
		});
		this.control = this._register(instantiation.createInstance(CodeEditorWidget, container, readOptions(), {}));
		this.control.setModel(document.model);
		this._register(configuration.onDidChangeConfiguration(event => {
			if (event.affectsConfiguration('editor', { resource: document.model.uri, overrideIdentifier: document.model.getLanguageId() }))
				this.control.updateOptions(readOptions());
		}));

	}
}
