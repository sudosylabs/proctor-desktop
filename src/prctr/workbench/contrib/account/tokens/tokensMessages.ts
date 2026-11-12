/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { defineMessage } from '../../../../base/common/localization.js';

/** Text of the Account Access tokens page and its dialogs. */
export const tokensMessages = Object.freeze({
	revokeTokenEllipsis: defineMessage({
		id: 'account.tokens.revoke.menu',
		defaultMessage: 'Revoke',
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
	tokenAreaAcademicProgression: defineMessage({
		id: 'account.tokens.area.academic.progression',
		defaultMessage: 'Progression',
		description: 'A row of the New token grid: what its permissions act on.'
	}),
	tokenAreaAcademicProgressionDescription: defineMessage({
		id: 'account.tokens.area.academic.progression.description',
		defaultMessage: 'Moving students on at the end of a year',
		description: 'One line under the New token grid row named Progression.'
	}),
	tokenAreaAcademicAudit: defineMessage({
		id: 'account.tokens.area.academic.audit',
		defaultMessage: 'Academic records',
		description: 'A row of the New token grid: what its permissions act on.'
	}),
	tokenAreaAcademicAuditDescription: defineMessage({
		id: 'account.tokens.area.academic.audit.description',
		defaultMessage: 'Changes to programmes, classes and enrolment',
		description: 'One line under the New token grid row named Academic records.'
	}),
	tokenAreaAcademicPeriod: defineMessage({
		id: 'account.tokens.area.academic.period',
		defaultMessage: 'Academic periods',
		description: 'A row of the New token grid: what its permissions act on.'
	}),
	tokenAreaAcademicPeriodDescription: defineMessage({
		id: 'account.tokens.area.academic.period.description',
		defaultMessage: 'Terms and years, and their dates',
		description: 'One line under the New token grid row named Academic periods.'
	}),
	tokenAreaAcademicUnit: defineMessage({
		id: 'account.tokens.area.academic.unit',
		defaultMessage: 'Academic units',
		description: 'A row of the New token grid: what its permissions act on.'
	}),
	tokenAreaAcademicUnitDescription: defineMessage({
		id: 'account.tokens.area.academic.unit.description',
		defaultMessage: 'Faculties and departments',
		description: 'One line under the New token grid row named Academic units.'
	}),
	tokenAreaAcademicUnitMembers: defineMessage({
		id: 'account.tokens.area.academic.unit.members',
		defaultMessage: 'Unit members',
		description: 'A row of the New token grid: what its permissions act on.'
	}),
	tokenAreaAcademicUnitMembersDescription: defineMessage({
		id: 'account.tokens.area.academic.unit.members.description',
		defaultMessage: 'Who belongs to an academic unit',
		description: 'One line under the New token grid row named Unit members.'
	}),
	tokenAreaAudit: defineMessage({
		id: 'account.tokens.area.audit',
		defaultMessage: 'Audits',
		description: 'A row of the New token grid: what its permissions act on.'
	}),
	tokenAreaAuditDescription: defineMessage({
		id: 'account.tokens.area.audit.description',
		defaultMessage: 'What happened, and who did it',
		description: 'One line under the New token grid row named Audits.'
	}),
	tokenAreaClass: defineMessage({
		id: 'account.tokens.area.class',
		defaultMessage: 'Classes',
		description: 'A row of the New token grid: what its permissions act on.'
	}),
	tokenAreaClassDescription: defineMessage({
		id: 'account.tokens.area.class.description',
		defaultMessage: 'Classes and their settings',
		description: 'One line under the New token grid row named Classes.'
	}),
	tokenAreaClassMembers: defineMessage({
		id: 'account.tokens.area.class.members',
		defaultMessage: 'Class members',
		description: 'A row of the New token grid: what its permissions act on.'
	}),
	tokenAreaClassMembersDescription: defineMessage({
		id: 'account.tokens.area.class.members.description',
		defaultMessage: 'Who is in a class',
		description: 'One line under the New token grid row named Class members.'
	}),
	tokenAreaBrowserActivity: defineMessage({
		id: 'account.tokens.area.browser.activity',
		defaultMessage: 'Browser activity',
		description: 'A row of the New token grid: what its permissions act on.'
	}),
	tokenAreaBrowserActivityDescription: defineMessage({
		id: 'account.tokens.area.browser.activity.description',
		defaultMessage: 'Pages opened in an exam’s browser',
		description: 'One line under the New token grid row named Browser activity.'
	}),
	tokenAreaExam: defineMessage({
		id: 'account.tokens.area.exam',
		defaultMessage: 'Exams',
		description: 'A row of the New token grid: what its permissions act on.'
	}),
	tokenAreaExamDescription: defineMessage({
		id: 'account.tokens.area.exam.description',
		defaultMessage: 'Exams and their settings',
		description: 'One line under the New token grid row named Exams.'
	}),
	tokenAreaSitting: defineMessage({
		id: 'account.tokens.area.sitting',
		defaultMessage: 'Sittings',
		description: 'A row of the New token grid: what its permissions act on.'
	}),
	tokenAreaSittingDescription: defineMessage({
		id: 'account.tokens.area.sitting.description',
		defaultMessage: 'When and where an exam is sat',
		description: 'One line under the New token grid row named Sittings.'
	}),
	tokenAreaInstitution: defineMessage({
		id: 'account.tokens.area.institution',
		defaultMessage: 'Institution',
		description: 'A row of the New token grid: what its permissions act on.'
	}),
	tokenAreaInstitutionDescription: defineMessage({
		id: 'account.tokens.area.institution.description',
		defaultMessage: 'Settings for the whole institution',
		description: 'One line under the New token grid row named Institution.'
	}),
	tokenAreaInvitation: defineMessage({
		id: 'account.tokens.area.invitation',
		defaultMessage: 'Invitations',
		description: 'A row of the New token grid: what its permissions act on.'
	}),
	tokenAreaInvitationDescription: defineMessage({
		id: 'account.tokens.area.invitation.description',
		defaultMessage: 'Invitations to join',
		description: 'One line under the New token grid row named Invitations.'
	}),
	tokenAreaJob: defineMessage({
		id: 'account.tokens.area.job',
		defaultMessage: 'Jobs',
		description: 'A row of the New token grid: what its permissions act on.'
	}),
	tokenAreaJobDescription: defineMessage({
		id: 'account.tokens.area.job.description',
		defaultMessage: 'Work Proctor runs in the background',
		description: 'One line under the New token grid row named Jobs.'
	}),
	tokenAreaMail: defineMessage({
		id: 'account.tokens.area.mail',
		defaultMessage: 'Mail',
		description: 'A row of the New token grid: what its permissions act on.'
	}),
	tokenAreaMailDescription: defineMessage({
		id: 'account.tokens.area.mail.description',
		defaultMessage: 'Email Proctor sends',
		description: 'One line under the New token grid row named Mail.'
	}),
	tokenAreaOnboarding: defineMessage({
		id: 'account.tokens.area.onboarding',
		defaultMessage: 'Imports',
		description: 'A row of the New token grid: what its permissions act on.'
	}),
	tokenAreaOnboardingDescription: defineMessage({
		id: 'account.tokens.area.onboarding.description',
		defaultMessage: 'People added from a file',
		description: 'One line under the New token grid row named Imports.'
	}),
	tokenAreaProgramme: defineMessage({
		id: 'account.tokens.area.programme',
		defaultMessage: 'Programmes',
		description: 'A row of the New token grid: what its permissions act on.'
	}),
	tokenAreaProgrammeDescription: defineMessage({
		id: 'account.tokens.area.programme.description',
		defaultMessage: 'Programmes of study',
		description: 'One line under the New token grid row named Programmes.'
	}),
	tokenAreaProgrammeLevel: defineMessage({
		id: 'account.tokens.area.programme.level',
		defaultMessage: 'Levels',
		description: 'A row of the New token grid: what its permissions act on.'
	}),
	tokenAreaProgrammeLevelDescription: defineMessage({
		id: 'account.tokens.area.programme.level.description',
		defaultMessage: 'The years or stages of a programme',
		description: 'One line under the New token grid row named Levels.'
	}),
	tokenAreaSession: defineMessage({
		id: 'account.tokens.area.session',
		defaultMessage: 'Sessions',
		description: 'A row of the New token grid: what its permissions act on.'
	}),
	tokenAreaSessionDescription: defineMessage({
		id: 'account.tokens.area.session.description',
		defaultMessage: 'Where people are signed in',
		description: 'One line under the New token grid row named Sessions.'
	}),
	tokenAreaSubmission: defineMessage({
		id: 'account.tokens.area.submission',
		defaultMessage: 'Submissions',
		description: 'A row of the New token grid: what its permissions act on.'
	}),
	tokenAreaSubmissionDescription: defineMessage({
		id: 'account.tokens.area.submission.description',
		defaultMessage: 'Work candidates hand in',
		description: 'One line under the New token grid row named Submissions.'
	}),
	tokenAreaUser: defineMessage({
		id: 'account.tokens.area.user',
		defaultMessage: 'People',
		description: 'A row of the New token grid: what its permissions act on.'
	}),
	tokenAreaUserDescription: defineMessage({
		id: 'account.tokens.area.user.description',
		defaultMessage: 'Accounts and their affiliations',
		description: 'One line under the New token grid row named People.'
	}),
	tokenAreaProfilePicture: defineMessage({
		id: 'account.tokens.area.profile.picture',
		defaultMessage: 'Profile photos',
		description: 'A row of the New token grid: what its permissions act on.'
	}),
	tokenAreaProfilePictureDescription: defineMessage({
		id: 'account.tokens.area.profile.picture.description',
		defaultMessage: 'People’s profile photos',
		description: 'One line under the New token grid row named Profile photos.'
	}),
	tokenAreaAnyone: defineMessage({
		id: 'account.tokens.area.anyone',
		defaultMessage: '{area}, anyone’s',
		description: 'A grid row for the same area acting on anyone’s records, not only your own.'
	}),
	tokenAreaColumn: defineMessage({
		id: 'account.tokens.area.column',
		defaultMessage: 'Area',
		description: 'Header of the New token grid’s first column.'
	}),
	tokenColumnView: defineMessage({
		id: 'account.tokens.column.view',
		defaultMessage: 'View',
		description: 'Header of the New token grid column for viewing.'
	}),
	tokenColumnCreate: defineMessage({
		id: 'account.tokens.column.create',
		defaultMessage: 'Create',
		description: 'Header of the New token grid column for creating.'
	}),
	tokenColumnManage: defineMessage({
		id: 'account.tokens.column.manage',
		defaultMessage: 'Change',
		description: 'Header of the New token grid column for changing.'
	}),
	tokenColumnReview: defineMessage({
		id: 'account.tokens.column.review',
		defaultMessage: 'Review',
		description: 'Header of the New token grid column for reviewing and marking.'
	}),
	tokenColumnPublish: defineMessage({
		id: 'account.tokens.column.publish',
		defaultMessage: 'Publish',
		description: 'Header of the New token grid column for publishing and releasing.'
	}),
	tokenScopesHint: defineMessage({
		id: 'account.tokens.scopes.hint',
		defaultMessage:
			'One row for each area, one column for each action. A greyed box says why it can’t be ticked.',
		description: 'One line under What it can do in the New token dialog.'
	}),
	tokenAreaNeedsUnit: defineMessage({
		id: 'account.tokens.area.needs.unit',
		defaultMessage: 'Only on a token limited to one of your academic units',
		description:
			'Why a grid row is greyed: these permissions can’t apply to the whole institution.'
	}),
	tokenAreaNotInUnit: defineMessage({
		id: 'account.tokens.area.not.in.unit',
		defaultMessage: 'You can’t give this for {unit}',
		description:
			'Why a grid row is greyed: these permissions aren’t yours to give in that unit.'
	}),
	tokenWholeInstitution: defineMessage({
		id: 'account.tokens.whole.institution',
		defaultMessage: 'Whole institution',
		description: 'In a token’s summary: it is not limited to one academic unit.'
	}),
	tokenExpiresSoon: defineMessage({
		id: 'account.tokens.expires.soon',
		defaultMessage: 'Expires in {days} days',
		description: 'Amber badge on an active token that stops working within a week.'
	}),
	tokenExpiresTomorrow: defineMessage({
		id: 'account.tokens.expires.tomorrow',
		defaultMessage: 'Expires tomorrow',
		description: 'Amber badge on an active token that stops working within a day.'
	}),
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
	noActiveTokens: defineMessage({
		id: 'account.tokens.active.empty',
		defaultMessage: 'No active tokens',
		description: 'Title of the empty Active section while disabled or expired tokens exist.'
	}),
	noActiveTokensBody: defineMessage({
		id: 'account.tokens.active.empty.body',
		defaultMessage:
			'No script can use your account right now. Enable a disabled token below, or create a new one.',
		description: 'Body of the empty Active section while disabled or expired tokens exist.'
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
		defaultMessage: 'Not in use',
		description: 'Heading of disabled, expired and revoked tokens.'
	}),
	tokenUnitTag: defineMessage({
		id: 'account.tokens.unit.tag',
		defaultMessage: 'One academic unit only',
		description: 'The token is limited to an Academic Unit whose name is not known here.'
	}),
	tokenUnitNamedTag: defineMessage({
		id: 'account.tokens.unit.named.tag',
		defaultMessage: '{unit} only',
		description: 'The token is limited to the named Academic Unit.'
	}),
	tokenExpires: defineMessage({
		id: 'account.tokens.expires',
		defaultMessage: 'Expires {date}',
		description:
			'When a token expires, after another detail, as in "Disabled 10 Oct · expires 30 Dec".'
	}),
	tokenExpired: defineMessage({
		id: 'account.tokens.expired',
		defaultMessage: 'Expired {date}',
		description: 'When a token expired, at the start of its details.'
	}),
	tokenRevokedOn: defineMessage({
		id: 'account.tokens.revoked.on',
		defaultMessage: 'Revoked {date}',
		description: 'When a token was revoked, at the start of its details.'
	}),
	tokenDisabledOn: defineMessage({
		id: 'account.tokens.disabled.on',
		defaultMessage: 'Disabled {date}',
		description: 'When a token was disabled, at the start of its details.'
	}),
	tokenUsed: defineMessage({
		id: 'account.tokens.used',
		defaultMessage: 'Used {when}',
		description: 'When a token was last used.'
	}),
	tokenNeverUsed: defineMessage({
		id: 'account.tokens.never.used',
		defaultMessage: 'Never used',
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
			'A script using this token can do only what you tick, and never more than you can do yourself.',
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
		defaultMessage: 'In {days} days · {date}',
		description: 'One expiry choice.'
	}),
	createToken: defineMessage({
		id: 'account.tokens.create',
		defaultMessage: 'Create token',
		description: 'Create the token.'
	}),
	tokenCreating: defineMessage({
		id: 'account.tokens.creating',
		defaultMessage: 'Creating token…',
		description: 'The token is being created.'
	}),
	tokenCreatedTitle: defineMessage({
		id: 'account.tokens.created.title',
		defaultMessage: 'Copy your new token',
		description: 'Title of the one-time credential dialog.'
	}),
	tokenCreatedBody: defineMessage({
		id: 'account.tokens.created.body',
		defaultMessage:
			'This is the only time Proctor shows it. If you lose it, revoke it and create another.',
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
	copiedButton: defineMessage({
		id: 'account.tokens.copied.button',
		defaultMessage: 'Copied',
		description: "A Copy button's label for a moment after it copied."
	}),
	copied: defineMessage({
		id: 'account.tokens.copied',
		defaultMessage: 'Copied to the clipboard.',
		description: 'Announced to screen readers when the credential was copied.'
	}),
	copyFailed: defineMessage({
		id: 'account.tokens.copy.failed',
		defaultMessage: 'Couldn’t copy. Select the token and copy it yourself.',
		description: 'Copying the credential failed.'
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
	tokenScopeCountOne: defineMessage({
		id: 'account.tokens.scope.count.one',
		defaultMessage: '{count} permission',
		description: 'Beside the new-token buttons: how many permissions are ticked. One.'
	}),
	tokenScopeCount: defineMessage({
		id: 'account.tokens.scope.count',
		defaultMessage: '{count} permissions',
		description: 'Beside the new-token buttons: how many permissions are ticked. Two or more.'
	})
});
