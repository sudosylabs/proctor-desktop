/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { createElementFactory } from '../../../../base/browser/documentElements.js';
import { alert, status } from '../../../../base/browser/ui/aria/aria.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { createProctorIcon } from '../../../../platform/theme/browser/proctorIcon.js';
import type { ProctorIconId } from '../../../../platform/theme/common/proctorIcons.js';
import './media/accountFeedback.css';

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
		this.icon = this._register(
			createProctorIcon(host.ownerDocument, { id: 'status.info', size: 16 })
		);
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
		this.icon.setState({ id: iconOf(kind), size: 16, spin: kind === 'loading' });
		if (text === undefined || kind === 'loading') return;
		if (kind === 'error') alert(text);
		else status(text);
	}

	override dispose(): void {
		super.dispose();
		this.element.remove();
	}
}

function iconOf(kind: AccountFeedbackKind): ProctorIconId {
	if (kind === 'loading') return 'status.busy';
	if (kind === 'error') return 'status.attention';
	if (kind === 'success') return 'status.success';
	return 'status.info';
}
