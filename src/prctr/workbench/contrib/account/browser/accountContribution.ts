import { createSemanticIcon } from '../../../../platform/theme/browser/semanticIcon.js';
import { addDisposableListener } from '../../../../base/browser/dom.js';
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
import type { WorkbenchItem } from '../../../common/workbenchItem.js';
import type { WorkbenchPaneHost } from '../../../browser/paneHost.js';
import type { WorkbenchItemResolverRegistry } from '../../../browser/workbenchPane.js';
import { WORKBENCH_ITEM_RESOLVERS, WORKBENCH_PANE_HOST } from '../../../workbench.common.main.js';
import {
	AUTHENTICATED_NAVIGATION_SERVICE,
	type AuthenticatedNavigationService
} from '../../authenticated/browser/authenticatedNavigation.js';
import { AccountPane, type AccountModel } from './accountPane.js';
import { accountMessages as messages } from './accountMessages.js';
import './accountContribution.css';

const ACCOUNT_ITEM_TYPE = 'prctr.authenticated.account';
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
			const host = context.getService<WorkbenchPaneHost>(WORKBENCH_PANE_HOST);
			const registry =
				context.getService<WorkbenchItemResolverRegistry>(WORKBENCH_ITEM_RESOLVERS);
			const items = new Map<AccountSection, WorkbenchItem>(
				accountSections.map((section) => {
					const title = context.localization.format(messages[section]);
					const item: WorkbenchItem = {
						typeId: ACCOUNT_ITEM_TYPE,
						logicalIdentity: section,
						presentation: { title, accessibleLabel: title },
						closable: false,
						restorable: false,
						onDidChangePresentation: Event.None,
						matches(other) {
							return (
								other.typeId === this.typeId &&
								other.logicalIdentity === this.logicalIdentity
							);
						}
					};
					return [section, item];
				})
			);
			context.disposables.add(
				registry.register({
					typeId: ACCOUNT_ITEM_TYPE,
					async resolve(item): Promise<AccountModel> {
						const section = accountSections.find(
							(section) => items.get(section) === item
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
							navigation.setProfilePhoto
						);
					}
				})
			);
			const sidebar = context.document.createElement('nav');
			sidebar.className = 'prctr-account-navigation';
			sidebar.dataset.region = 'navigation';
			sidebar.ariaLabel = context.localization.format(messages.account);
			const heading = context.document.createElement('h2');
			heading.textContent = context.localization.format(messages.account);
			if (!navigation.accountHost) sidebar.append(heading);
			const feedback = context.document.createElement('p');
			feedback.role = 'status';
			const buttons = new Map<AccountSection, HTMLButtonElement>();
			let selected: AccountSection = 'profile';
			let disposed = false;
			let sequence = 0;
			const open = async (section: AccountSection, focus: boolean): Promise<void> => {
				selected = section;
				const serial = ++sequence;
				for (const [key, button] of buttons)
					button.setAttribute('aria-current', key === selected ? 'page' : 'false');
				try {
					const item = items.get(section);
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
						feedback.textContent = context.localization.format(messages.unavailable);
				}
			};
			for (const section of ['profile', 'sessions'] as const) {
				const button = context.document.createElement('button');
				button.type = 'button';
				button.append(
					context.disposables.add(
						createSemanticIcon(context.document, {
							id: section === 'profile' ? 'identity.account' : 'workbench.browser',
							size: 24
						})
					).element,
					context.document.createTextNode(
						context.localization.format(
							section === 'sessions' ? messages.sessionsDevices : messages.profile
						)
					)
				);
				button.dataset.accountSection = section;
				buttons.set(section, button);
				sidebar.append(button);
				context.disposables.add(
					addDisposableListener(button, 'click', () => {
						if (navigation.current !== 'account') {
							selected = section;
							navigation.select('account');
						} else void open(section, true);
					})
				);
			}
			sidebar.append(feedback);
			if (!navigation.accountMenuNavigation)
				(navigation.accountHost ?? context.shell.part('sidebar')).append(sidebar);
			const selectDestination = (destination: string, focus = false): void => {
				const visible = destination === 'account';
				if (navigation.accountMenuNavigation)
					selected = navigation.accountSection ?? 'profile';
				sidebar.hidden = !navigation.accountHost && !visible;
				for (const [section, button] of buttons)
					button.setAttribute(
						'aria-current',
						visible && section === selected ? 'page' : 'false'
					);
				host.element.hidden = !visible;
				context.shell.setPartVisible(
					'sidebar',
					!navigation.accountMenuNavigation && !navigation.accountHost && visible
				);
				if (visible) void open(selected, focus);
				else {
					sequence++;
					void host.clear().catch(() => {});
				}
			};
			context.disposables.add(
				navigation.onDidChange((destination) => selectDestination(destination, true))
			);
			context.disposables.add({
				dispose() {
					disposed = true;
					sequence++;
					sidebar.remove();
				}
			});
			selectDestination(navigation.current);
		}
	});
}
