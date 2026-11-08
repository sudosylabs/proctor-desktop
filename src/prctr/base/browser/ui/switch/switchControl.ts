/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { createElementFactory } from '../../documentElements.js';
import { addDisposableListener } from '../../dom.js';
import { Emitter, type Event } from '../../../common/event.js';
import { Disposable } from '../../../common/lifecycle.js';
import './switchControl.css';

export interface SwitchOptions {
	/** The accessible name; a visible label normally sits beside it. */
	readonly label: string;
	readonly on: boolean;
	readonly disabled?: boolean;
}

/** An on/off setting that applies at once, as `role="switch"`. */
export class SwitchControl extends Disposable {
	readonly element: HTMLButtonElement;
	private readonly changeEmitter = this._register(new Emitter<boolean>());
	/** The person turned it on or off. The control already shows it. */
	readonly onDidChange: Event<boolean> = this.changeEmitter.event;
	private current: boolean;

	constructor(host: HTMLElement, options: SwitchOptions) {
		super();
		const $ = createElementFactory(host.ownerDocument);
		this.current = options.on;
		this.element = $(
			'button.prctr-switch',
			{ type: 'button', attrs: { role: 'switch', 'aria-label': options.label } },
			$('span.prctr-switch__knob', { attrs: { 'aria-hidden': 'true' } })
		);
		this.element.disabled = options.disabled === true;
		this._register(
			addDisposableListener(this.element, 'click', () => {
				this.current = !this.current;
				this.render();
				this.changeEmitter.fire(this.current);
			})
		);
		host.append(this.element);
		this.render();
	}

	get on(): boolean {
		return this.current;
	}

	setOn(on: boolean): void {
		this.current = on;
		this.render();
	}

	setDisabled(disabled: boolean): void {
		this.element.disabled = disabled;
	}

	private render(): void {
		this.element.setAttribute('aria-checked', String(this.current));
	}
}
