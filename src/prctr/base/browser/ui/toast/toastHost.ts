/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { createElementFactory } from '../../documentElements.js';
import { addDisposableListener } from '../../dom.js';
import {
	Disposable,
	DisposableStore,
	MutableDisposable,
	toDisposable
} from '../../../common/lifecycle.js';
import type { ControlIconFactory } from '../controlIcon.js';
import './toastHost.css';

/** How long a success stays before it leaves on its own. A failure stays until dismissed. */
export const TOAST_SUCCESS_MS = 5_000;

export interface ToastAction {
	readonly label: string;
	readonly icon: ControlIconFactory;
	readonly run: () => void;
}

export interface Toast {
	readonly tone: 'success' | 'failure';
	readonly icon: ControlIconFactory;
	readonly title: string;
	readonly body?: string;
	readonly action?: ToastAction;
}

export interface ToastHostOptions {
	readonly dismissLabel: string;
	readonly dismissIcon: ControlIconFactory;
}

/**
 * Reports the result of something the person just did, bottom right, one at a time. A new toast
 * replaces the current one. It is never the only place a lasting problem is shown.
 */
export class ToastHost extends Disposable {
	readonly element: HTMLDivElement;
	private readonly current = this._register(new MutableDisposable<DisposableStore>());

	constructor(
		host: HTMLElement,
		private readonly options: ToastHostOptions
	) {
		super();
		this.element = createElementFactory(host.ownerDocument)('div.prctr-toast-host');
		host.append(this.element);
		this._register(toDisposable(() => this.element.remove()));
	}

	show(toast: Toast): void {
		const document = this.element.ownerDocument;
		const $ = createElementFactory(document);
		const store = new DisposableStore();
		this.current.value = store;
		const icon = store.add(toast.icon(document));
		const text = $(
			'span.prctr-toast__text',
			{},
			$('span.prctr-toast__title', { textContent: toast.title })
		);
		if (toast.body !== undefined)
			text.append($('span.prctr-toast__body', { textContent: toast.body }));
		const element = $(
			'div.prctr-toast',
			{
				data: { tone: toast.tone },
				attrs: { role: toast.tone === 'failure' ? 'alert' : 'status' }
			},
			$('span.prctr-toast__icon', {}, icon.element),
			text
		);
		if (toast.action !== undefined) {
			const action = toast.action;
			const actionIcon = store.add(action.icon(document));
			const button = $(
				'button.prctr-toast__action',
				{ type: 'button' },
				actionIcon.element,
				action.label
			);
			store.add(
				addDisposableListener(button, 'click', () => {
					this.dismiss();
					action.run();
				})
			);
			element.append(button);
		}
		const closeIcon = store.add(this.options.dismissIcon(document));
		const close = $(
			'button.prctr-toast__close',
			{ type: 'button', attrs: { 'aria-label': this.options.dismissLabel } },
			closeIcon.element
		);
		store.add(addDisposableListener(close, 'click', () => this.dismiss()));
		element.append(close);
		this.element.replaceChildren(element);
		store.add(toDisposable(() => element.remove()));
		if (toast.tone === 'success') {
			const timer = setTimeout(() => {
				if (this.current.value === store) this.dismiss();
			}, TOAST_SUCCESS_MS);
			store.add(toDisposable(() => clearTimeout(timer)));
		}
	}

	dismiss(): void {
		this.current.clear();
	}
}
