/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import type {
	AccountIntent,
	AccountResponse
} from '../../../../platform/account/common/accountProtocol.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import {
	PageChanges,
	reauthenticationPort,
	type PageChangePort
} from '../../../browser/authenticated/pages/pageChanges.js';
import type { SignInCheckPort } from '../../../browser/authenticated/pages/signInCheck.js';
import { IAccountService } from '../../../services/account/common/account.js';
import { IAccountFormatService } from '../accountFormat.js';
import { accountChangeWording } from './accountConfirmation.js';

/** What Account lends the shared change runner. */
function accountChangePort(
	account: IAccountService,
	format: IAccountFormatService
): PageChangePort<AccountIntent, AccountResponse> {
	return {
		change: (intent) => account.change(intent),
		requirement: (error) =>
			error.reason === 'reauthenticationRequired'
				? 'recent'
				: error.reason === 'strongAuthenticationRequired'
					? 'twoStep'
					: undefined,
		cancelled: () => ({ kind: 'error', reason: 'cancelled' }),
		reauthenticate: () => account.change({ kind: 'reauthenticate' }),
		cancelReauthentication: () => void account.request({ kind: 'cancelReauthentication' }),
		standing: () => account.readSignIn(),
		openSecurity: async () => {
			await account.request({ kind: 'openSecurity' });
		},
		wording: accountChangeWording(format)
	};
}

/** Sends Account changes for one page: the shared change runner, bound to Account. */
export class AccountChanges extends PageChanges<AccountIntent, AccountResponse> {
	constructor(
		@IAccountService account: IAccountService,
		@IAccountFormatService format: IAccountFormatService,
		@IInstantiationService instantiationService: IInstantiationService
	) {
		super(accountChangePort(account, format), instantiationService);
	}
}

/** Account's sign-in checks, for a flow that runs Confirm it's you itself. */
export function accountSignInCheck(
	account: IAccountService,
	format: IAccountFormatService
): SignInCheckPort {
	const port = accountChangePort(account, format);
	return {
		...reauthenticationPort(port),
		standing: () => port.standing(),
		openSecurity: () => port.openSecurity()
	};
}
