/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import type { AccountResponse } from '../../../../platform/account/common/accountProtocol.js';
import type { ProctorIconId } from '../../../../platform/theme/common/proctorIcons.js';
import {
	PageConfirmation,
	type PageChangeWording,
	type PageConfirmationOptions
} from '../../../browser/authenticated/pages/pageConfirmation.js';
import { IPageFormatService } from '../../../browser/authenticated/pages/pageFormat.js';
import { IPagePaneContext } from '../../../browser/authenticated/pages/pagePaneContext.js';
import { IAccountFormatService } from '../accountFormat.js';

export interface AccountConfirmationOptions extends Omit<
	PageConfirmationOptions<AccountResponse>,
	'wording' | 'confirmIcon' | 'destructive' | 'run' | 'people'
> {
	/** The confirming action's icon; ending something by default. */
	readonly confirmIcon?: ProctorIconId;
	/** Performs the change once the person confirms. */
	readonly run: () => Promise<AccountResponse | 'busy'>;
}

/** How Account words a change's failure, or busy. */
export function accountChangeWording(
	format: IAccountFormatService
): PageChangeWording<AccountResponse> {
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

/** Confirms a destructive Account change: the shared confirmation, red, worded for Account. */
export class AccountConfirmation extends PageConfirmation<AccountResponse> {
	constructor(
		options: AccountConfirmationOptions,
		onDidClose: () => void,
		@IAccountFormatService format: IAccountFormatService,
		@IPageFormatService pageFormat: IPageFormatService,
		@IPagePaneContext pane: IPagePaneContext
	) {
		super(
			{
				...options,
				confirmIcon: options.confirmIcon ?? 'action.end',
				destructive: true,
				run: () => options.run(),
				wording: accountChangeWording(format)
			},
			onDidClose,
			pageFormat,
			pane
		);
	}
}
