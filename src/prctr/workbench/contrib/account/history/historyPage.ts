/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { IAccountService } from '../../../services/account/common/account.js';
import { IAccountFormatService } from '../accountFormat.js';
import { IPagePaneContext } from '../../../browser/authenticated/pages/pagePaneContext.js';
import { createElementFactory } from '../../../../base/browser/documentElements.js';
import { addDisposableListener } from '../../../../base/browser/dom.js';
import { ButtonControl } from '../../../../base/browser/ui/button/buttonControl.js';
import { PagerControl } from '../../../../base/browser/ui/pager/pagerControl.js';
import {
	Disposable,
	DisposableStore,
	MutableDisposable
} from '../../../../base/common/lifecycle.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import {
	ACCOUNT_HISTORY_PAGE_SIZE,
	type AccountFailure,
	type AccountHistoryEntry,
	type AccountResponse
} from '../../../../platform/account/common/accountProtocol.js';
import {
	createProctorIcon,
	proctorIconFactory
} from '../../../../platform/theme/browser/proctorIcon.js';
import type { ProctorIconId } from '../../../../platform/theme/common/proctorIcons.js';
import {
	clientKind,
	defaultHistoryFilters,
	foldHistory,
	historyEventGroups,
	historyPeriods,
	historyQuery,
	type HistoryEventGroup,
	type HistoryFilters,
	type HistoryPeriod,
	type HistoryRun
} from '../common/accountPresentation.js';
import type { AccountMessage } from '../accountMessages.js';
import type { PageView } from '../../../browser/authenticated/pages/pagePane.js';
import { PageDialog } from '../../../browser/authenticated/pages/pageDialog.js';
import { PageSection } from '../../../browser/authenticated/pages/pageSection.js';
import './media/historyPage.css';
import './media/goToDateDialog.css';

const groupMessages: Readonly<Record<HistoryEventGroup, AccountMessage>> = Object.freeze({
	signIn: 'historyGroupSignIn',
	security: 'historyGroupSecurity',
	tokens: 'historyGroupTokens',
	profile: 'historyGroupProfile',
	membership: 'historyGroupMembership',
	status: 'historyGroupStatus'
});

const periodMessages: Readonly<Record<string, AccountMessage>> = Object.freeze({
	'7': 'historyPeriodWeek',
	'30': 'historyPeriodMonth',
	'182': 'historyPeriodHalfYear',
	'365': 'historyPeriodYear',
	all: 'historyPeriodAll'
});

/** A read that has not answered in this time has failed; the person can try again. */
const READ_DEADLINE_MS = 15_000;
/** After this long a loading page says it is still waiting. */
const SLOW_MS = 3_000;

/**
 * Account history: one sentence per change, as the server writes it, naming who did what to
 * whom; an administrator is "An administrator", never named. Filters choose the period, the
 * kind of change and what it was about; the When header turns the order round, and Go to a
 * date shows the changes up to a chosen day. The server pages by cursor and counts on the first
 * page, so the pager says "Showing 1–10 of 248" with Previous and Next and no page numbers.
 * Adjacent rows of the same change fold into one row on the page, which opens in place.
 */
export class HistoryPage extends Disposable implements PageView {
	private readonly period: HTMLSelectElement;
	private readonly kind: HTMLSelectElement;
	private readonly about: HTMLSelectElement;
	private readonly section: PageSection;
	private readonly table: HTMLTableElement;
	private readonly rows: HTMLTableSectionElement;
	private readonly whenHeading: HTMLTableCellElement;
	private readonly sort: HTMLButtonElement;
	private readonly sortIcon;
	private readonly pager: PagerControl;
	private readonly goToDate: ButtonControl;
	private readonly rowStore = this._register(new DisposableStore());
	private readonly dialog = this._register(new MutableDisposable());
	private readonly slow = this._register(new MutableDisposable());

	private filters: HistoryFilters = defaultHistoryFilters;
	private entries: readonly AccountHistoryEntry[] = [];
	/** Runs of the same change the person opened, by their first entry. */
	private readonly opened = new Set<string>();
	/** The cursor that reads each page reached in this query; page 1 needs none. */
	private cursors: (string | undefined)[] = [undefined];
	private page = 1;
	private hasNext = false;
	private total: { readonly count: number; readonly atLeast: boolean } | undefined;
	private loadingPage = false;
	private sequence = 0;
	private loaded = false;

	constructor(
		body: HTMLElement,
		_headerActions: HTMLElement,
		@IAccountService private readonly account: IAccountService,
		@IAccountFormatService private readonly format: IAccountFormatService,
		@IPagePaneContext private readonly pane: IPagePaneContext,
		@IInstantiationService instantiationService: IInstantiationService
	) {
		super();
		const document = body.ownerDocument;
		const $ = createElementFactory(document);
		const select = (label: AccountMessage): HTMLSelectElement =>
			$('select.prctr-account-history__filter', {
				attrs: { 'aria-label': this.format.text(label) }
			});
		this.period = select('historyPeriodLabel');
		for (const period of historyPeriods)
			this.period.append(
				$('option', {
					value: String(period),
					selected: period === defaultHistoryFilters.period,
					textContent: this.format.text(periodMessages[String(period)]!)
				})
			);
		this.kind = select('historyKindLabel');
		this.kind.append(
			$('option', { value: 'all', textContent: this.format.text('historyKindAll') })
		);
		for (const group of historyEventGroups)
			this.kind.append(
				$('option', {
					value: group.id,
					textContent: this.format.text(groupMessages[group.id])
				})
			);
		this.kind.append(
			$('option', { value: 'failed', textContent: this.format.text('historyKindFailed') })
		);
		this.about = select('historyAboutLabel');
		for (const [value, label] of [
			['all', 'historyAboutAll'],
			['subject', 'historyAboutSubject'],
			['actor', 'historyAboutActor']
		] as const)
			this.about.append($('option', { value, textContent: this.format.text(label) }));
		const filters = $(
			'div.prctr-account-history__filters',
			{ attrs: { role: 'group', 'aria-label': this.format.text('historyFilters') } },
			this.picker(this.period, 'object.calendar', 'historyPeriodLabel'),
			this.picker(this.kind, 'action.filter', 'historyKindLabel'),
			this.picker(this.about, 'account.profile', 'historyAboutLabel')
		);
		body.append(filters);

		this.section = this._register(
			instantiationService.createInstance(PageSection, body, {
				title: '',
				skeleton: { kind: 'rows', count: 4 }
			})
		);
		this.section.element.classList.add('prctr-account-history');
		const heading = (label: AccountMessage, column: string): HTMLTableCellElement =>
			$('th.prctr-account-history__heading', {
				textContent: this.format.text(label),
				data: { column },
				attrs: { scope: 'col' }
			});
		this.sortIcon = this._register(
			createProctorIcon(document, { id: 'action.sortDescending', size: 14 })
		);
		this.sort = $(
			'button.prctr-account-history__sort',
			{ type: 'button' },
			$('span', { textContent: this.format.text('historyWhen') }),
			this.sortIcon.element
		);
		this.whenHeading = $(
			'th.prctr-account-history__heading',
			{ data: { column: 'when' }, attrs: { scope: 'col' } },
			this.sort
		);
		this.rows = $('tbody');
		this.table = $(
			'table.prctr-account-history__table',
			{ tabIndex: -1, attrs: { 'aria-label': this.format.text('historyTitle') } },
			$(
				'thead',
				{},
				$(
					'tr',
					{},
					heading('historyWhat', 'event'),
					heading('historyWhere', 'where'),
					this.whenHeading
				)
			),
			this.rows
		);
		this.section.content.append(this.table);

		const tools = $('span.prctr-account-history__tools');
		this.goToDate = this._register(
			new ButtonControl(tools, {
				variant: 'ghost',
				size: 'small',
				label: this.format.text('historyGoToDate'),
				icon: proctorIconFactory('action.goToDate', 14)
			})
		);
		this.pager = this._register(
			new PagerControl(this.section.footer, {
				labels: {
					...this.format.pagerLabels(this.format.text('historyTitle')),
					range: (first, last, total, atLeast) =>
						total === undefined
							? this.format.text('historyRangeOpen', { first, last })
							: this.format.text(atLeast ? 'historyRangeAtLeast' : 'historyRange', {
									first,
									last,
									total: this.format.count(total)
								})
				},
				previousIcon: proctorIconFactory('action.back', 14),
				nextIcon: proctorIconFactory('action.forward', 14),
				numbered: false,
				tools
			})
		);

		for (const control of [this.period, this.kind, this.about])
			this._register(addDisposableListener(control, 'change', () => this.onFilterChange()));
		this._register(addDisposableListener(this.sort, 'click', () => this.toggleOrder()));
		this._register(this.goToDate.onDidRequest(() => this.openGoToDate()));
		this._register(this.pager.onDidRequestPage((page) => void this.load(page)));
		this.render();
	}

	setVisible(visible: boolean): void {
		// History is read when first shown and when its filters change; it does not follow changes.
		if (visible && !this.loaded) void this.load(1);
	}

	/**
	 * Each filter is drawn as a button showing its name and current choice; the native select
	 * lies over it, so the system list, keyboard and screen readers still apply.
	 */
	private picker(
		select: HTMLSelectElement,
		icon: ProctorIconId,
		label: AccountMessage
	): HTMLElement {
		const document = select.ownerDocument;
		const $ = createElementFactory(document);
		const value = $('span.prctr-account-history__value');
		const sync = (): void => {
			value.textContent = select.selectedOptions[0]?.textContent ?? '';
		};
		sync();
		this._register(addDisposableListener(select, 'change', sync));
		return $(
			'span.prctr-account-history__picker',
			{},
			this._register(createProctorIcon(document, { id: icon, size: 16 })).element,
			$('span.prctr-account-history__label', {
				textContent: this.format.text(label),
				attrs: { 'aria-hidden': 'true' }
			}),
			value,
			this._register(createProctorIcon(document, { id: 'action.expand', size: 12 })).element,
			select
		);
	}

	/** Filters start again from the first page; focus stays on the filter that changed. */
	private onFilterChange(): void {
		this.filters = {
			...this.filters,
			period:
				this.period.value === 'all'
					? 'all'
					: (Number(this.period.value) as Exclude<HistoryPeriod, 'all'>),
			kind: this.kind.value as HistoryFilters['kind'],
			about: this.about.value as HistoryFilters['about']
		};
		this.restart();
	}

	private toggleOrder(): void {
		this.filters = { ...this.filters, order: this.filters.order === 'desc' ? 'asc' : 'desc' };
		this.restart();
	}

	private restart(): void {
		this.cursors = [undefined];
		this.total = undefined;
		this.opened.clear();
		void this.load(1);
	}

	/**
	 * Reads one page of the current query. The first read shows skeletons; a page change keeps
	 * the rows, with the pager waiting, until the next arrive. A failure replaces the rows with
	 * the section's error and its Try again; the pager stays, so another page can be chosen.
	 */
	private async load(page: number): Promise<void> {
		if (page < 1 || page > this.cursors.length) return;
		const cursor = this.cursors[page - 1];
		const sequence = ++this.sequence;
		const changingPage = this.loaded && this.entries.length > 0;
		this.loaded = true;
		this.loadingPage = changingPage;
		if (!changingPage) {
			this.entries = [];
			this.section.setState({ kind: 'loading' }, false);
		}
		this.render();
		const timer = setTimeout(() => {
			if (sequence === this.sequence && !changingPage)
				this.section.setState({ kind: 'loading', slow: true }, false);
		}, SLOW_MS);
		this.slow.value = { dispose: () => clearTimeout(timer) };
		const response = await this.read({
			kind: 'readHistory',
			...historyQuery(this.filters, this.format.now()),
			...(cursor === undefined ? {} : { cursor })
		});
		if (this._store.isDisposed || sequence !== this.sequence) return;
		this.slow.clear();
		this.loadingPage = false;
		if (response.kind === 'data' && response.data.section === 'history') {
			const data = response.data;
			this.entries = data.entries;
			this.page = page;
			this.cursors = this.cursors.slice(0, page);
			if (data.cursor !== undefined) this.cursors.push(data.cursor);
			this.hasNext = data.cursor !== undefined;
			if (page === 1 && data.total !== undefined)
				this.total = { count: data.total, atLeast: data.totalIsLowerBound === true };
			this.section.setState(
				{ kind: 'ready' },
				this.entries.length === 0 ? this.format.text('historyEmpty') : false
			);
			this.render();
			if (changingPage) this.announcePage();
			return;
		}
		const reason: AccountFailure = response.kind === 'error' ? response.reason : 'invalid';
		// No stale rows stay under an error: the rows were for another page or query.
		this.entries = [];
		this.page = page;
		this.section.setState({ kind: 'failed', reason }, false, () => void this.load(page));
		this.render();
	}

	/** One read with a deadline: an answer that never comes is reported, not waited on. */
	private read(intent: Parameters<IAccountService['request']>[0]): Promise<AccountResponse> {
		let timer: ReturnType<typeof setTimeout> | undefined;
		const deadline = new Promise<AccountResponse>((resolve) => {
			timer = setTimeout(
				() => resolve({ kind: 'error', reason: 'unavailable' }),
				READ_DEADLINE_MS
			);
		});
		return Promise.race([
			this.account
				.request(intent)
				.catch((): AccountResponse => ({ kind: 'error', reason: 'unavailable' })),
			deadline
		]).finally(() => clearTimeout(timer));
	}

	/** After a page change focus moves to the table and "Showing 11 to 20" is said once. */
	private announcePage(): void {
		this.table.focus();
		const first = (this.page - 1) * ACCOUNT_HISTORY_PAGE_SIZE + 1;
		this.pane.announce(
			this.format.text('historyPageShown', { first, last: first + this.entries.length - 1 })
		);
	}

	private render(): void {
		const descending = this.filters.order === 'desc';
		this.whenHeading.setAttribute('aria-sort', descending ? 'descending' : 'ascending');
		this.sort.setAttribute(
			'aria-label',
			this.format.text(descending ? 'historySortNewest' : 'historySortOldest')
		);
		this.sortIcon.setState({
			id: descending ? 'action.sortDescending' : 'action.sortAscending',
			size: 14
		});
		this.table.setAttribute('aria-busy', String(this.loadingPage));
		this.table.hidden = this.entries.length === 0;
		this.renderRows();
		// Ten or fewer, with no date chosen, need no pager at all.
		const paged = this.page > 1 || this.hasNext || this.filters.before !== undefined;
		this.pager.element.hidden = !paged || !this.loaded;
		const first = (this.page - 1) * ACCOUNT_HISTORY_PAGE_SIZE + 1;
		this.pager.setState({
			page: this.page,
			pageSize: ACCOUNT_HISTORY_PAGE_SIZE,
			first: this.entries.length === 0 ? 0 : first,
			last: this.entries.length === 0 ? 0 : first + this.entries.length - 1,
			...(this.total === undefined
				? {}
				: { total: this.total.count, totalIsLowerBound: this.total.atLeast }),
			hasNext: this.hasNext,
			busy: this.loadingPage
		});
		const before = this.filters.before;
		this.goToDate.setState({
			label:
				before === undefined
					? this.format.text('historyGoToDate')
					: this.format.text('historyGoToDateUntil', {
							date: this.format.date(before - 1)
						}),
			icon: proctorIconFactory('action.goToDate', 14)
		});
	}

	private renderRows(): void {
		const document = this.rows.ownerDocument;
		const focusedRun =
			document.activeElement instanceof HTMLElement &&
			this.rows.contains(document.activeElement)
				? document.activeElement.closest<HTMLElement>('[data-run]')?.dataset.run
				: undefined;
		this.rowStore.clear();
		const $ = createElementFactory(document);
		const rows: HTMLTableRowElement[] = [];
		for (const run of foldHistory(this.entries)) rows.push(...this.runRows($, run));
		this.rows.replaceChildren(...rows);
		if (focusedRun !== undefined)
			this.rows
				.querySelector<HTMLElement>(`[data-run="${CSS.escape(focusedRun)}"] button`)
				?.focus();
	}

	/** One row, or a folded run: its first change, then the rest once opened. */
	private runRows(
		$: ReturnType<typeof createElementFactory>,
		run: HistoryRun
	): HTMLTableRowElement[] {
		const [first, ...rest] = run.entries;
		if (first === undefined) return [];
		if (rest.length === 0) return [this.row($, first, undefined)];
		const open = this.opened.has(first.id);
		const toggle = $('button.prctr-account-history__toggle', {
			type: 'button',
			textContent: open
				? this.format.text('historyShowFewer')
				: this.format.text('historyShowAll', { count: run.entries.length }),
			attrs: { 'aria-expanded': String(open) }
		});
		this.rowStore.add(
			addDisposableListener(toggle, 'click', () => {
				if (this.opened.has(first.id)) this.opened.delete(first.id);
				else this.opened.add(first.id);
				this.renderRows();
			})
		);
		const head = this.row($, first, {
			note: this.format.text('historyFoldedNote', { count: run.entries.length }),
			toggle
		});
		head.dataset.run = first.id;
		return open ? [head, ...rest.map((entry) => this.row($, entry, undefined))] : [head];
	}

	private row(
		$: ReturnType<typeof createElementFactory>,
		entry: AccountHistoryEntry,
		fold: { readonly note: string; readonly toggle: HTMLButtonElement } | undefined
	): HTMLTableRowElement {
		const what = $(
			'span.prctr-account-history__what',
			{},
			$('span.prctr-account-history__event', { textContent: entry.summary })
		);
		const note = fold?.note ?? (entry.failed ? this.format.text('historyFailed') : undefined);
		if (note !== undefined || fold !== undefined) {
			const line = $('span.prctr-account-history__note-line');
			if (note !== undefined)
				line.append($('span.prctr-account-history__note', { textContent: note }));
			if (fold !== undefined) line.append(fold.toggle);
			what.append(line);
		}
		const client =
			entry.client === undefined ? undefined : this.format.text(clientKind(entry.client));
		const where = $(
			'span.prctr-account-history__what',
			{},
			$('span', {
				textContent: client ?? entry.ipAddress ?? this.format.text('historyWhereUnknown')
			})
		);
		// Only a sign-in shows the address it came from; other rows name the app.
		if (
			client !== undefined &&
			entry.ipAddress !== undefined &&
			entry.event.startsWith('sign_in')
		)
			where.append(
				$('span.prctr-account-history__address', { textContent: entry.ipAddress })
			);
		return $(
			'tr.prctr-account-history__row',
			{ data: { failed: String(entry.failed) } },
			$('td', {}, what),
			$('td.prctr-account-history__muted', { data: { column: 'where' } }, where),
			$('td.prctr-account-history__when', {
				textContent: this.format.relativeStandalone(entry.createdAt),
				title: this.format.dateTime(entry.createdAt)
			})
		);
	}

	// #region Go to a date

	private openGoToDate(): void {
		const dialog = new PageDialog(this.pane, {
			title: this.format.text('historyGoToDateTitle'),
			description: this.format.text('historyGoToDateDescription')
		});
		const store = new DisposableStore();
		store.add(dialog);
		this.dialog.value = store;
		const $ = createElementFactory(this.pane.document);
		const input = $('input.prctr-account-history__date', {
			type: 'date',
			id: `prctr-account-history-date-${this.sequence}`,
			max: localDay(this.format.now()),
			value: localDay((this.filters.before ?? this.format.now() + 1) - 1)
		});
		dialog.body.append(
			$(
				'div.prctr-account-history__date-field',
				{},
				$('label', {
					htmlFor: input.id,
					textContent: this.format.text('historyGoToDateField')
				}),
				input
			)
		);
		const close = (): void => this.dialog.clear();
		if (this.filters.before !== undefined) {
			const latest = store.add(
				new ButtonControl(dialog.actions, {
					variant: 'ghost',
					label: this.format.text('historyGoToLatest')
				})
			);
			store.add(
				latest.onDidRequest(() => {
					close();
					const { before: _before, ...rest } = this.filters;
					this.filters = rest;
					this.restart();
				})
			);
		}
		const cancel = store.add(
			new ButtonControl(dialog.actions, {
				variant: 'secondary',
				label: this.format.text('cancel')
			})
		);
		const go = store.add(
			new ButtonControl(dialog.actions, {
				variant: 'brand',
				label: this.format.text('historyGoToDateAction'),
				icon: proctorIconFactory('action.goToDate')
			})
		);
		const submit = (): void => {
			const before = endOfLocalDay(input.value);
			if (before === undefined) {
				input.focus();
				return;
			}
			close();
			this.filters = { ...this.filters, before };
			this.restart();
		};
		store.add(cancel.onDidRequest(close));
		store.add(dialog.onDidRequestCancel(close));
		store.add(go.onDidRequest(submit));
		store.add(
			addDisposableListener(input, 'keydown', (event) => {
				if (event.key !== 'Enter') return;
				event.preventDefault();
				submit();
			})
		);
		dialog.show(input);
	}

	// #endregion
}

/** The local calendar day of a time, as a date field's value: "2026-11-12". */
function localDay(time: number): string {
	const date = new Date(time);
	const pad = (value: number): string => String(value).padStart(2, '0');
	return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** The first moment after a local calendar day, so that day's changes are included. */
function endOfLocalDay(value: string): number | undefined {
	const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(value);
	if (match === null) return undefined;
	const time = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + 1).getTime();
	return Number.isFinite(time) ? time : undefined;
}
