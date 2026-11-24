/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { defineMessage } from '../../../../base/common/localization.js';

/** Text of the Imports page and one import’s page. */
export const importsMessages = Object.freeze({
	importsUpload: defineMessage({
		id: 'administration.imports.upload',
		defaultMessage: 'Upload a file',
		description: 'Section where a CSV file is chosen and uploaded.'
	}),
	importsUploadDescription: defineMessage({
		id: 'administration.imports.upload.description',
		defaultMessage: 'Nothing changes until you review the rows and choose to import them.',
		description: 'Description of the upload section.'
	}),
	importsMode: defineMessage({
		id: 'administration.imports.mode',
		defaultMessage: 'The file adds',
		description: 'Field: what the rows of the file do.'
	}),
	importsModeStudents: defineMessage({
		id: 'administration.imports.mode.students',
		defaultMessage: 'Students to a class',
		description: 'Import mode.'
	}),
	importsModeTeachers: defineMessage({
		id: 'administration.imports.mode.teachers',
		defaultMessage: 'Teachers to a unit',
		description: 'Import mode.'
	}),
	importsModeInstitution: defineMessage({
		id: 'administration.imports.mode.institution',
		defaultMessage: 'People to the institution',
		description: 'Import mode.'
	}),
	importsModeAdministration: defineMessage({
		id: 'administration.imports.mode.administration',
		defaultMessage: 'Changes to units, classes and roles',
		description: 'Import mode.'
	}),
	importsModeProgression: defineMessage({
		id: 'administration.imports.mode.progression',
		defaultMessage: 'Students moving to their next class',
		description: 'Import mode created by a student progression.'
	}),
	importsFile: defineMessage({
		id: 'administration.imports.file',
		defaultMessage: 'CSV file',
		description: 'Field: the file to upload.'
	}),
	importsFileHint: defineMessage({
		id: 'administration.imports.file.hint',
		defaultMessage: 'A CSV file of up to 10 MB with a header row.',
		description: 'Hint under the file field.'
	}),
	importsFileRequired: defineMessage({
		id: 'administration.imports.file.required',
		defaultMessage: 'Choose a CSV file.',
		description: 'Error when no file is chosen.'
	}),
	importsFileTooLarge: defineMessage({
		id: 'administration.imports.file.too.large',
		defaultMessage: 'That file is larger than 10 MB. Split it into smaller files.',
		description: 'Error when the file is too large.'
	}),
	importsChooseFile: defineMessage({
		id: 'administration.imports.choose',
		defaultMessage: 'Choose file',
		description: 'Button that opens the file picker.'
	}),
	importsNoFile: defineMessage({
		id: 'administration.imports.no.file',
		defaultMessage: 'No file chosen',
		description: 'Shown before a file is chosen.'
	}),
	importsUploadButton: defineMessage({
		id: 'administration.imports.upload.button',
		defaultMessage: 'Upload and review',
		description: 'Uploads the file and opens its review.'
	}),
	importsUploaded: defineMessage({
		id: 'administration.imports.uploaded',
		defaultMessage: 'The file is uploaded. Checking its rows…',
		description: 'Toast after a file is uploaded.'
	}),
	importTrail: defineMessage({
		id: 'administration.imports.trail',
		defaultMessage: 'Imports',
		description: 'The trail step back to Imports.'
	}),
	importCommitTitle: defineMessage({
		id: 'administration.imports.commit.title',
		defaultMessage: 'Import these rows?',
		description: 'Confirmation title before importing.'
	}),
	importCommitBody: defineMessage({
		id: 'administration.imports.commit.body',
		defaultMessage:
			'Accounts, enrolments and invitations are created as the rows say. Rows with errors are left out.',
		description: 'Confirmation body before importing.'
	}),
	importStarted: defineMessage({
		id: 'administration.imports.started',
		defaultMessage: 'Importing. This page updates as it goes.',
		description: 'Toast after an import starts.'
	}),
	importCancel: defineMessage({
		id: 'administration.imports.cancel',
		defaultMessage: 'Cancel import',
		description: 'Cancels an import after confirming.'
	}),
	importCancelTitle: defineMessage({
		id: 'administration.imports.cancel.title',
		defaultMessage: 'Cancel this import?',
		description: 'Confirmation title before cancelling an import.'
	}),
	importCancelBody: defineMessage({
		id: 'administration.imports.cancel.body',
		defaultMessage: 'Rows not yet imported are left out. Anything already imported stays.',
		description: 'Confirmation body before cancelling an import.'
	}),
	importCancelConfirm: defineMessage({
		id: 'administration.imports.cancel.confirm',
		defaultMessage: 'Cancel import',
		description: 'Confirms cancelling an import.'
	}),
	importCancelled: defineMessage({
		id: 'administration.imports.cancelled',
		defaultMessage: 'The import is cancelled',
		description: 'Toast after an import is cancelled.'
	}),
	importNewFile: defineMessage({
		id: 'administration.imports.new.file',
		defaultMessage: 'Upload a new file',
		description: 'Opens Imports to upload another file.'
	}),
	importStateUploading: defineMessage({
		id: 'administration.imports.state.uploading',
		defaultMessage: 'Uploading',
		description: 'Import state.'
	}),
	importStateParsing: defineMessage({
		id: 'administration.imports.state.parsing',
		defaultMessage: 'Checking',
		description: 'Import state.'
	}),
	importStateReady: defineMessage({
		id: 'administration.imports.state.ready',
		defaultMessage: 'Ready to review',
		description: 'Import state.'
	}),
	importStateExecuting: defineMessage({
		id: 'administration.imports.state.executing',
		defaultMessage: 'Importing',
		description: 'Import state.'
	}),
	importStateCompleted: defineMessage({
		id: 'administration.imports.state.completed',
		defaultMessage: 'Imported',
		description: 'Import state.'
	}),
	importStateCompletedWithErrors: defineMessage({
		id: 'administration.imports.state.completed.errors',
		defaultMessage: 'Imported with errors',
		description: 'Import state.'
	}),
	importStateCanceled: defineMessage({
		id: 'administration.imports.state.canceled',
		defaultMessage: 'Cancelled',
		description: 'Import state.'
	}),
	importStateFailed: defineMessage({
		id: 'administration.imports.state.failed',
		defaultMessage: 'Failed',
		description: 'Import state.'
	}),
	importCommitPeople: defineMessage({
		id: 'administration.import.commit.people',
		defaultMessage: 'Import {count} people',
		description: 'Imports the ready rows of an import.'
	}),
	importCommitPeopleOne: defineMessage({
		id: 'administration.import.commit.people.one',
		defaultMessage: 'Import {count} person',
		description: 'Imports the one ready row of an import.'
	}),
	importRecordRows: defineMessage({
		id: 'administration.import.record.rows',
		defaultMessage: '{count} rows',
		description: 'How many rows an import file has.'
	}),
	importRecordRowsOne: defineMessage({
		id: 'administration.import.record.rows.one',
		defaultMessage: '{count} row',
		description: 'An import file with one row.'
	}),
	importRecordPeople: defineMessage({
		id: 'administration.import.record.people',
		defaultMessage: '{count} people',
		description: 'How many people an import is adding.'
	}),
	importRecordPeopleOne: defineMessage({
		id: 'administration.import.record.people.one',
		defaultMessage: '{count} person',
		description: 'An import adding one person.'
	}),
	importRecordUploaded: defineMessage({
		id: 'administration.import.record.uploaded',
		defaultMessage: 'Uploaded {when}',
		description: 'When an import file was uploaded: “Uploaded 20 minutes ago”.'
	}),
	importRecordStarted: defineMessage({
		id: 'administration.import.record.started',
		defaultMessage: 'Started {when}',
		description: 'When an import started: “Started 1 minute ago”.'
	}),
	importRecordFinished: defineMessage({
		id: 'administration.import.record.finished',
		defaultMessage: 'Finished {when}',
		description: 'When an import finished: “Finished today at 09:31”.'
	}),
	importSteps: defineMessage({
		id: 'administration.import.steps',
		defaultMessage: 'Steps',
		description: 'Accessible name of an import’s steps.'
	}),
	importStepUpload: defineMessage({
		id: 'administration.import.step.upload',
		defaultMessage: 'Upload',
		description: 'The first step of an import.'
	}),
	importStepReview: defineMessage({
		id: 'administration.import.step.review',
		defaultMessage: 'Review',
		description: 'The second step of an import.'
	}),
	importStepImport: defineMessage({
		id: 'administration.import.step.import',
		defaultMessage: 'Import',
		description: 'The last step of an import.'
	}),
	importCheckingBanner: defineMessage({
		id: 'administration.import.banner.checking',
		defaultMessage:
			'Checking every row against the people and classes already here. Nothing changes yet, and you can leave this page: the import waits for you under Imports.',
		description: 'Shown while the server checks an import file.'
	}),
	importImportingBanner: defineMessage({
		id: 'administration.import.banner.importing',
		defaultMessage:
			'Imported {done} of {total} people. Each one is added as soon as they’re ready; you can leave this page.',
		description: 'Shown while an import runs.'
	}),
	importLeftOutBanner: defineMessage({
		id: 'administration.import.banner.left.out',
		defaultMessage:
			'{count} rows can’t be imported and will be left out. Fix them in the file and upload it again, or import the rest now.',
		description: 'Shown on an import ready to review with rows that will be left out.'
	}),
	importLeftOutBannerOne: defineMessage({
		id: 'administration.import.banner.left.out.one',
		defaultMessage:
			'{count} row can’t be imported and will be left out. Fix it in the file and upload it again, or import the rest now.',
		description: 'Shown on an import ready to review with one row that will be left out.'
	}),
	importDoneBanner: defineMessage({
		id: 'administration.import.banner.done',
		defaultMessage:
			'{imported} people were imported. {missed} rows didn’t import: {left} left out at review and {failed} that failed while importing. The report lists every one.',
		description: 'Shown on a finished import where some rows did not import.'
	}),
	importUnreadableBanner: defineMessage({
		id: 'administration.import.banner.unreadable',
		defaultMessage:
			'This file couldn’t be read as CSV, so nothing was imported. Save it from your spreadsheet as “CSV UTF-8” and upload it again.',
		description: 'Shown on an import whose file could not be read.'
	}),
	importFailedBanner: defineMessage({
		id: 'administration.import.banner.failed',
		defaultMessage:
			'This import stopped before it finished. Upload the file again to try once more.',
		description: 'Shown on an import that failed for another reason.'
	}),
	importStatChecked: defineMessage({
		id: 'administration.import.stat.checked',
		defaultMessage: 'Checked',
		description: 'Rows checked so far.'
	}),
	importStatOf: defineMessage({
		id: 'administration.import.stat.of',
		defaultMessage: 'Of {total} rows',
		description: 'Note under the rows checked so far.'
	}),
	importStatReadySoFar: defineMessage({
		id: 'administration.import.stat.ready.so.far',
		defaultMessage: 'Ready so far',
		description: 'Rows ready while checking continues.'
	}),
	importStatNew: defineMessage({
		id: 'administration.import.stat.new',
		defaultMessage: 'New accounts and enrolments',
		description: 'Note under rows that add people.'
	}),
	importStatNeedLook: defineMessage({
		id: 'administration.import.stat.need.look',
		defaultMessage: 'Need a look',
		description: 'Rows with a problem found so far.'
	}),
	importStatSoFar: defineMessage({
		id: 'administration.import.stat.so.far',
		defaultMessage: 'So far',
		description: 'Note under a figure still growing.'
	}),
	importStatReady: defineMessage({
		id: 'administration.import.stat.ready',
		defaultMessage: 'Ready',
		description: 'Rows that will import.'
	}),
	importStatAsWritten: defineMessage({
		id: 'administration.import.stat.as.written',
		defaultMessage: 'Imported as written',
		description: 'Note under the ready rows.'
	}),
	importStatSkipped: defineMessage({
		id: 'administration.import.stat.skipped',
		defaultMessage: 'Skipped',
		description: 'Rows with nothing to change.'
	}),
	importStatAlready: defineMessage({
		id: 'administration.import.stat.already',
		defaultMessage: 'Already there',
		description: 'Note under skipped rows.'
	}),
	importStatLeftOut: defineMessage({
		id: 'administration.import.stat.left.out',
		defaultMessage: 'Left out',
		description: 'Rows that can’t be imported.'
	}),
	importStatFixUpload: defineMessage({
		id: 'administration.import.stat.fix.upload',
		defaultMessage: 'Fix and upload again',
		description: 'Note under rows left out.'
	}),
	importStatImported: defineMessage({
		id: 'administration.import.stat.imported',
		defaultMessage: 'Imported',
		description: 'Rows imported.'
	}),
	importStatWaiting: defineMessage({
		id: 'administration.import.stat.waiting',
		defaultMessage: 'Waiting',
		description: 'Rows not yet imported.'
	}),
	importStatInOrder: defineMessage({
		id: 'administration.import.stat.in.order',
		defaultMessage: 'In order',
		description: 'Note under waiting rows.'
	}),
	importStatDidnt: defineMessage({
		id: 'administration.import.stat.didnt',
		defaultMessage: 'Didn’t import',
		description: 'Rows that failed while importing.'
	}),
	importStatYet: defineMessage({
		id: 'administration.import.stat.yet',
		defaultMessage: 'Yet',
		description: 'Note under rows that failed so far.'
	}),
	importStatLeftOutReview: defineMessage({
		id: 'administration.import.stat.left.out.review',
		defaultMessage: 'Left out at review',
		description: 'Rows left out before importing.'
	}),
	importStatInReport: defineMessage({
		id: 'administration.import.stat.in.report',
		defaultMessage: 'In the report',
		description: 'Note under rows left out at review.'
	}),
	importStatFailedImporting: defineMessage({
		id: 'administration.import.stat.failed.importing',
		defaultMessage: 'Failed while importing',
		description: 'Rows that failed while importing.'
	}),
	importStatListedBelow: defineMessage({
		id: 'administration.import.stat.listed.below',
		defaultMessage: 'Listed below',
		description: 'Note under rows that failed while importing.'
	}),
	importLookTitle: defineMessage({
		id: 'administration.import.look.title',
		defaultMessage: 'Rows that need a look',
		description: 'Heading of an import’s rows that won’t import as written.'
	}),
	importLookDescription: defineMessage({
		id: 'administration.import.look.description',
		defaultMessage: 'Left out first, then skipped. Everything else imports as written.',
		description: 'Explains the rows that need a look.'
	}),
	importFailedTitle: defineMessage({
		id: 'administration.import.failed.title',
		defaultMessage: 'Rows that failed while importing',
		description: 'Heading of an import’s rows that failed.'
	}),
	importColumnRow: defineMessage({
		id: 'administration.import.column.row',
		defaultMessage: 'Row',
		description: 'Column of the row number in the file.'
	}),
	importColumnPerson: defineMessage({
		id: 'administration.import.column.person',
		defaultMessage: 'Person',
		description: 'Column of who a row is about.'
	}),
	importColumnFound: defineMessage({
		id: 'administration.import.column.found',
		defaultMessage: 'What Proctor found',
		description: 'Column of what is wrong with a row.'
	}),
	importColumnOutcome: defineMessage({
		id: 'administration.import.column.outcome',
		defaultMessage: 'Outcome',
		description: 'Column of what happens to a row.'
	}),
	importColumnWhy: defineMessage({
		id: 'administration.import.column.why',
		defaultMessage: 'Why',
		description: 'Column of why a row failed.'
	}),
	importOutcomeLeftOut: defineMessage({
		id: 'administration.import.outcome.left.out',
		defaultMessage: 'Left out',
		description: 'A row that won’t be imported.'
	}),
	importOutcomeSkipped: defineMessage({
		id: 'administration.import.outcome.skipped',
		defaultMessage: 'Skipped',
		description: 'A row with nothing to change.'
	}),
	importFoundAlready: defineMessage({
		id: 'administration.import.found.already',
		defaultMessage: 'Already in place, so nothing changes',
		description: 'A row that needs no change.'
	}),
	importFoundUnknown: defineMessage({
		id: 'administration.import.found.unknown',
		defaultMessage: 'This row can’t be imported',
		description: 'A row with an unknown problem.'
	}),
	importExpectsTitle: defineMessage({
		id: 'administration.import.expects.title',
		defaultMessage: 'What Proctor expects',
		description: 'Heading of how an import file should look.'
	}),
	importExpectsFormat: defineMessage({
		id: 'administration.import.expects.format',
		defaultMessage: 'Format',
		description: 'The file format an import needs.'
	}),
	importExpectsFormatValue: defineMessage({
		id: 'administration.import.expects.format.value',
		defaultMessage: 'CSV, saved as “CSV UTF-8”',
		description: 'The file format an import needs.'
	}),
	importExpectsFirstRow: defineMessage({
		id: 'administration.import.expects.first.row',
		defaultMessage: 'First row',
		description: 'What the first row of an import file holds.'
	}),
	importExpectsFirstRowValue: defineMessage({
		id: 'administration.import.expects.first.row.value',
		defaultMessage: 'Column names: email, first name, last name',
		description: 'What the first row of an import file holds.'
	}),
	importExpectsEachRow: defineMessage({
		id: 'administration.import.expects.each.row',
		defaultMessage: 'Each row after',
		description: 'What every later row of an import file holds.'
	}),
	importExpectsEachRowValue: defineMessage({
		id: 'administration.import.expects.each.row.value',
		defaultMessage: 'One person',
		description: 'What every later row of an import file holds.'
	}),
	importsRecentTable: defineMessage({
		id: 'administration.imports.recent.table',
		defaultMessage: 'Recent imports',
		description: 'Accessible name of the table of earlier imports.'
	}),
	importsColumnFile: defineMessage({
		id: 'administration.imports.column.file',
		defaultMessage: 'File',
		description: 'Column of an import’s file and kind.'
	}),
	importsColumnRows: defineMessage({
		id: 'administration.imports.column.rows',
		defaultMessage: 'Rows',
		description: 'Column of how many rows a file had.'
	}),
	importsColumnUploaded: defineMessage({
		id: 'administration.imports.column.uploaded',
		defaultMessage: 'Uploaded',
		description: 'Column of when a file was uploaded.'
	}),
	importsColumnStatus: defineMessage({
		id: 'administration.imports.column.status',
		defaultMessage: 'Status',
		description: 'Column of where an import stands.'
	}),
	importsStatus: defineMessage({
		id: 'administration.imports.filter.status',
		defaultMessage: 'Status',
		description: 'Label of the Imports status filter.'
	}),
	importsAny: defineMessage({
		id: 'administration.imports.filter.any',
		defaultMessage: 'Any',
		description: 'The Imports status filter set to every status.'
	}),
	importsKept: defineMessage({
		id: 'administration.imports.kept',
		defaultMessage: 'Kept for 30 days. Open one to see its rows or download its report.',
		description: 'Explains the Imports list above its table.'
	}),
	importsReview: defineMessage({
		id: 'administration.imports.review',
		defaultMessage: 'Review',
		description: 'Opens an import that is ready to review.'
	}),
	importsImportedMissed: defineMessage({
		id: 'administration.imports.imported.missed',
		defaultMessage: 'Imported, {count} didn’t',
		description: 'Status of an import where some rows were not imported: “Imported, 2 didn’t”.'
	}),
	importsUnreadable: defineMessage({
		id: 'administration.imports.unreadable',
		defaultMessage: 'Couldn’t read',
		description: 'Status of an import whose file could not be read as CSV.'
	}),
	importsNoMatch: defineMessage({
		id: 'administration.imports.no.match',
		defaultMessage: 'No imports with this status',
		description: 'The Imports list when the status filter matches nothing.'
	}),
	importsRecentEmpty: defineMessage({
		id: 'administration.imports.recent.empty',
		defaultMessage: 'No imports yet',
		description: 'Title of the empty Imports list.'
	}),
	importsRecentEmptyText: defineMessage({
		id: 'administration.imports.recent.empty.text',
		defaultMessage:
			'Upload a CSV of students for a class, teachers for a unit, or people with a role. You review every row before anyone is added.',
		description: 'Explains the empty Imports list.'
	}),
	importsUnnamed: defineMessage({
		id: 'administration.imports.unnamed',
		defaultMessage: 'A CSV file',
		description: 'An import whose file name isn’t known.'
	})
});
