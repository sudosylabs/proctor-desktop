/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import type {
	AdministrationChangeIntent,
	AdministrationResponse
} from '../../../../platform/administration/common/administrationProtocol.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { PageChanges } from '../../../browser/authenticated/pages/pageChanges.js';
import {
	PageConfirmation,
	type PageChangeResult,
	type PageChangeWording,
	type PageConfirmationOptions
} from '../../../browser/authenticated/pages/pageConfirmation.js';
import { IPageFormatService } from '../../../browser/authenticated/pages/pageFormat.js';
import { IPagePaneContext } from '../../../browser/authenticated/pages/pagePaneContext.js';
import { IAccountService } from '../../../services/account/common/account.js';
import { IAdministrationService } from '../../../services/administration/common/administration.js';
import { IAdministrationFormatService } from '../administrationFormat.js';

export type AdminChangeResult = PageChangeResult<AdministrationResponse>;

/** Sends Administration changes for one page: the shared change runner, bound to Administration. */
export class AdminChanges extends PageChanges<AdministrationChangeIntent, AdministrationResponse> {
	constructor(
		@IAdministrationService administration: IAdministrationService,
		@IAccountService account: IAccountService,
		@IAdministrationFormatService format: IAdministrationFormatService,
		@IInstantiationService instantiationService: IInstantiationService
	) {
		super(
			{
				change: (intent) => administration.change(intent),
				requirement: (error) =>
					error.reason === 'reauthenticationRequired'
						? 'recent'
						: error.reason === 'strongRequired'
							? 'twoStep'
							: undefined,
				cancelled: () => ({ kind: 'error', reason: 'cancelled' }),
				reauthenticate: () => administration.change({ kind: 'reauthenticate' }),
				cancelReauthentication: () =>
					void administration.request({ kind: 'cancelReauthentication' }),
				standing: () => account.readSignIn(),
				openSecurity: async () => {
					await account.request({ kind: 'openSecurity' });
				},
				wording: administrationChangeWording(format)
			},
			instantiationService
		);
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
		},
		sentence: (result) => {
			if (result === 'busy') return format.text('busy');
			return format.failure(result.kind === 'error' ? result.reason : 'invalid');
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
