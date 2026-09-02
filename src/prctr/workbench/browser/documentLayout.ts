/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import './documentLayout.css';

/** Loads the composition-owned document baseline before any surface is attached. */
export function prepareWorkbenchDocument(document: Document): void {
	document.documentElement.dataset.prctrDocument = 'workbench';
}
