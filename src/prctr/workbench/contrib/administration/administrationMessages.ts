/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { defineMessage } from '../../../base/common/localization.js';
import {
	jobStageMessages,
	jobTypeMessages,
	mailTemplateMessages,
	problemCodeMessages
} from './codes/codeMessages.js';
import { importsMessages } from './imports/importsMessages.js';
import { operationsMessages } from './operations/operationsMessages.js';
import { overviewMessages } from './overview/overviewMessages.js';
import { progressionMessages } from './progression/progressionMessages.js';
import { recordsMessages } from './records/recordsMessages.js';
import { rolesMessages } from './roles/rolesMessages.js';
import { structureMessages } from './structure/structureMessages.js';
import { invitationsMessages } from './invitations/invitationsMessages.js';
import { userMessages } from './user/userMessages.js';
import { usersMessages } from './users/usersMessages.js';

/** Text every Administration page shares: page headings and failures. */
const sharedMessages = Object.freeze({
	listShowing: defineMessage({
		id: 'administration.list.showing',
		defaultMessage: 'Showing {range}',
		description: 'Under a table: which rows it shows, as in "Showing 1–10 of 1,284".'
	}),
	listPageSize: defineMessage({
		id: 'administration.list.page.size',
		defaultMessage: '{count} a page',
		description: 'Under a table: how many rows each page shows; opens a choice of 10, 25 or 50.'
	}),
	listPageSizeChoice: defineMessage({
		id: 'administration.list.page.choice',
		defaultMessage: 'Rows on each page',
		description: 'Accessible name of the menu that chooses how many rows a page shows.'
	}),
	listGoToDate: defineMessage({
		id: 'administration.list.jump',
		defaultMessage: 'Go to a date',
		description: 'Under a dated table: starts the list at the end of the chosen day.'
	}),
	listSortedAscending: defineMessage({
		id: 'administration.list.sorted.ascending',
		defaultMessage: '{column}, sorted from first to last',
		description: 'Accessible name of a column header sorted in ascending order.'
	}),
	listSortedDescending: defineMessage({
		id: 'administration.list.sorted.descending',
		defaultMessage: '{column}, sorted from last to first',
		description: 'Accessible name of a column header sorted in descending order.'
	}),
	listScrollHint: defineMessage({
		id: 'administration.list.scroll.hint',
		defaultMessage: 'Scroll sideways for more columns',
		description: 'Under a table that is wider than the window and scrolls sideways.'
	}),
	listSelectRow: defineMessage({
		id: 'administration.list.select.row',
		defaultMessage: 'Select {name}',
		description: 'Accessible name of the checkbox that selects one table row.'
	}),
	listSelectPage: defineMessage({
		id: 'administration.list.select.page',
		defaultMessage: 'Select every row on this page',
		description: 'Accessible name of the checkbox in a table header that selects all its rows.'
	}),
	overviewTitle: defineMessage({
		id: 'administration.page.overview.title',
		defaultMessage: 'Overview',
		description: 'Heading of the Administration Overview page.'
	}),
	overviewDescription: defineMessage({
		id: 'administration.page.overview.description',
		defaultMessage: 'What needs you at {institution} today.',
		description: 'One-line description under the Overview heading.'
	}),
	overviewDescriptionGeneric: defineMessage({
		id: 'administration.page.overview.description.generic',
		defaultMessage: 'What needs you today.',
		description: 'Overview description when the institution name is unknown.'
	}),
	usersTitle: defineMessage({
		id: 'administration.page.users.title',
		defaultMessage: 'Users',
		description: 'Heading of the Administration Users page.'
	}),
	usersDescription: defineMessage({
		id: 'administration.page.users.description',
		defaultMessage: 'Everyone with an account at {institution}.',
		description: 'One-line description under the Users heading.'
	}),
	usersDescriptionGeneric: defineMessage({
		id: 'administration.page.users.description.generic',
		defaultMessage: 'Everyone with an account.',
		description: 'Users description when the institution name is unknown.'
	}),
	userTitle: defineMessage({
		id: 'administration.page.user.title',
		defaultMessage: 'User',
		description: 'Heading of the Administration User page.'
	}),
	invitationsTitle: defineMessage({
		id: 'administration.page.invitations.title',
		defaultMessage: 'Invitations',
		description: 'Heading of the Administration Invitations page.'
	}),
	invitationsDescription: defineMessage({
		id: 'administration.page.invitations.description',
		defaultMessage: 'People asked to join, and what they were invited to.',
		description: 'One-line description under the Invitations heading.'
	}),
	importsTitle: defineMessage({
		id: 'administration.page.imports.title',
		defaultMessage: 'Imports',
		description: 'Heading of the Administration Imports page.'
	}),
	importsDescription: defineMessage({
		id: 'administration.page.imports.description',
		defaultMessage:
			'Add many people at once from a spreadsheet. Proctor checks every row first, and nothing changes until you review it.',
		description: 'One-line description under the Imports heading.'
	}),
	structureTitle: defineMessage({
		id: 'administration.page.structure.title',
		defaultMessage: 'Structure',
		description: 'Heading of the Administration Structure page.'
	}),
	structureDescription: defineMessage({
		id: 'administration.page.structure.description',
		defaultMessage:
			'Faculties, departments, programmes and classes, as your institution is organised.',
		description: 'One-line description under the Structure heading.'
	}),
	classTitle: defineMessage({
		id: 'administration.page.class.title',
		defaultMessage: 'Class',
		description: 'Heading of the Administration Class page.'
	}),
	periodsTitle: defineMessage({
		id: 'administration.page.periods.title',
		defaultMessage: 'Academic periods',
		description: 'Heading of the Administration Academic periods page.'
	}),
	periodsDescription: defineMessage({
		id: 'administration.page.periods.description',
		defaultMessage:
			'Terms and years that classes run in. A class belongs to one period, and exams are planned inside it.',
		description: 'One-line description under the Academic periods heading.'
	}),
	rolesTitle: defineMessage({
		id: 'administration.page.roles.title',
		defaultMessage: 'Roles',
		description: 'Heading of the Administration Roles page.'
	}),
	rolesDescription: defineMessage({
		id: 'administration.page.roles.description',
		defaultMessage:
			'What each role lets people do. Built-in roles can’t be changed; custom roles can.',
		description: 'One-line description under the Roles heading.'
	}),
	policyTitle: defineMessage({
		id: 'administration.page.policy.title',
		defaultMessage: 'Access policy',
		description: 'Heading of the Administration Access policy page.'
	}),
	policyDescription: defineMessage({
		id: 'administration.page.policy.description',
		defaultMessage: 'How people sign in to {institution} and who may join.',
		description: 'One-line description under the Access policy heading.'
	}),
	policyDescriptionGeneric: defineMessage({
		id: 'administration.page.policy.description.generic',
		defaultMessage: 'How people sign in and who may join.',
		description: 'Access policy description when the institution name is unknown.'
	}),
	auditsTitle: defineMessage({
		id: 'administration.page.audits.title',
		defaultMessage: 'Audits',
		description: 'Heading of the Administration Audits page.'
	}),
	auditsDescription: defineMessage({
		id: 'administration.page.audits.description',
		defaultMessage: 'Everything done at {institution}, by whom and from where.',
		description: 'One-line description under the Audits heading.'
	}),
	auditsDescriptionGeneric: defineMessage({
		id: 'administration.page.audits.description.generic',
		defaultMessage: 'Everything done, by whom and from where.',
		description: 'Audits description when the institution name is unknown.'
	}),
	retentionTitle: defineMessage({
		id: 'administration.page.retention.title',
		defaultMessage: 'Data retention',
		description: 'Heading of the Administration Data retention page.'
	}),
	retentionDescription: defineMessage({
		id: 'administration.page.retention.description',
		defaultMessage: 'How long exam records are kept, and what is deleted when.',
		description: 'One-line description under the Data retention heading.'
	}),
	jobsTitle: defineMessage({
		id: 'administration.page.jobs.title',
		defaultMessage: 'Jobs',
		description: 'Heading of the Administration Jobs page.'
	}),
	jobsDescription: defineMessage({
		id: 'administration.page.jobs.description',
		defaultMessage:
			'Work Proctor runs in the background, such as imports, cleanup and key rotation.',
		description: 'One-line description under the Jobs heading.'
	}),
	mailTitle: defineMessage({
		id: 'administration.page.mail.title',
		defaultMessage: 'Mail',
		description: 'Heading of the Administration Mail page.'
	}),
	mailDescription: defineMessage({
		id: 'administration.page.mail.description',
		defaultMessage:
			'Email Proctor sends for {institution}: invitations, verification and sign-in help.',
		description: 'One-line description under the Mail heading.'
	}),
	mailDescriptionGeneric: defineMessage({
		id: 'administration.page.mail.description.generic',
		defaultMessage: 'Email Proctor sends: invitations, verification and sign-in help.',
		description: 'Mail description when the institution name is unknown.'
	}),
	importTitle: defineMessage({
		id: 'administration.page.import.title',
		defaultMessage: 'Import',
		description: 'Heading of one onboarding import before its details load.'
	}),
	countImportsOne: defineMessage({
		id: 'administration.sidebar.count.imports.one',
		defaultMessage: '{count} open import',
		description: 'Spoken name of the sidebar count beside Imports when it is one.'
	}),
	countImports: defineMessage({
		id: 'administration.sidebar.count.imports.many',
		defaultMessage: '{count} open imports',
		description: 'Spoken name of the sidebar count beside Imports.'
	}),
	countJobsOne: defineMessage({
		id: 'administration.sidebar.count.jobs.one',
		defaultMessage: '{count} failed job',
		description: 'Spoken name of the sidebar count beside Jobs when it is one.'
	}),
	countJobs: defineMessage({
		id: 'administration.sidebar.count.jobs.many',
		defaultMessage: '{count} failed jobs',
		description: 'Spoken name of the sidebar count beside Jobs.'
	}),
	failureAccessChanged: defineMessage({
		id: 'administration.failure.accesschanged',
		defaultMessage: 'Your access changed since this check. Nothing has changed; check again.',
		description: "A change for everyone whose check no longer matches the viewer's access."
	}),
	personPickerTitle: defineMessage({
		id: 'administration.person.picker.title',
		defaultMessage: '{filter}: choose a person',
		description: 'Title of finding one person for a filter, as in "About: choose a person".'
	}),
	personPickerBody: defineMessage({
		id: 'administration.person.picker.body',
		defaultMessage: 'Find them by name, email or username.',
		description: 'Description of finding one person for a filter.'
	}),
	personPickerFind: defineMessage({
		id: 'administration.person.picker.find',
		defaultMessage: 'Find a person',
		description: 'Label of the search field that finds one person.'
	}),
	personPickerResults: defineMessage({
		id: 'administration.person.picker.results',
		defaultMessage: 'People found',
		description: 'Accessible name of the people a search found.'
	}),
	personPickerClear: defineMessage({
		id: 'administration.person.picker.clear',
		defaultMessage: 'Show {anyone}',
		description: 'Clears the person filter, as in "Show anyone".'
	}),
	personPickerStart: defineMessage({
		id: 'administration.person.picker.start',
		defaultMessage: 'Type at least two letters of a name, email or username.',
		description: 'Before anything is typed.'
	}),
	personPickerNone: defineMessage({
		id: 'administration.person.picker.none',
		defaultMessage: 'Nobody matches.',
		description: 'When a search finds nobody.'
	}),
	personPickerMore: defineMessage({
		id: 'administration.person.picker.more',
		defaultMessage: 'More people match; type more of the name.',
		description: 'When a search finds more than are listed.'
	}),
	pageUnavailable: defineMessage({
		id: 'administration.page.unavailable',
		defaultMessage: 'This Administration page could not be opened.',
		description: 'Shown in the sidebar when an Administration page fails to open.'
	}),
	fieldRequired: defineMessage({
		id: 'administration.field.required',
		defaultMessage: 'This is required.',
		description: 'Shown under a required form field left empty.'
	}),
	fieldRefused: defineMessage({
		id: 'administration.field.refused',
		defaultMessage: 'The server didn’t accept this. Check it and try again.',
		description: 'Shown under a form field the server refused.'
	}),
	failureUnavailable: defineMessage({
		id: 'administration.failure.unavailable',
		defaultMessage: 'The server could not be reached.',
		description: 'A read or change failed because the server did not answer.'
	}),
	failureSessionEnded: defineMessage({
		id: 'administration.failure.session.ended',
		defaultMessage: 'You were signed out.',
		description: 'The session ended while the page was open.'
	}),
	failureNoAccess: defineMessage({
		id: 'administration.failure.no.access',
		defaultMessage: 'You don’t have access to this.',
		description: 'The server refused the read or change for this person.'
	}),
	failureNotFound: defineMessage({
		id: 'administration.failure.not.found',
		defaultMessage: 'It no longer exists, or you can no longer see it.',
		description: 'The record was removed or is outside what this person may see.'
	}),
	failureReauthentication: defineMessage({
		id: 'administration.failure.reauthentication',
		defaultMessage: 'Confirm it’s you to make this change.',
		description: 'The change needs a recent sign-in.'
	}),
	failureStrong: defineMessage({
		id: 'administration.failure.strong',
		defaultMessage: 'This needs a sign-in with two-step verification.',
		description: 'The change needs a multi-factor session.'
	}),
	failureUnconfirmed: defineMessage({
		id: 'administration.failure.unconfirmed',
		defaultMessage: 'It isn’t known whether this finished. Check before trying again.',
		description: 'A change was sent but no answer confirmed it.'
	}),
	failureConflict: defineMessage({
		id: 'administration.failure.conflict',
		defaultMessage:
			'Someone else changed this first. Look at the latest version and try again.',
		description: 'A change was refused because the record changed meanwhile.'
	}),
	failureInvalid: defineMessage({
		id: 'administration.failure.invalid',
		defaultMessage: 'The server didn’t accept this. Check what you entered.',
		description: 'A change was refused as invalid.'
	}),
	failureCancelled: defineMessage({
		id: 'administration.failure.cancelled',
		defaultMessage: 'Cancelled.',
		description: 'The person cancelled a confirmation.'
	}),
	failureExpired: defineMessage({
		id: 'administration.failure.expired',
		defaultMessage: 'That took too long. Try again.',
		description: 'A confirmation expired.'
	})
});

/** Every message the Administration contribution registers, by its key. */
export const administrationMessages = Object.freeze({
	...sharedMessages,
	...usersMessages,
	...userMessages,
	...invitationsMessages,
	...importsMessages,
	...overviewMessages,
	...structureMessages,
	...rolesMessages,
	...recordsMessages,
	...operationsMessages,
	...progressionMessages,
	...problemCodeMessages,
	...jobTypeMessages,
	...jobStageMessages,
	...mailTemplateMessages
});

export type AdministrationMessage = keyof typeof administrationMessages;
