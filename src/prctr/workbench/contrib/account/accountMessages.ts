/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { defineMessage } from '../../../base/common/localization.js';
import { pageMessages } from '../../browser/authenticated/pages/pageMessages.js';
import { profileMessages } from './profile/profileMessages.js';
import { securityMessages } from './security/securityMessages.js';
import { sessionsMessages } from './sessions/sessionsMessages.js';
import { tokensMessages } from './tokens/tokensMessages.js';
import { historyMessages } from './history/historyMessages.js';
import { settingsMessages } from './settings/settingsMessages.js';

/** Text every Account page shares: titles, section states, failures and shared tables. */
const sharedMessages = Object.freeze({
	profileTitle: defineMessage({
		id: 'account.page.profile.title',
		defaultMessage: 'Profile',
		description: 'Heading of the Account Profile page.'
	}),
	profileDescription: defineMessage({
		id: 'account.page.profile.description',
		defaultMessage: 'How you appear to teachers, students and administrators at {institution}.',
		description: 'One-line description under the Profile heading; institution is its name.'
	}),
	profileDescriptionGeneric: defineMessage({
		id: 'account.page.profile.description.generic',
		defaultMessage: 'How you appear to teachers, students and administrators.',
		description: 'Profile description when the institution name is unknown.'
	}),
	securityTitle: defineMessage({
		id: 'account.page.security.title',
		defaultMessage: 'Sign-in and security',
		description: 'Heading of the Account Sign-in and security page.'
	}),
	securityDescription: defineMessage({
		id: 'account.page.security.description',
		defaultMessage: 'How you sign in to Proctor, and what protects your account.',
		description: 'Description under the Sign-in and security heading.'
	}),
	sessionsTitle: defineMessage({
		id: 'account.page.sessions.title',
		defaultMessage: 'Sessions and devices',
		description: 'Heading of the Account Sessions and devices page.'
	}),
	sessionsDescription: defineMessage({
		id: 'account.page.sessions.description',
		defaultMessage: 'Where your account is signed in. End anything you don’t recognise.',
		description: 'Description under the Sessions and devices heading.'
	}),
	tokensTitle: defineMessage({
		id: 'account.page.tokens.title',
		defaultMessage: 'Access tokens',
		description: 'Heading of the Account Access tokens page.'
	}),
	tokensDescription: defineMessage({
		id: 'account.page.tokens.description',
		defaultMessage:
			'Let a script or tool use Proctor as you, with only the permissions you give it.',
		description: 'Description under the Access tokens heading.'
	}),
	pageUnavailable: defineMessage({
		id: 'account.page.unavailable',
		defaultMessage: 'This Account page could not be opened.',
		description: 'Shown in the sidebar when an Account page fails to open.'
	}),
	settingsTitle: defineMessage({
		id: 'account.page.settings.title',
		defaultMessage: 'Settings',
		description: 'Heading of the Settings page.'
	}),
	settingsDescription: defineMessage({
		id: 'account.page.settings.description',
		defaultMessage: 'Saved to your account, so they follow you to any computer you sign in on.',
		description: 'Description under the Settings heading.'
	}),
	pixels: defineMessage({
		id: 'account.settings.pixels',
		defaultMessage: '{value} px',
		description: 'A size in pixels.'
	}),
	actionFailed: defineMessage({
		id: 'account.action.failed',
		defaultMessage: 'That action could not be completed.',
		description: 'A menu action failed unexpectedly.'
	}),
	failureBusy: defineMessage({
		id: 'account.failure.busy',
		defaultMessage: 'Other changes to this are still being saved. Try again in a moment.',
		description: 'Too many changes to the same account data are already waiting.'
	}),
	failureUnavailable: defineMessage({
		id: 'account.failure.unavailable',
		defaultMessage: 'The server can’t be reached right now. Try again in a moment.',
		description: 'Account server is unavailable.'
	}),
	failureSessionEnded: defineMessage({
		id: 'account.failure.session.ended',
		defaultMessage: 'Your session has ended. Sign in again to continue.',
		description: 'The Session bound to this window has ended.'
	}),
	failureReauthentication: defineMessage({
		id: 'account.failure.reauthentication',
		defaultMessage: 'For your security, sign in again before making this change.',
		description: 'The server requires recent interactive authentication.'
	}),
	failureStrongAuthentication: defineMessage({
		id: 'account.failure.strong.authentication',
		defaultMessage:
			'This change needs a stronger sign-in, such as two-step verification. Sign in again that way, then try again.',
		description: 'The server requires stronger authentication.'
	}),
	failureDenied: defineMessage({
		id: 'account.failure.denied',
		defaultMessage: 'Your account isn’t allowed to do this.',
		description: 'The server denied the action.'
	}),
	failureNotFound: defineMessage({
		id: 'account.failure.not.found',
		defaultMessage: 'This no longer exists. The list is being refreshed.',
		description: 'The item was not found.'
	}),
	failureUnconfirmed: defineMessage({
		id: 'account.failure.unconfirmed',
		defaultMessage:
			'Proctor couldn’t confirm whether this worked. The list is being refreshed; check it before trying again.',
		description: 'The outcome of a change is unknown.'
	}),
	failureConflict: defineMessage({
		id: 'account.failure.conflict',
		defaultMessage:
			'This changed somewhere else. The list is being refreshed; review it and try again.',
		description: 'The item changed concurrently.'
	}),
	tokenEnableSummary: defineMessage({
		id: 'account.tokens.enable.summary',
		defaultMessage: 'Turns this token back on until it expires.',
		description: 'What confirming does, when turning a disabled token back on.'
	}),
	failureCancelled: defineMessage({
		id: 'account.failure.cancelled',
		defaultMessage: 'Stopped before it finished. Nothing changed.',
		description: 'The person cancelled a browser step, or it was cancelled in Proctor.'
	}),
	failureExpired: defineMessage({
		id: 'account.failure.expired',
		defaultMessage: 'The page in your browser expired before you finished. Try again.',
		description: 'A browser step was not completed in time.'
	}),
	failureInvalid: defineMessage({
		id: 'account.failure.invalid',
		defaultMessage: 'The server didn’t accept this. Check the details and try again.',
		description: 'The server rejected the request as invalid.'
	}),
	language: defineMessage({
		id: 'account.profile.language',
		defaultMessage: 'Language',
		description: 'Account detail label.'
	}),
	noticeWork: defineMessage({
		id: 'account.notice.work',
		defaultMessage: 'Your submitted work',
		description: 'Retention notice category: the candidate’s submitted work.'
	}),
	noticeIntegrity: defineMessage({
		id: 'account.notice.integrity',
		defaultMessage: 'Exam integrity records',
		description: 'Retention notice category: integrity records.'
	}),
	noticeBrowserActivity: defineMessage({
		id: 'account.notice.browser.activity',
		defaultMessage: 'Browser activity during an exam',
		description: 'Retention notice category: integrated browser activity.'
	}),
	noticeSecurityOperational: defineMessage({
		id: 'account.notice.security.operational',
		defaultMessage: 'Security and operational records',
		description: 'Retention notice category: security and operational records.'
	}),
	noticeDeletedAfter: defineMessage({
		id: 'account.notice.deleted.after',
		defaultMessage: 'Deleted after {date}',
		description: 'When a record is due for deletion.'
	}),
	noticeDeletionCanceled: defineMessage({
		id: 'account.notice.deletion.canceled',
		defaultMessage: 'Deletion canceled {date}',
		description: 'A record’s deletion was canceled.'
	}),
	noticeDeleted: defineMessage({
		id: 'account.notice.deleted',
		defaultMessage: 'Deleted',
		description: 'A record has been deleted.'
	}),
	singleSignOn: defineMessage({
		id: 'account.security.single.sign.on',
		defaultMessage: 'Single sign-on',
		description: 'A linked institution sign-in provider.'
	}),
	sessionEnded: defineMessage({
		id: 'account.sessions.ended',
		defaultMessage: 'Session ended.',
		description: 'Another session was ended.'
	}),
	clientWeb: defineMessage({
		id: 'account.client.web',
		defaultMessage: 'Web browser',
		description: 'Session client: web.'
	}),
	clientDesktop: defineMessage({
		id: 'account.client.desktop',
		defaultMessage: 'Proctor Desktop',
		description: 'Session client: desktop.'
	}),
	clientCli: defineMessage({
		id: 'account.client.cli',
		defaultMessage: 'Command line',
		description: 'Session client: command line.'
	}),
	clientOther: defineMessage({
		id: 'account.client.other',
		defaultMessage: 'Other app',
		description: 'Session client: unknown.'
	}),
	platformMac: defineMessage({
		id: 'account.platform.mac',
		defaultMessage: 'macOS',
		description: 'Desktop platform.'
	}),
	platformWindows: defineMessage({
		id: 'account.platform.windows',
		defaultMessage: 'Windows',
		description: 'Desktop platform.'
	}),
	platformLinux: defineMessage({
		id: 'account.platform.linux',
		defaultMessage: 'Linux',
		description: 'Desktop platform.'
	}),
	platformOther: defineMessage({
		id: 'account.platform.other',
		defaultMessage: 'Other system',
		description: 'Desktop platform: unknown.'
	}),
	tokenNameRequired: defineMessage({
		id: 'account.tokens.name.required',
		defaultMessage: 'Enter a name.',
		description: 'The token name is empty.'
	}),
	tokenNameTooLong: defineMessage({
		id: 'account.tokens.name.too.long',
		defaultMessage: 'Use 256 characters or fewer.',
		description: 'The token name is too long.'
	}),
	tokenNameInvalid: defineMessage({
		id: 'account.tokens.name.invalid',
		defaultMessage: 'Use letters, numbers, spaces and punctuation only.',
		description: 'The token name has control characters.'
	}),
	tokenScopesRequired: defineMessage({
		id: 'account.tokens.scopes.required',
		defaultMessage: 'Tick at least one thing the token can do.',
		description: 'No scope is selected.'
	}),
	historyTitle: defineMessage({
		id: 'account.page.history.title',
		defaultMessage: 'Account history',
		description: 'Heading of the Account history page: what was done with the account.'
	}),
	historyDescription: defineMessage({
		id: 'account.page.history.description',
		defaultMessage:
			'Everything done with your account or by it: by you, an administrator or Proctor itself.',
		description: 'Description under the Account history heading.'
	})
});

/** Every message the Account contribution registers, shared and page-owned, by its key. */
export const accountMessages = Object.freeze({
	...sharedMessages,
	...profileMessages,
	...securityMessages,
	...sessionsMessages,
	...tokensMessages,
	...historyMessages,
	...settingsMessages
});

/** Account text by key, including the page text the window's frame registers. */
export const accountText = Object.freeze({ ...pageMessages, ...accountMessages });

export type AccountMessage = keyof typeof accountText;
