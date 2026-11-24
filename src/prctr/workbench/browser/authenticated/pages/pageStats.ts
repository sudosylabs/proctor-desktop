/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { createElementFactory } from '../../../../base/browser/documentElements.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import './media/pageStats.css';

/** One figure in a row of stats: its name, its value and a short note under it. */
export interface PageStat {
	readonly id: string;
	readonly label: string;
	/** Empty while the figure is still being read. */
	readonly value: string;
	readonly note?: string;
	/** A note that waits on someone is amber; one about something that went wrong is red. */
	readonly tone?: 'attention' | 'failure';
}

/**
 * A row of figures between two hairlines, each separated by a hairline, as the Overview boards
 * draw them. Figures are a description list, so a screen reader hears each name with its value.
 */
export class PageStats extends Disposable {
	readonly element: HTMLDListElement;

	constructor(host: HTMLElement) {
		super();
		this.element = createElementFactory(host.ownerDocument)('dl.prctr-page-stats');
		host.append(this.element);
	}

	set(stats: readonly PageStat[]): void {
		const $ = createElementFactory(this.element.ownerDocument);
		this.element.style.setProperty('--prctr-page-stats-count', String(stats.length));
		this.element.replaceChildren(
			...stats.map((stat) =>
				$(
					'div.prctr-page-stats__stat',
					{ data: { stat: stat.id } },
					$('dt.prctr-page-stats__label', { textContent: stat.label }),
					$('dd.prctr-page-stats__value', {
						textContent: stat.value,
						data: { pending: String(stat.value === '') }
					}),
					...(stat.note === undefined || stat.note === ''
						? []
						: [
								$('dd.prctr-page-stats__note', {
									textContent: stat.note,
									data: { tone: stat.tone ?? '' }
								})
							])
				)
			)
		);
	}

	override dispose(): void {
		super.dispose();
		this.element.remove();
	}
}
