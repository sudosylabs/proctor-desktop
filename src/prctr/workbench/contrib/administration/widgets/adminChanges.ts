/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import type {
	AdministrationChangeIntent,
	AdministrationResponse
} from '../../../../platform/administration/common/administrationProtocol.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import {
	SignInCheck,
	type SignInCheckPort,
	type SignInRequirement
} from '../../../browser/authenticated/pages/signInCheck.js';
import {
	PageConfirmation,
	type PageChangeWording,
	type PageConfirmationOptions
} from '../../../browser/authenticated/pages/pageConfirmation.js';
import { IPageFormatService } from '../../../browser/authenticated/pages/pageFormat.js';
import { IPagePaneContext } from '../../../browser/authenticated/pages/pagePaneContext.js';
import { IAccountService } from '../../../services/account/common/account.js';
import { IAdministrationService } from '../../../services/administration/common/administration.js';
import { IAdministrationFormatService } from '../administrationFormat.js';

export type AdminChangeResult = AdministrationResponse | 'busy';

/**
 * Sends Administration changes for one page. A change the institution guards with a recent
 * sign-in, or with a two-step one, goes through the shared {@link SignInCheck}: Confirm it's you,
 * then the change is sent again; cancelling ends it as cancelled. A change that needs two-step
 * verification the account doesn't have ends with the dialog that says so.
 */
export class AdminChanges extends Disposable {
	private readonly signIn: SignInCheck;

	constructor(
		@IAdministrationService private readonly administration: IAdministrationService,
		@IAccountService private readonly account: IAccountService,
		@IAdministrationFormatService private readonly format: IAdministrationFormatService,
		@IInstantiationService instantiationService: IInstantiationService
	) {
		super();
		this.signIn = this._register(
			instantiationService.createInstance(SignInCheck, this.signInPort())
		);
	}

	/** Sends one change; `summary` says what it does if the person must confirm it is them. */
	async send(
		intent: AdministrationChangeIntent,
		summary: readonly string[]
	): Promise<AdminChangeResult> {
		const result = await this.administration.change(intent);
		if (result === 'busy' || result.kind !== 'error') return result;
		const requirement =
			result.reason === 'reauthenticationRequired'
				? 'recent'
				: result.reason === 'strongRequired'
					? 'twoStep'
					: undefined;
		if (requirement === undefined) return result;
		const confirmed = await this.signIn.resolve(requirement, summary);
		if (this._store.isDisposed || !confirmed) return { kind: 'error', reason: 'cancelled' };
		return this.administration.change(intent);
	}

	/**
	 * Before a form for a change that needs a two-step sign-in: false after explaining that the
	 * account needs two-step verification first, or that this installation doesn't offer it.
	 */
	beforeTwoStep(): Promise<boolean> {
		return this.signIn.beforeTwoStep();
	}

	/**
	 * Runs the sign-in check a read was refused for, such as the keys; true when it is worth
	 * reading again.
	 */
	checkSignIn(requirement: SignInRequirement, summary: readonly string[]): Promise<boolean> {
		return this.signIn.resolve(requirement, summary);
	}

	/** A failure's sentence, or the busy notice. */
	describe(result: AdminChangeResult): string {
		if (result === 'busy') return this.format.text('busy');
		return result.kind === 'error' ? this.format.failure(result.reason) : '';
	}

	private signInPort(): SignInCheckPort {
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
			cancel: () => void this.administration.request({ kind: 'cancelReauthentication' }),
			standing: () => this.account.readSignIn(),
			openSecurity: async () => {
				await this.account.request({ kind: 'openSecurity' });
			}
		};
	}
}

export type AdminConfirmationOptions = Omit<
	PageConfirmationOptions<AdministrationResponse>,
	'wording'
>;

/** How Administration words a change's failure, or busy. */
export function administrationChangeWording(
	format: IAdministrationFormatService
): PageChangeWording<AdministrationResponse> {
	return {
		describe: (result) => {
			if (result === 'busy') return format.text('busy');
			if (result.kind !== 'error') return format.failure('invalid');
			// A Confirm it's you the person stopped leaves the change as it was, with nothing to say.
			return result.reason === 'cancelled' ? undefined : format.failure(result.reason);
		}
	};
}

/** Confirms one consequential Administration change: the shared confirmation, worded for it. */
export class AdminConfirmation extends PageConfirmation<AdministrationResponse> {
	constructor(
		options: AdminConfirmationOptions,
		onDidClose: () => void,
		@IAdministrationFormatService format: IAdministrationFormatService,
		@IPageFormatService pageFormat: IPageFormatService,
		@IPagePaneContext pane: IPagePaneContext
	) {
		super(
			{ ...options, wording: administrationChangeWording(format) },
			onDidClose,
			pageFormat,
			pane
		);
	}
}
