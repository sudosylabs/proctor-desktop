/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { createElementFactory } from '../../documentElements.js';
import { addDisposableListener } from '../../dom.js';
import { Emitter, type Event } from '../../../common/event.js';
import { Disposable, DisposableStore } from '../../../common/lifecycle.js';
import type { ControlIconFactory } from '../controlIcon.js';
import './segmentedControl.css';

export interface SegmentedOption<T extends string> {
	readonly value: T;
	readonly label: string;
	readonly icon?: ControlIconFactory;
}

export interface SegmentedOptions<T extends string> {
	/** The accessible name of the group; a visible label normally sits beside it. */
	readonly label: string;
	readonly options: readonly SegmentedOption<T>[];
	readonly value: T;
	readonly disabled?: boolean;
}

/**
 * A short choice of two to four values shown side by side, as one radio group. Arrow keys move
 * and choose; only the chosen segment is in the tab order.
 */
export class SegmentedControl<T extends string> extends Disposable {
	readonly element: HTMLDivElement;
	private readonly changeEmitter = this._register(new Emitter<T>());
	/** The person chose a different value. The control already shows it. */
	readonly onDidChange: Event<T> = this.changeEmitter.event;
	private readonly buttons: readonly { readonly value: T; readonly button: HTMLButtonElement }[];
	private readonly icons = this._register(new DisposableStore());
	private current: T;

	constructor(host: HTMLElement, options: SegmentedOptions<T>) {
		super();
		const document = host.ownerDocument;
		const $ = createElementFactory(document);
		this.current = options.value;
		this.element = $('div.prctr-segmented', {
			attrs: { role: 'radiogroup', 'aria-label': options.label }
		});
		this.buttons = options.options.map((option) => {
			const button = $('button.prctr-segmented__option', {
				type: 'button',
				attrs: { role: 'radio' }
			});
			if (option.icon !== undefined)
				button.append(this.icons.add(option.icon(document)).element);
			button.append($('span', { textContent: option.label }));
			this.element.append(button);
			this._register(addDisposableListener(button, 'click', () => this.choose(option.value)));
			return { value: option.value, button };
		});
		this._register(
			addDisposableListener(this.element, 'keydown', (event) => {
				// Left and right follow the reading direction; up and down always mean previous and next.
				const rtl =
					document.defaultView?.getComputedStyle(this.element).direction === 'rtl';
				const steps: Readonly<Record<string, number>> = {
					ArrowUp: -1,
					ArrowDown: 1,
					ArrowLeft: rtl ? 1 : -1,
					ArrowRight: rtl ? -1 : 1
				};
				const step = steps[event.key];
				if (step === undefined) return;
				event.preventDefault();
				const index = this.buttons.findIndex((entry) => entry.value === this.current);
				const count = this.buttons.length;
				const next = this.buttons[(index + step + count) % count];
				if (next === undefined) return;
				this.choose(next.value);
				next.button.focus();
			})
		);
		host.append(this.element);
		this.setDisabled(options.disabled === true);
		this.render();
	}

	get value(): T {
		return this.current;
	}

	setValue(value: T): void {
		this.current = value;
		this.render();
	}

	setDisabled(disabled: boolean): void {
		for (const entry of this.buttons) entry.button.disabled = disabled;
	}

	focus(): void {
		this.buttons.find((entry) => entry.value === this.current)?.button.focus();
	}

	private choose(value: T): void {
		if (value === this.current) return;
		this.current = value;
		this.render();
		this.changeEmitter.fire(value);
	}

	private render(): void {
		for (const entry of this.buttons) {
			const checked = entry.value === this.current;
			entry.button.setAttribute('aria-checked', String(checked));
			entry.button.tabIndex = checked ? 0 : -1;
		}
	}
}
