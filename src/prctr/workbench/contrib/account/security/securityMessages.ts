/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { defineMessage } from '../../../../base/common/localization.js';

/** Text of the Account Sign-in and security page. */
export const securityMessages = Object.freeze({
	statusLinked: defineMessage({
		id: 'account.status.linked',
		defaultMessage: 'Linked',
		description: 'Status word: a sign-in provider is linked.'
	}),
	statusSet: defineMessage({
		id: 'account.status.set',
		defaultMessage: 'Set',
		description: 'Status word: a password is set.'
	}),
	statusNotSet: defineMessage({
		id: 'account.status.not.set',
		defaultMessage: 'Not set',
		description: 'Status word: no password is set.'
	}),
	statusOn: defineMessage({
		id: 'account.status.on',
		defaultMessage: 'On',
		description: 'Status word: two-step verification is on.'
	}),
	statusOff: defineMessage({
		id: 'account.status.off',
		defaultMessage: 'Off',
		description: 'Status word: two-step verification is off.'
	}),
	statusNeedsAttention: defineMessage({
		id: 'account.status.attention',
		defaultMessage: 'Needs attention',
		description: 'Status word: something about two-step verification needs the person.'
	}),
	passwordChangedOn: defineMessage({
		id: 'account.security.password.changed.on',
		defaultMessage: 'Changed {date}',
		description: 'When the password was last changed.'
	}),
	twoStepApp: defineMessage({
		id: 'account.security.two.step.app',
		defaultMessage: 'Authenticator app',
		description: 'Two-step verification uses an authenticator app.'
	}),
	twoStepAppSince: defineMessage({
		id: 'account.security.two.step.app.since',
		defaultMessage: 'Authenticator app · On since {date}',
		description: 'Two-step verification uses an authenticator app, on since date.'
	}),
	recoveryCodesIssued: defineMessage({
		id: 'account.security.recovery.codes.issued',
		defaultMessage: 'Issued {date} · Each code works once',
		description: 'When the recovery codes were issued.'
	}),
	recoveryCodesOnce: defineMessage({
		id: 'account.security.recovery.codes.once',
		defaultMessage: 'Each code works once',
		description: 'Recovery codes detail when the issue date is unknown.'
	}),
	openSecurity: defineMessage({
		id: 'account.security.open',
		defaultMessage: 'Open security page',
		description: 'Open the server-hosted security page in the browser.'
	}),
	securityOpened: defineMessage({
		id: 'account.security.opened',
		defaultMessage: 'The security page opened in your browser.',
		description: 'The hosted security page was opened.'
	}),
	waysToSignIn: defineMessage({
		id: 'account.security.ways',
		defaultMessage: 'Ways to sign in',
		description: 'Heading of the sign-in methods.'
	}),
	password: defineMessage({
		id: 'account.security.password',
		defaultMessage: 'Password',
		description: 'Password sign-in method.'
	}),
	passwordSet: defineMessage({
		id: 'account.security.password.set',
		defaultMessage: 'Set',
		description: 'A password is set.'
	}),
	passwordNotSet: defineMessage({
		id: 'account.security.password.not.set',
		defaultMessage: 'Not set',
		description: 'No password is set.'
	}),
	otherProvider: defineMessage({
		id: 'account.security.other.provider',
		defaultMessage: 'Linked sign-in',
		description: 'A linked sign-in provider of another kind.'
	}),
	twoStep: defineMessage({
		id: 'account.security.two.step',
		defaultMessage: 'Two-step verification',
		description: 'Heading and row title of two-step verification.'
	}),
	twoStepOn: defineMessage({
		id: 'account.security.two.step.on',
		defaultMessage: 'On',
		description: 'Two-step verification is on.'
	}),
	twoStepOff: defineMessage({
		id: 'account.security.two.step.off',
		defaultMessage: 'Off · Turn it on from the security page',
		description: 'Two-step verification is off.'
	}),
	twoStepPending: defineMessage({
		id: 'account.security.two.step.pending',
		defaultMessage: 'Setup isn’t finished · Finish it on the security page',
		description: 'Two-step verification enrolment is pending.'
	}),
	twoStepRecoveryRequired: defineMessage({
		id: 'account.security.two.step.recovery.required',
		defaultMessage: 'Needs recovery · Set it up again on the security page',
		description: 'Two-step verification needs recovery.'
	}),
	twoStepServiceUnavailable: defineMessage({
		id: 'account.security.two.step.service.unavailable',
		defaultMessage: 'Unavailable right now · Try again later',
		description: 'The two-step service is unavailable.'
	}),
	twoStepNotOffered: defineMessage({
		id: 'account.security.two.step.not.offered',
		defaultMessage: 'Not offered for your account',
		description: 'Two-step verification is not offered.'
	}),
	recoveryCodes: defineMessage({
		id: 'account.security.recovery.codes',
		defaultMessage: 'Recovery codes',
		description: 'Row title of recovery codes.'
	}),
	recoveryCodesLeftOf: defineMessage({
		id: 'account.security.recovery.codes.left.of',
		defaultMessage: '{count} of {total} left',
		description: 'How many of the issued recovery codes remain.'
	}),
	recoveryCodesLeft: defineMessage({
		id: 'account.security.recovery.codes.left',
		defaultMessage: '{count} left',
		description: 'How many recovery codes remain.'
	}),
	securityFootnote: defineMessage({
		id: 'account.security.footnote',
		defaultMessage:
			'Passwords, two-step verification and recovery codes are changed on {institution}’s security page in your browser. Proctor never asks for your password.',
		description: 'Where security changes happen.'
	}),
	securityFootnoteGeneric: defineMessage({
		id: 'account.security.footnote.generic',
		defaultMessage:
			'Passwords, two-step verification and recovery codes are changed on your institution’s security page in your browser. Proctor never asks for your password.',
		description: 'Where security changes happen when the institution name is unknown.'
	})
});
