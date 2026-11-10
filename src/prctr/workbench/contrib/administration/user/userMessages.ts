/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { defineMessage } from '../../../../base/common/localization.js';

/** Text of one user’s page. */
export const userMessages = Object.freeze({
	userDescription: defineMessage({
		id: 'administration.user.description',
		defaultMessage: '{email} · Username {username} · Member since {date}',
		description: 'Description under a user’s name; email may be absent.'
	}),
	userDescriptionNoEmail: defineMessage({
		id: 'administration.user.description.no.email',
		defaultMessage: 'Username {username} · Member since {date}',
		description: 'Description under a user’s name when they have no email.'
	}),
	userTrailUsers: defineMessage({
		id: 'administration.user.trail.users',
		defaultMessage: 'Users',
		description: 'The trail step back to the list of users.'
	}),
	userProfile: defineMessage({
		id: 'administration.user.profile',
		defaultMessage: 'Profile',
		description: 'Section with a user’s names, email, language and time zone.'
	}),
	userEdit: defineMessage({
		id: 'administration.user.edit',
		defaultMessage: 'Edit',
		description: 'Opens the dialog that edits a user’s profile.'
	}),
	userFirstName: defineMessage({
		id: 'administration.user.first.name',
		defaultMessage: 'First name',
		description: 'Profile field.'
	}),
	userLastName: defineMessage({
		id: 'administration.user.last.name',
		defaultMessage: 'Last name',
		description: 'Profile field.'
	}),
	userDisplayName: defineMessage({
		id: 'administration.user.display.name',
		defaultMessage: 'Display name',
		description: 'Profile field: the name others see.'
	}),
	userUsername: defineMessage({
		id: 'administration.user.username',
		defaultMessage: 'Username',
		description: 'Profile field.'
	}),
	userEmail: defineMessage({
		id: 'administration.user.email',
		defaultMessage: 'Email',
		description: 'Profile field.'
	}),
	userEmailVerified: defineMessage({
		id: 'administration.user.email.verified',
		defaultMessage: 'Verified',
		description: 'The email address is verified.'
	}),
	userEmailUnverified: defineMessage({
		id: 'administration.user.email.unverified',
		defaultMessage: 'Not verified',
		description: 'The email address is not verified yet.'
	}),
	userLanguage: defineMessage({
		id: 'administration.user.language',
		defaultMessage: 'Language',
		description: 'Profile field.'
	}),
	userTimezone: defineMessage({
		id: 'administration.user.timezone',
		defaultMessage: 'Time zone',
		description: 'Profile field.'
	}),
	userLastSignIn: defineMessage({
		id: 'administration.user.last.sign.in',
		defaultMessage: 'Last seen',
		description: 'Profile field.'
	}),
	userNone: defineMessage({
		id: 'administration.user.none',
		defaultMessage: '—',
		description: 'A profile field with no value.'
	}),
	userNever: defineMessage({
		id: 'administration.user.never',
		defaultMessage: 'Never',
		description: 'A user who has never signed in.'
	}),
	userEditTitle: defineMessage({
		id: 'administration.user.edit.title',
		defaultMessage: 'Edit {name}’s profile',
		description: 'Title of the dialog that edits a user’s profile.'
	}),
	userEditSave: defineMessage({
		id: 'administration.user.edit.save',
		defaultMessage: 'Save',
		description: 'Saves a user’s profile.'
	}),
	userLanguageHint: defineMessage({
		id: 'administration.user.language.hint',
		defaultMessage: 'A language tag such as en-GB, or empty to use the institution’s.',
		description: 'Hint under the language field.'
	}),
	userTimezoneHint: defineMessage({
		id: 'administration.user.timezone.hint',
		defaultMessage: 'A time zone such as Europe/London, or empty to use the institution’s.',
		description: 'Hint under the time zone field.'
	}),
	userSaved: defineMessage({
		id: 'administration.user.saved',
		defaultMessage: '{name}’s profile is saved',
		description: 'Toast after a profile is saved.'
	}),
	userAffiliations: defineMessage({
		id: 'administration.user.affiliations',
		defaultMessage: 'Affiliations',
		description: 'Section with how a user belongs to the institution.'
	}),
	userAffiliationsEmpty: defineMessage({
		id: 'administration.user.affiliations.empty',
		defaultMessage: 'No affiliations yet.',
		description: 'A user with no affiliations.'
	}),
	userAddAffiliation: defineMessage({
		id: 'administration.user.affiliation.add',
		defaultMessage: 'Add affiliation',
		description: 'Opens the dialog that adds an affiliation.'
	}),
	userAffiliationKind: defineMessage({
		id: 'administration.user.affiliation.kind',
		defaultMessage: 'Affiliation',
		description: 'Field: student, teacher, staff or external.'
	}),
	userAffiliationStudent: defineMessage({
		id: 'administration.user.affiliation.student',
		defaultMessage: 'Student',
		description: 'Affiliation kind.'
	}),
	userAffiliationTeacher: defineMessage({
		id: 'administration.user.affiliation.teacher',
		defaultMessage: 'Teacher',
		description: 'Affiliation kind.'
	}),
	userAffiliationStaff: defineMessage({
		id: 'administration.user.affiliation.staff',
		defaultMessage: 'Staff',
		description: 'Affiliation kind.'
	}),
	userAffiliationExternal: defineMessage({
		id: 'administration.user.affiliation.external',
		defaultMessage: 'External',
		description: 'Affiliation kind.'
	}),
	userStarts: defineMessage({
		id: 'administration.user.starts',
		defaultMessage: 'Starts',
		description: 'Field: when something starts; empty means now.'
	}),
	userEnds: defineMessage({
		id: 'administration.user.ends',
		defaultMessage: 'Ends',
		description: 'Field: when something ends; empty means no end.'
	}),
	userStartsHint: defineMessage({
		id: 'administration.user.starts.hint',
		defaultMessage: 'Empty starts it now.',
		description: 'Hint under a start date.'
	}),
	userEndsHint: defineMessage({
		id: 'administration.user.ends.hint',
		defaultMessage: 'Empty means it has no end date.',
		description: 'Hint under an end date.'
	}),
	userEndsBeforeStart: defineMessage({
		id: 'administration.user.ends.before.start',
		defaultMessage: 'The end must come after the start.',
		description: 'Error when an end date is before the start.'
	}),
	userPeriodOpen: defineMessage({
		id: 'administration.user.period.open',
		defaultMessage: 'From {start} · No end date',
		description: 'Detail of an affiliation or role with no end.'
	}),
	userPeriod: defineMessage({
		id: 'administration.user.period',
		defaultMessage: 'From {start} to {end}',
		description: 'Detail of an affiliation or role with an end.'
	}),
	userCurrent: defineMessage({
		id: 'administration.user.current',
		defaultMessage: 'Current',
		description: 'Status of an affiliation or role that applies now.'
	}),
	userUpcoming: defineMessage({
		id: 'administration.user.upcoming',
		defaultMessage: 'Upcoming',
		description: 'Status of an affiliation or role that starts later.'
	}),
	userEnded: defineMessage({
		id: 'administration.user.ended',
		defaultMessage: 'Ended',
		description: 'Status of an affiliation or role that has ended.'
	}),
	userAddAffiliationSave: defineMessage({
		id: 'administration.user.affiliation.save',
		defaultMessage: 'Add affiliation',
		description: 'Confirms adding an affiliation.'
	}),
	userAffiliationAdded: defineMessage({
		id: 'administration.user.affiliation.added',
		defaultMessage: 'Affiliation added',
		description: 'Toast after an affiliation is added.'
	}),
	userEndAffiliation: defineMessage({
		id: 'administration.user.affiliation.end',
		defaultMessage: 'End affiliation',
		description: 'Row action that ends an affiliation after confirming.'
	}),
	userEndAffiliationTitle: defineMessage({
		id: 'administration.user.affiliation.end.title',
		defaultMessage: 'End this affiliation?',
		description: 'Confirmation title before ending an affiliation.'
	}),
	userEndAffiliationBody: defineMessage({
		id: 'administration.user.affiliation.end.body',
		defaultMessage:
			'It ends now. A student with a current class enrolment keeps it until the enrolment ends.',
		description: 'Confirmation body before ending an affiliation.'
	}),
	userEndAffiliationConfirm: defineMessage({
		id: 'administration.user.affiliation.end.confirm',
		defaultMessage: 'End affiliation',
		description: 'Confirms ending an affiliation.'
	}),
	userAffiliationEnded: defineMessage({
		id: 'administration.user.affiliation.ended',
		defaultMessage: 'Affiliation ended',
		description: 'Toast after an affiliation ends.'
	}),
	userRoles: defineMessage({
		id: 'administration.user.roles',
		defaultMessage: 'Roles',
		description: 'Section with the roles a user holds and where.'
	}),
	userRolesEmpty: defineMessage({
		id: 'administration.user.roles.empty',
		defaultMessage: 'No roles. They can only use what their affiliations allow.',
		description: 'A user with no roles.'
	}),
	userGrantRole: defineMessage({
		id: 'administration.user.role.grant',
		defaultMessage: 'Grant role',
		description: 'Opens the dialog that grants a role.'
	}),
	userRole: defineMessage({
		id: 'administration.user.role',
		defaultMessage: 'Role',
		description: 'Field: which role to grant.'
	}),
	userWhere: defineMessage({
		id: 'administration.user.where',
		defaultMessage: 'Where',
		description: 'Field: where a role applies.'
	}),
	userWhereInstitution: defineMessage({
		id: 'administration.user.where.institution',
		defaultMessage: 'Everywhere at the institution',
		description: 'Role scope: the whole institution.'
	}),
	userScopeInstitution: defineMessage({
		id: 'administration.user.scope.institution',
		defaultMessage: 'Institution',
		description: 'A role held across the institution.'
	}),
	userScopeUnit: defineMessage({
		id: 'administration.user.scope.unit',
		defaultMessage: 'Academic unit',
		description: 'A role held in one academic unit.'
	}),
	userScopeClass: defineMessage({
		id: 'administration.user.scope.class',
		defaultMessage: 'Class',
		description: 'A role held in one class.'
	}),
	userGrantRoleSave: defineMessage({
		id: 'administration.user.role.grant.save',
		defaultMessage: 'Grant role',
		description: 'Confirms granting a role.'
	}),
	userRoleGranted: defineMessage({
		id: 'administration.user.role.granted',
		defaultMessage: 'Role granted',
		description: 'Toast after a role is granted.'
	}),
	userEndRole: defineMessage({
		id: 'administration.user.role.end',
		defaultMessage: 'End role',
		description: 'Row action that ends a role after confirming.'
	}),
	userEndRoleTitle: defineMessage({
		id: 'administration.user.role.end.title',
		defaultMessage: 'End {role}?',
		description: 'Confirmation title before ending a role; role is its name.'
	}),
	userEndRoleBody: defineMessage({
		id: 'administration.user.role.end.body',
		defaultMessage: 'They lose what this role lets them do straight away.',
		description: 'Confirmation body before ending a role.'
	}),
	userEndRoleConfirm: defineMessage({
		id: 'administration.user.role.end.confirm',
		defaultMessage: 'End role',
		description: 'Confirms ending a role.'
	}),
	userRoleEnded: defineMessage({
		id: 'administration.user.role.ended',
		defaultMessage: 'Role ended',
		description: 'Toast after a role ends.'
	}),
	userUnknownRole: defineMessage({
		id: 'administration.user.role.unknown',
		defaultMessage: 'A role you can’t see',
		description: 'A role binding whose role is not listed.'
	}),
	userSessions: defineMessage({
		id: 'administration.user.sessions',
		defaultMessage: 'Sessions',
		description: 'Section with where a user is signed in.'
	}),
	userSessionsEmpty: defineMessage({
		id: 'administration.user.sessions.empty',
		defaultMessage: 'They aren’t signed in anywhere.',
		description: 'A user with no open sessions.'
	}),
	userSessionDetail: defineMessage({
		id: 'administration.user.session.detail',
		defaultMessage: 'Signed in {signedIn} · Active {active}',
		description: 'Detail of one session.'
	}),
	userSessionDesktop: defineMessage({
		id: 'administration.user.session.desktop',
		defaultMessage: 'Proctor Desktop',
		description: 'A session in Proctor Desktop.'
	}),
	userSessionWeb: defineMessage({
		id: 'administration.user.session.web',
		defaultMessage: 'Web browser',
		description: 'A session in a web browser.'
	}),
	userSessionCli: defineMessage({
		id: 'administration.user.session.cli',
		defaultMessage: 'Command line',
		description: 'A session from the command line.'
	}),
	userSessionOther: defineMessage({
		id: 'administration.user.session.other',
		defaultMessage: 'Other client',
		description: 'A session from another client.'
	}),
	userEndSession: defineMessage({
		id: 'administration.user.session.end',
		defaultMessage: 'Sign out',
		description: 'Row action that ends one session.'
	}),
	userSessionEnded: defineMessage({
		id: 'administration.user.session.ended',
		defaultMessage: 'Signed out of that session',
		description: 'Toast after one session ends.'
	}),
	userResetTwoStep: defineMessage({
		id: 'administration.user.two.step.reset',
		defaultMessage: 'Reset two-step',
		description: 'Opens the dialog that resets two-step verification.'
	}),
	userResetTwoStepTitle: defineMessage({
		id: 'administration.user.two.step.title',
		defaultMessage: 'Reset {name}’s two-step verification?',
		description: 'Title of the reset dialog.'
	}),
	userResetTwoStepBody: defineMessage({
		id: 'administration.user.two.step.body',
		defaultMessage:
			'Their authenticator and recovery codes stop working, and they set up two-step verification again at their next sign-in. Only do this once you know it’s them.',
		description: 'Body of the reset dialog.'
	}),
	userIdentityVerified: defineMessage({
		id: 'administration.user.two.step.verified',
		defaultMessage: 'I checked who they are',
		description: 'Attestation required before resetting two-step verification.'
	}),
	userIdentityRequired: defineMessage({
		id: 'administration.user.two.step.verified.required',
		defaultMessage: 'Confirm you checked who they are.',
		description: 'Error when the attestation is not ticked.'
	}),
	userResetReason: defineMessage({
		id: 'administration.user.two.step.reason',
		defaultMessage: 'Reason',
		description: 'Field: why two-step verification is reset.'
	}),
	userResetReference: defineMessage({
		id: 'administration.user.two.step.reference',
		defaultMessage: 'Verification reference',
		description: 'Field: a reference for how identity was checked, such as a ticket.'
	}),
	userResetConfirm: defineMessage({
		id: 'administration.user.two.step.confirm',
		defaultMessage: 'Reset two-step verification',
		description: 'Confirms the reset.'
	}),
	userTwoStepReset: defineMessage({
		id: 'administration.user.two.step.done',
		defaultMessage: '{name}’s two-step verification is reset',
		description: 'Toast after the reset.'
	}),
	userChangeEmail: defineMessage({
		id: 'administration.user.email.change',
		defaultMessage: 'Change email',
		description: 'Menu action that changes a user’s email.'
	}),
	userChangeEmailTitle: defineMessage({
		id: 'administration.user.email.change.title',
		defaultMessage: 'Change {name}’s email',
		description: 'Title of the change email dialog.'
	}),
	userChangeEmailBody: defineMessage({
		id: 'administration.user.email.change.body',
		defaultMessage:
			'A link to confirm goes to the new address, and a link to undo goes to the old one.',
		description: 'Body of the change email dialog.'
	}),
	userNewEmail: defineMessage({
		id: 'administration.user.email.new',
		defaultMessage: 'New email',
		description: 'Field: the new email address.'
	}),
	userEmailInvalid: defineMessage({
		id: 'administration.user.email.invalid',
		defaultMessage: 'Enter an email address.',
		description: 'Error for an invalid email address.'
	}),
	userChangeEmailConfirm: defineMessage({
		id: 'administration.user.email.change.confirm',
		defaultMessage: 'Change email',
		description: 'Confirms changing the email.'
	}),
	userEmailChanged: defineMessage({
		id: 'administration.user.email.changed',
		defaultMessage: 'A confirmation link is on its way to the new address',
		description: 'Toast after the email change starts.'
	}),
	userMarkVerified: defineMessage({
		id: 'administration.user.email.verify',
		defaultMessage: 'Mark email verified',
		description: 'Menu action that marks the email verified.'
	}),
	userEmailMarked: defineMessage({
		id: 'administration.user.email.marked',
		defaultMessage: '{name}’s email is marked verified',
		description: 'Toast after marking the email verified.'
	}),
	userMore: defineMessage({
		id: 'administration.user.more',
		defaultMessage: 'More actions',
		description: 'Accessible name of the button with a user’s less common actions.'
	})
});
