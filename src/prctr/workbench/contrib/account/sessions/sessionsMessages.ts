/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { defineMessage } from '../../../../base/common/localization.js';

/** Text of the Account Sessions and devices page. */
export const sessionsMessages = Object.freeze({
	endSessionEllipsis: defineMessage({
		id: 'account.sessions.end.menu',
		defaultMessage: 'End session',
		description: 'Row menu entry that opens the confirmation to end a session.'
	}),
	removeDesktopEllipsis: defineMessage({
		id: 'account.desktops.remove.menu',
		defaultMessage: 'Remove desktop',
		description: 'Row menu entry that opens the confirmation to remove a registered desktop.'
	}),
	desktopRemovedStatus: defineMessage({
		id: 'account.desktops.removed.status',
		defaultMessage: 'Removed',
		description: 'Status word: this registered desktop was removed.'
	}),
	thisComputer: defineMessage({
		id: 'account.sessions.this.computer',
		defaultMessage: 'This computer',
		description: 'Heading of the current session, and a tag on the current desktop.'
	}),
	thisSession: defineMessage({
		id: 'account.sessions.this.session',
		defaultMessage: 'This session',
		description: 'Tag on the current session.'
	}),
	otherSessions: defineMessage({
		id: 'account.sessions.other',
		defaultMessage: 'Other sessions',
		description: 'Heading of other sessions.'
	}),
	noOtherSessions: defineMessage({
		id: 'account.sessions.other.empty',
		defaultMessage: 'You aren’t signed in anywhere else.',
		description: 'No other sessions.'
	}),
	noCurrentSession: defineMessage({
		id: 'account.sessions.current.empty',
		defaultMessage: 'This window’s session isn’t listed. It may have just ended.',
		description: 'The current session is missing from the list.'
	}),
	registeredDesktops: defineMessage({
		id: 'account.sessions.desktops',
		defaultMessage: 'Registered desktops',
		description: 'Heading of registered desktops.'
	}),
	registeredDesktopsDescription: defineMessage({
		id: 'account.sessions.desktops.description',
		defaultMessage: 'Computers that hold a key for your exams.',
		description: 'Describes registered desktops.'
	}),
	noDesktops: defineMessage({
		id: 'account.sessions.desktops.empty',
		defaultMessage: 'No computers are registered.',
		description: 'No registered desktops.'
	}),
	signOut: defineMessage({
		id: 'account.sessions.sign.out',
		defaultMessage: 'Sign out',
		description: 'End the current session by signing out.'
	}),
	endSession: defineMessage({
		id: 'account.sessions.end',
		defaultMessage: 'End session',
		description: 'End another session.'
	}),
	removeDesktop: defineMessage({
		id: 'account.sessions.remove.desktop',
		defaultMessage: 'Remove',
		description: 'Remove a registered desktop.'
	}),
	confirmEndSessionTitle: defineMessage({
		id: 'account.sessions.end.title',
		defaultMessage: 'End the session on {name}?',
		description: 'Title of the end-session confirmation.'
	}),
	confirmEndSessionBody: defineMessage({
		id: 'account.sessions.end.body',
		defaultMessage:
			'{name} is signed out straight away and anything unsaved there is lost. Exam work the server already received is kept.',
		description: 'Consequences of ending a session.'
	}),
	confirmRemoveDesktopTitle: defineMessage({
		id: 'account.sessions.remove.title',
		defaultMessage: 'Remove {name}?',
		description: 'Title of the remove-desktop confirmation.'
	}),
	confirmRemoveDesktopBody: defineMessage({
		id: 'account.sessions.remove.body',
		defaultMessage:
			'{name} loses its key and can’t be used for your exams until you sign in there again. Exam work the server already received is kept.',
		description: 'Consequences of removing a registered desktop.'
	}),
	endOtherSessions: defineMessage({
		id: 'account.sessions.end.others',
		defaultMessage: 'End all other sessions',
		description: 'Section action that ends every session except this one.'
	}),
	confirmEndOtherSessionsTitle: defineMessage({
		id: 'account.sessions.end.others.title',
		defaultMessage: 'End all other sessions?',
		description: 'Title of the confirmation before ending every other session.'
	}),
	confirmEndOtherSessionsBody: defineMessage({
		id: 'account.sessions.end.others.body',
		defaultMessage:
			'Everywhere else you are signed in is signed out straight away, and anything unsaved there is lost. This computer stays signed in.',
		description: 'Consequences of ending every other session.'
	}),
	otherSessionsEnded: defineMessage({
		id: 'account.sessions.end.others.done',
		defaultMessage: 'Every other session was ended.',
		description: 'Every other session was ended.'
	}),
	noOtherSessionsEnded: defineMessage({
		id: 'account.sessions.end.others.none',
		defaultMessage: 'There were no other sessions to end.',
		description: 'Ending other sessions found none.'
	}),
	desktopRemoved: defineMessage({
		id: 'account.sessions.desktop.removed',
		defaultMessage: 'Desktop removed.',
		description: 'A registered desktop was removed.'
	}),
	sessionSignedIn: defineMessage({
		id: 'account.sessions.signed.in',
		defaultMessage: 'signed in {when}',
		description:
			'Part of a session row\'s second line, after the device, as in "macOS · signed in today, 08:41".'
	}),
	sessionSignedInFirst: defineMessage({
		id: 'account.sessions.signed.in.first',
		defaultMessage: 'Signed in {when}',
		description:
			'Start of a session row\'s second line, as in "Signed in yesterday, 17:20 · active today, 09:12".'
	}),
	sessionActive: defineMessage({
		id: 'account.sessions.active',
		defaultMessage: 'active {when}',
		description: "Part of a session row's second line: when the session was last used."
	}),
	desktopSummary: defineMessage({
		id: 'account.sessions.desktop.summary',
		defaultMessage:
			'{platform} · Proctor {release} · Registered {registered} · Last used {used}',
		description: 'Second line of a registered desktop row.'
	}),
	desktopRemovedSummary: defineMessage({
		id: 'account.sessions.desktop.removed.summary',
		defaultMessage: '{platform} · Removed · Registered {registered}',
		description: 'Second line of a removed desktop row.'
	}),
	unnamedDesktop: defineMessage({
		id: 'account.sessions.unnamed.desktop',
		defaultMessage: 'Unnamed computer',
		description: 'A registered desktop without a name.'
	})
});
