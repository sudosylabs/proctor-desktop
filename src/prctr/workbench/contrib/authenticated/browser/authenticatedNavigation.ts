/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import type { Event } from '../../../../base/common/event.js';
import type { IDisposable } from '../../../../base/common/lifecycle.js';
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

export const AUTHENTICATED_NAVIGATION_SERVICE = 'prctr.authenticated.service.navigation';

/** The window's tooltip: shown on hover and keyboard focus, in the frame's own style. */
export const AUTHENTICATED_HOVER_SERVICE = 'prctr.authenticated.service.hover';
export type AuthenticatedHover = (target: HTMLElement, label: string) => IDisposable;
export const AUTHENTICATED_LAYOUT_SERVICE = 'prctr.authenticated.service.layout';

/**
 * Where AuthenticatedWindow is. Product contributions assign the content area for
 * their own destinations when it changes; the frame owns the rail, sidebar and history.
 */
export interface AuthenticatedNavigationService {
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
	setProfilePhoto(dataUrl: string): void;
	/** Show how many items an Account page lists beside its sidebar entry; nothing hides it. */
	setAccountCount(page: AccountPage, count: number | undefined): void;
	/** Sign out of this window, as the sidebar's Sign out does, reporting a failure beside it. */
	signOut(): void;
}

/** The contextual sidebar's visibility, which other window owners may request. */
export interface AuthenticatedLayoutService {
	readonly sidebarVisible: boolean;
	readonly onDidChangeSidebarVisibility: Event<boolean>;
	setSidebarVisible(visible: boolean): void;
}
