/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { Event } from '../../../../base/common/event.js';
import type { DisposableStore } from '../../../../base/common/lifecycle.js';
import type {
	AccountClient,
	AccountData,
	AccountIntent,
	AccountResponse
} from '../../../../platform/account/common/accountProtocol.js';
import type { AuthenticatedWindowDescriptor } from '../../../../platform/windows/common/windowProtocol.js';
import type {
	WorkbenchBootstrapContext,
	WorkbenchContributionRegistration
} from '../../../browser/bootstrap.js';
import type { WorkbenchPaneHost } from '../../../browser/paneHost.js';
import type { WorkbenchItemResolverRegistry } from '../../../browser/workbenchPane.js';
import type { WorkbenchItem } from '../../../common/workbenchItem.js';
import { WORKBENCH_ITEM_RESOLVERS, WORKBENCH_PANE_HOST } from '../../../workbench.common.main.js';
import {
	accountPages,
	AUTHENTICATED_NAVIGATION_SERVICE,
	type AccountPage,
	type AuthenticatedNavigationService
} from '../../authenticated/browser/authenticatedNavigation.js';
import { accountMessages as messages, type AccountMessage } from './accountMessages.js';
import { AccountPane, type AccountModel } from './accountPane.js';
import { SETTINGS_MANIFEST } from '../../../../platform/settings/common/settingsManifest.js';
import type { SettingsRendererClient } from '../../../services/settings/common/settingsRendererClient.js';

const ACCOUNT_ITEM_TYPE = 'prctr.authenticated.account';

const pageTitles: Readonly<Record<AccountPage, AccountMessage>> = Object.freeze({
	profile: 'profileTitle',
	security: 'securityTitle',
	sessions: 'sessionsTitle',
	tokens: 'tokensTitle',
	history: 'historyTitle',
	settings: 'settingsTitle'
});

export interface AccountContributionOptions {
	/** Copies a new token's credential through the window's privileged clipboard. */
	readonly writeClipboard?: (text: string) => Promise<void>;
	/** The account's settings, edited on the Settings page. */
	readonly settings?: SettingsRendererClient;
}

/** Account's pages in the content area, opened from the Account sidebar. */
export function createAccountContribution(
	client: AccountClient,
	options: AccountContributionOptions = {}
): WorkbenchContributionRegistration {
	return Object.freeze({
		id: 'prctr.authenticated.account',
		phase: 'ready',
		dependencies: Object.freeze(['prctr.authenticated.navigation' as const]),
		messages: [
			...Object.values(messages),
			...SETTINGS_MANIFEST.flatMap((setting) => [setting.title, setting.description])
		],
		activate(context: WorkbenchBootstrapContext): void {
			const binding = context.getWindowBinding() as AuthenticatedWindowDescriptor;
			if (binding.kind !== 'authenticated')
				throw new Error('Account requires an authenticated binding');
			const navigation = context.getService<AuthenticatedNavigationService>(
				AUTHENTICATED_NAVIGATION_SERVICE
			);
			const host = context.getService<WorkbenchPaneHost>(WORKBENCH_PANE_HOST);
			const registry =
				context.getService<WorkbenchItemResolverRegistry>(WORKBENCH_ITEM_RESOLVERS);
			const customPhotos = new Set<string>();
			const items = new Map<AccountPage, WorkbenchItem>(
				accountPages.map((page) => [page, accountItem(page, context)])
			);
			context.disposables.add(
				registry.register({
					typeId: ACCOUNT_ITEM_TYPE,
					async resolve(item): Promise<AccountModel> {
						const page = accountPages.find(
							(candidate) => items.get(candidate) === item
						);
						if (!page) throw new Error('Unknown account item');
						return { item, page, dispose() {} };
					},
					createPane(document) {
						return new AccountPane(document, {
							client,
							localization: context.localization,
							binding,
							overlays: context.shell.overlayHost,
							customPhotos,
							...(options.settings === undefined
								? {}
								: { settings: options.settings }),
							hooks: {
								setProfilePhoto: (dataUrl) => navigation.setProfilePhoto(dataUrl),
								signOut: () => navigation.signOut(),
								...(options.writeClipboard === undefined
									? {}
									: { writeClipboard: options.writeClipboard })
							}
						});
					}
				})
			);
			let disposed = false;
			let sequence = 0;
			const open = async (focus: boolean): Promise<void> => {
				const serial = ++sequence;
				const item = items.get(navigation.accountPage);
				try {
					if (
						item &&
						(await host.assign(item)) &&
						!disposed &&
						serial === sequence &&
						focus
					)
						host.focus();
				} catch {
					if (!disposed && serial === sequence)
						navigation.setProductStatus(
							context.localization.format(messages.pageUnavailable)
						);
				}
			};
			const show = (focus: boolean): void => {
				if (navigation.current === 'account') void open(focus);
				else sequence++;
			};
			context.disposables.add(navigation.onDidChange(() => show(true)));
			context.disposables.add(navigation.onDidChangeAccountPage(() => show(true)));
			context.disposables.add({
				dispose() {
					disposed = true;
					sequence++;
				}
			});
			show(false);
			watchCount(
				client,
				{ kind: 'read', section: 'sessions' },
				context.disposables,
				(data) =>
					data.section === 'sessions'
						? navigation.setAccountCount(
								'sessions',
								data.sessions.filter((session) => !session.current).length
							)
						: undefined
			);
			watchCount(client, { kind: 'read', section: 'tokens' }, context.disposables, (data) =>
				data.section === 'tokens'
					? navigation.setAccountCount(
							'tokens',
							data.tokens.filter((token) => token.revokedAt === undefined).length
						)
					: undefined
			);
		}
	});
}

/** Follows one Account read for a sidebar count; a failure leaves the count as it was. */
function watchCount(
	client: AccountClient,
	intent: AccountIntent,
	disposables: DisposableStore,
	apply: (data: AccountData) => void
): void {
	let disposed = false;
	const deliver = (response: AccountResponse): void => {
		if (!disposed && response.kind === 'data') apply(response.data);
	};
	disposables.add({
		dispose() {
			disposed = true;
		}
	});
	const subscription = client.observe?.(intent, deliver);
	if (subscription !== undefined) disposables.add(subscription);
	else void client.request(intent).then(deliver, () => undefined);
}

function accountItem(page: AccountPage, context: WorkbenchBootstrapContext): WorkbenchItem {
	const title = context.localization.format(messages[pageTitles[page]]);
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
