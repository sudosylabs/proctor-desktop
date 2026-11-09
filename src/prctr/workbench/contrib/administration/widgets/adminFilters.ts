/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { createElementFactory } from '../../../../base/browser/documentElements.js';
import { addDisposableListener } from '../../../../base/browser/dom.js';
import {
	SelectControl,
	type SelectChoice
} from '../../../../base/browser/ui/select/selectControl.js';
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
 * short note at the end, such as how many rows a page shows.
 */
export class AdminFilters extends Disposable {
	readonly element: HTMLElement;
	private readonly note: HTMLElement;

	constructor(host: HTMLElement) {
		super();
		const $ = createElementFactory(host.ownerDocument);
		this.note = $('span.prctr-admin-filters__note', { attrs: { 'aria-live': 'polite' } });
		this.element = $(
			'div.prctr-admin-filters',
			{},
			$('span.prctr-admin-filters__spacer'),
			this.note
		);
		host.append(this.element);
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

	/** A filter chosen from a short list. */
	addSelect<T extends string>(
		label: string,
		icon: ProctorIconId,
		choices: readonly SelectChoice<T>[],
		value: T,
		onChange: (value: T) => void
	): SelectControl<T> {
		const holder = createElementFactory(this.element.ownerDocument)(
			'span.prctr-admin-filters__select'
		);
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
				caret: proctorIconFactory('action.expand', 14)
			})
		);
		this._register(select.onDidChange(onChange));
		return select;
	}

	setNote(text: string): void {
		this.note.textContent = text;
	}
}
