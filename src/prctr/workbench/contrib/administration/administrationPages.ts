/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import type { IInstantiationService } from '../../../platform/instantiation/common/instantiation.js';
import type { PageView } from '../../browser/authenticated/pages/pagePane.js';
import type { AdministrationPage } from '../../services/authenticatedNavigation/common/authenticatedNavigationModel.js';
import type { IAdministrationFormatService } from './administrationFormat.js';
import type { AdministrationMessage } from './administrationMessages.js';

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

function emptyPage(): PageView {
	return { setVisible() {}, dispose() {} };
}

function page(
	title: AdministrationMessage,
	description: (format: IAdministrationFormatService) => string,
	width: 'narrow' | 'wide'
): AdministrationPageDescriptor {
	return { title, description, width, create: emptyPage };
}

/** Every Administration page, keyed by the sidebar entry or record that opens it. */
export const administrationPageRegistry: Readonly<
	Record<AdministrationPage, AdministrationPageDescriptor>
> = Object.freeze({
	overview: page(
		'overviewTitle',
		(f) => f.institutionText('overviewDescription', 'overviewDescriptionGeneric'),
		'narrow'
	),
	users: page(
		'usersTitle',
		(f) => f.institutionText('usersDescription', 'usersDescriptionGeneric'),
		'wide'
	),
	user: page('userTitle', () => '', 'narrow'),
	invitations: page('invitationsTitle', (f) => f.text('invitationsDescription'), 'wide'),
	imports: page('importsTitle', (f) => f.text('importsDescription'), 'wide'),
	structure: page('structureTitle', (f) => f.text('structureDescription'), 'wide'),
	class: page('classTitle', () => '', 'wide'),
	periods: page('periodsTitle', (f) => f.text('periodsDescription'), 'wide'),
	roles: page('rolesTitle', (f) => f.text('rolesDescription'), 'wide'),
	policy: page(
		'policyTitle',
		(f) => f.institutionText('policyDescription', 'policyDescriptionGeneric'),
		'narrow'
	),
	audits: page(
		'auditsTitle',
		(f) => f.institutionText('auditsDescription', 'auditsDescriptionGeneric'),
		'wide'
	),
	retention: page('retentionTitle', (f) => f.text('retentionDescription'), 'narrow'),
	jobs: page('jobsTitle', (f) => f.text('jobsDescription'), 'wide'),
	mail: page(
		'mailTitle',
		(f) => f.institutionText('mailDescription', 'mailDescriptionGeneric'),
		'wide'
	)
});
