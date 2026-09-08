/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import lockupDarkUrl from '../../../../resources/branding/source/lockup/proctor-lockup-vertical-25d-dark.svg';
import lockupLightUrl from '../../../../resources/branding/source/lockup/proctor-lockup-vertical-25d-light.svg';
import { Disposable } from '../../base/common/lifecycle.js';
import type { ResolvedTheme } from '../../platform/theme/common/themes.js';
import './brandLockup.css';

export type BrandLockupAppearance = 'dark' | 'light';

const sources: Readonly<Record<BrandLockupAppearance, string>> = Object.freeze({
	dark: lockupDarkUrl,
	light: lockupLightUrl
});

/** Decorative product identity. Nearby localized text remains the accessible task heading. */
export class BrandLockup extends Disposable {
	readonly element: HTMLElement;
	readonly #image: HTMLImageElement;
	#appearance: BrandLockupAppearance;

	constructor(document: Document, appearance: BrandLockupAppearance) {
		super();
		this.#appearance = appearance;
		this.element = document.createElement('div');
		this.element.className = 'prctr-brand-lockup';
		this.element.dataset.appearance = appearance;
		this.element.setAttribute('aria-hidden', 'true');
		this.#image = document.createElement('img');
		this.#image.alt = '';
		// Reserve the supplied SVG's aspect ratio before its first decoded frame.
		this.#image.width = 768;
		this.#image.height = 576;
		this.#image.decoding = 'async';
		this.#image.draggable = false;
		this.#image.src = sources[appearance];
		this.element.append(this.#image);
	}

	get appearance(): BrandLockupAppearance {
		return this.#appearance;
	}

	setAppearance(appearance: BrandLockupAppearance): void {
		if (this._store.isDisposed) throw new Error('Cannot update a disposed brand lockup');
		if (appearance === this.#appearance) return;
		this.#appearance = appearance;
		this.element.dataset.appearance = appearance;
		this.#image.src = sources[appearance];
	}

	override dispose(): void {
		if (this._store.isDisposed) return;
		this.element.remove();
		super.dispose();
	}
}

export function brandLockupAppearance(theme: Pick<ResolvedTheme, 'isDark'>): BrandLockupAppearance {
	return theme.isDark ? 'dark' : 'light';
}
