/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import type { IDisposable } from '../../../base/common/lifecycle.js';
import {
	resolveSemanticIcon,
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

export function createSemanticIcon(document: Document, state: SemanticIconState): SemanticIconControl {
	const element = document.createElement('span');
	element.className = 'prctr-semantic-icon';

	let disposed = false;
	const setState = (next: SemanticIconState): void => {
		if (disposed) {
			throw new Error('Cannot update a disposed semantic icon.');
		}
		const glyph = resolveSemanticIcon(next.id);
		element.textContent = String.fromCodePoint(glyph.fontCharacter);
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
