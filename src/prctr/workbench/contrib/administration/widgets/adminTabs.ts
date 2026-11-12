/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { createElementFactory } from '../../../../base/browser/documentElements.js';
import { addDisposableListener } from '../../../../base/browser/dom.js';
import { Emitter, type Event } from '../../../../base/common/event.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import './media/adminTabs.css';

export interface AdminTab<T extends string> {
	readonly id: T;
	readonly label: string;
}

/**
 * Views of one record side by side, such as a unit's programmes and its members: an underlined
 * tab strip. Arrow keys, Home and End move between tabs and choose; only the chosen tab is in
 * the tab order. The owner shows the chosen view.
 */
export class AdminTabs<T extends string> extends Disposable {
	readonly element: HTMLElement;
	private readonly tabs: readonly { readonly id: T; readonly button: HTMLButtonElement }[];
	private readonly counts = new Map<T, HTMLElement>();
	private current: T;
	private static next = 0;
	private readonly prefix = `prctr-admin-tabs-${AdminTabs.next++}`;
	private readonly changeEmitter = this._register(new Emitter<T>());
	readonly onDidChange: Event<T> = this.changeEmitter.event;

	constructor(host: HTMLElement, label: string, tabs: readonly AdminTab<T>[], value: T) {
		super();
		const $ = createElementFactory(host.ownerDocument);
		this.current = value;
		this.tabs = tabs.map((tab) => {
			const count = $('span.prctr-admin-tabs__count', { hidden: true });
			this.counts.set(tab.id, count);
			const button = $(
				'button.prctr-admin-tabs__tab',
				{ type: 'button', id: `${this.prefix}-${tab.id}`, attrs: { role: 'tab' } },
				$('span', { textContent: tab.label }),
				count
			);
			this._register(
				addDisposableListener(button, 'click', () => this.choose(tab.id, false))
			);
			return { id: tab.id, button };
		});
		this.element = $(
			'div.prctr-admin-tabs',
			{ attrs: { role: 'tablist', 'aria-label': label } },
			...this.tabs.map((tab) => tab.button)
		);
		this._register(
			addDisposableListener(this.element, 'keydown', (event) => {
				const index = this.tabs.findIndex((tab) => tab.id === this.current);
				const last = this.tabs.length - 1;
				const next =
					event.key === 'ArrowRight'
						? index === last
							? 0
							: index + 1
						: event.key === 'ArrowLeft'
							? index === 0
								? last
								: index - 1
							: event.key === 'Home'
								? 0
								: event.key === 'End'
									? last
									: undefined;
				if (next === undefined) return;
				event.preventDefault();
				this.choose(this.tabs[next]!.id, true);
			})
		);
		host.append(this.element);
		this.render();
	}

	get value(): T {
		return this.current;
	}

	/** A quiet count after a tab's label, such as how many members a unit has. */
	setCount(id: T, text: string | undefined): void {
		const count = this.counts.get(id);
		if (count === undefined) return;
		count.textContent = text ?? '';
		count.hidden = text === undefined;
	}

	/** Names the element a tab shows, so assistive technology can tie the two together. */
	setPanel(id: T, panel: HTMLElement): void {
		const tab = this.tabs.find((candidate) => candidate.id === id);
		if (tab === undefined) return;
		panel.id ||= `${this.prefix}-${id}-panel`;
		panel.setAttribute('role', 'tabpanel');
		panel.setAttribute('aria-labelledby', tab.button.id);
		tab.button.setAttribute('aria-controls', panel.id);
	}

	choose(id: T, focus: boolean): void {
		const changed = id !== this.current;
		this.current = id;
		this.render();
		if (focus) this.tabs.find((tab) => tab.id === id)?.button.focus();
		if (changed) this.changeEmitter.fire(id);
	}

	private render(): void {
		for (const tab of this.tabs) {
			const on = tab.id === this.current;
			tab.button.setAttribute('aria-selected', String(on));
			tab.button.tabIndex = on ? 0 : -1;
		}
	}
}
