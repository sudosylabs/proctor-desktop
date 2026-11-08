/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { createElementFactory } from '../../documentElements.js';
import { Disposable, MutableDisposable } from '../../../common/lifecycle.js';
import type { ControlIconFactory } from '../controlIcon.js';
import './bannerControl.css';

/** The icon's colour; the banner itself is always the quiet surface. */
export type BannerTone = 'neutral' | 'info' | 'warning' | 'failure';

export interface BannerState {
	readonly tone: BannerTone;
	readonly icon: ControlIconFactory;
	readonly text: string;
}

/**
 * A lasting condition of the page, such as being offline or an unverified email. It stays until
 * the condition ends; a result of something just done is a toast instead. The banner's own
 * action, if any, is appended to `actions` by its owner.
 */
export class BannerControl extends Disposable {
	readonly element: HTMLDivElement;
	readonly actions: HTMLDivElement;
	private readonly iconSlot: HTMLSpanElement;
	private readonly text: HTMLSpanElement;
	private readonly icon = this._register(new MutableDisposable());

	constructor(host: HTMLElement) {
		super();
		const $ = createElementFactory(host.ownerDocument);
		this.iconSlot = $('span.prctr-banner__icon');
		this.text = $('span.prctr-banner__text');
		this.actions = $('div.prctr-banner__actions');
		this.element = $(
			'div.prctr-banner',
			{ hidden: true, attrs: { role: 'status' } },
			this.iconSlot,
			this.text,
			this.actions
		);
		host.append(this.element);
	}

	show(state: BannerState): void {
		const icon = state.icon(this.element.ownerDocument);
		this.icon.value = icon;
		this.iconSlot.replaceChildren(icon.element);
		this.element.dataset.tone = state.tone;
		this.text.textContent = state.text;
		this.element.hidden = false;
	}

	hide(): void {
		this.element.hidden = true;
		this.icon.clear();
		this.iconSlot.replaceChildren();
	}
}
