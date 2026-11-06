/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { createElementFactory } from '../../../base/browser/documentElements.js';
import type { LocalizationContext } from '../../../base/common/localization.js';
import { Disposable } from '../../../base/common/lifecycle.js';
import {
	createSemanticIcon,
	type SemanticIconControl
} from '../../../platform/theme/browser/semanticIcon.js';
import type { LaunchNotice as LaunchNoticeModel } from './launchPresentation.js';
import { toneIcons } from './launchStatus.js';
import './launchNotice.css';

/** One line about how the previous session ended, shown above the server. */
export class LaunchNotice extends Disposable {
	readonly element: HTMLElement;

	private readonly icon: SemanticIconControl;
	private readonly text: HTMLElement;

	constructor(
		host: HTMLElement,
		private readonly localization: LocalizationContext
	) {
		super();
		const document = host.ownerDocument;
		const $ = createElementFactory(document);
		this.icon = this._register(createSemanticIcon(document, { id: 'state.info', size: 16 }));
		this.text = $('span.prctr-launch-notice__text');
		this.element = $(
			'p.prctr-launch-notice',
			{ hidden: true },
			$('span.prctr-launch-notice__glyph', {}, this.icon.element),
			this.text
		);
		host.append(this.element);
	}

	render(notice: LaunchNoticeModel | undefined): void {
		this.element.hidden = notice === undefined;
		if (notice === undefined) {
			return;
		}
		this.element.dataset.tone = notice.tone;
		this.icon.setState({ ...toneIcons[notice.tone], size: 16 });
		this.text.textContent = this.localization.format(notice.text);
	}

	override dispose(): void {
		super.dispose();
		this.element.remove();
	}
}
