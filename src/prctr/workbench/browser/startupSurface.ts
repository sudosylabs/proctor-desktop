/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import './startupSurface.css';

export type StartupSurfaceKind = 'launchRecovery' | 'workbenchLoading' | 'workbenchRecovery';

export function createStartupSurface(
	document: Document,
	kind: StartupSurfaceKind,
	message: string
): HTMLElement {
	const element = document.createElement('main');
	element.className = 'prctr-startup-surface';
	element.textContent = message;
	if (kind === 'workbenchLoading') {
		element.dataset.workbenchLoading = 'true';
		element.role = 'status';
		element.setAttribute('aria-live', 'polite');
	} else {
		element.dataset[kind] = 'true';
		element.role = 'alert';
	}
	return element;
}
