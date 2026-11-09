/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import type { IInstantiationService } from '../../../platform/instantiation/common/instantiation.js';
import type { PageView } from '../../browser/authenticated/pages/pagePane.js';
import type { AdministrationPage } from '../../services/authenticatedNavigation/common/authenticatedNavigationModel.js';
import type { IAdministrationFormatService } from './administrationFormat.js';
import type { AdministrationMessage } from './administrationMessages.js';
import { ImportPage } from './imports/importPage.js';
import { ImportsPage } from './imports/importsPage.js';
import { InvitationsPage } from './invitations/invitationsPage.js';
import { OverviewPage } from './overview/overviewPage.js';
import { UserPage } from './user/userPage.js';
import { UsersPage } from './users/usersPage.js';

/** How the Administration pane titles, describes and creates one of its pages. */
export interface AdministrationPageDescriptor {
	readonly title: AdministrationMessage;
	description(format: IAdministrationFormatService): string;
	/** Tables use the wide column. */
	readonly width: 'narrow' | 'wide';
	/** Builds the page; a record's page is given the record's id. */
	create(
		instantiationService: IInstantiationService,
		body: HTMLElement,
		headerActions: HTMLElement,
		subject: string | undefined
	): PageView;
}

type Create = (
	instantiationService: IInstantiationService,
	body: HTMLElement,
	headerActions: HTMLElement
) => PageView;
type CreateRecord = (
	instantiationService: IInstantiationService,
	body: HTMLElement,
	headerActions: HTMLElement,
	subject: string
) => PageView;

function emptyPage(): PageView {
	return { setVisible() {}, dispose() {} };
}

function list(
	title: AdministrationMessage,
	description: (format: IAdministrationFormatService) => string,
	width: 'narrow' | 'wide',
	create?: Create
): AdministrationPageDescriptor {
	return {
		title,
		description,
		width,
		create: (instantiationService, body, headerActions) =>
			create === undefined ? emptyPage() : create(instantiationService, body, headerActions)
	};
}

function record(
	title: AdministrationMessage,
	width: 'narrow' | 'wide',
	create?: CreateRecord
): AdministrationPageDescriptor {
	return {
		title,
		description: () => '',
		width,
		create: (instantiationService, body, headerActions, subject) =>
			create === undefined || subject === undefined
				? emptyPage()
				: create(instantiationService, body, headerActions, subject)
	};
}

/** Every Administration page, keyed by the sidebar entry or record that opens it. */
export const administrationPageRegistry: Readonly<
	Record<AdministrationPage, AdministrationPageDescriptor>
> = Object.freeze({
	overview: list(
		'overviewTitle',
		(f) => f.institutionText('overviewDescription', 'overviewDescriptionGeneric'),
		'narrow',
		(i, body, actions) => i.createInstance(OverviewPage, body, actions)
	),
	users: list(
		'usersTitle',
		(f) => f.institutionText('usersDescription', 'usersDescriptionGeneric'),
		'wide',
		(i, body, actions) => i.createInstance(UsersPage, body, actions)
	),
	user: record('userTitle', 'narrow', (i, body, actions, id) =>
		i.createInstance(UserPage, body, actions, id)
	),
	invitations: list(
		'invitationsTitle',
		(f) => f.text('invitationsDescription'),
		'wide',
		(i, body, actions) => i.createInstance(InvitationsPage, body, actions)
	),
	imports: list(
		'importsTitle',
		(f) => f.text('importsDescription'),
		'narrow',
		(i, body, actions) => i.createInstance(ImportsPage, body, actions)
	),
	import: record('importTitle', 'narrow', (i, body, actions, id) =>
		i.createInstance(ImportPage, body, actions, id)
	),
	structure: list('structureTitle', (f) => f.text('structureDescription'), 'wide'),
	class: record('classTitle', 'wide'),
	periods: list('periodsTitle', (f) => f.text('periodsDescription'), 'wide'),
	roles: list('rolesTitle', (f) => f.text('rolesDescription'), 'wide'),
	policy: list(
		'policyTitle',
		(f) => f.institutionText('policyDescription', 'policyDescriptionGeneric'),
		'narrow'
	),
	audits: list(
		'auditsTitle',
		(f) => f.institutionText('auditsDescription', 'auditsDescriptionGeneric'),
		'wide'
	),
	retention: list('retentionTitle', (f) => f.text('retentionDescription'), 'narrow'),
	jobs: list('jobsTitle', (f) => f.text('jobsDescription'), 'wide'),
	mail: list(
		'mailTitle',
		(f) => f.institutionText('mailDescription', 'mailDescriptionGeneric'),
		'wide'
	)
});
