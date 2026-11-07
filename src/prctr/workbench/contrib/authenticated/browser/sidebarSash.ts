/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { createElementFactory } from '../../../../base/browser/documentElements.js';
import { addDisposableListener } from '../../../../base/browser/dom.js';
import { Emitter, type Event } from '../../../../base/common/event.js';
import {
	Disposable,
	DisposableStore,
	MutableDisposable
} from '../../../../base/common/lifecycle.js';
import {
	SIDEBAR_DEFAULT_WIDTH,
	SIDEBAR_MAX_WIDTH,
	SIDEBAR_MIN_WIDTH,
	clampSidebarWidth
} from './authenticatedLayoutState.js';
import './sidebarSash.css';

const KEYBOARD_STEP = 8;
const KEYBOARD_LARGE_STEP = 32;

/**
 * The separator on the sidebar's trailing edge. Dragging or the arrow keys change
 * the width within its bounds; Home and a double click restore the default.
 */
export class SidebarSash extends Disposable {
	readonly element: HTMLElement;

	private readonly resizeEmitter = this._register(new Emitter<number>());
	/** The width changed while resizing. */
	readonly onDidResize: Event<number> = this.resizeEmitter.event;
	private readonly endEmitter = this._register(new Emitter<number>());
	/** A resize finished at this width. */
	readonly onDidEnd: Event<number> = this.endEmitter.event;

	private readonly drag = this._register(new MutableDisposable<DisposableStore>());
	private width = SIDEBAR_DEFAULT_WIDTH;

	constructor(host: HTMLElement, label: string) {
		super();
		const $ = createElementFactory(host.ownerDocument);
		this.element = $('div.prctr-sidebar-sash', {
			tabIndex: 0,
			attrs: {
				role: 'separator',
				'aria-label': label,
				'aria-orientation': 'vertical',
				'aria-controls': host.id,
				'aria-valuemin': String(SIDEBAR_MIN_WIDTH),
				'aria-valuemax': String(SIDEBAR_MAX_WIDTH)
			}
		});
		host.append(this.element);
		this.registerListeners();
	}

	setWidth(width: number): void {
		this.width = clampSidebarWidth(width);
		this.element.setAttribute('aria-valuenow', String(this.width));
	}

	private registerListeners(): void {
		this._register(
			addDisposableListener(this.element, 'keydown', (event) => this.onKeyDown(event))
		);
		this._register(
			addDisposableListener(this.element, 'dblclick', () => {
				this.commit(SIDEBAR_DEFAULT_WIDTH);
			})
		);
		this._register(
			addDisposableListener(this.element, 'pointerdown', (event) => this.onPointerDown(event))
		);
	}

	private onKeyDown(event: KeyboardEvent): void {
		if (event.key === 'Home') {
			event.preventDefault();
			this.commit(SIDEBAR_DEFAULT_WIDTH);
			return;
		}
		const direction = this.isRightToLeft() ? -1 : 1;
		const step = event.shiftKey ? KEYBOARD_LARGE_STEP : KEYBOARD_STEP;
		const delta =
			event.key === 'ArrowRight'
				? step * direction
				: event.key === 'ArrowLeft'
					? -step * direction
					: 0;
		if (delta === 0) return;
		event.preventDefault();
		this.commit(this.width + delta);
	}

	private onPointerDown(event: PointerEvent): void {
		if (event.button !== 0) return;
		event.preventDefault();
		const start = event.clientX;
		const initial = this.width;
		const direction = this.isRightToLeft() ? -1 : 1;
		this.element.setPointerCapture(event.pointerId);
		this.element.dataset.dragging = 'true';
		const listeners = new DisposableStore();
		this.drag.value = listeners;
		listeners.add({
			dispose: () => {
				delete this.element.dataset.dragging;
				if (this.element.hasPointerCapture(event.pointerId))
					this.element.releasePointerCapture(event.pointerId);
			}
		});
		listeners.add(
			addDisposableListener(this.element, 'pointermove', (move) => {
				this.resize(initial + (move.clientX - start) * direction);
			})
		);
		const finish = (): void => {
			if (this.drag.value !== listeners) return;
			this.drag.clear();
			this.endEmitter.fire(this.width);
		};
		listeners.add(addDisposableListener(this.element, 'pointerup', finish));
		listeners.add(addDisposableListener(this.element, 'pointercancel', finish));
		listeners.add(addDisposableListener(this.element, 'lostpointercapture', finish));
	}

	private resize(width: number): void {
		const bounded = clampSidebarWidth(width);
		if (bounded === this.width) return;
		this.setWidth(bounded);
		this.resizeEmitter.fire(bounded);
	}

	private commit(width: number): void {
		this.resize(width);
		this.endEmitter.fire(this.width);
	}

	private isRightToLeft(): boolean {
		return (
			this.element.ownerDocument.defaultView?.getComputedStyle(this.element).direction ===
			'rtl'
		);
	}

	override dispose(): void {
		super.dispose();
		this.element.remove();
	}
}
