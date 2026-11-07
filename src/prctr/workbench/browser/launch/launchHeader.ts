/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { createElementFactory } from '../../../base/browser/documentElements.js';
import type { LocalizationContext } from '../../../base/common/localization.js';
import { Disposable } from '../../../base/common/lifecycle.js';
import { createProctorMark } from '../proctorMark.js';
import { launchMessages as messages } from './launchMessages.js';
import './launchHeader.css';

/** The window's identity row: the mark and the product name as the page heading. */
export class LaunchHeader extends Disposable {
	readonly element: HTMLElement;

	constructor(
		host: HTMLElement,
		private readonly localization: LocalizationContext
	) {
		super();
		const $ = createElementFactory(host.ownerDocument);
		const name = $('h1.prctr-launch-header__name', {
			id: 'prctr-launch-title',
			textContent: this.localization.format(messages.productName)
		});
		this.element = $(
			'header.prctr-launch-header',
			{},
			createProctorMark(host.ownerDocument, 'prctr-launch-header__mark'),
			name
		);
		host.append(this.element);
	}

	override dispose(): void {
		this.element.remove();
		super.dispose();
	}
}
