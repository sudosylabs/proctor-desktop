/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { defineMessage } from '../../../../base/common/localization.js';

/** Text of the Administration Overview page. */
export const overviewMessages = Object.freeze({
	overviewAttention: defineMessage({
		id: 'administration.overview.attention',
		defaultMessage: 'Needs attention',
		description: 'Section listing what an administrator should look at.'
	}),
	overviewAllClear: defineMessage({
		id: 'administration.overview.all.clear',
		defaultMessage: 'Nothing needs your attention right now.',
		description: 'Shown when nothing needs attention.'
	}),
	overviewJobsFailedOne: defineMessage({
		id: 'administration.overview.jobs.failed.one',
		defaultMessage: 'A job failed',
		description: 'Attention item: one background job failed.'
	}),
	overviewJobsFailed: defineMessage({
		id: 'administration.overview.jobs.failed',
		defaultMessage: '{count} jobs failed',
		description: 'Attention item: several jobs failed; count may read “10 or more”.'
	}),
	overviewJobsDetail: defineMessage({
		id: 'administration.overview.jobs.detail',
		defaultMessage: 'Last failure {when}',
		description: 'Detail of the failed jobs item.'
	}),
	overviewOpenJobs: defineMessage({
		id: 'administration.overview.jobs.open',
		defaultMessage: 'Open jobs',
		description: 'Opens Jobs.'
	}),
	overviewMailFailedOne: defineMessage({
		id: 'administration.overview.mail.failed.one',
		defaultMessage: 'An email couldn’t be delivered',
		description: 'Attention item: one email failed.'
	}),
	overviewMailFailed: defineMessage({
		id: 'administration.overview.mail.failed',
		defaultMessage: '{count} emails couldn’t be delivered',
		description: 'Attention item: several emails failed.'
	}),
	overviewMailDetail: defineMessage({
		id: 'administration.overview.mail.detail',
		defaultMessage: 'Most recent to {recipient}',
		description: 'Detail of the failed mail item.'
	}),
	overviewOpenMail: defineMessage({
		id: 'administration.overview.mail.open',
		defaultMessage: 'Open mail',
		description: 'Opens Mail.'
	}),
	overviewInvitationsOne: defineMessage({
		id: 'administration.overview.invitations.one',
		defaultMessage: 'An invitation is waiting to be accepted',
		description: 'Attention item: one pending invitation.'
	}),
	overviewInvitations: defineMessage({
		id: 'administration.overview.invitations',
		defaultMessage: '{count} invitations are waiting to be accepted',
		description: 'Attention item: several pending invitations.'
	}),
	overviewInvitationsDetail: defineMessage({
		id: 'administration.overview.invitations.detail',
		defaultMessage: 'The next expires {when}',
		description: 'Detail of the pending invitations item.'
	}),
	overviewOpenInvitations: defineMessage({
		id: 'administration.overview.invitations.open',
		defaultMessage: 'Open invitations',
		description: 'Opens Invitations.'
	}),
	overviewCleanupPaused: defineMessage({
		id: 'administration.overview.cleanup.paused',
		defaultMessage: 'Record cleanup is paused',
		description: 'Attention item: automatic deletion is paused.'
	}),
	overviewCleanupDetail: defineMessage({
		id: 'administration.overview.cleanup.detail',
		defaultMessage: 'Records past their retention period wait until cleanup resumes.',
		description: 'Detail of the paused cleanup item.'
	}),
	overviewOpenRetention: defineMessage({
		id: 'administration.overview.retention.open',
		defaultMessage: 'Review cleanup',
		description: 'Opens Data retention.'
	}),
	overviewMany: defineMessage({
		id: 'administration.overview.many',
		defaultMessage: '10 or more',
		description: 'A count the server stops at; used inside other messages.'
	}),
	overviewRecent: defineMessage({
		id: 'administration.overview.recent',
		defaultMessage: 'Recent administrative changes',
		description: 'Section with the latest audit events.'
	}),
	overviewRecentEmpty: defineMessage({
		id: 'administration.overview.recent.empty',
		defaultMessage: 'No changes yet.',
		description: 'Shown when there are no audit events.'
	}),
	overviewOpenAudits: defineMessage({
		id: 'administration.overview.audits.open',
		defaultMessage: 'Open audits',
		description: 'Opens Audits.'
	}),
	overviewSucceeded: defineMessage({
		id: 'administration.overview.succeeded',
		defaultMessage: 'Done',
		description: 'A change that succeeded.'
	}),
	overviewRefused: defineMessage({
		id: 'administration.overview.refused',
		defaultMessage: 'Refused',
		description: 'A change that was refused or failed.'
	})
});
