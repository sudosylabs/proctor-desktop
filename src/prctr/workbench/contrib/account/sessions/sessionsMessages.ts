/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { defineMessage } from '../../../../base/common/localization.js';

/** Text of the Account Sessions and devices page. */
export const sessionsMessages = Object.freeze({
	signedInSection: defineMessage({
		id: 'account.sessions.signed.in.section',
		defaultMessage: 'Signed in',
		description:
			'Heading of the list of every place the account is signed in, each computer once.'
	}),
	noCurrentSession: defineMessage({
		id: 'account.sessions.current.empty',
		defaultMessage: 'This window’s session isn’t listed. It may have just ended.',
		description: 'The sessions list does not include the session this window uses.'
	}),
	sessionsLoadFailedTitle: defineMessage({
		id: 'account.sessions.load.failed.title',
		defaultMessage: 'Couldn’t load your sessions',
		description: 'Title of the Signed in section when the sessions could not be read.'
	}),
	sessionsLoadFailedTimeout: defineMessage({
		id: 'account.sessions.load.failed.timeout',
		defaultMessage: '{institution} didn’t answer in time. Nothing has changed.',
		description: 'The sessions read went unanswered; institution is the server’s name.'
	}),
	sessionsLoadFailedTimeoutGeneric: defineMessage({
		id: 'account.sessions.load.failed.timeout.generic',
		defaultMessage: 'The server didn’t answer in time. Nothing has changed.',
		description: 'The sessions read went unanswered and the institution name is unknown.'
	}),
	registeredOnlySection: defineMessage({
		id: 'account.sessions.registered.only',
		defaultMessage: 'Registered, not signed in',
		description: 'Heading of the computers registered for exams that have no session now.'
	}),
	registeredOnlyDescription: defineMessage({
		id: 'account.sessions.registered.only.description',
		defaultMessage:
			'Computers set up to take your exams. Removing one means it is set up again before your next exam there.',
		description: 'Description under Registered, not signed in.'
	}),
	currentBadge: defineMessage({
		id: 'account.sessions.current.badge',
		defaultMessage: 'Current',
		description: 'Grey badge after the title of the session and computer you are using.'
	}),
	unidentifiedBadge: defineMessage({
		id: 'account.sessions.unidentified.badge',
		defaultMessage: 'Unidentified',
		description: 'Amber badge on a session the server could not say what it is.'
	}),
	unknownDevice: defineMessage({
		id: 'account.sessions.unknown.device',
		defaultMessage: 'Unknown device',
		description: 'Title of a session that has no name and is not identified.'
	}),
	notIdentified: defineMessage({
		id: 'account.sessions.not.identified',
		defaultMessage: 'Not identified',
		description: 'The kind of a session the server could not identify, in its detail line.'
	}),
	registeredForExams: defineMessage({
		id: 'account.sessions.registered.for.exams',
		defaultMessage: 'Registered for exams',
		description: 'In a session’s detail line: the computer is registered to take exams.'
	}),
	sessionSignedIn: defineMessage({
		id: 'account.sessions.signed.in',
		defaultMessage: 'Signed in {when}',
		description: 'When a session signed in, as in "Signed in yesterday, 17:20".'
	}),
	sessionActive: defineMessage({
		id: 'account.sessions.active',
		defaultMessage: 'Active {when}',
		description: 'When a session was last used, as in "Active 2 hours ago".'
	}),
	desktopRegistered: defineMessage({
		id: 'account.sessions.desktop.registered',
		defaultMessage: 'Registered {date}',
		description: 'When a computer was registered for exams.'
	}),
	desktopLastUsed: defineMessage({
		id: 'account.sessions.desktop.last.used',
		defaultMessage: 'Last used {when}',
		description: 'When a registered computer was last used.'
	}),
	unnamedDesktop: defineMessage({
		id: 'account.sessions.unnamed.desktop',
		defaultMessage: 'Unnamed computer',
		description: 'Title of a registered computer that has no name.'
	}),
	signInPassword: defineMessage({
		id: 'account.sessions.sign.in.password',
		defaultMessage: 'Password, no two-step',
		description: 'How a session signed in: a password alone.'
	}),
	signInPasswordTwoStep: defineMessage({
		id: 'account.sessions.sign.in.password.two.step',
		defaultMessage: 'Password with two-step verification',
		description: 'How a session signed in: a password and a second step.'
	}),
	signInSingleSignOn: defineMessage({
		id: 'account.sessions.sign.in.sso',
		defaultMessage: 'Single sign-on',
		description: 'How a session signed in: the institution’s single sign-on.'
	}),
	signInSingleSignOnTwoStep: defineMessage({
		id: 'account.sessions.sign.in.sso.two.step',
		defaultMessage: 'Single sign-on with two-step verification',
		description: 'How a session signed in: single sign-on and a second step.'
	}),
	signInOther: defineMessage({
		id: 'account.sessions.sign.in.other',
		defaultMessage: 'Another way, no two-step',
		description: 'How a session signed in, when the method has no name here.'
	}),
	signInOtherTwoStep: defineMessage({
		id: 'account.sessions.sign.in.other.two.step',
		defaultMessage: 'Another way, with two-step verification',
		description: 'How a session signed in with a second step, when the method has no name here.'
	}),
	signOut: defineMessage({
		id: 'account.sessions.sign.out',
		defaultMessage: 'Sign out',
		description: 'Signs this computer out; the window asks first.'
	}),
	sessionDetailsMenu: defineMessage({
		id: 'account.sessions.details.menu',
		defaultMessage: 'Session details',
		description: 'Row menu entry that shows everything known about a session or computer.'
	}),
	renameMenu: defineMessage({
		id: 'account.sessions.rename.menu',
		defaultMessage: 'Rename…',
		description: 'Row menu entry that opens a dialog to rename a session or computer.'
	}),
	endSessionMenu: defineMessage({
		id: 'account.sessions.end.menu',
		defaultMessage: 'End session…',
		description: 'Row menu entry that opens the confirmation to end a session.'
	}),
	removeRegistrationMenu: defineMessage({
		id: 'account.sessions.remove.registration.menu',
		defaultMessage: 'Remove registration…',
		description:
			'Row menu entry that opens the confirmation to remove a computer’s registration.'
	}),
	endSession: defineMessage({
		id: 'account.sessions.end',
		defaultMessage: 'End session',
		description: 'Confirms ending a session.'
	}),
	removeRegistration: defineMessage({
		id: 'account.sessions.remove.registration',
		defaultMessage: 'Remove registration',
		description: 'Confirms removing a computer’s registration for exams.'
	}),
	confirmEndSessionTitle: defineMessage({
		id: 'account.sessions.end.title',
		defaultMessage: 'End the session on {name}?',
		description: 'Title of the confirmation to end one session; name is the session.'
	}),
	confirmEndSessionBody: defineMessage({
		id: 'account.sessions.end.body',
		defaultMessage:
			'{name} is signed out straight away and anything unsaved there is lost. Exam work the server already received is kept.',
		description: 'Body of the confirmation to end one session.'
	}),
	confirmRemoveRegistrationTitle: defineMessage({
		id: 'account.sessions.remove.title',
		defaultMessage: 'Remove the registration for {name}?',
		description: 'Title of the confirmation to remove a computer’s registration.'
	}),
	confirmRemoveRegistrationBody: defineMessage({
		id: 'account.sessions.remove.body',
		defaultMessage:
			'{name} is set up again before your next exam there. Exam work the server already received is kept.',
		description: 'Body of the confirmation to remove a computer’s registration.'
	}),
	confirmRemoveRegistrationSignedInBody: defineMessage({
		id: 'account.sessions.remove.signed.in.body',
		defaultMessage:
			'{name} is signed out and set up again before your next exam there. Exam work the server already received is kept.',
		description: 'Body of the confirmation to remove the registration of a signed-in computer.'
	}),
	endOtherSessions: defineMessage({
		id: 'account.sessions.end.others',
		defaultMessage: 'End all other sessions',
		description: 'Section action that ends every session except this one.'
	}),
	confirmEndOtherSessionsTitle: defineMessage({
		id: 'account.sessions.end.others.title',
		defaultMessage: 'End all other sessions?',
		description: 'Title of the confirmation to end every other session.'
	}),
	confirmEndOtherSessionsBody: defineMessage({
		id: 'account.sessions.end.others.body',
		defaultMessage:
			'Everywhere else you are signed in is signed out straight away, and anything unsaved there is lost. This computer stays signed in.',
		description: 'Body of the confirmation to end every other session.'
	}),
	otherSessionsEnded: defineMessage({
		id: 'account.sessions.end.others.done',
		defaultMessage: 'Every other session was ended.',
		description: 'Toast after ending every other session.'
	}),
	noOtherSessionsEnded: defineMessage({
		id: 'account.sessions.end.others.none',
		defaultMessage: 'There were no other sessions to end.',
		description: 'Toast when there was nothing else to end.'
	}),
	registrationRemoved: defineMessage({
		id: 'account.sessions.registration.removed',
		defaultMessage: 'Registration removed.',
		description: 'Toast after removing a computer’s registration.'
	}),
	renameTitle: defineMessage({
		id: 'account.sessions.rename.title',
		defaultMessage: 'Rename {name}',
		description: 'Title of the dialog that renames a session or computer.'
	}),
	renameDescription: defineMessage({
		id: 'account.sessions.rename.description',
		defaultMessage: 'A name you’ll recognise. Only you see it.',
		description: 'One line under the Rename title.'
	}),
	renameDesktopDescription: defineMessage({
		id: 'account.sessions.rename.desktop.description',
		defaultMessage:
			'A name you’ll recognise. It stays with this computer when you sign in again.',
		description: 'One line under the Rename title for a computer registered for exams.'
	}),
	renameName: defineMessage({
		id: 'account.sessions.rename.name',
		defaultMessage: 'Name',
		description: 'Label of the name field in the Rename dialog.'
	}),
	renameNameRequired: defineMessage({
		id: 'account.sessions.rename.name.required',
		defaultMessage: 'Enter a name.',
		description: 'The Rename name field is empty.'
	}),
	renameNameInvalid: defineMessage({
		id: 'account.sessions.rename.name.invalid',
		defaultMessage: 'Use up to 128 characters, without line breaks.',
		description: 'The Rename name is too long or holds control characters.'
	}),
	renameAction: defineMessage({
		id: 'account.sessions.rename.action',
		defaultMessage: 'Rename',
		description: 'Saves the new name in the Rename dialog.'
	}),
	renamed: defineMessage({
		id: 'account.sessions.renamed',
		defaultMessage: 'Renamed.',
		description: 'Toast after a session or computer was renamed.'
	}),
	detailKind: defineMessage({
		id: 'account.sessions.detail.kind',
		defaultMessage: 'Kind',
		description: 'Session details label: what signed in, such as Web browser.'
	}),
	detailSystem: defineMessage({
		id: 'account.sessions.detail.system',
		defaultMessage: 'System',
		description: 'Session details label: the operating system.'
	}),
	detailHow: defineMessage({
		id: 'account.sessions.detail.how',
		defaultMessage: 'How it signed in',
		description: 'Session details label: the sign-in method and whether two-step was used.'
	}),
	detailSignedIn: defineMessage({
		id: 'account.sessions.detail.signed.in',
		defaultMessage: 'Signed in',
		description: 'Session details label: when the session signed in.'
	}),
	detailTwoStep: defineMessage({
		id: 'account.sessions.detail.two.step',
		defaultMessage: 'Two-step verification',
		description: 'Session details label: when the session completed two-step verification.'
	}),
	detailLastActive: defineMessage({
		id: 'account.sessions.detail.last.active',
		defaultMessage: 'Last active',
		description: 'Session details label: when the session was last used.'
	}),
	detailExpires: defineMessage({
		id: 'account.sessions.detail.expires',
		defaultMessage: 'Signs out by',
		description: 'Session details label: when the session ends on its own.'
	}),
	detailRegistered: defineMessage({
		id: 'account.sessions.detail.registered',
		defaultMessage: 'Registered for exams',
		description: 'Session details label: when the computer was registered.'
	}),
	detailRelease: defineMessage({
		id: 'account.sessions.detail.release',
		defaultMessage: 'Proctor version',
		description: 'Session details label: the Proctor Desktop release the computer last used.'
	}),
	detailLastUsed: defineMessage({
		id: 'account.sessions.detail.last.used',
		defaultMessage: 'Last used',
		description: 'Session details label: when the registered computer was last used.'
	}),
	detailNotSignedIn: defineMessage({
		id: 'account.sessions.detail.not.signed.in',
		defaultMessage: 'Not signed in',
		description: 'Session details value: a registered computer with no session now.'
	}),
	detailsClose: defineMessage({
		id: 'account.sessions.details.close',
		defaultMessage: 'Close',
		description: 'Closes the Session details dialog.'
	})
});
