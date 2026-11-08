/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { createElementFactory } from '../../../../base/browser/documentElements.js';
import { ButtonControl } from '../../../../base/browser/ui/button/buttonControl.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { proctorIconFactory } from '../../../../platform/theme/browser/proctorIcon.js';
import { IAccountService } from '../../../services/account/common/account.js';
import { IAccountFormatService } from '../accountFormat.js';
import { IAccountPaneContext } from '../accountPaneContext.js';
import { AccountDialog } from './accountDialog.js';
import { AccountFeedback } from './accountFeedback.js';
import './media/confirmItsYouDialog.css';

const CANCEL_ICON = proctorIconFactory('action.close');
const CONTINUE_ICON = proctorIconFactory('action.openExternal');

/**
 * Asks the person to confirm it is them before a change the institution guards, such as
 * creating an access token. Continue opens the institution's own page in the system browser,
 * where they sign in again with the method this session used; the change is then sent again by
 * its owner. Cancel stops a confirmation still waiting for the browser.
 */
export class ConfirmItsYouDialog extends Disposable {
	private readonly dialog: AccountDialog;
	private readonly feedback: AccountFeedback;
	private readonly cancel: ButtonControl;
	private readonly confirm: ButtonControl;
	private waiting = false;
	private finished = false;

	constructor(
		/** What the guarded change will do, one line each, so the person knows what they confirm. */
		summary: readonly string[],
		private readonly onDidFinish: (confirmed: boolean) => void,
		@IAccountService private readonly account: IAccountService,
		@IAccountFormatService private readonly format: IAccountFormatService,
		@IAccountPaneContext private readonly pane: IAccountPaneContext
	) {
		super();
		const $ = createElementFactory(this.pane.document);
		this.dialog = this._register(
			new AccountDialog(
				this.pane.document,
				this.pane.overlays,
				{
					title: this.format.text('confirmItsYouTitle'),
					description: this.format.institutionText(
						'confirmItsYouBody',
						'confirmItsYouBodyGeneric'
					),
					size: 'small'
				},
				this.pane.focusPage
			)
		);
		if (summary.length > 0)
			this.dialog.body.append(
				$(
					'div.prctr-account-confirm-summary',
					{},
					...summary.map((line, index) =>
						$(index === 0 ? 'strong' : 'span', { textContent: line })
					)
				)
			);
		this.feedback = this._register(new AccountFeedback(this.dialog.body));
		this.cancel = this._register(
			new ButtonControl(this.dialog.actions, {
				variant: 'secondary',
				label: this.format.text('cancel'),
				icon: CANCEL_ICON
			})
		);
		this.confirm = this._register(
			new ButtonControl(this.dialog.actions, {
				variant: 'brand',
				label: this.format.text('confirmItsYouContinue'),
				icon: CONTINUE_ICON
			})
		);
		this._register(this.confirm.onDidRequest(() => void this.continueInBrowser()));
		this._register(this.cancel.onDidRequest(() => this.stop()));
		this._register(this.dialog.onDidRequestCancel(() => this.stop()));
		this.dialog.show(this.confirm.element);
	}

	private async continueInBrowser(): Promise<void> {
		if (this.waiting) return;
		this.setWaiting(true);
		this.feedback.set(this.format.text('confirmItsYouWaiting'), 'loading');
		const result = await this.account.change({ kind: 'reauthenticate' });
		if (this._store.isDisposed) return;
		this.setWaiting(false);
		if (result !== 'busy' && result.kind === 'success') {
			this.finish(true);
			return;
		}
		if (result !== 'busy' && result.kind === 'error' && result.reason === 'cancelled') {
			this.finish(false);
			return;
		}
		this.feedback.set(
			result === 'busy'
				? this.format.text('busy')
				: this.format.failure(result.kind === 'error' ? result.reason : 'invalid'),
			'error'
		);
		this.confirm.focus();
	}

	/** Cancel while waiting stops the browser step; its reply then closes the dialog. */
	private stop(): void {
		if (this.waiting) {
			void this.account.request({ kind: 'cancelReauthentication' });
			return;
		}
		this.finish(false);
	}

	private setWaiting(waiting: boolean): void {
		this.waiting = waiting;
		this.confirm.setState({
			label: this.format.text(
				waiting ? 'confirmItsYouWaitingButton' : 'confirmItsYouContinue'
			),
			icon: CONTINUE_ICON,
			busy: waiting
		});
	}

	private finish(confirmed: boolean): void {
		if (this.finished) return;
		this.finished = true;
		this.dispose();
		this.onDidFinish(confirmed);
	}
}
