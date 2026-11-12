/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { createElementFactory } from '../../../../base/browser/documentElements.js';
import { addDisposableListener } from '../../../../base/browser/dom.js';
import { Emitter, type Event } from '../../../../base/common/event.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { createProctorIcon } from '../../../../platform/theme/browser/proctorIcon.js';
import type { WorkbenchOverlayHost } from '../../overlayHost.js';
import './media/pageDialog.css';

export interface PageDialogOptions {
	readonly title: string;
	readonly description?: string;
	/** An alert dialog asks to confirm a consequential change. */
	readonly role?: 'dialog' | 'alertdialog';
	/** 480, 560 or 720 pixels wide. */
	readonly size?: 'small' | 'medium' | 'large';
	/**
	 * Whether the header shows ×. Only a dialog with something irreversible in flight leaves it
	 * out; such a dialog also refuses Escape.
	 */
	readonly closable?: boolean;
}

/** What a dialog needs from the page that opens it. */
export interface PageDialogHost {
	readonly document: Document;
	readonly overlays: WorkbenchOverlayHost;
	/** The accessible name of ×. */
	readonly closeLabel: string;
	/** Moves focus to the page, when whatever opened the dialog is gone. */
	focusPage(): void;
}

let dialogSequence = 0;

/**
 * A modal dialog over AuthenticatedWindow, in three bands: a header with the title, one line
 * of explanation and ×; a body that scrolls on its own when it is taller than the window; and
 * a footer that keeps the actions in view, with a footnote beside them. The native modal
 * dialog makes the rest of the window inert and keeps focus inside; closing returns focus to
 * whatever opened it. Escape and × ask the owner to close, so an owner busy with a change can
 * refuse.
 */
export class PageDialog extends Disposable {
	readonly element: HTMLDialogElement;
	/** The dialog's own content, between its header and its footer. */
	readonly body: HTMLElement;
	/** The dialog's buttons, at the end of the footer. */
	readonly actions: HTMLElement;

	private readonly footnote: HTMLElement;
	private readonly close: HTMLButtonElement;
	private readonly title: HTMLElement;
	private readonly description: HTMLElement;

	private readonly cancelEmitter = this._register(new Emitter<void>());
	/** Escape or × asked to close the dialog. */
	readonly onDidRequestCancel: Event<void> = this.cancelEmitter.event;

	private readonly returnFocus: HTMLElement | undefined;
	/** The dialog is closing on purpose, so its close event is not a request to cancel. */
	private hiding = false;
	private readonly fallbackFocus: () => void;

	constructor(host: PageDialogHost, options: PageDialogOptions) {
		super();
		const document = host.document;
		this.fallbackFocus = () => host.focusPage();
		const active = document.activeElement;
		this.returnFocus = active instanceof HTMLElement ? active : undefined;
		const $ = createElementFactory(document);
		const id = `prctr-page-dialog-${++dialogSequence}`;
		const title = $('h2.prctr-page-dialog__title', {
			id: `${id}-title`,
			textContent: options.title
		});
		this.title = title;
		this.close = $('button.prctr-page-dialog__close', {
			type: 'button',
			title: host.closeLabel,
			attrs: { 'aria-label': host.closeLabel }
		});
		this.close.append(
			this._register(createProctorIcon(document, { id: 'action.close', size: 16 })).element
		);
		this.close.hidden = options.closable === false;
		this.description = $('p.prctr-page-dialog__description', {
			id: `${id}-description`,
			textContent: options.description ?? '',
			hidden: options.description === undefined
		});
		const heading = $('div.prctr-page-dialog__heading', {}, title, this.description);
		const header = $('div.prctr-page-dialog__header', {}, heading, this.close);
		this.body = $('div.prctr-page-dialog__body');
		this.footnote = $('p.prctr-page-dialog__footnote', {
			id: `${id}-footnote`,
			attrs: { 'aria-live': 'polite' }
		});
		this.footnote.hidden = true;
		this.actions = $('div.prctr-page-dialog__actions');
		this.element = $(
			'dialog.prctr-page-dialog',
			{
				data: { size: options.size ?? 'small' },
				attrs: {
					role: options.role ?? 'dialog',
					'aria-labelledby': title.id,
					'aria-describedby': `${id}-description`
				}
			},
			header,
			this.body,
			$('div.prctr-page-dialog__footer', {}, this.footnote, this.actions)
		);
		// The overlay layer's parent carries the window theme, so the dialog inherits it.
		(host.overlays.element.parentElement ?? document.body).append(this.element);
		this._register(host.overlays.acquireExternalModal());
		this._register(
			addDisposableListener(this.element, 'cancel', (event) => {
				event.preventDefault();
				if (!this.close.hidden) this.cancelEmitter.fire();
			})
		);
		this._register(addDisposableListener(this.close, 'click', () => this.cancelEmitter.fire()));
		// A browser may close a modal dialog on a repeated Escape without a cancel event the page
		// can refuse. That close is a request like any other: the owner decides, and a dialog it
		// keeps opens again rather than staying shut but alive.
		this._register(
			addDisposableListener(this.element, 'close', () => {
				if (this._store.isDisposed) return;
				if (this.hiding) {
					// The close event arrives after the close it reports.
					this.hiding = false;
					return;
				}
				if (!this.close.hidden) this.cancelEmitter.fire();
				if (!this._store.isDisposed && !this.element.open) this.element.showModal();
			})
		);
	}

	/** Steps aside for another dialog, such as Confirm it's you; {@link show} brings it back. */
	hide(): void {
		if (!this.element.open) return;
		this.hiding = true;
		this.element.close();
	}

	show(initialFocus: HTMLElement): void {
		this.element.showModal();
		initialFocus.focus();
		// The body hides its scrollbar, so a body taller than the dialog takes focus and the
		// arrow keys instead.
		const view = this.element.ownerDocument.defaultView;
		if (view?.ResizeObserver === undefined) return;
		const observer = new view.ResizeObserver(() => {
			const scrolls = this.body.scrollHeight > this.body.clientHeight + 1;
			if (scrolls) this.body.tabIndex = 0;
			else this.body.removeAttribute('tabindex');
		});
		observer.observe(this.body);
		this._register({ dispose: () => observer.disconnect() });
	}

	/** Renames the dialog, as once what it shows has loaded. */
	setHeading(title: string, description?: string): void {
		this.title.textContent = title;
		this.description.textContent = description ?? '';
		this.description.hidden = description === undefined;
	}

	/** The quiet line beside the actions, such as "3 addresses · 1 to fix". */
	setFootnote(text: string | undefined): void {
		this.footnote.textContent = text ?? '';
		this.footnote.hidden = text === undefined || text === '';
	}

	/** Shows or leaves out ×; without it, Escape does nothing either. */
	setClosable(closable: boolean): void {
		this.close.hidden = !closable;
	}

	override dispose(): void {
		if (this._store.isDisposed) return;
		const hadFocus = this.element.contains(this.element.ownerDocument.activeElement);
		this.hide();
		this.element.remove();
		super.dispose();
		if (!hadFocus) return;
		if (this.returnFocus?.isConnected && !this.returnFocus.closest('[inert],[hidden]'))
			this.returnFocus.focus();
		else this.fallbackFocus();
	}
}
