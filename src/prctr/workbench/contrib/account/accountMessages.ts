/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { defineMessage } from '../../../base/common/localization.js';
import { pageMessages } from '../../browser/authenticated/pages/pageMessages.js';
import { profileMessages } from './profile/profileMessages.js';
import { securityMessages } from './security/securityMessages.js';
import { sessionsMessages } from './sessions/sessionsMessages.js';
import { tokensMessages } from './tokens/tokensMessages.js';
import { auditsMessages } from './audits/auditsMessages.js';
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
	recheckFirst: defineMessage({
		id: 'account.state.recheck.first',
		defaultMessage:
			'Proctor is checking whether the last change worked. Try again after the list refreshes.',
		description: 'An action is blocked until an unknown outcome is read again.'
	}),
	actionFailed: defineMessage({
		id: 'account.action.failed',
		defaultMessage: 'That action could not be completed.',
		description: 'A menu action failed unexpectedly.'
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
	waysDescription: defineMessage({
		id: 'account.security.ways.description',
		defaultMessage: '{institution} lets you use these.',
		description: 'Description of sign-in methods; institution is its name.'
	}),
	waysDescriptionGeneric: defineMessage({
		id: 'account.security.ways.description.generic',
		defaultMessage: 'Your institution lets you use these.',
		description: 'Description of sign-in methods when the institution name is unknown.'
	}),
	singleSignOn: defineMessage({
		id: 'account.security.single.sign.on',
		defaultMessage: 'Single sign-on',
		description: 'A linked institution sign-in provider.'
	}),
	twoStepDescription: defineMessage({
		id: 'account.security.two.step.description',
		defaultMessage:
			'A second check after your password, such as a code from an authenticator app.',
		description: 'Explains two-step verification.'
	}),
	recoveryCodesLowOf: defineMessage({
		id: 'account.security.recovery.codes.low.of',
		defaultMessage: '{count} of {total} left · Get new ones before you run out',
		description: 'Few of the issued recovery codes remain.'
	}),
	twoStepOnSince: defineMessage({
		id: 'account.security.two.step.on.since',
		defaultMessage: 'On · Authenticator app, since {date}',
		description: 'Two-step verification is on with an authenticator app, turned on at date.'
	}),
	twoStepOnApp: defineMessage({
		id: 'account.security.two.step.on.app',
		defaultMessage: 'On · Authenticator app',
		description: 'Two-step verification is on with an authenticator app.'
	}),
	passwordChanged: defineMessage({
		id: 'account.security.password.changed',
		defaultMessage: 'Set · Changed {date}',
		description: 'A password is set and was last changed at date.'
	}),
	recoveryCodesLow: defineMessage({
		id: 'account.security.recovery.codes.low',
		defaultMessage: '{count} left · Get new ones before you run out',
		description: 'Few recovery codes remain.'
	}),
	otherSessionsDescription: defineMessage({
		id: 'account.sessions.other.description',
		defaultMessage: 'Places you are signed in right now.',
		description: 'Describes other sessions.'
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
	noInactiveTokens: defineMessage({
		id: 'account.tokens.inactive.empty',
		defaultMessage: 'None.',
		description: 'No inactive tokens.'
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
	selectToCopy: defineMessage({
		id: 'account.tokens.select.to.copy',
		defaultMessage: 'Select the token and copy it.',
		description: 'How to copy when no clipboard is available.'
	}),
	historyEventAcademicUnitJoined: defineMessage({
		id: 'account.history.event.academic.unit.joined',
		defaultMessage: 'Joined an academic unit',
		description: 'Account history event academic_unit.joined.'
	}),
	historyEventAcademicUnitLeft: defineMessage({
		id: 'account.history.event.academic.unit.left',
		defaultMessage: 'Left an academic unit',
		description: 'Account history event academic_unit.left.'
	}),
	historyEventAccountDisabled: defineMessage({
		id: 'account.history.event.account.disabled',
		defaultMessage: 'Account turned off',
		description: 'Account history event account.disabled.'
	}),
	historyEventAccountEnabled: defineMessage({
		id: 'account.history.event.account.enabled',
		defaultMessage: 'Account turned back on',
		description: 'Account history event account.enabled.'
	}),
	historyEventAccountRecoveredByAdministrator: defineMessage({
		id: 'account.history.event.account.recovered.by.administrator',
		defaultMessage: 'Account recovered by an administrator',
		description: 'Account history event account.recovered_by_administrator.'
	}),
	historyEventAffiliationEnded: defineMessage({
		id: 'account.history.event.affiliation.ended',
		defaultMessage: 'Affiliation ended',
		description: 'Account history event affiliation.ended.'
	}),
	historyEventAffiliationStarted: defineMessage({
		id: 'account.history.event.affiliation.started',
		defaultMessage: 'Affiliation started',
		description: 'Account history event affiliation.started.'
	}),
	historyEventClassEnrolled: defineMessage({
		id: 'account.history.event.class.enrolled',
		defaultMessage: 'Enrolled in a class',
		description: 'Account history event class.enrolled.'
	}),
	historyEventClassTransferredIn: defineMessage({
		id: 'account.history.event.class.transferred.in',
		defaultMessage: 'Moved into a class',
		description: 'Account history event class.transferred_in.'
	}),
	historyEventClassTransferredOut: defineMessage({
		id: 'account.history.event.class.transferred.out',
		defaultMessage: 'Moved out of a class',
		description: 'Account history event class.transferred_out.'
	}),
	historyEventClassUnenrolled: defineMessage({
		id: 'account.history.event.class.unenrolled',
		defaultMessage: 'Removed from a class',
		description: 'Account history event class.unenrolled.'
	}),
	historyEventDesktopRegistrationRevoked: defineMessage({
		id: 'account.history.event.desktop.registration.revoked',
		defaultMessage: 'Removed a registered desktop',
		description: 'Account history event desktop.registration_revoked.'
	}),
	historyEventDesktopSignedIn: defineMessage({
		id: 'account.history.event.desktop.signed.in',
		defaultMessage: 'Signed in on Proctor Desktop',
		description: 'Account history event desktop.signed_in.'
	}),
	historyEventEmailChangeUndone: defineMessage({
		id: 'account.history.event.email.change.undone',
		defaultMessage: 'Email change undone',
		description: 'Account history event email.change_undone.'
	}),
	historyEventEmailChanged: defineMessage({
		id: 'account.history.event.email.changed',
		defaultMessage: 'Changed email address',
		description: 'Account history event email.changed.'
	}),
	historyEventEmailVerified: defineMessage({
		id: 'account.history.event.email.verified',
		defaultMessage: 'Verified email address',
		description: 'Account history event email.verified.'
	}),
	historyEventInvitationAccepted: defineMessage({
		id: 'account.history.event.invitation.accepted',
		defaultMessage: 'Accepted an invitation',
		description: 'Account history event invitation.accepted.'
	}),
	historyEventMfaDisabled: defineMessage({
		id: 'account.history.event.mfa.disabled',
		defaultMessage: 'Turned off two-step verification',
		description: 'Account history event mfa.disabled.'
	}),
	historyEventMfaEnabled: defineMessage({
		id: 'account.history.event.mfa.enabled',
		defaultMessage: 'Turned on two-step verification',
		description: 'Account history event mfa.enabled.'
	}),
	historyEventMfaRecoveryCodesRegenerated: defineMessage({
		id: 'account.history.event.mfa.recovery.codes.regenerated',
		defaultMessage: 'Got new recovery codes',
		description: 'Account history event mfa.recovery_codes_regenerated.'
	}),
	historyEventMfaResetByAdministrator: defineMessage({
		id: 'account.history.event.mfa.reset.by.administrator',
		defaultMessage: 'Two-step verification reset',
		description: 'Account history event mfa.reset_by_administrator.'
	}),
	historyEventMfaSetupStarted: defineMessage({
		id: 'account.history.event.mfa.setup.started',
		defaultMessage: 'Started setting up two-step verification',
		description: 'Account history event mfa.setup_started.'
	}),
	historyEventPasswordChanged: defineMessage({
		id: 'account.history.event.password.changed',
		defaultMessage: 'Changed password',
		description: 'Account history event password.changed.'
	}),
	historyEventPasswordEnrolled: defineMessage({
		id: 'account.history.event.password.enrolled',
		defaultMessage: 'Set a password',
		description: 'Account history event password.enrolled.'
	}),
	historyEventPasswordRemoved: defineMessage({
		id: 'account.history.event.password.removed',
		defaultMessage: 'Removed password',
		description: 'Account history event password.removed.'
	}),
	historyEventPasswordReset: defineMessage({
		id: 'account.history.event.password.reset',
		defaultMessage: 'Reset password',
		description: 'Account history event password.reset.'
	}),
	historyEventPersonalAccessTokenCreated: defineMessage({
		id: 'account.history.event.personal.access.token.created',
		defaultMessage: 'Created an access token',
		description: 'Account history event personal_access_token.created.'
	}),
	historyEventPersonalAccessTokenDisabled: defineMessage({
		id: 'account.history.event.personal.access.token.disabled',
		defaultMessage: 'Disabled an access token',
		description: 'Account history event personal_access_token.disabled.'
	}),
	historyEventPersonalAccessTokenEnabled: defineMessage({
		id: 'account.history.event.personal.access.token.enabled',
		defaultMessage: 'Turned an access token back on',
		description: 'Account history event personal_access_token.enabled.'
	}),
	historyEventPersonalAccessTokenRevoked: defineMessage({
		id: 'account.history.event.personal.access.token.revoked',
		defaultMessage: 'Revoked an access token',
		description: 'Account history event personal_access_token.revoked.'
	}),
	historyEventProfileChanged: defineMessage({
		id: 'account.history.event.profile.changed',
		defaultMessage: 'Profile changed',
		description: 'Account history event profile.changed.'
	}),
	historyEventProfilePictureChanged: defineMessage({
		id: 'account.history.event.profile.picture.changed',
		defaultMessage: 'Changed profile photo',
		description: 'Account history event profile_picture.changed.'
	}),
	historyEventProfilePictureRemoved: defineMessage({
		id: 'account.history.event.profile.picture.removed',
		defaultMessage: 'Removed profile photo',
		description: 'Account history event profile_picture.removed.'
	}),
	historyEventProviderUnlinked: defineMessage({
		id: 'account.history.event.provider.unlinked',
		defaultMessage: 'Sign-in provider unlinked',
		description: 'Account history event provider.unlinked.'
	}),
	historyEventRoleEnded: defineMessage({
		id: 'account.history.event.role.ended',
		defaultMessage: 'Role ended',
		description: 'Account history event role.ended.'
	}),
	historyEventRoleGranted: defineMessage({
		id: 'account.history.event.role.granted',
		defaultMessage: 'Role granted',
		description: 'Account history event role.granted.'
	}),
	historyEventSessionRevoked: defineMessage({
		id: 'account.history.event.session.revoked',
		defaultMessage: 'Ended a session',
		description: 'Account history event session.revoked.'
	}),
	historyEventSessionsRevokedAll: defineMessage({
		id: 'account.history.event.sessions.revoked.all',
		defaultMessage: 'Ended every session',
		description: 'Account history event sessions.revoked_all.'
	}),
	historyEventSessionsRevokedOthers: defineMessage({
		id: 'account.history.event.sessions.revoked.others',
		defaultMessage: 'Ended all other sessions',
		description: 'Account history event sessions.revoked_others.'
	}),
	historyEventSignInFailed: defineMessage({
		id: 'account.history.event.sign.in.failed',
		defaultMessage: 'Sign-in failed',
		description: 'Account history event sign_in.failed.'
	}),
	historyEventSignInSucceeded: defineMessage({
		id: 'account.history.event.sign.in.succeeded',
		defaultMessage: 'Signed in',
		description: 'Account history event sign_in.succeeded.'
	}),
	historyEventSignOut: defineMessage({
		id: 'account.history.event.sign.out',
		defaultMessage: 'Signed out',
		description: 'Account history event sign_out.'
	}),
	historyEventOther: defineMessage({
		id: 'account.history.event.other',
		defaultMessage: 'Other account activity',
		description: 'An account history event this release has no label for.'
	}),
	historyTitle: defineMessage({
		id: 'account.page.history.title',
		defaultMessage: 'Audits',
		description: 'Heading of the Audits page: what was done with the account.'
	}),
	historyDescription: defineMessage({
		id: 'account.page.history.description',
		defaultMessage:
			'Everything done with your account, by you, an administrator or Proctor itself.',
		description: 'Description under the Audits heading.'
	}),
	historyBySelf: defineMessage({
		id: 'account.history.by.self',
		defaultMessage: 'You',
		description: 'The person did it themself.'
	}),
	historyByAdministrator: defineMessage({
		id: 'account.history.by.administrator',
		defaultMessage: 'An administrator',
		description: 'Someone with authority over the account did it; they are never named.'
	}),
	historyBySystem: defineMessage({
		id: 'account.history.by.system',
		defaultMessage: 'Proctor',
		description: 'No signed-in person did it, such as a background job or an emailed link.'
	})
});

/** Every message the Account contribution registers, shared and page-owned, by its key. */
export const accountMessages = Object.freeze({
	...sharedMessages,
	...profileMessages,
	...securityMessages,
	...sessionsMessages,
	...tokensMessages,
	...auditsMessages,
	...settingsMessages
});

/** Account text by key, including the page text the window's frame registers. */
export const accountText = Object.freeze({ ...pageMessages, ...accountMessages });

export type AccountMessage = keyof typeof accountText;
