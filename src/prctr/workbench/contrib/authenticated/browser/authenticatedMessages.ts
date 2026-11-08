/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { defineMessage } from '../../../../base/common/localization.js';

/** Text of AuthenticatedWindow's frame: the area rail, contextual sidebar and content top bar. */
export const authenticatedMessages = Object.freeze({
	areas: defineMessage({
		id: 'authenticated.rail.label',
		defaultMessage: 'Areas',
		description: 'Accessible name of the rail that switches between product areas and Account.'
	}),
	activityArea: defineMessage({
		id: 'authenticated.rail.activity',
		defaultMessage: 'Activity',
		description: 'Rail label of the student exam activity area.'
	}),
	managementArea: defineMessage({
		id: 'authenticated.rail.management',
		defaultMessage: 'Exams',
		description: 'Rail label of the exam management area.'
	}),
	administrationArea: defineMessage({
		id: 'authenticated.rail.administration',
		defaultMessage: 'Admin',
		description: 'Rail label of the institution administration area.'
	}),
	accountButton: defineMessage({
		id: 'authenticated.rail.account',
		defaultMessage: 'Account: {name}',
		description:
			'Accessible name of the rail photo that opens Account; name is the signed-in user.'
	}),
	activityTitle: defineMessage({
		id: 'authenticated.sidebar.activity',
		defaultMessage: 'Activity',
		description: 'Sidebar title of the student exam activity area.'
	}),
	managementTitle: defineMessage({
		id: 'authenticated.sidebar.management',
		defaultMessage: 'Exams',
		description: 'Sidebar title of the exam management area.'
	}),
	administrationTitle: defineMessage({
		id: 'authenticated.sidebar.administration',
		defaultMessage: 'Administration',
		description: 'Sidebar title of the institution administration area.'
	}),
	accountTitle: defineMessage({
		id: 'authenticated.sidebar.account',
		defaultMessage: 'Account',
		description: 'Sidebar title of the Account space.'
	}),
	overview: defineMessage({
		id: 'authenticated.nav.overview',
		defaultMessage: 'Overview',
		description: 'Sidebar page that summarizes an area.'
	}),
	upcoming: defineMessage({
		id: 'authenticated.nav.upcoming',
		defaultMessage: 'Upcoming',
		description: 'Upcoming exams navigation.'
	}),
	available: defineMessage({
		id: 'authenticated.nav.available',
		defaultMessage: 'Ready to join',
		description: 'Available exams navigation, subject to admission checks.'
	}),
	in_progress: defineMessage({
		id: 'authenticated.nav.progress',
		defaultMessage: 'In progress',
		description: 'Unfinished attempts navigation.'
	}),
	submitted: defineMessage({
		id: 'authenticated.nav.submitted',
		defaultMessage: 'Submitted',
		description: 'Submitted exams navigation.'
	}),
	results_available: defineMessage({
		id: 'authenticated.nav.results',
		defaultMessage: 'Results',
		description: 'Released results navigation.'
	}),
	past: defineMessage({
		id: 'authenticated.nav.history',
		defaultMessage: 'History',
		description: 'Past exam activity navigation.'
	}),
	profile: defineMessage({
		id: 'authenticated.account.nav.profile',
		defaultMessage: 'Profile',
		description: 'Account page with the signed-in user’s photo and details.'
	}),
	security: defineMessage({
		id: 'authenticated.account.nav.security',
		defaultMessage: 'Sign-in and security',
		description: 'Account page about how the user signs in.'
	}),
	sessions: defineMessage({
		id: 'authenticated.account.nav.sessions',
		defaultMessage: 'Sessions and devices',
		description: 'Account page listing signed-in sessions and registered desktops.'
	}),
	tokens: defineMessage({
		id: 'authenticated.account.nav.tokens',
		defaultMessage: 'Access tokens',
		description: 'Account page for personal access tokens.'
	}),
	history: defineMessage({
		id: 'authenticated.account.nav.history',
		defaultMessage: 'Audits',
		description: 'Account page listing what was done with the account.'
	}),
	settings: defineMessage({
		id: 'authenticated.account.nav.settings',
		defaultMessage: 'Settings',
		description: 'Account item that opens User Settings.'
	}),
	signOut: defineMessage({
		id: 'authenticated.account.sign.out',
		defaultMessage: 'Sign out',
		description: 'Ends the current desktop session.'
	}),
	signOutConfirmTitle: defineMessage({
		id: 'authenticated.account.sign.out.confirm.title',
		defaultMessage: 'Sign out of Proctor?',
		description: 'Title of the confirmation before signing out.'
	}),
	signOutConfirmBody: defineMessage({
		id: 'authenticated.account.sign.out.confirm.body',
		defaultMessage:
			'You’ll need to sign in with {institution} again to use Proctor on this computer. Nothing you submitted is affected.',
		description:
			'What signing out does, in the confirmation. {institution} is the institution’s name.'
	}),
	signOutConfirmBodyGeneric: defineMessage({
		id: 'authenticated.account.sign.out.confirm.body.generic',
		defaultMessage:
			'You’ll need to sign in again to use Proctor on this computer. Nothing you submitted is affected.',
		description: 'What signing out does, when the institution’s name is unknown.'
	}),
	cancel: defineMessage({
		id: 'authenticated.cancel',
		defaultMessage: 'Cancel',
		description: 'Closes a confirmation without doing anything.'
	}),
	signOutFailed: defineMessage({
		id: 'authenticated.account.sign.out.failed',
		defaultMessage: 'Sign-out could not be completed.',
		description: 'Shown when ending the desktop session fails.'
	}),
	retry: defineMessage({
		id: 'authenticated.shell.retry',
		defaultMessage: 'Refresh access',
		description: 'Refresh permitted product areas from the server.'
	}),
	hideSidebar: defineMessage({
		id: 'authenticated.shell.hide.sidebar',
		defaultMessage: 'Hide sidebar',
		description: 'Hides the contextual sidebar.'
	}),
	showSidebar: defineMessage({
		id: 'authenticated.shell.show.sidebar',
		defaultMessage: 'Show sidebar',
		description: 'Shows the contextual sidebar.'
	}),
	toggleSidebar: defineMessage({
		id: 'authenticated.shell.toggle.sidebar',
		defaultMessage: 'Toggle Sidebar Visibility',
		description: 'Command that shows or hides the contextual sidebar.'
	}),
	resizeSidebar: defineMessage({
		id: 'authenticated.shell.resize.sidebar',
		defaultMessage: 'Resize sidebar',
		description: 'Accessible name of the separator that changes the sidebar width.'
	}),
	sidebarShown: defineMessage({
		id: 'authenticated.shell.sidebar.shown',
		defaultMessage: 'Sidebar shown',
		description: 'Announcement after the sidebar appears.'
	}),
	sidebarHidden: defineMessage({
		id: 'authenticated.shell.sidebar.hidden',
		defaultMessage: 'Sidebar hidden',
		description: 'Announcement after the sidebar is hidden.'
	}),
	back: defineMessage({
		id: 'authenticated.shell.back',
		defaultMessage: 'Back',
		description: 'Returns to the previous page.'
	}),
	forward: defineMessage({
		id: 'authenticated.shell.forward',
		defaultMessage: 'Forward',
		description: 'Goes to the next page after going back.'
	}),
	navigateBack: defineMessage({
		id: 'authenticated.shell.navigate.back',
		defaultMessage: 'Go Back',
		description: 'Command that returns to the previous page.'
	}),
	navigateForward: defineMessage({
		id: 'authenticated.shell.navigate.forward',
		defaultMessage: 'Go Forward',
		description: 'Command that goes to the next page after going back.'
	}),
	search: defineMessage({
		id: 'authenticated.shell.search',
		defaultMessage: 'Search',
		description: 'Accessible name of the window search field.'
	}),
	searchPlaceholder: defineMessage({
		id: 'authenticated.shell.search.placeholder',
		defaultMessage: 'Search exams, students and classes',
		description: 'Placeholder of the window search field.'
	}),
	searchUnavailable: defineMessage({
		id: 'authenticated.shell.search.unavailable',
		defaultMessage: 'Search isn’t available yet.',
		description: 'Announced when the user submits a search before search exists.'
	}),
	focusSearch: defineMessage({
		id: 'authenticated.shell.search.focus',
		defaultMessage: 'Focus Search',
		description: 'Command that moves focus to the window search field.'
	}),
	productName: defineMessage({
		id: 'authenticated.shell.product',
		defaultMessage: 'Proctor',
		description: 'Product name in the Windows title bar.'
	}),
	waiting: defineMessage({
		id: 'authenticated.shell.waiting',
		defaultMessage: 'Exam activity is not available yet.',
		description: 'Unavailable examination destination.'
	}),
	account: defineMessage({
		id: 'authenticated.shell.account',
		defaultMessage: 'Account',
		description: 'Fallback name of the signed-in user.'
	})
});

export type AuthenticatedMessage = keyof typeof authenticatedMessages;
