/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { defineMessage } from '../../../../base/common/localization.js';

/** Text of the Audits and Data retention pages. */
export const recordsMessages = Object.freeze({
	auditsFind: defineMessage({
		id: 'administration.records.audits.find',
		defaultMessage: 'Filter by action, such as user.disable',
		description: 'Search field above the audit events; the server matches the whole action.'
	}),
	auditsShow: defineMessage({
		id: 'administration.records.audits.show',
		defaultMessage: 'Show',
		description: 'Filter: changes only or every event.'
	}),
	auditsChanges: defineMessage({
		id: 'administration.records.audits.changes',
		defaultMessage: 'Changes only',
		description: 'Filter choice: only events that changed something.'
	}),
	auditsEverything: defineMessage({
		id: 'administration.records.audits.everything',
		defaultMessage: 'Every event',
		description: 'Filter choice: every event, including reads.'
	}),
	auditsTable: defineMessage({
		id: 'administration.records.audits.table',
		defaultMessage: 'Audit events',
		description: 'Accessible name of the audit table.'
	}),
	auditsEvent: defineMessage({
		id: 'administration.records.audits.column.event',
		defaultMessage: 'Event',
		description: 'Audit column.'
	}),
	auditsActor: defineMessage({
		id: 'administration.records.audits.column.actor',
		defaultMessage: 'By',
		description: 'Audit column: who did it.'
	}),
	auditsOutcome: defineMessage({
		id: 'administration.records.audits.column.outcome',
		defaultMessage: 'Outcome',
		description: 'Audit column.'
	}),
	auditsWhen: defineMessage({
		id: 'administration.records.audits.column.when',
		defaultMessage: 'When',
		description: 'Audit column.'
	}),
	auditsSystem: defineMessage({
		id: 'administration.records.audits.system',
		defaultMessage: 'Proctor',
		description: 'An event with no person behind it.'
	}),
	auditsEmpty: defineMessage({
		id: 'administration.records.audits.empty',
		defaultMessage: 'No events yet.',
		description: 'Shown when there are no audit events.'
	}),
	auditsNoMatch: defineMessage({
		id: 'administration.records.audits.empty.filtered',
		defaultMessage: 'No events match.',
		description: 'Shown when filters find nothing.'
	}),
	auditsPageReads: defineMessage({
		id: 'administration.records.audits.page.reads',
		defaultMessage: 'Reads on this page are hidden.',
		description: 'Note when a page holds only reads.'
	}),
	retentionPolicy: defineMessage({
		id: 'administration.records.retention.policy',
		defaultMessage: 'How long records are kept',
		description: 'Section with the retention periods.'
	}),
	retentionSubmissions: defineMessage({
		id: 'administration.records.retention.submissions',
		defaultMessage: 'Submissions and results',
		description: 'Retention period.'
	}),
	retentionIntegrity: defineMessage({
		id: 'administration.records.retention.integrity',
		defaultMessage: 'Integrity evidence',
		description: 'Retention period.'
	}),
	retentionBrowser: defineMessage({
		id: 'administration.records.retention.browser',
		defaultMessage: 'Browser activity',
		description: 'Retention period.'
	}),
	retentionSecurity: defineMessage({
		id: 'administration.records.retention.security',
		defaultMessage: 'Security records',
		description: 'Retention period.'
	}),
	retentionAudit: defineMessage({
		id: 'administration.records.retention.audit',
		defaultMessage: 'Audit events',
		description: 'Retention period.'
	}),
	retentionExports: defineMessage({
		id: 'administration.records.retention.exports',
		defaultMessage: 'Exports',
		description: 'Retention period.'
	}),
	retentionGrace: defineMessage({
		id: 'administration.records.retention.grace',
		defaultMessage: 'Grace before deleting',
		description: 'Days records wait after becoming eligible.'
	}),
	retentionNotices: defineMessage({
		id: 'administration.records.retention.notices',
		defaultMessage: 'Tell candidates',
		description: 'Whether candidates are told when their records will be deleted.'
	}),
	retentionDays: defineMessage({
		id: 'administration.records.retention.days',
		defaultMessage: '{count} days',
		description: 'A number of days.'
	}),
	retentionNever: defineMessage({
		id: 'administration.records.retention.never',
		defaultMessage: 'Kept until deleted by hand',
		description: 'A retention period of zero days.'
	}),
	retentionOn: defineMessage({
		id: 'administration.records.retention.on',
		defaultMessage: 'On',
		description: 'A setting that is on.'
	}),
	retentionOff: defineMessage({
		id: 'administration.records.retention.off',
		defaultMessage: 'Off',
		description: 'A setting that is off.'
	}),
	retentionEdit: defineMessage({
		id: 'administration.records.retention.edit',
		defaultMessage: 'Edit',
		description: 'Edits the retention policy.'
	}),
	retentionEditTitle: defineMessage({
		id: 'administration.records.retention.edit.title',
		defaultMessage: 'How long records are kept',
		description: 'Title of the retention policy dialog.'
	}),
	retentionDaysHint: defineMessage({
		id: 'administration.records.retention.days.hint',
		defaultMessage: 'Whole days. 0 keeps them until deleted by hand.',
		description: 'Hint under a retention period.'
	}),
	retentionDaysInvalid: defineMessage({
		id: 'administration.records.retention.days.invalid',
		defaultMessage: 'Enter a whole number of days from 0 to 36500.',
		description: 'Error for an invalid number of days.'
	}),
	retentionSaved: defineMessage({
		id: 'administration.records.retention.saved',
		defaultMessage: 'The retention policy is saved',
		description: 'Toast after saving the policy.'
	}),
	retentionCleanup: defineMessage({
		id: 'administration.records.retention.cleanup',
		defaultMessage: 'Automatic cleanup',
		description: 'Section with whether eligible records are deleted.'
	}),
	retentionStateDisabled: defineMessage({
		id: 'administration.records.retention.state.disabled',
		defaultMessage: 'Never turned on',
		description: 'Cleanup state.'
	}),
	retentionStateEnabled: defineMessage({
		id: 'administration.records.retention.state.enabled',
		defaultMessage: 'Running',
		description: 'Cleanup state.'
	}),
	retentionStatePaused: defineMessage({
		id: 'administration.records.retention.state.paused',
		defaultMessage: 'Paused',
		description: 'Cleanup state.'
	}),
	retentionState: defineMessage({
		id: 'administration.records.retention.state',
		defaultMessage: 'Cleanup',
		description: 'Cleanup detail.'
	}),
	retentionPreview: defineMessage({
		id: 'administration.records.retention.preview',
		defaultMessage: 'Preview cleanup',
		description: 'Asks the server what cleanup would delete.'
	}),
	retentionPreviewTitle: defineMessage({
		id: 'administration.records.retention.preview.title',
		defaultMessage: 'What cleanup would delete',
		description: 'Section with a cleanup preview.'
	}),
	retentionPreviewExpires: defineMessage({
		id: 'administration.records.retention.preview.expires',
		defaultMessage: 'This preview expires {when}.',
		description: 'Description of a cleanup preview.'
	}),
	retentionEligible: defineMessage({
		id: 'administration.records.retention.eligible',
		defaultMessage: '{eligible} of {total} eligible · {held} held',
		description: 'Counts for one kind of record.'
	}),
	retentionWork: defineMessage({
		id: 'administration.records.retention.work',
		defaultMessage: 'Work',
		description: 'Category of records.'
	}),
	retentionReceipts: defineMessage({
		id: 'administration.records.retention.receipts',
		defaultMessage: 'Receipts',
		description: 'Category of records.'
	}),
	retentionEnable: defineMessage({
		id: 'administration.records.retention.enable',
		defaultMessage: 'Turn on cleanup…',
		description: 'Turns automatic cleanup on after confirming.'
	}),
	retentionEnableTitle: defineMessage({
		id: 'administration.records.retention.enable.title',
		defaultMessage: 'Turn on automatic cleanup?',
		description: 'Confirmation title before turning cleanup on.'
	}),
	retentionEnableBody: defineMessage({
		id: 'administration.records.retention.enable.body',
		defaultMessage:
			'Records past their retention period and grace are deleted for good, as the preview shows. This can’t be undone for what is deleted.',
		description: 'Confirmation body before turning cleanup on.'
	}),
	retentionEnableConfirm: defineMessage({
		id: 'administration.records.retention.enable.confirm',
		defaultMessage: 'Turn on cleanup',
		description: 'Confirms turning cleanup on.'
	}),
	retentionPause: defineMessage({
		id: 'administration.records.retention.pause',
		defaultMessage: 'Pause cleanup',
		description: 'Pauses automatic cleanup.'
	}),
	retentionChanged: defineMessage({
		id: 'administration.records.retention.changed',
		defaultMessage: 'Cleanup is {state}',
		description: 'Toast after changing cleanup.'
	}),
	retentionNeedsPreview: defineMessage({
		id: 'administration.records.retention.needs.preview',
		defaultMessage: 'Preview cleanup first, then turn it on from the preview.',
		description: 'Note before cleanup can be turned on.'
	}),
	retentionRecords: defineMessage({
		id: 'administration.records.retention.records',
		defaultMessage: 'Records',
		description: 'Section with each submission’s retention.'
	}),
	retentionRecordsEmpty: defineMessage({
		id: 'administration.records.retention.records.empty',
		defaultMessage: 'No records yet.',
		description: 'Shown when there are no records.'
	}),
	retentionSubmission: defineMessage({
		id: 'administration.records.retention.column.submission',
		defaultMessage: 'Submission',
		description: 'Records column.'
	}),
	retentionCategory: defineMessage({
		id: 'administration.records.retention.column.category',
		defaultMessage: 'Kind',
		description: 'Records column.'
	}),
	retentionStatus: defineMessage({
		id: 'administration.records.retention.column.status',
		defaultMessage: 'Status',
		description: 'Records column.'
	}),
	retentionHeld: defineMessage({
		id: 'administration.records.retention.held',
		defaultMessage: 'Held',
		description: 'A record kept by a preservation hold.'
	}),
	retentionEligibleOn: defineMessage({
		id: 'administration.records.retention.eligible.on',
		defaultMessage: 'Eligible {date}',
		description: 'A record that becomes eligible on a date.'
	}),
	retentionRetired: defineMessage({
		id: 'administration.records.retention.retired',
		defaultMessage: 'Deleted {date}',
		description: 'A record already deleted.'
	}),
	retentionKept: defineMessage({
		id: 'administration.records.retention.kept',
		defaultMessage: 'Kept',
		description: 'A record not yet eligible.'
	}),
	auditsPeriod: defineMessage({
		id: 'administration.audits.period',
		defaultMessage: 'Period',
		description: 'Filter of how far back the audit log reaches.'
	}),
	auditsPeriodDay: defineMessage({
		id: 'administration.audits.period.day',
		defaultMessage: 'Last 24 hours',
		description: 'The audit log shows the last day.'
	}),
	auditsPeriodWeek: defineMessage({
		id: 'administration.audits.period.week',
		defaultMessage: 'Last 7 days',
		description: 'The audit log shows the last week.'
	}),
	auditsPeriodMonth: defineMessage({
		id: 'administration.audits.period.month',
		defaultMessage: 'Last 30 days',
		description: 'The audit log shows the last month.'
	}),
	auditsPeriodAny: defineMessage({
		id: 'administration.audits.period.any',
		defaultMessage: 'Any time',
		description: 'The audit log shows everything.'
	}),
	auditsWhere: defineMessage({
		id: 'administration.audits.where',
		defaultMessage: 'Where',
		description: 'Column of the app and address an event came from.'
	}),
	auditsReason: defineMessage({
		id: 'administration.audits.reason',
		defaultMessage: 'Reason: {reason}',
		description: 'Under an event: why an administrator did it.'
	}),
	clientDesktop: defineMessage({
		id: 'administration.client.desktop',
		defaultMessage: 'Proctor Desktop',
		description: 'An event that came from Proctor Desktop.'
	}),
	clientBrowser: defineMessage({
		id: 'administration.client.browser',
		defaultMessage: 'Web browser',
		description: 'An event that came from a web browser.'
	}),
	clientCommandLine: defineMessage({
		id: 'administration.client.cli',
		defaultMessage: 'Command line',
		description: 'An event that came from the command-line tool.'
	})
});
