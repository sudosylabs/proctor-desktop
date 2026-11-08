/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { defineMessage } from '../../../../base/common/localization.js';

export const accountMessages = Object.freeze({
	// #region Pages
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
	// #endregion

	// #region Section states
	loading: defineMessage({
		id: 'account.state.loading',
		defaultMessage: 'Loading…',
		description: 'A section is reading its information from the server.'
	}),
	stillWaiting: defineMessage({
		id: 'account.state.still.waiting',
		defaultMessage: 'Still waiting for {institution}…',
		description: 'A read is slow; institution is the server’s name.'
	}),
	stillWaitingGeneric: defineMessage({
		id: 'account.state.still.waiting.generic',
		defaultMessage: 'Still waiting for the server…',
		description: 'A read is slow and the institution name is unknown.'
	}),
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
		defaultMessage: 'Authenticator app · on since {date}',
		description: 'Two-step verification uses an authenticator app, on since date.'
	}),
	recoveryCodesIssued: defineMessage({
		id: 'account.security.recovery.codes.issued',
		defaultMessage: 'Issued {date} · each code works once',
		description: 'When the recovery codes were issued.'
	}),
	recoveryCodesOnce: defineMessage({
		id: 'account.security.recovery.codes.once',
		defaultMessage: 'Each code works once',
		description: 'Recovery codes detail when the issue date is unknown.'
	}),
	endSessionEllipsis: defineMessage({
		id: 'account.sessions.end.menu',
		defaultMessage: 'End session…',
		description: 'Row menu entry that opens the confirmation to end a session.'
	}),
	removeDesktopEllipsis: defineMessage({
		id: 'account.desktops.remove.menu',
		defaultMessage: 'Remove desktop…',
		description: 'Row menu entry that opens the confirmation to remove a registered desktop.'
	}),
	desktopRemovedStatus: defineMessage({
		id: 'account.desktops.removed.status',
		defaultMessage: 'Removed',
		description: 'Status word: this registered desktop was removed.'
	}),
	revokeTokenEllipsis: defineMessage({
		id: 'account.tokens.revoke.menu',
		defaultMessage: 'Revoke…',
		description: 'Row menu entry that opens the confirmation to revoke a token.'
	}),
	tokenDisabledStatus: defineMessage({
		id: 'account.tokens.status.disabled',
		defaultMessage: 'Disabled',
		description: 'Status word: the token is turned off.'
	}),
	tokenExpiredStatus: defineMessage({
		id: 'account.tokens.status.expired',
		defaultMessage: 'Expired',
		description: 'Status word: the token has expired.'
	}),
	tokenRevokedStatus: defineMessage({
		id: 'account.tokens.status.revoked',
		defaultMessage: 'Revoked',
		description: 'Status word: the token was revoked.'
	}),
	dismiss: defineMessage({
		id: 'account.dismiss',
		defaultMessage: 'Dismiss',
		description: 'Closes a toast.'
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
	settingsTabAppearance: defineMessage({
		id: 'account.settings.tab.appearance',
		defaultMessage: 'Appearance',
		description: 'Settings tab.'
	}),
	settingsTabEditor: defineMessage({
		id: 'account.settings.tab.editor',
		defaultMessage: 'Exam editor',
		description: 'Settings tab for the exam editor.'
	}),
	settingsTabAccessibility: defineMessage({
		id: 'account.settings.tab.accessibility',
		defaultMessage: 'Accessibility',
		description: 'Settings tab.'
	}),
	settingsTabBrowser: defineMessage({
		id: 'account.settings.tab.browser',
		defaultMessage: 'Browser',
		description: 'Settings tab for the exam browser.'
	}),
	settingsGroupTheme: defineMessage({
		id: 'account.settings.group.theme',
		defaultMessage: 'Theme',
		description: 'Settings group.'
	}),
	settingsGroupSize: defineMessage({
		id: 'account.settings.group.size',
		defaultMessage: 'Size',
		description: 'Settings group.'
	}),
	settingsGroupLook: defineMessage({
		id: 'account.settings.group.look',
		defaultMessage: 'Look',
		description: 'Settings group for how the editor looks.'
	}),
	settingsGroupLayout: defineMessage({
		id: 'account.settings.group.layout',
		defaultMessage: 'Layout',
		description: 'Settings group for editor layout.'
	}),
	settingsGroupMotion: defineMessage({
		id: 'account.settings.group.motion',
		defaultMessage: 'Motion and timing',
		description: 'Settings group.'
	}),
	settingsGroupScreenReaders: defineMessage({
		id: 'account.settings.group.screen.readers',
		defaultMessage: 'Screen readers',
		description: 'Settings group.'
	}),
	settingsGroupExamBrowser: defineMessage({
		id: 'account.settings.group.exam.browser',
		defaultMessage: 'Exam browser',
		description: 'Settings group.'
	}),
	settingsSearchResults: defineMessage({
		id: 'account.settings.search.results',
		defaultMessage: 'Matching settings',
		description: 'Group title while finding a setting.'
	}),
	settingsNoMatch: defineMessage({
		id: 'account.settings.no.match',
		defaultMessage: 'No setting matches that.',
		description: 'Find a setting found nothing.'
	}),
	findSetting: defineMessage({
		id: 'account.settings.find',
		defaultMessage: 'Find a setting',
		description: 'Accessible name and placeholder of the settings filter.'
	}),
	settingsSaved: defineMessage({
		id: 'account.settings.saved',
		defaultMessage: 'Saved',
		description: 'Every change is saved.'
	}),
	settingsSaving: defineMessage({
		id: 'account.settings.saving',
		defaultMessage: 'Saving…',
		description: 'A change is being saved.'
	}),
	settingsNotSavedShort: defineMessage({
		id: 'account.settings.not.saved.short',
		defaultMessage: 'Not saved',
		description: 'The last change could not be saved.'
	}),
	settingsReadOnly: defineMessage({
		id: 'account.settings.read.only',
		defaultMessage: 'Read only',
		description: 'Settings cannot be changed right now.'
	}),
	settingsNotSaved: defineMessage({
		id: 'account.settings.not.saved',
		defaultMessage: 'Couldn’t save your settings',
		description: 'Toast title when a save fails.'
	}),
	settingsKeptHere: defineMessage({
		id: 'account.settings.kept.here',
		defaultMessage: 'Your change is kept on this page; try again when the server answers.',
		description: 'Toast body when a save fails.'
	}),
	settingsInvalid: defineMessage({
		id: 'account.settings.invalid',
		defaultMessage: 'That value isn’t allowed.',
		description: 'Toast body when a value is refused.'
	}),
	settingsUnavailable: defineMessage({
		id: 'account.settings.unavailable',
		defaultMessage: 'Settings can’t be changed right now. Your current settings still apply.',
		description: 'Banner when settings are read only or unavailable.'
	}),
	settingsExamOverride: defineMessage({
		id: 'account.settings.exam.override',
		defaultMessage:
			'An exam can set its own editor settings. When it does, they apply only while you take that exam.',
		description: 'Banner on the Exam editor tab.'
	}),
	resetSetting: defineMessage({
		id: 'account.settings.reset',
		defaultMessage: 'Reset',
		description: 'Puts one setting back to its default.'
	}),
	resetSettingNamed: defineMessage({
		id: 'account.settings.reset.named',
		defaultMessage: 'Reset {name}',
		description: 'Accessible name of a setting’s Reset button.'
	}),
	themeSystem: defineMessage({
		id: 'account.settings.theme.system',
		defaultMessage: 'System',
		description: 'Window theme follows the operating system.'
	}),
	themeLight: defineMessage({
		id: 'account.settings.theme.light',
		defaultMessage: 'Light',
		description: 'Window theme choice.'
	}),
	themeDark: defineMessage({
		id: 'account.settings.theme.dark',
		defaultMessage: 'Dark',
		description: 'Window theme choice.'
	}),
	choiceOn: defineMessage({
		id: 'account.settings.choice.on',
		defaultMessage: 'On',
		description: 'A setting choice.'
	}),
	choiceOff: defineMessage({
		id: 'account.settings.choice.off',
		defaultMessage: 'Off',
		description: 'A setting choice.'
	}),
	lineNumbersRelative: defineMessage({
		id: 'account.settings.line.numbers.relative',
		defaultMessage: 'Relative',
		description: 'Line numbers counted from the cursor line.'
	}),
	cursorLine: defineMessage({
		id: 'account.settings.cursor.line',
		defaultMessage: 'Line',
		description: 'Cursor shape.'
	}),
	cursorBlock: defineMessage({
		id: 'account.settings.cursor.block',
		defaultMessage: 'Block',
		description: 'Cursor shape.'
	}),
	cursorUnderline: defineMessage({
		id: 'account.settings.cursor.underline',
		defaultMessage: 'Underline',
		description: 'Cursor shape.'
	}),
	blinkBlink: defineMessage({
		id: 'account.settings.blink.blink',
		defaultMessage: 'Blink',
		description: 'Cursor animation.'
	}),
	blinkSmooth: defineMessage({
		id: 'account.settings.blink.smooth',
		defaultMessage: 'Smooth',
		description: 'Cursor animation.'
	}),
	blinkPhase: defineMessage({
		id: 'account.settings.blink.phase',
		defaultMessage: 'Phase',
		description: 'Cursor animation.'
	}),
	blinkExpand: defineMessage({
		id: 'account.settings.blink.expand',
		defaultMessage: 'Expand',
		description: 'Cursor animation.'
	}),
	blinkSolid: defineMessage({
		id: 'account.settings.blink.solid',
		defaultMessage: 'Solid',
		description: 'Cursor animation: no blinking.'
	}),
	delayNone: defineMessage({
		id: 'account.settings.delay.none',
		defaultMessage: 'None',
		description: 'Tooltip delay choice.'
	}),
	delayShort: defineMessage({
		id: 'account.settings.delay.short',
		defaultMessage: 'Short · 0.3 s',
		description: 'Tooltip delay choice.'
	}),
	delayMedium: defineMessage({
		id: 'account.settings.delay.medium',
		defaultMessage: 'Medium · 0.5 s',
		description: 'Tooltip delay choice.'
	}),
	delayLong: defineMessage({
		id: 'account.settings.delay.long',
		defaultMessage: 'Long · 1 s',
		description: 'Tooltip delay choice.'
	}),
	delayLonger: defineMessage({
		id: 'account.settings.delay.longer',
		defaultMessage: 'Longer · 1.5 s',
		description: 'Tooltip delay choice.'
	}),
	screenReaderAuto: defineMessage({
		id: 'account.settings.screen.reader.auto',
		defaultMessage: 'Detect automatically',
		description: 'Screen reader mode choice.'
	}),
	announceAuto: defineMessage({
		id: 'account.settings.announce.auto',
		defaultMessage: 'Automatic',
		description: 'Announcement detail choice.'
	}),
	announceBrief: defineMessage({
		id: 'account.settings.announce.brief',
		defaultMessage: 'Brief',
		description: 'Announcement detail choice.'
	}),
	announceDetailed: defineMessage({
		id: 'account.settings.announce.detailed',
		defaultMessage: 'Detailed',
		description: 'Announcement detail choice.'
	}),
	percentValue: defineMessage({
		id: 'account.settings.percent',
		defaultMessage: '{value}%',
		description: 'A percentage.'
	}),
	pixels: defineMessage({
		id: 'account.settings.pixels',
		defaultMessage: '{value} px',
		description: 'A size in pixels.'
	}),
	smaller: defineMessage({
		id: 'account.settings.smaller',
		defaultMessage: 'Smaller',
		description: 'Decreases a number.'
	}),
	larger: defineMessage({
		id: 'account.settings.larger',
		defaultMessage: 'Larger',
		description: 'Increases a number.'
	}),
	editorPreview: defineMessage({
		id: 'account.settings.editor.preview',
		defaultMessage: 'Editor preview',
		description: 'Accessible name of the code preview.'
	}),
	editorPreviewLabel: defineMessage({
		id: 'account.settings.editor.preview.label',
		defaultMessage: 'Preview · {theme}, {size} px',
		description: 'Label above the code preview.'
	}),
	loadFailed: defineMessage({
		id: 'account.state.load.failed',
		defaultMessage: 'This couldn’t be loaded. {reason}',
		description: 'A section read failed and nothing is shown; reason explains why.'
	}),
	staleData: defineMessage({
		id: 'account.state.stale',
		defaultMessage: 'This couldn’t be refreshed, so it may be out of date. {reason}',
		description: 'A refresh failed; earlier information stays shown.'
	}),
	retry: defineMessage({
		id: 'account.state.retry',
		defaultMessage: 'Try again',
		description: 'Retry reading a section.'
	}),
	busy: defineMessage({
		id: 'account.state.busy',
		defaultMessage: 'Another change is being applied. Try again when it finishes.',
		description: 'Account changes run one at a time.'
	}),
	recheckFirst: defineMessage({
		id: 'account.state.recheck.first',
		defaultMessage:
			'Proctor is checking whether the last change worked. Try again after the list refreshes.',
		description: 'An action is blocked until an unknown outcome is read again.'
	}),
	notProvided: defineMessage({
		id: 'account.value.not.provided',
		defaultMessage: 'Not provided',
		description: 'An account detail has no value.'
	}),
	relativeToday: defineMessage({
		id: 'account.time.today',
		defaultMessage: 'today, {time}',
		description: 'A time earlier today, as in "last active today, 08:41".'
	}),
	relativeYesterday: defineMessage({
		id: 'account.time.yesterday',
		defaultMessage: 'yesterday, {time}',
		description: 'A time yesterday, as in "last active yesterday, 17:20".'
	}),
	relativeTodayStandalone: defineMessage({
		id: 'account.time.today.standalone',
		defaultMessage: 'Today, {time}',
		description: 'A time earlier today, shown on its own in a table cell.'
	}),
	relativeYesterdayStandalone: defineMessage({
		id: 'account.time.yesterday.standalone',
		defaultMessage: 'Yesterday, {time}',
		description: 'A time yesterday, shown on its own in a table cell.'
	}),
	detailSeparator: defineMessage({
		id: 'account.detail.separator',
		defaultMessage: '{first} · {second}',
		description: 'Joins two parts of a row description.'
	}),
	rowActions: defineMessage({
		id: 'account.row.actions',
		defaultMessage: 'Actions for {name}',
		description: 'Accessible name of a row’s actions menu button and menu.'
	}),
	actionFailed: defineMessage({
		id: 'account.action.failed',
		defaultMessage: 'That action could not be completed.',
		description: 'A menu action failed unexpectedly.'
	}),
	cancel: defineMessage({
		id: 'account.action.cancel',
		defaultMessage: 'Cancel',
		description: 'Close a dialog without changing anything.'
	}),
	// #endregion

	// #region Failures
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
	failureInvalid: defineMessage({
		id: 'account.failure.invalid',
		defaultMessage: 'The server didn’t accept this. Check the details and try again.',
		description: 'The server rejected the request as invalid.'
	}),
	// #endregion

	// #region Profile
	changePhoto: defineMessage({
		id: 'account.profile.change.photo',
		defaultMessage: 'Change photo',
		description: 'Choose a new profile photo.'
	}),
	removePhoto: defineMessage({
		id: 'account.profile.remove.photo',
		defaultMessage: 'Remove photo',
		description: 'Remove the profile photo.'
	}),
	photoUnavailable: defineMessage({
		id: 'account.profile.photo.unavailable',
		defaultMessage: 'Your photo couldn’t be loaded, so it can’t be changed right now.',
		description: 'The profile photo read failed.'
	}),
	photoUpdated: defineMessage({
		id: 'account.profile.photo.updated',
		defaultMessage: 'Photo saved.',
		description: 'The profile photo changed.'
	}),
	photoRemoved: defineMessage({
		id: 'account.profile.photo.removed',
		defaultMessage: 'Photo removed.',
		description: 'The profile photo was removed.'
	}),
	confirmRemovePhotoTitle: defineMessage({
		id: 'account.profile.remove.photo.title',
		defaultMessage: 'Remove your photo?',
		description: 'Title of the remove-photo confirmation.'
	}),
	confirmRemovePhotoBody: defineMessage({
		id: 'account.profile.remove.photo.body',
		defaultMessage: 'Your initials are shown instead until you add another photo.',
		description: 'Explains removing the profile photo.'
	}),
	accountDetails: defineMessage({
		id: 'account.profile.details',
		defaultMessage: 'Account details',
		description: 'Heading of the read-only account details.'
	}),
	detailsManaged: defineMessage({
		id: 'account.profile.details.managed',
		defaultMessage: '{institution} manages these. To change one, contact an administrator.',
		description: 'Account details are read-only; institution is its name.'
	}),
	detailsManagedGeneric: defineMessage({
		id: 'account.profile.details.managed.generic',
		defaultMessage: 'Your institution manages these. To change one, contact an administrator.',
		description: 'Account details are read-only and the institution name is unknown.'
	}),
	firstName: defineMessage({
		id: 'account.profile.first.name',
		defaultMessage: 'First name',
		description: 'Account detail label.'
	}),
	lastName: defineMessage({
		id: 'account.profile.last.name',
		defaultMessage: 'Last name',
		description: 'Account detail label.'
	}),
	email: defineMessage({
		id: 'account.profile.email',
		defaultMessage: 'Email',
		description: 'Account detail label.'
	}),
	emailVerified: defineMessage({
		id: 'account.profile.email.verified',
		defaultMessage: 'Verified',
		description: 'The email address is verified.'
	}),
	emailUnverified: defineMessage({
		id: 'account.profile.email.unverified',
		defaultMessage: 'Not verified',
		description: 'The email address is not verified.'
	}),
	language: defineMessage({
		id: 'account.profile.language',
		defaultMessage: 'Language',
		description: 'Account detail label.'
	}),
	timeZone: defineMessage({
		id: 'account.profile.time.zone',
		defaultMessage: 'Time zone',
		description: 'Account detail label.'
	}),
	memberSince: defineMessage({
		id: 'account.profile.member.since',
		defaultMessage: 'Member since',
		description: 'Account detail label: when the account was created.'
	}),
	lastSignIn: defineMessage({
		id: 'account.profile.last.sign.in',
		defaultMessage: 'Last sign-in',
		description: 'Account detail label: when this window’s session signed in.'
	}),
	lastSignInValue: defineMessage({
		id: 'account.profile.last.sign.in.value',
		defaultMessage: '{when} · {client}',
		description: 'When and with which app the current session signed in.'
	}),
	unverifiedNotice: defineMessage({
		id: 'account.profile.unverified.notice',
		defaultMessage:
			'Your email isn’t verified, so Proctor can’t use it to help you get back into your account.',
		description: 'Explains an unverified email address.'
	}),
	sendVerification: defineMessage({
		id: 'account.profile.send.verification',
		defaultMessage: 'Send verification email',
		description: 'Ask the server to send a verification email.'
	}),
	verificationSent: defineMessage({
		id: 'account.profile.verification.sent',
		defaultMessage: 'If this address can receive email, a verification link is on its way.',
		description: 'Confirms a verification request without revealing delivery.'
	}),
	noAffiliation: defineMessage({
		id: 'account.profile.no.affiliation',
		defaultMessage: 'You have no current affiliation with this institution.',
		description: 'The account has no current affiliation.'
	}),
	noAccess: defineMessage({
		id: 'account.profile.no.access',
		defaultMessage: 'You have no assigned access yet. An administrator can give you access.',
		description: 'The account has no assigned access.'
	}),
	noticesTitle: defineMessage({
		id: 'account.profile.notices.title',
		defaultMessage: 'Exam records due for deletion',
		description: 'Heading of the retention notices.'
	}),
	noticesDescription: defineMessage({
		id: 'account.profile.notices.description',
		defaultMessage:
			'{institution} keeps exam records for a set time. These are about to reach it.',
		description: 'Explains retention notices; institution is its name.'
	}),
	noticesDescriptionGeneric: defineMessage({
		id: 'account.profile.notices.description.generic',
		defaultMessage:
			'Your institution keeps exam records for a set time. These are about to reach it.',
		description: 'Explains retention notices when the institution name is unknown.'
	}),
	noticesMore: defineMessage({
		id: 'account.profile.notices.more',
		defaultMessage: 'There are more records than shown here.',
		description: 'The server holds further retention notices.'
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
	noticeKind: defineMessage({
		id: 'account.notice.kind',
		defaultMessage: '{category} from the sitting on {date}',
		description:
			'Second line of a retention notice under the exam title: the record kind and the sitting’s start date.'
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
	noticeDeletionCanceledUndated: defineMessage({
		id: 'account.notice.deletion.canceled.undated',
		defaultMessage: 'Deletion canceled',
		description: 'A record’s deletion was canceled at an unknown time.'
	}),
	noticeDeleted: defineMessage({
		id: 'account.notice.deleted',
		defaultMessage: 'Deleted',
		description: 'A record has been deleted.'
	}),
	// #endregion

	// #region Photo dialog
	photoDialogTitle: defineMessage({
		id: 'account.photo.dialog.title',
		defaultMessage: 'Change photo',
		description: 'Title of the photo dialog.'
	}),
	photoDialogHelp: defineMessage({
		id: 'account.photo.dialog.help',
		defaultMessage: 'Drag to position it in the circle. Nothing changes until you save.',
		description: 'Explains the photo crop.'
	}),
	photoCropLabel: defineMessage({
		id: 'account.photo.crop.label',
		defaultMessage: 'Photo preview. Use the arrow keys to move the photo in the circle.',
		description: 'Accessible name of the crop area.'
	}),
	photoZoom: defineMessage({
		id: 'account.photo.zoom',
		defaultMessage: 'Zoom',
		description: 'Photo zoom slider label.'
	}),
	photoLowResolution: defineMessage({
		id: 'account.photo.low.resolution',
		defaultMessage: 'This crop is small, so the photo may look blurry.',
		description: 'The crop has fewer pixels than the saved size.'
	}),
	chooseAnother: defineMessage({
		id: 'account.photo.choose.another',
		defaultMessage: 'Choose another',
		description: 'Pick a different image.'
	}),
	savePhoto: defineMessage({
		id: 'account.photo.save',
		defaultMessage: 'Save photo',
		description: 'Save the cropped photo.'
	}),
	photoPreparing: defineMessage({
		id: 'account.photo.preparing',
		defaultMessage: 'Preparing photo…',
		description: 'The image is being decoded.'
	}),
	photoSaving: defineMessage({
		id: 'account.photo.saving',
		defaultMessage: 'Saving photo…',
		description: 'The photo is being uploaded.'
	}),
	photoChecking: defineMessage({
		id: 'account.photo.checking',
		defaultMessage: 'Checking your photo…',
		description: 'Reading the photo after an upload.'
	}),
	photoInvalid: defineMessage({
		id: 'account.photo.invalid',
		defaultMessage: 'Choose a PNG, JPEG or WebP image.',
		description: 'The chosen file is not a usable image.'
	}),
	photoTooLarge: defineMessage({
		id: 'account.photo.too.large',
		defaultMessage:
			'This image is too large to edit safely. Choose an image up to 32 MB and 64 megapixels, with neither side over 16,384 pixels.',
		description: 'The chosen image exceeds local limits.'
	}),
	photoChangedElsewhere: defineMessage({
		id: 'account.photo.changed.elsewhere',
		defaultMessage: 'Your photo was changed somewhere else. Save to replace it with this one.',
		description: 'A newer photo exists; saving again replaces it.'
	}),
	photoCheckAgain: defineMessage({
		id: 'account.photo.check.again',
		defaultMessage: 'Proctor couldn’t confirm the photo. Check again before saving.',
		description: 'The upload outcome is unknown.'
	}),
	photoRecheck: defineMessage({
		id: 'account.photo.recheck',
		defaultMessage: 'Check again',
		description: 'Read the photo again after an unknown outcome.'
	}),
	photoSavedUnconfirmed: defineMessage({
		id: 'account.photo.saved.unconfirmed',
		defaultMessage: 'The photo was saved, but couldn’t be shown yet. Check again.',
		description: 'Upload succeeded but the follow-up read failed.'
	}),
	// #endregion

	// #region Sign-in and security
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
	singleSignOn: defineMessage({
		id: 'account.security.single.sign.on',
		defaultMessage: 'Single sign-on',
		description: 'A linked institution sign-in provider.'
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
	twoStepDescription: defineMessage({
		id: 'account.security.two.step.description',
		defaultMessage:
			'A second check after your password, such as a code from an authenticator app.',
		description: 'Explains two-step verification.'
	}),
	twoStepOn: defineMessage({
		id: 'account.security.two.step.on',
		defaultMessage: 'On',
		description: 'Two-step verification is on.'
	}),
	twoStepOff: defineMessage({
		id: 'account.security.two.step.off',
		defaultMessage: 'Off · turn it on from the security page',
		description: 'Two-step verification is off.'
	}),
	twoStepPending: defineMessage({
		id: 'account.security.two.step.pending',
		defaultMessage: 'Setup isn’t finished · finish it on the security page',
		description: 'Two-step verification enrolment is pending.'
	}),
	twoStepRecoveryRequired: defineMessage({
		id: 'account.security.two.step.recovery.required',
		defaultMessage: 'Needs recovery · set it up again on the security page',
		description: 'Two-step verification needs recovery.'
	}),
	twoStepServiceUnavailable: defineMessage({
		id: 'account.security.two.step.service.unavailable',
		defaultMessage: 'Unavailable right now · try again later',
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
	recoveryCodesLowOf: defineMessage({
		id: 'account.security.recovery.codes.low.of',
		defaultMessage: '{count} of {total} left · get new ones before you run out',
		description: 'Few of the issued recovery codes remain.'
	}),
	twoStepOnSince: defineMessage({
		id: 'account.security.two.step.on.since',
		defaultMessage: 'On · authenticator app, since {date}',
		description: 'Two-step verification is on with an authenticator app, turned on at date.'
	}),
	twoStepOnApp: defineMessage({
		id: 'account.security.two.step.on.app',
		defaultMessage: 'On · authenticator app',
		description: 'Two-step verification is on with an authenticator app.'
	}),
	passwordChanged: defineMessage({
		id: 'account.security.password.changed',
		defaultMessage: 'Set · changed {date}',
		description: 'A password is set and was last changed at date.'
	}),
	recoveryCodesLeft: defineMessage({
		id: 'account.security.recovery.codes.left',
		defaultMessage: '{count} left',
		description: 'How many recovery codes remain.'
	}),
	recoveryCodesLow: defineMessage({
		id: 'account.security.recovery.codes.low',
		defaultMessage: '{count} left · get new ones before you run out',
		description: 'Few recovery codes remain.'
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
	}),
	// #endregion

	// #region Sessions and devices
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
	otherSessionsDescription: defineMessage({
		id: 'account.sessions.other.description',
		defaultMessage: 'Places you are signed in right now.',
		description: 'Describes other sessions.'
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
	sessionEnded: defineMessage({
		id: 'account.sessions.ended',
		defaultMessage: 'Session ended.',
		description: 'Another session was ended.'
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
			'{platform} · Proctor {release} · registered {registered} · last used {used}',
		description: 'Second line of a registered desktop row.'
	}),
	desktopRemovedSummary: defineMessage({
		id: 'account.sessions.desktop.removed.summary',
		defaultMessage: '{platform} · removed · registered {registered}',
		description: 'Second line of a removed desktop row.'
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
	unnamedDesktop: defineMessage({
		id: 'account.sessions.unnamed.desktop',
		defaultMessage: 'Unnamed computer',
		description: 'A registered desktop without a name.'
	}),
	// #endregion

	// #region Access tokens
	newToken: defineMessage({
		id: 'account.tokens.new',
		defaultMessage: 'New token',
		description: 'Create an access token.'
	}),
	activeTokens: defineMessage({
		id: 'account.tokens.active',
		defaultMessage: 'Active',
		description: 'Heading of active tokens.'
	}),
	activeTokensDescription: defineMessage({
		id: 'account.tokens.active.description',
		defaultMessage: 'Each token can do only what it lists, and stops working when it expires.',
		description: 'Describes active tokens.'
	}),
	noActiveTokens: defineMessage({
		id: 'account.tokens.active.empty',
		defaultMessage: 'No active tokens.',
		description: 'No active tokens, while disabled or expired ones exist.'
	}),
	yourTokens: defineMessage({
		id: 'account.tokens.section.all',
		defaultMessage: 'Your tokens',
		description: 'The one tokens section shown when the person has no tokens.'
	}),
	noTokensTitle: defineMessage({
		id: 'account.tokens.none.title',
		defaultMessage: 'No access tokens yet',
		description: 'Empty state title on the Access tokens page.'
	}),
	noTokensBody: defineMessage({
		id: 'account.tokens.none.body',
		defaultMessage:
			'A token lets a script, such as a grade export, use Proctor with only the permissions you choose.',
		description: 'Empty state explanation on the Access tokens page.'
	}),
	inactiveTokens: defineMessage({
		id: 'account.tokens.inactive',
		defaultMessage: 'Disabled or expired',
		description: 'Heading of disabled, expired and revoked tokens.'
	}),
	inactiveTokensDescription: defineMessage({
		id: 'account.tokens.inactive.description',
		defaultMessage:
			'A disabled token can be turned back on until it expires. Expired and revoked tokens stay listed for your records.',
		description: 'Describes inactive tokens.'
	}),
	noInactiveTokens: defineMessage({
		id: 'account.tokens.inactive.empty',
		defaultMessage: 'None.',
		description: 'No inactive tokens.'
	}),
	tokenUnitTag: defineMessage({
		id: 'account.tokens.unit.tag',
		defaultMessage: 'One academic unit only',
		description: 'The token is limited to one Academic Unit whose name is unknown.'
	}),
	tokenUnitNamedTag: defineMessage({
		id: 'account.tokens.unit.named.tag',
		defaultMessage: '{unit} only',
		description: 'The token is limited to the named Academic Unit.'
	}),
	tokenExpires: defineMessage({
		id: 'account.tokens.expires',
		defaultMessage: 'expires {date}',
		description: 'When an active token expires.'
	}),
	tokenExpired: defineMessage({
		id: 'account.tokens.expired',
		defaultMessage: 'expired {date}',
		description: 'When a token expired.'
	}),
	tokenRevokedOn: defineMessage({
		id: 'account.tokens.revoked.on',
		defaultMessage: 'revoked {date}',
		description: 'When a token was revoked.'
	}),
	tokenDisabledOn: defineMessage({
		id: 'account.tokens.disabled.on',
		defaultMessage: 'disabled {date}',
		description: 'When a token was disabled.'
	}),
	tokenUsed: defineMessage({
		id: 'account.tokens.used',
		defaultMessage: 'used {when}',
		description: 'When a token was last used.'
	}),
	tokenNeverUsed: defineMessage({
		id: 'account.tokens.never.used',
		defaultMessage: 'never used',
		description: 'The token has not been used.'
	}),
	disableToken: defineMessage({
		id: 'account.tokens.disable',
		defaultMessage: 'Disable',
		description: 'Temporarily disable a token.'
	}),
	enableToken: defineMessage({
		id: 'account.tokens.enable',
		defaultMessage: 'Enable',
		description: 'Turn a disabled token back on.'
	}),
	revokeToken: defineMessage({
		id: 'account.tokens.revoke',
		defaultMessage: 'Revoke',
		description: 'Permanently revoke a token.'
	}),
	confirmRevokeTitle: defineMessage({
		id: 'account.tokens.revoke.title',
		defaultMessage: 'Revoke {name}?',
		description: 'Title of the revoke confirmation.'
	}),
	confirmRevokeBody: defineMessage({
		id: 'account.tokens.revoke.body',
		defaultMessage:
			'Anything using this token stops working straight away. A revoked token can’t be turned back on.',
		description: 'Consequences of revoking a token.'
	}),
	confirmRevokeAction: defineMessage({
		id: 'account.tokens.revoke.action',
		defaultMessage: 'Revoke token',
		description: 'Confirm revoking a token.'
	}),
	tokenDisabled: defineMessage({
		id: 'account.tokens.disabled',
		defaultMessage: 'Token disabled.',
		description: 'A token was disabled.'
	}),
	tokenEnabled: defineMessage({
		id: 'account.tokens.enabled',
		defaultMessage: 'Token enabled.',
		description: 'A token was enabled.'
	}),
	tokenRevoked: defineMessage({
		id: 'account.tokens.revoked',
		defaultMessage: 'Token revoked.',
		description: 'A token was revoked.'
	}),
	newTokenTitle: defineMessage({
		id: 'account.tokens.dialog.title',
		defaultMessage: 'New access token',
		description: 'Title of the new token dialog.'
	}),
	newTokenDescription: defineMessage({
		id: 'account.tokens.dialog.description',
		defaultMessage:
			'The script gets only what you tick, and never more than you can do yourself.',
		description: 'Explains token limits.'
	}),
	tokenName: defineMessage({
		id: 'account.tokens.name',
		defaultMessage: 'Name',
		description: 'Token name field label.'
	}),
	tokenNameHint: defineMessage({
		id: 'account.tokens.name.hint',
		defaultMessage: 'What uses it, so you recognise it later.',
		description: 'Token name field description.'
	}),
	tokenScopes: defineMessage({
		id: 'account.tokens.scopes',
		defaultMessage: 'What it can do',
		description: 'Token scope choices.'
	}),
	tokenScopesLoading: defineMessage({
		id: 'account.tokens.scopes.loading',
		defaultMessage: 'Finding what you can give a token…',
		description: 'The grantable token scopes are being read.'
	}),
	tokenScopesNone: defineMessage({
		id: 'account.tokens.scopes.none',
		defaultMessage: 'There is nothing you can give a token yet.',
		description: 'The person may grant no token scope.'
	}),
	tokenLimit: defineMessage({
		id: 'account.tokens.limit',
		defaultMessage: 'Limit to',
		description: 'Choice of the Academic Unit a token is limited to.'
	}),
	tokenLimitNone: defineMessage({
		id: 'account.tokens.limit.none',
		defaultMessage: 'Whole institution',
		description: 'The token is not limited to an Academic Unit.'
	}),
	tokenLimitMore: defineMessage({
		id: 'account.tokens.limit.more',
		defaultMessage: 'Some academic units are not listed.',
		description: 'More grantable Academic Units exist than the list shows.'
	}),
	tokenExpiry: defineMessage({
		id: 'account.tokens.expiry',
		defaultMessage: 'Expires',
		description: 'Token expiry choice.'
	}),
	tokenExpiryOption: defineMessage({
		id: 'account.tokens.expiry.option',
		defaultMessage: 'In {days} days, {date}',
		description: 'One expiry choice.'
	}),
	createToken: defineMessage({
		id: 'account.tokens.create',
		defaultMessage: 'Create token',
		description: 'Create the token.'
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
	tokenCreating: defineMessage({
		id: 'account.tokens.creating',
		defaultMessage: 'Creating token…',
		description: 'The token is being created.'
	}),
	tokenCreatedTitle: defineMessage({
		id: 'account.tokens.created.title',
		defaultMessage: 'Copy your token now',
		description: 'Title of the one-time credential dialog.'
	}),
	tokenCreatedBody: defineMessage({
		id: 'account.tokens.created.body',
		defaultMessage:
			'This is the only time Proctor shows it. Keep it somewhere safe, such as a password manager. Anyone with it can act as you within its limits.',
		description: 'Explains the one-time credential.'
	}),
	tokenCredentialLabel: defineMessage({
		id: 'account.tokens.credential.label',
		defaultMessage: 'Your new token',
		description: 'Accessible name of the credential text.'
	}),
	copy: defineMessage({
		id: 'account.tokens.copy',
		defaultMessage: 'Copy',
		description: 'Copy the credential.'
	}),
	copied: defineMessage({
		id: 'account.tokens.copied',
		defaultMessage: 'Copied.',
		description: 'The credential was copied.'
	}),
	copyFailed: defineMessage({
		id: 'account.tokens.copy.failed',
		defaultMessage: 'Couldn’t copy. Select the token and copy it yourself.',
		description: 'Copying the credential failed.'
	}),
	selectToCopy: defineMessage({
		id: 'account.tokens.select.to.copy',
		defaultMessage: 'Select the token and copy it.',
		description: 'How to copy when no clipboard is available.'
	}),
	done: defineMessage({
		id: 'account.tokens.done',
		defaultMessage: 'Done',
		description: 'Close the credential dialog.'
	}),
	tokenCreated: defineMessage({
		id: 'account.tokens.created',
		defaultMessage: 'Token created.',
		description: 'A token was created.'
	}),
	// #endregion
	// #region Account history
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
		defaultMessage: 'Account history',
		description: 'Heading of the Account history page.'
	}),
	historyDescription: defineMessage({
		id: 'account.page.history.description',
		defaultMessage:
			'What was done with your account, by you, an administrator or Proctor itself.',
		description: 'Description under the Account history heading.'
	}),
	historyPeriodLabel: defineMessage({
		id: 'account.history.filter.period',
		defaultMessage: 'Period',
		description: 'Accessible name of the period filter.'
	}),
	historyPeriodDays: defineMessage({
		id: 'account.history.filter.period.days',
		defaultMessage: 'Last {days} days',
		description: 'Period filter option: the last number of days.'
	}),
	historyPeriodAll: defineMessage({
		id: 'account.history.filter.period.all',
		defaultMessage: 'All time',
		description: 'Period filter option: no time limit.'
	}),
	historyGroupLabel: defineMessage({
		id: 'account.history.filter.group',
		defaultMessage: 'Kind',
		description: 'Accessible name of the event-kind filter.'
	}),
	historyGroupAll: defineMessage({
		id: 'account.history.filter.group.all',
		defaultMessage: 'Any event',
		description: 'Event-kind filter option: every event.'
	}),
	historyGroupSignIn: defineMessage({
		id: 'account.history.filter.group.sign.in',
		defaultMessage: 'Sign-in and sessions',
		description: 'Event-kind filter option.'
	}),
	historyGroupSecurity: defineMessage({
		id: 'account.history.filter.group.security',
		defaultMessage: 'Password, two-step and email',
		description: 'Event-kind filter option.'
	}),
	historyGroupTokens: defineMessage({
		id: 'account.history.filter.group.tokens',
		defaultMessage: 'Access tokens',
		description: 'Event-kind filter option.'
	}),
	historyGroupProfile: defineMessage({
		id: 'account.history.filter.group.profile',
		defaultMessage: 'Profile',
		description: 'Event-kind filter option.'
	}),
	historyGroupMembership: defineMessage({
		id: 'account.history.filter.group.membership',
		defaultMessage: 'Classes, units and roles',
		description: 'Event-kind filter option.'
	}),
	historyGroupStatus: defineMessage({
		id: 'account.history.filter.group.status',
		defaultMessage: 'Account on or off',
		description: 'Event-kind filter option.'
	}),
	historyRelationLabel: defineMessage({
		id: 'account.history.filter.relation',
		defaultMessage: 'About',
		description: 'Accessible name of the subject filter.'
	}),
	historyRelationAll: defineMessage({
		id: 'account.history.filter.relation.all',
		defaultMessage: 'Anything',
		description: 'Subject filter option: every event.'
	}),
	historyRelationSubject: defineMessage({
		id: 'account.history.filter.relation.subject',
		defaultMessage: 'Your account',
		description: 'Subject filter option: events about the account.'
	}),
	historyRelationActor: defineMessage({
		id: 'account.history.filter.relation.actor',
		defaultMessage: 'What you did elsewhere',
		description: 'Subject filter option: events the person performed on something else.'
	}),
	historyOutcomeLabel: defineMessage({
		id: 'account.history.filter.outcome',
		defaultMessage: 'Outcome',
		description: 'Accessible name of the outcome filter.'
	}),
	historyOutcomeAll: defineMessage({
		id: 'account.history.filter.outcome.all',
		defaultMessage: 'Any',
		description: 'Outcome filter option: every event.'
	}),
	historyOutcomeSuccess: defineMessage({
		id: 'account.history.filter.outcome.success',
		defaultMessage: 'Succeeded',
		description: 'Outcome filter option.'
	}),
	historyOutcomeFail: defineMessage({
		id: 'account.history.filter.outcome.fail',
		defaultMessage: 'Failed',
		description: 'Outcome filter option.'
	}),
	historyShown: defineMessage({
		id: 'account.history.shown',
		defaultMessage: 'Events shown: {count}',
		description: 'How many events the list shows.'
	}),
	historyWhen: defineMessage({
		id: 'account.history.column.when',
		defaultMessage: 'When',
		description: 'Account history column heading.'
	}),
	historyWhat: defineMessage({
		id: 'account.history.column.what',
		defaultMessage: 'What happened',
		description: 'Account history column heading.'
	}),
	historyBy: defineMessage({
		id: 'account.history.column.by',
		defaultMessage: 'By',
		description: 'Account history column heading.'
	}),
	historyWhere: defineMessage({
		id: 'account.history.column.where',
		defaultMessage: 'Where',
		description: 'Account history column heading.'
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
	}),
	historyFailed: defineMessage({
		id: 'account.history.failed',
		defaultMessage: 'Did not succeed',
		description: 'The event failed.'
	}),
	historyAboutElsewhere: defineMessage({
		id: 'account.history.about.elsewhere',
		defaultMessage: 'Something you did outside your account',
		description: 'The event is one the person performed on something else.'
	}),
	historyWhereUnknown: defineMessage({
		id: 'account.history.where.unknown',
		defaultMessage: 'Not recorded',
		description: 'Where the event came from is unknown.'
	}),
	historyEmpty: defineMessage({
		id: 'account.history.empty',
		defaultMessage: 'Nothing happened with your account in this period.',
		description: 'No events match the filters.'
	}),
	historyMore: defineMessage({
		id: 'account.history.more',
		defaultMessage: 'Show older events',
		description: 'Loads the next page of account history.'
	})
	// #endregion
});

export type AccountMessage = keyof typeof accountMessages;
