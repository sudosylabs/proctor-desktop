import { colorCustomizationSchema } from '../../theme/common/colorCustomizations.js';
import { Registry } from '../../registry/common/platform.js';
import {
	ConfigurationScope,
	EditPresentationTypes,
	Extensions,
	type IConfigurationRegistry,
	type IConfigurationPropertySchema
} from '../../configuration/common/configurationRegistry.js';
import { settingsRegistry } from './settingsRegistry.js';
import { settingDefault } from './settingsDefaults.js';

let registered = false;

/** Only packaged Proctor declarations enter the upstream registry in application composition. */
export function registerSettingsConfiguration(): void {
	if (registered) return;
	const properties: Record<string, IConfigurationPropertySchema> = Object.create(null);
	for (const declaration of settingsRegistry.declarations) {
		if (declaration.candidate === 'prohibited') continue;
		properties[declaration.id] = {
			type: declaration.type,
			editPresentation: declaration.id === 'workbench.colorTheme' ? EditPresentationTypes.Json : undefined,
			...(declaration.id === 'workbench.colorCustomizations' ? colorCustomizationSchema : {}),
			...(declaration.id === 'editor.tokenColorCustomizations' ? { allOf: [{ $ref: 'prctr-schema://themes/token-customizations' }] } : {}),
			...(declaration.id === 'editor.semanticTokenColorCustomizations' ? { allOf: [{ $ref: 'prctr-schema://themes/semantic-token-customizations' }] } : {}),
			default: settingDefault(declaration),
			enum: declaration.enum === undefined ? undefined : [...declaration.enum],
			minimum: declaration.minimum,
			maximum: declaration.maximum,
			description: declaration.description.defaultMessage,
			scope: declaration.languageOverride
				? ConfigurationScope.LANGUAGE_OVERRIDABLE
				: ConfigurationScope.WINDOW
		};
	}
	Registry.as<IConfigurationRegistry>(Extensions.Configuration).registerConfiguration({
		id: 'proctor',
		type: 'object',
		properties
	});
	registered = true;
}
