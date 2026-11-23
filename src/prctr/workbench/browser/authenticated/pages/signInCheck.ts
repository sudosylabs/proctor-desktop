/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { createElementFactory } from '../../../../base/browser/documentElements.js';
import { ButtonControl } from '../../../../base/browser/ui/button/buttonControl.js';
import { Disposable, MutableDisposable } from '../../../../base/common/lifecycle.js';
import {
	strongSignInStep,
	type SignInStanding
} from '../../../../platform/identity/common/signInStanding.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import {
	createProctorIcon,
	proctorIconFactory
} from '../../../../platform/theme/browser/proctorIcon.js';
import { ConfirmItsYouDialog, type ReauthenticationPort } from './confirmItsYouDialog.js';
import { PageDialog } from './pageDialog.js';
import { IPageFormatService } from './pageFormat.js';
import { IPagePaneContext } from './pagePaneContext.js';

const OPEN_ICON = proctorIconFactory('action.openExternal');

/** What a sign-in check needs from the area that owns the change. */
export interface SignInCheckPort extends ReauthenticationPort {
	/** How the current sign-in stands; undefined when it can't be read now. */
	standing(): Promise<SignInStanding | undefined>;
	/** Opens the institution's security page in the system browser. */
	openSecurity(): Promise<void>;
}

/** What the server asked of the sign-in before it would make a change. */
export type SignInRequirement = 'recent' | 'twoStep';

/**
 * The one way Administration and Account meet a change the institution guards. Before a form for
 * a change that needs a two-step sign-in, {@link beforeTwoStep} explains what is missing instead
 * of letting the person fill it in for nothing. After a refusal, {@link resolve} opens Confirm
 * it's you, or explains why it can't help, and says whether to send the change again. The server
 * decides every request; the standing only chooses what to show.
 */
export class SignInCheck extends Disposable {
	private readonly dialog = this._register(new MutableDisposable());

	constructor(
		private readonly port: SignInCheckPort,
		@IInstantiationService private readonly instantiationService: IInstantiationService
	) {
		super();
	}

	/**
	 * Whether a change that needs a two-step sign-in can start. False after explaining that the
	 * account needs two-step verification first, or that this installation doesn't offer it.
	 * A standing that can't be read lets the change start; the server still decides.
	 */
	async beforeTwoStep(): Promise<boolean> {
		const standing = await this.port.standing();
		if (this._store.isDisposed) return false;
		const step = standing === undefined ? 'ready' : strongSignInStep(standing);
		if (step !== 'turnOn' && step !== 'unavailable') return true;
		await this.explain(step);
		return false;
	}

	/** After the server refused a change: true when the sign-in is now fit to send it again. */
	async resolve(requirement: SignInRequirement, summary: readonly string[]): Promise<boolean> {
		const standing = await this.port.standing();
		if (this._store.isDisposed) return false;
		if (requirement === 'twoStep' && standing !== undefined) {
			const step = strongSignInStep(standing);
			if (step === 'turnOn' || step === 'unavailable') {
				await this.explain(step);
				return false;
			}
		}
		const confirmed = await new Promise<boolean>((resolve) => {
			this.dialog.value = this.instantiationService.createInstance(
				ConfirmItsYouDialog,
				summary,
				standing,
				resolve,
				this.port
			);
		});
		return confirmed && !this._store.isDisposed;
	}

	private explain(step: 'turnOn' | 'unavailable'): Promise<void> {
		return new Promise<void>((resolve) => {
			this.dialog.value = this.instantiationService.createInstance(
				TwoStepDialog,
				step,
				resolve,
				() => this.port.openSecurity()
			);
		});
	}
}

/**
 * Says why a change that needs a two-step sign-in can't go on: the account has no two-step
 * verification yet (with the security page as the way on), or this installation doesn't offer
 * it (with Close only). Nothing failed, so it uses the ordinary tone.
 */
export class TwoStepDialog extends Disposable {
	private finished = false;

	constructor(
		step: 'turnOn' | 'unavailable',
		private readonly onDidFinish: () => void,
		openSecurity: () => Promise<void>,
		@IPageFormatService private readonly format: IPageFormatService,
		@IPagePaneContext private readonly pane: IPagePaneContext
	) {
		super();
		const $ = createElementFactory(this.pane.document);
		const turnOn = step === 'turnOn';
		const dialog = this._register(
			new PageDialog(this.pane, {
				title: this.format.text(turnOn ? 'twoStepNeededTitle' : 'twoStepUnavailableTitle'),
				description: turnOn
					? this.format.text('twoStepNeededBody')
					: this.format.institutionText(
							'twoStepUnavailableBody',
							'twoStepUnavailableBodyGeneric'
						),
				size: turnOn ? 'medium' : 'small'
			})
		);
		if (turnOn)
			dialog.body.append(
				$(
					'dl.prctr-page-two-step-steps',
					{},
					$('dt', { textContent: this.format.text('twoStepNeededFirstLabel') }),
					$('dd', {
						textContent: this.format.institutionText(
							'twoStepNeededFirst',
							'twoStepNeededFirstGeneric'
						)
					}),
					$('dt', { textContent: this.format.text('twoStepNeededThenLabel') }),
					$('dd', { textContent: this.format.text('twoStepNeededThen') })
				)
			);
		else
			dialog.body.append(
				$(
					'p.prctr-page-two-step-note',
					{ role: 'status' },
					this._register(
						createProctorIcon(this.pane.document, { id: 'status.info', size: 16 })
					).element,
					$('span', {
						textContent: this.format.institutionText(
							'twoStepUnavailableNote',
							'twoStepUnavailableNoteGeneric'
						)
					})
				)
			);
		const close = this._register(
			new ButtonControl(dialog.actions, {
				variant: 'secondary',
				label: this.format.text(turnOn ? 'cancel' : 'closeDialog')
			})
		);
		this._register(close.onDidRequest(() => this.finish()));
		this._register(dialog.onDidRequestCancel(() => this.finish()));
		if (turnOn) {
			const open = this._register(
				new ButtonControl(dialog.actions, {
					variant: 'brand',
					label: this.format.text('twoStepNeededOpen'),
					icon: OPEN_ICON
				})
			);
			this._register(
				open.onDidRequest(() => {
					void openSecurity().catch(() => undefined);
					this.finish();
				})
			);
			dialog.show(open.element);
		} else dialog.show(close.element);
	}

	private finish(): void {
		if (this.finished) return;
		this.finished = true;
		this.dispose();
		this.onDidFinish();
	}
}
