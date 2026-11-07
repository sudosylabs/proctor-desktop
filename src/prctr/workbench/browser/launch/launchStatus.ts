/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { addDisposableListener } from '../../../base/browser/dom.js';
import { createElementFactory } from '../../../base/browser/documentElements.js';
import { Emitter } from '../../../base/common/event.js';
import type { LocalizationContext } from '../../../base/common/localization.js';
import { Disposable } from '../../../base/common/lifecycle.js';
import {
	createSemanticIcon,
	type SemanticIconControl,
	type SemanticIconState
} from '../../../platform/theme/browser/semanticIcon.js';
import { launchMessages, statusMessages } from './launchMessages.js';
import {
	formatLaunchText,
	type LaunchStatus as LaunchStatusModel,
	type LaunchTone
} from './launchPresentation.js';
import './launchStatus.css';

export const toneIcons: Readonly<Record<LaunchTone, SemanticIconState>> = {
	success: { id: 'state.success' },
	attention: { id: 'state.warning' },
	failed: { id: 'state.error' },
	active: { id: 'state.loading', modifier: 'spin' }
};

/**
 * What the current state means and what to do next: one headline, an explanation,
 * the Institution's own message when there is one, and a failed-action notice.
 * Announcements are made by the window, so this region is not itself live.
 */
export class LaunchStatus extends Disposable {
	readonly element: HTMLElement;

	private readonly reopenEmitter = this._register(new Emitter<void>());
	readonly onDidRequestReopen = this.reopenEmitter.event;

	private readonly icon: SemanticIconControl;
	private readonly headline: HTMLElement;
	private readonly head: HTMLElement;
	private readonly body: HTMLElement;
	private readonly institution: HTMLElement;
	private readonly institutionCaption: HTMLElement;
	private readonly institutionText: HTMLElement;
	private readonly reopen: HTMLButtonElement;
	private readonly failure: HTMLElement;

	constructor(
		host: HTMLElement,
		private readonly localization: LocalizationContext
	) {
		super();
		const document = host.ownerDocument;
		const $ = createElementFactory(document);
		this.icon = this._register(createSemanticIcon(document, { id: 'state.info', size: 16 }));
		this.head = $('p.prctr-launch-status__head');
		this.body = $('p.prctr-launch-status__body');
		this.institutionCaption = $('figcaption.prctr-launch-status__caption');
		this.institutionText = $('blockquote.prctr-launch-status__quote', { dir: 'auto' });
		this.institution = $(
			'figure.prctr-launch-status__message',
			{},
			this.institutionCaption,
			this.institutionText
		);
		this.reopen = $('button.prctr-launch-link', {
			type: 'button',
			textContent: this.localization.format(launchMessages.reopenBrowser)
		});
		this.failure = $('p.prctr-launch-status__failure', {
			hidden: true,
			textContent: this.localization.format(launchMessages.actionFailed)
		});
		this.headline = $(
			'div.prctr-launch-status__headline',
			{},
			$('span.prctr-launch-status__glyph', {}, this.icon.element),
			this.head
		);
		this.element = $(
			'section.prctr-launch-status',
			{ hidden: true },
			this.headline,
			$(
				'div.prctr-launch-status__detail',
				{},
				this.body,
				this.institution,
				this.reopen,
				this.failure
			)
		);
		host.append(this.element);

		this._register(
			addDisposableListener(this.reopen, 'click', () => {
				this.reopenEmitter.fire();
			})
		);
	}

	render(status: LaunchStatusModel | undefined, actionFailed: boolean): void {
		this.failure.hidden = !actionFailed;
		this.element.hidden = status === undefined && !actionFailed;
		this.headline.hidden = status === undefined;
		if (status === undefined) {
			this.element.dataset.tone = 'failed';
			this.head.textContent = '';
			this.body.hidden = true;
			this.institution.hidden = true;
			this.reopen.hidden = true;
			return;
		}
		this.element.dataset.tone = status.tone;
		this.icon.setState({ ...toneIcons[status.tone], size: 16 });
		this.head.textContent = formatLaunchText(this.localization, status.head);
		this.renderBody(status);
		this.institution.hidden = status.institutionMessage === undefined;
		if (status.institutionMessage !== undefined) {
			this.institutionCaption.textContent = formatLaunchText(
				this.localization,
				status.institutionMessage.caption
			);
			this.institutionText.textContent = status.institutionMessage.text;
		}
		this.reopen.hidden = !status.canReopenBrowser;
	}

	get reopenButton(): HTMLButtonElement {
		return this.reopen;
	}

	/** A server's advisory retry time replaces the generic advice, since it is the more useful answer. */
	private renderBody(status: LaunchStatusModel): void {
		if (status.retryAt !== undefined) {
			const time = this.formatRetryTime(status.retryAt);
			this.body.hidden = false;
			this.body.textContent = this.localization.format(statusMessages.retryAfter, { time });
			return;
		}
		this.body.hidden = status.body === undefined;
		this.body.textContent =
			status.body === undefined ? '' : formatLaunchText(this.localization, status.body);
	}

	/** Only the time when it is today; the date as well when it is not. */
	private formatRetryTime(retryAt: number): string {
		const isToday = new Date(retryAt).toDateString() === new Date().toDateString();
		const format = new Intl.DateTimeFormat(
			this.localization.locale,
			isToday ? { timeStyle: 'short' } : { dateStyle: 'medium', timeStyle: 'short' }
		);
		return format.format(retryAt);
	}

	override dispose(): void {
		super.dispose();
		this.element.remove();
	}
}
