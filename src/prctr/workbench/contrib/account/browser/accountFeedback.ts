/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { createElementFactory } from '../../../../base/browser/documentElements.js';
import { alert, status } from '../../../../base/browser/ui/aria/aria.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { createSemanticIcon } from '../../../../platform/theme/browser/semanticIcon.js';
import './accountFeedback.css';

export type AccountFeedbackKind = 'info' | 'success' | 'error' | 'loading';

/**
 * One action's result line, shown where the action happened. Each result is also
 * announced, assertively for an error; progress is shown but not announced.
 */
export class AccountFeedback extends Disposable {
	readonly element: HTMLElement;
	private readonly label: HTMLElement;
	private readonly icon;

	constructor(host: HTMLElement) {
		super();
		const $ = createElementFactory(host.ownerDocument);
		this.icon = this._register(createSemanticIcon(host.ownerDocument, { id: 'state.info' }));
		this.label = $('span.prctr-account-feedback__text');
		this.element = $(
			'div.prctr-account-feedback',
			{ hidden: true },
			this.icon.element,
			this.label
		);
		host.append(this.element);
	}

	get text(): string {
		return this.label.textContent ?? '';
	}

	set(text?: string, kind: AccountFeedbackKind = 'info'): void {
		this.element.hidden = text === undefined;
		this.element.dataset.kind = kind;
		this.label.textContent = text ?? '';
		this.icon.setState({
			id: iconOf(kind),
			...(kind === 'loading' ? { modifier: 'spin' as const } : {})
		});
		if (text === undefined || kind === 'loading') return;
		if (kind === 'error') alert(text);
		else status(text);
	}

	override dispose(): void {
		super.dispose();
		this.element.remove();
	}
}

function iconOf(kind: AccountFeedbackKind) {
	if (kind === 'loading') return 'state.loading' as const;
	if (kind === 'error') return 'state.error' as const;
	if (kind === 'success') return 'state.success' as const;
	return 'state.info' as const;
}
