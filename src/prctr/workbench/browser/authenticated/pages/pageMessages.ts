/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { defineMessage } from '../../../../base/common/localization.js';

/** Text every AuthenticatedWindow page shares: read states, lists, pagers and confirmation. */
export const pageMessages = Object.freeze({
	loading: defineMessage({
		id: 'page.state.loading',
		defaultMessage: 'Loading…',
		description: 'A section is reading its information from the server.'
	}),
	stillWaiting: defineMessage({
		id: 'page.state.still.waiting',
		defaultMessage: 'Still waiting for {institution}…',
		description: 'A read is slow; institution is the server’s name.'
	}),
	stillWaitingGeneric: defineMessage({
		id: 'page.state.still.waiting.generic',
		defaultMessage: 'Still waiting for the server…',
		description: 'A read is slow and the institution name is unknown.'
	}),
	loadFailed: defineMessage({
		id: 'page.state.load.failed',
		defaultMessage: 'This couldn’t be loaded. {reason}',
		description: 'A section read failed and nothing is shown; reason explains why.'
	}),
	staleData: defineMessage({
		id: 'page.state.stale',
		defaultMessage: 'This couldn’t be refreshed, so it may be out of date. {reason}',
		description: 'A refresh failed; earlier information stays shown.'
	}),
	retry: defineMessage({
		id: 'page.state.retry',
		defaultMessage: 'Try again',
		description: 'Retry reading a section.'
	}),
	busy: defineMessage({
		id: 'page.state.busy',
		defaultMessage: 'Another change is being applied. Try again when it finishes.',
		description: 'Account changes run one at a time.'
	}),
	cancel: defineMessage({
		id: 'page.action.cancel',
		defaultMessage: 'Cancel',
		description: 'Close a dialog without changing anything.'
	}),
	dismiss: defineMessage({
		id: 'page.dismiss',
		defaultMessage: 'Dismiss',
		description: 'Closes a toast.'
	}),
	relativeToday: defineMessage({
		id: 'page.time.today',
		defaultMessage: 'today, {time}',
		description: 'A time earlier today, as in "last active today, 08:41".'
	}),
	relativeYesterday: defineMessage({
		id: 'page.time.yesterday',
		defaultMessage: 'yesterday, {time}',
		description: 'A time yesterday, as in "last active yesterday, 17:20".'
	}),
	relativeTodayStandalone: defineMessage({
		id: 'page.time.today.standalone',
		defaultMessage: 'Today, {time}',
		description: 'A time earlier today, shown on its own in a table cell.'
	}),
	relativeYesterdayStandalone: defineMessage({
		id: 'page.time.yesterday.standalone',
		defaultMessage: 'Yesterday, {time}',
		description: 'A time yesterday, shown on its own in a table cell.'
	}),
	detailSeparator: defineMessage({
		id: 'page.detail.separator',
		defaultMessage: '{first} · {second}',
		description: 'Joins two parts of a row description.'
	}),
	rowActions: defineMessage({
		id: 'page.row.actions',
		defaultMessage: 'Actions for {name}',
		description: 'Accessible name of a row’s actions menu button and menu.'
	}),
	pagerName: defineMessage({
		id: 'page.pager.name',
		defaultMessage: '{list} pages',
		description: 'Accessible name of a list\'s pager, such as "Active pages".'
	}),
	pagerPrevious: defineMessage({
		id: 'page.pager.previous',
		defaultMessage: 'Previous',
		description: 'Goes to the previous page of a list.'
	}),
	pagerNext: defineMessage({
		id: 'page.pager.next',
		defaultMessage: 'Next',
		description: 'Goes to the next page of a list.'
	}),
	pagerPage: defineMessage({
		id: 'page.pager.page',
		defaultMessage: 'Page {page}',
		description: 'Accessible name of one numbered page button.'
	}),
	pagerRange: defineMessage({
		id: 'page.pager.range',
		defaultMessage: '{first}–{last} of {total}',
		description: 'Which items a page shows, as in "11–20 of 248".'
	}),
	pagerRangeAtLeast: defineMessage({
		id: 'page.pager.range.at.least',
		defaultMessage: '{first}–{last} of {total}+',
		description:
			'Which items a page shows when the count stopped at its ceiling, as in "11–20 of 10,000+".'
	}),
	pagerRangeOpen: defineMessage({
		id: 'page.pager.range.open',
		defaultMessage: '{first}–{last}',
		description: 'Which items a page shows when the total is not known.'
	}),
	pagerCompact: defineMessage({
		id: 'page.pager.compact',
		defaultMessage: 'Page {page} of {count}',
		description: 'The pager\'s narrow form, as in "Page 12 of 25".'
	}),
	pagerCompactOpen: defineMessage({
		id: 'page.pager.compact.open',
		defaultMessage: 'Page {page}',
		description: "The pager's narrow form when the number of pages is not known."
	}),
	pageShown: defineMessage({
		id: 'page.pager.shown',
		defaultMessage: 'Page {page} of {count}, items {first} to {last}',
		description: 'Announced after moving to another page of a list.'
	}),
	moreChips: defineMessage({
		id: 'page.row.chips.more',
		defaultMessage: '+{count}',
		description: 'A chip standing for the labels not shown, such as "+7".'
	}),
	moreChipsLabel: defineMessage({
		id: 'page.row.chips.more.label',
		defaultMessage: '{count} more: {names}',
		description: 'Accessible name of the "+N" chip; {names} lists what it stands for.'
	}),
	confirmItsYouTitle: defineMessage({
		id: 'page.confirm.title',
		defaultMessage: 'Confirm it’s you',
		description:
			'Title of the dialog asking the person to sign in again before a guarded change.'
	}),
	confirmItsYouBody: defineMessage({
		id: 'page.confirm.body',
		defaultMessage:
			'{institution} asks you to sign in again before this change. It opens in your browser, and Proctor continues as soon as you’re back.',
		description: 'Why the person must sign in again; {institution} is the institution’s name.'
	}),
	confirmItsYouBodyGeneric: defineMessage({
		id: 'page.confirm.body.generic',
		defaultMessage:
			'Your institution asks you to sign in again before this change. It opens in your browser, and Proctor continues as soon as you’re back.',
		description: 'Why the person must sign in again, when the institution’s name is unknown.'
	}),
	confirmItsYouContinue: defineMessage({
		id: 'page.confirm.continue',
		defaultMessage: 'Continue in browser',
		description: 'Opens the institution’s sign-in page in the system browser.'
	}),
	confirmItsYouWaitingButton: defineMessage({
		id: 'page.confirm.waiting.button',
		defaultMessage: 'Waiting for your browser…',
		description: 'The Continue button while the browser step is open.'
	}),
	confirmItsYouWaiting: defineMessage({
		id: 'page.confirm.waiting',
		defaultMessage: 'Finish in your browser. This continues by itself when you’re done.',
		description: 'Shown while the person signs in again in the browser.'
	})
});

export type PageMessage = keyof typeof pageMessages;
