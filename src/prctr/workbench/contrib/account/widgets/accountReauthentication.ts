/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import type {
	ReauthenticationPort,
	ReauthenticationResult
} from '../../../browser/authenticated/pages/confirmItsYouDialog.js';
import type { IAccountService } from '../../../services/account/common/account.js';
import type { IAccountFormatService } from '../accountFormat.js';

/** Confirms it is the person through the Account capability's browser reauthentication. */
export function accountReauthentication(
	account: IAccountService,
	format: IAccountFormatService
): ReauthenticationPort {
	return {
		async confirm(): Promise<ReauthenticationResult> {
			const result = await account.change({ kind: 'reauthenticate' });
			if (result === 'busy') return { kind: 'failed', text: format.text('busy') };
			if (result.kind === 'success') return { kind: 'confirmed' };
			if (result.kind === 'error' && result.reason === 'cancelled')
				return { kind: 'cancelled' };
			return {
				kind: 'failed',
				text: format.failure(result.kind === 'error' ? result.reason : 'invalid')
			};
		},
		cancel(): void {
			void account.request({ kind: 'cancelReauthentication' });
		}
	};
}
