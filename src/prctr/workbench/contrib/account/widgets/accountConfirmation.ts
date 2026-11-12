/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { IAccountFormatService } from '../accountFormat.js';
import { IPagePaneContext } from '../../../browser/authenticated/pages/pagePaneContext.js';
import { ButtonControl } from '../../../../base/browser/ui/button/buttonControl.js';
import { proctorIconFactory } from '../../../../platform/theme/browser/proctorIcon.js';
import type { ProctorIconId } from '../../../../platform/theme/common/proctorIcons.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import type { AccountResponse } from '../../../../platform/account/common/accountProtocol.js';
import { failureNeedsRead } from '../common/accountPresentation.js';
import { PageDialog } from '../../../browser/authenticated/pages/pageDialog.js';
import { PageFeedback } from '../../../browser/authenticated/pages/pageFeedback.js';

export interface AccountConfirmationOptions {
	readonly title: string;
	readonly message: string;
	readonly confirmLabel: string;
	/** The confirming action's icon; ending something by default. */
	readonly confirmIcon?: ProctorIconId;
	/** Performs the change once the person confirms. */
	readonly run: () => Promise<AccountResponse | 'busy'>;
	/**
	 * Receives the result once the dialog has closed: on success, or on a failure
	 * that needs the list read again. Other failures stay in the dialog.
	 */
	readonly onDidComplete: (result: AccountResponse) => void;
}

/**
 * Confirms a destructive change. Cancel has initial focus; the red button makes
 * the change and the dialog stays open, locked, until the server replies.
 */
export class AccountConfirmation extends Disposable {
	private readonly dialog: PageDialog;
	private readonly cancel: ButtonControl;
	private readonly confirm: ButtonControl;
	private readonly feedback: PageFeedback;
	private working = false;

	constructor(
		private readonly options: AccountConfirmationOptions,
		private readonly onDidClose: () => void,
		@IAccountFormatService private readonly format: IAccountFormatService,
		@IPagePaneContext private readonly pane: IPagePaneContext
	) {
		super();
		this.dialog = this._register(
			new PageDialog(this.pane, {
				title: options.title,
				description: options.message,
				role: 'alertdialog'
			})
		);
		this.feedback = this._register(new PageFeedback(this.dialog.body));
		this.cancel = this._register(
			new ButtonControl(this.dialog.actions, {
				variant: 'secondary',
				label: this.format.text('cancel')
			})
		);
		this.confirm = this._register(
			new ButtonControl(this.dialog.actions, {
				variant: 'danger',
				label: options.confirmLabel,
				icon: proctorIconFactory(options.confirmIcon ?? 'action.end')
			})
		);
		this.registerListeners();
		this.dialog.show(this.cancel.element);
	}

	private registerListeners(): void {
		this._register(this.cancel.onDidRequest(() => this.close()));
		this._register(this.dialog.onDidRequestCancel(() => this.close()));
		this._register(this.confirm.onDidRequest(() => void this.run()));
	}

	private close(): void {
		if (this.working) return;
		this.dispose();
	}

	private async run(): Promise<void> {
		if (this.working) return;
		this.working = true;
		this.feedback.set();
		this.cancel.setState({
			label: this.format.text('cancel'),
			disabled: true
		});
		const icon = proctorIconFactory(this.options.confirmIcon ?? 'action.end');
		this.confirm.setState({ label: this.options.confirmLabel, busy: true, icon });
		const result = await this.options.run();
		if (this._store.isDisposed) return;
		this.working = false;
		if (result !== 'busy' && (result.kind !== 'error' || failureNeedsRead(result.reason))) {
			this.dispose();
			this.options.onDidComplete(result);
			return;
		}
		this.cancel.setState({
			label: this.format.text('cancel')
		});
		this.confirm.setState({ label: this.options.confirmLabel, icon });
		this.feedback.set(
			result === 'busy' ? this.format.text('busy') : this.format.failure(result.reason),
			'error'
		);
		this.confirm.focus();
	}

	override dispose(): void {
		if (this._store.isDisposed) return;
		super.dispose();
		this.onDidClose();
	}
}
