/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { ButtonControl } from '../../../../base/browser/ui/button/buttonControl.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import type { AccountResponse } from '../../../../platform/account/common/accountProtocol.js';
import { failureNeedsRead } from '../common/accountPresentation.js';
import { AccountDialog } from './accountDialog.js';
import { AccountFeedback } from './accountFeedback.js';
import type { AccountPageServices } from './accountPageServices.js';

export interface AccountConfirmationOptions {
	readonly title: string;
	readonly message: string;
	readonly confirmLabel: string;
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
	private readonly dialog: AccountDialog;
	private readonly cancel: ButtonControl;
	private readonly confirm: ButtonControl;
	private readonly feedback: AccountFeedback;
	private working = false;

	constructor(
		private readonly services: AccountPageServices,
		private readonly options: AccountConfirmationOptions,
		private readonly onDidClose: () => void
	) {
		super();
		this.dialog = this._register(
			new AccountDialog(
				services.document,
				services.overlays,
				{ title: options.title, description: options.message, role: 'alertdialog' },
				services.focusPage
			)
		);
		this.feedback = this._register(new AccountFeedback(this.dialog.body));
		this.cancel = this._register(
			new ButtonControl(this.dialog.actions, {
				variant: 'secondary',
				label: services.text('cancel')
			})
		);
		this.confirm = this._register(
			new ButtonControl(this.dialog.actions, {
				variant: 'danger',
				label: options.confirmLabel
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
		this.cancel.setState({ label: this.services.text('cancel'), disabled: true });
		this.confirm.setState({ label: this.options.confirmLabel, busy: true });
		const result = await this.options.run();
		if (this._store.isDisposed) return;
		this.working = false;
		if (result !== 'busy' && (result.kind !== 'error' || failureNeedsRead(result.reason))) {
			this.dispose();
			this.options.onDidComplete(result);
			return;
		}
		this.cancel.setState({ label: this.services.text('cancel') });
		this.confirm.setState({ label: this.options.confirmLabel });
		this.feedback.set(
			result === 'busy' ? this.services.text('busy') : this.services.failure(result.reason),
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
