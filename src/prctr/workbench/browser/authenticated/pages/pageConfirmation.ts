/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { ButtonControl } from '../../../../base/browser/ui/button/buttonControl.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { proctorIconFactory } from '../../../../platform/theme/browser/proctorIcon.js';
import type { ProctorIconId } from '../../../../platform/theme/common/proctorIcons.js';
import { PageChips, type PageChip } from './pageChips.js';
import { PageDialog } from './pageDialog.js';
import { PageFeedback } from './pageFeedback.js';
import { IPageFormatService } from './pageFormat.js';
import { IPagePaneContext } from './pagePaneContext.js';

/** A change's reply as a page sees it: an answer, a closed failure, or busy. */
export type PageChangeResult<R> = R | 'busy';

/** A failure after which the page's data may be out of date, so it is read again. */
export function changeFailureNeedsRead(reason: string): boolean {
	return reason === 'unconfirmed' || reason === 'conflict' || reason === 'notFound';
}

/**
 * How a capability words a change's outcome. `describe` gives the sentence for a failure or for
 * busy, and nothing when there is nothing to say, such as a sign-in check the person stopped.
 */
export interface PageChangeWording<R> {
	describe(result: PageChangeResult<R>): string | undefined;
}

export interface PageConfirmationOptions<R extends { readonly kind: string }> {
	readonly title: string;
	readonly message: string;
	readonly confirmLabel: string;
	readonly confirmIcon: ProctorIconId;
	/** A change that ends or removes something is red; others use the brand colour. */
	readonly destructive: boolean;
	/**
	 * The people the change is for, as chips the person can remove before confirming; there is no
	 * field to add one. The button counts who is left.
	 */
	readonly people?: {
		readonly label: string;
		readonly chips: readonly PageChip[];
		removeLabel(chip: PageChip): string;
		confirmLabel(count: number): string;
	};
	/** Makes the change once the person confirms, for the people left when there are chips. */
	readonly run: (people: readonly string[]) => Promise<PageChangeResult<R>>;
	/**
	 * Receives the result once the dialog has closed: on success, or on a failure that needs
	 * the page read again. Other failures stay in the dialog.
	 */
	readonly onDidComplete: (result: R) => void;
	readonly wording: PageChangeWording<R>;
}

/**
 * Confirms one consequential change. Cancel has initial focus; the confirming button makes the
 * change and the dialog stays open, locked, until the server replies.
 */
export class PageConfirmation<R extends { readonly kind: string }> extends Disposable {
	private readonly dialog: PageDialog;
	private readonly cancel: ButtonControl;
	private readonly confirm: ButtonControl;
	private readonly feedback: PageFeedback;
	private readonly chips: PageChips | undefined;
	private working = false;

	constructor(
		private readonly options: PageConfirmationOptions<R>,
		private readonly onDidClose: () => void,
		@IPageFormatService private readonly format: IPageFormatService,
		@IPagePaneContext pane: IPagePaneContext
	) {
		super();
		this.dialog = this._register(
			new PageDialog(pane, {
				title: options.title,
				description: options.message,
				role: 'alertdialog'
			})
		);
		const people = options.people;
		if (people !== undefined) {
			const chips = this._register(
				new PageChips(this.dialog.body, {
					label: people.label,
					removeLabel: (chip) => people.removeLabel(chip)
				})
			);
			chips.set(people.chips);
			this.chips = chips;
			this._register(chips.onDidChange(() => this.setWorking(false)));
		}
		this.feedback = this._register(new PageFeedback(this.dialog.body));
		this.cancel = this._register(
			new ButtonControl(this.dialog.actions, {
				variant: 'secondary',
				label: this.format.text('cancel')
			})
		);
		this.confirm = this._register(
			new ButtonControl(this.dialog.actions, {
				variant: options.destructive ? 'danger' : 'brand',
				label: options.confirmLabel,
				icon: proctorIconFactory(options.confirmIcon)
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

	private setWorking(working: boolean): void {
		this.working = working;
		this.cancel.setState({ label: this.format.text('cancel'), disabled: working });
		const left = this.chips?.chips.length;
		this.confirm.setState({
			label:
				left === undefined
					? this.options.confirmLabel
					: this.options.people!.confirmLabel(left),
			busy: working,
			disabled: left === 0,
			icon: proctorIconFactory(this.options.confirmIcon)
		});
	}

	private async run(): Promise<void> {
		if (this.working) return;
		this.feedback.set();
		this.setWorking(true);
		const result = await this.options.run(this.chips?.chips.map((chip) => chip.id) ?? []);
		if (this._store.isDisposed) return;
		this.setWorking(false);
		if (result !== 'busy' && closesDialog(result)) {
			this.dispose();
			this.options.onDidComplete(result);
			return;
		}
		const sentence = this.options.wording.describe(result);
		if (sentence !== undefined) this.feedback.set(sentence, 'error');
		this.confirm.focus();
	}

	override dispose(): void {
		if (this._store.isDisposed) return;
		super.dispose();
		this.onDidClose();
	}
}

/** Success closes the dialog, and so does a failure after which the page must read again. */
function closesDialog(result: { readonly kind: string }): boolean {
	if (result.kind !== 'error') return true;
	return 'reason' in result && typeof result.reason === 'string'
		? changeFailureNeedsRead(result.reason)
		: false;
}
