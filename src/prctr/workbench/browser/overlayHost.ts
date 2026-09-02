/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { Disposable, DisposableStore, type IDisposable } from '../../base/common/lifecycle.js';
import { Emitter, type Event } from '../../base/common/event.js';
import { addDisposableListener } from '../../base/browser/dom.js';
import { ButtonControl } from '../../base/browser/ui/button/button.js';
import './overlayHost.css';

export interface OverlayAction { readonly id: string; readonly label: string; readonly variant: 'danger' | 'primary' | 'secondary'; readonly onRequest: () => void }
export interface ModalOverlayOptions {
	readonly kind: 'dialog' | 'gate'; readonly title: string; readonly message: string; readonly accessibleLabel: string; readonly actions: readonly OverlayAction[]; readonly dismissOnEscape?: boolean;
}

export class WorkbenchOverlayHost extends Disposable {
	readonly element: HTMLDivElement; readonly #visibility = this._register(new Emitter<boolean>()); readonly onDidChangeVisibility: Event<boolean> = this.#visibility.event; #active: IDisposable | undefined; #visible = false; #replacing = false;
	readonly #inertRoot: HTMLElement;
	constructor(host: HTMLElement, inertRoot: HTMLElement) { super(); this.#inertRoot = inertRoot; this.#inertRoot.tabIndex = -1; this.element = host.ownerDocument.createElement('div'); this.element.className = 'prctr-overlay-host'; this.element.hidden = true; host.append(this.element); }
	get visible(): boolean { return this.#visible; }
	show(options: ModalOverlayOptions): IDisposable {
		if (options.actions.length === 0 && options.kind === 'dialog') throw new Error('A dialog requires at least one bounded action');
		if (this.#active !== undefined) { this.#replacing = true; try { this.#active.dispose(); } finally { this.#replacing = false; } } const store = new DisposableStore(); const document = this.element.ownerDocument; const priorFocus = document.activeElement instanceof HTMLElement ? document.activeElement : undefined;
		const surface = document.createElement('section'); surface.className = 'prctr-overlay-host__surface'; surface.role = options.kind === 'gate' ? 'alertdialog' : 'dialog'; surface.setAttribute('aria-modal', 'true'); surface.setAttribute('aria-label', options.accessibleLabel); surface.tabIndex = -1;
		const title = document.createElement('h2'); title.className = 'prctr-overlay-host__title'; title.textContent = options.title;
		const message = document.createElement('p'); message.className = 'prctr-overlay-host__message'; message.textContent = options.message;
		const actions = document.createElement('div'); actions.className = 'prctr-overlay-host__actions';
		const close = (): void => disposable.dispose();
		for (const action of options.actions) { const button = store.add(new ButtonControl(actions, { label: action.label, variant: action.variant })); store.add(button.onDidRequest(() => { action.onRequest(); if (options.kind === 'dialog') close(); })); }
		surface.append(title, message, actions); this.element.replaceChildren(surface); this.element.hidden = false; this.#inertRoot.inert = true; this.#setVisible(true);
		store.add(addDisposableListener(document, 'keydown', event => {
			if (event.key === 'Escape' && options.dismissOnEscape === true && options.kind === 'dialog') { event.preventDefault(); close(); return; }
			if (event.key !== 'Tab') return;
			const focusable = [...surface.querySelectorAll<HTMLElement>('button:not(:disabled),[href],input:not(:disabled),[tabindex]:not([tabindex="-1"])')];
			if (focusable.length === 0) { event.preventDefault(); surface.focus(); return; }
			const first = focusable[0] as HTMLElement; const last = focusable.at(-1) as HTMLElement;
			if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
			else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
		}));
		const disposable: IDisposable = { dispose: () => {
			if (this.#active !== disposable) return; this.#active = undefined; store.dispose(); this.element.replaceChildren(); this.element.hidden = true; this.#inertRoot.inert = false;
			if (!this.#replacing) this.#setVisible(false);
			this.#restoreFocus(priorFocus);
		} };
		this.#active = disposable; queueMicrotask(() => { (surface.querySelector<HTMLElement>('button:not(:disabled)') ?? surface).focus(); }); return disposable;
	}
	#restoreFocus(priorFocus: HTMLElement | undefined): void { if (priorFocus !== undefined && isRestorableFocusTarget(priorFocus)) { priorFocus.focus(); return; } const fallback = [...this.#inertRoot.querySelectorAll<HTMLElement>('button:not(:disabled),[href],input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex]:not([tabindex="-1"])')].find(isRestorableFocusTarget); (fallback ?? this.#inertRoot).focus(); }
	#setVisible(visible: boolean): void { if (this.#visible === visible) return; this.#visible = visible; this.#visibility.fire(visible); }
	override dispose(): void { this.#active?.dispose(); super.dispose(); this.element.remove(); }
}
function isRestorableFocusTarget(element: HTMLElement): boolean { if (!element.isConnected || element.matches(':disabled,[aria-disabled="true"]') || element.closest('[hidden],[inert],[aria-hidden="true"]') !== null || element.getClientRects().length === 0) return false; const style = element.ownerDocument.defaultView?.getComputedStyle(element); return style === undefined || style.display !== 'none' && style.visibility !== 'hidden'; }
