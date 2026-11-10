/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { createElementFactory } from '../../documentElements.js';
import type { ControlIcon } from '../controlIcon.js';
import './statusBadge.css';

/** Green is fine, yellow needs a look, red is a problem, grey is neutral, purple is in progress. */
export type StatusBadgeTone = 'success' | 'warning' | 'danger' | 'neutral' | 'accent';

/**
 * One status word on a tinted pill, such as Verified or Expired. A status badge never carries an
 * icon; the only exception is an icon-only badge, such as the pin that marks the session in use,
 * whose `label` is its tooltip and accessible name.
 */
export function createStatusBadge(
	document: Document,
	options:
		| { readonly text: string; readonly tone: StatusBadgeTone }
		| { readonly icon: ControlIcon; readonly label: string; readonly tone: StatusBadgeTone }
): HTMLElement {
	const $ = createElementFactory(document);
	if ('icon' in options)
		return $(
			'span.prctr-status-badge',
			{
				title: options.label,
				data: { tone: options.tone, iconOnly: 'true' },
				attrs: { role: 'img', 'aria-label': options.label }
			},
			options.icon.element
		);
	return $('span.prctr-status-badge', {
		textContent: options.text,
		data: { tone: options.tone }
	});
}
