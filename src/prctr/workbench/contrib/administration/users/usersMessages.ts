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
	usersStatusDisabled: defineMessage({
		id: 'administration.users.filter.status.disabled',
		defaultMessage: 'Disabled',
		description: 'Users filter choice: only accounts that are turned off.'
	}),
	usersRole: defineMessage({
		id: 'administration.users.filter.role.label',
		defaultMessage: 'Role',
		description: 'Users filter: people who hold a role.'
	}),
	usersRoleAny: defineMessage({
		id: 'administration.users.filter.role.any',
		defaultMessage: 'Any',
		description: 'Users filter choice: no role filter.'
	}),
	usersLastActiveAny: defineMessage({
		id: 'administration.users.filter.active.any',
		defaultMessage: 'Any',
		description: 'Users filter choice: no filter on when people were last active.'
	}),
	usersLastActiveNever: defineMessage({
		id: 'administration.users.filter.active.never',
		defaultMessage: 'Never signed in',
		description: 'Users filter choice: people who have never signed in.'
	}),
	usersLastActiveRecent: defineMessage({
		id: 'administration.users.filter.active.recent',
		defaultMessage: 'In the last 30 days',
		description: 'Users filter choice: people active in the last 30 days.'
	}),
	usersLastActiveIdle: defineMessage({
		id: 'administration.users.filter.active.idle',
		defaultMessage: 'Not for 90 days',
		description: 'Users filter choice: people not active for 90 days or more.'
	}),
	usersMoreFilters: defineMessage({
		id: 'administration.users.filter.more',
		defaultMessage: 'More filters',
		description: 'Opens the filters not shown in the bar: Role and Last active.'
	}),
	usersStatusAny: defineMessage({
		id: 'administration.users.filter.status.any',
		defaultMessage: 'Any',
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
		defaultMessage: 'No one has an account yet',
		description: 'Title of the empty Users list.'
	}),
	usersEmptyText: defineMessage({
		id: 'administration.users.empty.text',
		defaultMessage: 'People appear here once they accept an invitation or are imported.',
		description: 'Explains the empty Users list.'
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
		defaultMessage: 'Any',
		description: 'The affiliation filter shows everyone.'
	}),
	usersUnit: defineMessage({
		id: 'administration.users.unit',
		defaultMessage: 'Unit',
		description: 'Filter of the academic unit people belong to.'
	}),
	usersUnitAny: defineMessage({
		id: 'administration.users.unit.any',
		defaultMessage: 'Any',
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
		defaultMessage: '{count} selected',
		description: 'How many people are chosen in the Users table. One person.'
	}),
	usersSelected: defineMessage({
		id: 'administration.users.selected',
		defaultMessage: '{count} selected',
		description: 'How many people are chosen in the Users table. Two or more.'
	}),
	usersSelectionLabelOne: defineMessage({
		id: 'administration.users.selection.label.one',
		defaultMessage: 'Changes for {count} selected person',
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
		defaultMessage: 'Enrol {count} person in a class',
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
	bulkRemovePerson: defineMessage({
		id: 'administration.users.bulk.leaveout',
		defaultMessage: 'Leave out {name}',
		description: 'Accessible name of the × on a person chip in a change for several people.'
	}),
	previewChecking: defineMessage({
		id: 'administration.users.preview.checking',
		defaultMessage: 'Checking…',
		description: 'The confirming button while the server checks everyone.'
	}),
	previewRunning: defineMessage({
		id: 'administration.users.preview.running',
		defaultMessage: 'The change is running as a job. Jobs shows its progress.',
		description: 'Toast once a change for everyone was sent.'
	}),
	previewBody: defineMessage({
		id: 'administration.users.preview.body',
		defaultMessage:
			'{count} people match your filters. Proctor checks each of them before anything changes.',
		description: 'Description of a change for everyone matching.'
	}),
	previewCheckingBody: defineMessage({
		id: 'administration.users.preview.checkingbody',
		defaultMessage: 'Checking {count} people…',
		description: 'While the server checks everyone the filter matches.'
	}),
	previewWillChange: defineMessage({
		id: 'administration.users.preview.willchange',
		defaultMessage: '{count} people change',
		description: 'How many people the change applies to.'
	}),
	previewWillChangeDetail: defineMessage({
		id: 'administration.users.preview.willchangedetail',
		defaultMessage: 'Each on their own, as a job',
		description: 'Second line of the people who change.'
	}),
	previewNoOp: defineMessage({
		id: 'administration.users.preview.noop',
		defaultMessage: '{count} are already so',
		description: 'People the change would leave unchanged.'
	}),
	previewLeftAsIs: defineMessage({
		id: 'administration.users.preview.leftasis',
		defaultMessage: 'Left as they are',
		description: 'Second line of people who are left unchanged.'
	}),
	previewSkipSelf: defineMessage({
		id: 'administration.users.preview.skipself',
		defaultMessage: 'Your own account',
		description: 'A change for everyone never includes the viewer.'
	}),
	previewSkipConflict: defineMessage({
		id: 'administration.users.preview.skipconflict',
		defaultMessage: '{count} are already enrolled or can’t be',
		description: 'People an enrolment conflicts with.'
	}),
	previewSkipNotStudents: defineMessage({
		id: 'administration.users.preview.skipnotstudents',
		defaultMessage: '{count} aren’t students here',
		description: 'People who need a student affiliation first.'
	}),
	previewSkipNotStudentsDetail: defineMessage({
		id: 'administration.users.preview.skipnotstudentsdetail',
		defaultMessage: 'Only students can be enrolled',
		description: 'Why people without a student affiliation are left out.'
	}),
	previewSkipSystem: defineMessage({
		id: 'administration.users.preview.skipsystem',
		defaultMessage: '{count} system administrators',
		description: 'System administrators are never changed for everyone.'
	}),
	previewSkipSystemDetail: defineMessage({
		id: 'administration.users.preview.skipsystemdetail',
		defaultMessage: 'Never changed by a change for everyone',
		description: 'Why system administrators are left out.'
	}),
	previewSkipAmbiguous: defineMessage({
		id: 'administration.users.preview.skipambiguous',
		defaultMessage: '{count} couldn’t be decided',
		description: 'People the server couldn’t classify.'
	}),
	previewSkipAmbiguousDetail: defineMessage({
		id: 'administration.users.preview.skipambiguousdetail',
		defaultMessage: 'Left out; change them one by one',
		description: 'What to do about undecided people.'
	}),
	previewShowWho: defineMessage({
		id: 'administration.users.preview.showwho',
		defaultMessage: 'Show who',
		description: 'Lists the people in one group of a check.'
	}),
	previewMoreWho: defineMessage({
		id: 'administration.users.preview.morewho',
		defaultMessage: 'And more',
		description: 'After the first names of a group.'
	}),
	previewHolds: defineMessage({
		id: 'administration.users.preview.holds',
		defaultMessage:
			'This check holds for 15 minutes. The change runs as a job; Jobs shows its progress.',
		description: 'Footnote of a ready check.'
	}),
	previewCheckAgain: defineMessage({
		id: 'administration.users.preview.checkagain',
		defaultMessage: 'Check again',
		description: 'Runs the check again with the same filters.'
	}),
	previewExpiredTitle: defineMessage({
		id: 'administration.users.preview.expiredtitle',
		defaultMessage: 'This check has expired',
		description: 'Title once a check is older than 15 minutes.'
	}),
	previewExpiredBody: defineMessage({
		id: 'administration.users.preview.expiredbody',
		defaultMessage:
			'Proctor checks who would change and holds the result for 15 minutes, so that what you approve is what happens. Nothing has changed.',
		description: 'Why a check expires.'
	}),
	previewExpiredNote: defineMessage({
		id: 'administration.users.preview.expirednote',
		defaultMessage: 'Checking again uses the same filters. The numbers may differ.',
		description: 'Footnote of an expired check.'
	}),
	previewLostTitle: defineMessage({
		id: 'administration.users.preview.losttitle',
		defaultMessage: 'Your access changed since this check',
		description: 'Title once the viewer’s access no longer covers the filter.'
	}),
	previewLostBody: defineMessage({
		id: 'administration.users.preview.lostbody',
		defaultMessage:
			'These filters now reach people you can no longer change, so this check can’t be used. Nothing has changed.',
		description: 'Why a check can no longer be used.'
	}),
	previewLostNote: defineMessage({
		id: 'administration.users.preview.lostnote',
		defaultMessage: 'Checking again shows only the people your access covers now.',
		description: 'Footnote of a check whose access changed.'
	}),
	previewChange: defineMessage({
		id: 'administration.users.preview.change',
		defaultMessage: 'Change',
		description: 'Label of what a check would do.'
	}),
	previewFilters: defineMessage({
		id: 'administration.users.preview.filters',
		defaultMessage: 'Filters',
		description: 'Label of the filters a check used.'
	}),
	previewChecked: defineMessage({
		id: 'administration.users.preview.checked',
		defaultMessage: 'Checked',
		description: 'Label of when a check was made.'
	}),
	previewCheckedValue: defineMessage({
		id: 'administration.users.preview.checkedvalue',
		defaultMessage: '{when} · {count} people',
		description: 'When a check was made and how many it matched.'
	}),
	usersSelectAllMatching: defineMessage({
		id: 'administration.users.preview.selectallmatching',
		defaultMessage: 'Select all {count} matching these filters',
		description: 'Link in the selection bar once a whole page is chosen.'
	}),
	usersAllMatching: defineMessage({
		id: 'administration.users.preview.allmatching',
		defaultMessage: 'All {count} matching',
		description: 'The selection bar once everyone matching is chosen.'
	}),
	bulkSignOutConfirm: defineMessage({
		id: 'administration.users.everyone.signoutconfirm',
		defaultMessage: 'Sign {count} people out',
		description: 'Confirms signing everyone matching out everywhere.'
	}),
	bulkSignOutConfirmOne: defineMessage({
		id: 'administration.users.everyone.signoutconfirmone',
		defaultMessage: 'Sign {count} person out',
		description: 'Confirms signing one person out everywhere.'
	}),
	bulkEnrolEveryoneTitle: defineMessage({
		id: 'administration.users.everyone.enroleveryonetitle',
		defaultMessage: 'Enrol everyone matching in a class',
		description: 'Title of choosing the class for everyone the filters match.'
	}),
	bulkGrantEveryoneTitle: defineMessage({
		id: 'administration.users.everyone.granteveryonetitle',
		defaultMessage: 'Grant a role to everyone matching',
		description: 'Title of choosing the role for everyone the filters match.'
	}),
	bulkCheckWho: defineMessage({
		id: 'administration.users.everyone.checkwho',
		defaultMessage: 'Check who changes',
		description: 'Asks the server to check everyone matching before anything changes.'
	}),
	bulkEnrolEveryoneIn: defineMessage({
		id: 'administration.users.everyone.enroleveryonein',
		defaultMessage: 'Enrol everyone matching in {where}?',
		description: 'Title of the check for enrolling everyone matching in a class.'
	}),
	bulkEnrolIn: defineMessage({
		id: 'administration.users.everyone.enrolin',
		defaultMessage: 'Enrol in {where}',
		description: 'The change a check is for: an enrolment in a class.'
	}),
	bulkGrantEveryone: defineMessage({
		id: 'administration.users.everyone.granteveryone',
		defaultMessage: 'Grant {where} to everyone matching?',
		description: 'Title of the check for granting a role to everyone matching.'
	}),
	bulkGrantRole: defineMessage({
		id: 'administration.users.everyone.grantrole',
		defaultMessage: 'Grant {where}',
		description: 'The change a check is for: a role.'
	}),
	bulkSignOutEveryone: defineMessage({
		id: 'administration.users.everyone.signouteveryone',
		defaultMessage: 'Sign everyone matching out everywhere?',
		description: 'Title of the check for signing everyone matching out.'
	}),
	bulkDisableEveryone: defineMessage({
		id: 'administration.users.everyone.disableeveryone',
		defaultMessage: 'Disable everyone matching?',
		description: 'Title of the check for disabling everyone matching.'
	}),
	bulkEnableEveryone: defineMessage({
		id: 'administration.users.everyone.enableeveryone',
		defaultMessage: 'Enable everyone matching?',
		description: 'Title of the check for enabling everyone matching.'
	}),
	usersEveryone: defineMessage({
		id: 'administration.users.everyone.nofilter',
		defaultMessage: 'Everyone',
		description: 'The filters of a change for everyone when none is set.'
	}),
	viewsEveryone: defineMessage({
		id: 'administration.users.views.everyone',
		defaultMessage: 'Everyone',
		description: 'The tab of Users without a saved view.'
	}),
	viewsLabel: defineMessage({
		id: 'administration.users.views.label',
		defaultMessage: 'Views of Users',
		description: 'Accessible name of the saved views tabs.'
	}),
	viewsSaveAs: defineMessage({
		id: 'administration.users.views.saveas',
		defaultMessage: 'Save as view',
		description: 'Keeps the current Users filters as a tab.'
	}),
	viewsRemove: defineMessage({
		id: 'administration.users.views.remove',
		defaultMessage: 'Remove view',
		description: 'Removes the saved view shown.'
	}),
	viewsSaveTitle: defineMessage({
		id: 'administration.users.views.savetitle',
		defaultMessage: 'Save these filters as a view',
		description: 'Title of naming a saved view.'
	}),
	viewsSaveBody: defineMessage({
		id: 'administration.users.views.savebody',
		defaultMessage: 'A tab under Users shows them again on any computer: {filters}.',
		description: 'Description of naming a saved view, with the filters in words.'
	}),
	viewsName: defineMessage({
		id: 'administration.users.views.name',
		defaultMessage: 'Name',
		description: 'Label of a saved view’s name.'
	}),
	viewsSave: defineMessage({
		id: 'administration.users.views.save',
		defaultMessage: 'Save view',
		description: 'Saves the named view.'
	}),
	viewsNotSaved: defineMessage({
		id: 'administration.users.views.notsaved',
		defaultMessage: 'The view couldn’t be saved. Try again in a moment.',
		description: 'A saved view that couldn’t be kept in the settings.'
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
		defaultMessage: 'Enrol {count} person',
		description: 'Confirms enrolling the chosen people. One person.'
	}),
	bulkEnrolConfirm: defineMessage({
		id: 'administration.bulk.enrol.confirm',
		defaultMessage: 'Enrol {count} people',
		description: 'Confirms enrolling the chosen people. Two or more.'
	}),
	bulkGrantTitleOne: defineMessage({
		id: 'administration.bulk.grant.title.one',
		defaultMessage: 'Grant {count} person a role',
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
		defaultMessage: 'Grant to {count} person',
		description: 'Confirms granting the role. One person.'
	}),
	bulkGrantConfirm: defineMessage({
		id: 'administration.bulk.grant.confirm',
		defaultMessage: 'Grant to {count} people',
		description: 'Confirms granting the role. Two or more.'
	}),
	bulkSignOutTitleOne: defineMessage({
		id: 'administration.bulk.sign.out.title.one',
		defaultMessage: 'Sign {count} person out everywhere?',
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
		defaultMessage: 'Disable {count} account?',
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
		defaultMessage: 'Disable {count} account',
		description: 'Confirms disabling the chosen accounts. One person.'
	}),
	bulkDisableConfirm: defineMessage({
		id: 'administration.bulk.disable.confirm',
		defaultMessage: 'Disable {count} accounts',
		description: 'Confirms disabling the chosen accounts. Two or more.'
	}),
	bulkEnableTitleOne: defineMessage({
		id: 'administration.bulk.enable.title.one',
		defaultMessage: 'Enable {count} account?',
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
		defaultMessage: 'Enable {count} account',
		description: 'Confirms enabling the chosen accounts. One person.'
	}),
	bulkEnableConfirm: defineMessage({
		id: 'administration.bulk.enable.confirm',
		defaultMessage: 'Enable {count} accounts',
		description: 'Confirms enabling the chosen accounts. Two or more.'
	}),
	bulkResultAllOne: defineMessage({
		id: 'administration.bulk.result.all.one',
		defaultMessage: 'Done for {count} person',
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
	bulkResultEnrolStudent: defineMessage({
		id: 'administration.bulk.result.enrol.student',
		defaultMessage: 'Add student and enrol',
		description: 'Gives a refused person a student affiliation from today, then enrols them.'
	}),
	bulkResultEnrolStudentFor: defineMessage({
		id: 'administration.bulk.result.enrol.student.for',
		defaultMessage: 'Add {name} as a student and enrol them',
		description: 'Accessible name of the fix on one person in the bulk result.'
	}),
	bulkResultClose: defineMessage({
		id: 'administration.bulk.result.close',
		defaultMessage: 'Done',
		description: 'Closes the result of a change for several people.'
	}),
	bulkPeopleCountOne: defineMessage({
		id: 'administration.bulk.people.count.one',
		defaultMessage: '{count} person',
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
