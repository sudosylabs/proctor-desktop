/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { addDisposableListener } from '../../../base/browser/dom.js';
import { createElementFactory } from '../../../base/browser/documentElements.js';
import { Emitter } from '../../../base/common/event.js';
import type { LocalizationContext } from '../../../base/common/localization.js';
import { Disposable } from '../../../base/common/lifecycle.js';
import { launchMessages as messages } from './launchMessages.js';
import { formatLaunchText, type LaunchServer } from './launchPresentation.js';
import './serverSummary.css';

/**
 * The selected server: the Institution once it is confirmed, otherwise the address,
 * and the way back to server selection.
 */
export class ServerSummary extends Disposable {
	readonly element: HTMLElement;

	private readonly changeEmitter = this._register(new Emitter<void>());
	readonly onDidRequestChange = this.changeEmitter.event;

	private readonly title: HTMLElement;
	private readonly subtitle: HTMLElement;
	private readonly change: HTMLButtonElement;

	constructor(
		host: HTMLElement,
		private readonly localization: LocalizationContext
	) {
		super();
		const $ = createElementFactory(host.ownerDocument);
		this.title = $('h2.prctr-launch-server__title', { dir: 'auto' });
		this.subtitle = $('p.prctr-launch-server__subtitle', { dir: 'auto' });
		this.change = $('button.prctr-launch-link', {
			type: 'button',
			textContent: this.localization.format(messages.changeServer),
			attrs: { 'aria-label': this.localization.format(messages.changeServerLabel) }
		});
		this.element = $(
			'section.prctr-launch-server',
			{ hidden: true, attrs: { 'aria-labelledby': 'prctr-launch-server-title' } },
			$('div.prctr-launch-server__text', {}, this.title, this.subtitle),
			this.change
		);
		this.title.id = 'prctr-launch-server-title';
		host.append(this.element);

		this._register(
			addDisposableListener(this.change, 'click', () => {
				this.changeEmitter.fire();
			})
		);
	}

	get changeButton(): HTMLButtonElement {
		return this.change;
	}

	render(server: LaunchServer | undefined): void {
		this.element.hidden = server === undefined;
		if (server === undefined) {
			return;
		}
		this.title.textContent = server.title;
		this.subtitle.textContent = formatLaunchText(this.localization, server.subtitle);
		this.subtitle.dataset.kind = 'literal' in server.subtitle ? 'address' : 'note';
		this.change.hidden = !server.canChange;
	}

	override dispose(): void {
		super.dispose();
		this.element.remove();
	}
}
