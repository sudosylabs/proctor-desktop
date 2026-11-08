/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { IAccountService } from '../../../services/account/common/account.js';
import { IAccountFormatService } from '../accountFormat.js';
import { IAccountPaneContext } from '../accountPaneContext.js';
import { createElementFactory } from '../../../../base/browser/documentElements.js';
import { addDisposableListener } from '../../../../base/browser/dom.js';
import { ButtonControl } from '../../../../base/browser/ui/button/buttonControl.js';
import { PagerControl } from '../../../../base/browser/ui/pager/pagerControl.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import type {
	AccountFailure,
	AccountHistoryEntry
} from '../../../../platform/account/common/accountProtocol.js';
import {
	createProctorIcon,
	proctorIconFactory
} from '../../../../platform/theme/browser/proctorIcon.js';
import type { ProctorIconId } from '../../../../platform/theme/common/proctorIcons.js';
import {
	clientKind,
	defaultHistoryFilters,
	historyActorMessage,
	historyEventGroups,
	historyEventMessage,
	historyPeriods,
	historyQuery,
	type HistoryEventGroup,
	type HistoryFilters
} from '../common/accountPresentation.js';
import type { AccountMessage } from '../accountMessages.js';
import type { AccountPageView } from '../accountPages.js';
import './media/auditsPage.css';

const groupMessages: Readonly<Record<HistoryEventGroup, AccountMessage>> = Object.freeze({
	signIn: 'historyGroupSignIn',
	security: 'historyGroupSecurity',
	tokens: 'historyGroupTokens',
	profile: 'historyGroupProfile',
	membership: 'historyGroupMembership',
	status: 'historyGroupStatus'
});

type HistoryState =
	| { readonly kind: 'loading' }
	| { readonly kind: 'ready' }
	| { readonly kind: 'failed'; readonly reason: AccountFailure };

/** Events on one page; the server is asked for exactly this many. */
const HISTORY_PAGE_SIZE = 10;

/**
 * Audits: what was done with the person's account, newest first, as
 * the server's own account history reports it. Filters choose the period, the
 * kind of event, whether it was about the account or done elsewhere, and the
 * outcome. Another person is never named; where an event came from is shown
 * only for the person's own actions.
 */
export class AuditsPage extends Disposable implements AccountPageView {
	private readonly period: HTMLSelectElement;
	private readonly group: HTMLSelectElement;
	private readonly relation: HTMLSelectElement;
	private readonly outcome: HTMLSelectElement;
	private readonly table: HTMLTableElement;
	private readonly rows: HTMLTableSectionElement;
	private readonly state: HTMLElement;
	private readonly stateText: HTMLElement;
	private readonly stateIcon;
	private readonly skeleton: HTMLElement;
	private readonly retry: ButtonControl;
	private readonly pager: PagerControl;

	private filters: HistoryFilters = defaultHistoryFilters;
	private entries: readonly AccountHistoryEntry[] = [];
	/** The cursor that starts each page reached so far; the first page needs none. */
	private pageCursors: (string | undefined)[] = [undefined];
	private page = 1;
	private hasNext = false;
	private status: HistoryState = { kind: 'loading' };
	private loadingPage = false;
	private sequence = 0;
	private loaded = false;

	constructor(
		body: HTMLElement,
		_headerActions: HTMLElement,
		@IAccountService private readonly account: IAccountService,
		@IAccountFormatService private readonly format: IAccountFormatService,
		@IAccountPaneContext private readonly pane: IAccountPaneContext
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
					textContent:
						period === 'all'
							? this.format.text('historyPeriodAll')
							: this.format.text('historyPeriodDays', { days: period })
				})
			);
		this.group = select('historyGroupLabel');
		this.group.append(
			$('option', { value: 'all', textContent: this.format.text('historyGroupAll') })
		);
		for (const group of historyEventGroups)
			this.group.append(
				$('option', {
					value: group.id,
					textContent: this.format.text(groupMessages[group.id])
				})
			);
		this.relation = select('historyRelationLabel');
		for (const [value, label] of [
			['all', 'historyRelationAll'],
			['subject', 'historyRelationSubject'],
			['actor', 'historyRelationActor']
		] as const)
			this.relation.append($('option', { value, textContent: this.format.text(label) }));
		this.outcome = select('historyOutcomeLabel');
		for (const [value, label] of [
			['all', 'historyOutcomeAll'],
			['success', 'historyOutcomeSuccess'],
			['fail', 'historyOutcomeFail']
		] as const)
			this.outcome.append($('option', { value, textContent: this.format.text(label) }));
		// Each filter is drawn as a button showing its name and current choice; the native
		// select lies over it, so the system list, keyboard and screen readers still apply.
		const picker = (
			select: HTMLSelectElement,
			icon: ProctorIconId,
			label: AccountMessage
		): HTMLElement => {
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
				this._register(createProctorIcon(document, { id: 'action.expand', size: 12 }))
					.element,
				select
			);
		};
		const filters = $(
			'div.prctr-account-history__filters',
			{ attrs: { role: 'group', 'aria-label': this.format.text('historyTitle') } },
			picker(this.period, 'object.calendar', 'historyPeriodLabel'),
			picker(this.group, 'action.filter', 'historyGroupLabel'),
			picker(this.relation, 'account.profile', 'historyRelationLabel'),
			picker(this.outcome, 'status.success', 'historyOutcomeLabel')
		);

		const heading = (label: AccountMessage, column: string): HTMLTableCellElement =>
			$('th.prctr-account-history__heading', {
				textContent: this.format.text(label),
				data: { column },
				attrs: { scope: 'col' }
			});
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
					heading('historyBy', 'by'),
					heading('historyWhere', 'where'),
					heading('historyWhen', 'when')
				)
			),
			this.rows
		);

		this.stateIcon = this._register(
			createProctorIcon(document, { id: 'status.attention', size: 18 })
		);
		this.stateText = $('span.prctr-account-section__state-text');
		this.state = $(
			'div.prctr-account-section__state',
			{},
			this.stateIcon.element,
			this.stateText
		);
		this.retry = this._register(
			new ButtonControl(this.state, {
				variant: 'secondary',
				size: 'small',
				label: this.format.text('retry'),
				icon: proctorIconFactory('action.retry', 14)
			})
		);
		this.skeleton = $('div.prctr-account-section__skeleton', {
			attrs: { 'aria-hidden': 'true' }
		});
		for (let index = 0; index < 4; index++)
			this.skeleton.append(
				$(
					'div.prctr-account-section__skeleton-row',
					{},
					$('span.prctr-account-section__skeleton-glyph'),
					$(
						'span.prctr-account-section__skeleton-text',
						{},
						$('span.prctr-account-section__skeleton-bar'),
						$('span.prctr-account-section__skeleton-bar')
					)
				)
			);
		const card = $(
			'div.prctr-account-section__card.prctr-account-history__card',
			{},
			this.table,
			this.skeleton,
			this.state
		);
		// The server reports no total, so the pager numbers only the pages reached so far.
		this.pager = this._register(
			new PagerControl(card, {
				labels: this.format.pagerLabels(this.format.text('historyTitle')),
				previousIcon: proctorIconFactory('action.back', 14),
				nextIcon: proctorIconFactory('action.forward', 14)
			})
		);
		body.append($('div.prctr-account-history', {}, filters, card));

		for (const control of [this.period, this.group, this.relation, this.outcome])
			this._register(addDisposableListener(control, 'change', () => this.onFilterChange()));
		this._register(this.retry.onDidRequest(() => void this.load(this.page)));
		this._register(this.pager.onDidRequestPage((page) => void this.load(page)));
		this.render();
	}

	setVisible(visible: boolean): void {
		// History is read when first shown and when its filters change; it does not follow changes.
		if (visible && !this.loaded) void this.load(1);
	}

	private onFilterChange(): void {
		this.filters = {
			period:
				this.period.value === 'all'
					? 'all'
					: (Number(this.period.value) as HistoryFilters['period']),
			group: this.group.value as HistoryFilters['group'],
			relation: this.relation.value as HistoryFilters['relation'],
			outcome: this.outcome.value as HistoryFilters['outcome']
		};
		// Filters start again from the first page.
		this.pageCursors = [undefined];
		void this.load(1);
	}

	/** Reads one page of the current filters. The first read shows skeletons; a page change keeps the rows until the next arrive. */
	private async load(page: number): Promise<void> {
		const cursorIndex = page - 1;
		if (cursorIndex >= this.pageCursors.length) return;
		const sequence = ++this.sequence;
		const query = historyQuery(this.filters, this.format.now());
		const first = page === 1 && this.pageCursors.length === 1;
		this.loaded = true;
		if (first || this.status.kind !== 'ready') {
			this.entries = [];
			this.status = { kind: 'loading' };
		} else this.loadingPage = true;
		this.render();
		const cursor = this.pageCursors[cursorIndex];
		const response = await this.account.request({
			kind: 'readHistory',
			...query,
			...(cursor === undefined ? {} : { cursor })
		});
		if (this._store.isDisposed || sequence !== this.sequence) return;
		const changedPage = this.loadingPage;
		this.loadingPage = false;
		if (response.kind === 'data' && response.data.section === 'history') {
			this.entries = response.data.entries;
			this.page = page;
			this.hasNext = response.data.cursor !== undefined;
			if (response.data.cursor !== undefined && this.pageCursors.length === page)
				this.pageCursors.push(response.data.cursor);
			this.status = { kind: 'ready' };
			this.render();
			if (changedPage) this.announcePage();
			return;
		}
		const reason = response.kind === 'error' ? response.reason : 'invalid';
		if (changedPage) this.pane.announce(this.format.failure(reason));
		else this.status = { kind: 'failed', reason };
		this.render();
	}

	/** After a page change, focus returns to the table and the new place is said once. */
	private announcePage(): void {
		this.table.focus();
		const first = (this.page - 1) * HISTORY_PAGE_SIZE + 1;
		this.pane.announce(
			this.format.text('pageShownOpen', {
				page: this.page,
				first,
				last: first + this.entries.length - 1
			})
		);
	}

	private render(): void {
		const status = this.status;
		const $ = createElementFactory(this.rows.ownerDocument);
		this.table.setAttribute('aria-busy', String(status.kind === 'loading' || this.loadingPage));
		this.rows.replaceChildren(...this.entries.map((entry) => this.row($, entry)));
		this.skeleton.hidden = status.kind !== 'loading';
		this.table.hidden = this.entries.length === 0;
		const paged = status.kind === 'ready' && (this.page > 1 || this.hasNext);
		this.pager.element.hidden = !paged;
		if (paged) {
			const first = (this.page - 1) * HISTORY_PAGE_SIZE + 1;
			this.pager.setState({
				page: this.page,
				pageSize: HISTORY_PAGE_SIZE,
				first,
				last: first + this.entries.length - 1,
				hasNext: this.hasNext,
				knownPages: this.pageCursors.length,
				busy: this.loadingPage
			});
		}
		if (status.kind === 'loading') this.showState('loading', this.format.text('loading'));
		else if (status.kind === 'failed')
			this.showState(
				'error',
				this.format.text('loadFailed', { reason: this.format.failure(status.reason) })
			);
		else if (this.entries.length === 0)
			this.showState('empty', this.format.text('historyEmpty'));
		else this.state.hidden = true;
	}

	private showState(kind: 'loading' | 'error' | 'empty', text: string): void {
		this.state.hidden = false;
		this.state.dataset.kind = kind;
		this.stateText.textContent = text;
		this.retry.element.hidden = kind !== 'error';
		this.state.hidden = kind === 'loading';
		this.state.dataset.kind = kind === 'error' ? 'failure' : kind;
		this.stateIcon.element.hidden = kind !== 'error';
	}

	private row(
		$: ReturnType<typeof createElementFactory>,
		entry: AccountHistoryEntry
	): HTMLTableRowElement {
		const notes: string[] = [];
		if (entry.failed && entry.event !== 'sign_in.failed')
			notes.push(this.format.text('historyFailed'));
		if (entry.relation === 'actor') notes.push(this.format.text('historyAboutElsewhere'));
		const what = $(
			'span.prctr-account-history__what',
			{},
			$('span.prctr-account-history__event', {
				textContent: this.format.text(historyEventMessage(entry.event))
			})
		);
		if (notes.length > 0)
			what.append(
				$('span.prctr-account-history__note', {
					textContent: notes.reduce((first, second) => this.format.join(first, second))
				})
			);
		const client =
			entry.client === undefined ? undefined : this.format.text(clientKind(entry.client));
		const where = $(
			'span.prctr-account-history__what',
			{},
			$('span', {
				textContent: client ?? entry.ipAddress ?? this.format.text('historyWhereUnknown')
			})
		);
		if (client !== undefined && entry.ipAddress !== undefined)
			where.append(
				$('span.prctr-account-history__address', { textContent: entry.ipAddress })
			);
		return $(
			'tr.prctr-account-history__row',
			{ data: { failed: String(entry.failed) } },
			$('td', {}, what),
			$('td.prctr-account-history__muted', {
				textContent: this.format.text(historyActorMessage(entry))
			}),
			$('td.prctr-account-history__muted', {}, where),
			$('td.prctr-account-history__when', {
				textContent: this.format.relativeStandalone(entry.createdAt),
				title: this.format.dateTime(entry.createdAt)
			})
		);
	}
}
