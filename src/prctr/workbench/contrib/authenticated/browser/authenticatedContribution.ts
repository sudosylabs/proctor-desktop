import { AUTHENTICATED_LAYOUT_SERVICE, AuthenticatedLayout } from './authenticatedLayout.js';
import type { AccountMenuClient } from '../../../../platform/account/common/accountMenu.js';
import type { AccountClient } from '../../../../platform/account/common/accountProtocol.js';
import { activateAccountShellNavigation, accountShellMessages } from './accountShellNavigation.js';
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { addDisposableListener } from '../../../../base/browser/dom.js';
import { Emitter } from '../../../../base/common/event.js';
import { defineMessage, type MessageDescriptor } from '../../../../base/common/localization.js';
import type { AuthenticatedWindowDescriptor } from '../../../../platform/windows/common/windowProtocol.js';
import type {
	WorkbenchBootstrapContext,
	WorkbenchContributionRegistration
} from '../../../browser/bootstrap.js';
import {
	AUTHENTICATED_NAVIGATION_SERVICE,
	type AuthenticatedNavigationService
} from './authenticatedNavigation.js';
import './authenticatedContribution.css';

export interface AuthenticatedRendererClient {
	readonly accountMenu?: AccountMenuClient;
	readonly account?: AccountClient;
	signOut(): Promise<void>;
	close(): Promise<void>;
}
const destinationMessages = Object.freeze({
	activity: defineMessage({
		id: 'authenticated.destination.activity',
		defaultMessage: 'Exam activity',
		description: 'Authenticated destination for the current User’s examination activity.'
	}),
	account: defineMessage({
		id: 'authenticated.destination.account',
		defaultMessage: 'Account',
		description: 'Authenticated account destination.'
	}),
	settings: defineMessage({
		id: 'authenticated.destination.settings',
		defaultMessage: 'Settings',
		description: 'Authenticated User Settings destination.'
	})
});
const messages = Object.freeze({
	noAffiliation: defineMessage({
		id: 'authenticated.account.no.affiliation',
		defaultMessage: 'You have no current institution affiliation.',
		description: 'Server-confirmed account context.'
	}),
	noAccess: defineMessage({
		id: 'authenticated.account.no.access',
		defaultMessage: 'No examination or management access is assigned to your account.',
		description: 'Server-confirmed absence of assigned access.'
	}),
	connected: defineMessage({
		id: 'authenticated.account.connected',
		defaultMessage: 'Signed in to {institution}.',
		description: 'Verified account institution.'
	}),
	heading: defineMessage({
		id: 'authenticated.heading',
		defaultMessage: 'Authenticated workspace',
		description: 'Heading for the signed-in Proctor application.'
	}),
	waiting: defineMessage({
		id: 'authenticated.destination.waiting',
		defaultMessage: 'Waiting for the current authorized server projection.',
		description:
			'Honest unavailable state before an authenticated destination receives server data.'
	}),
	signOut: defineMessage({
		id: 'authenticated.action.sign.out',
		defaultMessage: 'Sign out',
		description: 'Action that ends the current authenticated Session.'
	}),
	actionFailed: defineMessage({
		id: 'authenticated.action.failed',
		defaultMessage: 'The requested account action could not be completed.',
		description: 'Safe authenticated action failure.'
	})
});

export function createAuthenticatedContribution(
	client: AuthenticatedRendererClient,
	accountManaged = false
): WorkbenchContributionRegistration {
	return Object.freeze({
		id: 'prctr.authenticated.navigation' as const,
		phase: 'ready' as const,
		dependencies: Object.freeze(['prctr.workbench.desktop' as const]),
		messages: Object.freeze([
			...Object.values(accountShellMessages),
			...Object.values(destinationMessages),
			...Object.values(messages)
		] as MessageDescriptor[]),
		activate: (context: WorkbenchBootstrapContext) => {
			const descriptor = context.getWindowBinding() as AuthenticatedWindowDescriptor;
			if (descriptor?.kind !== 'authenticated')
				throw new Error(
					'Authenticated contribution requires its privileged window binding'
				);
			const layout = context.disposables.add(new AuthenticatedLayout(context));
			context.setService(AUTHENTICATED_LAYOUT_SERVICE, layout);
			layout.initializeControls();
			if (accountManaged) {
				activateAccountShellNavigation(context, client, descriptor);
				return;
			}
			const navigation = context.document.createElement('div');
			navigation.className = 'prctr-authenticated';
			navigation.dataset.region = 'navigation';
			const page = context.document.createElement('section');
			page.className = 'prctr-authenticated';
			page.dataset.region = 'page';
			const heading = context.document.createElement('h1');
			heading.textContent =
				descriptor.identity?.displayName ?? context.localization.format(messages.heading);
			const destinationHeading = context.document.createElement('h2');
			const status = context.document.createElement('p');
			status.textContent = context.localization.format(messages.waiting);
			status.setAttribute('role', 'status');
			page.append(heading, destinationHeading, status);
			context.shell.part('navigation').append(navigation);
			context.shell.part('content').append(page);
			context.disposables.add({
				dispose: () => {
					navigation.remove();
					page.remove();
				}
			});
			const destinationChange = context.disposables.add(new Emitter<string>());
			const destinations = context.composition.destinations.filter(
				(destination) =>
					destination !== 'activity' ||
					!descriptor.identity ||
					descriptor.identity.availableProductAreas.includes('student_activity')
			);
			let current = 'account';
			const buttons = new Map<string, HTMLButtonElement>();
			const settingsRequests = context.disposables.add(new Emitter<void>());
			let settingsRequested = false;
			const select = (destination: string): void => {
				if (destination === 'settings') {
					settingsRequested = true;
					settingsRequests.fire();
					return;
				}
				const safe = destinations.includes(destination)
					? destination
					: (destinations.find((value) => value !== 'settings') ?? 'account');
				current = safe;
				for (const [id, value] of buttons) {
					const selected = id === safe;
					value.setAttribute('aria-current', selected ? 'page' : 'false');
				}
				destinationHeading.textContent = context.localization.format(
					destinationMessages[safe as keyof typeof destinationMessages]
				);
				if (descriptor.identity && safe === 'account') {
					const identity = descriptor.identity;
					status.textContent = [
						context.localization.format(messages.connected, {
							institution: identity.institutionName
						}),
						...(identity.noCurrentAffiliation
							? [context.localization.format(messages.noAffiliation)]
							: []),
						...(identity.noAssignedAccess
							? [context.localization.format(messages.noAccess)]
							: [])
					].join(' ');
				} else status.textContent = context.localization.format(messages.waiting);
				page.dataset.destination = safe;
				page.hidden = safe === 'settings' || (safe === 'account' && accountManaged);
				layout.setDestination(safe);
				destinationChange.fire(safe);
			};
			const navigationService: AuthenticatedNavigationService = Object.freeze({
				get current() {
					return current;
				},
				onDidChange: destinationChange.event,
				onDidRequestSettings: settingsRequests.event,
				get settingsRequested() {
					return settingsRequested;
				},
				select
			});
			context.setService(AUTHENTICATED_NAVIGATION_SERVICE, navigationService);
			for (const destination of destinations) {
				const descriptor =
					destinationMessages[destination as keyof typeof destinationMessages];
				if (descriptor === undefined)
					throw new Error(
						`Authenticated destination ${destination} has no packaged presentation`
					);
				const action = context.document.createElement('button');
				action.type = 'button';
				action.textContent = context.localization.format(descriptor);
				action.setAttribute('aria-label', action.textContent);
				navigation.append(action);
				buttons.set(destination, action);
				context.disposables.add(
					addDisposableListener(action, 'click', () => select(destination))
				);
			}
			const signOut = context.document.createElement('button');
			signOut.className = 'prctr-authenticated';
			signOut.dataset.region = 'signout';
			signOut.type = 'button';
			signOut.textContent = context.localization.format(messages.signOut);
			const actionStatus = context.document.createElement('p');
			actionStatus.className = 'prctr-authenticated';
			actionStatus.dataset.region = 'action-status';
			actionStatus.role = 'status';
			actionStatus.setAttribute('aria-live', 'polite');
			if (accountManaged) navigation.append(signOut, actionStatus);
			else context.shell.part('titlebar').prepend(signOut, actionStatus);
			context.disposables.add({
				dispose: () => {
					signOut.remove();
					actionStatus.remove();
				}
			});
			context.disposables.add(
				addDisposableListener(signOut, 'click', () => {
					signOut.disabled = true;
					actionStatus.textContent = '';
					void client.signOut().catch(() => {
						const failure = context.localization.format(messages.actionFailed);
						status.textContent = failure;
						actionStatus.textContent = failure;
						signOut.disabled = false;
					});
				})
			);
			select(
				descriptor.initialDestination === 'settings'
					? 'account'
					: descriptor.initialDestination
			);
			if (descriptor.initialDestination === 'settings') select('settings');
		}
	});
}
