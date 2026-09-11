import { Disposable } from '../../../../base/common/lifecycle.js';
import { IConfigurationService, ConfigurationTarget } from '../../../../platform/configuration/common/configuration.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { DefaultSettings, Settings2EditorModel } from '../../preferences/common/preferencesModels.js';
import { commonlyUsedSettings } from './settingsEditorCatalog.js';

/** The window owns packaged defaults; each modal input owns its original Settings2EditorModel. */
export class SettingsEditorModels extends Disposable {
	private readonly defaults: DefaultSettings;
	constructor(
		@IConfigurationService configuration: IConfigurationService,
		@IInstantiationService private readonly instantiation: IInstantiationService
	) {
		super();
		this.defaults = this._register(new DefaultSettings([...commonlyUsedSettings], ConfigurationTarget.USER_LOCAL, configuration));
	}
	createGraphicalModel(): Settings2EditorModel { return this.instantiation.createInstance(Settings2EditorModel, this.defaults); }
	readDefaults(): string { return this.defaults.getContent(); }
}
