/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { createElementFactory } from '../../../base/browser/documentElements.js';
import { Disposable } from '../../../base/common/lifecycle.js';
import { createProctorMark } from '../proctorMark.js';
import './media/windowTitle.css';

/**
 * The product name in the Windows and Linux title bar strip, before the native
 * caption buttons. On macOS the traffic lights sit in the area rail instead.
 */
export class WindowTitle extends Disposable {
	readonly element: HTMLElement;

	constructor(titlebar: HTMLElement, before: Node | null, productName: string) {
		super();
		const document = titlebar.ownerDocument;
		const $ = createElementFactory(document);
		this.element = $(
			'div.prctr-window-title',
			{},
			createProctorMark(document, 'prctr-window-title__mark'),
			$('span.prctr-window-title__name', { textContent: productName })
		);
		titlebar.insertBefore(this.element, before);
	}

	override dispose(): void {
		super.dispose();
		this.element.remove();
	}
}
