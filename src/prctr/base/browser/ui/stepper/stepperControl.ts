/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { createElementFactory } from '../../documentElements.js';
import { addDisposableListener } from '../../dom.js';
import { Emitter, type Event } from '../../../common/event.js';
import { Disposable } from '../../../common/lifecycle.js';
import type { ControlIconFactory } from '../controlIcon.js';
import './stepperControl.css';

export interface StepperOptions {
	readonly label: string;
	readonly value: number;
	readonly minimum: number;
	readonly maximum: number;
	readonly step?: number;
	/** The value as people read it, such as "15 px". */
	readonly format: (value: number) => string;
	readonly decreaseLabel: string;
	readonly increaseLabel: string;
	readonly decreaseIcon: ControlIconFactory;
	readonly increaseIcon: ControlIconFactory;
	readonly disabled?: boolean;
}

/**
 * A bounded number changed one step at a time: a spin button with smaller and larger buttons.
 * Arrow keys step, Home and End jump to the limits.
 */
export class StepperControl extends Disposable {
	readonly element: HTMLDivElement;
	private readonly changeEmitter = this._register(new Emitter<number>());
	/** The person chose a different value. The control already shows it. */
	readonly onDidChange: Event<number> = this.changeEmitter.event;
	private readonly output: HTMLSpanElement;
	private readonly decrease: HTMLButtonElement;
	private readonly increase: HTMLButtonElement;
	private current: number;
	private disabled: boolean;

	constructor(
		host: HTMLElement,
		private readonly options: StepperOptions
	) {
		super();
		const document = host.ownerDocument;
		const $ = createElementFactory(document);
		this.current = options.value;
		this.disabled = options.disabled === true;
		const decreaseIcon = this._register(options.decreaseIcon(document));
		const increaseIcon = this._register(options.increaseIcon(document));
		this.decrease = $(
			'button.prctr-stepper__button',
			{ type: 'button', tabIndex: -1, attrs: { 'aria-label': options.decreaseLabel } },
			decreaseIcon.element
		);
		this.increase = $(
			'button.prctr-stepper__button',
			{ type: 'button', tabIndex: -1, attrs: { 'aria-label': options.increaseLabel } },
			increaseIcon.element
		);
		this.output = $('span.prctr-stepper__value', {
			tabIndex: 0,
			attrs: {
				role: 'spinbutton',
				'aria-label': options.label,
				'aria-valuemin': String(options.minimum),
				'aria-valuemax': String(options.maximum)
			}
		});
		this.element = $('div.prctr-stepper', {}, this.decrease, this.output, this.increase);
		const step = options.step ?? 1;
		this._register(
			addDisposableListener(this.decrease, 'click', () => this.set(this.current - step))
		);
		this._register(
			addDisposableListener(this.increase, 'click', () => this.set(this.current + step))
		);
		this._register(
			addDisposableListener(this.output, 'keydown', (event) => {
				const next: Readonly<Record<string, number>> = {
					ArrowUp: this.current + step,
					ArrowRight: this.current + step,
					ArrowDown: this.current - step,
					ArrowLeft: this.current - step,
					Home: options.minimum,
					End: options.maximum
				};
				const value = next[event.key];
				if (value === undefined) return;
				event.preventDefault();
				this.set(value);
			})
		);
		host.append(this.element);
		this.render();
	}

	get value(): number {
		return this.current;
	}

	setValue(value: number): void {
		this.current = this.clamp(value);
		this.render();
	}

	setDisabled(disabled: boolean): void {
		this.disabled = disabled;
		this.render();
	}

	focus(): void {
		this.output.focus();
	}

	private clamp(value: number): number {
		return Math.min(this.options.maximum, Math.max(this.options.minimum, value));
	}

	private set(value: number): void {
		if (this.disabled) return;
		const next = this.clamp(value);
		if (next === this.current) return;
		this.current = next;
		this.render();
		this.changeEmitter.fire(next);
	}

	private render(): void {
		const text = this.options.format(this.current);
		this.output.textContent = text;
		this.output.setAttribute('aria-valuenow', String(this.current));
		this.output.setAttribute('aria-valuetext', text);
		this.output.setAttribute('aria-disabled', String(this.disabled));
		this.decrease.disabled = this.disabled || this.current <= this.options.minimum;
		this.increase.disabled = this.disabled || this.current >= this.options.maximum;
	}
}
