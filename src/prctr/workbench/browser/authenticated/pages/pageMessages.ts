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
	staleSince: defineMessage({
		id: 'page.state.stale.since',
		defaultMessage:
			'Showing what Proctor last read {when}. It refreshes when the server answers again.',
		description:
			'Note above a list the server couldn\'t refresh; when is a time such as "today, 09:12".'
	}),
	staleSinceNamed: defineMessage({
		id: 'page.state.stale.since.named',
		defaultMessage:
			'Showing what Proctor last read {when}. It refreshes when {institution} answers again.',
		description: "Note above a list the server couldn't refresh, naming the institution."
	}),
	staleData: defineMessage({
		id: 'page.state.stale',
		defaultMessage: 'This couldn’t be refreshed, so it may be out of date. {reason}',
		description: 'A refresh failed; earlier information stays shown.'
	}),
	closeDialog: defineMessage({
		id: 'page.dialog.close',
		defaultMessage: 'Close',
		description: 'The × button in a dialog’s header, which closes it without changing anything.'
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
	fieldRequired: defineMessage({
		id: 'page.field.required',
		defaultMessage: 'This is required.',
		description: 'Shown under a required form field left empty.'
	}),
	fieldRefused: defineMessage({
		id: 'page.field.refused',
		defaultMessage: 'The server didn’t accept this. Check it and try again.',
		description: 'Shown under a form field the server refused.'
	}),
	cancel: defineMessage({
		id: 'page.action.cancel',
		defaultMessage: 'Cancel',
		description: 'Close a dialog without changing anything.'
	}),
	undo: defineMessage({
		id: 'page.action.undo',
		defaultMessage: 'Undo',
		description: 'Takes back the change a toast reports, such as disabling an account.'
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
	pageShownOpen: defineMessage({
		id: 'page.pager.shown.open',
		defaultMessage: 'Page {page}, items {first} to {last}',
		description: 'Announced after moving to another page when the number of pages is not known.'
	}),
	pageTrail: defineMessage({
		id: 'page.trail',
		defaultMessage: 'Breadcrumb',
		description: 'Accessible name of the trail of pages above a record’s page.'
	}),
	fewerChips: defineMessage({
		id: 'page.row.chips.fewer',
		defaultMessage: 'Show fewer',
		description: 'Folds the labels a row opened in place back behind "N more".'
	}),
	moreChips: defineMessage({
		id: 'page.row.chips.more',
		defaultMessage: 'and {count} more',
		description: 'Opens the labels not shown in the row, such as "7 more".'
	}),
	confirmItsYouTitle: defineMessage({
		id: 'page.confirm.title',
		defaultMessage: 'Confirm it’s you',
		description:
			'Title of the dialog asking the person to sign in again before a guarded change.'
	}),
	confirmItsYouBody: defineMessage({
		id: 'page.confirm.body',
		defaultMessage: '{institution} asks you to sign in again before this change.',
		description: 'First sentence of Confirm it’s you; {institution} is the institution’s name.'
	}),
	confirmItsYouBodyGeneric: defineMessage({
		id: 'page.confirm.body.generic',
		defaultMessage: 'Your institution asks you to sign in again before this change.',
		description: 'First sentence of Confirm it’s you when the institution’s name is unknown.'
	}),
	confirmItsYouStep: defineMessage({
		id: 'page.confirm.step',
		defaultMessage: 'It opens in your browser.',
		description: 'Second sentence of Confirm it’s you when the sign-in method is unknown.'
	}),
	confirmItsYouStepPassword: defineMessage({
		id: 'page.confirm.step.password',
		defaultMessage: 'It opens in your browser: sign in with your password.',
		description: 'Second sentence of Confirm it’s you for a password sign-in.'
	}),
	confirmItsYouStepPasswordCode: defineMessage({
		id: 'page.confirm.step.password.code',
		defaultMessage:
			'It opens in your browser: sign in with your password, then enter the code from your authenticator app.',
		description:
			'Second sentence of Confirm it’s you for a password sign-in that hasn’t used two-step verification yet.'
	}),
	confirmItsYouStepProvider: defineMessage({
		id: 'page.confirm.step.provider',
		defaultMessage: 'It opens in your browser: sign in with single sign-on.',
		description:
			'Second sentence of Confirm it’s you for a single sign-on (CAS or OpenID Connect).'
	}),
	confirmItsYouStepProviderCode: defineMessage({
		id: 'page.confirm.step.provider.code',
		defaultMessage:
			'It opens in your browser: sign in with single sign-on, then enter the code from your authenticator app.',
		description:
			'Second sentence of Confirm it’s you for a single sign-on that hasn’t used two-step verification yet.'
	}),
	confirmItsYouDone: defineMessage({
		id: 'page.confirm.done',
		defaultMessage: 'The change is made as soon as you’re back.',
		description: 'Last sentence of Confirm it’s you.'
	}),
	confirmItsYouFootnote: defineMessage({
		id: 'page.confirm.footnote',
		defaultMessage: 'The page in your browser stays open for 5 minutes.',
		description: 'Note under Confirm it’s you, before the browser step starts.'
	}),
	confirmItsYouStopNote: defineMessage({
		id: 'page.confirm.stop',
		defaultMessage: 'Cancel stops the browser step. Nothing has changed yet.',
		description: 'Note under Confirm it’s you while the browser step is open.'
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
	}),
	twoStepNeededTitle: defineMessage({
		id: 'page.twostep.needed.title',
		defaultMessage: 'Turn on two-step verification first',
		description:
			'Title of the dialog shown when a change needs a two-step sign-in and the account has no two-step verification.'
	}),
	twoStepNeededBody: defineMessage({
		id: 'page.twostep.needed.body',
		defaultMessage:
			'This change needs your own sign-in to use two-step verification, and your account doesn’t have two-step verification yet.',
		description: 'Why the change can’t be made yet.'
	}),
	twoStepNeededFirstLabel: defineMessage({
		id: 'page.twostep.needed.first.label',
		defaultMessage: 'First',
		description: 'Label of the first of two steps.'
	}),
	twoStepNeededFirst: defineMessage({
		id: 'page.twostep.needed.first',
		defaultMessage: 'Turn it on, on {institution}’s security page in your browser.',
		description: 'The first step; {institution} is the institution’s name.'
	}),
	twoStepNeededFirstGeneric: defineMessage({
		id: 'page.twostep.needed.first.generic',
		defaultMessage: 'Turn it on, on your institution’s security page in your browser.',
		description: 'The first step, when the institution’s name is unknown.'
	}),
	twoStepNeededThenLabel: defineMessage({
		id: 'page.twostep.needed.then.label',
		defaultMessage: 'Then',
		description: 'Label of the second of two steps.'
	}),
	twoStepNeededThen: defineMessage({
		id: 'page.twostep.needed.then',
		defaultMessage:
			'Come back here and confirm it’s you with the new code. The change opens then.',
		description: 'The second step.'
	}),
	twoStepNeededOpen: defineMessage({
		id: 'page.twostep.needed.open',
		defaultMessage: 'Open security page',
		description: 'Opens the institution’s security page in the system browser.'
	}),
	twoStepUnavailableTitle: defineMessage({
		id: 'page.twostep.unavailable.title',
		defaultMessage: 'This change isn’t available here',
		description:
			'Title of the dialog shown when a change needs two-step verification and the installation doesn’t offer it.'
	}),
	twoStepUnavailableBody: defineMessage({
		id: 'page.twostep.unavailable.body',
		defaultMessage:
			'This change needs a sign-in that used two-step verification, and {institution}’s Proctor doesn’t offer it.',
		description: 'Why the change can’t be made; {institution} is the institution’s name.'
	}),
	twoStepUnavailableBodyGeneric: defineMessage({
		id: 'page.twostep.unavailable.body.generic',
		defaultMessage:
			'This change needs a sign-in that used two-step verification, and your institution’s Proctor doesn’t offer it.',
		description: 'Why the change can’t be made, when the institution’s name is unknown.'
	}),
	twoStepUnavailableNote: defineMessage({
		id: 'page.twostep.unavailable.note',
		defaultMessage:
			'The people who run Proctor for {institution} can turn two-step verification on. Until then, nobody can make this change.',
		description: 'Who can fix it; {institution} is the institution’s name.'
	}),
	twoStepUnavailableNoteGeneric: defineMessage({
		id: 'page.twostep.unavailable.note.generic',
		defaultMessage:
			'The people who run Proctor for your institution can turn two-step verification on. Until then, nobody can make this change.',
		description: 'Who can fix it, when the institution’s name is unknown.'
	}),
	twoStepLockLabel: defineMessage({
		id: 'page.twostep.lock',
		defaultMessage: '{label}, needs two-step verification on your account',
		description:
			'Accessible name of an action marked with a lock; {label} is the action’s own label.'
	}),
	twoStepLockTitle: defineMessage({
		id: 'page.twostep.lock.title',
		defaultMessage: 'Needs two-step verification on your account',
		description: 'Tooltip of the lock after an action’s label.'
	})
});

export type PageMessage = keyof typeof pageMessages;
