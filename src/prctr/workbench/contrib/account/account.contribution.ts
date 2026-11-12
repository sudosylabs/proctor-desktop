/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { SyncDescriptor } from '../../../platform/instantiation/common/descriptors.js';
import { Event } from '../../../base/common/event.js';
import { Disposable } from '../../../base/common/lifecycle.js';
import { IInstantiationService } from '../../../platform/instantiation/common/instantiation.js';
import type {
	AccountData,
	AccountIntent,
	AccountResponse
} from '../../../platform/account/common/accountProtocol.js';
import { SETTINGS_MANIFEST } from '../../../platform/settings/common/settingsManifest.js';
import type { WorkbenchContributionRegistration } from '../../browser/bootstrap.js';
import {
	IWorkbenchItemResolverService,
	IWorkbenchPaneHostService,
	IWorkbenchWindowService
} from '../../browser/workbenchServices.js';
import type { WorkbenchItem } from '../../common/workbenchItem.js';
import { IAccountService } from '../../services/account/common/account.js';
import { ILocalizationService } from '../../services/localization/common/localization.js';
import {
	accountPages,
	IAuthenticatedNavigationService,
	type AccountPage
} from '../../services/authenticatedNavigation/common/authenticatedNavigation.js';
import { accountMessages as messages, accountText } from './accountMessages.js';
import { IAccountFormatService } from './accountFormat.js';
import { accountPageRegistry } from './accountPages.js';
import { tokenState } from './common/accountPresentation.js';
import { AccountPane, type AccountModel } from './accountPane.js';

const ACCOUNT_ITEM_TYPE = 'prctr.authenticated.account';

/** Account's pages in the content area, opened from the Account sidebar. */
class AccountContribution extends Disposable {
	private readonly items: Map<AccountPage, WorkbenchItem>;
	private disposed = false;
	private sequence = 0;

	constructor(
		@IAccountService private readonly account: IAccountService,
		@IAuthenticatedNavigationService
		private readonly navigation: IAuthenticatedNavigationService,
		@IWorkbenchPaneHostService private readonly host: IWorkbenchPaneHostService,
		@IWorkbenchItemResolverService registry: IWorkbenchItemResolverService,
		@ILocalizationService private readonly localization: ILocalizationService,
		@IAccountFormatService private readonly format: IAccountFormatService,
		@IWorkbenchWindowService windowService: IWorkbenchWindowService,
		@IInstantiationService instantiationService: IInstantiationService
	) {
		super();
		if (windowService.binding.kind !== 'authenticated') {
			throw new Error('Account requires an authenticated binding');
		}
		this.items = new Map(accountPages.map((page) => [page, accountItem(page, localization)]));
		const items = this.items;
		this._register(
			registry.register({
				typeId: ACCOUNT_ITEM_TYPE,
				async resolve(item): Promise<AccountModel> {
					const page = accountPages.find((candidate) => items.get(candidate) === item);
					if (!page) {
						throw new Error('Unknown account item');
					}
					return { item, page, dispose() {} };
				},
				createPane(document) {
					return instantiationService.createInstance(AccountPane, document);
				}
			})
		);
		this._register(navigation.onDidChange(() => this.show(true)));
		this._register(navigation.onDidChangeAccountPage(() => this.show(true)));
		this._register({
			dispose: () => {
				this.disposed = true;
				this.sequence++;
			}
		});
		this.show(false);
		this.watchCounts();
	}

	private show(focus: boolean): void {
		if (this.navigation.current === 'account') {
			void this.open(focus);
		} else {
			this.sequence++;
		}
	}

	private async open(focus: boolean): Promise<void> {
		const serial = ++this.sequence;
		const item = this.items.get(this.navigation.accountPage);
		try {
			const assigned = item !== undefined && (await this.host.assign(item));
			if (assigned && !this.disposed && serial === this.sequence && focus) {
				this.host.focus();
			}
		} catch {
			if (!this.disposed && serial === this.sequence) {
				this.navigation.setProductStatus({
					tone: 'problem',
					title: this.localization.format(messages.pageUnavailable)
				});
			}
		}
	}

	/** Access tokens counts the tokens a script can use now; at none the count is hidden. */
	private watchCounts(): void {
		this.watchCount({ kind: 'read', section: 'tokens' }, (data) => {
			if (data.section === 'tokens') {
				const now = this.format.now();
				this.navigation.setAccountCount(
					'tokens',
					data.tokens.filter((token) => tokenState(token, now) === 'active').length
				);
			}
		});
	}

	/** Follows one Account read for a sidebar count; a failure leaves the count as it was. */
	private watchCount(intent: AccountIntent, apply: (data: AccountData) => void): void {
		const deliver = (response: AccountResponse): void => {
			if (!this.disposed && response.kind === 'data') {
				apply(response.data);
			}
		};
		const subscription = this.account.observe(intent, deliver);
		if (subscription !== undefined) {
			this._register(subscription);
		} else {
			void this.account.request(intent).then(deliver, () => undefined);
		}
	}
}

export const accountContribution: WorkbenchContributionRegistration = Object.freeze({
	id: 'prctr.authenticated.account' as const,
	phase: 'ready' as const,
	dependencies: Object.freeze(['prctr.authenticated.navigation' as const]),
	messages: [
		...Object.values(messages),
		...SETTINGS_MANIFEST.flatMap((setting) => [setting.title, setting.description])
	],
	descriptor: new SyncDescriptor(AccountContribution)
});

function accountItem(page: AccountPage, localization: ILocalizationService): WorkbenchItem {
	const title = localization.format(accountText[accountPageRegistry[page].title]);
	return {
		typeId: ACCOUNT_ITEM_TYPE,
		logicalIdentity: page,
		presentation: { title, accessibleLabel: title },
		closable: false,
		restorable: false,
		onDidChangePresentation: Event.None,
		matches(other) {
			return other.typeId === this.typeId && other.logicalIdentity === this.logicalIdentity;
		}
	};
}
