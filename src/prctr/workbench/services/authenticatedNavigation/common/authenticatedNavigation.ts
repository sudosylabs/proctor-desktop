/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import type { Event } from '../../../../base/common/event.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import type {
	AccountPage,
	ActivityView,
	AdministrationPage,
	AuthenticatedDestination
} from './authenticatedNavigationModel.js';

export {
	accountPages,
	activityViews,
	administrationPages,
	type AccountPage,
	type ActivityView,
	type AdministrationPage,
	type AuthenticatedDestination
} from './authenticatedNavigationModel.js';

/** An Administration page, with the record it shows when it is a record's page. */
export interface AdministrationLocation {
	readonly page: AdministrationPage;
	readonly subject: string | undefined;
}

export const IAuthenticatedNavigationService = createDecorator<IAuthenticatedNavigationService>(
	'authenticatedNavigationService'
);

/** What the rail tells the person about their access or the connection. */
export interface ProductStatus {
	readonly tone: 'info' | 'problem';
	readonly title: string;
	readonly detail?: string;
	readonly retry?: () => void;
}

/** A count beside an Administration sidebar entry. */
export interface AdministrationCount {
	readonly count: number;
	readonly atLeast: boolean;
	readonly attention?: boolean;
}

/**
 * Where AuthenticatedWindow is. Product contributions assign the content area for
 * their own destinations when it changes; the frame owns the rail, sidebar and history.
 */
export interface IAuthenticatedNavigationService {
	readonly _serviceBrand: undefined;
	readonly current: AuthenticatedDestination;
	readonly activityView: ActivityView;
	readonly accountPage: AccountPage;
	readonly administration: AdministrationLocation;
	/** The destination changed. */
	readonly onDidChange: Event<AuthenticatedDestination>;
	/** The Activity page changed while Activity stayed current. */
	readonly onDidChangeActivityView: Event<ActivityView>;
	/** The account page changed while Account stayed current. */
	readonly onDidChangeAccountPage: Event<AccountPage>;
	/** The Administration page or its record changed while Administration stayed current. */
	readonly onDidChangeAdministration: Event<AdministrationLocation>;
	/** Go to an area, Account or Settings; an unavailable area falls back to an available one. */
	select(destination: string): void;
	selectActivityView(view: ActivityView): void;
	selectAccountPage(page: AccountPage): void;
	/** Opens an Administration page; a record's page, such as one user, names the record. */
	selectAdministrationPage(page: AdministrationPage, subject?: string): void;
	/** Replace the product areas with a fresh, server-confirmed projection. */
	setProductAreas(areas: readonly string[]): void;
	/**
	 * Show a fact about the person's access, or a problem reaching the server, in the rail above
	 * the account; a problem can offer to try again. Nothing removes it.
	 */
	setProductStatus(status: ProductStatus | undefined): void;
	/** Show how many items an Account page lists beside its sidebar entry; nothing hides it. */
	setAccountCount(page: AccountPage, count: number | undefined): void;
	/**
	 * Show how many items wait on an Administration page, such as pending invitations; `atLeast`
	 * adds "+" and `attention` marks failures. Nothing, or zero, hides it.
	 */
	setAdministrationCount(page: AdministrationPage, count: AdministrationCount | undefined): void;
	/** Sign out of this window, as the sidebar's Sign out does, reporting a failure beside it. */
	signOut(): void;
}
