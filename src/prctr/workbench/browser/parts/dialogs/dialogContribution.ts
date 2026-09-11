/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
// @proctor-vscode-port settings-editor-runtime-services

import { IDialogResult, IDialogService } from '../../../../platform/dialogs/common/dialogs.js';
import { IProductService } from '../../../../platform/product/common/productService.js';
import { IDialogsModel, IDialogViewItem } from '../../../common/dialogs.js';
import { BrowserDialogHandler } from './dialogHandler.js';
import { DialogService } from '../../../services/dialogs/common/dialogService.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { Lazy } from '../../../../base/common/lazy.js';
import { CancellationError } from '../../../../base/common/errors.js';
import { createBrowserAboutDialogDetails } from './dialog.js';

export class DialogHandlerContribution extends Disposable {

	static readonly ID = 'workbench.contrib.dialogHandler';

	private readonly model: IDialogsModel;
	private readonly impl: Lazy<BrowserDialogHandler>;

	private currentDialog: IDialogViewItem | undefined;
	private disposed = false;

	constructor(
		@IDialogService private dialogService: DialogService,
		@IInstantiationService instantiationService: IInstantiationService,
		@IProductService private productService: IProductService,
	) {
		super();

		this.impl = new Lazy(() => instantiationService.createInstance(BrowserDialogHandler));
		this.model = this.dialogService.model;

		this._register(this.model.onWillShowDialog(() => {
			if (!this.currentDialog) {
				this.processDialogs();
			}
		}));

		this.processDialogs();
	}

	private async processDialogs(): Promise<void> {
		while (!this.disposed && this.model.dialogs.length) {
			this.currentDialog = this.model.dialogs[0];

			let result: IDialogResult | Error | undefined = undefined;
			try {
				if (this.currentDialog.args.confirmArgs) {
					const args = this.currentDialog.args.confirmArgs;
					result = await this.impl.value.confirm(args.confirmation);
				} else if (this.currentDialog.args.inputArgs) {
					const args = this.currentDialog.args.inputArgs;
					result = await this.impl.value.input(args.input);
				} else if (this.currentDialog.args.promptArgs) {
					const args = this.currentDialog.args.promptArgs;
					result = await this.impl.value.prompt(args.prompt);
				} else {
					const aboutDialogDetails = createBrowserAboutDialogDetails(this.productService);
					await this.impl.value.about(aboutDialogDetails.title, aboutDialogDetails.details, aboutDialogDetails.detailsToCopy);
				}
			} catch (error) {
				result = error instanceof Error ? error : new Error('Dialog could not be shown');
			}

			this.currentDialog.close(result);
			this.currentDialog = undefined;
		}
	}
	override dispose(): void {
		if (this.disposed) return;
		this.disposed = true;
		if (this.impl.hasValue) this.impl.value.dispose();
		for (const dialog of [...this.model.dialogs]) dialog.close(new CancellationError());
		super.dispose();
	}
}
