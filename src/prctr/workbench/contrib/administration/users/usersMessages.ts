/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { defineMessage } from '../../../../base/common/localization.js';

/** Text of the Users page and the actions on one user that it shares with that user’s page. */
export const usersMessages = Object.freeze({
	usersImport: defineMessage({
		id: 'administration.users.action.import',
		defaultMessage: 'Import',
		description: 'Users page action that opens Imports.'
	}),
	usersInvite: defineMessage({
		id: 'administration.users.action.invite',
		defaultMessage: 'Invite people',
		description: 'Users page action that opens the invitation dialog.'
	}),
	usersFind: defineMessage({
		id: 'administration.users.find',
		defaultMessage: 'Find by name, email or username',
		description: 'Search field above the list of users.'
	}),
	usersStatus: defineMessage({
		id: 'administration.users.filter.status',
		defaultMessage: 'Status',
		description: 'Filter over the list of users by whether accounts are disabled.'
	}),
	usersStatusActive: defineMessage({
		id: 'administration.users.filter.status.active',
		defaultMessage: 'Active',
		description: 'Users filter choice: only accounts that can sign in.'
	}),
	usersStatusAny: defineMessage({
		id: 'administration.users.filter.status.any',
		defaultMessage: 'Any status',
		description: 'Users filter choice: active and disabled accounts.'
	}),
	usersTable: defineMessage({
		id: 'administration.users.table',
		defaultMessage: 'Users',
		description: 'Accessible name of the table of users.'
	}),
	usersColumnPerson: defineMessage({
		id: 'administration.users.column.person',
		defaultMessage: 'Person',
		description: 'Users table column with the name and email.'
	}),
	usersColumnUsername: defineMessage({
		id: 'administration.users.column.username',
		defaultMessage: 'Username',
		description: 'Users table column.'
	}),
	usersColumnLastActive: defineMessage({
		id: 'administration.users.column.last.active',
		defaultMessage: 'Last active',
		description: 'Users table column with when they were last active.'
	}),
	usersColumnStatus: defineMessage({
		id: 'administration.users.column.status',
		defaultMessage: 'Status',
		description: 'Users table column with Active or Disabled.'
	}),
	usersNeverActive: defineMessage({
		id: 'administration.users.never.active',
		defaultMessage: '—',
		description: 'A user who has never been active.'
	}),
	userActive: defineMessage({
		id: 'administration.users.status.active',
		defaultMessage: 'Active',
		description: 'Status of an account that can sign in.'
	}),
	userDisabled: defineMessage({
		id: 'administration.users.status.disabled',
		defaultMessage: 'Disabled',
		description: 'Status of an account that cannot sign in.'
	}),
	usersEmpty: defineMessage({
		id: 'administration.users.empty',
		defaultMessage: 'No one has an account yet.',
		description: 'Users list with no accounts.'
	}),
	usersNoMatch: defineMessage({
		id: 'administration.users.empty.filtered',
		defaultMessage: 'No one matches. Try another name or include disabled accounts.',
		description: 'Users list with no matches for the filters.'
	}),
	userOpen: defineMessage({
		id: 'administration.users.action.open',
		defaultMessage: 'Open',
		description: 'Row action that opens a user’s page.'
	}),
	userDisable: defineMessage({
		id: 'administration.users.action.disable',
		defaultMessage: 'Disable account',
		description: 'Row action that disables a user’s account after confirming.'
	}),
	userEnable: defineMessage({
		id: 'administration.users.action.enable',
		defaultMessage: 'Enable account',
		description: 'Row action that lets a disabled user sign in again.'
	}),
	userSignOutEverywhere: defineMessage({
		id: 'administration.users.action.sign.out',
		defaultMessage: 'Sign out everywhere',
		description: 'Row action that ends all of a user’s sessions after confirming.'
	}),
	userDisableTitle: defineMessage({
		id: 'administration.users.disable.title',
		defaultMessage: 'Disable {name}’s account?',
		description: 'Confirmation title before disabling an account; name is the person.'
	}),
	userDisableBody: defineMessage({
		id: 'administration.users.disable.body',
		defaultMessage:
			'They’re signed out everywhere at once and can’t sign in until the account is enabled again. Their submissions, results and history are kept.',
		description: 'Confirmation body before disabling an account.'
	}),
	userDisableConfirm: defineMessage({
		id: 'administration.users.disable.confirm',
		defaultMessage: 'Disable account',
		description: 'Confirms disabling an account.'
	}),
	userDisabledToast: defineMessage({
		id: 'administration.users.disabled.toast',
		defaultMessage: '{name}’s account is disabled',
		description: 'Toast after an account is disabled.'
	}),
	userEnabledToast: defineMessage({
		id: 'administration.users.enabled.toast',
		defaultMessage: '{name} can sign in again',
		description: 'Toast after an account is enabled.'
	}),
	userSignOutTitle: defineMessage({
		id: 'administration.users.sign.out.title',
		defaultMessage: 'Sign {name} out everywhere?',
		description: 'Confirmation title before ending all of a user’s sessions.'
	}),
	userSignOutBody: defineMessage({
		id: 'administration.users.sign.out.body',
		defaultMessage:
			'Every session on every device ends now. They can sign in again straight away.',
		description: 'Confirmation body before ending all of a user’s sessions.'
	}),
	userSignOutConfirm: defineMessage({
		id: 'administration.users.sign.out.confirm',
		defaultMessage: 'Sign out everywhere',
		description: 'Confirms ending all of a user’s sessions.'
	}),
	userSignedOutToast: defineMessage({
		id: 'administration.users.signed.out.toast',
		defaultMessage: '{name} is signed out everywhere',
		description: 'Toast after all of a user’s sessions end.'
	}),
	usersAffiliation: defineMessage({
		id: 'administration.users.affiliation',
		defaultMessage: 'Affiliation',
		description: 'Filter and column of a person’s affiliation with the institution.'
	}),
	usersAffiliationAny: defineMessage({
		id: 'administration.users.affiliation.any',
		defaultMessage: 'Any affiliation',
		description: 'The affiliation filter shows everyone.'
	}),
	usersUnit: defineMessage({
		id: 'administration.users.unit',
		defaultMessage: 'Unit',
		description: 'Filter of the academic unit people belong to.'
	}),
	usersUnitAny: defineMessage({
		id: 'administration.users.unit.any',
		defaultMessage: 'Any unit',
		description: 'The unit filter shows everyone.'
	}),
	usersColumnRoles: defineMessage({
		id: 'administration.users.column.roles',
		defaultMessage: 'Roles',
		description: 'Column of the roles a person holds.'
	}),
	usersNoAffiliation: defineMessage({
		id: 'administration.users.no.affiliation',
		defaultMessage: 'No affiliation',
		description: 'A person with no current affiliation.'
	}),
	usersMore: defineMessage({
		id: 'administration.users.more',
		defaultMessage: '{list} +{count}',
		description:
			'A short list followed by how many more aren’t shown, as in "Teacher, Exam manager +2".'
	}),
	usersNoRole: defineMessage({
		id: 'administration.users.no.role',
		defaultMessage: '—',
		description: 'A person who holds no role.'
	}),
	affiliationStudent: defineMessage({
		id: 'administration.affiliation.student',
		defaultMessage: 'Student',
		description: 'A student affiliation.'
	}),
	affiliationTeacher: defineMessage({
		id: 'administration.affiliation.teacher',
		defaultMessage: 'Teacher',
		description: 'A teacher affiliation.'
	}),
	affiliationStaff: defineMessage({
		id: 'administration.affiliation.staff',
		defaultMessage: 'Staff',
		description: 'A staff affiliation.'
	}),
	affiliationExternal: defineMessage({
		id: 'administration.affiliation.external',
		defaultMessage: 'External',
		description: 'An external affiliation.'
	}),
	usersSelectedOne: defineMessage({
		id: 'administration.users.selected.one',
		defaultMessage: '1 selected',
		description: 'How many people are chosen in the Users table. One person.'
	}),
	usersSelected: defineMessage({
		id: 'administration.users.selected',
		defaultMessage: '{count} selected',
		description: 'How many people are chosen in the Users table. Two or more.'
	}),
	usersSelectionLabelOne: defineMessage({
		id: 'administration.users.selection.label.one',
		defaultMessage: 'Changes for 1 selected person',
		description: 'Accessible name of the toolbar for chosen people. One person.'
	}),
	usersSelectionLabel: defineMessage({
		id: 'administration.users.selection.label',
		defaultMessage: 'Changes for {count} selected people',
		description: 'Accessible name of the toolbar for chosen people. Two or more.'
	}),
	usersBulkEnrol: defineMessage({
		id: 'administration.users.bulk.enrol',
		defaultMessage: 'Enrol in a class',
		description: 'Enrols the chosen people in one class.'
	}),
	usersBulkGrant: defineMessage({
		id: 'administration.users.bulk.grant',
		defaultMessage: 'Grant role',
		description: 'Grants the chosen people one role.'
	}),
	usersBulkSignOut: defineMessage({
		id: 'administration.users.bulk.sign.out',
		defaultMessage: 'Sign out everywhere',
		description: 'Ends every session of the chosen people.'
	}),
	usersBulkDisable: defineMessage({
		id: 'administration.users.bulk.disable',
		defaultMessage: 'Disable',
		description: 'Disables the chosen people’s accounts.'
	}),
	usersBulkEnable: defineMessage({
		id: 'administration.users.bulk.enable',
		defaultMessage: 'Enable',
		description: 'Enables the chosen people’s accounts.'
	}),
	usersBulkClear: defineMessage({
		id: 'administration.users.bulk.clear',
		defaultMessage: 'Clear selection',
		description: 'Unchooses every chosen person.'
	}),
	bulkEnrolTitleOne: defineMessage({
		id: 'administration.bulk.enrol.title.one',
		defaultMessage: 'Enrol 1 person in a class',
		description: 'Title of the dialog that enrols chosen people. One person.'
	}),
	bulkEnrolTitle: defineMessage({
		id: 'administration.bulk.enrol.title',
		defaultMessage: 'Enrol {count} people in a class',
		description: 'Title of the dialog that enrols chosen people. Two or more.'
	}),
	bulkEnrolBody: defineMessage({
		id: 'administration.bulk.enrol.body',
		defaultMessage:
			'They join the class from the date you choose. Each person is handled on their own, so one who can’t be enrolled doesn’t stop the others.',
		description: 'Explains enrolling several people.'
	}),
	bulkPeople: defineMessage({
		id: 'administration.bulk.people',
		defaultMessage: 'People',
		description: 'Label of the chosen people in a bulk dialog.'
	}),
	bulkUnit: defineMessage({
		id: 'administration.bulk.unit',
		defaultMessage: 'Unit',
		description: 'Label of the unit whose classes or roles a bulk dialog offers.'
	}),
	bulkClass: defineMessage({
		id: 'administration.bulk.class',
		defaultMessage: 'Class',
		description: 'Label of the class to enrol people in.'
	}),
	bulkFrom: defineMessage({
		id: 'administration.bulk.from',
		defaultMessage: 'From',
		description: 'Label of the day a bulk change starts.'
	}),
	bulkFromHint: defineMessage({
		id: 'administration.bulk.from.hint',
		defaultMessage: 'Their enrolment starts on this date and appears in the class at once.',
		description: 'Hint under the start date of an enrolment.'
	}),
	bulkEnrolConfirmOne: defineMessage({
		id: 'administration.bulk.enrol.confirm.one',
		defaultMessage: 'Enrol 1 person',
		description: 'Confirms enrolling the chosen people. One person.'
	}),
	bulkEnrolConfirm: defineMessage({
		id: 'administration.bulk.enrol.confirm',
		defaultMessage: 'Enrol {count} people',
		description: 'Confirms enrolling the chosen people. Two or more.'
	}),
	bulkGrantTitleOne: defineMessage({
		id: 'administration.bulk.grant.title.one',
		defaultMessage: 'Grant 1 person a role',
		description: 'Title of the dialog that grants chosen people a role. One person.'
	}),
	bulkGrantTitle: defineMessage({
		id: 'administration.bulk.grant.title',
		defaultMessage: 'Grant {count} people a role',
		description: 'Title of the dialog that grants chosen people a role. Two or more.'
	}),
	bulkGrantBody: defineMessage({
		id: 'administration.bulk.grant.body',
		defaultMessage:
			'The role applies where you choose: the whole institution or one unit. Each person is handled on their own.',
		description: 'Explains granting a role to several people.'
	}),
	bulkRole: defineMessage({
		id: 'administration.bulk.role',
		defaultMessage: 'Role',
		description: 'Label of the role to grant.'
	}),
	bulkWhere: defineMessage({
		id: 'administration.bulk.where',
		defaultMessage: 'Where',
		description: 'Label of where a role applies.'
	}),
	bulkWhereInstitution: defineMessage({
		id: 'administration.bulk.where.institution',
		defaultMessage: 'The whole institution',
		description: 'A role that applies everywhere.'
	}),
	bulkGrantConfirmOne: defineMessage({
		id: 'administration.bulk.grant.confirm.one',
		defaultMessage: 'Grant to 1 person',
		description: 'Confirms granting the role. One person.'
	}),
	bulkGrantConfirm: defineMessage({
		id: 'administration.bulk.grant.confirm',
		defaultMessage: 'Grant to {count} people',
		description: 'Confirms granting the role. Two or more.'
	}),
	bulkSignOutTitleOne: defineMessage({
		id: 'administration.bulk.sign.out.title.one',
		defaultMessage: 'Sign 1 person out everywhere?',
		description: 'Confirms ending every session of the chosen people. One person.'
	}),
	bulkSignOutTitle: defineMessage({
		id: 'administration.bulk.sign.out.title',
		defaultMessage: 'Sign {count} people out everywhere?',
		description: 'Confirms ending every session of the chosen people. Two or more.'
	}),
	bulkSignOutBody: defineMessage({
		id: 'administration.bulk.sign.out.body',
		defaultMessage:
			'Every session they have ends now, on every device. They can sign in again straight away.',
		description: 'Explains signing several people out.'
	}),
	bulkDisableTitleOne: defineMessage({
		id: 'administration.bulk.disable.title.one',
		defaultMessage: 'Disable 1 account?',
		description: 'Confirms disabling the chosen people’s accounts. One person.'
	}),
	bulkDisableTitle: defineMessage({
		id: 'administration.bulk.disable.title',
		defaultMessage: 'Disable {count} accounts?',
		description: 'Confirms disabling the chosen people’s accounts. Two or more.'
	}),
	bulkDisableBody: defineMessage({
		id: 'administration.bulk.disable.body',
		defaultMessage:
			'They’re signed out everywhere at once and can’t sign in until their account is enabled again. Their submissions, results and history are kept.',
		description: 'Explains disabling several accounts.'
	}),
	bulkDisableConfirmOne: defineMessage({
		id: 'administration.bulk.disable.confirm.one',
		defaultMessage: 'Disable 1 account',
		description: 'Confirms disabling the chosen accounts. One person.'
	}),
	bulkDisableConfirm: defineMessage({
		id: 'administration.bulk.disable.confirm',
		defaultMessage: 'Disable {count} accounts',
		description: 'Confirms disabling the chosen accounts. Two or more.'
	}),
	bulkEnableTitleOne: defineMessage({
		id: 'administration.bulk.enable.title.one',
		defaultMessage: 'Enable 1 account?',
		description: 'Confirms enabling the chosen people’s accounts. One person.'
	}),
	bulkEnableTitle: defineMessage({
		id: 'administration.bulk.enable.title',
		defaultMessage: 'Enable {count} accounts?',
		description: 'Confirms enabling the chosen people’s accounts. Two or more.'
	}),
	bulkEnableBody: defineMessage({
		id: 'administration.bulk.enable.body',
		defaultMessage: 'They can sign in again.',
		description: 'Explains enabling several accounts.'
	}),
	bulkEnableConfirmOne: defineMessage({
		id: 'administration.bulk.enable.confirm.one',
		defaultMessage: 'Enable 1 account',
		description: 'Confirms enabling the chosen accounts. One person.'
	}),
	bulkEnableConfirm: defineMessage({
		id: 'administration.bulk.enable.confirm',
		defaultMessage: 'Enable {count} accounts',
		description: 'Confirms enabling the chosen accounts. Two or more.'
	}),
	bulkResultAllOne: defineMessage({
		id: 'administration.bulk.result.all.one',
		defaultMessage: 'Done for 1 person',
		description: 'Toast when a change applied to everyone chosen. One person.'
	}),
	bulkResultAll: defineMessage({
		id: 'administration.bulk.result.all',
		defaultMessage: 'Done for all {count} people',
		description: 'Toast when a change applied to everyone chosen. Two or more.'
	}),
	bulkResultTitle: defineMessage({
		id: 'administration.bulk.result.title',
		defaultMessage: '{done} of {count} done',
		description: 'Title of the result of a change for several people, as in "2 of 3 done".'
	}),
	bulkResultBody: defineMessage({
		id: 'administration.bulk.result.body',
		defaultMessage:
			'Fix what’s below and try those people again on their own; the others are already done.',
		description: 'Explains a partly applied change.'
	}),
	bulkResultDone: defineMessage({
		id: 'administration.bulk.result.done',
		defaultMessage: 'Done',
		description: 'A person the change applied to.'
	}),
	bulkResultSame: defineMessage({
		id: 'administration.bulk.result.same',
		defaultMessage: 'Already as asked, nothing changed',
		description: 'A person the change didn’t need to change.'
	}),
	bulkResultClose: defineMessage({
		id: 'administration.bulk.result.close',
		defaultMessage: 'Done',
		description: 'Closes the result of a change for several people.'
	}),
	bulkPeopleCountOne: defineMessage({
		id: 'administration.bulk.people.count.one',
		defaultMessage: '1 person',
		description: 'Footnote of a bulk dialog: how many people it changes. One person.'
	}),
	bulkPeopleCount: defineMessage({
		id: 'administration.bulk.people.count',
		defaultMessage: '{count} people',
		description: 'Footnote of a bulk dialog: how many people it changes. Two or more.'
	}),
	userDisableReason: defineMessage({
		id: 'administration.user.disable.reason',
		defaultMessage: 'Reason',
		description: 'Label of why an account is disabled.'
	}),
	userDisableReasonHint: defineMessage({
		id: 'administration.user.disable.reason.hint',
		defaultMessage: 'Optional. Kept in Audits; {name} doesn’t see it.',
		description: 'Hint under the reason for disabling an account.'
	}),
	userDisableReasonLong: defineMessage({
		id: 'administration.user.disable.reason.long',
		defaultMessage: 'Keep the reason under 500 characters.',
		description: 'Error when the reason is too long.'
	}),
	userReplacePhoto: defineMessage({
		id: 'administration.user.replace.photo',
		defaultMessage: 'Replace photo',
		description: 'Chooses a new profile photo for someone.'
	}),
	userRemovePhoto: defineMessage({
		id: 'administration.user.remove.photo',
		defaultMessage: 'Remove photo',
		description: 'Removes someone’s own profile photo.'
	}),
	userRemovePhotoTitle: defineMessage({
		id: 'administration.user.remove.photo.title',
		defaultMessage: 'Remove {name}’s photo?',
		description: 'Confirms removing someone’s photo.'
	}),
	userRemovePhotoBody: defineMessage({
		id: 'administration.user.remove.photo.body',
		defaultMessage: 'Their initials are shown instead until they add a new one.',
		description: 'Explains removing a photo.'
	}),
	userRemovePhotoConfirm: defineMessage({
		id: 'administration.user.remove.photo.confirm',
		defaultMessage: 'Remove photo',
		description: 'Confirms removing a photo.'
	}),
	userPhotoReplaced: defineMessage({
		id: 'administration.user.photo.replaced',
		defaultMessage: '{name}’s photo is updated',
		description: 'Toast after replacing a photo.'
	}),
	userPhotoRemoved: defineMessage({
		id: 'administration.user.photo.removed',
		defaultMessage: '{name}’s photo is removed',
		description: 'Toast after removing a photo.'
	}),
	userPhotoUnsupported: defineMessage({
		id: 'administration.user.photo.unsupported',
		defaultMessage: 'Choose a PNG, JPEG or WebP image under 5 MB.',
		description: 'Toast when the chosen file can’t be a photo.'
	}),
	usersBulkMore: defineMessage({
		id: 'administration.users.bulk.more',
		defaultMessage: 'More changes for the selected people',
		description: 'Accessible name of the ⋯ menu in the selection bar.'
	})
});
