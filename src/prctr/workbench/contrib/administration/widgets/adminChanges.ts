/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { ButtonControl } from '../../../../base/browser/ui/button/buttonControl.js';
import { Disposable, MutableDisposable } from '../../../../base/common/lifecycle.js';
import type {
	AdministrationChangeIntent,
	AdministrationResponse
} from '../../../../platform/administration/common/administrationProtocol.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { proctorIconFactory } from '../../../../platform/theme/browser/proctorIcon.js';
import type { ProctorIconId } from '../../../../platform/theme/common/proctorIcons.js';
import {
	ConfirmItsYouDialog,
	type ReauthenticationPort
} from '../../../browser/authenticated/pages/confirmItsYouDialog.js';
import { PageDialog } from '../../../browser/authenticated/pages/pageDialog.js';
import { PageFeedback } from '../../../browser/authenticated/pages/pageFeedback.js';
import { IPagePaneContext } from '../../../browser/authenticated/pages/pagePaneContext.js';
import { IAdministrationService } from '../../../services/administration/common/administration.js';
import { AdminChips, type AdminChip } from './adminChips.js';
import { IAdministrationFormatService } from '../administrationFormat.js';
import { administrationFailureNeedsRead } from '../common/administrationPresentation.js';

export type AdminChangeResult = AdministrationResponse | 'busy';

/**
 * Sends Administration changes for one page. A change the institution guards with a recent
 * sign-in first asks the person to confirm it is them, then is sent again; cancelling that
 * confirmation ends the change as cancelled.
 */
export class AdminChanges extends Disposable {
	private readonly confirmation = this._register(new MutableDisposable<ConfirmItsYouDialog>());

	constructor(
		@IAdministrationService private readonly administration: IAdministrationService,
		@IAdministrationFormatService private readonly format: IAdministrationFormatService,
		@IInstantiationService private readonly instantiationService: IInstantiationService
	) {
		super();
	}

	/** Sends one change; `summary` says what it does if the person must confirm it is them. */
	async send(
		intent: AdministrationChangeIntent,
		summary: readonly string[]
	): Promise<AdminChangeResult> {
		const result = await this.administration.change(intent);
		if (
			result === 'busy' ||
			result.kind !== 'error' ||
			result.reason !== 'reauthenticationRequired'
		)
			return result;
		const confirmed = await new Promise<boolean>((resolve) => {
			this.confirmation.value = this.instantiationService.createInstance(
				ConfirmItsYouDialog,
				summary,
				resolve,
				this.reauthentication()
			);
		});
		if (this._store.isDisposed) return { kind: 'error', reason: 'cancelled' };
		if (!confirmed) return { kind: 'error', reason: 'cancelled' };
		return this.administration.change(intent);
	}

	/** A failure's sentence, or the busy notice. */
	describe(result: AdminChangeResult): string {
		if (result === 'busy') return this.format.text('busy');
		return result.kind === 'error' ? this.format.failure(result.reason) : '';
	}

	private reauthentication(): ReauthenticationPort {
		return {
			confirm: async () => {
				const result = await this.administration.change({ kind: 'reauthenticate' });
				if (result === 'busy') return { kind: 'failed', text: this.format.text('busy') };
				if (result.kind === 'success') return { kind: 'confirmed' };
				if (result.kind === 'error' && result.reason === 'cancelled')
					return { kind: 'cancelled' };
				return {
					kind: 'failed',
					text: this.format.failure(result.kind === 'error' ? result.reason : 'invalid')
				};
			},
			cancel: () => void this.administration.request({ kind: 'cancelReauthentication' })
		};
	}
}

export interface AdminConfirmationOptions {
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
		readonly chips: readonly AdminChip[];
		removeLabel(chip: AdminChip): string;
		confirmLabel(count: number): string;
	};
	/** Makes the change once the person confirms, for the people left when there are chips. */
	readonly run: (people: readonly string[]) => Promise<AdminChangeResult>;
	/**
	 * Receives the result once the dialog has closed: on success, or on a failure that needs
	 * the list read again. Other failures stay in the dialog.
	 */
	readonly onDidComplete: (result: AdministrationResponse) => void;
}

/**
 * Confirms one consequential Administration change. Cancel has initial focus; the confirming
 * button makes the change and the dialog stays open, locked, until the server replies.
 */
export class AdminConfirmation extends Disposable {
	private readonly dialog: PageDialog;
	private readonly cancel: ButtonControl;
	private readonly confirm: ButtonControl;
	private readonly feedback: PageFeedback;
	private readonly chips: AdminChips | undefined;
	private working = false;

	constructor(
		private readonly options: AdminConfirmationOptions,
		private readonly onDidClose: () => void,
		@IAdministrationFormatService private readonly format: IAdministrationFormatService,
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
		const people = options.people;
		if (people !== undefined) {
			const chips = this._register(
				new AdminChips(this.dialog.body, {
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
		this._register(this.cancel.onDidRequest(() => this.close()));
		this._register(this.dialog.onDidRequestCancel(() => this.close()));
		this._register(this.confirm.onDidRequest(() => void this.run()));
		this.dialog.show(this.cancel.element);
	}

	private close(): void {
		if (this.working) return;
		this.dispose();
	}

	private setWorking(working: boolean): void {
		this.working = working;
		const icon = proctorIconFactory(this.options.confirmIcon);
		this.cancel.setState({
			label: this.format.text('cancel'),
			disabled: working
		});
		const left = this.chips?.chips.length;
		this.confirm.setState({
			label:
				left === undefined
					? this.options.confirmLabel
					: this.options.people!.confirmLabel(left),
			busy: working,
			disabled: left === 0,
			icon
		});
	}

	private async run(): Promise<void> {
		if (this.working) return;
		this.feedback.set();
		this.setWorking(true);
		const result = await this.options.run(this.chips?.chips.map((chip) => chip.id) ?? []);
		if (this._store.isDisposed) return;
		this.setWorking(false);
		if (
			result !== 'busy' &&
			(result.kind !== 'error' || administrationFailureNeedsRead(result.reason))
		) {
			this.dispose();
			this.options.onDidComplete(result);
			return;
		}
		if (result !== 'busy' && result.kind === 'error' && result.reason === 'cancelled') {
			this.confirm.focus();
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

	override dispose(): void {
		if (this._store.isDisposed) return;
		super.dispose();
		this.onDidClose();
	}
}
