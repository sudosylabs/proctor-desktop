/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { createElementFactory } from '../../../../base/browser/documentElements.js';
import { addDisposableListener } from '../../../../base/browser/dom.js';
import { Emitter, type Event } from '../../../../base/common/event.js';
import { Disposable, type IDisposable } from '../../../../base/common/lifecycle.js';
import type { LocalizationContext } from '../../../../base/common/localization.js';
import { createProctorIcon } from '../../../../platform/theme/browser/proctorIcon.js';
import type { ProctorIconId } from '../../../../platform/theme/common/proctorIcons.js';
import { authenticatedMessages as m, type AuthenticatedMessage } from './authenticatedMessages.js';
import './contentTopBar.css';

export type TopBarAction = 'showSidebar' | 'back' | 'forward';

export interface TopBarState {
	readonly sidebarShown: boolean;
	readonly canGoBack: boolean;
	readonly canGoForward: boolean;
}

export interface TopBarHover {
	(target: HTMLElement, label: string, command?: string): IDisposable;
}

/**
 * The top of the content surface: Show sidebar while the sidebar is hidden, back
 * and forward, and the window's search field. Its empty space moves the window.
 */
export class ContentTopBar extends Disposable {
	readonly element: HTMLElement;

	private readonly actionEmitter = this._register(new Emitter<TopBarAction>());
	readonly onDidRequest: Event<TopBarAction> = this.actionEmitter.event;

	private readonly showSidebar: HTMLButtonElement;
	private readonly back: HTMLButtonElement;
	private readonly forward: HTMLButtonElement;
	private readonly search: HTMLInputElement;
	private readonly announcement: HTMLElement;

	constructor(
		host: HTMLElement,
		private readonly localization: LocalizationContext,
		sidebarId: string,
		searchShortcut: { readonly label: string; readonly keys: string },
		hover: TopBarHover
	) {
		super();
		const document = host.ownerDocument;
		const $ = createElementFactory(document);
		this.showSidebar = this.createButton(
			document,
			'showSidebar',
			'action.toggleSidebar',
			'showSidebar'
		);
		this.showSidebar.setAttribute('aria-controls', sidebarId);
		this.showSidebar.setAttribute('aria-expanded', 'false');
		this.back = this.createButton(document, 'back', 'action.back', 'back');
		this.forward = this.createButton(document, 'forward', 'action.forward', 'forward');
		this.search = $('input.prctr-content-top-bar__input', {
			type: 'search',
			placeholder: this.text('searchPlaceholder'),
			attrs: { 'aria-label': this.text('search'), 'aria-keyshortcuts': searchShortcut.keys }
		});
		const field = $(
			'label.prctr-content-top-bar__search',
			{},
			this._register(createProctorIcon(document, { id: 'action.search', size: 16 })).element,
			this.search,
			$('kbd.prctr-content-top-bar__shortcut', {
				textContent: searchShortcut.label,
				attrs: { 'aria-hidden': 'true' }
			})
		);
		const form = $('form.prctr-content-top-bar__form', { attrs: { role: 'search' } }, field);
		this.announcement = $('p.prctr-content-top-bar__announcement', {
			attrs: { role: 'status', 'aria-live': 'polite' }
		});
		this.element = $(
			'div.prctr-content-top-bar',
			{},
			this.showSidebar,
			this.back,
			this.forward,
			$('span.prctr-content-top-bar__spacer'),
			form,
			$('span.prctr-content-top-bar__spacer'),
			$('span.prctr-content-top-bar__balance'),
			this.announcement
		);
		host.prepend(this.element);
		this._register(
			hover(this.showSidebar, this.text('showSidebar'), 'prctr.authenticated.toggleSidebar')
		);
		this._register(hover(this.back, this.text('back'), 'prctr.authenticated.navigateBack'));
		this._register(
			hover(this.forward, this.text('forward'), 'prctr.authenticated.navigateForward')
		);
		this.registerListeners(form);
	}

	private text(key: AuthenticatedMessage): string {
		return this.localization.format(m[key]);
	}

	private createButton(
		document: Document,
		action: TopBarAction,
		icon: ProctorIconId,
		label: AuthenticatedMessage
	): HTMLButtonElement {
		const $ = createElementFactory(document);
		const button = $('button.prctr-content-top-bar__button', {
			type: 'button',
			data: { action },
			attrs: { 'aria-label': this.text(label) }
		});
		button.append(this._register(createProctorIcon(document, { id: icon, size: 18 })).element);
		this._register(
			addDisposableListener(button, 'click', () => {
				this.actionEmitter.fire(action);
			})
		);
		return button;
	}

	private registerListeners(form: HTMLFormElement): void {
		this._register(
			addDisposableListener(form, 'submit', (event) => {
				event.preventDefault();
				// Announce again even when the same message is already shown.
				this.announcement.textContent = '';
				this.announcement.textContent = this.text('searchUnavailable');
			})
		);
		this._register(
			addDisposableListener(this.search, 'input', () => {
				this.announcement.textContent = '';
			})
		);
	}

	render(state: TopBarState): void {
		this.showSidebar.hidden = state.sidebarShown;
		this.showSidebar.setAttribute('aria-expanded', String(state.sidebarShown));
		this.back.disabled = !state.canGoBack;
		this.forward.disabled = !state.canGoForward;
	}

	focusShowSidebar(): boolean {
		if (this.showSidebar.hidden) return false;
		this.showSidebar.focus();
		return true;
	}

	isShowSidebar(target: EventTarget | null): boolean {
		return target === this.showSidebar || this.showSidebar.contains(target as Node | null);
	}

	focusSearch(): void {
		this.search.focus();
		this.search.select();
	}

	override dispose(): void {
		super.dispose();
		this.element.remove();
	}
}
