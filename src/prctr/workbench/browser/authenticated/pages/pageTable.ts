/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import type { StatusBadgeTone } from '../../../../base/browser/ui/badge/statusBadge.js';
import { ButtonControl } from '../../../../base/browser/ui/button/buttonControl.js';
import { createElementFactory } from '../../../../base/browser/documentElements.js';
import { Disposable, DisposableStore } from '../../../../base/common/lifecycle.js';
import type { MenuControl } from '../../../../base/browser/ui/menu/menuControl.js';
import { proctorIconFactory } from '../../../../platform/theme/browser/proctorIcon.js';
import type { PageRowAction } from './pageSection.js';
import { createRowMenuButton } from './rowMenuButton.js';
import './media/pageTable.css';

/** What one cell shows, in the forms the boards draw. */
export type PageTableCell =
	| {
			readonly kind: 'text';
			readonly primary: string;
			/** A quieter second line, such as an email under a name. */
			readonly secondary?: string;
			readonly strong?: boolean;
			/** Identifiers, counts and times. */
			readonly mono?: boolean;
			readonly quiet?: boolean;
			/** Long text wraps instead of ending in "…". */
			readonly wrap?: boolean;
	  }
	| { readonly kind: 'word'; readonly text: string; readonly tone: StatusBadgeTone };

export interface PageTableColumn<T> {
	readonly label: string;
	/** A fixed width, as in "56px"; a column without one shares what is left. */
	readonly width?: string;
	readonly align?: 'start' | 'end';
	cell(item: T): PageTableCell;
}

export interface PageTableOptions<T> {
	/** The table's accessible name. */
	readonly label: string;
	readonly columns: readonly PageTableColumn<T>[];
	readonly rowId: (item: T) => string;
	/** A row's ⋯ menu: its accessible name and actions, the destructive ones last. */
	readonly actions?: {
		readonly menu: MenuControl;
		label(item: T): string;
		actions(item: T): readonly PageRowAction[];
	};
	/** Rows per page; the pager steps through the items the page already has. */
	readonly pageSize: number;
	readonly labels: {
		readonly previous: string;
		readonly next: string;
		/** "Showing 1–4 of 7". */
		showing(first: number, last: number, total: number): string;
	};
}

/**
 * A table of rows a record page already holds, such as an import's rows that need a look: the
 * same header, hairlines and cell forms as the server-paged lists, paged in place.
 */
export class PageTable<T> extends Disposable {
	readonly element: HTMLElement;
	private readonly body: HTMLTableSectionElement;
	private readonly range: HTMLElement;
	private readonly previous: ButtonControl;
	private readonly next: ButtonControl;
	private readonly foot: HTMLElement;
	private readonly rowStore = this._register(new DisposableStore());
	private items: readonly T[] = [];
	private page = 1;

	constructor(
		host: HTMLElement,
		private readonly options: PageTableOptions<T>
	) {
		super();
		const $ = createElementFactory(host.ownerDocument);
		this.body = $('tbody');
		const table = $(
			'table.prctr-page-table__table',
			{ attrs: { 'aria-label': options.label } },
			$(
				'colgroup',
				{},
				...options.columns.map((column) => {
					const col = $('col');
					if (column.width !== undefined) col.style.width = column.width;
					return col;
				})
			),
			$(
				'thead',
				{},
				$(
					'tr',
					{},
					...options.columns.map((column) =>
						$('th', {
							textContent: column.label,
							attrs: { scope: 'col' },
							data: { align: column.align ?? 'start' }
						})
					),
					...(options.actions === undefined ? [] : [$('th', { data: { kind: 'more' } })])
				)
			),
			this.body
		);
		this.range = $('span.prctr-page-table__range');
		const steps = $('div.prctr-page-table__steps');
		this.previous = this._register(
			new ButtonControl(steps, {
				variant: 'ghost',
				size: 'small',
				label: options.labels.previous,
				icon: proctorIconFactory('action.back', 14)
			})
		);
		this.next = this._register(
			new ButtonControl(steps, {
				variant: 'ghost',
				size: 'small',
				label: options.labels.next,
				trailingIcon: proctorIconFactory('action.forward', 14)
			})
		);
		this._register(this.previous.onDidRequest(() => this.show(this.page - 1)));
		this._register(this.next.onDidRequest(() => this.show(this.page + 1)));
		this.foot = $('div.prctr-page-table__foot', {}, this.range, steps);
		this.element = $(
			'div.prctr-page-table',
			{},
			$('div.prctr-page-table__frame', {}, table),
			this.foot
		);
		host.append(this.element);
	}

	setItems(items: readonly T[]): void {
		this.items = items;
		this.show(Math.min(this.page, this.pages()));
	}

	private pages(): number {
		return Math.max(1, Math.ceil(this.items.length / this.options.pageSize));
	}

	private show(page: number): void {
		const $ = createElementFactory(this.element.ownerDocument);
		this.page = Math.max(1, Math.min(page, this.pages()));
		this.rowStore.clear();
		const first = (this.page - 1) * this.options.pageSize;
		const shown = this.items.slice(first, first + this.options.pageSize);
		this.body.dataset.lines = shown.some((item) =>
			this.options.columns.some((column) => {
				const cell = column.cell(item);
				return (
					cell.kind === 'text' && cell.secondary !== undefined && cell.secondary !== ''
				);
			})
		)
			? '2'
			: '1';
		this.body.replaceChildren(
			...shown.map((item) =>
				$(
					'tr',
					{ data: { rowId: this.options.rowId(item) } },
					...this.options.columns.map((column) =>
						$(
							'td',
							{ data: { align: column.align ?? 'start' } },
							this.cell(column.cell(item))
						)
					),
					...this.menuCell(item)
				)
			)
		);
		this.range.textContent = this.options.labels.showing(
			first + 1,
			first + shown.length,
			this.items.length
		);
		// Rows that fit on one page need no pager.
		this.foot.hidden = this.pages() === 1;
		this.previous.setState({
			label: this.options.labels.previous,
			icon: proctorIconFactory('action.back', 14),
			disabled: this.page === 1
		});
		this.next.setState({
			label: this.options.labels.next,
			trailingIcon: proctorIconFactory('action.forward', 14),
			disabled: this.page === this.pages()
		});
	}

	private menuCell(item: T): HTMLElement[] {
		const menu = this.options.actions;
		if (menu === undefined) return [];
		const $ = createElementFactory(this.element.ownerDocument);
		const td = $('td', { data: { kind: 'more' } });
		const actions = menu.actions(item);
		if (actions.length > 0)
			td.append(
				createRowMenuButton(this.rowStore, menu.menu, this.element.ownerDocument, {
					label: menu.label(item),
					actions,
					className: 'prctr-page-table__more'
				})
			);
		return [td];
	}

	private cell(cell: PageTableCell): HTMLElement {
		const $ = createElementFactory(this.element.ownerDocument);
		if (cell.kind === 'word')
			return $('span.prctr-page-table__word', {
				textContent: cell.text,
				data: { tone: cell.tone }
			});
		return $(
			'div.prctr-page-table__text',
			{
				data: {
					strong: String(cell.strong === true),
					mono: String(cell.mono === true),
					quiet: String(cell.quiet === true),
					wrap: String(cell.wrap === true)
				}
			},
			$('span.prctr-page-table__primary', { textContent: cell.primary }),
			...(cell.secondary === undefined || cell.secondary === ''
				? []
				: [$('span.prctr-page-table__secondary', { textContent: cell.secondary })])
		);
	}
}
