/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import type { IDisposable } from '../../../../base/common/lifecycle.js';
import type { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import type { AccountPage } from '../../../services/authenticatedNavigation/common/authenticatedNavigationModel.js';
import type { IAccountFormatService } from './accountFormat.js';
import type { AccountMessage } from './accountMessages.js';
import { HistoryPage } from './historyPage.js';
import { ProfilePage } from './profilePage.js';
import { SecurityPage } from './securityPage.js';
import { SessionsPage } from './sessionsPage.js';
import { SettingsPage } from './settingsPage.js';
import { TokensPage } from './tokensPage.js';

/** One Account page in the content area. Its pane shows it and says when it is visible. */
export interface AccountPageView extends IDisposable {
	setVisible(visible: boolean): void;
}

/** How the Account pane titles, describes and creates one of its pages. */
export interface AccountPageDescriptor {
	readonly title: AccountMessage;
	description(format: IAccountFormatService): string;
	/** Builds the page into the pane's body and header actions with the pane's services. */
	create(
		instantiationService: IInstantiationService,
		body: HTMLElement,
		headerActions: HTMLElement
	): AccountPageView;
}

/** Every Account page, keyed by the sidebar entry that opens it. */
export const accountPageRegistry: Readonly<Record<AccountPage, AccountPageDescriptor>> =
	Object.freeze({
		profile: {
			title: 'profileTitle',
			description: (format) =>
				format.institutionText('profileDescription', 'profileDescriptionGeneric'),
			create: (instantiationService, body, headerActions) =>
				instantiationService.createInstance(ProfilePage, body, headerActions)
		},
		security: {
			title: 'securityTitle',
			description: (format) => format.text('securityDescription'),
			create: (instantiationService, body, headerActions) =>
				instantiationService.createInstance(SecurityPage, body, headerActions)
		},
		sessions: {
			title: 'sessionsTitle',
			description: (format) => format.text('sessionsDescription'),
			create: (instantiationService, body, headerActions) =>
				instantiationService.createInstance(SessionsPage, body, headerActions)
		},
		tokens: {
			title: 'tokensTitle',
			description: (format) => format.text('tokensDescription'),
			create: (instantiationService, body, headerActions) =>
				instantiationService.createInstance(TokensPage, body, headerActions)
		},
		history: {
			title: 'historyTitle',
			description: (format) => format.text('historyDescription'),
			create: (instantiationService, body, headerActions) =>
				instantiationService.createInstance(HistoryPage, body, headerActions)
		},
		settings: {
			title: 'settingsTitle',
			description: (format) => format.text('settingsDescription'),
			create: (instantiationService, body, headerActions) =>
				instantiationService.createInstance(SettingsPage, body, headerActions)
		}
	});
