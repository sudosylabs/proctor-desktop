/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { createElementFactory } from '../../../../base/browser/documentElements.js';
import { addDisposableListener } from '../../../../base/browser/dom.js';
import { createStatusBadge } from '../../../../base/browser/ui/badge/statusBadge.js';
import { ButtonControl } from '../../../../base/browser/ui/button/buttonControl.js';
import { Emitter, type Event } from '../../../../base/common/event.js';
import {
	Disposable,
	DisposableStore,
	MutableDisposable
} from '../../../../base/common/lifecycle.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import {
	ADMINISTRATION_PAGE_SIZE,
	ADMINISTRATION_PAGE_SIZES,
	type AdministrationPageSize,
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
import { createRowMenuButton } from '../../../browser/authenticated/pages/rowMenuButton.js';
import {
	PageSection,
	type PageEmpty,
	type PageRowAction
} from '../../../browser/authenticated/pages/pageSection.js';
import { IPagePaneContext } from '../../../browser/authenticated/pages/pagePaneContext.js';
import { IAdministrationService } from '../../../services/administration/common/administration.js';
import { IAdministrationListsService } from '../../../services/administration/common/administrationLists.js';
import { IAdministrationFormatService } from '../administrationFormat.js';
import { administrationFailureWithdraws } from '../common/administrationPresentation.js';
import {
	foldColumns,
	type AdminColumnLayout,
	type AdminTablePlan,
	type AdminTone
} from '../common/adminTableLayout.js';
import './media/adminList.css';

export type { AdminTone } from '../common/adminTableLayout.js';

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

/** What one table cell shows, in the forms the Administration boards draw. */
export type AdminCell =
	| {
			readonly kind: 'person';
			readonly name: string;
			readonly detail?: string;
			/** The person's picture as a data URL, once read. */
			readonly photo?: string;
	  }
	| {
			readonly kind: 'text';
			readonly primary: string;
			readonly secondary?: string;
			/** Names the row, as an email does in a list of invitations. */
			readonly strong?: boolean;
			/** Dates and counts line up as tabular figures. */
			readonly mono?: boolean;
			/** Ordinary text reads in the primary colour; the rest of a row is quieter. */
			readonly quiet?: boolean;
			/** The second line names a problem, or something that lapses soon. */
			readonly secondaryTone?: 'fail' | 'attention';
	  }
	/** A status word, shown as a badge without an icon. */
	| {
			readonly kind: 'status';
			readonly text: string;
			readonly tone: AdminTone;
	  }
	| { readonly kind: 'check'; readonly on: boolean; readonly label: string }
	/** The row's one obvious action, such as Retry. */
	| {
			readonly kind: 'button';
			readonly label: string;
			/** Every button has an icon, except Cancel. */
			readonly icon?: ProctorIconId;
			readonly run: () => void;
	  }
	| { readonly kind: 'empty' };

export interface AdminColumn<T> extends AdminColumnLayout {
	cell(item: T): AdminCell;
	/**
	 * The server order this column's header asks for, and the direction it takes when first
	 * chosen: dates start newest first, names A to Z.
	 */
	readonly sort?: {
		readonly key: string;
		readonly first: AdminSortDirection;
		/** Offered only once the page knows the viewer may use it, by {@link AdminList.enableSort}. */
		readonly gated?: boolean;
	};
}

export type AdminSortDirection = 'asc' | 'desc';
export interface AdminSort {
	readonly key: string;
	readonly dir: AdminSortDirection;
}

export interface AdminListOptions<K extends AdminListKind> {
	/** The section heading; a page's only table has none and is named by `label`. */
	readonly title?: string;
	readonly description?: string;
	/** The table's accessible name, used by its pager too. */
	readonly label: string;
	readonly columns: readonly AdminColumn<AdminListItem<K>>[];
	rowId(item: AdminListItem<K>): string;
	/** The row's name, for its actions button and its checkbox. */
	rowName(item: AdminListItem<K>): string;
	/** Rows the page leaves out of the shown page, such as the audit log's reads. */
	hidden?(item: AdminListItem<K>): boolean;
	/** Opens the row's own page from its first cell. */
	open?(item: AdminListItem<K>): void;
	/** The row's actions; the destructive ones come last after a separator. */
	actions?(item: AdminListItem<K>): readonly PageRowAction[];
	/** Rows can be chosen for one change to all of them. */
	readonly selectable?: boolean;
	readonly empty: string | PageEmpty;
	/** Drawn above the empty and filtered-empty states. */
	readonly icon?: ProctorIconId;
	/** Rows other filters would show; replaces `empty` while any filter is set. */
	readonly filteredEmpty?: string | PageEmpty;
	/**
	 * Whether the query narrows what the person would see by default. Without it, any set
	 * field counts, which suits lists that start unfiltered.
	 */
	readonly filtered?: (query: AdminListQuery<K>) => boolean;
	readonly action?: { readonly label: string; readonly icon: ProctorIconId };
	/** How the server can order the list; each sortable column names its key. */
	readonly sorting?: {
		readonly initial: AdminSort;
		/** The query fields that ask the server for this order. */
		params(sort: AdminSort): Partial<AdminListQuery<K>>;
	};
	/** The filters above the list; a refusal hides them, since nothing can be narrowed. */
	readonly filters?: { readonly element: HTMLElement };
	/** The list can start from a day: the query fields for "up to the end of this day". */
	readonly dateJump?: (endOfDay: number) => Partial<AdminListQuery<K>>;
}

/**
 * One server-paged list shown as a table without a card: hairline rows, ten at a time,
 * Previous and Next by the cursors the server issued, and the section's loading, slow, failed,
 * stale and empty states. As the table narrows, its lesser columns fold into the first
 * column's second line; only when what is left still cannot fit does it scroll sideways with
 * its first column pinned. The first page carries the list's total when the server counts it.
 * A refusal reads as a calm state without a retry, since trying again cannot change the answer.
 */
export class AdminList<K extends AdminListKind> extends Disposable {
	readonly section: PageSection;
	private readonly root: HTMLElement;
	private readonly wrap: HTMLElement;
	private readonly frame: HTMLElement;
	private readonly table: HTMLTableElement;
	private readonly colgroup: HTMLTableColElement;
	private readonly headRow: HTMLTableRowElement;
	private readonly body: HTMLTableSectionElement;
	private readonly foot: HTMLElement;
	private readonly range: HTMLElement;
	private readonly hint: HTMLElement;
	private readonly steps: HTMLElement;
	private readonly pageSizeButton: ButtonControl;
	private readonly jump: HTMLInputElement | undefined;
	private readonly previous: ButtonControl;
	private readonly next: ButtonControl;
	private readonly pageAll: HTMLInputElement | undefined;
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
	private readonly selectionEmitter = this._register(new Emitter<readonly AdminListItem<K>[]>());
	/** The chosen rows changed. */
	readonly onDidChangeSelection: Event<readonly AdminListItem<K>[]> = this.selectionEmitter.event;

	private query: AdminListQuery<K>;
	/** The cursor that reads each page; the first page needs none. */
	private cursors: (string | undefined)[] = [undefined];
	private page = 1;
	private active = false;
	private items: readonly AdminListItem<K>[] = [];
	/** The first page's count, kept while the person moves through later pages. */
	private total: { readonly count: number; readonly atLeast: boolean } | undefined;
	private readonly chosen = new Set<string>();
	private sort: AdminSort | undefined;
	private readonly enabledSorts = new Set<string>();
	private pageSize: AdministrationPageSize = ADMINISTRATION_PAGE_SIZE;
	/** The day the list starts from, as the end of that day; unset shows the newest. */
	private jumpTo: number | undefined;
	private width = 0;
	private folded = '';

	constructor(
		host: HTMLElement,
		private readonly kind: K,
		query: AdminListQuery<K>,
		private readonly options: AdminListOptions<K>,
		@IAdministrationService private readonly administration: IAdministrationService,
		@IAdministrationFormatService private readonly format: IAdministrationFormatService,
		@IPagePaneContext private readonly pane: IPagePaneContext,
		@IInstantiationService instantiationService: IInstantiationService,
		@IAdministrationListsService private readonly lists: IAdministrationListsService
	) {
		super();
		this.query = query;
		// Each list remembers its page size in the person's settings, by the list's name.
		this.pageSize = lists.pageSize(kind) ?? ADMINISTRATION_PAGE_SIZE;
		void lists.ready.then(() => {
			const remembered = lists.pageSize(kind);
			if (this._store.isDisposed || remembered === undefined || remembered === this.pageSize)
				return;
			this.applyPageSize(remembered);
		});
		this.sort = options.sorting?.initial;
		this.section = this._register(
			instantiationService.createInstance(PageSection, host, {
				title: options.title ?? '',
				...(options.description === undefined ? {} : { description: options.description }),
				...(options.action === undefined ? {} : { action: options.action }),
				plain: true
			})
		);
		this.section.setAction(options.action !== undefined);
		const document = host.ownerDocument;
		const $ = createElementFactory(document);
		this.body = $('tbody');
		this.colgroup = $('colgroup');
		this.headRow = $('tr');
		this.table = $(
			'table.prctr-admin-list__table',
			{ attrs: { 'aria-label': options.label } },
			this.colgroup,
			$('thead', {}, this.headRow),
			this.body
		);
		this.table.dataset.selectable = String(options.selectable === true);
		if (options.selectable === true) {
			this.pageAll = $('input.prctr-admin-list__select', {
				type: 'checkbox',
				attrs: { 'aria-label': format.text('listSelectPage') }
			});
			this._register(
				addDisposableListener(this.pageAll, 'change', () => {
					const on = this.pageAll!.checked;
					for (const item of this.shownItems())
						if (on) this.chosen.add(options.rowId(item));
						else this.chosen.delete(options.rowId(item));
					this.renderRows();
					this.selectionEmitter.fire(this.selection);
				})
			);
		}
		this.frame = $('div.prctr-admin-list__frame', {}, this.table);
		this.range = $('span.prctr-admin-list__range');
		this.hint = $('span.prctr-admin-list__hint', {
			textContent: format.text('listScrollHint')
		});
		this.steps = $('div.prctr-admin-list__steps', {
			attrs: { role: 'navigation', 'aria-label': format.pagerLabels(options.label).name }
		});
		this.previous = this._register(
			new ButtonControl(this.steps, {
				variant: 'secondary',
				size: 'small',
				label: format.text('pagerPrevious'),
				icon: proctorIconFactory('action.back', 14)
			})
		);
		this.next = this._register(
			new ButtonControl(this.steps, {
				variant: 'secondary',
				size: 'small',
				label: format.text('pagerNext'),
				icon: proctorIconFactory('action.forward', 14)
			})
		);
		this.pageSizeButton = this._register(
			new ButtonControl($('div.prctr-admin-list__size'), {
				variant: 'ghost',
				size: 'small',
				label: format.text('listPageSize', { count: format.count(this.pageSize) }),
				icon: proctorIconFactory('action.expand', 14)
			})
		);
		this._register(this.pageSizeButton.onDidRequest(() => this.choosePageSize()));
		if (options.dateJump !== undefined) {
			const input = $('input.prctr-admin-list__jump-input', { type: 'date' });
			this.jump = input;
			this._register(
				addDisposableListener(input, 'change', () => {
					const day = input.valueAsNumber;
					// The end of the chosen day in local time, so that day's rows are included.
					this.jumpTo = Number.isNaN(day)
						? undefined
						: new Date(
								new Date(day).getUTCFullYear(),
								new Date(day).getUTCMonth(),
								new Date(day).getUTCDate() + 1
							).getTime();
					this.restart();
				})
			);
		}
		this._register(this.previous.onDidRequest(() => this.showPage(this.page - 1, true)));
		this._register(this.next.onDidRequest(() => this.showPage(this.page + 1, true)));
		const tools = $('div.prctr-admin-list__tools');
		if (this.jump !== undefined)
			tools.append(
				$(
					'label.prctr-admin-list__jump',
					{},
					$('span', { textContent: format.text('listGoToDate') }),
					this.jump
				)
			);
		tools.append(this.pageSizeButton.element);
		this.foot = $(
			'div.prctr-admin-list__foot',
			{},
			$('div.prctr-admin-list__notes', {}, this.range, this.hint),
			tools,
			this.steps
		);
		this.wrap = $(
			'div.prctr-admin-list__wrap',
			{},
			this.frame,
			$('div.prctr-admin-list__fade', { attrs: { 'aria-hidden': 'true' } })
		);
		this.root = $('div.prctr-admin-list', {}, this.wrap, this.foot);
		this.section.content.append(this.root);
		this.wrap.hidden = true;
		this.foot.hidden = true;
		this._register(
			addDisposableListener(this.frame, 'scroll', () => this.updateFade(), { passive: true })
		);
		const view = document.defaultView;
		if (view?.ResizeObserver !== undefined) {
			const observer = new view.ResizeObserver(() => this.layout());
			observer.observe(this.section.content);
			this._register({ dispose: () => observer.disconnect() });
		}
		this.showPage(1, false);
	}

	/** The rows on the page shown. */
	get rows(): readonly AdminListItem<K>[] {
		return this.items;
	}

	/** The rows chosen on the page shown. */
	get selection(): readonly AdminListItem<K>[] {
		return this.items.filter((item) => this.chosen.has(this.options.rowId(item)));
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
		this.restart();
	}

	/** A new order, page size, filter or start day: a cursor belongs to the old one. */
	private restart(): void {
		this.cursors = [undefined];
		this.total = undefined;
		this.showPage(1, false);
	}

	/** Offers a gated order, as Last active for a viewer who sees the whole Institution. */
	enableSort(key: string): void {
		if (this.enabledSorts.has(key)) return;
		this.enabledSorts.add(key);
		this.renderRows();
	}

	private setSort(key: string, first: AdminSortDirection): void {
		const dir: AdminSortDirection =
			this.sort?.key === key ? (this.sort.dir === 'asc' ? 'desc' : 'asc') : first;
		this.sort = { key, dir };
		this.restart();
	}

	private applyPageSize(size: AdministrationPageSize): void {
		this.pageSize = size;
		this.pageSizeButton.setState({
			label: this.format.text('listPageSize', { count: this.format.count(size) }),
			icon: proctorIconFactory('action.expand', 14)
		});
		this.restart();
	}

	private choosePageSize(): void {
		const button = this.pageSizeButton.element;
		this.pane.menu.show(
			button,
			ADMINISTRATION_PAGE_SIZES.map((size) => ({
				label: this.format.text('listPageSize', { count: this.format.count(size) }),
				...(size === this.pageSize
					? { icon: proctorIconFactory('action.confirm', 16) }
					: {}),
				run: () => {
					if (size === this.pageSize) return;
					this.applyPageSize(size);
					void this.lists.setPageSize(this.kind, size);
				}
			})),
			this.format.text('listPageSizeChoice')
		);
	}

	/** How many the list holds, from its first page, when the server counts it. */
	get totalCount(): { readonly count: number; readonly atLeast: boolean } | undefined {
		return this.total;
	}

	/** Focuses the checkbox that chooses the whole page. */
	focusPageAll(): void {
		this.pageAll?.focus();
	}

	clearSelection(): void {
		if (this.chosen.size === 0) return;
		this.chosen.clear();
		this.renderRows();
		this.selectionEmitter.fire([]);
	}

	/** Draws the shown rows again, as once names they show have arrived. */
	redraw(): void {
		this.renderRows();
	}

	/** Reads the shown page again, as after a change to one of its rows. */
	refresh(): Promise<boolean> {
		return this.read.value?.refresh() ?? Promise.resolve(false);
	}

	focusRow(id: string): boolean {
		const row = `[data-row-id="${CSS.escape(id)}"]`;
		const target = this.body.querySelector<HTMLElement>(
			`${row} .prctr-admin-list__more, ${row} .prctr-admin-list__open, ${row} .prctr-admin-list__select`
		);
		target?.focus();
		return target !== null;
	}

	private showPage(page: number, announce: boolean): void {
		if (page < 1 || page > this.cursors.length) return;
		this.page = page;
		if (this.chosen.size > 0) {
			this.chosen.clear();
			this.selectionEmitter.fire([]);
		}
		const cursor = this.cursors[page - 1];
		const intent = {
			...this.query,
			...(this.sort === undefined ? {} : this.options.sorting!.params(this.sort)),
			...(this.jumpTo === undefined ? {} : this.options.dateJump!(this.jumpTo)),
			kind: this.kind,
			limit: this.pageSize,
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
			| {
					readonly items: readonly AdminListItem<K>[];
					readonly cursor?: string;
					readonly total?: number;
					readonly totalAtLeast?: boolean;
			  }
			| undefined;
		const state = read.state;
		const retry =
			state.kind === 'failed' && !retriable(state.reason)
				? undefined
				: () => void read.refresh();
		const filtered =
			this.options.filteredEmpty !== undefined &&
			(this.options.filtered?.(this.query) ?? hasFilter(this.query));
		// The section's empty state applies only when the table has no rows of its own.
		const shown = filtered ? this.options.filteredEmpty! : this.options.empty;
		const empty =
			data !== undefined && data.items.length > 0
				? false
				: {
						icon: this.options.icon,
						...(typeof shown === 'string' ? { text: shown } : shown)
					};
		this.section.setState(state, empty, retry);
		if (this.options.filters !== undefined)
			this.options.filters.element.hidden =
				state.kind === 'failed' &&
				(state.reason === 'noAccess' || state.reason === 'denied');
		if (data === undefined) {
			this.items = [];
			this.wrap.hidden = true;
			this.foot.hidden = true;
			return;
		}
		this.items = data.items;
		if (this.page === 1 && data.total !== undefined)
			this.total = { count: data.total, atLeast: data.totalAtLeast === true };
		if (data.cursor !== undefined) this.cursors[this.page] = data.cursor;
		else this.cursors.length = this.page;
		this.renderRows();
		const first = (this.page - 1) * this.pageSize + 1;
		const last = first + data.items.length - 1;
		const hasNext = data.cursor !== undefined;
		const paged = this.page > 1 || hasNext;
		const labels = this.format.pagerLabels(this.options.label);
		this.range.textContent =
			data.items.length === 0
				? ''
				: this.format.text('listShowing', {
						range: labels.range(
							first,
							last,
							this.total?.count,
							this.total?.atLeast === true
						)
					});
		// Every counted list says how many it holds; an uncounted one only once it has pages.
		this.range.hidden = data.items.length === 0 || (!paged && this.total === undefined);
		this.steps.hidden = !paged;
		this.previous.setState({
			label: this.format.text('pagerPrevious'),
			icon: proctorIconFactory('action.back', 14),
			disabled: this.page === 1
		});
		this.next.setState({
			label: this.format.text('pagerNext'),
			icon: proctorIconFactory('action.forward', 14),
			disabled: !hasNext
		});
		this.updateFoot();
		if (state.kind === 'ready') this.loadEmitter.fire(data.items);
		if (this.announce && state.kind === 'ready') {
			this.announce = false;
			this.pane.announce(this.format.text('pageShownOpen', { page: this.page, first, last }));
			const target = this.body.querySelector<HTMLElement>(
				'.prctr-admin-list__open, .prctr-admin-list__more, .prctr-admin-list__select'
			);
			if (target !== null) target.focus();
		}
	}

	private shownItems(): readonly AdminListItem<K>[] {
		const hidden = this.options.hidden;
		return hidden === undefined ? this.items : this.items.filter((item) => !hidden(item));
	}

	/** Folds columns again when the table's width crosses a threshold. */
	private layout(): void {
		const width = this.section.content.clientWidth;
		if (width === 0 || width === this.width) return;
		this.width = width;
		const plan = this.plan();
		const key = plan.hidden.join();
		if (key !== this.folded) this.renderRows();
		else this.applyOverflow(plan.minimum);
	}

	/** The table is 24 pixels wider than its column, so cell text lines up with the heading. */
	private tableWidth(): number {
		return (this.width || this.section.content.clientWidth) + 24;
	}

	private plan(): AdminTablePlan {
		return foldColumns(this.options.columns, this.sampleKinds(), this.tableWidth(), {
			select: this.options.selectable === true,
			more: this.options.actions !== undefined
		});
	}

	private sampleKinds(): readonly string[] {
		const sample = this.shownItems()[0];
		return this.options.columns.map((column) =>
			sample === undefined ? 'text' : sampleKind(column.cell(sample))
		);
	}

	private renderRows(): void {
		const focus = this.focusedPlace();
		this.rowStore.clear();
		const $ = createElementFactory(this.body.ownerDocument);
		const shown = this.shownItems();
		const columns = this.options.columns;
		const plan = this.plan();
		this.folded = plan.hidden.join();
		const visible = columns.map((_, index) => !plan.hidden.includes(index));
		const target = plan.foldInto;

		// Columns and their header.
		const cols: HTMLTableColElement[] = [];
		const headers: HTMLTableCellElement[] = [];
		if (this.pageAll !== undefined) {
			cols.push($('col', { data: { kind: 'select' } }));
			headers.push($('th', { data: { kind: 'select' } }, this.pageAll));
		}
		columns.forEach((column, index) => {
			if (!visible[index]) return;
			const col = $('col');
			const width = plan.widths[index];
			if (width !== undefined) col.style.width = width;
			cols.push(col);
			headers.push(this.renderHeader($, column));
		});
		if (this.options.actions !== undefined) {
			cols.push($('col', { data: { kind: 'more' } }));
			headers.push($('th', { data: { kind: 'more' } }));
		}
		this.colgroup.replaceChildren(...cols);
		this.headRow.replaceChildren(...headers);

		// Rows.
		let twoLines = false;
		const rows = shown.map((item) => {
			const id = this.options.rowId(item);
			const name = this.options.rowName(item);
			const on = this.chosen.has(id);
			const cells = columns.map((column) => column.cell(item));
			const extra = plan.hidden
				.map((index) => foldedText(columns[index]!, cells[index]!))
				.filter((text): text is string => text !== undefined);
			const row = $('tr', { data: { rowId: id, selected: String(on) } });
			if (this.pageAll !== undefined) {
				const box = $('input.prctr-admin-list__select', {
					type: 'checkbox',
					attrs: { 'aria-label': this.format.text('listSelectRow', { name }) }
				});
				box.checked = on;
				this.rowStore.add(
					addDisposableListener(box, 'change', () => {
						if (box.checked) this.chosen.add(id);
						else this.chosen.delete(id);
						row.dataset.selected = String(box.checked);
						this.updatePageAll();
						this.selectionEmitter.fire(this.selection);
					})
				);
				row.append($('td', { data: { kind: 'select' } }, box));
			}
			columns.forEach((column, index) => {
				if (!visible[index]) return;
				let cell = cells[index]!;
				if (index === target && extra.length > 0) cell = withSecondLine(cell, extra);
				if (
					(cell.kind === 'text' && (cell.secondary ?? '') !== '') ||
					(cell.kind === 'person' && (cell.detail ?? '') !== '')
				)
					twoLines = true;
				const td = $('td', {
					data: {
						align: column.align ?? 'start',
						kind: cell.kind,
						wrap: String(column.wrap === true)
					}
				});
				const content = this.renderCell($, cell);
				if (index === plan.first && this.options.open !== undefined) {
					const open = $('button.prctr-admin-list__open', { type: 'button' }, content);
					this.rowStore.add(
						addDisposableListener(open, 'click', () => this.options.open!(item))
					);
					td.append(open);
				} else td.append(content);
				row.append(td);
			});
			if (this.options.actions !== undefined) {
				const actions = this.options.actions(item);
				const td = $('td', { data: { kind: 'more' } });
				if (actions.length > 0) td.append(this.createMenuButton($, name, actions));
				row.append(td);
			}
			return row;
		});
		this.body.replaceChildren(...rows);
		this.body.dataset.lines = twoLines ? '2' : '1';
		this.wrap.hidden = shown.length === 0;
		this.updatePageAll();
		this.applyOverflow(plan.minimum);
		this.restoreFocus(focus);
	}

	private renderHeader(
		$: ReturnType<typeof createElementFactory>,
		column: AdminColumn<AdminListItem<K>>
	): HTMLTableCellElement {
		const sort = column.sort;
		const th = $('th', {
			attrs: { scope: 'col' },
			data: { align: column.align ?? 'start' }
		});
		if (
			sort === undefined ||
			this.options.sorting === undefined ||
			(sort.gated === true && !this.enabledSorts.has(sort.key))
		) {
			th.textContent = column.label;
			return th;
		}
		const sorted = this.sort?.key === sort.key ? this.sort.dir : undefined;
		th.setAttribute(
			'aria-sort',
			sorted === undefined ? 'none' : sorted === 'asc' ? 'ascending' : 'descending'
		);
		const button = $(
			'button.prctr-admin-list__sort',
			{
				type: 'button',
				data: { sortKey: sort.key, sorted: String(sorted !== undefined) }
			},
			$('span', { textContent: column.label })
		);
		if (sorted !== undefined)
			button.append(
				this.rowStore.add(
					createProctorIcon(button.ownerDocument, {
						id: sorted === 'asc' ? 'action.sortAscending' : 'action.sortDescending',
						size: 14
					})
				).element
			);
		this.rowStore.add(
			addDisposableListener(button, 'click', () => this.setSort(sort.key, sort.first))
		);
		th.append(button);
		return th;
	}

	/** Where keyboard focus is in the table, so a redraw can put it back. */
	private focusedPlace(): { readonly row?: string; readonly selector: string } | undefined {
		const active = this.root.ownerDocument.activeElement;
		if (!(active instanceof HTMLElement) || !this.table.contains(active)) return undefined;
		const sortKey = active.closest<HTMLElement>('.prctr-admin-list__sort')?.dataset.sortKey;
		if (sortKey !== undefined)
			return { selector: `.prctr-admin-list__sort[data-sort-key="${CSS.escape(sortKey)}"]` };
		if (active === this.pageAll) return { selector: 'thead .prctr-admin-list__select' };
		const row = active.closest<HTMLElement>('tr[data-row-id]')?.dataset.rowId;
		const kind = [
			'prctr-admin-list__open',
			'prctr-admin-list__more',
			'prctr-admin-list__select'
		].find((name) => active.classList.contains(name));
		if (row === undefined || kind === undefined) return undefined;
		return { row, selector: `.${kind}` };
	}

	private restoreFocus(place: ReturnType<AdminList<K>['focusedPlace']>): void {
		if (place === undefined) return;
		const scope =
			place.row === undefined
				? this.table
				: this.body.querySelector<HTMLElement>(`[data-row-id="${CSS.escape(place.row)}"]`);
		scope?.querySelector<HTMLElement>(place.selector)?.focus();
	}

	private applyOverflow(minimum: number): void {
		const overflows = minimum > this.tableWidth();
		this.wrap.dataset.overflow = String(overflows);
		this.table.style.minWidth = overflows ? `${minimum}px` : '';
		this.updateFade();
		this.updateFoot();
	}

	private updateFade(): void {
		const end = this.frame.scrollLeft + this.frame.clientWidth >= this.frame.scrollWidth - 1;
		this.wrap.dataset.end = String(end);
	}

	private updateFoot(): void {
		this.hint.hidden = this.wrap.hidden || this.wrap.dataset.overflow !== 'true';
		// A page whose rows are all hidden, as reads under Changes only, still offers Next.
		const rows = this.items.length > 0;
		this.foot.hidden = !rows || (this.range.hidden && this.steps.hidden && this.hint.hidden);
	}

	private updatePageAll(): void {
		if (this.pageAll === undefined) return;
		const ids = this.shownItems().map((item) => this.options.rowId(item));
		const count = ids.filter((id) => this.chosen.has(id)).length;
		this.pageAll.checked = count > 0 && count === ids.length;
		this.pageAll.indeterminate = count > 0 && count < ids.length;
	}

	private renderCell($: ReturnType<typeof createElementFactory>, cell: AdminCell): HTMLElement {
		switch (cell.kind) {
			case 'person': {
				// The person's picture, their own or the default the server draws; initials
				// stand in only until it has arrived.
				const avatar = $('span.prctr-admin-list__avatar', {
					attrs: { 'aria-hidden': 'true' }
				});
				if (cell.photo !== undefined)
					avatar.append($('img', { alt: '', src: cell.photo, draggable: false }));
				else avatar.textContent = initialsOf(cell.name);
				return $(
					'span.prctr-admin-list__person',
					{},
					avatar,
					$(
						'span.prctr-admin-list__text',
						{},
						$('span.prctr-admin-list__primary', {
							data: { strong: 'true' },
							textContent: cell.name,
							title: cell.name
						}),
						...(cell.detail === undefined || cell.detail === ''
							? []
							: [
									$('span.prctr-admin-list__secondary', {
										textContent: cell.detail,
										title: cell.detail
									})
								])
					)
				);
			}
			case 'text':
				return $(
					'span.prctr-admin-list__text',
					{},
					$('span.prctr-admin-list__primary', {
						textContent: cell.primary,
						title: cell.primary,
						data: {
							strong: String(cell.strong === true),
							mono: String(cell.mono === true),
							quiet: String(cell.quiet === true)
						}
					}),
					...(cell.secondary === undefined || cell.secondary === ''
						? []
						: [
								$('span.prctr-admin-list__secondary', {
									textContent: cell.secondary,
									title: cell.secondary,
									data: { tone: cell.secondaryTone ?? '' }
								})
							])
				);
			case 'status':
				return createStatusBadge(this.body.ownerDocument, {
					text: cell.text,
					tone: cell.tone
				});
			case 'check': {
				const element = $('span.prctr-admin-list__check', {
					attrs: { role: 'img', 'aria-label': cell.label },
					data: { on: String(cell.on) }
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
			case 'button': {
				const holder = $('span.prctr-admin-list__button');
				const button = this.rowStore.add(
					new ButtonControl(holder, {
						variant: 'secondary',
						size: 'small',
						label: cell.label,
						...(cell.icon === undefined
							? {}
							: { icon: proctorIconFactory(cell.icon, 14) })
					})
				);
				this.rowStore.add(button.onDidRequest(cell.run));
				return holder;
			}
			case 'empty':
				return $('span');
		}
	}

	private createMenuButton(
		_$: ReturnType<typeof createElementFactory>,
		name: string,
		actions: readonly PageRowAction[]
	): HTMLButtonElement {
		return createRowMenuButton(this.rowStore, this.pane.menu, this.body.ownerDocument, {
			label: this.format.text('rowActions', { name }),
			actions,
			className: 'prctr-admin-list__more'
		});
	}
}

function sampleKind(cell: AdminCell): string {
	return cell.kind === 'text' && cell.mono === true ? 'mono' : cell.kind;
}

/** A folded cell's value, labelled when a bare value would not say what it is. */
function foldedText<T>(column: AdminColumn<T>, cell: AdminCell): string | undefined {
	const value =
		cell.kind === 'text'
			? cell.primary
			: cell.kind === 'person'
				? cell.name
				: cell.kind === 'status'
					? cell.text
					: undefined;
	if (value === undefined || value === '' || value === '—') return undefined;
	const labelled = column.foldLabel ?? (cell.kind === 'text' && cell.mono === true);
	return labelled ? `${column.label} ${value}` : value;
}

function withSecondLine(cell: AdminCell, extra: readonly string[]): AdminCell {
	if (cell.kind === 'text')
		return { ...cell, secondary: [cell.secondary, ...extra].filter(Boolean).join(' · ') };
	if (cell.kind === 'person')
		return { ...cell, detail: [cell.detail, ...extra].filter(Boolean).join(' · ') };
	return cell;
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
