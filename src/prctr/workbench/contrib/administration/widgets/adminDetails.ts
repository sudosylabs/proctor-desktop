/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { createElementFactory } from '../../../../base/browser/documentElements.js';
import './media/adminDetails.css';

export interface AdminDetail {
	readonly label: string;
	readonly value: string;
	/** The value is missing, shown in the quiet colour. */
	readonly empty?: boolean;
	/** A word after the value, such as Verified. */
	readonly note?: { readonly text: string; readonly tone: 'ok' | 'warn' | 'neutral' };
}

/** Replaces `host`'s content with a list of labelled values, one per line. */
export function renderDetails(host: HTMLElement, details: readonly AdminDetail[]): void {
	const $ = createElementFactory(host.ownerDocument);
	host.replaceChildren(
		$(
			'dl.prctr-admin-details',
			{},
			...details.map((detail) =>
				$(
					'div.prctr-admin-details__row',
					{},
					$('dt.prctr-admin-details__label', { textContent: detail.label }),
					$('dd.prctr-admin-details__value', {
						textContent: detail.value,
						data: { empty: String(detail.empty === true) }
					}),
					...(detail.note === undefined
						? []
						: [
								$('dd.prctr-admin-details__note', {
									textContent: detail.note.text,
									data: { tone: detail.note.tone }
								})
							])
				)
			)
		)
	);
}
