import { defineMessage } from '../../../../base/common/localization.js';

export const accountMessages = Object.freeze({
	fullName: defineMessage({
		id: 'account.full.name',
		defaultMessage: 'Full name',
		description: 'Institution-managed given and family name.'
	}),
	photoRemoveDetail: defineMessage({
		id: 'account.photo.remove.detail',
		defaultMessage: 'Remove your custom profile photo and use the default image?',
		description: 'Own-account photoRemoveDetail presentation.'
	}),
	invalid: defineMessage({
		id: 'account.invalid',
		defaultMessage: 'The server could not accept this change. Check your input and try again.',
		description: 'Own-account invalid presentation.'
	}),
	conflict: defineMessage({
		id: 'account.conflict',
		defaultMessage:
			'This item changed or is already using the default photo. Refresh before trying again.',
		description: 'Own-account conflict presentation.'
	}),
	photoUnavailable: defineMessage({
		id: 'account.photo.unavailable',
		defaultMessage: 'Your profile photo is unavailable. Refresh to try again.',
		description: 'Own-account photoUnavailable presentation.'
	}),
	photoInvalid: defineMessage({
		id: 'account.photo.invalid',
		defaultMessage: 'Choose a PNG, JPEG or WebP image smaller than 5 MB.',
		description: 'Own-account photoInvalid presentation.'
	}),
	photoHint: defineMessage({
		id: 'account.photo.hint',
		defaultMessage: 'PNG, JPEG or WebP. Up to 5 MB.',
		description: 'Own-account photoHint presentation.'
	}),
	removePhoto: defineMessage({
		id: 'account.remove.photo',
		defaultMessage: 'Remove photo',
		description: 'Own-account removePhoto presentation.'
	}),
	changePhoto: defineMessage({
		id: 'account.change.photo',
		defaultMessage: 'Change photo',
		description: 'Own-account changePhoto presentation.'
	}),
	photo: defineMessage({
		id: 'account.photo',
		defaultMessage: 'Profile photo',
		description: 'Own-account photo presentation.'
	}),
	actions: defineMessage({
		id: 'account.actions',
		defaultMessage: 'Actions',
		description: 'Own-account actions presentation.'
	}),
	client: defineMessage({
		id: 'account.client',
		defaultMessage: 'Application',
		description: 'Own-account client presentation.'
	}),
	device: defineMessage({
		id: 'account.device',
		defaultMessage: 'Device',
		description: 'Own-account device presentation.'
	}),
	otherSessions: defineMessage({
		id: 'account.other.sessions',
		defaultMessage: 'Other sessions',
		description: 'Own-account otherSessions presentation.'
	}),
	currentSession: defineMessage({
		id: 'account.current.session',
		defaultMessage: 'Current session',
		description: 'Own-account currentSession presentation.'
	}),
	accountDetails: defineMessage({
		id: 'account.account.details',
		defaultMessage: 'Account details',
		description: 'Own-account accountDetails presentation.'
	}),
	profileSubtitle: defineMessage({
		id: 'account.profile.subtitle',
		defaultMessage: 'Your account details and security.',
		description: 'Own-account profileSubtitle presentation.'
	}),
	sessionsDevicesNote: defineMessage({
		id: 'account.sessions.devices.note',
		defaultMessage: 'Manage your active sessions and registered desktops.',
		description: 'Own-account sessionsDevicesNote presentation.'
	}),
	sessionsDevices: defineMessage({
		id: 'account.sessions.devices',
		defaultMessage: 'Sessions & devices',
		description: 'Own-account sessionsDevices presentation.'
	}),
	profile: defineMessage({
		id: 'account.profile',
		defaultMessage: 'Profile',
		description: 'Own-account profile presentation.'
	}),
	security: defineMessage({
		id: 'account.security',
		defaultMessage: 'Security',
		description: 'Own-account security presentation.'
	}),
	sessions: defineMessage({
		id: 'account.sessions',
		defaultMessage: 'Sessions',
		description: 'Own-account sessions presentation.'
	}),
	desktops: defineMessage({
		id: 'account.desktops',
		defaultMessage: 'Registered desktops',
		description: 'Own-account desktops presentation.'
	}),
	account: defineMessage({
		id: 'account.account',
		defaultMessage: 'Account',
		description: 'Own-account account presentation.'
	}),
	refresh: defineMessage({
		id: 'account.refresh',
		defaultMessage: 'Refresh',
		description: 'Own-account refresh presentation.'
	}),
	loading: defineMessage({
		id: 'account.loading',
		defaultMessage: 'Loading account…',
		description: 'Own-account loading presentation.'
	}),
	unavailable: defineMessage({
		id: 'account.unavailable',
		defaultMessage: 'Account information could not be loaded. Try refreshing.',
		description: 'Own-account unavailable presentation.'
	}),
	sessionEnded: defineMessage({
		id: 'account.session.ended',
		defaultMessage: 'Your session has ended. Sign in again to continue.',
		description: 'Own-account sessionEnded presentation.'
	}),
	reauthenticationRequired: defineMessage({
		id: 'account.reauthentication.required',
		defaultMessage: 'Sign out and sign in again before making this change.',
		description: 'Own-account reauthenticationRequired presentation.'
	}),
	strongAuthenticationRequired: defineMessage({
		id: 'account.strong.authentication.required',
		defaultMessage:
			'Sign out and sign in again with multi-factor authentication before making this change.',
		description: 'Own-account strongAuthenticationRequired presentation.'
	}),
	denied: defineMessage({
		id: 'account.denied',
		defaultMessage: 'The server did not allow this change.',
		description: 'Own-account denied presentation.'
	}),
	notFound: defineMessage({
		id: 'account.not.found',
		defaultMessage: 'This item is no longer available. Refresh to update the list.',
		description: 'Own-account notFound presentation.'
	}),
	unconfirmed: defineMessage({
		id: 'account.unconfirmed',
		defaultMessage:
			'The server did not confirm this change. Refresh to check its status before trying again.',
		description: 'Own-account unconfirmed presentation.'
	}),
	updated: defineMessage({
		id: 'account.updated',
		defaultMessage: 'Account information updated.',
		description: 'Own-account updated presentation.'
	}),
	completed: defineMessage({
		id: 'account.completed',
		defaultMessage: 'The change was confirmed by the server.',
		description: 'Own-account completed presentation.'
	}),
	browserOpened: defineMessage({
		id: 'account.browser.opened',
		defaultMessage: 'Security opened in your browser. Refresh here after making changes.',
		description: 'Own-account browserOpened presentation.'
	}),
	profileNote: defineMessage({
		id: 'account.profile.note',
		defaultMessage: 'These details are managed by your institution.',
		description: 'Own-account profileNote presentation.'
	}),
	username: defineMessage({
		id: 'account.username',
		defaultMessage: 'Username',
		description: 'Own-account username presentation.'
	}),
	email: defineMessage({
		id: 'account.email',
		defaultMessage: 'Email',
		description: 'Own-account email presentation.'
	}),
	emailVerified: defineMessage({
		id: 'account.email.verified',
		defaultMessage: 'Email verification',
		description: 'Own-account emailVerified presentation.'
	}),
	verified: defineMessage({
		id: 'account.verified',
		defaultMessage: 'Email verified',
		description: 'Own-account verified presentation.'
	}),
	unverified: defineMessage({
		id: 'account.unverified',
		defaultMessage: 'Not verified',
		description: 'Own-account unverified presentation.'
	}),
	name: defineMessage({
		id: 'account.name',
		defaultMessage: 'Name',
		description: 'Own-account name presentation.'
	}),
	locale: defineMessage({
		id: 'account.locale',
		defaultMessage: 'Language',
		description: 'Own-account locale presentation.'
	}),
	timezone: defineMessage({
		id: 'account.timezone',
		defaultMessage: 'Time zone',
		description: 'Own-account timezone presentation.'
	}),
	institution: defineMessage({
		id: 'account.institution',
		defaultMessage: 'Institution',
		description: 'Own-account institution presentation.'
	}),
	notAvailable: defineMessage({
		id: 'account.not.available',
		defaultMessage: 'Not available',
		description: 'Own-account notAvailable presentation.'
	}),
	securityNote: defineMessage({
		id: 'account.security.note',
		defaultMessage: 'Review how you sign in and manage multi-factor authentication.',
		description: 'Own-account securityNote presentation.'
	}),
	password: defineMessage({
		id: 'account.password',
		defaultMessage: 'Password sign-in',
		description: 'Own-account password presentation.'
	}),
	enabled: defineMessage({
		id: 'account.enabled',
		defaultMessage: 'Enabled',
		description: 'Own-account enabled presentation.'
	}),
	disabled: defineMessage({
		id: 'account.disabled',
		defaultMessage: 'Not enabled',
		description: 'Own-account disabled presentation.'
	}),
	providers: defineMessage({
		id: 'account.providers',
		defaultMessage: 'Connected sign-in providers',
		description: 'Own-account providers presentation.'
	}),
	none: defineMessage({
		id: 'account.none',
		defaultMessage: 'None',
		description: 'Own-account none presentation.'
	}),
	mfa: defineMessage({
		id: 'account.mfa',
		defaultMessage: 'Multi-factor authentication',
		description: 'Own-account mfa presentation.'
	}),
	serviceUnavailable: defineMessage({
		id: 'account.service.unavailable',
		defaultMessage: 'Unavailable on this server',
		description: 'Own-account serviceUnavailable presentation.'
	}),
	pending: defineMessage({
		id: 'account.pending',
		defaultMessage: 'Setup incomplete',
		description: 'Own-account pending presentation.'
	}),
	recoveryRequired: defineMessage({
		id: 'account.recovery.required',
		defaultMessage: 'Recovery required',
		description: 'Own-account recoveryRequired presentation.'
	}),
	recoveryCodes: defineMessage({
		id: 'account.recovery.codes',
		defaultMessage: 'Recovery codes remaining',
		description: 'Own-account recoveryCodes presentation.'
	}),
	manageSecurity: defineMessage({
		id: 'account.manage.security',
		defaultMessage: 'Manage security in browser',
		description: 'Own-account manageSecurity presentation.'
	}),
	browserNote: defineMessage({
		id: 'account.browser.note',
		defaultMessage: 'Manage your password, sign-in methods and multi-factor authentication.',
		description: 'Own-account browserNote presentation.'
	}),
	sessionsNote: defineMessage({
		id: 'account.sessions.note',
		defaultMessage:
			'End sessions you no longer use. Ending this session signs you out of Proctor.',
		description: 'Own-account sessionsNote presentation.'
	}),
	desktopsNote: defineMessage({
		id: 'account.desktops.note',
		defaultMessage:
			'Revoking a desktop ends its sessions and prevents it from signing in until it is registered again.',
		description: 'Own-account desktopsNote presentation.'
	}),
	emptySessions: defineMessage({
		id: 'account.empty.sessions',
		defaultMessage: 'No active sessions.',
		description: 'Own-account emptySessions presentation.'
	}),
	emptyDesktops: defineMessage({
		id: 'account.empty.desktops',
		defaultMessage: 'No registered desktops.',
		description: 'Own-account emptyDesktops presentation.'
	}),
	thisSession: defineMessage({
		id: 'account.this.session',
		defaultMessage: 'This session',
		description: 'Own-account thisSession presentation.'
	}),
	thisDesktop: defineMessage({
		id: 'account.this.desktop',
		defaultMessage: 'This desktop',
		description: 'Own-account thisDesktop presentation.'
	}),
	revoked: defineMessage({
		id: 'account.revoked',
		defaultMessage: 'Revoked',
		description: 'Own-account revoked presentation.'
	}),
	endSession: defineMessage({
		id: 'account.end.session',
		defaultMessage: 'End session',
		description: 'Own-account endSession presentation.'
	}),
	revokeDesktop: defineMessage({
		id: 'account.revoke.desktop',
		defaultMessage: 'Revoke desktop',
		description: 'Own-account revokeDesktop presentation.'
	}),
	signOut: defineMessage({
		id: 'account.sign.out',
		defaultMessage: 'Sign out',
		description: 'Own-account signOut presentation.'
	}),
	cancel: defineMessage({
		id: 'account.cancel',
		defaultMessage: 'Cancel',
		description: 'Own-account cancel presentation.'
	}),
	confirmSession: defineMessage({
		id: 'account.confirm.session',
		defaultMessage: 'End this session?',
		description: 'Own-account confirmSession presentation.'
	}),
	confirmDesktop: defineMessage({
		id: 'account.confirm.desktop',
		defaultMessage: 'Revoke this desktop?',
		description: 'Own-account confirmDesktop presentation.'
	}),
	confirmSessionDetail: defineMessage({
		id: 'account.confirm.session.detail',
		defaultMessage: 'This signs the selected session out. Any other sessions stay signed in.',
		description: 'Own-account confirmSessionDetail presentation.'
	}),
	confirmDesktopDetail: defineMessage({
		id: 'account.confirm.desktop.detail',
		defaultMessage:
			'This ends every session bound to this desktop. It must register again to sign in.',
		description: 'Own-account confirmDesktopDetail presentation.'
	}),
	confirmCurrent: defineMessage({
		id: 'account.confirm.current',
		defaultMessage: 'You are using this desktop. Continuing will also sign you out here.',
		description: 'Own-account confirmCurrent presentation.'
	}),
	working: defineMessage({
		id: 'account.working',
		defaultMessage: 'Applying change…',
		description: 'Own-account working presentation.'
	}),
	created: defineMessage({
		id: 'account.created',
		defaultMessage: 'Signed in',
		description: 'Own-account created presentation.'
	}),
	registered: defineMessage({
		id: 'account.registered',
		defaultMessage: 'Registered',
		description: 'Own-account registered presentation.'
	}),
	lastActive: defineMessage({
		id: 'account.last.active',
		defaultMessage: 'Last active',
		description: 'Own-account lastActive presentation.'
	}),
	expires: defineMessage({
		id: 'account.expires',
		defaultMessage: 'Expires',
		description: 'Own-account expires presentation.'
	}),
	version: defineMessage({
		id: 'account.version',
		defaultMessage: 'Version',
		description: 'Own-account version presentation.'
	}),
	desktop: defineMessage({
		id: 'account.desktop',
		defaultMessage: 'Desktop',
		description: 'Own-account desktop presentation.'
	}),
	web: defineMessage({
		id: 'account.web',
		defaultMessage: 'Browser',
		description: 'Own-account web presentation.'
	}),
	cli: defineMessage({
		id: 'account.cli',
		defaultMessage: 'Command line',
		description: 'Own-account cli presentation.'
	}),
	otherClient: defineMessage({
		id: 'account.other.client',
		defaultMessage: 'Session',
		description: 'Own-account otherClient presentation.'
	}),
	mac: defineMessage({
		id: 'account.mac',
		defaultMessage: 'macOS',
		description: 'Own-account mac presentation.'
	}),
	windows: defineMessage({
		id: 'account.windows',
		defaultMessage: 'Windows',
		description: 'Own-account windows presentation.'
	}),
	linux: defineMessage({
		id: 'account.linux',
		defaultMessage: 'Linux',
		description: 'Own-account linux presentation.'
	}),
	otherPlatform: defineMessage({
		id: 'account.other.platform',
		defaultMessage: 'Desktop',
		description: 'Own-account otherPlatform presentation.'
	}),
	passwordMethod: defineMessage({
		id: 'account.password.method',
		defaultMessage: 'Password',
		description: 'Own-account passwordMethod presentation.'
	}),
	oidcMethod: defineMessage({
		id: 'account.oidc.method',
		defaultMessage: 'Institution sign-in',
		description: 'Own-account oidcMethod presentation.'
	}),
	casMethod: defineMessage({
		id: 'account.cas.method',
		defaultMessage: 'Institution sign-in',
		description: 'Own-account casMethod presentation.'
	}),
	otherMethod: defineMessage({
		id: 'account.other.method',
		defaultMessage: 'Sign-in method',
		description: 'Own-account otherMethod presentation.'
	}),
	method: defineMessage({
		id: 'account.method',
		defaultMessage: 'Signed in with',
		description: 'Own-account method presentation.'
	}),
	noAffiliation: defineMessage({
		id: 'account.no.affiliation',
		defaultMessage: 'You have no current institution affiliation.',
		description: 'Own-account noAffiliation presentation.'
	}),
	noAccess: defineMessage({
		id: 'account.no.access',
		defaultMessage: 'No examination or management access is assigned to your account.',
		description: 'Own-account noAccess presentation.'
	})
});
