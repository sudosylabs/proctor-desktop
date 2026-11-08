/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import type { Event } from '../../../../base/common/event.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import type {
	AccountPage,
	ActivityView,
	AuthenticatedDestination
} from '../common/authenticatedNavigationModel.js';

export {
	accountPages,
	activityViews,
	type AccountPage,
	type ActivityView,
	type AuthenticatedDestination
} from '../common/authenticatedNavigationModel.js';

export const IAuthenticatedNavigationService = createDecorator<IAuthenticatedNavigationService>(
	'authenticatedNavigationService'
);

/**
 * Where AuthenticatedWindow is. Product contributions assign the content area for
 * their own destinations when it changes; the frame owns the rail, sidebar and history.
 */
export interface IAuthenticatedNavigationService {
	readonly _serviceBrand: undefined;
	readonly current: AuthenticatedDestination;
	readonly activityView: ActivityView;
	readonly accountPage: AccountPage;
	/** The destination changed. */
	readonly onDidChange: Event<AuthenticatedDestination>;
	/** The Activity page changed while Activity stayed current. */
	readonly onDidChangeActivityView: Event<ActivityView>;
	/** The account page changed while Account stayed current. */
	readonly onDidChangeAccountPage: Event<AccountPage>;
	/** Go to an area, Account or Settings; an unavailable area falls back to an available one. */
	select(destination: string): void;
	selectActivityView(view: ActivityView): void;
	selectAccountPage(page: AccountPage): void;
	/** Replace the product areas with a fresh, server-confirmed projection. */
	setProductAreas(areas: readonly string[]): void;
	/** Show a server-access notice in the sidebar, with an optional way to retry. */
	setProductStatus(message: string, retry?: () => void): void;
	/** Show how many items an Account page lists beside its sidebar entry; nothing hides it. */
	setAccountCount(page: AccountPage, count: number | undefined): void;
	/** Sign out of this window, as the sidebar's Sign out does, reporting a failure beside it. */
	signOut(): void;
}
