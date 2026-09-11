/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
// @proctor-vscode-port settings-editor-modal-services

import * as nls from '../../../../base/common/vscodeNls.js';
import * as resources from '../../../../base/common/resources.js';
import type { URI } from '../../../../base/common/uri.js';
import Severity from '../../../../base/common/severity.js';
import { IDialogService, ConfirmResult, getFileNamesMessage } from '../../../../platform/dialogs/common/dialogs.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';

export const IEditorSaveConfirmation = createDecorator<IEditorSaveConfirmation>('editorSaveConfirmation');
export interface IEditorSaveConfirmation {
	readonly _serviceBrand: undefined;
	showSaveConfirm(names: (string | URI)[]): Promise<ConfirmResult>;
}
/** Original save confirmation, with no local file picker or extension-test bypass. */
export class EditorSaveConfirmation implements IEditorSaveConfirmation {
	declare readonly _serviceBrand: undefined;
	constructor(@IDialogService private readonly dialogService: IDialogService) {}
	async showSaveConfirm(fileNamesOrResources: (string | URI)[]): Promise<ConfirmResult> {
		if (fileNamesOrResources.length === 0) {
			return ConfirmResult.DONT_SAVE;
		}

		let message: string;
		let detail = nls.localize('saveChangesDetail', "Your changes will be lost if you don't save them.");
		if (fileNamesOrResources.length === 1) {
			message = nls.localize('saveChangesMessage', "Do you want to save the changes you made to {0}?", typeof fileNamesOrResources[0] === 'string' ? fileNamesOrResources[0] : resources.basename(fileNamesOrResources[0]));
		} else {
			message = nls.localize('saveChangesMessages', "Do you want to save the changes to the following {0} files?", fileNamesOrResources.length);
			detail = getFileNamesMessage(fileNamesOrResources) + '\n' + detail;
		}

		const { result } = await this.dialogService.prompt<ConfirmResult>({
			type: Severity.Warning,
			message,
			detail,
			buttons: [
				{
					label: fileNamesOrResources.length > 1 ?
						nls.localize({ key: 'saveAll', comment: ['&& denotes a mnemonic'] }, "&&Save All") :
						nls.localize({ key: 'save', comment: ['&& denotes a mnemonic'] }, "&&Save"),
					run: () => ConfirmResult.SAVE
				},
				{
					label: nls.localize({ key: 'dontSave', comment: ['&& denotes a mnemonic'] }, "Do&&n't Save"),
					run: () => ConfirmResult.DONT_SAVE
				}
			],
			cancelButton: {
				run: () => ConfirmResult.CANCEL
			}
		});

		return result;
	}

}
