/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { createElementFactory } from '../../../base/browser/documentElements.js';
import type { IDisposable } from '../../../base/common/lifecycle.js';
import {
	resolveProctorIcon,
	type ProctorIconId,
	type ProctorIconSize
} from '../common/proctorIcons.js';
import './proctorIcon.css';

export interface ProctorIconState {
	readonly id: ProctorIconId;
	readonly size?: ProctorIconSize;
	/** The fill weight, for the selected place in navigation. */
	readonly filled?: boolean;
	/** Turns continuously; reduced motion stops it. */
	readonly spin?: boolean;
	/** Present only when the icon alone carries meaning; otherwise it is hidden from assistive tech. */
	readonly accessibleLabel?: string;
}

export interface ProctorIconControl extends IDisposable {
	readonly element: HTMLSpanElement;
	setState(state: ProctorIconState): void;
}

const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';

/** One Proctor icon as inline SVG, sized in CSS pixels and drawn in the current text color. */
export function createProctorIcon(document: Document, state: ProctorIconState): ProctorIconControl {
	const element = createElementFactory(document)('span.prctr-icon');
	const svg = document.createElementNS(SVG_NAMESPACE, 'svg');
	svg.setAttribute('viewBox', '0 0 256 256');
	svg.setAttribute('fill', 'currentColor');
	svg.setAttribute('aria-hidden', 'true');
	svg.setAttribute('focusable', 'false');
	const path = document.createElementNS(SVG_NAMESPACE, 'path');
	svg.append(path);
	element.append(svg);
	let disposed = false;
	const setState = (next: ProctorIconState): void => {
		if (disposed) throw new Error('Cannot update a disposed icon.');
		const glyph = resolveProctorIcon(next.id, next.filled === true);
		path.setAttribute('d', glyph.d);
		element.dataset.prctrIcon = next.id;
		element.style.setProperty('--prctr-icon-size', `${next.size ?? 16}px`);
		element.toggleAttribute('data-spin', next.spin === true);
		const label = next.accessibleLabel?.trim();
		if (label) {
			element.removeAttribute('aria-hidden');
			element.setAttribute('role', 'img');
			element.setAttribute('aria-label', label);
		} else {
			element.setAttribute('aria-hidden', 'true');
			element.removeAttribute('role');
			element.removeAttribute('aria-label');
		}
	};
	setState(state);
	return {
		element,
		setState,
		dispose(): void {
			if (disposed) return;
			disposed = true;
			element.remove();
		}
	};
}

/** A control icon factory for one Proctor icon, for controls in `base` that take icons. */
export function proctorIconFactory(
	id: ProctorIconId,
	size: ProctorIconSize = 16
): (document: Document) => ProctorIconControl {
	return (document) => createProctorIcon(document, { id, size });
}
