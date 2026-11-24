/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { createElementFactory } from '../../documentElements.js';
import './statusBadge.css';

/**
 * What a status means to the person reading it; the badge picks the colour.
 * - `failure`: something went wrong (red).
 * - `attention`: it waits on you or lapses soon (amber).
 * - `safeguard`: a protection in place on your own account, such as Verified or On (green).
 * - `progress`: work Proctor is still doing, such as Checking or Importing (the accent).
 * - `neutral`: everything else (grey).
 * Purple otherwise marks actions and selection.
 */
export type StatusBadgeTone = 'failure' | 'attention' | 'safeguard' | 'progress' | 'neutral';

/** One status word on a tinted pill, such as Verified or Expired. A status badge never carries an icon. */
export function createStatusBadge(
	document: Document,
	options: { readonly text: string; readonly tone: StatusBadgeTone }
): HTMLElement {
	const $ = createElementFactory(document);
	return $('span.prctr-status-badge', {
		textContent: options.text,
		data: { tone: options.tone }
	});
}
