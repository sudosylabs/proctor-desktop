/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import type {
	AccountData,
	AccountFailure,
	AccountReadSection,
	AccountResponse
} from '../../../../platform/account/common/accountProtocol.js';
import { PageRead } from '../../../browser/authenticated/pages/pageRead.js';
import { IAccountService } from '../../../services/account/common/account.js';
import { failureWithdrawsData } from '../common/accountPresentation.js';

export type AccountDataOf<S extends AccountReadSection> = Extract<AccountData, { section: S }>;

/** One account section's data as this page last confirmed it. */
export class AccountRead<S extends AccountReadSection> extends PageRead<
	AccountDataOf<S>,
	AccountFailure,
	AccountResponse
> {
	constructor(
		readonly section: S,
		@IAccountService account: IAccountService
	) {
		super({
			source: {
				request: () => account.request({ kind: 'read', section }),
				observe: (listener) => account.observe({ kind: 'read', section }, listener)
			},
			interpret: (response) => {
				if (response.kind === 'data' && response.data.section === section)
					return { kind: 'data', data: response.data as AccountDataOf<S> };
				return {
					kind: 'failure',
					reason: response.kind === 'error' ? response.reason : 'invalid'
				};
			},
			withdraws: failureWithdrawsData,
			timeout: 'unavailable'
		});
	}
}
