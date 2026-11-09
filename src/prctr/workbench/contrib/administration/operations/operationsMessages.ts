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
	jobsAny: defineMessage({
		id: 'administration.operations.jobs.any',
		defaultMessage: 'Any',
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
		defaultMessage: 'No jobs yet.',
		description: 'Shown when there are no jobs.'
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
		defaultMessage: 'Cancel…',
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
	mailHealth: defineMessage({
		id: 'administration.operations.mail.health',
		defaultMessage: 'Delivery',
		description: 'Section with mail health.'
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
		defaultMessage: 'Send test email',
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
		defaultMessage: 'Any',
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
		defaultMessage: 'No deliveries yet.',
		description: 'Shown when there are no deliveries.'
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
		defaultMessage: 'Retire…',
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
	mailKeysStrong: defineMessage({
		id: 'administration.operations.mail.keys.strong',
		defaultMessage: 'Keys are shown to a sign-in with two-step verification only.',
		description: 'Shown when keys need a stronger sign-in.'
	})
});
