/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
// @proctor-vscode-port settings-editor-json-navigation

import { URI } from '../../../../base/common/uri.js';
import { isObject } from '../../../../base/common/types.js';
import { CoreEditingCommands } from '../../../../editor/browser/coreCommands.js';
import { getCodeEditor, type ICodeEditor } from '../../../../editor/browser/editorBrowser.js';
import type { IPosition } from '../../../../editor/common/core/position.js';
import type { ITextModelService } from '../../../../editor/common/services/resolverService.js';
import { SuggestController } from '../../../../editor/contrib/suggest/browser/suggestController.js';
import { ConfigurationTarget, type IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { Extensions, getDefaultValue, type IConfigurationRegistry, OVERRIDE_PROPERTY_REGEX } from '../../../../platform/configuration/common/configurationRegistry.js';
import type { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { Registry } from '../../../../platform/registry/common/platform.js';
import type { IEditorPane } from '../../../common/editor.js';
import type { IPreferencesEditorModel, ISetting } from '../../preferences/common/preferences.js';
import { SettingsEditorModel } from '../../preferences/common/preferencesModels.js';
import type { SettingsWorkingCopy } from './settingsWorkingCopy.js';

/** PreferencesService's JSON reveal mechanics, bound to the current Settings working copy. */
export class SettingsJsonNavigation {
	constructor(
		private readonly configurationService: IConfigurationService,
		private readonly instantiationService: IInstantiationService,
		private readonly textModelResolverService: ITextModelService,
		private readonly copy: SettingsWorkingCopy,
		private readonly assertCurrent: () => void
	) {}
	async revealSetting(settingKey: string, edit: boolean, editor: IEditorPane, settingsResource: URI): Promise<void> {
		const codeEditor = editor ? getCodeEditor(editor.getControl()) : null;
		if (!codeEditor) {
			return;
		}
		const reference = await this.textModelResolverService.createModelReference(settingsResource);
		const settingsModel = new SettingsEditorModel(reference, ConfigurationTarget.USER_LOCAL);
		if (!settingsModel) {
			return;
		}
		try {
		this.assertCurrent();
		if (codeEditor.getModel() !== reference.object.textEditorModel) return;
		edit = edit && !this.copy.isReadonly && this.copy.draft.validation.valid;
		const position = await this.getPositionToReveal(settingKey, edit, settingsModel, codeEditor);
		this.assertCurrent();
		if (position) {
			codeEditor.setPosition(position);
			codeEditor.revealPositionNearTop(position);
			codeEditor.focus();
			if (edit) {
				SuggestController.get(codeEditor)?.triggerSuggest();
			}
		}
		} finally { settingsModel.dispose(); }
	}

	private async getPositionToReveal(settingKey: string, edit: boolean, settingsModel: IPreferencesEditorModel<ISetting>, codeEditor: ICodeEditor): Promise<IPosition | null> {
		const model = codeEditor.getModel();
		if (!model) {
			return null;
		}
		const schema = Registry.as<IConfigurationRegistry>(Extensions.Configuration).getConfigurationProperties()[settingKey];
		const isOverrideProperty = OVERRIDE_PROPERTY_REGEX.test(settingKey);
		if (!schema && !isOverrideProperty) {
			return null;
		}

		let position = null;
		const type = schema?.type ?? 'object' /* Type not defined or is an Override Identifier */;
		let setting = settingsModel.getPreference(settingKey);
		if (!setting && edit) {
			let defaultValue = (type === 'object' || type === 'array') ? this.configurationService.inspect(settingKey).defaultValue : getDefaultValue(type);
			defaultValue = defaultValue === undefined && isOverrideProperty ? {} : defaultValue;
			if (defaultValue !== undefined) {
				this.assertCurrent();
				this.copy.insertJsonSetting(settingKey, defaultValue);
				setting = settingsModel.getPreference(settingKey);
			}
		}

		if (setting) {
			if (edit) {
				if (isObject(setting.value) || Array.isArray(setting.value)) {
					position = { lineNumber: setting.valueRange.startLineNumber, column: setting.valueRange.startColumn + 1 };
					codeEditor.setPosition(position);
					await this.instantiationService.invokeFunction(accessor => {
						return CoreEditingCommands.LineBreakInsert.runEditorCommand(accessor, codeEditor, null);
					});
					this.assertCurrent();
					position = { lineNumber: position.lineNumber + 1, column: model.getLineMaxColumn(position.lineNumber + 1) };
					const firstNonWhiteSpaceColumn = model.getLineFirstNonWhitespaceColumn(position.lineNumber);
					if (firstNonWhiteSpaceColumn) {
						// Line has some text. Insert another new line.
						codeEditor.setPosition({ lineNumber: position.lineNumber, column: firstNonWhiteSpaceColumn });
						await this.instantiationService.invokeFunction(accessor => {
							return CoreEditingCommands.LineBreakInsert.runEditorCommand(accessor, codeEditor, null);
						});
						this.assertCurrent();
					position = { lineNumber: position.lineNumber, column: model.getLineMaxColumn(position.lineNumber) };
					}
				} else {
					position = { lineNumber: setting.valueRange.startLineNumber, column: setting.valueRange.endColumn };
				}
			} else {
				position = { lineNumber: setting.keyRange.startLineNumber, column: setting.keyRange.startColumn };
			}
		}

		return position;
	}
}
