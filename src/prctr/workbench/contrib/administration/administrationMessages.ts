/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { defineMessage } from '../../../base/common/localization.js';

/** Text the Administration pane and every Administration page share: page headings and failures. */
export const administrationMessages = Object.freeze({
	overviewTitle: defineMessage({
		id: 'administration.page.overview.title',
		defaultMessage: 'Overview',
		description: 'Heading of the Administration Overview page.'
	}),
	overviewDescription: defineMessage({
		id: 'administration.page.overview.description',
		defaultMessage: 'What needs your attention at {institution}.',
		description: 'One-line description under the Overview heading.'
	}),
	overviewDescriptionGeneric: defineMessage({
		id: 'administration.page.overview.description.generic',
		defaultMessage: 'What needs your attention.',
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
		defaultMessage: 'Invitations to join classes, units and roles, and how their emails are doing.',
		description: 'One-line description under the Invitations heading.'
	}),
	importsTitle: defineMessage({
		id: 'administration.page.imports.title',
		defaultMessage: 'Imports',
		description: 'Heading of the Administration Imports page.'
	}),
	importsDescription: defineMessage({
		id: 'administration.page.imports.description',
		defaultMessage: 'Add many people at once from a spreadsheet, and review each row before anything changes.',
		description: 'One-line description under the Imports heading.'
	}),
	structureTitle: defineMessage({
		id: 'administration.page.structure.title',
		defaultMessage: 'Structure',
		description: 'Heading of the Administration Structure page.'
	}),
	structureDescription: defineMessage({
		id: 'administration.page.structure.description',
		defaultMessage: 'Academic units, their programmes and levels, and the classes in them.',
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
		defaultMessage: 'The terms and years that classes and enrolments belong to.',
		description: 'One-line description under the Academic periods heading.'
	}),
	rolesTitle: defineMessage({
		id: 'administration.page.roles.title',
		defaultMessage: 'Roles',
		description: 'Heading of the Administration Roles page.'
	}),
	rolesDescription: defineMessage({
		id: 'administration.page.roles.description',
		defaultMessage: 'What each role lets people do, and where.',
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
		defaultMessage: 'Everything that changed at {institution}, who did it and when.',
		description: 'One-line description under the Audits heading.'
	}),
	auditsDescriptionGeneric: defineMessage({
		id: 'administration.page.audits.description.generic',
		defaultMessage: 'Everything that changed, who did it and when.',
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
		defaultMessage: 'Background work such as imports, previews and key rotation.',
		description: 'One-line description under the Jobs heading.'
	}),
	mailTitle: defineMessage({
		id: 'administration.page.mail.title',
		defaultMessage: 'Mail',
		description: 'Heading of the Administration Mail page.'
	}),
	mailDescription: defineMessage({
		id: 'administration.page.mail.description',
		defaultMessage: 'Whether mail from {institution} is being delivered.',
		description: 'One-line description under the Mail heading.'
	}),
	mailDescriptionGeneric: defineMessage({
		id: 'administration.page.mail.description.generic',
		defaultMessage: 'Whether mail is being delivered.',
		description: 'Mail description when the institution name is unknown.'
	}),
	pageUnavailable: defineMessage({
		id: 'administration.page.unavailable',
		defaultMessage: 'This Administration page could not be opened.',
		description: 'Shown in the sidebar when an Administration page fails to open.'
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
		defaultMessage: 'Someone else changed this first. Look at the latest version and try again.',
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

export type AdministrationMessage = keyof typeof administrationMessages;
