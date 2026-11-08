/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { createElementFactory } from '../../../base/browser/documentElements.js';
import { Disposable } from '../../../base/common/lifecycle.js';
import './media/unavailablePage.css';

/** The content shown for a product area whose capability this window was not given. */
export class UnavailablePage extends Disposable {
	readonly element: HTMLElement;
	private readonly heading: HTMLElement;

	constructor(host: HTMLElement, message: string) {
		super();
		const $ = createElementFactory(host.ownerDocument);
		this.heading = $('h1.prctr-unavailable-page__title', { tabIndex: -1 });
		this.element = $(
			'section.prctr-unavailable-page',
			{},
			this.heading,
			$('p.prctr-unavailable-page__message', { textContent: message })
		);
		this.element.hidden = true;
		host.append(this.element);
	}

	show(title: string | undefined): void {
		this.element.hidden = title === undefined;
		this.heading.textContent = title ?? '';
	}

	override dispose(): void {
		super.dispose();
		this.element.remove();
	}
}
