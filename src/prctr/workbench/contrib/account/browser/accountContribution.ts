/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { HoverPosition } from '../../../../base/browser/ui/hover/hoverWidget.js';
import { Event } from '../../../../base/common/event.js';
import {
	accountSections,
	type AccountClient,
	type AccountSection
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
	AUTHENTICATED_NAVIGATION_SERVICE,
	type AuthenticatedNavigationService
} from '../../authenticated/browser/authenticatedNavigation.js';
import {
	AUTHENTICATED_WINDOW_CONTROLS_SERVICE,
	type AuthenticatedWindowControls
} from '../../authenticated/browser/authenticatedWindowControls.js';
import { accountMessages as messages } from './accountMessages.js';
import { AccountPane, type AccountModel } from './accountPane.js';

const ACCOUNT_ITEM_TYPE = 'prctr.authenticated.account';

/** Account's pages in the content area, opened from the Account sidebar. */
export function createAccountContribution(
	client: AccountClient
): WorkbenchContributionRegistration {
	return Object.freeze({
		id: 'prctr.authenticated.account',
		phase: 'ready',
		dependencies: Object.freeze(['prctr.authenticated.navigation' as const]),
		messages: Object.values(messages),
		activate(context: WorkbenchBootstrapContext): void {
			const binding = context.getWindowBinding() as AuthenticatedWindowDescriptor;
			if (binding.kind !== 'authenticated')
				throw new Error('Account requires an authenticated binding');
			const navigation = context.getService<AuthenticatedNavigationService>(
				AUTHENTICATED_NAVIGATION_SERVICE
			);
			const controls = context.getService<AuthenticatedWindowControls>(
				AUTHENTICATED_WINDOW_CONTROLS_SERVICE
			);
			const host = context.getService<WorkbenchPaneHost>(WORKBENCH_PANE_HOST);
			const registry =
				context.getService<WorkbenchItemResolverRegistry>(WORKBENCH_ITEM_RESOLVERS);
			const customPhotos = new Set<string>();
			const items = new Map<AccountSection, WorkbenchItem>(
				accountSections.map((section) => [section, accountItem(section, context)])
			);
			context.disposables.add(
				registry.register({
					typeId: ACCOUNT_ITEM_TYPE,
					async resolve(item): Promise<AccountModel> {
						const section = accountSections.find(
							(candidate) => items.get(candidate) === item
						);
						if (!section) throw new Error('Unknown account item');
						return { item, section, dispose() {} };
					},
					createPane(document) {
						return new AccountPane(
							document,
							client,
							context.localization,
							binding,
							(dataUrl) => navigation.setProfilePhoto(dataUrl),
							{
								overlays: context.shell.overlayHost,
								customPhotos,
								hover: (target, label) =>
									controls.hover.setupDelayedHover(target, () => ({
										content: label,
										position: { hoverPosition: HoverPosition.BELOW }
									}))
							}
						);
					}
				})
			);
			let disposed = false;
			let sequence = 0;
			const open = async (focus: boolean): Promise<void> => {
				const serial = ++sequence;
				const item = items.get(navigation.accountSection);
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
							context.localization.format(messages.unavailable)
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
		}
	});
}

function accountItem(section: AccountSection, context: WorkbenchBootstrapContext): WorkbenchItem {
	const title = context.localization.format(messages[section]);
	return {
		typeId: ACCOUNT_ITEM_TYPE,
		logicalIdentity: section,
		presentation: { title, accessibleLabel: title },
		closable: false,
		restorable: false,
		onDidChangePresentation: Event.None,
		matches(other) {
			return other.typeId === this.typeId && other.logicalIdentity === this.logicalIdentity;
		}
	};
}
