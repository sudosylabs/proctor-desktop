/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { defineMessage } from '../../../../base/common/localization.js';

/** Text of the Jobs and Mail pages. */
export const operationsMessages = Object.freeze({
	jobsStatus: defineMessage({
		id: 'administration.operations.jobs.status',
		defaultMessage: 'Status',
		description: 'Filter over the jobs.'
	}),
	jobsNotDone: defineMessage({
		id: 'administration.operations.jobs.notdone',
		defaultMessage: 'Not done',
		description: 'Jobs filter choice, the default: waiting, running or failed jobs.'
	}),
	jobsDone: defineMessage({
		id: 'administration.operations.jobs.done',
		defaultMessage: 'Done',
		description: 'Jobs filter choice: jobs that finished or were cancelled.'
	}),
	jobsDoneNote: defineMessage({
		id: 'administration.operations.jobs.done.note',
		defaultMessage: 'Finished and routine runs are under Status: Done.',
		description: 'Explains the Jobs list above its table.'
	}),
	jobsAny: defineMessage({
		id: 'administration.operations.jobs.any',
		defaultMessage: 'Any status',
		description: 'Filter choice: every job.'
	}),
	jobQueued: defineMessage({
		id: 'administration.operations.job.queued',
		defaultMessage: 'Queued',
		description: 'Job status.'
	}),
	jobRunning: defineMessage({
		id: 'administration.operations.job.running',
		defaultMessage: 'Running',
		description: 'Job status.'
	}),
	jobCancelRequested: defineMessage({
		id: 'administration.operations.job.cancel.requested',
		defaultMessage: 'Cancelling',
		description: 'Job status.'
	}),
	jobSucceeded: defineMessage({
		id: 'administration.operations.job.succeeded',
		defaultMessage: 'Done',
		description: 'Job status.'
	}),
	jobFailed: defineMessage({
		id: 'administration.operations.job.failed',
		defaultMessage: 'Failed',
		description: 'Job status.'
	}),
	jobCanceled: defineMessage({
		id: 'administration.operations.job.canceled',
		defaultMessage: 'Cancelled',
		description: 'Job status.'
	}),
	jobsTable: defineMessage({
		id: 'administration.operations.jobs.table',
		defaultMessage: 'Jobs',
		description: 'Accessible name of the jobs table.'
	}),
	jobsJob: defineMessage({
		id: 'administration.operations.jobs.column.job',
		defaultMessage: 'Job',
		description: 'Jobs column.'
	}),
	jobsProgress: defineMessage({
		id: 'administration.operations.jobs.column.progress',
		defaultMessage: 'Progress',
		description: 'Jobs column.'
	}),
	jobsUpdated: defineMessage({
		id: 'administration.operations.jobs.column.updated',
		defaultMessage: 'Updated',
		description: 'Jobs column.'
	}),
	jobsStatusColumn: defineMessage({
		id: 'administration.operations.jobs.column.status',
		defaultMessage: 'Status',
		description: 'Jobs column.'
	}),
	jobsAttempts: defineMessage({
		id: 'administration.operations.jobs.attempts',
		defaultMessage: 'Attempt {attempt} of {maximum}',
		description: 'How many times a job has run.'
	}),
	jobsStage: defineMessage({
		id: 'administration.operations.jobs.stage',
		defaultMessage: '{stage} · {current} of {total}',
		description: 'A job’s progress.'
	}),
	jobsEmpty: defineMessage({
		id: 'administration.operations.jobs.empty',
		defaultMessage: 'No jobs yet',
		description: 'Title of the empty Jobs list.'
	}),
	jobsEmptyText: defineMessage({
		id: 'administration.operations.jobs.empty.text',
		defaultMessage: 'Imports, exports and cleanup show here once they start.',
		description: 'Explains the empty Jobs list.'
	}),
	jobsNoMatch: defineMessage({
		id: 'administration.operations.jobs.empty.filtered',
		defaultMessage: 'No jobs with this status.',
		description: 'Shown when the filter finds nothing.'
	}),
	jobRetry: defineMessage({
		id: 'administration.operations.job.retry',
		defaultMessage: 'Retry',
		description: 'Runs a failed job again.'
	}),
	jobRetried: defineMessage({
		id: 'administration.operations.job.retried',
		defaultMessage: 'The job is queued again',
		description: 'Toast after retrying a job.'
	}),
	jobCancel: defineMessage({
		id: 'administration.operations.job.cancel',
		defaultMessage: 'Cancel',
		description: 'Cancels a job after confirming.'
	}),
	jobCancelTitle: defineMessage({
		id: 'administration.operations.job.cancel.title',
		defaultMessage: 'Cancel this job?',
		description: 'Confirmation title before cancelling a job.'
	}),
	jobCancelBody: defineMessage({
		id: 'administration.operations.job.cancel.body',
		defaultMessage: 'It stops at its next safe point. Work already done stays.',
		description: 'Confirmation body before cancelling a job.'
	}),
	jobCancelConfirm: defineMessage({
		id: 'administration.operations.job.cancel.confirm',
		defaultMessage: 'Cancel job',
		description: 'Confirms cancelling a job.'
	}),
	jobCancelled: defineMessage({
		id: 'administration.operations.job.cancelled',
		defaultMessage: 'The job is cancelling',
		description: 'Toast after cancelling a job.'
	}),
	mailRecipientFilter: defineMessage({
		id: 'administration.operations.mail.filter.recipient',
		defaultMessage: 'Recipient',
		description: 'Mail filter: emails sent to one person.'
	}),
	mailAnyone: defineMessage({
		id: 'administration.operations.mail.filter.anyone',
		defaultMessage: 'Anyone',
		description: 'The Recipient filter with nobody chosen.'
	}),
	mailTitleViews: defineMessage({
		id: 'administration.operations.mail.views',
		defaultMessage: 'Mail views',
		description: 'Accessible name of the Mail tabs.'
	}),
	mailTabDeliveries: defineMessage({
		id: 'administration.operations.mail.tab.deliveries',
		defaultMessage: 'Deliveries',
		description: 'Tab listing every email Proctor sent.'
	}),
	mailTabKeys: defineMessage({
		id: 'administration.operations.mail.tab.keys',
		defaultMessage: 'Keys',
		description: 'Tab of the keys protecting mail and two-step secrets.'
	}),
	mailStatSent: defineMessage({
		id: 'administration.operations.mail.stat.sent',
		defaultMessage: 'Sent',
		description: 'Emails Proctor handed to the mail server.'
	}),
	mailStatDelivered: defineMessage({
		id: 'administration.operations.mail.stat.delivered',
		defaultMessage: 'Delivered',
		description: 'Share of sent emails that were delivered.'
	}),
	mailPercent: defineMessage({
		id: 'administration.operations.mail.percent',
		defaultMessage: '{value}%',
		description: 'A percentage: “98.7%”.'
	}),
	mailStatOfSent: defineMessage({
		id: 'administration.operations.mail.stat.of.sent',
		defaultMessage: 'Of those sent',
		description: 'Note under the delivered share.'
	}),
	mailStatBounced: defineMessage({
		id: 'administration.operations.mail.stat.bounced',
		defaultMessage: 'Bounced',
		description: 'Emails that could not be delivered.'
	}),
	mailStatNotRetried: defineMessage({
		id: 'administration.operations.mail.stat.not.retried',
		defaultMessage: 'Not retried',
		description: 'Note under bounced emails.'
	}),
	mailStatWaiting: defineMessage({
		id: 'administration.operations.mail.stat.waiting',
		defaultMessage: 'Waiting',
		description: 'Emails not yet sent.'
	}),
	mailStatQueued: defineMessage({
		id: 'administration.operations.mail.stat.queued',
		defaultMessage: 'Queued to send',
		description: 'Note under waiting emails.'
	}),
	mailHealth: defineMessage({
		id: 'administration.operations.mail.health',
		defaultMessage: 'All email, last 24 hours',
		description: 'Section of mail delivery figures over the last day.'
	}),
	mailHealthy: defineMessage({
		id: 'administration.operations.mail.healthy',
		defaultMessage: 'Mail is being delivered.',
		description: 'Mail health.'
	}),
	mailDisabled: defineMessage({
		id: 'administration.operations.mail.disabled',
		defaultMessage:
			'Mail isn’t set up on the server, so invitations and notices can’t be sent.',
		description: 'Mail health.'
	}),
	mailOutage: defineMessage({
		id: 'administration.operations.mail.outage',
		defaultMessage: 'The mail server isn’t accepting messages. They’re queued and retried.',
		description: 'Mail health.'
	}),
	mailDelayed: defineMessage({
		id: 'administration.operations.mail.delayed',
		defaultMessage: 'Mail is delayed. Messages are waiting longer than usual.',
		description: 'Mail health.'
	}),
	mailUnknown: defineMessage({
		id: 'administration.operations.mail.unknown',
		defaultMessage: 'Mail health isn’t known yet.',
		description: 'Mail health.'
	}),
	mailQueue: defineMessage({
		id: 'administration.operations.mail.queue',
		defaultMessage: '{state}: {count}',
		description: 'How many deliveries are in one state.'
	}),
	mailSendTest: defineMessage({
		id: 'administration.operations.mail.test',
		defaultMessage: 'Send a test email',
		description: 'Sends a test email to the signed-in person.'
	}),
	mailTestSent: defineMessage({
		id: 'administration.operations.mail.test.sent',
		defaultMessage: 'A test email is on its way to you',
		description: 'Toast after sending a test email.'
	}),
	mailDeliveries: defineMessage({
		id: 'administration.operations.mail.deliveries',
		defaultMessage: 'Deliveries',
		description: 'Section with the mail deliveries.'
	}),
	mailState: defineMessage({
		id: 'administration.operations.mail.filter.state',
		defaultMessage: 'Status',
		description: 'Filter over deliveries.'
	}),
	mailAny: defineMessage({
		id: 'administration.operations.mail.any',
		defaultMessage: 'Any status',
		description: 'Filter choice: every delivery.'
	}),
	mailQueued: defineMessage({
		id: 'administration.operations.mail.queued',
		defaultMessage: 'Queued',
		description: 'Delivery state.'
	}),
	mailSending: defineMessage({
		id: 'administration.operations.mail.sending',
		defaultMessage: 'Sending',
		description: 'Delivery state.'
	}),
	mailAccepted: defineMessage({
		id: 'administration.operations.mail.accepted',
		defaultMessage: 'Delivered',
		description: 'Delivery state.'
	}),
	mailFailedState: defineMessage({
		id: 'administration.operations.mail.failed',
		defaultMessage: 'Not delivered',
		description: 'Delivery state.'
	}),
	mailSuppressed: defineMessage({
		id: 'administration.operations.mail.suppressed',
		defaultMessage: 'Suppressed',
		description: 'Delivery state: the address refuses mail.'
	}),
	mailCanceledState: defineMessage({
		id: 'administration.operations.mail.canceled',
		defaultMessage: 'Cancelled',
		description: 'Delivery state.'
	}),
	mailRecipient: defineMessage({
		id: 'administration.operations.mail.column.recipient',
		defaultMessage: 'Recipient',
		description: 'Deliveries column.'
	}),
	mailTemplate: defineMessage({
		id: 'administration.operations.mail.column.template',
		defaultMessage: 'Message',
		description: 'Deliveries column.'
	}),
	mailUpdated: defineMessage({
		id: 'administration.operations.mail.column.updated',
		defaultMessage: 'Updated',
		description: 'Deliveries column.'
	}),
	mailStatus: defineMessage({
		id: 'administration.operations.mail.column.status',
		defaultMessage: 'Status',
		description: 'Deliveries column.'
	}),
	mailEmpty: defineMessage({
		id: 'administration.operations.mail.empty',
		defaultMessage: 'No email sent yet',
		description: 'Title of the empty list of mail deliveries.'
	}),
	mailEmptyText: defineMessage({
		id: 'administration.operations.mail.empty.text',
		defaultMessage:
			'Invitations, verification and sign-in help show here once Proctor sends them.',
		description: 'Explains the empty list of mail deliveries.'
	}),
	mailNoMatch: defineMessage({
		id: 'administration.operations.mail.empty.filtered',
		defaultMessage: 'No deliveries with this status.',
		description: 'Shown when the filter finds nothing.'
	}),
	mailRetry: defineMessage({
		id: 'administration.operations.mail.retry',
		defaultMessage: 'Retry',
		description: 'Sends a failed delivery again.'
	}),
	mailRetried: defineMessage({
		id: 'administration.operations.mail.retried',
		defaultMessage: 'The message is queued again',
		description: 'Toast after retrying a delivery.'
	}),
	mailCancel: defineMessage({
		id: 'administration.operations.mail.cancel',
		defaultMessage: 'Cancel',
		description: 'Cancels a queued delivery.'
	}),
	mailCancelled: defineMessage({
		id: 'administration.operations.mail.cancelled',
		defaultMessage: 'The message won’t be sent',
		description: 'Toast after cancelling a delivery.'
	}),
	mailKeys: defineMessage({
		id: 'administration.operations.mail.keys',
		defaultMessage: 'Encryption keys',
		description: 'Section with the keys that protect stored mail and two-step secrets.'
	}),
	mailKeysDescription: defineMessage({
		id: 'administration.operations.mail.keys.description',
		defaultMessage:
			'Retiring a key re-encrypts what it protects with the primary key, then removes it.',
		description: 'Description of the keys section.'
	}),
	mailKeyMail: defineMessage({
		id: 'administration.operations.mail.key.mail',
		defaultMessage: 'Mail key {key}',
		description: 'A key protecting stored mail.'
	}),
	mailKeyMfa: defineMessage({
		id: 'administration.operations.mail.key.mfa',
		defaultMessage: 'Two-step key {key}',
		description: 'A key protecting two-step secrets.'
	}),
	mailKeyPrimary: defineMessage({
		id: 'administration.operations.mail.key.primary',
		defaultMessage: 'Primary',
		description: 'The key new data uses.'
	}),
	mailKeyUses: defineMessage({
		id: 'administration.operations.mail.key.uses',
		defaultMessage: 'Protects {count} items',
		description: 'How much a key protects.'
	}),
	mailKeyRetire: defineMessage({
		id: 'administration.operations.mail.key.retire',
		defaultMessage: 'Retire',
		description: 'Starts retiring a key after confirming.'
	}),
	mailKeyRetireTitle: defineMessage({
		id: 'administration.operations.mail.key.retire.title',
		defaultMessage: 'Retire this key?',
		description: 'Confirmation title before retiring a key.'
	}),
	mailKeyRetireBody: defineMessage({
		id: 'administration.operations.mail.key.retire.body',
		defaultMessage:
			'A job re-encrypts what it protects with the primary key. Follow it under Jobs.',
		description: 'Confirmation body before retiring a key.'
	}),
	mailKeyRetireConfirm: defineMessage({
		id: 'administration.operations.mail.key.retire.confirm',
		defaultMessage: 'Retire key',
		description: 'Confirms retiring a key.'
	}),
	mailKeyRetiring: defineMessage({
		id: 'administration.operations.mail.key.retiring',
		defaultMessage: 'Retiring the key. Follow it under Jobs.',
		description: 'Toast after starting to retire a key.'
	}),
	mailKeysLocked: defineMessage({
		id: 'administration.operations.mail.keys.locked',
		defaultMessage: 'Shown only to a sign-in with two-step verification',
		description:
			'Title of the row that stands in for the keys when this sign-in can’t read them.'
	}),
	mailKeysLockedCode: defineMessage({
		id: 'administration.operations.mail.keys.locked.code',
		defaultMessage:
			'Your current sign-in didn’t use it. Confirm it’s you with your authenticator code to see and rotate the mail and two-step keys.',
		description:
			'Why the keys are hidden and the way on, when this sign-in hasn’t used two-step verification.'
	}),
	mailKeysLockedTurnOn: defineMessage({
		id: 'administration.operations.mail.keys.locked.turnon',
		defaultMessage:
			'Your account doesn’t have two-step verification yet. Turn it on, then confirm it’s you with the new code to see and rotate the mail and two-step keys.',
		description:
			'Why the keys are hidden and the way on, when the account has no two-step verification.'
	}),
	mailKeysLockedUnavailable: defineMessage({
		id: 'administration.operations.mail.keys.locked.unavailable',
		defaultMessage:
			'This Proctor doesn’t offer two-step verification, so nobody can see or rotate these keys until it’s turned on.',
		description:
			'Why the keys are hidden, when the installation has two-step verification turned off.'
	}),
	mailKeysLockedRecent: defineMessage({
		id: 'administration.operations.mail.keys.locked.recent',
		defaultMessage: 'Confirm it’s you to see and rotate the mail and two-step keys.',
		description: 'Why the keys are hidden and the way on, when the sign-in isn’t recent enough.'
	}),
	jobsStarted: defineMessage({
		id: 'administration.operations.jobs.started',
		defaultMessage: 'Started',
		description: 'Column of when a job started.'
	}),
	jobsTook: defineMessage({
		id: 'administration.operations.jobs.took',
		defaultMessage: 'Took',
		description: 'Column of how long a job ran.'
	}),
	jobsAttemptsColumn: defineMessage({
		id: 'administration.operations.jobs.attempts.column',
		defaultMessage: 'Attempts',
		description: 'Column of how many times a job was tried.'
	}),
	jobsAttemptsOf: defineMessage({
		id: 'administration.operations.jobs.attempts.of',
		defaultMessage: '{attempt} of {maximum}',
		description: 'How many tries a job used, as in "2 of 3".'
	}),
	jobsStartedBy: defineMessage({
		id: 'administration.operations.jobs.started.by',
		defaultMessage: 'Started by {name}',
		description: 'Under a job: who started it.'
	}),
	jobsStillRunning: defineMessage({
		id: 'administration.operations.jobs.still.running',
		defaultMessage: 'Running',
		description: 'In the Took column: the job hasn’t finished.'
	}),
	jobsNotStarted: defineMessage({
		id: 'administration.operations.jobs.not.started',
		defaultMessage: 'Not yet',
		description: 'In the Started column: the job is waiting to run.'
	}),
	jobsCancelShort: defineMessage({
		id: 'administration.operations.jobs.cancel.short',
		defaultMessage: 'Cancel',
		description: 'A job row’s button that asks to stop it.'
	}),
	durationSeconds: defineMessage({
		id: 'administration.duration.seconds',
		defaultMessage: '{count} s',
		description: 'A short duration in seconds, as in "48 s".'
	}),
	durationMinutes: defineMessage({
		id: 'administration.duration.minutes',
		defaultMessage: '{count} min',
		description: 'A short duration in minutes, as in "4 min".'
	}),
	durationHours: defineMessage({
		id: 'administration.duration.hours',
		defaultMessage: '{count} h',
		description: 'A short duration in hours, as in "2 h".'
	}),
	jobTitle: defineMessage({
		id: 'administration.operations.job.title',
		defaultMessage: 'Job',
		description: 'Heading of one job’s page before it loads.'
	}),
	jobTrail: defineMessage({
		id: 'administration.operations.job.trail',
		defaultMessage: 'Jobs',
		description: 'The trail link from a job back to the Jobs list.'
	}),
	jobDescriptionBy: defineMessage({
		id: 'administration.operations.job.description.by',
		defaultMessage: 'Started by {name} {when} · {attempts}',
		description: 'Under a job’s heading; when reads like "today at 09:12".'
	}),
	jobDescription: defineMessage({
		id: 'administration.operations.job.description',
		defaultMessage: 'Started {when} · {attempts}',
		description: 'Under a job’s heading when who started it isn’t known.'
	}),
	jobAttemptsUsed: defineMessage({
		id: 'administration.operations.job.attempts.used',
		defaultMessage: 'Tried {attempt} of {maximum} times',
		description: 'Part of a job’s description: how many tries it used.'
	}),
	jobDetails: defineMessage({
		id: 'administration.operations.job.details',
		defaultMessage: 'Job',
		description: 'Section of a job’s facts.'
	}),
	jobKind: defineMessage({
		id: 'administration.operations.job.kind',
		defaultMessage: 'Job',
		description: 'Label of a job’s kind.'
	}),
	jobAbout: defineMessage({
		id: 'administration.operations.job.about',
		defaultMessage: 'About',
		description: 'Label of what a job works on.'
	}),
	jobStartedAt: defineMessage({
		id: 'administration.operations.job.started.at',
		defaultMessage: 'Started',
		description: 'Label of when a job started.'
	}),
	jobUpdatedAt: defineMessage({
		id: 'administration.operations.job.updated.at',
		defaultMessage: 'Last update',
		description: 'Label of when a job last changed.'
	}),
	jobProgressLabel: defineMessage({
		id: 'administration.operations.job.progress',
		defaultMessage: 'Got as far as',
		description: 'Label of a job’s progress.'
	}),
	jobLastError: defineMessage({
		id: 'administration.operations.job.last.error',
		defaultMessage: 'Last error',
		description: 'Label of why a job last failed.'
	}),
	jobNone: defineMessage({
		id: 'administration.operations.job.none',
		defaultMessage: '—',
		description: 'A job fact that has no value.'
	}),
	jobAttempts: defineMessage({
		id: 'administration.operations.job.attempts',
		defaultMessage: 'Attempts',
		description: 'Section of each time a job ran.'
	}),
	jobAttemptsDescription: defineMessage({
		id: 'administration.operations.job.attempts.description',
		defaultMessage:
			'Each attempt runs on its own; one that stalls is retried automatically until the limit. Retry starts again from where the job got to.',
		description: 'Explains a job’s attempts.'
	}),
	jobAttemptNumber: defineMessage({
		id: 'administration.operations.job.attempt.number',
		defaultMessage: 'Attempt',
		description: 'Column of an attempt’s number.'
	}),
	jobAttemptStarted: defineMessage({
		id: 'administration.operations.job.attempt.started',
		defaultMessage: 'Started',
		description: 'Column of when an attempt started.'
	}),
	jobAttemptEnded: defineMessage({
		id: 'administration.operations.job.attempt.ended',
		defaultMessage: 'Ended',
		description: 'Column of when an attempt ended.'
	}),
	jobAttemptOutcome: defineMessage({
		id: 'administration.operations.job.attempt.outcome',
		defaultMessage: 'Outcome',
		description: 'Column of how an attempt ended.'
	}),
	jobAttemptError: defineMessage({
		id: 'administration.operations.job.attempt.error',
		defaultMessage: 'Error',
		description: 'Column of why an attempt failed.'
	}),
	jobAttemptsEmpty: defineMessage({
		id: 'administration.operations.job.attempts.empty',
		defaultMessage: 'The job hasn’t run yet.',
		description: 'A job without attempts.'
	}),
	attemptRunning: defineMessage({
		id: 'administration.operations.attempt.running',
		defaultMessage: 'Running',
		description: 'An attempt that is still running.'
	}),
	attemptSucceeded: defineMessage({
		id: 'administration.operations.attempt.succeeded',
		defaultMessage: 'Done',
		description: 'An attempt that finished.'
	}),
	attemptFailed: defineMessage({
		id: 'administration.operations.attempt.failed',
		defaultMessage: 'Failed',
		description: 'An attempt that failed.'
	}),
	attemptCanceled: defineMessage({
		id: 'administration.operations.attempt.canceled',
		defaultMessage: 'Cancelled',
		description: 'An attempt that was cancelled.'
	}),
	attemptLeaseExpired: defineMessage({
		id: 'administration.operations.attempt.lease.expired',
		defaultMessage: 'Stalled',
		description: 'An attempt whose worker stopped answering, so its turn ran out.'
	}),
	attemptIncompatible: defineMessage({
		id: 'administration.operations.attempt.incompatible',
		defaultMessage: 'Couldn’t run',
		description: 'An attempt a worker couldn’t run because it was too old or too new.'
	}),
	mailColumnTo: defineMessage({
		id: 'administration.mail.column.to',
		defaultMessage: 'To',
		description: 'Column of who an email went to.'
	}),
	mailColumnKind: defineMessage({
		id: 'administration.mail.column.kind',
		defaultMessage: 'Email',
		description: 'Column of what kind of email it is.'
	}),
	mailOpen: defineMessage({
		id: 'administration.mail.open',
		defaultMessage: 'Details',
		description: 'Opens one delivery’s details.'
	}),
	deliveryTitleFor: defineMessage({
		id: 'administration.mail.delivery.titlefor',
		defaultMessage: '{kind} for {name}',
		description:
			'Title of one delivery’s details once the person is known, as in "Invitation for Rafael Silva".'
	}),
	deliveryTitle: defineMessage({
		id: 'administration.mail.delivery.title',
		defaultMessage: '{kind} to {recipient}',
		description: 'Title of one delivery’s details, as in "Invitation to r.s•••@example".'
	}),
	deliveryLoading: defineMessage({
		id: 'administration.mail.delivery.loading',
		defaultMessage: 'Loading this delivery…',
		description: 'While one delivery is read.'
	}),
	deliveryFor: defineMessage({
		id: 'administration.mail.delivery.for',
		defaultMessage: 'For',
		description: 'Label of the person an email is for.'
	}),
	deliveryKind: defineMessage({
		id: 'administration.mail.delivery.kind',
		defaultMessage: 'Email',
		description: 'Label of what kind of email it is.'
	}),
	deliveryStatus: defineMessage({
		id: 'administration.mail.delivery.status',
		defaultMessage: 'Status',
		description: 'Label of where a delivery stands.'
	}),
	deliveryStatusAttempt: defineMessage({
		id: 'administration.mail.delivery.status.attempts',
		defaultMessage: '{state} after {count} attempts',
		description:
			'A delivery’s state and how many tries, as in "Not delivered after 3 attempts".'
	}),
	deliveryQueued: defineMessage({
		id: 'administration.mail.delivery.queued',
		defaultMessage: 'Queued',
		description: 'Label of when an email was queued.'
	}),
	deliveryLastAttempt: defineMessage({
		id: 'administration.mail.delivery.last.attempt',
		defaultMessage: 'Last attempt',
		description: 'Label of the latest try to send it.'
	}),
	deliveryDelivered: defineMessage({
		id: 'administration.mail.delivery.delivered',
		defaultMessage: 'Delivered',
		description: 'Label of when the receiving server accepted it.'
	}),
	deliveryDeadline: defineMessage({
		id: 'administration.mail.delivery.deadline',
		defaultMessage: 'Stops trying',
		description: 'Label of when Proctor stops retrying an email.'
	}),
	deliveryMessageId: defineMessage({
		id: 'administration.mail.delivery.message.id',
		defaultMessage: 'Message ID',
		description: 'Label of the email’s message identifier.'
	}),
	deliveryHidden: defineMessage({
		id: 'administration.mail.delivery.hidden',
		defaultMessage: 'Addresses are partly hidden here.',
		description: 'Footnote of a delivery’s details.'
	}),
	deliveryClose: defineMessage({
		id: 'administration.mail.delivery.close',
		defaultMessage: 'Close',
		description: 'Closes a delivery’s details.'
	}),
	deliveryRetry: defineMessage({
		id: 'administration.mail.delivery.retry',
		defaultMessage: 'Retry delivery',
		description: 'Sends the email again.'
	}),
	deliveryCancel: defineMessage({
		id: 'administration.mail.delivery.cancel',
		defaultMessage: 'Cancel delivery',
		description: 'Stops sending the email.'
	}),
	deliveryNoProblem: defineMessage({
		id: 'administration.mail.delivery.no.problem',
		defaultMessage: 'Nothing went wrong with this email.',
		description: 'A delivery without a failure.'
	}),
	deliveryStatusAttemptOne: defineMessage({
		id: 'administration.mail.delivery.status.attempt.one',
		defaultMessage: '{state} after {count} attempt',
		description: 'A delivery’s state after a single try, as in "Delivered after 1 attempt".'
	})
});
