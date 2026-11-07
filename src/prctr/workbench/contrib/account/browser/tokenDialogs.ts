/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { createElementFactory } from '../../../../base/browser/documentElements.js';
import { addDisposableListener } from '../../../../base/browser/dom.js';
import { ButtonControl } from '../../../../base/browser/ui/button/buttonControl.js';
import { TextFieldControl } from '../../../../base/browser/ui/field/textField.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import type { AccountToken } from '../../../../platform/account/common/accountProtocol.js';
import {
	DEFAULT_TOKEN_EXPIRY,
	tokenExpiry,
	tokenExpiryPresets,
	tokenScopeCatalog,
	validateTokenDraft,
	type TokenExpiryPreset
} from '../common/accountPresentation.js';
import { AccountDialog } from './accountDialog.js';
import { AccountFeedback } from './accountFeedback.js';
import type { AccountPageServices } from './accountPageServices.js';
import './tokenDialogs.css';

let scopeSequence = 0;

/**
 * Asks for a new token's name, what it can do and when it expires, then creates
 * it. The server checks the scopes against the person's current authority; the
 * one-time credential goes straight to the copy dialog and nowhere else.
 */
export class NewTokenDialog extends Disposable {
	private readonly dialog: AccountDialog;
	private readonly name: TextFieldControl;
	private readonly scopes: readonly {
		readonly scope: string;
		readonly input: HTMLInputElement;
	}[];
	private readonly scopeError: HTMLElement;
	private readonly expiry: HTMLSelectElement;
	private readonly feedback: AccountFeedback;
	private readonly cancel: ButtonControl;
	private readonly create: ButtonControl;
	private nameValue = '';
	private working = false;

	constructor(
		private readonly services: AccountPageServices,
		private readonly onDidCreate: (token: AccountToken, credential: string) => void,
		private readonly onDidClose: () => void
	) {
		super();
		const document = services.document;
		const $ = createElementFactory(document);
		const now = services.now();
		this.dialog = this._register(
			new AccountDialog(
				document,
				services.overlays,
				{
					title: services.text('newTokenTitle'),
					description: services.text('newTokenDescription'),
					size: 'medium'
				},
				services.focusPage
			)
		);
		this.name = this._register(
			new TextFieldControl(this.dialog.body, {
				label: services.text('tokenName'),
				description: services.text('tokenNameHint'),
				value: '',
				required: true
			})
		);
		const legend = $('legend.prctr-account-token-form__legend', {
			textContent: services.text('tokenScopes')
		});
		const scopeId = `prctr-account-token-scopes-${++scopeSequence}`;
		this.scopeError = $('p.prctr-account-token-form__error', {
			id: `${scopeId}-error`,
			hidden: true
		});
		const fieldset = $(
			'fieldset.prctr-account-token-form__scopes',
			{ attrs: { 'aria-describedby': this.scopeError.id } },
			legend
		);
		this.scopes = tokenScopeCatalog.map((entry) => {
			const input = $('input.prctr-account-token-form__checkbox', {
				type: 'checkbox',
				value: entry.scope
			});
			fieldset.append(
				$(
					'label.prctr-account-token-form__scope',
					{},
					input,
					$('span', { textContent: services.text(entry.label) })
				)
			);
			return { scope: entry.scope, input };
		});
		fieldset.append(this.scopeError);
		this.expiry = $('select.prctr-account-token-form__select', {
			id: `${scopeId}-expiry`,
			required: true
		});
		for (const days of tokenExpiryPresets)
			this.expiry.append(
				$('option', {
					value: String(days),
					selected: days === DEFAULT_TOKEN_EXPIRY,
					textContent: services.text('tokenExpiryOption', {
						days,
						date: services.date(tokenExpiry(days, now))
					})
				})
			);
		const expiryField = $(
			'div.prctr-account-token-form__field',
			{},
			$('label.prctr-account-token-form__label', {
				htmlFor: this.expiry.id,
				textContent: services.text('tokenExpiry')
			}),
			this.expiry
		);
		// Academic Units are not known to this window, so a token cannot be limited to one here.
		this.dialog.body.append(fieldset, expiryField);
		this.feedback = this._register(new AccountFeedback(this.dialog.body));
		this.cancel = this._register(
			new ButtonControl(this.dialog.actions, {
				variant: 'secondary',
				label: services.text('cancel')
			})
		);
		this.create = this._register(
			new ButtonControl(this.dialog.actions, {
				variant: 'brand',
				label: services.text('createToken')
			})
		);
		this.registerListeners();
		this.dialog.show(this.name.input);
	}

	private registerListeners(): void {
		this._register(
			this.name.onDidChange((value) => {
				this.nameValue = value;
			})
		);
		this._register(this.cancel.onDidRequest(() => this.close()));
		this._register(this.dialog.onDidRequestCancel(() => this.close()));
		this._register(this.create.onDidRequest(() => void this.submit()));
		this._register(
			addDisposableListener(this.name.input, 'keydown', (event) => {
				if (event.key !== 'Enter') return;
				event.preventDefault();
				void this.submit();
			})
		);
	}

	private close(): void {
		if (this.working) return;
		this.dispose();
	}

	private selectedScopes(): string[] {
		return this.scopes.filter((entry) => entry.input.checked).map((entry) => entry.scope);
	}

	private async submit(): Promise<void> {
		if (this.working) return;
		const scopes = this.selectedScopes();
		const errors = validateTokenDraft({ name: this.nameValue, scopes });
		this.name.setState({
			value: this.nameValue,
			required: true,
			...(errors.name === undefined ? {} : { error: this.services.text(errors.name) })
		});
		this.scopeError.hidden = errors.scopes === undefined;
		this.scopeError.textContent =
			errors.scopes === undefined ? '' : this.services.text(errors.scopes);
		if (errors.name !== undefined) {
			this.name.input.focus();
			return;
		}
		if (errors.scopes !== undefined) {
			this.scopes[0]?.input.focus();
			return;
		}
		const days = Number(this.expiry.value) as TokenExpiryPreset;
		this.setWorking(true);
		this.feedback.set(this.services.text('tokenCreating'), 'loading');
		const result = await this.services.change({
			kind: 'createToken',
			description: this.nameValue.trim(),
			scopes,
			expiresAt: tokenExpiry(days, this.services.now())
		});
		if (this._store.isDisposed) return;
		this.setWorking(false);
		if (result !== 'busy' && result.kind === 'tokenCreated') {
			this.dispose();
			this.onDidCreate(result.token, result.credential);
			return;
		}
		this.feedback.set(
			result === 'busy'
				? this.services.text('busy')
				: result.kind === 'error'
					? this.services.failure(result.reason)
					: this.services.failure('invalid'),
			'error'
		);
		this.create.focus();
	}

	private setWorking(working: boolean): void {
		this.working = working;
		this.name.setState({ value: this.nameValue, required: true, disabled: working });
		for (const entry of this.scopes) entry.input.disabled = working;
		this.expiry.disabled = working;
		this.cancel.setState({ label: this.services.text('cancel'), disabled: working });
		this.create.setState({ label: this.services.text('createToken'), busy: working });
	}

	override dispose(): void {
		if (this._store.isDisposed) return;
		super.dispose();
		this.onDidClose();
	}
}

/**
 * Shows a new token's credential exactly once. The credential lives only in this
 * dialog: it is never stored, logged or announced, and closing the dialog removes
 * it from the page and drops the reference.
 */
export class TokenCreatedDialog extends Disposable {
	private readonly dialog: AccountDialog;
	private readonly value: HTMLElement;
	private readonly feedback: AccountFeedback;
	private readonly copy: ButtonControl | undefined;
	private readonly done: ButtonControl;
	private credential: string | undefined;

	constructor(
		private readonly services: AccountPageServices,
		credential: string,
		private readonly onDidClose: () => void
	) {
		super();
		this.credential = credential;
		const document = services.document;
		const $ = createElementFactory(document);
		this.dialog = this._register(
			new AccountDialog(
				document,
				services.overlays,
				{
					title: services.text('tokenCreatedTitle'),
					description: services.text('tokenCreatedBody'),
					size: 'medium'
				},
				services.focusPage
			)
		);
		this.value = $('span.prctr-account-token-credential__value', {
			tabIndex: 0,
			textContent: credential,
			attrs: {
				role: 'textbox',
				'aria-readonly': 'true',
				'aria-label': services.text('tokenCredentialLabel')
			}
		});
		const row = $('div.prctr-account-token-credential', {}, this.value);
		this.dialog.body.append(row);
		const write = services.hooks.writeClipboard;
		if (write !== undefined) {
			this.copy = this._register(
				new ButtonControl(row, { variant: 'secondary', label: services.text('copy') })
			);
			this._register(this.copy.onDidRequest(() => void this.copyCredential(write)));
		}
		this.feedback = this._register(new AccountFeedback(this.dialog.body));
		if (write === undefined) this.feedback.set(services.text('selectToCopy'));
		this.done = this._register(
			new ButtonControl(this.dialog.actions, {
				variant: 'brand',
				label: services.text('done')
			})
		);
		this._register(this.done.onDidRequest(() => this.dispose()));
		this._register(this.dialog.onDidRequestCancel(() => this.dispose()));
		this._register(addDisposableListener(this.value, 'focus', () => this.selectCredential()));
		this.dialog.show(this.copy?.element ?? this.value);
	}

	private selectCredential(): void {
		const selection = this.services.document.getSelection();
		if (selection === null) return;
		selection.selectAllChildren(this.value);
	}

	private async copyCredential(write: (text: string) => Promise<void>): Promise<void> {
		const credential = this.credential;
		if (credential === undefined) return;
		try {
			await write(credential);
			if (!this._store.isDisposed) this.feedback.set(this.services.text('copied'), 'success');
		} catch {
			if (!this._store.isDisposed)
				this.feedback.set(this.services.text('copyFailed'), 'error');
		}
	}

	override dispose(): void {
		if (this._store.isDisposed) return;
		this.credential = undefined;
		this.value.textContent = '';
		this.services.document.getSelection()?.removeAllRanges();
		super.dispose();
		this.onDidClose();
	}
}
