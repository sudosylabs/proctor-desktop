/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { SyncDescriptor } from '../../../../platform/instantiation/common/descriptors.js';
import { Event } from '../../../../base/common/event.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import type {
	AccountData,
	AccountIntent,
	AccountResponse
} from '../../../../platform/account/common/accountProtocol.js';
import { IClipboardService } from '../../../../platform/clipboard/common/clipboardService.js';
import { SETTINGS_MANIFEST } from '../../../../platform/settings/common/settingsManifest.js';
import type { WorkbenchContributionRegistration } from '../../../browser/bootstrap.js';
import {
	IWorkbenchItemResolverService,
	IWorkbenchPaneHostService,
	IWorkbenchShellService,
	IWorkbenchWindowService
} from '../../../browser/workbenchServices.js';
import type { WorkbenchItem } from '../../../common/workbenchItem.js';
import { IAccountService } from '../../../services/account/common/account.js';
import { ILocalizationService } from '../../../services/localization/common/localization.js';
import { IUserSettingsService } from '../../../services/settings/common/settingsRendererClient.js';
import { IAuthenticatedHoverService } from '../../authenticated/browser/authenticatedHover.js';
import {
	accountPages,
	IAuthenticatedNavigationService,
	type AccountPage
} from '../../authenticated/browser/authenticatedNavigation.js';
import { accountMessages as messages, type AccountMessage } from './accountMessages.js';
import { AccountPane, type AccountModel } from './accountPane.js';

const ACCOUNT_ITEM_TYPE = 'prctr.authenticated.account';

const pageTitles: Readonly<Record<AccountPage, AccountMessage>> = Object.freeze({
	profile: 'profileTitle',
	security: 'securityTitle',
	sessions: 'sessionsTitle',
	tokens: 'tokensTitle',
	history: 'historyTitle',
	settings: 'settingsTitle'
});

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
		@IWorkbenchWindowService windowService: IWorkbenchWindowService,
		@IWorkbenchShellService shell: IWorkbenchShellService,
		@IAuthenticatedHoverService hover: IAuthenticatedHoverService,
		@IClipboardService clipboard: IClipboardService,
		@IUserSettingsService settings: IUserSettingsService
	) {
		super();
		const binding = windowService.binding;
		if (binding.kind !== 'authenticated') {
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
					return new AccountPane(document, {
						client: account,
						localization,
						binding,
						overlays: shell.overlayHost,
						settings,
						hooks: {
							signOut: () => navigation.signOut(),
							hover: (target, label) => hover.setupHover(target, label),
							writeClipboard: (text) => clipboard.writeText(text)
						}
					});
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
				this.navigation.setProductStatus(
					this.localization.format(messages.pageUnavailable)
				);
			}
		}
	}

	private watchCounts(): void {
		this.watchCount({ kind: 'read', section: 'sessions' }, (data) => {
			if (data.section === 'sessions') {
				this.navigation.setAccountCount(
					'sessions',
					data.sessions.filter((session) => !session.current).length
				);
			}
		});
		this.watchCount({ kind: 'read', section: 'tokens' }, (data) => {
			if (data.section === 'tokens') {
				this.navigation.setAccountCount(
					'tokens',
					data.tokens.filter((token) => token.revokedAt === undefined).length
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
	const title = localization.format(messages[pageTitles[page]]);
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
