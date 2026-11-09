/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { createElementFactory } from '../../documentElements.js';
import { addDisposableListener } from '../../dom.js';
import { Emitter, type Event } from '../../../common/event.js';
import { Disposable } from '../../../common/lifecycle.js';
import type { ControlIconFactory } from '../controlIcon.js';
import './selectControl.css';

export interface SelectChoice<T extends string> {
	readonly value: T;
	readonly label: string;
}

export interface SelectOptions<T extends string> {
	/** The accessible name, unless a `<label>` names the select through `id`. */
	readonly label?: string;
	readonly id?: string;
	readonly choices: readonly SelectChoice<T>[];
	readonly value: T;
	readonly icon?: ControlIconFactory;
	readonly caret: ControlIconFactory;
	readonly disabled?: boolean;
	/** As wide as the chosen value, as a filter in a bar is; otherwise at least 200 pixels. */
	readonly fit?: 'content';
}

/**
 * One choice from a list. A native select keeps the platform's own list, keyboard and screen
 * reader behaviour; only the closed field is drawn by Proctor.
 */
export class SelectControl<T extends string> extends Disposable {
	readonly element: HTMLSpanElement;
	readonly select: HTMLSelectElement;
	private readonly changeEmitter = this._register(new Emitter<T>());
	/** The person chose a different value. */
	readonly onDidChange: Event<T> = this.changeEmitter.event;

	constructor(host: HTMLElement, options: SelectOptions<T>) {
		super();
		const document = host.ownerDocument;
		const $ = createElementFactory(document);
		this.select = $('select.prctr-select__input', {
			...(options.id === undefined ? {} : { id: options.id }),
			disabled: options.disabled === true,
			...(options.label === undefined ? {} : { attrs: { 'aria-label': options.label } })
		});
		this.setChoices(options.choices, options.value);
		this.element = $('span.prctr-select');
		if (options.icon !== undefined) {
			const icon = this._register(options.icon(document));
			icon.element.classList.add('prctr-select__icon');
			this.element.append(icon.element);
		}
		const caret = this._register(options.caret(document));
		caret.element.classList.add('prctr-select__caret');
		this.element.append(this.select, caret.element);
		this.element.toggleAttribute('data-icon', options.icon !== undefined);
		this.element.toggleAttribute('data-fit', options.fit === 'content');
		this._register(
			addDisposableListener(this.select, 'change', () =>
				this.changeEmitter.fire(this.select.value as T)
			)
		);
		host.append(this.element);
	}

	get value(): T {
		return this.select.value as T;
	}

	setValue(value: T): void {
		this.select.value = value;
	}

	setChoices(choices: readonly SelectChoice<T>[], value: T): void {
		const $ = createElementFactory(this.select.ownerDocument);
		this.select.replaceChildren(
			...choices.map((choice) =>
				$('option', {
					value: choice.value,
					textContent: choice.label,
					selected: choice.value === value
				})
			)
		);
		this.select.value = value;
	}

	setDisabled(disabled: boolean): void {
		this.select.disabled = disabled;
	}

	focus(): void {
		this.select.focus();
	}
}
