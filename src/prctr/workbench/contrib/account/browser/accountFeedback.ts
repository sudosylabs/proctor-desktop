import { createElementFactory } from '../../../../base/browser/documentElements.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import type { LocalizationContext } from '../../../../base/common/localization.js';
import { createSemanticIcon } from '../../../../platform/theme/browser/semanticIcon.js';
import { accountMessages } from './accountMessages.js';
import './accountFeedback.css';

/** One action owns one status region; unrelated work cannot replace its feedback. */
export class AccountFeedback extends Disposable {
	readonly element: HTMLElement;
	private readonly text: HTMLElement;
	private readonly icon;
	constructor(
		host: HTMLElement,
		private readonly localization: LocalizationContext
	) {
		super();
		const $ = createElementFactory(host.ownerDocument);
		this.icon = this._register(createSemanticIcon(host.ownerDocument, { id: 'state.info' }));
		this.text = $('span');
		this.element = $(
			'div.prctr-account-feedback',
			{ role: 'status', hidden: true },
			this.icon.element,
			this.text
		);
		host.append(this.element);
	}
	set(key?: keyof typeof accountMessages, kind: 'info' | 'error' | 'loading' = 'info'): void {
		this.element.hidden = !key;
		this.element.dataset.kind = kind;
		this.text.textContent = key ? this.localization.format(accountMessages[key]) : '';
		this.icon.setState({
			id:
				kind === 'loading'
					? 'state.loading'
					: kind === 'error'
						? 'state.error'
						: 'state.info',
			...(kind === 'loading' ? { modifier: 'spin' as const } : {})
		});
	}
	override dispose(): void {
		super.dispose();
		this.element.remove();
	}
}
