/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// @proctor-vscode-port settings-token-customization
import * as nls from '../../../base/common/vscodeNls.js';
import type { IJSONSchema } from '../../../base/common/jsonSchema.js';
import type { IConfigurationPropertySchema } from '../../configuration/common/configurationRegistry.js';
import { textmateColorsSchemaId, textmateColorGroupSchemaId, textmateColorSchema } from './colorThemeSchema.js';
import { tokenStylingSchemaId, getTokenClassificationRegistry } from './tokenClassificationRegistry.js';
import { BUNDLED_THEMES } from './bundledThemes.js';
function formatSettingAsLink(str: string) { return `\`#${str}#\``; }
function tokenGroupSettings(description: string): IJSONSchema {
	return {
		description,
		$ref: textmateColorGroupSchemaId
	};
}

const themeSpecificSettingKey = '^\\[[^\\]]*(\\]\\s*\\[[^\\]]*)*\\]$';

const tokenColorSchema: IJSONSchema = {
	type: 'object',
	properties: {
		comments: tokenGroupSettings(nls.localize('editorColors.comments', "Sets the colors and styles for comments")),
		strings: tokenGroupSettings(nls.localize('editorColors.strings', "Sets the colors and styles for strings literals.")),
		keywords: tokenGroupSettings(nls.localize('editorColors.keywords', "Sets the colors and styles for keywords.")),
		numbers: tokenGroupSettings(nls.localize('editorColors.numbers', "Sets the colors and styles for number literals.")),
		types: tokenGroupSettings(nls.localize('editorColors.types', "Sets the colors and styles for type declarations and references.")),
		functions: tokenGroupSettings(nls.localize('editorColors.functions', "Sets the colors and styles for functions declarations and references.")),
		variables: tokenGroupSettings(nls.localize('editorColors.variables', "Sets the colors and styles for variables declarations and references.")),
		textMateRules: {
			description: nls.localize('editorColors.textMateRules', 'Sets colors and styles using textmate theming rules (advanced).'),
			$ref: textmateColorsSchemaId
		},
		semanticHighlighting: {
			description: nls.localize('editorColors.semanticHighlighting', 'Whether semantic highlighting should be enabled for this theme.'),
			deprecationMessage: nls.localize('editorColors.semanticHighlighting.deprecationMessage', 'Use `enabled` in `editor.semanticTokenColorCustomizations` setting instead.'),
			markdownDeprecationMessage: nls.localize({ key: 'editorColors.semanticHighlighting.deprecationMessageMarkdown', comment: ['{0} will become a link to another setting.'] }, 'Use `enabled` in {0} setting instead.', formatSettingAsLink('editor.semanticTokenColorCustomizations')),
			type: 'boolean'
		}
	},
	additionalProperties: false
};

const tokenColorCustomizationSchema: IConfigurationPropertySchema = {
	description: nls.localize('editorColors', "Overrides editor syntax colors and font style from the currently selected color theme."),
	default: {},
	allOf: [{ ...tokenColorSchema, patternProperties: { '^\\[': {} } }]
};

const semanticTokenColorSchema: IJSONSchema = {
	type: 'object',
	properties: {
		enabled: {
			type: 'boolean',
			description: nls.localize('editorColors.semanticHighlighting.enabled', 'Whether semantic highlighting is enabled or disabled for this theme'),
			suggestSortText: '0_enabled'
		},
		rules: {
			$ref: tokenStylingSchemaId,
			description: nls.localize('editorColors.semanticHighlighting.rules', 'Semantic token styling rules for this theme.'),
			suggestSortText: '0_rules'
		}
	},
	additionalProperties: false
};

const semanticTokenColorCustomizationSchema: IConfigurationPropertySchema = {
	description: nls.localize('semanticTokenColors', "Overrides editor semantic token color and styles from the currently selected color theme."),
	default: {},
	allOf: [{ ...semanticTokenColorSchema, patternProperties: { '^\\[': {} } }]
};


/** The original theme-specific schema update, supplied only the immutable packaged catalog. */
export function getTokenCustomizationSchemas(): Readonly<Record<string, IJSONSchema>> {
 const themeSpecificTokenColors: IJSONSchema = { properties: {} };
 const themeSpecificSemanticTokenColors: IJSONSchema = { properties: {} };
 const tokenColors = { properties: tokenColorSchema.properties, additionalProperties: false };
 for (const theme of BUNDLED_THEMES) {
  const themeId = '[' + theme.name + ']';
  themeSpecificTokenColors.properties![themeId] = tokenColors;
  themeSpecificSemanticTokenColors.properties![themeId] = semanticTokenColorSchema;
 }
 themeSpecificTokenColors.patternProperties = { [themeSpecificSettingKey]: tokenColors };
 themeSpecificSemanticTokenColors.patternProperties = { [themeSpecificSettingKey]: semanticTokenColorSchema };
 tokenColorCustomizationSchema.allOf![1] = themeSpecificTokenColors;
 semanticTokenColorCustomizationSchema.allOf![1] = themeSpecificSemanticTokenColors;
 return {
  [textmateColorsSchemaId]: textmateColorSchema,
  [tokenStylingSchemaId]: getTokenClassificationRegistry().getTokenStylingSchema(),
  'vscode://schemas/token-customizations': { type: 'object', ...tokenColorCustomizationSchema },
  'vscode://schemas/semantic-token-customizations': { type: 'object', ...semanticTokenColorCustomizationSchema }
 };
}
