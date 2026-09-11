import { tokenCustomizationSchemas } from '../../../../platform/theme/common/tokenCustomizationSchemas.generated.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { SETTINGS_DOCUMENT_LIMITS } from '../../../../platform/settings/common/settingsDocument.js';
import { settingsSchema } from '../../../../platform/settings/common/settingsSchema.generated.js';
import { settingsRegistry } from '../../../../platform/settings/common/settingsRegistry.js';
import { settingDefault } from '../../../../platform/settings/common/settingsDefaults.js';
import type { ITextModel } from '../../../../editor/common/model.js';
import { PackagedJsonSchemas } from '../../../../editor/common/languages/json/packagedJsonSchemas.js';
import { JsonLanguageClient, PackagedJsonWorkerFactory } from '../../../../editor/browser/languages/json/jsonLanguageClient.js';
import { JsonLanguageFeatures } from '../../../../editor/browser/languages/json/jsonLanguageFeatures.js';
import { SettingsJsonDiagnostics } from './settingsJsonDiagnostics.js';

import { FormattingConflicts } from '../../../../editor/contrib/format/browser/format.js';

/** One working document owns its worker mirror, packaged providers and diagnostics. */
export class SettingsJsonLanguageServices extends Disposable {
	private readonly client: JsonLanguageClient;
	private readonly features: JsonLanguageFeatures;
	readonly onDidFail;
	constructor(model: ITextModel, document: Document, @IInstantiationService instantiation: IInstantiationService) {
		super();
		try {
			const schemaUri = 'prctr-schema://settings/document';
			const properties = Object.fromEntries(Object.entries(settingsSchema.properties).map(([id, schema]) => {
				const declaration = settingsRegistry.declaration(id);
				return [id, declaration?.platformDefaults ? { ...schema, default: settingDefault(declaration) } : schema];
			}));
			const schemas = new PackagedJsonSchemas(new Map([[schemaUri, JSON.stringify({ ...settingsSchema, properties })], ...Object.entries(tokenCustomizationSchemas).map(([uri, schema]): [string, string] => [uri, JSON.stringify(schema)])]));
			this.client = this._register(new JsonLanguageClient(model, schemas, schemaUri, new PackagedJsonWorkerFactory(document), SETTINGS_DOCUMENT_LIMITS));
			this.onDidFail = this.client.onDidFail;
			this.features = this._register(instantiation.createInstance(JsonLanguageFeatures, this.client));
			this._register(instantiation.createInstance(SettingsJsonDiagnostics, this.features));
			// X-01: the packaged JSON provider is the only admitted formatter; no extension picker or preference is exposed.
			this._register(FormattingConflicts.setFormatterSelector(async (formatters, candidate) => {
				if (candidate !== model || model.isDisposed()) return undefined;
				if (formatters.length !== 1 || formatters[0]?.extensionId?.value !== 'prctr.json')
					throw new Error('Settings requires its packaged JSON formatter.');
				return formatters[0];
			}));
		} catch (error) { this.dispose(); throw error; }
	}
	validate(): Promise<void> { return this.features.validate(); }
}
