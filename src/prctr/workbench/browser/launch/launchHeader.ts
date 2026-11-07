/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { createElementFactory } from '../../../base/browser/documentElements.js';
import type { LocalizationContext } from '../../../base/common/localization.js';
import { Disposable } from '../../../base/common/lifecycle.js';
import { launchMessages as messages } from './launchMessages.js';
import './launchHeader.css';

const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';

/** The Proctor mark from resources/branding, drawn in the current text color so themes can tint it. */
const MARK_PATHS = [
	{ d: 'M0 0H486L578 92H92V578L0 486Z' },
	{
		d: 'M127 107H573A20 20 0 0 1 593 127V573A20 20 0 0 1 573 593H127A20 20 0 0 1 107 573V127A20 20 0 0 1 127 107ZM167 157H533A10 10 0 0 1 543 167V533A10 10 0 0 1 533 543H167A10 10 0 0 1 157 533V167A10 10 0 0 1 167 157Z',
		evenOdd: true
	}
];

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
		this.element = $('header.prctr-launch-header', {}, createMark(host.ownerDocument), name);
		host.append(this.element);
	}

	override dispose(): void {
		this.element.remove();
		super.dispose();
	}
}

function createMark(document: Document): SVGSVGElement {
	const svg = document.createElementNS(SVG_NAMESPACE, 'svg');
	svg.setAttribute('class', 'prctr-launch-header__mark');
	svg.setAttribute('viewBox', '0 0 593 593');
	svg.setAttribute('aria-hidden', 'true');
	svg.setAttribute('focusable', 'false');
	for (const shape of MARK_PATHS) {
		const path = document.createElementNS(SVG_NAMESPACE, 'path');
		path.setAttribute('d', shape.d);
		path.setAttribute('fill', 'currentColor');
		if (shape.evenOdd) {
			path.setAttribute('fill-rule', 'evenodd');
		}
		svg.append(path);
	}
	return svg;
}
