/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { defineMessage } from '../../../../base/common/localization.js';

/** Text of the Account history page. */
export const historyMessages = Object.freeze({
	historyFilters: defineMessage({
		id: 'account.history.filters',
		defaultMessage: 'Filter the history',
		description: 'Accessible name of the row of Account history filters.'
	}),
	historyPeriodLabel: defineMessage({
		id: 'account.history.filter.period',
		defaultMessage: 'Period',
		description: 'Account history filter: how far back to look.'
	}),
	historyPeriodWeek: defineMessage({
		id: 'account.history.filter.period.week',
		defaultMessage: 'Last 7 days',
		description: 'Period choice: the last week.'
	}),
	historyPeriodMonth: defineMessage({
		id: 'account.history.filter.period.month',
		defaultMessage: 'Last 30 days',
		description: 'Period choice: the last month.'
	}),
	historyPeriodHalfYear: defineMessage({
		id: 'account.history.filter.period.half.year',
		defaultMessage: 'Last 6 months',
		description: 'Period choice: the last half year, the default.'
	}),
	historyPeriodYear: defineMessage({
		id: 'account.history.filter.period.year',
		defaultMessage: 'Last 12 months',
		description: 'Period choice: the last year.'
	}),
	historyPeriodAll: defineMessage({
		id: 'account.history.filter.period.all',
		defaultMessage: 'All time',
		description: 'Period choice: the whole history.'
	}),
	historyKindLabel: defineMessage({
		id: 'account.history.filter.kind',
		defaultMessage: 'Kind',
		description: 'Account history filter: what kind of change.'
	}),
	historyKindAll: defineMessage({
		id: 'account.history.filter.kind.all',
		defaultMessage: 'Any change',
		description: 'Kind choice: every kind of change.'
	}),
	historyKindFailed: defineMessage({
		id: 'account.history.filter.kind.failed',
		defaultMessage: 'Failed attempts',
		description: 'Kind choice: only attempts that did not succeed, such as a wrong password.'
	}),
	historyGroupSignIn: defineMessage({
		id: 'account.history.filter.group.sign.in',
		defaultMessage: 'Sign-in and sessions',
		description: 'Kind choice: signing in and out, and sessions.'
	}),
	historyGroupSecurity: defineMessage({
		id: 'account.history.filter.group.security',
		defaultMessage: 'Password, two-step and email',
		description: 'Kind choice: what protects the account.'
	}),
	historyGroupTokens: defineMessage({
		id: 'account.history.filter.group.tokens',
		defaultMessage: 'Access tokens',
		description: 'Kind choice: access tokens.'
	}),
	historyGroupProfile: defineMessage({
		id: 'account.history.filter.group.profile',
		defaultMessage: 'Profile',
		description: 'Kind choice: the profile and its photo.'
	}),
	historyGroupMembership: defineMessage({
		id: 'account.history.filter.group.membership',
		defaultMessage: 'Classes, units and roles',
		description: 'Kind choice: memberships and roles.'
	}),
	historyGroupStatus: defineMessage({
		id: 'account.history.filter.group.status',
		defaultMessage: 'Account on or off',
		description: 'Kind choice: the account turned off or back on.'
	}),
	historyAboutLabel: defineMessage({
		id: 'account.history.filter.about',
		defaultMessage: 'About',
		description: 'Account history filter: changes to your account, or what you did elsewhere.'
	}),
	historyAboutAll: defineMessage({
		id: 'account.history.filter.about.all',
		defaultMessage: 'Anything',
		description: 'About choice: everything.'
	}),
	historyAboutSubject: defineMessage({
		id: 'account.history.filter.about.subject',
		defaultMessage: 'Your account',
		description: 'About choice: changes made to your own account.'
	}),
	historyAboutActor: defineMessage({
		id: 'account.history.filter.about.actor',
		defaultMessage: 'What you did elsewhere',
		description: 'About choice: changes you made to anything else.'
	}),
	historyWhat: defineMessage({
		id: 'account.history.column.what',
		defaultMessage: 'What happened',
		description: 'Header of the Account history column with one sentence per change.'
	}),
	historyWhere: defineMessage({
		id: 'account.history.column.where',
		defaultMessage: 'Where',
		description: 'Header of the Account history column: what it was done from.'
	}),
	historyWhen: defineMessage({
		id: 'account.history.column.when',
		defaultMessage: 'When',
		description: 'Header of the Account history column with the time, and its sort button.'
	}),
	historySortNewest: defineMessage({
		id: 'account.history.sort.newest',
		defaultMessage: 'When, newest first. Show oldest first',
		description: 'Accessible name of the When sort button while newest is first.'
	}),
	historySortOldest: defineMessage({
		id: 'account.history.sort.oldest',
		defaultMessage: 'When, oldest first. Show newest first',
		description: 'Accessible name of the When sort button while oldest is first.'
	}),
	historyFailed: defineMessage({
		id: 'account.history.failed',
		defaultMessage: 'Did not succeed',
		description: 'Note under a change that was attempted and failed.'
	}),
	historyWhereUnknown: defineMessage({
		id: 'account.history.where.unknown',
		defaultMessage: '—',
		description: 'The Where cell when nothing is recorded about it.'
	}),
	historyEmpty: defineMessage({
		id: 'account.history.empty',
		defaultMessage: 'Nothing happened with your account in this period.',
		description: 'The history filters match nothing.'
	}),
	historyFoldedNote: defineMessage({
		id: 'account.history.folded.note',
		defaultMessage: 'The same change {count} times in a row',
		description: 'Under a row that stands for a run of the same change.'
	}),
	historyShowAll: defineMessage({
		id: 'account.history.show.all',
		defaultMessage: 'Show all {count}',
		description: 'Opens a folded run of the same change in place.'
	}),
	historyShowFewer: defineMessage({
		id: 'account.history.show.fewer',
		defaultMessage: 'Show fewer',
		description: 'Folds an opened run of the same change again.'
	}),
	historyRange: defineMessage({
		id: 'account.history.range',
		defaultMessage: 'Showing {first}–{last} of {total}',
		description: 'The history pager: which changes the page shows, of how many.'
	}),
	historyRangeAtLeast: defineMessage({
		id: 'account.history.range.at.least',
		defaultMessage: 'Showing {first}–{last} of {total}+',
		description: 'The history pager when the count stopped at its ceiling.'
	}),
	historyRangeOpen: defineMessage({
		id: 'account.history.range.open',
		defaultMessage: 'Showing {first}–{last}',
		description: 'The history pager when the total is not known.'
	}),
	historyPageShown: defineMessage({
		id: 'account.history.page.shown',
		defaultMessage: 'Showing {first} to {last}',
		description: 'Announced once after moving to another page of the history.'
	}),
	historyGoToDate: defineMessage({
		id: 'account.history.go.to.date',
		defaultMessage: 'Go to a date',
		description: 'Opens a dialog to show the history up to a chosen day.'
	}),
	historyGoToDateUntil: defineMessage({
		id: 'account.history.go.to.date.until',
		defaultMessage: 'Up to {date}',
		description: 'The Go to a date button once a date is chosen.'
	}),
	historyGoToDateTitle: defineMessage({
		id: 'account.history.go.to.date.title',
		defaultMessage: 'Go to a date',
		description: 'Title of the Go to a date dialog.'
	}),
	historyGoToDateDescription: defineMessage({
		id: 'account.history.go.to.date.description',
		defaultMessage:
			'Shows what happened on that day and before it, with the filters you chose.',
		description: 'One line under the Go to a date title.'
	}),
	historyGoToDateField: defineMessage({
		id: 'account.history.go.to.date.field',
		defaultMessage: 'Day',
		description: 'Label of the date field in Go to a date.'
	}),
	historyGoToDateAction: defineMessage({
		id: 'account.history.go.to.date.action',
		defaultMessage: 'Go to date',
		description: 'Shows the history up to the chosen day.'
	}),
	historyGoToLatest: defineMessage({
		id: 'account.history.go.to.latest',
		defaultMessage: 'Show the latest',
		description: 'Leaves the chosen day and shows the newest changes again.'
	})
});
