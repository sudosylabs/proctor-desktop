/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { defineMessage } from '../../../../base/common/localization.js';

/** Text of the Account Audits page. */
export const auditsMessages = Object.freeze({
	pageShownOpen: defineMessage({
		id: 'account.pager.shown.open',
		defaultMessage: 'Page {page}, items {first} to {last}',
		description: 'Announced after moving to another page when the number of pages is not known.'
	}),
	historyPeriodLabel: defineMessage({
		id: 'account.history.filter.period',
		defaultMessage: 'Period',
		description: 'Accessible name of the period filter.'
	}),
	historyPeriodDays: defineMessage({
		id: 'account.history.filter.period.days',
		defaultMessage: 'Last {days} days',
		description: 'Period filter option: the last number of days.'
	}),
	historyPeriodAll: defineMessage({
		id: 'account.history.filter.period.all',
		defaultMessage: 'All time',
		description: 'Period filter option: no time limit.'
	}),
	historyGroupLabel: defineMessage({
		id: 'account.history.filter.group',
		defaultMessage: 'Kind',
		description: 'Accessible name of the event-kind filter.'
	}),
	historyGroupAll: defineMessage({
		id: 'account.history.filter.group.all',
		defaultMessage: 'Any event',
		description: 'Event-kind filter option: every event.'
	}),
	historyGroupSignIn: defineMessage({
		id: 'account.history.filter.group.sign.in',
		defaultMessage: 'Sign-in and sessions',
		description: 'Event-kind filter option.'
	}),
	historyGroupSecurity: defineMessage({
		id: 'account.history.filter.group.security',
		defaultMessage: 'Password, two-step and email',
		description: 'Event-kind filter option.'
	}),
	historyGroupTokens: defineMessage({
		id: 'account.history.filter.group.tokens',
		defaultMessage: 'Access tokens',
		description: 'Event-kind filter option.'
	}),
	historyGroupProfile: defineMessage({
		id: 'account.history.filter.group.profile',
		defaultMessage: 'Profile',
		description: 'Event-kind filter option.'
	}),
	historyGroupMembership: defineMessage({
		id: 'account.history.filter.group.membership',
		defaultMessage: 'Classes, units and roles',
		description: 'Event-kind filter option.'
	}),
	historyGroupStatus: defineMessage({
		id: 'account.history.filter.group.status',
		defaultMessage: 'Account on or off',
		description: 'Event-kind filter option.'
	}),
	historyRelationLabel: defineMessage({
		id: 'account.history.filter.relation',
		defaultMessage: 'About',
		description: 'Accessible name of the subject filter.'
	}),
	historyRelationAll: defineMessage({
		id: 'account.history.filter.relation.all',
		defaultMessage: 'Anything',
		description: 'Subject filter option: every event.'
	}),
	historyRelationSubject: defineMessage({
		id: 'account.history.filter.relation.subject',
		defaultMessage: 'Your account',
		description: 'Subject filter option: events about the account.'
	}),
	historyRelationActor: defineMessage({
		id: 'account.history.filter.relation.actor',
		defaultMessage: 'What you did elsewhere',
		description: 'Subject filter option: events the person performed on something else.'
	}),
	historyOutcomeLabel: defineMessage({
		id: 'account.history.filter.outcome',
		defaultMessage: 'Outcome',
		description: 'Accessible name of the outcome filter.'
	}),
	historyOutcomeAll: defineMessage({
		id: 'account.history.filter.outcome.all',
		defaultMessage: 'Any',
		description: 'Outcome filter option: every event.'
	}),
	historyOutcomeSuccess: defineMessage({
		id: 'account.history.filter.outcome.success',
		defaultMessage: 'Succeeded',
		description: 'Outcome filter option.'
	}),
	historyOutcomeFail: defineMessage({
		id: 'account.history.filter.outcome.fail',
		defaultMessage: 'Failed',
		description: 'Outcome filter option.'
	}),
	historyWhen: defineMessage({
		id: 'account.history.column.when',
		defaultMessage: 'When',
		description: 'Account history column heading.'
	}),
	historyWhat: defineMessage({
		id: 'account.history.column.what',
		defaultMessage: 'Event',
		description: 'Account history column heading.'
	}),
	historyBy: defineMessage({
		id: 'account.history.column.by',
		defaultMessage: 'By',
		description: 'Account history column heading.'
	}),
	historyWhere: defineMessage({
		id: 'account.history.column.where',
		defaultMessage: 'Where',
		description: 'Account history column heading.'
	}),
	historyFailed: defineMessage({
		id: 'account.history.failed',
		defaultMessage: 'Did not succeed',
		description: 'The event failed.'
	}),
	historyAboutElsewhere: defineMessage({
		id: 'account.history.about.elsewhere',
		defaultMessage: 'Something you did outside your account',
		description: 'The event is one the person performed on something else.'
	}),
	historyWhereUnknown: defineMessage({
		id: 'account.history.where.unknown',
		defaultMessage: 'Not recorded',
		description: 'Where the event came from is unknown.'
	}),
	historyEmpty: defineMessage({
		id: 'account.history.empty',
		defaultMessage: 'Nothing happened with your account in this period.',
		description: 'No events match the filters.'
	})
});
