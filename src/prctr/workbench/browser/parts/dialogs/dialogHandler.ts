/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
// @proctor-vscode-port settings-editor-runtime-services

import { raceCancellationError } from '../../../../base/common/async.js';
import { CancellationError } from '../../../../base/common/errors.js';
import { localize } from '../../../../base/common/vscodeNls.js';
import { CancellationTokenSource, type CancellationToken } from '../../../../base/common/cancellation.js';
import { type IConfirmation, type IConfirmationResult, type IInputResult, type ICheckbox, type IInputElement, type ICustomDialogOptions, type IInput, AbstractDialogHandler, type DialogType, type IPrompt, type IAsyncPromptResult } from '../../../../platform/dialogs/common/dialogs.js';
import type { IMarkdownString } from '../../../../base/common/htmlContent.js';
import { ILayoutService } from '../../../../platform/layout/browser/layoutService.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import Severity from '../../../../base/common/severity.js';
import { Dialog, DialogContentsAlignment, type IDialogResult } from '../../../../base/browser/ui/dialog/dialog.js';
import { DisposableStore, type IDisposable } from '../../../../base/common/lifecycle.js';
import { IKeybindingService } from '../../../../platform/keybinding/common/keybinding.js';
import { IClipboardService } from '../../../../platform/clipboard/common/clipboardService.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { IMarkdownRendererService, openLinkFromMarkdown } from '../../../../platform/markdown/browser/markdownRenderer.js';
import { IOpenerService } from '../../../../platform/opener/common/opener.js';
import { createWorkbenchDialogOptions } from './dialog.js';
import { IEditorWindowHost } from '../../../services/host/browser/editorWindowHost.js';

export class BrowserDialogHandler extends AbstractDialogHandler implements IDisposable {
	private readonly operations = new DisposableStore();
	private disposed = false;
	dispose(): void { this.disposed = true; this.operations.dispose(); }

	private static readonly ALLOWABLE_COMMANDS = new Set([
		'copy',
		'cut',
		'editor.action.selectAll',
		'editor.action.clipboardCopyAction',
		'editor.action.clipboardCutAction',
		'editor.action.clipboardPasteAction'
	]);

	constructor(
		@ILogService private readonly logService: ILogService,
		@ILayoutService private readonly layoutService: ILayoutService,
		@IKeybindingService private readonly keybindingService: IKeybindingService,
		@IInstantiationService instantiationService: IInstantiationService,
		@IClipboardService private readonly clipboardService: IClipboardService,
		@IOpenerService private readonly openerService: IOpenerService,
		@IMarkdownRendererService private readonly markdownRendererService: IMarkdownRendererService,
		@IEditorWindowHost private readonly hostService: IEditorWindowHost,
	) {
		super();
	}

	async prompt<T>(prompt: IPrompt<T>): Promise<IAsyncPromptResult<T>> {
		this.logService.trace('DialogService#prompt');

		const buttons = this.getPromptButtons(prompt);

		const { button, checkboxChecked } = await this.doShow(prompt.type, prompt.message, buttons, prompt.detail, prompt.cancelButton ? buttons.length - 1 : -1 /* Disabled */, prompt.checkbox, undefined, typeof prompt?.custom === 'object' ? prompt.custom : undefined, prompt.token);

		return this.getPromptResult(prompt, button, checkboxChecked);
	}

	async confirm(confirmation: IConfirmation): Promise<IConfirmationResult> {
		this.logService.trace('DialogService#confirm');

		const buttons = this.getConfirmationButtons(confirmation);

		const { button, checkboxChecked } = await this.doShow(confirmation.type ?? 'question', confirmation.message, buttons, confirmation.detail, buttons.length - 1, confirmation.checkbox, undefined, typeof confirmation?.custom === 'object' ? confirmation.custom : undefined, confirmation.token);

		return { confirmed: button === 0, checkboxChecked };
	}

	async input(input: IInput): Promise<IInputResult> {
		this.logService.trace('DialogService#input');

		const buttons = this.getInputButtons(input);

		const { button, checkboxChecked, values } = await this.doShow(input.type ?? 'question', input.message, buttons, input.detail, buttons.length - 1, input?.checkbox, input.inputs, typeof input.custom === 'object' ? input.custom : undefined, input.token);

		return { confirmed: button === 0, checkboxChecked, values };
	}

	async about(title: string, details: string, detailsToCopy: string): Promise<void> {

		const { button } = await this.doShow(
			Severity.Info,
			title,
			[
				localize({ key: 'copy', comment: ['&& denotes a mnemonic'] }, "&&Copy"),
				localize('ok', "OK")
			],
			details,
			1
		);

		if (button === 0) {
			this.clipboardService.writeText(detailsToCopy);
		}
	}

	/** Default link handler for Markdown rendered within a dialog, see {@link openLinkFromMarkdown}. */
	private defaultMarkdownActionHandler(link: string, mdStr: IMarkdownString): Promise<boolean> {
		return openLinkFromMarkdown(this.openerService, link, mdStr.isTrusted, true /* skip URL validation to prevent another dialog from showing which is unsupported */);
	}

	private async doShow(type: Severity | DialogType | undefined, message: string, buttons?: string[], detail?: string | IMarkdownString, cancelId?: number, checkbox?: ICheckbox, inputs?: IInputElement[], customOptions?: ICustomDialogOptions, token?: CancellationToken): Promise<IDialogResult> {
		if (this.disposed || token?.isCancellationRequested) throw new CancellationError();
		const dialogDisposables = this.operations.add(new DisposableStore());
		const cancellation = new CancellationTokenSource(token);
		dialogDisposables.add({ dispose: () => cancellation.dispose(true) });
		try {

		// A Markdown `detail` is rendered ahead of time into a plain element:
		// the base `Dialog` widget has no Markdown rendering capability of its
		// own (it lives below the platform layer), so it is handed the result
		// via `detailElement` instead of the raw `IMarkdownString`.
		const detailElement = typeof detail === 'object' ? dialogDisposables.add(this.markdownRendererService.render(detail, {
			actionHandler: (link, mdStr) => this.defaultMarkdownActionHandler(link, mdStr),
		})).element : undefined;

		const renderBody = customOptions ? (parent: HTMLElement) => {
			parent.classList.add(...(customOptions.classes || []));
			customOptions.markdownDetails?.forEach(markdownDetail => {
				const result = dialogDisposables.add(this.markdownRendererService.render(markdownDetail.markdown, {
					actionHandler: markdownDetail.actionHandler || ((link, mdStr) => this.defaultMarkdownActionHandler(link, mdStr)),
				}));
				parent.appendChild(result.element);
				result.element.classList.add(...(markdownDetail.classes || []));
			});
		} : undefined;

		const dialog = new Dialog(
			this.layoutService.activeContainer,
			message,
			buttons,
			createWorkbenchDialogOptions({
				detail: typeof detail === 'string' ? detail : undefined,
				detailElement,
				cancelId,
				type: this.getDialogType(type),
				renderBody,
				icon: customOptions?.icon,
				alignment: customOptions?.alignment === 'vertical' ? DialogContentsAlignment.Vertical : DialogContentsAlignment.Horizontal,
				disableCloseAction: customOptions?.disableCloseAction,
				buttonOptions: customOptions?.buttonDetails?.map(detail => ({ sublabel: detail })),
				checkboxLabel: checkbox?.label,
				checkboxChecked: checkbox?.checked,
				inputs
			}, this.keybindingService, this.layoutService, this.hostService, BrowserDialogHandler.ALLOWABLE_COMMANDS)
		);

		dialogDisposables.add(dialog);

		return await raceCancellationError(dialog.show(), cancellation.token);
		} finally {
			this.operations.delete(dialogDisposables);
		}
	}
}
