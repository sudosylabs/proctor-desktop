/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { createElementFactory } from '../../../../base/browser/documentElements.js';
import { Disposable, DisposableStore } from '../../../../base/common/lifecycle.js';
import { createProctorIcon } from '../../../../platform/theme/browser/proctorIcon.js';
import './media/pageSteps.css';

/**
 * Where a piece of work stands among its steps, such as Upload, Review and Import: done steps
 * carry a check, the current one is underlined in the accent, later ones are quiet. A list, so
 * a screen reader hears the count and which step is current.
 */
export class PageSteps extends Disposable {
	readonly element: HTMLOListElement;
	private readonly stepStore = this._register(new DisposableStore());

	constructor(
		host: HTMLElement,
		label: string,
		private readonly labels: readonly string[]
	) {
		super();
		this.element = createElementFactory(host.ownerDocument)('ol.prctr-page-steps', {
			attrs: { 'aria-label': label }
		});
		host.append(this.element);
	}

	/** Shows `current` (from 0) as the step in progress; a value past the last marks all done. */
	set(current: number): void {
		const document = this.element.ownerDocument;
		const $ = createElementFactory(document);
		this.stepStore.clear();
		this.element.replaceChildren(
			...this.labels.map((label, index) => {
				const state = index < current ? 'done' : index === current ? 'current' : 'later';
				const mark = $('span.prctr-page-steps__mark', { attrs: { 'aria-hidden': 'true' } });
				if (state === 'done')
					mark.append(
						this.stepStore.add(
							createProctorIcon(document, { id: 'action.confirm', size: 12 })
						).element
					);
				else mark.textContent = String(index + 1);
				return $(
					'li.prctr-page-steps__step',
					{
						data: { state },
						attrs: state === 'current' ? { 'aria-current': 'step' } : {}
					},
					mark,
					$('span', { textContent: label })
				);
			})
		);
	}
}
