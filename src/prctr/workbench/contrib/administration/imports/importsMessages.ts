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
		defaultMessage: 'Choose file…',
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
	importDescription: defineMessage({
		id: 'administration.imports.description',
		defaultMessage: '{rows} rows · uploaded {when}',
		description: 'Description of one import.'
	}),
	importChecking: defineMessage({
		id: 'administration.imports.checking',
		defaultMessage: 'Checking the rows… This page updates on its own.',
		description: 'Shown while the server reads the file.'
	}),
	importImporting: defineMessage({
		id: 'administration.imports.importing',
		defaultMessage: 'Importing… This page updates on its own.',
		description: 'Shown while the server imports the rows.'
	}),
	importSummary: defineMessage({
		id: 'administration.imports.summary',
		defaultMessage: 'Summary',
		description: 'Section with the counts of an import.'
	}),
	importReady: defineMessage({
		id: 'administration.imports.ready',
		defaultMessage: 'Ready',
		description: 'Count of rows that will import.'
	}),
	importErrors: defineMessage({
		id: 'administration.imports.errors',
		defaultMessage: 'Errors',
		description: 'Count of rows that will be left out.'
	}),
	importTotal: defineMessage({
		id: 'administration.imports.total',
		defaultMessage: 'Rows',
		description: 'Count of all rows in the file.'
	}),
	importSucceeded: defineMessage({
		id: 'administration.imports.succeeded',
		defaultMessage: 'Imported',
		description: 'Count of rows imported.'
	}),
	importFailed: defineMessage({
		id: 'administration.imports.failed',
		defaultMessage: 'Failed',
		description: 'Count of rows that failed to import.'
	}),
	importSkipped: defineMessage({
		id: 'administration.imports.skipped',
		defaultMessage: 'Skipped',
		description: 'Count of rows left out or already done.'
	}),
	importLeftOut: defineMessage({
		id: 'administration.imports.left.out',
		defaultMessage:
			'{count} rows can’t be imported and will be left out. Fix them in the file and upload it again, or import the rest now.',
		description: 'Notice when some rows have errors.'
	}),
	importRows: defineMessage({
		id: 'administration.imports.rows',
		defaultMessage: 'Rows that need a look',
		description: 'Section with the rows that have a problem.'
	}),
	importRowsDescription: defineMessage({
		id: 'administration.imports.rows.description',
		defaultMessage: 'Errors first. Everything else imports as written.',
		description: 'Description of the rows section.'
	}),
	importRowsNone: defineMessage({
		id: 'administration.imports.rows.none',
		defaultMessage: 'Every row is ready to import.',
		description: 'Shown when no row has a problem.'
	}),
	importRowsMore: defineMessage({
		id: 'administration.imports.rows.more',
		defaultMessage: 'Only the first 100 rows are shown.',
		description: 'Shown when the preview has more rows.'
	}),
	importRow: defineMessage({
		id: 'administration.imports.row',
		defaultMessage: 'Row {row} · {reference}',
		description: 'Title of one row of an import.'
	}),
	importRowCode: defineMessage({
		id: 'administration.imports.row.code',
		defaultMessage: '{code}',
		description: 'The server’s code for a row’s problem.'
	}),
	importRowValid: defineMessage({
		id: 'administration.imports.row.valid',
		defaultMessage: 'Ready',
		description: 'Row status.'
	}),
	importRowInvalid: defineMessage({
		id: 'administration.imports.row.invalid',
		defaultMessage: 'Left out',
		description: 'Row status: it has an error.'
	}),
	importRowDuplicate: defineMessage({
		id: 'administration.imports.row.duplicate',
		defaultMessage: 'Duplicate',
		description: 'Row status: repeats an earlier row.'
	}),
	importRowDone: defineMessage({
		id: 'administration.imports.row.done',
		defaultMessage: 'Imported',
		description: 'Row status after import.'
	}),
	importRowFailed: defineMessage({
		id: 'administration.imports.row.failed',
		defaultMessage: 'Failed',
		description: 'Row status after a failed import.'
	}),
	importRowSkipped: defineMessage({
		id: 'administration.imports.row.skipped',
		defaultMessage: 'Skipped',
		description: 'Row status: left out.'
	}),
	importCommitAll: defineMessage({
		id: 'administration.imports.commit.all',
		defaultMessage: 'Import {count} rows',
		description: 'Imports every row; count is how many.'
	}),
	importCommitValid: defineMessage({
		id: 'administration.imports.commit.valid',
		defaultMessage: 'Import the {count} ready rows',
		description: 'Imports only the rows without errors.'
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
		defaultMessage: 'Cancel import…',
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
	})
});
