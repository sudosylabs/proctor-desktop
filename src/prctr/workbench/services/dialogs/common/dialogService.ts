/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
// @proctor-vscode-port settings-editor-runtime-services

import Severity from '../../../../base/common/severity.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import type { IAsyncPromptResult, IAsyncPromptResultWithCancel, IConfirmation, IConfirmationResult, IDialogService, IInput, IInputResult, IPrompt, IPromptResult, IPromptResultWithCancel, IPromptWithCustomCancel, IPromptWithDefaultCancel } from '../../../../platform/dialogs/common/dialogs.js';
import { DialogsModel } from '../../../common/dialogs.js';

export class DialogService extends Disposable implements IDialogService {

	declare readonly _serviceBrand: undefined;

	readonly model = this._register(new DialogsModel());

	readonly onWillShowDialog = this.model.onWillShowDialog;

	readonly onDidShowDialog = this.model.onDidShowDialog;

	async confirm(confirmation: IConfirmation): Promise<IConfirmationResult> {

		const handle = this.model.show({ confirmArgs: { confirmation } });

		return await handle.result as IConfirmationResult;
	}

	prompt<T>(prompt: IPromptWithCustomCancel<T>): Promise<IPromptResultWithCancel<T>>;
	prompt<T>(prompt: IPromptWithDefaultCancel<T>): Promise<IPromptResult<T>>;
	prompt<T>(prompt: IPrompt<T>): Promise<IPromptResult<T>>;
	async prompt<T>(prompt: IPrompt<T> | IPromptWithCustomCancel<T> | IPromptWithDefaultCancel<T>): Promise<IPromptResult<T> | IPromptResultWithCancel<T>> {

		const handle = this.model.show({ promptArgs: { prompt } });

		const dialogResult = await handle.result as IAsyncPromptResult<T> | IAsyncPromptResultWithCancel<T>;

		return {
			result: await dialogResult.result,
			checkboxChecked: dialogResult.checkboxChecked
		};
	}

	async input(input: IInput): Promise<IInputResult> {

		const handle = this.model.show({ inputArgs: { input } });

		return await handle.result as IInputResult;
	}

	async info(message: string, detail?: string): Promise<void> {
		await this.prompt({ type: Severity.Info, message, detail });
	}

	async warn(message: string, detail?: string): Promise<void> {
		await this.prompt({ type: Severity.Warning, message, detail });
	}

	async error(message: string, detail?: string): Promise<void> {
		await this.prompt({ type: Severity.Error, message, detail });
	}

	async about(): Promise<void> {

		const handle = this.model.show({});
		await handle.result;
	}
}

