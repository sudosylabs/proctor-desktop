/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { defineMessage, type MessageDescriptor } from '../../../base/common/localization.js';

/** Window furniture: header, field, server summary, actions. */
export const launchMessages = Object.freeze({
	productName: defineMessage({
		id: 'launch.product',
		defaultMessage: 'Proctor',
		description: 'Product name in the LaunchWindow header.'
	}),
	serverLabel: defineMessage({
		id: 'launch.server.label',
		defaultMessage: 'Institution server',
		description: 'Label for the server address.'
	}),
	serverHelp: defineMessage({
		id: 'launch.server.help',
		defaultMessage: 'It’s in your exam instructions. You only enter it once.',
		description: 'Help under the server address field.'
	}),
	serverPlaceholder: defineMessage({
		id: 'launch.server.placeholder',
		defaultMessage: 'exams.your-school.edu',
		description: 'Example shown in the empty server address field.'
	}),
	invalidServer: defineMessage({
		id: 'launch.server.invalid',
		defaultMessage:
			'Enter only the server address, like exams.your-school.edu, without a path or sign-in details.',
		description: 'The server address is malformed or carries a path, query or credentials.'
	}),
	institutionUnconfirmed: defineMessage({
		id: 'launch.server.unconfirmed',
		defaultMessage: 'Institution not confirmed',
		description: 'Shown under a server address before its Institution is confirmed.'
	}),
	changeServer: defineMessage({
		id: 'launch.server.change',
		defaultMessage: 'Change',
		description: 'Choose a different server.'
	}),
	changeServerLabel: defineMessage({
		id: 'launch.server.change.label',
		defaultMessage: 'Change server',
		description: 'Accessible name of the Change action.'
	}),
	development: defineMessage({
		id: 'launch.development',
		defaultMessage: 'Development server · plain HTTP on this computer',
		description: 'Strip shown when an explicitly enabled development server uses HTTP loopback.'
	}),
	continue: defineMessage({
		id: 'launch.action.continue',
		defaultMessage: 'Continue',
		description: 'Check the entered server.'
	}),
	signIn: defineMessage({
		id: 'launch.action.signin',
		defaultMessage: 'Sign in to {institution}',
		description: 'Start browser sign-in for the confirmed Institution.'
	}),
	signInGeneric: defineMessage({
		id: 'launch.action.signin.generic',
		defaultMessage: 'Sign in',
		description: 'Start browser sign-in.'
	}),
	waiting: defineMessage({
		id: 'launch.action.waiting',
		defaultMessage: 'Waiting…',
		description: 'Disabled primary action during browser sign-in.'
	}),
	retry: defineMessage({
		id: 'launch.action.retry',
		defaultMessage: 'Retry',
		description: 'Run the readiness checks again.'
	}),
	checkAgain: defineMessage({
		id: 'launch.action.checkagain',
		defaultMessage: 'Check again',
		description: 'Run the readiness checks again after a version or sign-in problem.'
	}),
	tryAgain: defineMessage({
		id: 'launch.action.tryagain',
		defaultMessage: 'Try again',
		description: 'Start again after a failed sign-in.'
	}),
	cancel: defineMessage({
		id: 'launch.action.cancel',
		defaultMessage: 'Cancel',
		description: 'Stop the running check or sign-in.'
	}),
	reopenBrowser: defineMessage({
		id: 'launch.action.reopen',
		defaultMessage: 'Open the sign-in page again',
		description: 'Reopen the browser sign-in page.'
	}),
	actionFailed: defineMessage({
		id: 'launch.action.failed',
		defaultMessage: 'That didn’t work. Please try again.',
		description: 'A LaunchWindow action could not be completed.'
	}),
	institutionMessage: defineMessage({
		id: 'launch.institution.message',
		defaultMessage: 'Message from {institution}',
		description: 'Caption above a message written by the Institution.'
	}),
	institutionMessageGeneric: defineMessage({
		id: 'launch.institution.message.generic',
		defaultMessage: 'Message from your institution',
		description: 'Caption above an Institution message when its name is unknown.'
	}),
	recovery: defineMessage({
		id: 'launch.recovery',
		defaultMessage: 'Proctor couldn’t open safely. Quit and open Proctor again.',
		description: 'Shown when the LaunchWindow itself fails to start.'
	})
});

/** The readiness checklist. */
export const checklistMessages = Object.freeze({
	titleBefore: defineMessage({
		id: 'launch.checks.title.before',
		defaultMessage: 'Before you sign in, Proctor checks',
		description: 'Checklist heading before a server is entered.'
	}),
	title: defineMessage({
		id: 'launch.checks.title',
		defaultMessage: 'Checks',
		description: 'Checklist heading once a server is selected.'
	}),
	reach: defineMessage({
		id: 'launch.checks.reach',
		defaultMessage: 'Reach the server',
		description: 'First readiness check.'
	}),
	institution: defineMessage({
		id: 'launch.checks.institution',
		defaultMessage: 'Confirm the institution',
		description: 'Second check.'
	}),
	version: defineMessage({
		id: 'launch.checks.version',
		defaultMessage: 'Check this version',
		description: 'Third check.'
	}),
	signIn: defineMessage({
		id: 'launch.checks.signin',
		defaultMessage: 'Desktop sign-in',
		description: 'Fourth check.'
	}),
	statusDone: defineMessage({
		id: 'launch.checks.status.done',
		defaultMessage: 'Done',
		description: 'Screen-reader status of a passed check.'
	}),
	statusFailed: defineMessage({
		id: 'launch.checks.status.failed',
		defaultMessage: 'Failed',
		description: 'Status of a failed check.'
	}),
	statusAttention: defineMessage({
		id: 'launch.checks.status.attention',
		defaultMessage: 'Needs attention',
		description: 'Status of a check that is not failed but blocks sign-in.'
	}),
	statusActive: defineMessage({
		id: 'launch.checks.status.active',
		defaultMessage: 'In progress',
		description: 'Status of a running check.'
	}),
	statusPending: defineMessage({
		id: 'launch.checks.status.pending',
		defaultMessage: 'Not started',
		description: 'Status of a waiting check.'
	}),
	statusSkipped: defineMessage({
		id: 'launch.checks.status.skipped',
		defaultMessage: 'Skipped',
		description: 'Status of a skipped check.'
	}),
	connecting: defineMessage({
		id: 'launch.checks.detail.connecting',
		defaultMessage: 'Connecting…',
		description: 'Reach check in progress.'
	}),
	reached: defineMessage({
		id: 'launch.checks.detail.reached',
		defaultMessage: 'Reached',
		description: 'Reach check passed.'
	}),
	maintenance: defineMessage({
		id: 'launch.checks.detail.maintenance',
		defaultMessage: 'Under maintenance',
		description: 'Server maintenance.'
	}),
	unavailable: defineMessage({
		id: 'launch.checks.detail.unavailable',
		defaultMessage: 'Temporarily unavailable',
		description: 'Server temporarily unavailable.'
	}),
	noConnection: defineMessage({
		id: 'launch.checks.detail.noconnection',
		defaultMessage: 'No connection',
		description: 'Server unreachable.'
	}),
	noAnswer: defineMessage({
		id: 'launch.checks.detail.noanswer',
		defaultMessage: 'No answer',
		description: 'Server request timed out.'
	}),
	redirects: defineMessage({
		id: 'launch.checks.detail.redirects',
		defaultMessage: 'Redirects elsewhere',
		description: 'Server redirected the request.'
	}),
	notProctor: defineMessage({
		id: 'launch.checks.detail.notproctor',
		defaultMessage: 'Not a Proctor server',
		description: 'Malformed readiness response.'
	}),
	otherAddress: defineMessage({
		id: 'launch.checks.detail.otheraddress',
		defaultMessage: 'Reports another address',
		description: 'Canonical origin mismatch.'
	}),
	identityChanged: defineMessage({
		id: 'launch.checks.detail.identitychanged',
		defaultMessage: 'Changed since last check',
		description: 'Institution identity changed.'
	}),
	updateRequired: defineMessage({
		id: 'launch.checks.detail.update',
		defaultMessage: 'Update required',
		description: 'Build too old or revoked.'
	}),
	notCompatible: defineMessage({
		id: 'launch.checks.detail.incompatible',
		defaultMessage: 'Not compatible',
		description: 'Build incompatible.'
	}),
	platformBlocked: defineMessage({
		id: 'launch.checks.detail.platform',
		defaultMessage: 'This computer isn’t allowed',
		description: 'Platform not supported by the server.'
	}),
	opensInBrowser: defineMessage({
		id: 'launch.checks.detail.browser',
		defaultMessage: 'Opens in your browser',
		description: 'Sign-in check passed.'
	}),
	notInThisBuild: defineMessage({
		id: 'launch.checks.detail.notinbuild',
		defaultMessage: 'Not in this build',
		description: 'This build has no sign-in owner.'
	}),
	turnedOff: defineMessage({
		id: 'launch.checks.detail.turnedoff',
		defaultMessage: 'Turned off',
		description: 'Desktop sign-in is disabled.'
	}),
	methodUnsupported: defineMessage({
		id: 'launch.checks.detail.methodunsupported',
		defaultMessage: 'Method not supported',
		description: 'Sign-in protocol unsupported.'
	}),
	waitingForBrowser: defineMessage({
		id: 'launch.checks.detail.waiting',
		defaultMessage: 'Waiting for your browser',
		description: 'Browser sign-in in progress.'
	}),
	cancelled: defineMessage({
		id: 'launch.checks.detail.cancelled',
		defaultMessage: 'Cancelled',
		description: 'Sign-in cancelled.'
	}),
	expired: defineMessage({
		id: 'launch.checks.detail.expired',
		defaultMessage: 'Expired',
		description: 'Sign-in timed out.'
	}),
	notVerified: defineMessage({
		id: 'launch.checks.detail.notverified',
		defaultMessage: 'Response not verified',
		description: 'Sign-in callback invalid.'
	}),
	rejected: defineMessage({
		id: 'launch.checks.detail.rejected',
		defaultMessage: 'Not accepted',
		description: 'Server rejected sign-in.'
	}),
	sessionNotVerified: defineMessage({
		id: 'launch.checks.detail.sessionnotverified',
		defaultMessage: 'Sign in again',
		description: 'Saved sign-in could not be verified.'
	}),
	keyStorage: defineMessage({
		id: 'launch.checks.detail.keystorage',
		defaultMessage: 'Key storage unavailable',
		description: 'Secure key storage failed.'
	})
});

/** The status message under the checklist. */
export const statusMessages = Object.freeze({
	readyHead: defineMessage({
		id: 'launch.status.ready',
		defaultMessage: 'Ready to sign in',
		description: 'Every check passed.'
	}),
	readyBody: defineMessage({
		id: 'launch.status.ready.body',
		defaultMessage:
			'Sign-in continues in your browser. Proctor never asks for your password in this window.',
		description: 'Explains browser sign-in.'
	}),
	notInBuildHead: defineMessage({
		id: 'launch.status.notinbuild',
		defaultMessage: 'Sign-in isn’t available in this build',
		description: 'No sign-in owner is connected.'
	}),
	notInBuildBody: defineMessage({
		id: 'launch.status.notinbuild.body',
		defaultMessage: 'Install the version of Proctor your institution provides.',
		description: 'Next step when sign-in is missing from the build.'
	}),
	maintenanceHead: defineMessage({
		id: 'launch.status.maintenance',
		defaultMessage: '{institution} is under maintenance',
		description: 'Server maintenance with a known Institution.'
	}),
	maintenanceHeadGeneric: defineMessage({
		id: 'launch.status.maintenance.generic',
		defaultMessage: 'The server is under maintenance',
		description: 'Server maintenance before the Institution is known.'
	}),
	maintenanceBody: defineMessage({
		id: 'launch.status.maintenance.body',
		defaultMessage: 'Try again later, or contact your institution.',
		description: 'Next step during maintenance.'
	}),
	retryAfter: defineMessage({
		id: 'launch.status.retryafter',
		defaultMessage: 'Proctor will be available again after {time}. Retry then.',
		description: 'Advisory server retry time during maintenance, in the user’s locale.'
	}),
	unavailableHead: defineMessage({
		id: 'launch.status.unavailable',
		defaultMessage: 'The server is temporarily unavailable',
		description: 'Server temporarily unavailable.'
	}),
	unavailableBody: defineMessage({
		id: 'launch.status.unavailable.body',
		defaultMessage:
			'Try again in a few minutes. If it keeps happening, contact your institution.',
		description: 'Next step when the server is unavailable.'
	}),
	unreachableHead: defineMessage({
		id: 'launch.status.unreachable',
		defaultMessage: 'Couldn’t reach this server',
		description: 'Unreachable.'
	}),
	unreachableBody: defineMessage({
		id: 'launch.status.unreachable.body',
		defaultMessage: 'Check the address and your internet connection, then retry.',
		description: 'Next step when the server is unreachable.'
	}),
	timedOutHead: defineMessage({
		id: 'launch.status.timedout',
		defaultMessage: 'The server isn’t responding',
		description: 'Timed out.'
	}),
	timedOutBody: defineMessage({
		id: 'launch.status.timedout.body',
		defaultMessage: 'It may be busy, or your connection may be slow. Retry in a moment.',
		description: 'Next step after a timeout.'
	}),
	invalidResponseHead: defineMessage({
		id: 'launch.status.invalidresponse',
		defaultMessage: 'This doesn’t look like a Proctor server',
		description: 'Malformed readiness response.'
	}),
	invalidResponseBody: defineMessage({
		id: 'launch.status.invalidresponse.body',
		defaultMessage: 'Check the address, or ask your institution for the correct one.',
		description: 'Next step after a malformed response.'
	}),
	redirectHead: defineMessage({
		id: 'launch.status.redirect',
		defaultMessage: 'This address sends you somewhere else',
		description: 'Server redirected.'
	}),
	redirectBody: defineMessage({
		id: 'launch.status.redirect.body',
		defaultMessage:
			'Enter your institution’s Proctor address directly. Proctor doesn’t follow redirects.',
		description: 'Next step after a redirect.'
	}),
	originMismatchHead: defineMessage({
		id: 'launch.status.originmismatch',
		defaultMessage: 'The server reports a different address',
		description: 'Canonical origin mismatch.'
	}),
	originMismatchBody: defineMessage({
		id: 'launch.status.originmismatch.body',
		defaultMessage: 'Confirm the correct address with your institution before you continue.',
		description: 'Next step after an origin mismatch.'
	}),
	identityChangedHead: defineMessage({
		id: 'launch.status.identitychanged',
		defaultMessage: 'This server’s identity has changed',
		description: 'Institution identity changed between checks.'
	}),
	identityChangedBody: defineMessage({
		id: 'launch.status.identitychanged.body',
		defaultMessage:
			'It no longer matches the institution you used before. Don’t sign in until your institution confirms the address.',
		description: 'Next step after an identity change.'
	}),
	updateRequiredHead: defineMessage({
		id: 'launch.status.updaterequired',
		defaultMessage: 'This version of Proctor can’t sign in here',
		description: 'Build must be updated.'
	}),
	updateRequiredBody: defineMessage({
		id: 'launch.status.updaterequired.body',
		defaultMessage: 'Install the update your institution approved, then open Proctor again.',
		description: 'Next step when an update is required.'
	}),
	incompatibleHead: defineMessage({
		id: 'launch.status.incompatible',
		defaultMessage: 'This version doesn’t work with this server',
		description: 'Build and server incompatible.'
	}),
	incompatibleBody: defineMessage({
		id: 'launch.status.incompatible.body',
		defaultMessage: 'Ask your institution which version of Proctor to install.',
		description: 'Next step when incompatible.'
	}),
	unsupportedTargetHead: defineMessage({
		id: 'launch.status.unsupportedtarget',
		defaultMessage: 'This computer isn’t supported here',
		description: 'Platform not supported.'
	}),
	unsupportedTargetBody: defineMessage({
		id: 'launch.status.unsupportedtarget.body',
		defaultMessage:
			'This server doesn’t allow Proctor on {platform}. Use a supported computer, or contact your institution.',
		description: 'Next step when the platform is not supported.'
	}),
	authorizationDisabledHead: defineMessage({
		id: 'launch.status.authorizationdisabled',
		defaultMessage: 'Desktop sign-in is turned off',
		description: 'Server disabled desktop sign-in.'
	}),
	authorizationDisabledBody: defineMessage({
		id: 'launch.status.authorizationdisabled.body',
		defaultMessage:
			'Your institution has turned off sign-in from Proctor. Contact them for help.',
		description: 'Next step when sign-in is disabled.'
	}),
	authorizationUnsupportedHead: defineMessage({
		id: 'launch.status.authorizationunsupported',
		defaultMessage: 'This version can’t use the server’s sign-in',
		description: 'Sign-in protocol unsupported.'
	}),
	authorizationUnsupportedBody: defineMessage({
		id: 'launch.status.authorizationunsupported.body',
		defaultMessage: 'Install the version of Proctor your institution approved.',
		description: 'Next step when the sign-in protocol is unsupported.'
	}),
	authorizingHead: defineMessage({
		id: 'launch.status.authorizing',
		defaultMessage: 'Finish signing in in your browser',
		description: 'Browser sign-in in progress.'
	}),
	authorizingBody: defineMessage({
		id: 'launch.status.authorizing.body',
		defaultMessage:
			'A sign-in page opened in your default browser. This window continues by itself when you’re done.',
		description: 'Explains the browser hand-off.'
	}),
	cancelledHead: defineMessage({
		id: 'launch.status.cancelled',
		defaultMessage: 'Sign-in was cancelled',
		description: 'Sign-in cancelled.'
	}),
	cancelledBody: defineMessage({
		id: 'launch.status.cancelled.body',
		defaultMessage: 'Nothing was saved. Try again when you’re ready.',
		description: 'Next step after cancelling.'
	}),
	expiredHead: defineMessage({
		id: 'launch.status.expired',
		defaultMessage: 'Sign-in took too long',
		description: 'Sign-in timed out.'
	}),
	expiredBody: defineMessage({
		id: 'launch.status.expired.body',
		defaultMessage:
			'The sign-in page expired before you finished. Start again from this window.',
		description: 'Next step after expiry.'
	}),
	notVerifiedHead: defineMessage({
		id: 'launch.status.notverified',
		defaultMessage: 'Proctor couldn’t verify the sign-in',
		description: 'Callback invalid.'
	}),
	notVerifiedBody: defineMessage({
		id: 'launch.status.notverified.body',
		defaultMessage:
			'The response from your browser didn’t match this sign-in. Start again from this window.',
		description: 'Next step after an invalid callback.'
	}),
	unavailableSignInHead: defineMessage({
		id: 'launch.status.signinunavailable',
		defaultMessage: 'Sign-in is unavailable',
		description: 'Sign-in could not reach the server.'
	}),
	unavailableSignInBody: defineMessage({
		id: 'launch.status.signinunavailable.body',
		defaultMessage: 'Check your connection and try again.',
		description: 'Next step when sign-in is unavailable.'
	}),
	rejectedHead: defineMessage({
		id: 'launch.status.rejected',
		defaultMessage: 'The server couldn’t complete sign-in',
		description: 'Server rejected sign-in.'
	}),
	rejectedBody: defineMessage({
		id: 'launch.status.rejected.body',
		defaultMessage: 'Try again.',
		description: 'Next step after rejection.'
	}),
	keyStorageHead: defineMessage({
		id: 'launch.status.keystorage',
		defaultMessage: 'Proctor couldn’t use secure key storage',
		description: 'Key storage failed.'
	}),
	keyStorageBody: defineMessage({
		id: 'launch.status.keystorage.body',
		defaultMessage:
			'Restart your computer and try again. If it keeps happening, contact your institution.',
		description: 'Next step after a key storage failure.'
	})
});

/** One-line notices about how the previous session ended. */
export const sessionMessages = Object.freeze({
	ending: defineMessage({
		id: 'launch.session.ending',
		defaultMessage: 'Signing out…',
		description: 'Sign-out cleanup is finishing.'
	}),
	refreshFailed: defineMessage({
		id: 'launch.session.refreshfailed',
		defaultMessage: 'Your session couldn’t be verified. Sign in again to continue.',
		description: 'A refresh failed or was ambiguous.'
	}),
	cleared: defineMessage({
		id: 'launch.session.cleared',
		defaultMessage: 'Signed out.',
		description: 'Local and server sign-out confirmed.'
	}),
	remoteUnconfirmed: defineMessage({
		id: 'launch.session.remoteunconfirmed',
		defaultMessage:
			'Signed out on this computer. Proctor couldn’t confirm sign-out with the server.',
		description: 'Server revocation unconfirmed.'
	}),
	localUnconfirmed: defineMessage({
		id: 'launch.session.localunconfirmed',
		defaultMessage:
			'The server session ended, but Proctor couldn’t confirm cleanup on this computer.',
		description: 'Local cleanup unconfirmed.'
	}),
	bothUnconfirmed: defineMessage({
		id: 'launch.session.bothunconfirmed',
		defaultMessage: 'Proctor couldn’t confirm sign-out on this computer or with the server.',
		description: 'Neither cleanup outcome confirmed.'
	})
});

export const allLaunchMessages: readonly MessageDescriptor[] = Object.freeze([
	...Object.values(launchMessages),
	...Object.values(checklistMessages),
	...Object.values(statusMessages),
	...Object.values(sessionMessages)
]);
