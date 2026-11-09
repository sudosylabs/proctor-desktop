/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { createElementFactory } from '../../../../base/browser/documentElements.js';
import { addDisposableListener } from '../../../../base/browser/dom.js';
import type { MenuEntry } from '../../../../base/browser/ui/menu/menuControl.js';
import { PagerControl } from '../../../../base/browser/ui/pager/pagerControl.js';
import { Emitter, type Event } from '../../../../base/common/event.js';
import {
	Disposable,
	DisposableStore,
	MutableDisposable
} from '../../../../base/common/lifecycle.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import {
	ADMINISTRATION_PAGE_SIZE,
	type AdministrationFailure,
	type AdministrationIntentOf,
	type AdministrationReadKind,
	type AdministrationResponse,
	type AdministrationValue
} from '../../../../platform/administration/common/administrationProtocol.js';
import {
	createProctorIcon,
	proctorIconFactory
} from '../../../../platform/theme/browser/proctorIcon.js';
import type { ProctorIconId } from '../../../../platform/theme/common/proctorIcons.js';
import { PageRead } from '../../../browser/authenticated/pages/pageRead.js';
import {
	PageSection,
	type PageEmpty,
	type PageRowAction
} from '../../../browser/authenticated/pages/pageSection.js';
import { IPagePaneContext } from '../../../browser/authenticated/pages/pagePaneContext.js';
import { IAdministrationService } from '../../../services/administration/common/administration.js';
import { IAdministrationFormatService } from '../administrationFormat.js';
import { administrationFailureWithdraws } from '../common/administrationPresentation.js';
import './media/adminList.css';

/** Every read that answers one page of a list. */
export type AdminListKind = {
	[K in AdministrationReadKind]: AdministrationValue<K> extends {
		readonly items: readonly unknown[];
	}
		? K
		: never;
}[AdministrationReadKind];
export type AdminListItem<K extends AdminListKind> =
	AdministrationValue<K> extends {
		readonly items: readonly (infer T)[];
	}
		? T
		: never;
/** A list's filters: its read without the kind and the page. */
export type AdminListQuery<K extends AdminListKind> = Omit<
	AdministrationIntentOf<K>,
	'kind' | 'cursor' | 'limit'
>;

export type AdminTone = 'ok' | 'warn' | 'fail' | 'neutral';

/** What one table cell shows, in the forms the Administration boards draw. */
export type AdminCell =
	| {
			readonly kind: 'person';
			readonly name: string;
			readonly detail?: string;
	  }
	| {
			readonly kind: 'text';
			readonly primary: string;
			readonly secondary?: string;
			/** Names the row, as an email does in a list of invitations. */
			readonly strong?: boolean;
			/** Dates and codes line up as tabular figures. */
			readonly mono?: boolean;
	  }
	| { readonly kind: 'status'; readonly text: string; readonly tone: AdminTone }
	| { readonly kind: 'check'; readonly on: boolean; readonly label: string };

export interface AdminColumn<T> {
	readonly label: string;
	/** A share of the table, as in "30%"; the remaining columns divide the rest. */
	readonly width?: string;
	readonly align?: 'start' | 'end' | 'center';
	cell(item: T): AdminCell;
}

export interface AdminListOptions<K extends AdminListKind> {
	/** The section heading; a page's only table has none and is named by `label`. */
	readonly title?: string;
	readonly description?: string;
	/** The table's accessible name, used by its pager too. */
	readonly label: string;
	readonly columns: readonly AdminColumn<AdminListItem<K>>[];
	rowId(item: AdminListItem<K>): string;
	/** The row's name, for its actions button. */
	rowName(item: AdminListItem<K>): string;
	/** Opens the row's own page from its first cell. */
	open?(item: AdminListItem<K>): void;
	/** The row's actions; the destructive ones come last after a separator. */
	actions?(item: AdminListItem<K>): readonly PageRowAction[];
	readonly empty: string | PageEmpty;
	/** Rows other filters would show; replaces `empty` while any filter is set. */
	readonly filteredEmpty?: string;
	readonly action?: { readonly label: string; readonly icon: ProctorIconId };
}

/**
 * One server-paged list shown as a table in a card: ten rows at a time, Previous and Next
 * by the cursors the server issued, and the section's loading, slow, failed, stale and empty
 * states. The server never gives a total, so the range names only the rows shown. A refusal
 * reads as a calm state without a retry, since trying again cannot change the answer.
 */
export class AdminList<K extends AdminListKind> extends Disposable {
	readonly section: PageSection;
	private readonly table: HTMLTableElement;
	private readonly body: HTMLTableSectionElement;
	private readonly pager: PagerControl;
	private readonly rowStore = this._register(new DisposableStore());
	private readonly read = this._register(
		new MutableDisposable<
			PageRead<AdministrationValue<K>, AdministrationFailure, AdministrationResponse>
		>()
	);
	private readonly readListener = this._register(new MutableDisposable());
	/** The person moved to the shown page, so its arrival is announced and focused. */
	private announce = false;
	private readonly loadEmitter = this._register(new Emitter<readonly AdminListItem<K>[]>());
	/** A page of rows arrived. */
	readonly onDidLoad: Event<readonly AdminListItem<K>[]> = this.loadEmitter.event;

	private query: AdminListQuery<K>;
	/** The cursor that reads each page; the first page needs none. */
	private cursors: (string | undefined)[] = [undefined];
	private page = 1;
	private active = false;
	private items: readonly AdminListItem<K>[] = [];

	constructor(
		host: HTMLElement,
		private readonly kind: K,
		query: AdminListQuery<K>,
		private readonly options: AdminListOptions<K>,
		@IAdministrationService private readonly administration: IAdministrationService,
		@IAdministrationFormatService private readonly format: IAdministrationFormatService,
		@IPagePaneContext private readonly pane: IPagePaneContext,
		@IInstantiationService instantiationService: IInstantiationService
	) {
		super();
		this.query = query;
		this.section = this._register(
			instantiationService.createInstance(PageSection, host, {
				title: options.title ?? '',
				...(options.description === undefined ? {} : { description: options.description }),
				...(options.action === undefined ? {} : { action: options.action })
			})
		);
		this.section.setAction(options.action !== undefined);
		const $ = createElementFactory(host.ownerDocument);
		this.body = $('tbody');
		const headers = options.columns.map((column) =>
			$('th', {
				textContent: column.label,
				attrs: { scope: 'col' },
				data: { align: column.align ?? 'start' }
			})
		);
		const widths = options.columns.map((column) => {
			const col = $('col');
			if (column.width !== undefined) col.style.width = column.width;
			return col;
		});
		if (options.actions !== undefined) {
			headers.push($('th', { data: { align: 'end' } }));
			const col = $('col');
			col.style.width = '56px';
			widths.push(col);
		}
		this.table = $(
			'table.prctr-admin-list',
			{ attrs: { 'aria-label': options.label } },
			$('colgroup', {}, ...widths),
			$('thead', {}, $('tr', {}, ...headers)),
			this.body
		);
		this.section.content.append(this.table);
		this.pager = this._register(
			new PagerControl(this.section.footer, {
				labels: format.pagerLabels(options.label),
				previousIcon: proctorIconFactory('action.back', 14),
				nextIcon: proctorIconFactory('action.forward', 14)
			})
		);
		this.pager.element.hidden = true;
		this._register(this.pager.onDidRequestPage((page) => this.showPage(page, true)));
		this.table.hidden = true;
		this.showPage(1, false);
	}

	/** The rows on the page shown. */
	get rows(): readonly AdminListItem<K>[] {
		return this.items;
	}

	get onDidRequestAction(): Event<void> {
		return this.section.onDidRequestAction;
	}

	setActive(active: boolean): void {
		this.active = active;
		this.read.value?.setActive(active);
	}

	/** Reads from the first page with new filters. */
	setQuery(query: AdminListQuery<K>): void {
		this.query = query;
		this.cursors = [undefined];
		this.showPage(1, false);
	}

	/** Reads the shown page again, as after a change to one of its rows. */
	refresh(): Promise<boolean> {
		return this.read.value?.refresh() ?? Promise.resolve(false);
	}

	focusRow(id: string): boolean {
		const target = this.body.querySelector<HTMLElement>(
			`[data-row-id="${CSS.escape(id)}"] .prctr-admin-list__more, [data-row-id="${CSS.escape(id)}"] .prctr-admin-list__open`
		);
		target?.focus();
		return target !== null;
	}

	private showPage(page: number, announce: boolean): void {
		if (page < 1 || page > this.cursors.length) return;
		this.page = page;
		const cursor = this.cursors[page - 1];
		const intent = {
			...this.query,
			kind: this.kind,
			limit: ADMINISTRATION_PAGE_SIZE,
			...(cursor === undefined ? {} : { cursor })
		} as unknown as AdministrationIntentOf<K>;
		const read = new PageRead<
			AdministrationValue<K>,
			AdministrationFailure,
			AdministrationResponse
		>({
			source: {
				request: () => this.administration.request(intent),
				observe: (listener) => this.administration.observe(intent, listener)
			},
			interpret: (response) => {
				if (response.kind === 'data' && response.data.resource === this.kind)
					return { kind: 'data', data: response.data.value as AdministrationValue<K> };
				return {
					kind: 'failure',
					reason: response.kind === 'error' ? response.reason : 'invalid'
				};
			},
			withdraws: administrationFailureWithdraws,
			timeout: 'unavailable'
		});
		this.announce = announce;
		this.read.value = read;
		this.readListener.value = read.onDidChange(() => this.render());
		this.render();
		if (this.active) read.setActive(true);
		else void read.refresh();
	}

	private render(): void {
		const read = this.read.value;
		if (read === undefined) return;
		const data = read.data as
			{ readonly items: readonly AdminListItem<K>[]; readonly cursor?: string } | undefined;
		const state = read.state;
		const retry =
			state.kind === 'failed' && !retriable(state.reason)
				? undefined
				: () => void read.refresh();
		const filtered = this.options.filteredEmpty !== undefined && hasFilter(this.query);
		// The section's empty state applies only when the table has no rows of its own.
		const empty =
			data !== undefined && data.items.length > 0
				? false
				: filtered
					? this.options.filteredEmpty!
					: this.options.empty;
		this.section.setState(state, empty, retry);
		if (data === undefined) {
			this.items = [];
			this.table.hidden = true;
			this.pager.element.hidden = true;
			return;
		}
		this.items = data.items;
		if (data.cursor !== undefined) this.cursors[this.page] = data.cursor;
		else this.cursors.length = this.page;
		this.renderRows(data.items);
		const first = (this.page - 1) * ADMINISTRATION_PAGE_SIZE + 1;
		const hasNext = data.cursor !== undefined;
		this.pager.element.hidden = this.page === 1 && !hasNext;
		this.pager.setState({
			page: this.page,
			pageSize: ADMINISTRATION_PAGE_SIZE,
			first,
			last: first + data.items.length - 1,
			hasNext,
			knownPages: this.cursors.length
		});
		if (state.kind === 'ready') this.loadEmitter.fire(data.items);
		if (this.announce && state.kind === 'ready') {
			this.announce = false;
			this.pane.announce(
				this.format.text('pageShownOpen', {
					page: this.page,
					first,
					last: first + data.items.length - 1
				})
			);
			const target = this.body.querySelector<HTMLElement>(
				'.prctr-admin-list__open, .prctr-admin-list__more'
			);
			if (target !== null) target.focus();
		}
	}

	private renderRows(items: readonly AdminListItem<K>[]): void {
		this.rowStore.clear();
		const $ = createElementFactory(this.body.ownerDocument);
		this.body.replaceChildren(
			...items.map((item) => {
				const row = $('tr', { data: { rowId: this.options.rowId(item) } });
				this.options.columns.forEach((column, index) => {
					const cell = $('td', { data: { align: column.align ?? 'start' } });
					const content = this.renderCell($, column.cell(item));
					if (index === 0 && this.options.open !== undefined) {
						const open = $(
							'button.prctr-admin-list__open',
							{ type: 'button' },
							content
						);
						this.rowStore.add(
							addDisposableListener(open, 'click', () => this.options.open!(item))
						);
						cell.append(open);
					} else cell.append(content);
					row.append(cell);
				});
				if (this.options.actions !== undefined) {
					const actions = this.options.actions(item);
					const cell = $('td', { data: { align: 'end' } });
					if (actions.length > 0)
						cell.append(this.createMenuButton($, this.options.rowName(item), actions));
					row.append(cell);
				}
				return row;
			})
		);
		this.table.hidden = items.length === 0;
	}

	private renderCell($: ReturnType<typeof createElementFactory>, cell: AdminCell): HTMLElement {
		switch (cell.kind) {
			case 'person':
				return $(
					'span.prctr-admin-list__person',
					{},
					$('span.prctr-admin-list__avatar', {
						textContent: initialsOf(cell.name),
						attrs: { 'aria-hidden': 'true' }
					}),
					$(
						'span.prctr-admin-list__text',
						{},
						$('span.prctr-admin-list__primary', {
							data: { strong: 'true' },
							textContent: cell.name
						}),
						...(cell.detail === undefined
							? []
							: [$('span.prctr-admin-list__secondary', { textContent: cell.detail })])
					)
				);
			case 'text':
				return $(
					'span.prctr-admin-list__text',
					{},
					$('span.prctr-admin-list__primary', {
						textContent: cell.primary,
						data: {
							strong: String(cell.strong === true),
							mono: String(cell.mono === true)
						}
					}),
					...(cell.secondary === undefined || cell.secondary === ''
						? []
						: [$('span.prctr-admin-list__secondary', { textContent: cell.secondary })])
				);
			case 'status':
				return $(
					'span.prctr-admin-list__status',
					{ data: { tone: cell.tone } },
					$('span.prctr-admin-list__dot', { attrs: { 'aria-hidden': 'true' } }),
					cell.text
				);
			case 'check': {
				const element = $('span.prctr-admin-list__check', {
					attrs: { role: 'img', 'aria-label': cell.label }
				});
				if (cell.on)
					element.append(
						this.rowStore.add(
							createProctorIcon(element.ownerDocument, {
								id: 'action.confirm',
								size: 16
							})
						).element
					);
				else
					element.append(
						$('span', { textContent: '—', attrs: { 'aria-hidden': 'true' } })
					);
				return element;
			}
		}
	}

	private createMenuButton(
		$: ReturnType<typeof createElementFactory>,
		name: string,
		actions: readonly PageRowAction[]
	): HTMLButtonElement {
		const label = this.format.text('rowActions', { name });
		const button = $('button.prctr-admin-list__more', {
			type: 'button',
			title: label,
			attrs: { 'aria-label': label, 'aria-haspopup': 'menu', 'aria-expanded': 'false' }
		});
		button.append(
			this.rowStore.add(
				createProctorIcon(button.ownerDocument, { id: 'action.more', size: 18 })
			).element
		);
		const ordered = [
			...actions.filter((action) => action.destructive !== true),
			...actions.filter((action) => action.destructive === true)
		];
		const firstDestructive = ordered.findIndex((action) => action.destructive === true);
		const entries: MenuEntry[] = ordered.map((action, index) => ({
			label: action.label,
			icon: proctorIconFactory(action.icon, 16),
			destructive: action.destructive === true,
			separatorBefore: index > 0 && index === firstDestructive,
			enabled: action.enabled !== false,
			run: action.run
		}));
		const open = (): void => {
			this.pane.menu.show(button, entries, label);
			if (!this.pane.menu.visible) return;
			button.setAttribute('aria-expanded', 'true');
			const store = this.rowStore.add(new DisposableStore());
			store.add(
				this.pane.menu.onDidChangeVisibility((visible) => {
					if (visible) return;
					button.setAttribute('aria-expanded', 'false');
					this.rowStore.delete(store);
				})
			);
		};
		this.rowStore.add(addDisposableListener(button, 'click', open));
		this.rowStore.add(
			addDisposableListener(button, 'keydown', (event) => {
				if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
				event.preventDefault();
				open();
			})
		);
		return button;
	}
}

/** A refusal or a lost session will not change by trying again. */
function retriable(reason: AdministrationFailure): boolean {
	return (
		reason !== 'noAccess' &&
		reason !== 'denied' &&
		reason !== 'sessionEnded' &&
		reason !== 'strongRequired'
	);
}

function hasFilter(query: object): boolean {
	return Object.values(query).some((value) => value !== undefined && value !== false);
}

export function initialsOf(name: string): string {
	return name
		.trim()
		.split(/\s+/u)
		.slice(0, 2)
		.map((part) => part[0]?.toLocaleUpperCase() ?? '')
		.join('');
}
