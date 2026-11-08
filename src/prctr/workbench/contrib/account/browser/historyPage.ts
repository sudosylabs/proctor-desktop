/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { createElementFactory } from '../../../../base/browser/documentElements.js';
import { addDisposableListener } from '../../../../base/browser/dom.js';
import { ButtonControl } from '../../../../base/browser/ui/button/buttonControl.js';
import { Disposable, DisposableStore } from '../../../../base/common/lifecycle.js';
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
	private readonly skeleton: HTMLElement;
	private readonly rowIcons = this._register(new DisposableStore());
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
					textContent: services.text(label),
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
			{ attrs: { role: 'group', 'aria-label': services.text('historyTitle') } },
			picker(this.period, 'object.calendar', 'historyPeriodLabel'),
			picker(this.group, 'action.filter', 'historyGroupLabel'),
			picker(this.relation, 'account.profile', 'historyRelationLabel'),
			picker(this.outcome, 'status.success', 'historyOutcomeLabel'),
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
				label: services.text('retry'),
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
		const footer = $('div.prctr-account-history__footer');
		this.more = this._register(
			new ButtonControl(footer, {
				variant: 'ghost',
				label: services.text('historyMore'),
				icon: proctorIconFactory('account.history')
			})
		);
		body.append(
			$(
				'div.prctr-account-history',
				{},
				filters,
				$(
					'div.prctr-account-section__card.prctr-account-history__card',
					{},
					this.table,
					this.skeleton,
					this.state
				),
				footer
			)
		);

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
		this.rowIcons.clear();
		this.rows.replaceChildren(...this.entries.map((entry) => this.row($, entry)));
		this.skeleton.hidden = status.kind !== 'loading';
		this.table.hidden = this.entries.length === 0;
		this.shown.textContent =
			status.kind === 'ready' && this.entries.length > 0
				? this.services.text('historyShown', { count: this.entries.length })
				: '';
		this.more.element.hidden = status.kind !== 'ready' || this.cursor === undefined;
		this.more.setState({
			label: this.services.text('historyMore'),
			icon: proctorIconFactory('account.history'),
			busy: this.loadingMore
		});
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
				textContent: this.services.relativeStandalone(entry.createdAt),
				title: this.services.dateTime(entry.createdAt)
			}),
			$(
				'td',
				{},
				$(
					'span.prctr-account-history__cell',
					{},
					this.rowIcons.add(
						createProctorIcon(this.rows.ownerDocument, {
							id: historyGlyph(entry),
							size: 16
						})
					).element,
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

/** A small glyph for what kind of event it was; a failure always shows as one. */
function historyGlyph(entry: AccountHistoryEntry): ProctorIconId {
	if (entry.failed) return 'status.failed';
	const event = entry.event;
	if (event.startsWith('sign_in') || event === 'sign_out' || event.startsWith('session'))
		return 'action.signOut';
	if (event.startsWith('desktop')) return 'device.laptop';
	if (event.startsWith('personal_access_token')) return 'object.key';
	if (event.startsWith('profile_picture')) return 'action.changePhoto';
	if (event.startsWith('profile')) return 'account.profile';
	if (event.startsWith('password') || event.startsWith('mfa') || event.startsWith('provider'))
		return 'account.security';
	if (event.startsWith('email')) return 'action.sendEmail';
	if (event.startsWith('role') || event.startsWith('class') || event.startsWith('academic_unit'))
		return 'object.role';
	return 'status.info';
}
