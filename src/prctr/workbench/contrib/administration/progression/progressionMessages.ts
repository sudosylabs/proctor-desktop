/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { defineMessage } from '../../../../base/common/localization.js';

/** Text of the Progression pages: moving a class's students on to their next class. */
export const progressionMessages = Object.freeze({
	progressionTitle: defineMessage({
		id: 'administration.page.progression.title',
		defaultMessage: 'Progression',
		description: 'Heading of the Progression page.'
	}),
	progressionDescription: defineMessage({
		id: 'administration.page.progression.description',
		defaultMessage:
			'Move a class’s students on to their next class, such as Year 1 to Year 2. Every move is checked and reviewed before anyone changes class.',
		description: 'One-line description under the Progression heading.'
	}),
	progressionNew: defineMessage({
		id: 'administration.progression.new',
		defaultMessage: 'New progression',
		description: 'Starts choosing classes for a new progression.'
	}),
	progressionTable: defineMessage({
		id: 'administration.progression.table',
		defaultMessage: 'Progressions',
		description: 'Accessible name of the progressions table.'
	}),
	progressionMove: defineMessage({
		id: 'administration.progression.move',
		defaultMessage: 'Move',
		description: 'Column naming the classes a progression moves students between.'
	}),
	progressionMovesOn: defineMessage({
		id: 'administration.progression.moves.on',
		defaultMessage: 'Moves on',
		description: 'Column of the day students change class.'
	}),
	progressionStudents: defineMessage({
		id: 'administration.progression.students',
		defaultMessage: 'Students',
		description: 'Column of how many students a progression covers.'
	}),
	progressionStatus: defineMessage({
		id: 'administration.progression.status',
		defaultMessage: 'Status',
		description: 'Column of a progression’s state.'
	}),
	progressionPair: defineMessage({
		id: 'administration.progression.pair',
		defaultMessage: '{source} → {destination}',
		description: 'A progression’s classes, as in "Programming 1 → Programming 2".'
	}),
	progressionUnknownClass: defineMessage({
		id: 'administration.progression.unknown.class',
		defaultMessage: 'A class',
		description: 'Stands in for a class whose name isn’t known.'
	}),
	progressionChecked: defineMessage({
		id: 'administration.progression.checked',
		defaultMessage: 'Checked {when}',
		description: 'Under a progression: when the server checked who moves.'
	}),
	progressionReview: defineMessage({
		id: 'administration.progression.review.button',
		defaultMessage: 'Review',
		description: 'A progression row’s button that opens its review.'
	}),
	progressionEmpty: defineMessage({
		id: 'administration.progression.empty',
		defaultMessage: 'No progressions yet',
		description: 'Title of the empty Progression list.'
	}),
	progressionEmptyText: defineMessage({
		id: 'administration.progression.empty.text',
		defaultMessage:
			'Move a class’s students on to their next class. Nothing changes until you review who moves.',
		description: 'Explains the empty Progression list.'
	}),
	stateChecking: defineMessage({
		id: 'administration.progression.state.checking',
		defaultMessage: 'Checking',
		description: 'A progression the server is still checking.'
	}),
	stateReady: defineMessage({
		id: 'administration.progression.state.ready',
		defaultMessage: 'Ready to review',
		description: 'A checked progression waiting for review.'
	}),
	stateMoving: defineMessage({
		id: 'administration.progression.state.moving',
		defaultMessage: 'Moving',
		description: 'A progression that is moving students.'
	}),
	stateMoved: defineMessage({
		id: 'administration.progression.state.moved',
		defaultMessage: 'Moved',
		description: 'A progression that has finished.'
	}),
	stateMovedWithProblems: defineMessage({
		id: 'administration.progression.state.moved.problems',
		defaultMessage: 'Moved, some didn’t',
		description: 'A finished progression in which some students didn’t move.'
	}),
	stateCancelled: defineMessage({
		id: 'administration.progression.state.cancelled',
		defaultMessage: 'Cancelled',
		description: 'A progression that was cancelled.'
	}),
	stateFailed: defineMessage({
		id: 'administration.progression.state.failed',
		defaultMessage: 'Failed',
		description: 'A progression that couldn’t finish.'
	}),
	newTitle: defineMessage({
		id: 'administration.progression.dialog.title',
		defaultMessage: 'New progression',
		description: 'Title of the dialog that starts a progression.'
	}),
	newBody: defineMessage({
		id: 'administration.progression.dialog.body',
		defaultMessage:
			'Choose the class students are in now and the class they move on to. Nothing changes until you’ve reviewed who moves and confirmed.',
		description: 'Explains the new-progression dialog.'
	}),
	newUnit: defineMessage({
		id: 'administration.progression.dialog.unit',
		defaultMessage: 'Unit',
		description: 'Label of the unit whose classes the dialog offers.'
	}),
	newFrom: defineMessage({
		id: 'administration.progression.dialog.from',
		defaultMessage: 'From',
		description: 'Label of the class students are in now.'
	}),
	newTo: defineMessage({
		id: 'administration.progression.dialog.to',
		defaultMessage: 'To',
		description: 'Label of the class students move on to.'
	}),
	newToHint: defineMessage({
		id: 'administration.progression.dialog.to.hint',
		defaultMessage:
			'Their enrolment in the first class ends the day before; their work and results there are kept.',
		description: 'Explains what happens to the old enrolment.'
	}),
	newWhen: defineMessage({
		id: 'administration.progression.dialog.when',
		defaultMessage: 'Moves on',
		description: 'Label of the day students change class.'
	}),
	newWhenHint: defineMessage({
		id: 'administration.progression.dialog.when.hint',
		defaultMessage: 'Usually the first day of the new period.',
		description: 'Hint under the move date.'
	}),
	newSame: defineMessage({
		id: 'administration.progression.dialog.same',
		defaultMessage: 'Choose a different class to move on to.',
		description: 'Error when From and To are the same class.'
	}),
	newCheck: defineMessage({
		id: 'administration.progression.dialog.check',
		defaultMessage: 'Check who moves',
		description: 'Starts the server’s check of a progression.'
	}),
	newChecking: defineMessage({
		id: 'administration.progression.dialog.checking',
		defaultMessage: 'Checking who moves. The review opens when it’s ready.',
		description: 'Toast after starting a progression check.'
	}),
	reviewTitle: defineMessage({
		id: 'administration.progression.review.title',
		defaultMessage: 'Progression',
		description: 'Heading of a progression’s review before it loads.'
	}),
	reviewTrail: defineMessage({
		id: 'administration.progression.review.trail',
		defaultMessage: 'Progression',
		description: 'The trail link from a review back to the Progression list.'
	}),
	reviewDescription: defineMessage({
		id: 'administration.progression.review.description',
		defaultMessage: 'Moves on {date} · Checked {when}',
		description: 'Under a review’s heading.'
	}),
	reviewSummary: defineMessage({
		id: 'administration.progression.review.summary',
		defaultMessage: 'Who moves',
		description: 'Section of a progression’s counts.'
	}),
	reviewMoving: defineMessage({
		id: 'administration.progression.review.moving',
		defaultMessage: 'Moving',
		description: 'How many students change class.'
	}),
	reviewStaying: defineMessage({
		id: 'administration.progression.review.staying',
		defaultMessage: 'Staying',
		description: 'How many students stay where they are.'
	}),
	reviewMoved: defineMessage({
		id: 'administration.progression.review.moved',
		defaultMessage: 'Moved',
		description: 'How many students changed class.'
	}),
	reviewNotMoved: defineMessage({
		id: 'administration.progression.review.not.moved',
		defaultMessage: 'Didn’t move',
		description: 'How many students the progression couldn’t move.'
	}),
	reviewRows: defineMessage({
		id: 'administration.progression.review.rows',
		defaultMessage: 'Students who won’t move',
		description: 'Section of students left where they are.'
	}),
	reviewRowsDescription: defineMessage({
		id: 'administration.progression.review.rows.description',
		defaultMessage: 'Everyone else moves as listed in the report.',
		description: 'Explains the students list.'
	}),
	reviewRowsNone: defineMessage({
		id: 'administration.progression.review.rows.none',
		defaultMessage: 'Everyone moves.',
		description: 'No student is left out.'
	}),
	reviewStayBanner: defineMessage({
		id: 'administration.progression.review.stay.banner',
		defaultMessage:
			'{count} students won’t move. They stay in their class with their enrolment as it is, and you can move them on their own later.',
		description: 'Banner when some students won’t move.'
	}),
	reviewChecking: defineMessage({
		id: 'administration.progression.review.checking',
		defaultMessage: 'Checking who moves. This page updates when it’s ready.',
		description: 'Banner while the server checks.'
	}),
	reviewMovingBanner: defineMessage({
		id: 'administration.progression.review.moving.banner',
		defaultMessage: 'Moving students. This page updates as it goes.',
		description: 'Banner while students move.'
	}),
	reviewCommit: defineMessage({
		id: 'administration.progression.review.commit',
		defaultMessage: 'Move {count} students',
		description: 'Confirms a reviewed progression.'
	}),
	reviewSchedule: defineMessage({
		id: 'administration.progression.review.schedule',
		defaultMessage: 'Schedule move for {date}',
		description: 'Confirms a reviewed progression that takes effect on a later date.'
	}),
	reviewCommitTitle: defineMessage({
		id: 'administration.progression.review.commit.title',
		defaultMessage: 'Move these students?',
		description: 'Title of the confirmation before moving students.'
	}),
	reviewCommitBody: defineMessage({
		id: 'administration.progression.review.commit.body',
		defaultMessage:
			'Each student joins the new class on the move date and leaves the old one the day before. Their work and results are kept.',
		description: 'Explains what moving does.'
	}),
	reviewStarted: defineMessage({
		id: 'administration.progression.review.started',
		defaultMessage: 'Moving students',
		description: 'Toast after confirming a progression.'
	}),
	reviewCancel: defineMessage({
		id: 'administration.progression.review.cancel',
		defaultMessage: 'Cancel progression',
		description: 'Ends a progression without moving anyone.'
	}),
	reviewCancelTitle: defineMessage({
		id: 'administration.progression.review.cancel.title',
		defaultMessage: 'Cancel this progression?',
		description: 'Title of the confirmation before cancelling a progression.'
	}),
	reviewCancelBody: defineMessage({
		id: 'administration.progression.review.cancel.body',
		defaultMessage: 'Nobody moves. You can start a new one later.',
		description: 'Explains cancelling a progression.'
	}),
	reviewCancelled: defineMessage({
		id: 'administration.progression.review.cancelled',
		defaultMessage: 'Progression cancelled',
		description: 'Toast after cancelling a progression.'
	}),
	reviewSkipped: defineMessage({
		id: 'administration.progression.review.skipped',
		defaultMessage: 'Skipped',
		description: 'A student the progression leaves out without a problem.'
	}),
	reviewLeftOut: defineMessage({
		id: 'administration.progression.review.left.out',
		defaultMessage: 'Left out',
		description: 'A student the progression can’t move.'
	}),
	reviewStudentRow: defineMessage({
		id: 'administration.progression.review.student',
		defaultMessage: 'Row {row} · {reference}',
		description: 'A student in the review, by row and reference.'
	})
});
