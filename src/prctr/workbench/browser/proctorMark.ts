/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';

/** The Proctor mark from resources/branding, drawn in the current text color so themes can tint it. */
const MARK_PATHS = [
	{ d: 'M0 0H486L578 92H92V578L0 486Z' },
	{
		d: 'M127 107H573A20 20 0 0 1 593 127V573A20 20 0 0 1 573 593H127A20 20 0 0 1 107 573V127A20 20 0 0 1 127 107ZM167 157H533A10 10 0 0 1 543 167V533A10 10 0 0 1 533 543H167A10 10 0 0 1 157 533V167A10 10 0 0 1 167 157Z',
		evenOdd: true
	}
];

/** A decorative Proctor mark; nearby text names the product for assistive technology. */
export function createProctorMark(document: Document, className: string): SVGSVGElement {
	const svg = document.createElementNS(SVG_NAMESPACE, 'svg');
	svg.setAttribute('class', className);
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
