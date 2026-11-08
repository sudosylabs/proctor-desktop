/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { addDisposableListener } from '../../../base/browser/dom.js';
import { Disposable } from '../../../base/common/lifecycle.js';

/**
 * One tab stop for a vertical list of buttons. Up and Down move between the shown,
 * enabled buttons, Home and End go to the ends, and Tab leaves the list from the
 * button that last had focus or, before that, the current one.
 */
export class RovingFocus extends Disposable {
	constructor(private readonly root: HTMLElement) {
		super();
		this._register(addDisposableListener(root, 'keydown', (event) => this.onKeyDown(event)));
		this._register(
			addDisposableListener(root, 'focusin', (event) => {
				const target = event.target;
				if (target instanceof root.ownerDocument.defaultView!.HTMLButtonElement)
					this.setTabStop(target);
			})
		);
	}

	/** Make `preferred` the tab stop unless focus is already inside the list. */
	update(preferred: HTMLButtonElement | undefined): void {
		const items = this.items();
		const active = this.root.ownerDocument.activeElement;
		const focused = items.find((item) => item === active);
		this.setTabStop(focused ?? (preferred && items.includes(preferred) ? preferred : items[0]));
	}

	focus(): void {
		const items = this.items();
		(items.find((item) => item.tabIndex === 0) ?? items[0])?.focus();
	}

	private items(): HTMLButtonElement[] {
		return [...this.root.querySelectorAll<HTMLButtonElement>('button')].filter(
			(button) => !button.disabled && button.closest('[hidden]') === null
		);
	}

	private setTabStop(target: HTMLButtonElement | undefined): void {
		for (const button of this.root.querySelectorAll<HTMLButtonElement>('button'))
			button.tabIndex = button === target ? 0 : -1;
	}

	private onKeyDown(event: KeyboardEvent): void {
		if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
		const items = this.items();
		const index = items.findIndex((item) => item === event.target);
		if (index < 0) return;
		const next =
			event.key === 'ArrowDown'
				? items[Math.min(items.length - 1, index + 1)]
				: event.key === 'ArrowUp'
					? items[Math.max(0, index - 1)]
					: event.key === 'Home'
						? items[0]
						: event.key === 'End'
							? items.at(-1)
							: undefined;
		if (next === undefined) return;
		event.preventDefault();
		this.setTabStop(next);
		next.focus();
	}
}
