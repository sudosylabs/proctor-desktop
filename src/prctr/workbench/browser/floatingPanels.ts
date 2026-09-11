/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/* @proctor-vscode-port modern-workbench */

import type { WorkbenchPart } from '../common/composition.js';
import './floatingPanels.css';

interface FloatingLayoutState {
	readonly navigationSidebar: boolean;
	readonly compactSidebar: boolean;
	readonly sidebarOpen: boolean;
	readonly compactPanel: boolean;
	readonly panelOpen: boolean;
}

/**
 * Project the fixed Proctor topology into the same exposed-edge state used by
 * AbstractPaneCompositePart and EditorPart. CSS Grid allocates the original part
 * box; margins and border-box subtract the floating inset exactly once, before
 * PaneHost measures its contents. Never feed that reduced size back into the grid.
 */
export function layoutFloatingPanels(
	root: HTMLElement,
	parts: ReadonlyMap<WorkbenchPart, HTMLElement>,
	state: FloatingLayoutState
): void {
	const density = root.ownerDocument.documentElement.dataset.prctrDensity === 'compact' ? 'compact' : 'default';
	root.dataset.layoutDensity = density;
	root.dataset.layoutMotion = root.ownerDocument.documentElement.dataset.prctrMotion ?? 'reduced';
	root.dataset.layoutContrast = root.ownerDocument.documentElement.dataset.prctrThemeContrast ?? 'normal';
	const maximized = state.sidebarOpen || state.panelOpen;
	const navigation = parts.get('navigation');
	const sidebar = parts.get('sidebar');
	const panel = parts.get('panel');
	const navigationVisible = navigation?.hidden === false && (!state.navigationSidebar || !state.compactSidebar || state.sidebarOpen);
	const sidebarVisible = !state.navigationSidebar && sidebar?.hidden === false && (!state.compactSidebar || state.sidebarOpen) && !state.panelOpen;
	const panelVisible = panel?.hidden === false && (!state.compactPanel || state.panelOpen) && !state.sidebarOpen;
	if (root.dataset.windowKind === 'authenticated') {
		const primaryRight = root.dataset.primarySide === 'right';
		const rtl = root.ownerDocument.defaultView?.getComputedStyle(root).direction === 'rtl';
		const secondaryVisible = sidebar?.hidden === false;
		const visible = state.sidebarOpen ? ['navigation'] as const : [primaryRight !== rtl ? 'sidebar' : 'navigation', 'content', primaryRight !== rtl ? 'navigation' : 'sidebar'] as const;
		const ordered = visible.filter(part => part === 'content' || (part === 'navigation' ? navigationVisible : secondaryVisible));
		root.dataset.joinedRail = 'false'; root.dataset.panelVisible = 'false';
		for (const [index, part] of ordered.entries()) {
			const element = parts.get(part)!;
			element.dataset.outerStart = String(index === 0); element.dataset.outerEnd = String(index === ordered.length - 1);
			element.dataset.outerLeft = String(rtl ? index === ordered.length - 1 : index === 0);
			element.dataset.outerRight = String(rtl ? index === 0 : index === ordered.length - 1);
			element.dataset.outerTop = 'true'; element.dataset.outerBottom = 'true';
		}
		return;
	}
	const joinedRail = !state.navigationSidebar && navigationVisible && sidebarVisible;
	root.dataset.joinedRail = String(joinedRail);
	root.dataset.panelVisible = String(panelVisible && !maximized);
	root.dataset.topEdgeExposed = String(parts.get('titlebar')?.hidden !== false && parts.get('banner')?.hidden !== false);

	const edges = (part: WorkbenchPart, start: boolean, end: boolean, top: boolean, bottom: boolean): void => {
		const element = parts.get(part);
		if (!element) return;
		const rtl = root.ownerDocument.defaultView?.getComputedStyle(root).direction === 'rtl';
		element.dataset.outerLeft = String(rtl ? end : start);
		element.dataset.outerRight = String(rtl ? start : end);
		element.dataset.outerStart = String(start);
		element.dataset.outerEnd = String(end);
		element.dataset.outerTop = String(top);
		element.dataset.outerBottom = String(bottom);
	};
	// Logical edges preserve the same ownership when the document is RTL.
	edges('navigation', true, state.navigationSidebar && state.sidebarOpen, true, true);
	edges('sidebar', !navigationVisible, state.sidebarOpen, true, true);
	edges('content', !navigationVisible && !sidebarVisible, true, true, !panelVisible);
	edges('panel', state.panelOpen && state.navigationSidebar || !navigationVisible && !sidebarVisible, true, state.panelOpen, true);
}
