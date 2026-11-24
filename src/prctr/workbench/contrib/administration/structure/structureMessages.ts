/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { defineMessage } from '../../../../base/common/localization.js';

/** Text of the Structure, Class and Academic periods pages. */
export const structureMessages = Object.freeze({
	structurePeriods: defineMessage({
		id: 'administration.structure.periods',
		defaultMessage: 'Academic periods',
		description: 'Structure page action that opens Academic periods.'
	}),
	structureUnits: defineMessage({
		id: 'administration.structure.units',
		defaultMessage: 'Units',
		description: 'Heading of the tree of academic units.'
	}),
	structureNewUnit: defineMessage({
		id: 'administration.structure.unit.new',
		defaultMessage: 'New unit',
		description: 'Creates a top-level academic unit.'
	}),
	structureExpand: defineMessage({
		id: 'administration.structure.expand',
		defaultMessage: 'Show units in {name}',
		description: 'Accessible name of the button that shows a unit’s sub-units.'
	}),
	structureCollapse: defineMessage({
		id: 'administration.structure.collapse',
		defaultMessage: 'Hide units in {name}',
		description: 'Accessible name of the button that hides a unit’s sub-units.'
	}),
	structureNoUnits: defineMessage({
		id: 'administration.structure.units.none',
		defaultMessage: 'No units yet. Create the first one.',
		description: 'Shown when there are no academic units.'
	}),
	structureChooseUnit: defineMessage({
		id: 'administration.structure.unit.choose',
		defaultMessage: 'Choose a unit to see its programmes and classes.',
		description: 'Shown before a unit is chosen.'
	}),
	structurePartOf: defineMessage({
		id: 'administration.structure.unit.part.of',
		defaultMessage: 'Part of',
		description: 'Unit detail: its parent unit.'
	}),
	structureTopLevel: defineMessage({
		id: 'administration.structure.unit.top',
		defaultMessage: 'The institution',
		description: 'A unit with no parent.'
	}),
	structureDescriptionLabel: defineMessage({
		id: 'administration.structure.unit.description',
		defaultMessage: 'Description',
		description: 'Unit detail.'
	}),
	structureEdit: defineMessage({
		id: 'administration.structure.unit.edit',
		defaultMessage: 'Edit',
		description: 'Edits the chosen unit.'
	}),
	structureAddSubUnit: defineMessage({
		id: 'administration.structure.unit.add.sub',
		defaultMessage: 'Add sub-unit',
		description: 'Creates a unit under the chosen one.'
	}),
	structureArchiveUnit: defineMessage({
		id: 'administration.structure.unit.archive',
		defaultMessage: 'Archive unit',
		description: 'Archives the chosen unit after confirming.'
	}),
	structureProgrammes: defineMessage({
		id: 'administration.structure.programmes',
		defaultMessage: 'Programmes',
		description: 'Section with a unit’s programmes.'
	}),
	structureProgrammesEmpty: defineMessage({
		id: 'administration.structure.programmes.empty',
		defaultMessage: 'No programmes in this unit.',
		description: 'A unit with no programmes.'
	}),
	structureNewProgramme: defineMessage({
		id: 'administration.structure.programme.new',
		defaultMessage: 'New programme',
		description: 'Creates a programme in the chosen unit.'
	}),
	structureLevelsOf: defineMessage({
		id: 'administration.structure.levels.of',
		defaultMessage: 'Levels: {levels}',
		description: 'Detail of a programme listing its levels.'
	}),
	structureNoLevels: defineMessage({
		id: 'administration.structure.levels.none',
		defaultMessage: 'No levels yet',
		description: 'A programme with no levels.'
	}),
	structureLevels: defineMessage({
		id: 'administration.structure.levels',
		defaultMessage: 'Levels',
		description: 'Opens a programme’s levels.'
	}),
	structureLevelsTitle: defineMessage({
		id: 'administration.structure.levels.title',
		defaultMessage: 'Levels in {programme}',
		description: 'Section with one programme’s levels.'
	}),
	structureLevelsEmpty: defineMessage({
		id: 'administration.structure.levels.empty',
		defaultMessage: 'No levels yet. Add the first year or stage.',
		description: 'A programme with no levels.'
	}),
	structureNewLevel: defineMessage({
		id: 'administration.structure.level.new',
		defaultMessage: 'Add level',
		description: 'Creates a level in the chosen programme.'
	}),
	structureClasses: defineMessage({
		id: 'administration.structure.classes',
		defaultMessage: 'Classes',
		description: 'Section with a unit’s classes.'
	}),
	structureClassesEmpty: defineMessage({
		id: 'administration.structure.classes.empty',
		defaultMessage: 'No classes in this unit.',
		description: 'A unit with no classes.'
	}),
	structureNewClass: defineMessage({
		id: 'administration.structure.class.new',
		defaultMessage: 'New class',
		description: 'Creates a class in the chosen unit.'
	}),
	structureClassColumn: defineMessage({
		id: 'administration.structure.column.class',
		defaultMessage: 'Class',
		description: 'Classes table column.'
	}),
	structureLevelColumn: defineMessage({
		id: 'administration.structure.column.level',
		defaultMessage: 'Programme level',
		description: 'Classes table column.'
	}),
	structureStudentsColumn: defineMessage({
		id: 'administration.structure.column.students',
		defaultMessage: 'Students',
		description: "Column of a unit's classes: how many students each has."
	}),
	structurePeriodColumn: defineMessage({
		id: 'administration.structure.column.period',
		defaultMessage: 'Period',
		description: 'Classes table column.'
	}),
	structureRename: defineMessage({
		id: 'administration.structure.rename',
		defaultMessage: 'Rename',
		description: 'Renames a programme or level.'
	}),
	structureArchive: defineMessage({
		id: 'administration.structure.archive',
		defaultMessage: 'Archive',
		description: 'Archives a programme, level or class after confirming.'
	}),
	structureArchiveTitle: defineMessage({
		id: 'administration.structure.archive.title',
		defaultMessage: 'Archive {name}?',
		description: 'Confirmation title before archiving.'
	}),
	structureArchiveBody: defineMessage({
		id: 'administration.structure.archive.body',
		defaultMessage:
			'It’s hidden from new work and kept in history. Anything still inside it has to be archived first.',
		description: 'Confirmation body before archiving.'
	}),
	structureArchiveConfirm: defineMessage({
		id: 'administration.structure.archive.confirm',
		defaultMessage: 'Archive',
		description: 'Confirms archiving.'
	}),
	structureArchived: defineMessage({
		id: 'administration.structure.archived',
		defaultMessage: '{name} is archived',
		description: 'Toast after archiving.'
	}),
	structureSaved: defineMessage({
		id: 'administration.structure.saved',
		defaultMessage: '{name} is saved',
		description: 'Toast after a create or edit.'
	}),
	structureName: defineMessage({
		id: 'administration.structure.field.name',
		defaultMessage: 'Short name',
		description: 'Field: an identifier-like name such as CS.'
	}),
	structureDisplayName: defineMessage({
		id: 'administration.structure.field.display.name',
		defaultMessage: 'Display name',
		description: 'Field: the name people see.'
	}),
	structureDescriptionField: defineMessage({
		id: 'administration.structure.field.description',
		defaultMessage: 'Description',
		description: 'Field: an optional description.'
	}),
	structureLevel: defineMessage({
		id: 'administration.structure.field.level',
		defaultMessage: 'Programme level',
		description: 'Field: which level a class belongs to.'
	}),
	structurePeriod: defineMessage({
		id: 'administration.structure.field.period',
		defaultMessage: 'Academic period',
		description: 'Field: which period a class runs in.'
	}),
	structureNewUnitTitle: defineMessage({
		id: 'administration.structure.unit.new.title',
		defaultMessage: 'New unit',
		description: 'Title of the dialog that creates a top-level unit.'
	}),
	structureSubUnitTitle: defineMessage({
		id: 'administration.structure.unit.sub.title',
		defaultMessage: 'New unit in {name}',
		description: 'Title of the dialog that creates a sub-unit.'
	}),
	structureEditUnitTitle: defineMessage({
		id: 'administration.structure.unit.edit.title',
		defaultMessage: 'Edit {name}',
		description: 'Title of the dialog that edits a unit.'
	}),
	structureNewProgrammeTitle: defineMessage({
		id: 'administration.structure.programme.new.title',
		defaultMessage: 'New programme in {name}',
		description: 'Title of the dialog that creates a programme.'
	}),
	structureRenameTitle: defineMessage({
		id: 'administration.structure.rename.title',
		defaultMessage: 'Rename {name}',
		description: 'Title of the dialog that renames a programme or level.'
	}),
	structureNewLevelTitle: defineMessage({
		id: 'administration.structure.level.new.title',
		defaultMessage: 'New level in {name}',
		description: 'Title of the dialog that creates a level.'
	}),
	structureNewClassTitle: defineMessage({
		id: 'administration.structure.class.new.title',
		defaultMessage: 'New class in {name}',
		description: 'Title of the dialog that creates a class.'
	}),
	structureCreate: defineMessage({
		id: 'administration.structure.create',
		defaultMessage: 'Create',
		description: 'Confirms creating a unit, programme, level or class.'
	}),
	structureSave: defineMessage({
		id: 'administration.structure.save',
		defaultMessage: 'Save',
		description: 'Confirms an edit.'
	}),
	structureNeedsLevel: defineMessage({
		id: 'administration.structure.needs.level',
		defaultMessage: 'Add a programme and a level first.',
		description: 'Shown when a class cannot be created yet.'
	}),
	classTrail: defineMessage({
		id: 'administration.structure.class.trail',
		defaultMessage: 'Structure',
		description: 'The trail step back to Structure.'
	}),
	classStudents: defineMessage({
		id: 'administration.structure.class.students',
		defaultMessage: 'Students',
		description: 'Section with a class’s members.'
	}),
	classStudentsEmpty: defineMessage({
		id: 'administration.structure.class.students.empty',
		defaultMessage: 'No one is enrolled yet.',
		description: 'A class with no members.'
	}),
	classEnrollment: defineMessage({
		id: 'administration.structure.class.enrollment',
		defaultMessage: 'Enrolment',
		description: 'Filter: current enrolments or all of them.'
	}),
	classCurrent: defineMessage({
		id: 'administration.structure.class.current',
		defaultMessage: 'Current',
		description: 'Filter choice: current enrolments.'
	}),
	classHistory: defineMessage({
		id: 'administration.structure.class.history',
		defaultMessage: 'Including ended',
		description: 'Filter choice: every enrolment.'
	}),
	classStudentColumn: defineMessage({
		id: 'administration.structure.class.column.student',
		defaultMessage: 'Student',
		description: 'Class members column.'
	}),
	classViews: defineMessage({
		id: 'administration.class.page.views',
		defaultMessage: 'Views of the class',
		description: 'Accessible name of the class tabs.'
	}),
	classTabStudents: defineMessage({
		id: 'administration.class.page.tab.students',
		defaultMessage: 'Students',
		description: 'Class tab: the students enrolled.'
	}),
	classTabTeachers: defineMessage({
		id: 'administration.class.page.tab.teachers',
		defaultMessage: 'Teachers',
		description: 'Class tab: people with a role in the class.'
	}),
	classTabInvitations: defineMessage({
		id: 'administration.class.page.tab.invitations',
		defaultMessage: 'Invitations',
		description: 'Class tab: pending invitations to the class.'
	}),
	classTeachers: defineMessage({
		id: 'administration.class.page.teachers',
		defaultMessage: 'Teachers',
		description: 'Accessible name of the class teachers table.'
	}),
	classTeacherColumn: defineMessage({
		id: 'administration.class.page.column.teacher',
		defaultMessage: 'Teacher',
		description: 'Column of a class teacher.'
	}),
	classRoleColumn: defineMessage({
		id: 'administration.class.page.column.role',
		defaultMessage: 'Role',
		description: 'Column of a teacher’s role in the class.'
	}),
	classSinceColumn: defineMessage({
		id: 'administration.class.page.column.since',
		defaultMessage: 'Since',
		description: 'Column of when a role in the class started.'
	}),
	classTeachersEmpty: defineMessage({
		id: 'administration.class.page.teachers.empty',
		defaultMessage: 'No one has a role in this class yet.',
		description: 'Empty teachers tab.'
	}),
	classInvitations: defineMessage({
		id: 'administration.class.page.invitations',
		defaultMessage: 'Invitations to this class',
		description: 'Accessible name of the class invitations table.'
	}),
	classInviteeColumn: defineMessage({
		id: 'administration.class.page.column.invitee',
		defaultMessage: 'Invitee',
		description: 'Column of an invited address.'
	}),
	classExpiresColumn: defineMessage({
		id: 'administration.class.page.column.expires',
		defaultMessage: 'Expires',
		description: 'Column of when an invitation expires.'
	}),
	classInvitationsEmpty: defineMessage({
		id: 'administration.class.page.invitations.empty',
		defaultMessage: 'No invitations to this class are waiting.',
		description: 'Empty invitations tab.'
	}),
	classEnrolledColumn: defineMessage({
		id: 'administration.structure.class.column.enrolled',
		defaultMessage: 'Enrolled',
		description: 'Class members column.'
	}),
	classStatusColumn: defineMessage({
		id: 'administration.structure.class.column.status',
		defaultMessage: 'Status',
		description: 'Class members column.'
	}),
	classEnrolled: defineMessage({
		id: 'administration.structure.class.enrolled',
		defaultMessage: 'Enrolled',
		description: 'A current enrolment.'
	}),
	classEnded: defineMessage({
		id: 'administration.structure.class.ended',
		defaultMessage: 'Ended {date}',
		description: 'An ended enrolment.'
	}),
	classEnroll: defineMessage({
		id: 'administration.structure.class.enroll',
		defaultMessage: 'Enrol existing…',
		description: 'Opens the dialog that enrols an existing account.'
	}),
	classEnrollTitle: defineMessage({
		id: 'administration.structure.class.enroll.title',
		defaultMessage: 'Enrol someone in {name}',
		description: 'Title of the enrol dialog.'
	}),
	classEnrollBody: defineMessage({
		id: 'administration.structure.class.enroll.body',
		defaultMessage:
			'They need a student affiliation. Anyone already in another class this period is moved here.',
		description: 'Body of the enrol dialog.'
	}),
	classPerson: defineMessage({
		id: 'administration.structure.class.person',
		defaultMessage: 'Username or email',
		description: 'Field: who to enrol.'
	}),
	classPersonNotFound: defineMessage({
		id: 'administration.structure.class.person.not.found',
		defaultMessage: 'No one with that username or email.',
		description: 'Error when the person is not found.'
	}),
	classEnrollConfirm: defineMessage({
		id: 'administration.structure.class.enroll.confirm',
		defaultMessage: 'Enrol',
		description: 'Confirms enrolling.'
	}),
	classEnrolledToast: defineMessage({
		id: 'administration.structure.class.enrolled.toast',
		defaultMessage: '{name} is enrolled',
		description: 'Toast after enrolling.'
	}),
	classInvite: defineMessage({
		id: 'administration.structure.class.invite',
		defaultMessage: 'Invite students',
		description: 'Opens the invitation dialog.'
	}),
	classEnd: defineMessage({
		id: 'administration.structure.class.end',
		defaultMessage: 'End enrolment',
		description: 'Ends an enrolment after confirming.'
	}),
	classEndTitle: defineMessage({
		id: 'administration.structure.class.end.title',
		defaultMessage: 'End {name}’s enrolment?',
		description: 'Confirmation title before ending an enrolment.'
	}),
	classEndBody: defineMessage({
		id: 'administration.structure.class.end.body',
		defaultMessage: 'They leave the class now. Their submissions and results are kept.',
		description: 'Confirmation body before ending an enrolment.'
	}),
	classEndConfirm: defineMessage({
		id: 'administration.structure.class.end.confirm',
		defaultMessage: 'End enrolment',
		description: 'Confirms ending an enrolment.'
	}),
	classEndedToast: defineMessage({
		id: 'administration.structure.class.ended.toast',
		defaultMessage: '{name} left the class',
		description: 'Toast after ending an enrolment.'
	}),
	classUnknownPerson: defineMessage({
		id: 'administration.structure.class.unknown.person',
		defaultMessage: 'Someone you can’t see',
		description: 'A member whose account cannot be read.'
	}),
	classEdit: defineMessage({
		id: 'administration.structure.class.edit',
		defaultMessage: 'Edit',
		description: 'Edits the class.'
	}),
	classEditTitle: defineMessage({
		id: 'administration.structure.class.edit.title',
		defaultMessage: 'Edit {name}',
		description: 'Title of the dialog that edits a class.'
	}),
	classMore: defineMessage({
		id: 'administration.structure.class.more',
		defaultMessage: 'More actions',
		description: 'Accessible name of the class’s menu button.'
	}),
	periodsFind: defineMessage({
		id: 'administration.structure.periods.find',
		defaultMessage: 'Find a period',
		description: 'Search field above the academic periods.'
	}),
	periodsNew: defineMessage({
		id: 'administration.structure.periods.new',
		defaultMessage: 'New period',
		description: 'Creates an academic period.'
	}),
	periodsTable: defineMessage({
		id: 'administration.structure.periods.table',
		defaultMessage: 'Academic periods',
		description: 'Accessible name of the periods table.'
	}),
	periodsName: defineMessage({
		id: 'administration.structure.periods.column.name',
		defaultMessage: 'Period',
		description: 'Periods column.'
	}),
	periodsOwner: defineMessage({
		id: 'administration.structure.periods.column.owner',
		defaultMessage: 'Belongs to',
		description: 'Periods column: the institution or a unit.'
	}),
	periodsDates: defineMessage({
		id: 'administration.structure.periods.column.dates',
		defaultMessage: 'Dates',
		description: 'Periods column.'
	}),
	periodsStatus: defineMessage({
		id: 'administration.structure.periods.column.status',
		defaultMessage: 'Status',
		description: 'Periods column.'
	}),
	periodsCurrent: defineMessage({
		id: 'administration.structure.periods.current',
		defaultMessage: 'Current',
		description: 'A period running now.'
	}),
	periodsUpcoming: defineMessage({
		id: 'administration.structure.periods.upcoming',
		defaultMessage: 'Upcoming',
		description: 'A period starting later.'
	}),
	periodsPast: defineMessage({
		id: 'administration.structure.periods.past',
		defaultMessage: 'Past',
		description: 'A period that has ended.'
	}),
	periodsArchivedState: defineMessage({
		id: 'administration.structure.periods.archived',
		defaultMessage: 'Archived',
		description: 'An archived period.'
	}),
	periodsDateRange: defineMessage({
		id: 'administration.structure.periods.range',
		defaultMessage: '{start} – {end}',
		description: 'A period’s dates.'
	}),
	periodsEmpty: defineMessage({
		id: 'administration.structure.periods.empty',
		defaultMessage: 'No academic periods yet',
		description: 'Title of the empty list of academic periods.'
	}),
	periodsEmptyText: defineMessage({
		id: 'administration.structure.periods.empty.text',
		defaultMessage: 'Create the first term or year, then give classes their period.',
		description: 'Explains the empty list of academic periods.'
	}),
	periodsNoMatch: defineMessage({
		id: 'administration.structure.periods.empty.filtered',
		defaultMessage: 'No periods match.',
		description: 'Shown when the search finds nothing.'
	}),
	periodsNewTitle: defineMessage({
		id: 'administration.structure.periods.new.title',
		defaultMessage: 'New academic period',
		description: 'Title of the dialog that creates a period.'
	}),
	periodsEditTitle: defineMessage({
		id: 'administration.structure.periods.edit.title',
		defaultMessage: 'Edit {name}',
		description: 'Title of the dialog that edits a period.'
	}),
	periodsOwnerField: defineMessage({
		id: 'administration.structure.periods.owner',
		defaultMessage: 'Belongs to',
		description: 'Field: the institution or a unit.'
	}),
	periodsInstitution: defineMessage({
		id: 'administration.structure.periods.institution',
		defaultMessage: 'The whole institution',
		description: 'Period owner choice.'
	}),
	periodsStart: defineMessage({
		id: 'administration.structure.periods.start',
		defaultMessage: 'Starts',
		description: 'Field: the first day.'
	}),
	periodsEnd: defineMessage({
		id: 'administration.structure.periods.end',
		defaultMessage: 'Ends',
		description: 'Field: the last day.'
	}),
	structureViews: defineMessage({
		id: 'administration.structure.views',
		defaultMessage: 'What to show for this unit',
		description: 'Accessible name of the tabs under a unit.'
	}),
	structureTabContents: defineMessage({
		id: 'administration.structure.tab.contents',
		defaultMessage: 'Programmes and classes',
		description: 'Tab of a unit’s programmes and classes.'
	}),
	structureTabMembers: defineMessage({
		id: 'administration.structure.tab.members',
		defaultMessage: 'Members',
		description: 'Tab of the people who belong to a unit.'
	}),
	unitMembers: defineMessage({
		id: 'administration.unit.members',
		defaultMessage: 'Members',
		description: 'Section and table of a unit’s members.'
	}),
	unitMembersDescription: defineMessage({
		id: 'administration.unit.members.description',
		defaultMessage:
			'Staff who belong to this unit. Belonging grants nothing on its own; roles do.',
		description: 'Explains unit membership.'
	}),
	unitMemberFormer: defineMessage({
		id: 'administration.unit.member.former',
		defaultMessage: 'A former user',
		description: 'Name shown for a unit member whose account was removed.'
	}),
	unitMemberColumn: defineMessage({
		id: 'administration.unit.member.column',
		defaultMessage: 'Member',
		description: 'Column naming a unit member.'
	}),
	unitRolesHere: defineMessage({
		id: 'administration.unit.roles.here',
		defaultMessage: 'Roles here',
		description: 'Column of the roles a member holds in this unit.'
	}),
	unitSince: defineMessage({
		id: 'administration.unit.since',
		defaultMessage: 'Since',
		description: 'Column of when someone joined a unit.'
	}),
	unitNoRoleHere: defineMessage({
		id: 'administration.unit.no.role.here',
		defaultMessage: 'No role here',
		description: 'A member who holds no role in the unit.'
	}),
	unitMembersEmpty: defineMessage({
		id: 'administration.unit.members.empty',
		defaultMessage: 'No one belongs to this unit yet.',
		description: 'A unit without members.'
	}),
	unitAddMember: defineMessage({
		id: 'administration.unit.add.member',
		defaultMessage: 'Add member',
		description: 'Adds a person to a unit.'
	}),
	unitAddMemberTitle: defineMessage({
		id: 'administration.unit.add.member.title',
		defaultMessage: 'Add a member to {unit}',
		description: 'Title of the dialog that adds a unit member.'
	}),
	unitAddMemberBody: defineMessage({
		id: 'administration.unit.add.member.body',
		defaultMessage:
			'They belong to the unit from today. To let them do something here, grant them a role too.',
		description: 'Explains adding a unit member.'
	}),
	unitAddMemberField: defineMessage({
		id: 'administration.unit.add.member.field',
		defaultMessage: 'Username or email',
		description: 'Label of the person to add.'
	}),
	unitAddMemberNotFound: defineMessage({
		id: 'administration.unit.add.member.not.found',
		defaultMessage: 'No account has this username or email.',
		description: 'Error when the person isn’t found.'
	}),
	unitMemberAdded: defineMessage({
		id: 'administration.unit.member.added',
		defaultMessage: '{name} is now a member',
		description: 'Toast after adding a unit member.'
	}),
	unitEndMember: defineMessage({
		id: 'administration.unit.end.member',
		defaultMessage: 'End membership',
		description: 'Ends someone’s membership of a unit.'
	}),
	unitEndMemberTitle: defineMessage({
		id: 'administration.unit.end.member.title',
		defaultMessage: 'End {name}’s membership?',
		description: 'Confirms ending a unit membership.'
	}),
	unitEndMemberBody: defineMessage({
		id: 'administration.unit.end.member.body',
		defaultMessage: 'They stop belonging to this unit today. Their roles elsewhere stay.',
		description: 'Explains ending a unit membership.'
	}),
	unitEndMemberConfirm: defineMessage({
		id: 'administration.unit.end.member.confirm',
		defaultMessage: 'End membership',
		description: 'Confirms ending a unit membership.'
	}),
	unitMemberEnded: defineMessage({
		id: 'administration.unit.member.ended',
		defaultMessage: '{name} no longer belongs here',
		description: 'Toast after ending a unit membership.'
	})
});
