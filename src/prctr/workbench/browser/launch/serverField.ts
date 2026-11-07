/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { addDisposableListener } from '../../../base/browser/dom.js';
import { createElementFactory } from '../../../base/browser/documentElements.js';
import { TextFieldControl } from '../../../base/browser/ui/field/textField.js';
import { Emitter } from '../../../base/common/event.js';
import type { LocalizationContext } from '../../../base/common/localization.js';
import { Disposable } from '../../../base/common/lifecycle.js';
import { launchMessages as messages } from './launchMessages.js';
import './serverField.css';

/** Longest address the coordinator accepts. */
const MAX_ADDRESS_LENGTH = 2048;

/**
 * The Institution server address. The typed text is kept across state changes, so a
 * cancelled check or a Change returns the candidate to what they entered.
 */
export class ServerField extends Disposable {
	readonly element: HTMLFormElement;

	private readonly submitEmitter = this._register(new Emitter<string>());
	readonly onDidSubmit = this.submitEmitter.event;

	private readonly field: TextFieldControl;

	constructor(
		host: HTMLElement,
		private readonly localization: LocalizationContext
	) {
		super();
		const $ = createElementFactory(host.ownerDocument);
		this.element = $('form.prctr-launch-server-field', { noValidate: true });
		host.append(this.element);

		this.field = this._register(
			new TextFieldControl(this.element, {
				label: this.localization.format(messages.serverLabel),
				description: this.localization.format(messages.serverHelp),
				value: '',
				inputMode: 'url',
				prefix: 'https://',
				autocomplete: 'off',
				required: true
			})
		);
		const input = this.field.input;
		input.placeholder = this.localization.format(messages.serverPlaceholder);
		input.maxLength = MAX_ADDRESS_LENGTH;
		input.spellcheck = false;
		input.autocapitalize = 'none';
		input.dir = 'ltr';

		this._register(
			addDisposableListener(this.element, 'submit', (event: SubmitEvent) => {
				event.preventDefault();
				this.submitEmitter.fire(this.field.input.value);
			})
		);
	}

	get input(): HTMLInputElement {
		return this.field.input;
	}

	render(visible: boolean, invalid: boolean): void {
		this.element.hidden = !visible;
		this.field.setState({
			value: this.field.input.value,
			required: true,
			...(invalid ? { error: this.localization.format(messages.invalidServer) } : {})
		});
	}

	/** Submits the address as if the candidate pressed Enter in the field. */
	submit(): void {
		this.element.requestSubmit();
	}

	focus(): void {
		this.field.focus();
	}

	override dispose(): void {
		super.dispose();
		this.element.remove();
	}
}
