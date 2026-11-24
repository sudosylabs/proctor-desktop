/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { createElementFactory } from '../../../../base/browser/documentElements.js';
import type { StatusBadgeTone } from '../../../../base/browser/ui/badge/statusBadge.js';
import './media/pageDetails.css';

export interface PageDetail {
	readonly label: string;
	readonly value: string;
	/** The value is missing, shown in the quiet colour. */
	readonly empty?: boolean;
	/** A badge after the value, such as Verified. */
	readonly note?: { readonly text: string; readonly tone: StatusBadgeTone };
}

/** Replaces `host`'s content with a list of labelled values, one per line. */
export function renderDetails(host: HTMLElement, details: readonly PageDetail[]): void {
	const $ = createElementFactory(host.ownerDocument);
	host.replaceChildren(
		$(
			'dl.prctr-page-details',
			{},
			...details.map((detail) =>
				$(
					'div.prctr-page-details__row',
					{},
					$('dt.prctr-page-details__label', { textContent: detail.label }),
					$(
						'dd.prctr-page-details__value',
						{ data: { empty: String(detail.empty === true) } },
						detail.value,
						// A note reads after the value as one more fact: "… · Verified".
						...(detail.note === undefined
							? []
							: [
									$('span.prctr-page-details__separator', {
										textContent: '·',
										attrs: { 'aria-hidden': 'true' }
									}),
									$('span.prctr-page-details__note', {
										textContent: detail.note.text,
										data: { tone: detail.note.tone }
									})
								])
					)
				)
			)
		)
	);
}
