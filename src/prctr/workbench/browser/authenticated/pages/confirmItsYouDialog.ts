/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { createElementFactory } from '../../../../base/browser/documentElements.js';
import { ButtonControl } from '../../../../base/browser/ui/button/buttonControl.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import {
	confirmAsksForCode,
	type SignInStanding
} from '../../../../platform/identity/common/signInStanding.js';
import { proctorIconFactory } from '../../../../platform/theme/browser/proctorIcon.js';
import { PageDialog } from './pageDialog.js';
import { PageFeedback } from './pageFeedback.js';
import { IPageFormatService } from './pageFormat.js';
import { IPagePaneContext } from './pagePaneContext.js';
import './media/confirmItsYouDialog.css';

const CONTINUE_ICON = proctorIconFactory('action.openExternal');

/** How a confirmation in the browser ended. */
export type ReauthenticationResult =
	| { readonly kind: 'confirmed' }
	| { readonly kind: 'cancelled' }
	/** It failed or could not start; the text says why. */
	| { readonly kind: 'failed'; readonly text: string };

/** The area's privileged way to confirm it is the person, and to stop a confirmation. */
export interface ReauthenticationPort {
	/** Opens the institution's page in the system browser and waits for it to finish. */
	confirm(): Promise<ReauthenticationResult>;
	/** Stops a confirmation still waiting for the browser; its `confirm` then resolves. */
	cancel(): void;
}

/**
 * Asks the person to confirm it is them before a change the institution guards, such as
 * creating an access token. Continue opens the institution's own page in the system browser,
 * where they sign in again with the method this session used, and with the authenticator code
 * when this sign-in hasn't used two-step verification yet; the change is then sent again by its
 * owner. Cancel stops a confirmation still waiting for the browser. Opened by {@link SignInCheck}.
 */
export class ConfirmItsYouDialog extends Disposable {
	private readonly dialog: PageDialog;
	private readonly feedback: PageFeedback;
	private readonly cancel: ButtonControl;
	private readonly confirm: ButtonControl;
	private waiting = false;
	private finished = false;

	constructor(
		/** What the guarded change will do, one line each, so the person knows what they confirm. */
		summary: readonly string[],
		/** How this sign-in stands, when it could be read; it names the way to sign in. */
		standing: SignInStanding | undefined,
		private readonly onDidFinish: (confirmed: boolean) => void,
		private readonly reauthentication: ReauthenticationPort,
		@IPageFormatService private readonly format: IPageFormatService,
		@IPagePaneContext private readonly pane: IPagePaneContext
	) {
		super();
		const $ = createElementFactory(this.pane.document);
		this.dialog = this._register(
			new PageDialog(this.pane, {
				title: this.format.text('confirmItsYouTitle'),
				description: [
					this.format.institutionText('confirmItsYouBody', 'confirmItsYouBodyGeneric'),
					this.format.text(confirmStep(standing)),
					this.format.text('confirmItsYouDone')
				].join(' '),
				size: 'medium'
			})
		);
		if (summary.length > 0)
			this.dialog.body.append(
				$(
					'div.prctr-page-confirm-summary',
					{},
					...summary.map((line, index) =>
						$(index === 0 ? 'strong' : 'span', { textContent: line })
					)
				)
			);
		this.feedback = this._register(new PageFeedback(this.dialog.body));
		this.dialog.setFootnote(this.format.text('confirmItsYouFootnote'));
		this.cancel = this._register(
			new ButtonControl(this.dialog.actions, {
				variant: 'secondary',
				label: this.format.text('cancel')
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
		const result = await this.reauthentication.confirm();
		if (this._store.isDisposed) return;
		this.setWaiting(false);
		if (result.kind !== 'failed') {
			this.finish(result.kind === 'confirmed');
			return;
		}
		this.feedback.set(result.text, 'error');
		this.confirm.focus();
	}

	/** Cancel while waiting stops the browser step; its reply then closes the dialog. */
	private stop(): void {
		if (this.waiting) {
			this.reauthentication.cancel();
			return;
		}
		this.finish(false);
	}

	private setWaiting(waiting: boolean): void {
		this.waiting = waiting;
		this.dialog.setFootnote(
			this.format.text(waiting ? 'confirmItsYouStopNote' : 'confirmItsYouFootnote')
		);
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

/** The sentence naming how to sign in: the Session's own method, and the code when it raises. */
function confirmStep(
	standing: SignInStanding | undefined
):
	| 'confirmItsYouStep'
	| 'confirmItsYouStepPassword'
	| 'confirmItsYouStepPasswordCode'
	| 'confirmItsYouStepProvider'
	| 'confirmItsYouStepProviderCode' {
	if (standing === undefined) return 'confirmItsYouStep';
	const code = confirmAsksForCode(standing);
	if (standing.method === 'password')
		return code ? 'confirmItsYouStepPasswordCode' : 'confirmItsYouStepPassword';
	return code ? 'confirmItsYouStepProviderCode' : 'confirmItsYouStepProvider';
}
