/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { createElementFactory } from '../../../../base/browser/documentElements.js';
import { addDisposableListener } from '../../../../base/browser/dom.js';
import { ButtonControl } from '../../../../base/browser/ui/button/buttonControl.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import type {
	AccountFailure,
	AccountHistoryEntry
} from '../../../../platform/account/common/accountProtocol.js';
import { createSemanticIcon } from '../../../../platform/theme/browser/semanticIcon.js';
import {
	clientKind,
	defaultHistoryFilters,
	historyActorMessage,
	historyEventGroups,
	historyEventMessage,
	historyPeriods,
	historyQuery,
	historyShape,
	type HistoryEventGroup,
	type HistoryFilters
} from '../common/accountPresentation.js';
import type { AccountMessage } from './accountMessages.js';
import type { AccountPageServices, AccountPageView } from './accountPageServices.js';
import './historyPage.css';

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

/**
 * Account history: what was done with the person's account, newest first, as
 * the server's own account history reports it. Filters choose the period, the
 * kind of event, whether it was about the account or done elsewhere, and the
 * outcome. Another person is never named; where an event came from is shown
 * only for the person's own actions.
 */
export class HistoryPage extends Disposable implements AccountPageView {
	private readonly period: HTMLSelectElement;
	private readonly group: HTMLSelectElement;
	private readonly relation: HTMLSelectElement;
	private readonly outcome: HTMLSelectElement;
	private readonly shown: HTMLElement;
	private readonly table: HTMLTableElement;
	private readonly rows: HTMLTableSectionElement;
	private readonly state: HTMLElement;
	private readonly stateText: HTMLElement;
	private readonly stateIcon;
	private readonly retry: ButtonControl;
	private readonly more: ButtonControl;

	private filters: HistoryFilters = defaultHistoryFilters;
	private entries: AccountHistoryEntry[] = [];
	private cursor: string | undefined;
	private status: HistoryState = { kind: 'loading' };
	private loadingMore = false;
	private sequence = 0;
	private loaded = false;

	constructor(
		body: HTMLElement,
		private readonly services: AccountPageServices
	) {
		super();
		const document = body.ownerDocument;
		const $ = createElementFactory(document);
		const select = (label: AccountMessage): HTMLSelectElement =>
			$('select.prctr-account-history__filter', {
				attrs: { 'aria-label': services.text(label) }
			});
		this.period = select('historyPeriodLabel');
		for (const period of historyPeriods)
			this.period.append(
				$('option', {
					value: String(period),
					selected: period === defaultHistoryFilters.period,
					textContent:
						period === 'all'
							? services.text('historyPeriodAll')
							: services.text('historyPeriodDays', { days: period })
				})
			);
		this.group = select('historyGroupLabel');
		this.group.append(
			$('option', { value: 'all', textContent: services.text('historyGroupAll') })
		);
		for (const group of historyEventGroups)
			this.group.append(
				$('option', {
					value: group.id,
					textContent: services.text(groupMessages[group.id])
				})
			);
		this.relation = select('historyRelationLabel');
		for (const [value, label] of [
			['all', 'historyRelationAll'],
			['subject', 'historyRelationSubject'],
			['actor', 'historyRelationActor']
		] as const)
			this.relation.append($('option', { value, textContent: services.text(label) }));
		this.outcome = select('historyOutcomeLabel');
		for (const [value, label] of [
			['all', 'historyOutcomeAll'],
			['success', 'historyOutcomeSuccess'],
			['fail', 'historyOutcomeFail']
		] as const)
			this.outcome.append($('option', { value, textContent: services.text(label) }));
		this.shown = $('span.prctr-account-history__shown', { attrs: { 'aria-live': 'polite' } });
		const filters = $(
			'div.prctr-account-history__filters',
			{ attrs: { role: 'group', 'aria-label': services.text('historyTitle') } },
			this.period,
			this.group,
			this.relation,
			this.outcome,
			this.shown
		);

		const heading = (label: AccountMessage): HTMLTableCellElement =>
			$('th.prctr-account-history__heading', {
				textContent: services.text(label),
				attrs: { scope: 'col' }
			});
		this.rows = $('tbody');
		this.table = $(
			'table.prctr-account-history__table',
			{ attrs: { 'aria-label': services.text('historyTitle') } },
			$(
				'thead',
				{},
				$(
					'tr',
					{},
					heading('historyWhen'),
					heading('historyWhat'),
					heading('historyBy'),
					heading('historyWhere')
				)
			),
			this.rows
		);

		this.stateIcon = this._register(createSemanticIcon(document, { id: 'state.info' }));
		this.stateText = $('span.prctr-account-section__state-text');
		this.state = $(
			'div.prctr-account-section__state',
			{},
			this.stateIcon.element,
			this.stateText
		);
		this.retry = this._register(
			new ButtonControl(this.state, { variant: 'secondary', label: services.text('retry') })
		);
		const footer = $('div.prctr-account-history__footer');
		this.more = this._register(
			new ButtonControl(footer, { variant: 'secondary', label: services.text('historyMore') })
		);
		body.append($('div.prctr-account-history', {}, filters, this.table, this.state, footer));

		for (const control of [this.period, this.group, this.relation, this.outcome])
			this._register(addDisposableListener(control, 'change', () => this.onFilterChange()));
		this._register(this.retry.onDidRequest(() => void this.load(false)));
		this._register(this.more.onDidRequest(() => void this.load(true)));
		this.render();
	}

	setVisible(visible: boolean): void {
		// History is read when first shown and when its filters change; it does not follow changes.
		if (visible && !this.loaded) void this.load(false);
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
		void this.load(false);
	}

	/** Reads the first page for the current filters, or the next page of the same query. */
	private async load(next: boolean): Promise<void> {
		if (next && (this.cursor === undefined || this.loadingMore)) return;
		const sequence = ++this.sequence;
		const query = historyQuery(this.filters, this.services.now());
		if (next) this.loadingMore = true;
		else {
			this.loaded = true;
			this.entries = [];
			this.cursor = undefined;
			this.status = { kind: 'loading' };
		}
		this.render();
		const response = await this.services.request({
			kind: 'readHistory',
			...query,
			...(next && this.cursor !== undefined ? { cursor: this.cursor } : {})
		});
		if (this._store.isDisposed || sequence !== this.sequence) return;
		this.loadingMore = false;
		if (response.kind === 'data' && response.data.section === 'history') {
			const known = new Set(this.entries.map((entry) => entry.id));
			this.entries.push(...response.data.entries.filter((entry) => !known.has(entry.id)));
			this.cursor = response.data.cursor;
			this.status = { kind: 'ready' };
		} else if (next) {
			this.services.announce(
				this.services.failure(response.kind === 'error' ? response.reason : 'invalid')
			);
		} else {
			this.status = {
				kind: 'failed',
				reason: response.kind === 'error' ? response.reason : 'invalid'
			};
		}
		this.render();
	}

	private render(): void {
		const status = this.status;
		const $ = createElementFactory(this.rows.ownerDocument);
		this.table.setAttribute('aria-busy', String(status.kind === 'loading' || this.loadingMore));
		this.rows.replaceChildren(...this.entries.map((entry) => this.row($, entry)));
		this.table.hidden = this.entries.length === 0;
		this.shown.textContent =
			status.kind === 'ready' && this.entries.length > 0
				? this.services.text('historyShown', { count: this.entries.length })
				: '';
		this.more.element.hidden = status.kind !== 'ready' || this.cursor === undefined;
		this.more.setState({ label: this.services.text('historyMore'), busy: this.loadingMore });
		if (status.kind === 'loading') this.showState('loading', this.services.text('loading'));
		else if (status.kind === 'failed')
			this.showState(
				'error',
				this.services.text('loadFailed', { reason: this.services.failure(status.reason) })
			);
		else if (this.entries.length === 0)
			this.showState('empty', this.services.text('historyEmpty'));
		else this.state.hidden = true;
	}

	private showState(kind: 'loading' | 'error' | 'empty', text: string): void {
		this.state.hidden = false;
		this.state.dataset.kind = kind;
		this.stateText.textContent = text;
		this.retry.element.hidden = kind !== 'error';
		this.stateIcon.setState(
			kind === 'loading'
				? { id: 'state.loading', modifier: 'spin' }
				: { id: kind === 'empty' ? 'state.info' : 'state.warning' }
		);
		this.stateIcon.element.hidden = kind === 'empty';
	}

	private row(
		$: ReturnType<typeof createElementFactory>,
		entry: AccountHistoryEntry
	): HTMLTableRowElement {
		const notes: string[] = [];
		if (entry.failed && entry.event !== 'sign_in.failed')
			notes.push(this.services.text('historyFailed'));
		if (entry.relation === 'actor') notes.push(this.services.text('historyAboutElsewhere'));
		const what = $(
			'span.prctr-account-history__what',
			{},
			$('span.prctr-account-history__event', {
				textContent: this.services.text(historyEventMessage(entry.event))
			})
		);
		if (notes.length > 0)
			what.append(
				$('span.prctr-account-history__note', {
					textContent: notes.reduce((first, second) => this.services.join(first, second))
				})
			);
		return $(
			'tr.prctr-account-history__row',
			{ data: { failed: String(entry.failed) } },
			$('td.prctr-account-history__when', {
				textContent: this.services.relative(entry.createdAt),
				title: this.services.dateTime(entry.createdAt)
			}),
			$(
				'td',
				{},
				$(
					'span.prctr-account-history__cell',
					{},
					$('span.prctr-account-row__status', {
						data: { shape: historyShape(entry) },
						attrs: { 'aria-hidden': 'true' }
					}),
					what
				)
			),
			$('td.prctr-account-history__muted', {
				textContent: this.services.text(historyActorMessage(entry))
			}),
			$('td.prctr-account-history__muted', { textContent: this.where(entry) })
		);
	}

	private where(entry: AccountHistoryEntry): string {
		const client =
			entry.client === undefined ? undefined : this.services.text(clientKind(entry.client));
		if (client !== undefined && entry.ipAddress !== undefined)
			return this.services.join(client, entry.ipAddress);
		return client ?? entry.ipAddress ?? this.services.text('historyWhereUnknown');
	}
}
