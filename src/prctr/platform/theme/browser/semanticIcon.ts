/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import type { IDisposable } from '../../../base/common/lifecycle.js';
import {
	resolveSemanticIcon,
	type StatusGlyphShape,
	type SemanticIconId,
	type SemanticIconModifier,
	type SemanticIconSize
} from '../common/semanticIcons.js';
import './semanticIcon.css';

export interface SemanticIconOptions {
	readonly accessibleLabel?: string;
	readonly modifier?: SemanticIconModifier;
	readonly size?: SemanticIconSize;
}

export interface SemanticIconState extends SemanticIconOptions {
	readonly id: SemanticIconId;
}

export interface SemanticIconControl extends IDisposable {
	readonly element: HTMLSpanElement;
	setState(state: SemanticIconState): void;
}

export function createSemanticIcon(
	document: Document,
	state: SemanticIconState
): SemanticIconControl {
	const element = document.createElement('span');
	element.className = 'prctr-semantic-icon';

	let disposed = false;
	const setState = (next: SemanticIconState): void => {
		if (disposed) {
			throw new Error('Cannot update a disposed semantic icon.');
		}
		const glyph = resolveSemanticIcon(next.id);
		element.replaceChildren();
		if ('shapes' in glyph) {
			element.append(createStatusSvg(document, glyph.shapes));
		} else if ('paths' in glyph) {
			element.append(createLineSvg(document, glyph.paths));
		} else {
			element.textContent = String.fromCodePoint(glyph.fontCharacter);
		}
		element.dataset.prctrSemanticIcon = next.id;
		element.dataset.prctrIconSize = String(next.size ?? 16);
		if (next.modifier === undefined) {
			delete element.dataset.prctrIconModifier;
		} else {
			element.dataset.prctrIconModifier = next.modifier;
		}

		const accessibleLabel = next.accessibleLabel?.trim();
		if (accessibleLabel === undefined || accessibleLabel.length === 0) {
			element.setAttribute('aria-hidden', 'true');
			element.removeAttribute('aria-label');
			element.removeAttribute('role');
		} else {
			element.removeAttribute('aria-hidden');
			element.setAttribute('aria-label', accessibleLabel);
			element.setAttribute('role', 'img');
		}
	};

	setState(state);
	return {
		element,
		setState,
		dispose(): void {
			if (disposed) {
				return;
			}
			disposed = true;
			element.remove();
		}
	};
}

const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';

function createSvg(document: Document, viewBox: string): SVGSVGElement {
	const svg = document.createElementNS(SVG_NAMESPACE, 'svg');
	svg.setAttribute('viewBox', viewBox);
	svg.setAttribute('width', '100%');
	svg.setAttribute('height', '100%');
	svg.setAttribute('aria-hidden', 'true');
	svg.setAttribute('focusable', 'false');
	return svg;
}

/** A Proctor line glyph on the 24-unit grid. */
function createLineSvg(document: Document, paths: readonly string[]): SVGSVGElement {
	const svg = createSvg(document, '0 0 24 24');
	svg.setAttribute('fill', 'none');
	svg.setAttribute('stroke', 'currentColor');
	svg.setAttribute('stroke-width', '1.6');
	svg.setAttribute('stroke-linecap', 'round');
	svg.setAttribute('stroke-linejoin', 'round');
	for (const d of paths) {
		const path = document.createElementNS(SVG_NAMESPACE, 'path');
		path.setAttribute('d', d);
		svg.append(path);
	}
	return svg;
}

/** A status glyph on the 16-unit grid; track shapes take their color from CSS. */
function createStatusSvg(document: Document, shapes: readonly StatusGlyphShape[]): SVGSVGElement {
	const svg = createSvg(document, '0 0 16 16');
	for (const shape of shapes) {
		const path = document.createElementNS(SVG_NAMESPACE, 'path');
		path.setAttribute('d', shape.d);
		if (shape.paint === 'fill') {
			path.setAttribute('fill', 'currentColor');
			path.setAttribute('fill-rule', 'evenodd');
		} else {
			path.setAttribute('fill', 'none');
			path.setAttribute('stroke', 'currentColor');
			path.setAttribute('stroke-width', '1.5');
			path.setAttribute('stroke-linecap', 'round');
			path.setAttribute('stroke-linejoin', 'round');
		}
		if (shape.dash !== undefined) {
			path.setAttribute('stroke-dasharray', shape.dash);
		}
		if (shape.track === true) {
			path.classList.add('prctr-semantic-icon__track');
		}
		svg.append(path);
	}
	return svg;
}
