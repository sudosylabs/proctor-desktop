/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import type { WorkbenchCompositionFragment } from '../common/composition.js';

export const commonWorkbenchManifest: WorkbenchCompositionFragment = Object.freeze({
	id: 'prctr.workbench.common',
	contributions: Object.freeze([
		Object.freeze({ id: 'prctr.workbench.kernel', phase: 'starting', blocksPhase: true }),
		Object.freeze({ id: 'prctr.workbench.restoration', phase: 'restored', dependencies: Object.freeze(['prctr.workbench.kernel' as const]) })
	]),
	itemTypes: Object.freeze([]), destinations: Object.freeze([])
});

export const electronDesktopManifest: WorkbenchCompositionFragment = Object.freeze({
	id: 'prctr.workbench.electronDesktop',
	contributions: Object.freeze([
		Object.freeze({ id: 'prctr.workbench.desktop', phase: 'starting', blocksPhase: true, dependencies: Object.freeze(['prctr.workbench.kernel' as const]) })
	]),
	itemTypes: Object.freeze([]), destinations: Object.freeze([])
});

export const commonParts = Object.freeze(['titlebar', 'banner', 'navigation', 'sidebar', 'content', 'status'] as const);
