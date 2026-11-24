/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { Disposable, DisposableStore, MutableDisposable } from '../../base/common/lifecycle.js';
import { addDisposableListener } from '../../base/browser/dom.js';
import { onUnexpectedError } from '../../base/common/errors.js';
import type { WorkbenchComposition, WorkbenchPart } from '../common/composition.js';
import { WorkbenchOverlayHost } from './overlayHost.js';
import './workbenchShell.css';
import './media/style.css';

export interface WorkbenchShellLabels {
	readonly titlebar: string; readonly banner: string; readonly navigation: string; readonly sidebar: string; readonly content: string; readonly panel: string; readonly status: string; readonly resetLayout: string; readonly resizeSidebar: string; readonly resizePanel: string;
}

const MIN_REGION = 160;
let shellSequence = 0;
export class WorkbenchShell extends Disposable {
	declare readonly _serviceBrand: undefined;
	readonly element: HTMLDivElement; readonly overlayHost: WorkbenchOverlayHost;
	readonly composition: WorkbenchComposition;
	readonly #parts = new Map<WorkbenchPart, HTMLElement>(); readonly #compactToggles = new Map<'panel' | 'sidebar', HTMLButtonElement>(); readonly #initialSidebar = 260; readonly #initialPanel = 220; readonly #resetButton: HTMLButtonElement;
	readonly #drag = this._register(new MutableDisposable<DisposableStore>());
	#resetLayoutAction: () => void | Promise<void> = () => this.resetLayout();
	#sidebarSize = this.#initialSidebar; #panelSize = this.#initialPanel; #compactSidebarOpen = false; #compactPanelOpen = false; #disposed = false;
	constructor(host: HTMLElement, composition: WorkbenchComposition, labels: WorkbenchShellLabels) {
		super(); this.composition = composition; const document = host.ownerDocument; const shellId = `prctr-workbench-${++shellSequence}`; this.element = document.createElement('div'); this.element.className = 'prctr-workbench'; this.element.dataset.windowKind = composition.windowKind;
		for (const part of composition.layout.parts) this.#createPart(part, labels[part], document);
		for (const region of ['sidebar', 'panel'] as const) { const part = this.#parts.get(region); if (part !== undefined) { part.id = `${shellId}-${region}`; if (!this.#framed) this.#createCompactToggle(region, labels[region], part.id, document); } }
		if (this.#framed) { this.part('navigation').id = `${shellId}-navigation`; this.setSidebarPresentation('hidden', this.#initialSidebar); }
		if (composition.layout.allowRegionResize && composition.layout.parts.includes('sidebar')) this.#createSash('sidebar', labels.resizeSidebar, document);
		if (composition.layout.allowRegionResize && composition.layout.parts.includes('panel')) this.#createSash('panel', labels.resizePanel, document);
		const reset = document.createElement('button'); reset.className = 'prctr-workbench__reset'; reset.type = 'button'; reset.textContent = labels.resetLayout; this.#resetButton = reset; if (composition.layout.allowRegionResize) this.part('titlebar').append(reset); this._register(addDisposableListener(reset, 'click', () => { void Promise.resolve(this.#resetLayoutAction()).catch(onUnexpectedError); }));
		host.append(this.element); this.overlayHost = this._register(new WorkbenchOverlayHost(host, this.element)); const observer = new ResizeObserver(() => this.#applyLayout()); observer.observe(this.element); this._register({ dispose: () => observer.disconnect() }); const preferences = new MutationObserver(() => this.#applyLayout()); preferences.observe(document.documentElement, { attributes: true, attributeFilter: ['data-prctr-density', 'data-prctr-theme-contrast', 'data-prctr-motion', 'dir'] }); preferences.observe(this.element, { attributes: true, attributeFilter: ['dir'] }); this._register({ dispose: () => preferences.disconnect() }); this.#applyLayout();
	}
	part(part: WorkbenchPart): HTMLElement { const value = this.#parts.get(part); if (value === undefined) throw new Error(`Composition ${this.composition.id} does not contain ${part}`); return value; }
	focusVisiblePart(preferred: readonly WorkbenchPart[] = []): void { const seen = new Set<WorkbenchPart>(); for (const part of [...preferred, 'content', 'sidebar', 'panel', 'titlebar'] as const) { if (seen.has(part)) continue; seen.add(part); const target = this.#parts.get(part); if (target !== undefined && isVisibleFocusTarget(target)) { target.focus(); if (target.ownerDocument.activeElement === target) return; } } }
	setPartVisible(part: 'banner' | 'panel' | 'sidebar', visible: boolean): void { const element = this.part(part); element.hidden = !visible; if (!visible && part === 'sidebar') this.#compactSidebarOpen = false; if (!visible && part === 'panel') this.#compactPanelOpen = false; this.#applyLayout(); }
	setResetLayoutAction(action: () => void | Promise<void>, enabled: boolean): void { this.#resetLayoutAction = action; this.#resetButton.disabled = !enabled; }
	/**
	 * Place AuthenticatedWindow's contextual sidebar. Its frame owns the visibility,
	 * width and responsive state; the shell owns the geometry each presentation uses.
	 */
	setSidebarPresentation(presentation: 'docked' | 'overlay' | 'hidden', size: number): void {
		if (!this.#framed) throw new Error(`Composition ${this.composition.id} has no framed sidebar`);
		const sidebar = this.part('sidebar');
		sidebar.hidden = presentation === 'hidden';
		this.element.dataset.sidebarPresentation = presentation;
		this.element.style.setProperty('--prctr-workbench-sidebar-size', `${Math.round(size)}px`);
	}
	get #framed(): boolean { return this.composition.windowKind === 'authenticated'; }
	#sidebarTarget(): HTMLElement | undefined { return this.#parts.get('sidebar'); }
	resetLayout(): void { this.#sidebarSize = this.#initialSidebar; this.#panelSize = this.#initialPanel; this.#applyLayout(); }
	layout(): void { this.#applyLayout(); }
	#createPart(part: WorkbenchPart, label: string, document: Document): void {
		const element = document.createElement(part === 'navigation' || part === 'sidebar' && this.#framed ? 'nav' : part === 'status' ? 'footer' : part === 'titlebar' ? 'header' : part === 'content' ? 'main' : 'section');
		element.className = `prctr-workbench__${part}`; element.dataset.part = part; element.setAttribute('aria-label', label);
		if (part === 'banner') { element.role = 'status'; element.hidden = true; }
		if (part === 'status') element.role = 'status';
		if (part === 'navigation' || part === 'titlebar' || part === 'sidebar' || part === 'content' || part === 'panel') element.tabIndex = -1;
		this.#parts.set(part, element); this.element.append(element);
	}
	#createCompactToggle(region: 'panel' | 'sidebar', label: string, controlledId: string, document: Document): void {
		const button = document.createElement('button'); button.className = 'prctr-workbench__compact-toggle'; button.type = 'button'; button.hidden = true; button.textContent = label; button.dataset.regionToggle = region; button.setAttribute('aria-controls', controlledId); button.setAttribute('aria-expanded', 'false'); this.part('titlebar').append(button); this.#compactToggles.set(region, button); this._register(addDisposableListener(button, 'click', () => this.#toggleCompactRegion(region)));
	}
	#toggleCompactRegion(region: 'panel' | 'sidebar'): void {
		const compact = this.element.dataset[region === 'sidebar' ? 'compactSidebar' : 'compactPanel'] === 'true'; if (!compact || (region === 'sidebar' ? this.#sidebarTarget() : this.#parts.get(region))?.hidden !== false) return;
		if (region === 'sidebar') { this.#compactSidebarOpen = !this.#compactSidebarOpen; if (this.#compactSidebarOpen) this.#compactPanelOpen = false; }
		else { this.#compactPanelOpen = !this.#compactPanelOpen; if (this.#compactPanelOpen) this.#compactSidebarOpen = false; }
		this.#applyLayout();
	}
	#createSash(region: 'panel' | 'sidebar', label: string, document: Document): void {
		const sash = document.createElement('div'); sash.className = `prctr-workbench__${region}-sash`; sash.dataset.sash = region; sash.role = 'separator'; sash.tabIndex = 0; sash.setAttribute('aria-label', label); sash.setAttribute('aria-orientation', region === 'panel' ? 'horizontal' : 'vertical'); sash.setAttribute('aria-valuemin', String(MIN_REGION));
		this.element.append(sash); this._register(addDisposableListener(sash, 'dblclick', () => this.resetLayout()));
		this._register(addDisposableListener(sash, 'keydown', event => {
			const rtl = region === 'sidebar' && this.#isRtl(); const decrement = region === 'sidebar' ? event.key === (rtl ? 'ArrowRight' : 'ArrowLeft') : event.key === 'ArrowDown'; const increment = region === 'sidebar' ? event.key === (rtl ? 'ArrowLeft' : 'ArrowRight') : event.key === 'ArrowUp';
			if (event.key === 'Home') { event.preventDefault(); this.resetLayout(); return; }
			if (!decrement && !increment) return; event.preventDefault(); this.#resize(region, (decrement ? -1 : 1) * (event.shiftKey ? 40 : 10));
		}));
			this._register(addDisposableListener(sash, 'pointerdown', event => {
				if (event.button !== 0) return; event.preventDefault(); const start = region === 'sidebar' ? event.clientX : event.clientY; const initial = this.#effectiveSize(region); const rtl = region === 'sidebar' && this.#isRtl(); sash.setPointerCapture(event.pointerId); sash.dataset.dragging = 'true';
			const listeners = new DisposableStore(); this.#drag.value = listeners; listeners.add({ dispose: () => { delete sash.dataset.dragging; if (sash.hasPointerCapture(event.pointerId)) sash.releasePointerCapture(event.pointerId); } }); listeners.add(addDisposableListener(sash, 'pointermove', move => { const delta = region === 'sidebar' ? (rtl ? start - move.clientX : move.clientX - start) : start - move.clientY; this.#setSize(region, initial + delta); })); listeners.add(addDisposableListener(sash, 'pointercancel', () => listeners.dispose(), { once: true })); listeners.add(addDisposableListener(sash, 'pointerup', () => listeners.dispose(), { once: true })); listeners.add(addDisposableListener(sash, 'lostpointercapture', () => listeners.dispose(), { once: true }));
		}));
	}
	#isRtl(): boolean { return this.element.ownerDocument.defaultView?.getComputedStyle(this.element).direction === 'rtl'; }
	#resize(region: 'panel' | 'sidebar', delta: number): void { this.#setSize(region, this.#effectiveSize(region) + delta); }
	#setSize(region: 'panel' | 'sidebar', value: number): void {
		const bounded = Math.round(Math.min(this.#sizeLimit(region), Math.max(MIN_REGION, value)));
		if (region === 'sidebar') this.#sidebarSize = bounded; else this.#panelSize = bounded; this.#applyLayout();
	}
	#sizeLimit(region: 'panel' | 'sidebar'): number { return Math.max(MIN_REGION, (region === 'sidebar' ? this.element.clientWidth : this.element.clientHeight) * .5); }
	#effectiveSize(region: 'panel' | 'sidebar'): number { return Math.round(Math.min(this.#sizeLimit(region), Math.max(MIN_REGION, region === 'sidebar' ? this.#sidebarSize : this.#panelSize))); }
	#applyLayout(): void {
		// AuthenticatedWindow's frame places its own regions through setSidebarPresentation.
		if (this.#disposed || this.#framed) return; const sidebar = this.#sidebarTarget(); const panel = this.#parts.get('panel'); const compactSidebar = this.element.clientWidth > 0 && this.element.clientWidth < 640; const compactPanel = this.element.clientHeight > 0 && this.element.clientHeight < 480; const wasCompactSidebar = this.element.dataset.compactSidebar === 'true'; const wasCompactPanel = this.element.dataset.compactPanel === 'true'; const activeElement = this.element.ownerDocument.activeElement; const active = activeElement instanceof HTMLElement ? activeElement : null; let focusAfterLayout: HTMLElement | undefined;
		if (compactSidebar && !wasCompactSidebar && active !== null && sidebar?.contains(active)) { this.#compactSidebarOpen = true; this.#compactPanelOpen = false; }
		if (compactPanel && !wasCompactPanel && active !== null && panel?.contains(active)) { this.#compactPanelOpen = true; this.#compactSidebarOpen = false; }
		if (compactSidebar && !wasCompactSidebar && active?.dataset.sash === 'sidebar') focusAfterLayout = this.#compactToggles.get('sidebar');
		if (compactPanel && !wasCompactPanel && active?.dataset.sash === 'panel') focusAfterLayout = this.#compactToggles.get('panel');
		if (!compactSidebar && wasCompactSidebar && active === this.#compactToggles.get('sidebar')) focusAfterLayout = sidebar;
		if (!compactPanel && wasCompactPanel && active === this.#compactToggles.get('panel')) focusAfterLayout = panel;
		if (!compactSidebar || sidebar?.hidden !== false) this.#compactSidebarOpen = false; if (!compactPanel || panel?.hidden !== false) this.#compactPanelOpen = false; this.element.dataset.compactSidebar = String(compactSidebar); this.element.dataset.compactPanel = String(compactPanel); this.element.dataset.compactSidebarOpen = String(this.#compactSidebarOpen); this.element.dataset.compactPanelOpen = String(this.#compactPanelOpen);
		const effectiveSidebarSize = this.#effectiveSize('sidebar'); const effectivePanelSize = this.#effectiveSize('panel');
		this.element.style.setProperty('--prctr-workbench-sidebar-size', sidebar?.hidden === false && !compactSidebar ? `${effectiveSidebarSize}px` : '0px');
		this.element.style.setProperty('--prctr-workbench-panel-size', panel?.hidden === false && !compactPanel ? `${effectivePanelSize}px` : '0px');
		for (const region of ['sidebar', 'panel'] as const) { const toggle = this.#compactToggles.get(region); const target = region === 'sidebar' ? sidebar : this.#parts.get(region); if (toggle === undefined) continue; const compact = region === 'sidebar' ? compactSidebar : compactPanel; const open = region === 'sidebar' ? this.#compactSidebarOpen : this.#compactPanelOpen; toggle.hidden = !compact || target?.hidden !== false; toggle.setAttribute('aria-expanded', String(open)); }
		for (const sash of this.element.querySelectorAll<HTMLElement>('[data-sash]')) {
			const region = sash.dataset.sash as 'panel' | 'sidebar'; const target = region === 'sidebar' ? sidebar : this.#parts.get(region); sash.hidden = target?.hidden !== false || (region === 'sidebar' ? compactSidebar : compactPanel) || this.#compactSidebarOpen || this.#compactPanelOpen;
			const size = region === 'sidebar' ? effectiveSidebarSize : effectivePanelSize; sash.setAttribute('aria-valuenow', String(size)); sash.setAttribute('aria-valuemax', String(Math.round(this.#sizeLimit(region))));
		}
		if (focusAfterLayout !== undefined) { if (isVisibleFocusTarget(focusAfterLayout)) focusAfterLayout.focus(); else this.focusVisiblePart([this.#compactPanelOpen ? 'panel' : this.#compactSidebarOpen ? 'sidebar' : 'content']); }
	}
	override dispose(): void { if (this.#disposed) return; this.#disposed = true; super.dispose(); this.element.remove(); }
}
function isVisibleFocusTarget(element: HTMLElement): boolean { if (element.hidden || element.closest('[hidden],[inert],[aria-hidden="true"]') !== null || element.getClientRects().length === 0) return false; const style = element.ownerDocument.defaultView?.getComputedStyle(element); return style === undefined || style.display !== 'none' && style.visibility !== 'hidden'; }
