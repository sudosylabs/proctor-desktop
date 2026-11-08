/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { createElementFactory } from '../../../../base/browser/documentElements.js';
import { addDisposableListener } from '../../../../base/browser/dom.js';
import { Emitter, type Event } from '../../../../base/common/event.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import type { WorkbenchOverlayHost } from '../../overlayHost.js';
import './media/pageDialog.css';

export interface PageDialogOptions {
	readonly title: string;
	readonly description?: string;
	/** An alert dialog asks to confirm a consequential change. */
	readonly role?: 'dialog' | 'alertdialog';
	readonly size?: 'small' | 'medium';
}

let dialogSequence = 0;

/**
 * A modal dialog over AuthenticatedWindow. The native modal dialog makes the rest
 * of the window inert and keeps focus inside; closing returns focus to whatever
 * opened it. Escape asks the owner to close, so an owner busy with a change can
 * refuse.
 */
export class PageDialog extends Disposable {
	readonly element: HTMLDialogElement;
	/** The dialog's own content, between its heading and its buttons. */
	readonly body: HTMLElement;
	readonly actions: HTMLElement;

	private readonly cancelEmitter = this._register(new Emitter<void>());
	readonly onDidRequestCancel: Event<void> = this.cancelEmitter.event;

	private readonly returnFocus: HTMLElement | undefined;
	private readonly fallbackFocus: () => void;

	constructor(
		document: Document,
		overlays: WorkbenchOverlayHost,
		options: PageDialogOptions,
		fallbackFocus: () => void
	) {
		super();
		this.fallbackFocus = fallbackFocus;
		const active = document.activeElement;
		this.returnFocus = active instanceof HTMLElement ? active : undefined;
		const $ = createElementFactory(document);
		const id = `prctr-page-dialog-${++dialogSequence}`;
		const title = $('h2.prctr-page-dialog__title', {
			id: `${id}-title`,
			textContent: options.title
		});
		const header = $('div.prctr-page-dialog__header', {}, title);
		if (options.description !== undefined)
			header.append(
				$('p.prctr-page-dialog__description', {
					id: `${id}-description`,
					textContent: options.description
				})
			);
		this.body = $('div.prctr-page-dialog__body');
		this.actions = $('div.prctr-page-dialog__actions');
		this.element = $(
			'dialog.prctr-page-dialog',
			{
				data: { size: options.size ?? 'small' },
				attrs: {
					role: options.role ?? 'dialog',
					'aria-labelledby': title.id,
					...(options.description === undefined
						? {}
						: { 'aria-describedby': `${id}-description` })
				}
			},
			header,
			this.body,
			this.actions
		);
		// The overlay layer's parent carries the window theme, so the dialog inherits it.
		(overlays.element.parentElement ?? document.body).append(this.element);
		this._register(overlays.acquireExternalModal());
		this._register(
			addDisposableListener(this.element, 'cancel', (event) => {
				event.preventDefault();
				this.cancelEmitter.fire();
			})
		);
	}

	show(initialFocus: HTMLElement): void {
		this.element.showModal();
		initialFocus.focus();
	}

	override dispose(): void {
		if (this._store.isDisposed) return;
		const hadFocus = this.element.contains(this.element.ownerDocument.activeElement);
		if (this.element.open) this.element.close();
		this.element.remove();
		super.dispose();
		if (!hadFocus) return;
		if (this.returnFocus?.isConnected && !this.returnFocus.closest('[inert],[hidden]'))
			this.returnFocus.focus();
		else this.fallbackFocus();
	}
}
