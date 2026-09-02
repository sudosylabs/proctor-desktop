/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { CancellationTokenSource } from '../../base/common/cancellation.js';
import { Disposable } from '../../base/common/lifecycle.js';
import type { WorkbenchItem, ResolvedWorkbenchItem } from '../common/workbenchItem.js';
import { WorkbenchItemResolverRegistry, type WorkbenchPane } from './workbenchPane.js';
import './paneHost.css';

export class WorkbenchPaneHost extends Disposable {
	readonly element: HTMLDivElement;
	#pane: WorkbenchPane | undefined; #model: ResolvedWorkbenchItem | undefined; #assignment: CancellationTokenSource | undefined; #assignmentSerial: Promise<void> = Promise.resolve(); #sequence = 0; #disposed = false;
	readonly #resolvers: WorkbenchItemResolverRegistry;
	constructor(host: HTMLElement, resolvers: WorkbenchItemResolverRegistry) {
		super(); this.#resolvers = resolvers; this.element = host.ownerDocument.createElement('div'); this.element.className = 'prctr-pane-host'; host.append(this.element); const layout = (): void => { const bounds = this.element.getBoundingClientRect(); this.layout(bounds.width, bounds.height); }; const observer = new ResizeObserver(layout); observer.observe(this.element); this._register({ dispose: () => observer.disconnect() }); layout();
	}
	async assign(item: WorkbenchItem): Promise<boolean> {
		if (this.#disposed) throw new Error('WorkbenchPaneHost is disposed');
		const sequence = ++this.#sequence; this.#assignment?.dispose(true); const assignment = new CancellationTokenSource(); this.#assignment = assignment;
		const resolver = this.#resolvers.get(item.typeId); const resolved = Promise.resolve(resolver.resolve(item, assignment.token)); void resolved.catch(() => {});
		let model: ResolvedWorkbenchItem;
		try { model = await resolved; }
		catch (error) { if (assignment.token.isCancellationRequested || sequence !== this.#sequence) return false; throw error; }
		if (assignment.token.isCancellationRequested || sequence !== this.#sequence) { model.dispose(); return false; }
		const operation = this.#assignmentSerial.then(() => this.#performAssign(item, sequence, assignment, resolver, model)); this.#assignmentSerial = operation.then(() => {}, () => {}); return operation;
	}
	async #performAssign(item: WorkbenchItem, sequence: number, assignment: CancellationTokenSource, resolver: ReturnType<WorkbenchItemResolverRegistry['get']>, model: ResolvedWorkbenchItem): Promise<boolean> {
		if (assignment.token.isCancellationRequested || sequence !== this.#sequence) { model.dispose(); return false; }
		let pane = this.#pane;
		try {
			if (pane === undefined || pane.element.dataset.typeId !== item.typeId) {
				const priorPane = pane; const priorModel = this.#model; this.#pane = undefined; this.#model = undefined;
				priorPane?.setVisible(false); priorPane?.element.remove();
				try { await priorPane?.clear(); } finally { priorPane?.dispose(); priorModel?.dispose(); }
				if (assignment.token.isCancellationRequested || sequence !== this.#sequence) { model.dispose(); return false; }
				let created: WorkbenchPane | undefined;
				try { created = resolver.createPane(this.element.ownerDocument); if (assignment.token.isCancellationRequested || sequence !== this.#sequence) { created.dispose(); model.dispose(); return false; } created.element.dataset.typeId = item.typeId; this.element.replaceChildren(created.element); pane = created; this.#pane = created; }
				catch (error) { created?.dispose(); throw error; }
			} else {
				const priorModel = this.#model; this.#model = undefined; pane.setVisible(false);
				try { await pane.clear(); }
				catch (error) { if (this.#pane === pane) this.#pane = undefined; pane.element.remove(); pane.dispose(); throw error; }
				finally { priorModel?.dispose(); }
				if (assignment.token.isCancellationRequested || sequence !== this.#sequence) { model.dispose(); return false; }
			}
		} catch (error) { model.dispose(); throw error; }
		if (assignment.token.isCancellationRequested || sequence !== this.#sequence) { model.dispose(); return false; }
		try { await pane.setItem(model, assignment.token); }
		catch (error) {
			let cleanupError: unknown;
			try { await pane.clear(); pane.setVisible(false); }
			catch (candidate) {
				cleanupError = candidate; if (this.#pane === pane) this.#pane = undefined; pane.element.remove();
				try { pane.dispose(); } catch (disposeError) { cleanupError = new AggregateError([candidate, disposeError], 'Failed pane cleanup and disposal'); }
			} finally { model.dispose(); }
			if (cleanupError !== undefined) throw new AggregateError([error, cleanupError], 'Failed pane assignment and cleanup');
			if (assignment.token.isCancellationRequested || sequence !== this.#sequence) return false; throw error;
		}
		if (assignment.token.isCancellationRequested || sequence !== this.#sequence) { try { await pane.clear(); } finally { model.dispose(); } return false; }
		this.#model = model; pane.setVisible(true); const bounds = this.element.getBoundingClientRect(); pane.layout(bounds.width, bounds.height); return true;
	}
	clear(): Promise<void> {
		this.#sequence++; this.#assignment?.dispose(true); this.#assignment = undefined; const pane = this.#pane; const model = this.#model; this.#model = undefined; pane?.setVisible(false);
		const clearing = this.#assignmentSerial.then(async () => { try { await pane?.clear(); } catch (error) { if (this.#pane === pane) { this.#pane = undefined; pane?.element.remove(); pane?.dispose(); } throw error; } finally { model?.dispose(); } });
		this.#assignmentSerial = clearing.then(() => {}, () => {}); return clearing;
	}
	layout(width: number, height: number): void { this.#pane?.layout(width, height); }
	focus(): void { this.#pane?.focus(); }
	getViewState(): Readonly<Record<string, unknown>> | undefined { return this.#pane?.getViewState(); }
	override dispose(): void { if (this.#disposed) return; this.#disposed = true; const pane = this.#pane; const clearing = this.clear(); this.#pane = undefined; this.#assignmentSerial = clearing.then(() => { pane?.dispose(); }, () => { pane?.dispose(); }); super.dispose(); this.element.remove(); }
}
