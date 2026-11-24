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
import { ClassPage } from './class/classPage.js';
import { InvitationsPage } from './invitations/invitationsPage.js';
import { OverviewPage } from './overview/overviewPage.js';
import { PeriodsPage } from './periods/periodsPage.js';
import { PolicyPage } from './policy/policyPage.js';
import { RolesPage } from './roles/rolesPage.js';
import { AuditsPage } from './records/auditsPage.js';
import { RetentionPage } from './records/retentionPage.js';
import { JobPage } from './operations/jobPage.js';
import { JobsPage } from './operations/jobsPage.js';
import { ProgressionPage } from './progression/progressionPage.js';
import { ProgressionReviewPage } from './progression/progressionReviewPage.js';
import { MailPage } from './operations/mailPage.js';
import { StructurePage } from './structure/structurePage.js';
import { UserPage } from './user/userPage.js';
import { UsersPage } from './users/usersPage.js';

/** How the Administration pane titles, describes and creates one of its pages. */
export interface AdministrationPageDescriptor {
	readonly title: AdministrationMessage;
	description(format: IAdministrationFormatService): string;
	/** Tables use the wide column. */
	readonly width: 'record' | 'wide';
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

/** A record's page opened without its record shows nothing; navigation opens its list instead. */
function emptyPage(): PageView {
	return { setVisible() {}, dispose() {} };
}

function list(
	title: AdministrationMessage,
	description: (format: IAdministrationFormatService) => string,
	width: 'record' | 'wide',
	create: Create
): AdministrationPageDescriptor {
	return { title, description, width, create };
}

function record(
	title: AdministrationMessage,
	width: 'record' | 'wide',
	create: CreateRecord
): AdministrationPageDescriptor {
	return {
		title,
		description: () => '',
		width,
		create: (instantiationService, body, headerActions, subject) =>
			subject === undefined
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
		'record',
		(i, body, actions) => i.createInstance(OverviewPage, body, actions)
	),
	users: list(
		'usersTitle',
		(f) => f.institutionText('usersDescription', 'usersDescriptionGeneric'),
		'wide',
		(i, body, actions) => i.createInstance(UsersPage, body, actions)
	),
	user: record('userTitle', 'record', (i, body, actions, id) =>
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
		'wide',
		(i, body, actions) => i.createInstance(ImportsPage, body, actions)
	),
	import: record('importTitle', 'record', (i, body, actions, id) =>
		i.createInstance(ImportPage, body, actions, id)
	),
	structure: list(
		'structureTitle',
		(f) => f.text('structureDescription'),
		'wide',
		(i, body, actions) => i.createInstance(StructurePage, body, actions)
	),
	class: record('classTitle', 'wide', (i, body, actions, id) =>
		i.createInstance(ClassPage, body, actions, id)
	),
	periods: list(
		'periodsTitle',
		(f) => f.text('periodsDescription'),
		'wide',
		(i, body, actions) => i.createInstance(PeriodsPage, body, actions)
	),
	progression: list(
		'progressionTitle',
		(f) => f.text('progressionDescription'),
		'wide',
		(i, body, actions) => i.createInstance(ProgressionPage, body, actions)
	),
	progressionReview: record('reviewTitle', 'record', (i, body, actions, id) =>
		i.createInstance(ProgressionReviewPage, body, actions, id)
	),
	roles: list(
		'rolesTitle',
		(f) => f.text('rolesDescription'),
		'wide',
		(i, body, actions) => i.createInstance(RolesPage, body, actions)
	),
	policy: list(
		'policyTitle',
		(f) => f.institutionText('policyDescription', 'policyDescriptionGeneric'),
		'record',
		(i, body, actions) => i.createInstance(PolicyPage, body, actions)
	),
	audits: list(
		'auditsTitle',
		(f) => f.institutionText('auditsDescription', 'auditsDescriptionGeneric'),
		'wide',
		(i, body, actions) => i.createInstance(AuditsPage, body, actions)
	),
	retention: list(
		'retentionTitle',
		(f) => f.text('retentionDescription'),
		'record',
		(i, body, actions) => i.createInstance(RetentionPage, body, actions)
	),
	jobs: list(
		'jobsTitle',
		(f) => f.text('jobsDescription'),
		'wide',
		(i, body, actions) => i.createInstance(JobsPage, body, actions)
	),
	job: record('jobTitle', 'record', (i, body, actions, id) =>
		i.createInstance(JobPage, body, actions, id)
	),
	mail: list(
		'mailTitle',
		(f) => f.institutionText('mailDescription', 'mailDescriptionGeneric'),
		'wide',
		(i, body, actions) => i.createInstance(MailPage, body, actions)
	)
});
