/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { createElementFactory } from '../../../../base/browser/documentElements.js';
import { addDisposableListener } from '../../../../base/browser/dom.js';
import {
	SelectControl,
	type SelectChoice
} from '../../../../base/browser/ui/select/selectControl.js';
import { ButtonControl } from '../../../../base/browser/ui/button/buttonControl.js';
import type { MenuControl } from '../../../../base/browser/ui/menu/menuControl.js';
import { Disposable, toDisposable } from '../../../../base/common/lifecycle.js';
import {
	createProctorIcon,
	proctorIconFactory
} from '../../../../platform/theme/browser/proctorIcon.js';
import type { ProctorIconId } from '../../../../platform/theme/common/proctorIcons.js';
import './media/adminFilters.css';

/** Typing settles for this long before a search is sent. */
const SEARCH_SETTLE_MS = 300;

/**
 * The bar above an Administration list: a search field, the list's filters as selects, and a
 * short note at the end, such as how many rows a page shows. While rows are chosen, the bar
 * shows how many and the changes that apply to all of them instead.
 */
export class AdminFilters extends Disposable {
	readonly element: HTMLElement;
	/** Where the owner puts the changes for chosen rows. */
	readonly selectionActions: HTMLElement;
	private readonly note: HTMLElement;
	private readonly selection: HTMLElement;
	private readonly selectionCount: HTMLElement;
	private readonly more: {
		readonly label: string;
		readonly holder: HTMLElement;
		readonly select: SelectControl<string>;
	}[] = [];
	private moreButton: ButtonControl | undefined;
	private moreAvailable = true;

	constructor(host: HTMLElement) {
		super();
		const $ = createElementFactory(host.ownerDocument);
		this.note = $('span.prctr-admin-filters__note', { attrs: { 'aria-live': 'polite' } });
		this.selectionCount = $('span.prctr-admin-filters__count', {
			attrs: { 'aria-live': 'polite' }
		});
		this.selectionActions = $('div.prctr-admin-filters__actions');
		this.selection = $(
			'div.prctr-admin-filters__selection',
			{ attrs: { role: 'toolbar' } },
			this.selectionCount,
			this.selectionActions
		);
		this.selection.hidden = true;
		this.element = $(
			'div.prctr-admin-filters',
			{},
			$('span.prctr-admin-filters__spacer'),
			this.note,
			this.selection
		);
		host.append(this.element);
	}

	/**
	 * Shows the chosen rows' count and changes in place of the filters; `undefined` brings the
	 * filters back. `label` names the toolbar.
	 */
	setSelection(count: string | undefined, label?: string): void {
		const selecting = count !== undefined;
		this.element.dataset.selecting = String(selecting);
		this.selection.hidden = !selecting;
		this.selectionCount.textContent = count ?? '';
		if (label !== undefined) this.selection.setAttribute('aria-label', label);
	}

	/** A search field; `onChange` hears the settled text, or undefined once it is cleared. */
	addSearch(
		label: string,
		onChange: (text: string | undefined) => void,
		minimum = 1
	): HTMLInputElement {
		const $ = createElementFactory(this.element.ownerDocument);
		const icon = this._register(
			createProctorIcon(this.element.ownerDocument, { id: 'action.search', size: 14 })
		);
		const input = $('input.prctr-admin-filters__input', {
			type: 'search',
			placeholder: label,
			attrs: { 'aria-label': label, maxlength: '100' }
		});
		const field = $('label.prctr-admin-filters__find', {}, icon.element, input);
		this.element.insertBefore(
			field,
			this.element.querySelector('.prctr-admin-filters__spacer')
		);
		let timer: ReturnType<typeof setTimeout> | undefined;
		let last: string | undefined;
		const settle = (): void => {
			const text = input.value.trim();
			const value = text.length >= minimum ? text : undefined;
			if (value === last) return;
			last = value;
			onChange(value);
		};
		this._register(
			addDisposableListener(input, 'input', () => {
				clearTimeout(timer);
				timer = setTimeout(settle, SEARCH_SETTLE_MS);
			})
		);
		this._register(
			addDisposableListener(input, 'keydown', (event) => {
				if (event.key !== 'Enter') return;
				clearTimeout(timer);
				settle();
			})
		);
		this._register(toDisposable(() => clearTimeout(timer)));
		return input;
	}

	/**
	 * A filter chosen from a short list. A `more` filter starts out of the bar and is added from
	 * More filters; it leaves again once set back to `value`, its no-filter choice.
	 */
	addSelect<T extends string>(
		label: string,
		icon: ProctorIconId,
		choices: readonly SelectChoice<T>[],
		value: T,
		onChange: (value: T) => void,
		more = false
	): SelectControl<T> {
		const holder = createElementFactory(this.element.ownerDocument)(
			'span.prctr-admin-filters__select'
		);
		holder.hidden = more;
		this.element.insertBefore(
			holder,
			this.element.querySelector('.prctr-admin-filters__spacer')
		);
		const select = this._register(
			new SelectControl(holder, {
				label,
				choices,
				value,
				icon: proctorIconFactory(icon, 16),
				caret: proctorIconFactory('action.expand', 14),
				fit: 'content'
			})
		);
		this._register(
			select.onDidChange((next) => {
				if (more && next === value) {
					holder.hidden = true;
					this.moreButton?.element.focus();
				}
				this.updateMore();
				onChange(next);
			})
		);
		if (more)
			this.more.push({ label, holder, select: select as unknown as SelectControl<string> });
		return select;
	}

	/**
	 * Adds More filters at the end of the filters: a menu of the filters not in the bar, each
	 * added as its own pill when chosen. The menu is gone while every filter is shown.
	 */
	addMoreFilters(label: string, menu: MenuControl): void {
		const holder = createElementFactory(this.element.ownerDocument)(
			'span.prctr-admin-filters__more'
		);
		this.element.insertBefore(
			holder,
			this.element.querySelector('.prctr-admin-filters__spacer')
		);
		const button = this._register(
			new ButtonControl(holder, {
				variant: 'ghost',
				label,
				icon: proctorIconFactory('action.filter', 16)
			})
		);
		this.moreButton = button;
		this._register(
			button.onDidRequest(() =>
				menu.show(
					button.element,
					this.more
						.filter((filter) => filter.holder.hidden)
						.map((filter) => ({
							label: filter.label,
							run: () => {
								filter.holder.hidden = false;
								this.updateMore();
								filter.select.focus();
							}
						})),
					label
				)
			)
		);
		this.updateMore();
	}

	/** Hides or shows More filters for viewers who can't use them, as a scoped administrator. */
	setMoreFiltersAvailable(available: boolean): void {
		this.moreAvailable = available;
		this.updateMore();
	}

	private updateMore(): void {
		if (this.moreButton === undefined) return;
		this.moreButton.element.parentElement!.hidden =
			!this.moreAvailable || this.more.every((filter) => !filter.holder.hidden);
	}

	setNote(text: string): void {
		this.note.textContent = text;
	}
}
