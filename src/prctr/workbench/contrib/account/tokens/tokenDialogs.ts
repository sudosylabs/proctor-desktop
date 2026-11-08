/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { IAccountService } from '../../../services/account/common/account.js';
import { IAccountFormatService } from '../accountFormat.js';
import { IAccountPaneContext } from '../accountPaneContext.js';
import { IClipboardService } from '../../../../platform/clipboard/common/clipboardService.js';
import { createElementFactory } from '../../../../base/browser/documentElements.js';
import { addDisposableListener } from '../../../../base/browser/dom.js';
import { ButtonControl } from '../../../../base/browser/ui/button/buttonControl.js';
import { SelectControl } from '../../../../base/browser/ui/select/selectControl.js';
import { TextFieldControl } from '../../../../base/browser/ui/field/textField.js';
import { status } from '../../../../base/browser/ui/aria/aria.js';
import { Disposable, MutableDisposable, toDisposable } from '../../../../base/common/lifecycle.js';
import type {
	AccountGrantableScope,
	AccountGrantableScopes,
	AccountIntent,
	AccountToken
} from '../../../../platform/account/common/accountProtocol.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { ConfirmItsYouDialog } from '../widgets/confirmItsYouDialog.js';
import {
	DEFAULT_TOKEN_EXPIRY,
	scopeGrantable,
	tokenExpiry,
	tokenExpiryPresets,
	validateTokenDraft,
	type TokenExpiryPreset
} from '../common/accountPresentation.js';
import { proctorIconFactory } from '../../../../platform/theme/browser/proctorIcon.js';
import { AccountDialog } from '../widgets/accountDialog.js';
import { AccountFeedback } from '../widgets/accountFeedback.js';
import './media/tokenDialogs.css';

const CANCEL_ICON = proctorIconFactory('action.close');
const SELECT_CARET = proctorIconFactory('action.expand', 14);
const CREATE_ICON = proctorIconFactory('action.add');

let scopeSequence = 0;

const NO_LIMIT = '';

/**
 * Asks for a new token's name, what it can do, where it applies and when it
 * expires, then creates it. The scopes and Academic Units offered are the ones
 * the server says this person may grant; the server checks them again on
 * creation. The one-time credential goes straight to the copy dialog.
 */
/** How long a Copy button says Copied before it reads Copy again. */
const COPIED_MS = 2000;

export class NewTokenDialog extends Disposable {
	private readonly dialog: AccountDialog;
	private readonly name: TextFieldControl;
	private scopes: readonly {
		readonly scope: AccountGrantableScope;
		readonly input: HTMLInputElement;
	}[] = [];
	private readonly scopeList: HTMLElement;
	private readonly scopeStatus: HTMLElement;
	private readonly scopeError: HTMLElement;
	private readonly limit: HTMLSelectElement;
	private readonly limitField: HTMLElement;
	private readonly limitHint: HTMLElement;
	private readonly expiry: HTMLSelectElement;
	private grantable: AccountGrantableScopes | undefined;
	private readonly feedback: AccountFeedback;
	private readonly cancel: ButtonControl;
	private readonly create: ButtonControl;
	private nameValue = '';
	private working = false;
	/** Confirm it's you is open or its retry is in flight; a second refusal is then reported. */
	private confirming = false;
	private readonly confirmation = this._register(new MutableDisposable<ConfirmItsYouDialog>());

	constructor(
		private readonly onDidCreate: (token: AccountToken, credential: string) => void,
		private readonly onDidClose: () => void,
		@IAccountService private readonly account: IAccountService,
		@IAccountFormatService private readonly format: IAccountFormatService,
		@IAccountPaneContext private readonly pane: IAccountPaneContext,
		@IInstantiationService private readonly instantiationService: IInstantiationService
	) {
		super();
		const document = this.pane.document;
		const $ = createElementFactory(document);
		const now = this.format.now();
		this.dialog = this._register(
			new AccountDialog(
				document,
				this.pane.overlays,
				{
					title: this.format.text('newTokenTitle'),
					description: this.format.text('newTokenDescription'),
					size: 'medium'
				},
				this.pane.focusPage
			)
		);
		this.name = this._register(
			new TextFieldControl(this.dialog.body, {
				label: this.format.text('tokenName'),
				description: this.format.text('tokenNameHint'),
				value: '',
				required: true
			})
		);
		const legend = $('legend.prctr-account-token-form__legend', {
			textContent: this.format.text('tokenScopes')
		});
		const scopeId = `prctr-account-token-scopes-${++scopeSequence}`;
		this.scopeError = $('p.prctr-account-token-form__error', {
			id: `${scopeId}-error`,
			hidden: true
		});
		this.scopeStatus = $('p.prctr-account-token-form__status', {
			id: `${scopeId}-status`,
			textContent: this.format.text('tokenScopesLoading')
		});
		this.scopeList = $('div.prctr-account-token-form__scope-list', { hidden: true });
		const fieldset = $(
			'fieldset.prctr-account-token-form__scopes',
			{ attrs: { 'aria-describedby': `${this.scopeStatus.id} ${this.scopeError.id}` } },
			legend,
			this.scopeStatus,
			this.scopeList,
			this.scopeError
		);
		// Both lists are Proctor selects, so the chevron keeps its room inside the field.
		this.limitField = $('div.prctr-account-token-form__field', { hidden: true });
		this.limit = this._register(
			new SelectControl<string>(this.limitField, {
				id: `${scopeId}-limit`,
				choices: [],
				value: '',
				caret: SELECT_CARET
			})
		).select;
		this.limit.setAttribute('aria-describedby', `${scopeId}-limit-hint`);
		this.limitHint = $('p.prctr-account-token-form__hint', {
			id: `${scopeId}-limit-hint`,
			hidden: true,
			textContent: this.format.text('tokenLimitMore')
		});
		this.limitField.prepend(
			$('label.prctr-account-token-form__label', {
				htmlFor: this.limit.id,
				textContent: this.format.text('tokenLimit')
			})
		);
		this.limitField.append(this.limitHint);
		const expiryField = $('div.prctr-account-token-form__field');
		this.expiry = this._register(
			new SelectControl<string>(expiryField, {
				id: `${scopeId}-expiry`,
				choices: tokenExpiryPresets.map((days) => ({
					value: String(days),
					label: this.format.text('tokenExpiryOption', {
						days,
						date: this.format.date(tokenExpiry(days, now))
					})
				})),
				value: String(DEFAULT_TOKEN_EXPIRY),
				caret: SELECT_CARET
			})
		).select;
		this.expiry.required = true;
		expiryField.prepend(
			$('label.prctr-account-token-form__label', {
				htmlFor: this.expiry.id,
				textContent: this.format.text('tokenExpiry')
			})
		);
		this.dialog.body.append(
			fieldset,
			$('div.prctr-account-token-form__row', {}, this.limitField, expiryField)
		);
		this.feedback = this._register(new AccountFeedback(this.dialog.body));
		this.cancel = this._register(
			new ButtonControl(this.dialog.actions, {
				variant: 'secondary',
				label: this.format.text('cancel'),
				icon: CANCEL_ICON
			})
		);
		this.create = this._register(
			new ButtonControl(this.dialog.actions, {
				variant: 'brand',
				label: this.format.text('createToken'),
				icon: CREATE_ICON
			})
		);
		this.registerListeners();
		this.setWorking(false);
		this.dialog.show(this.name.input);
		void this.readGrantable();
	}

	/** Reads what this person may grant; until it arrives nothing can be ticked or created. */
	private async readGrantable(): Promise<void> {
		const result = await this.account.request({ kind: 'read', section: 'grantableScopes' });
		if (this._store.isDisposed) return;
		if (result.kind !== 'data' || result.data.section !== 'grantableScopes') {
			this.scopeStatus.textContent = this.format.failure(
				result.kind === 'error' ? result.reason : 'invalid'
			);
			this.scopeStatus.classList.add('prctr-account-token-form__status--error');
			return;
		}
		this.showGrantable(result.data.grantable);
	}

	private showGrantable(grantable: AccountGrantableScopes): void {
		const $ = createElementFactory(this.pane.document);
		this.grantable = grantable;
		this.scopes = grantable.scopes.map((scope) => {
			const input = $('input.prctr-account-token-form__checkbox', {
				type: 'checkbox',
				value: scope.name
			});
			const description = $('span.prctr-account-token-form__scope-description', {
				textContent: scope.description
			});
			this.scopeList.append(
				$(
					'label.prctr-account-token-form__scope',
					{},
					input,
					$(
						'span.prctr-account-token-form__scope-text',
						{},
						$('span.prctr-account-token-form__scope-title', {
							textContent: scope.title
						}),
						description
					)
				)
			);
			return { scope, input };
		});
		const empty = grantable.scopes.length === 0;
		this.scopeStatus.hidden = !empty;
		this.scopeStatus.textContent = empty ? this.format.text('tokenScopesNone') : '';
		this.scopeList.hidden = empty;
		const anywhere = grantable.scopes.some((scope) => scope.institutionWide);
		if (anywhere)
			this.limit.append(
				$('option', { value: NO_LIMIT, textContent: this.format.text('tokenLimitNone') })
			);
		for (const unit of grantable.academicUnits)
			this.limit.append($('option', { value: unit.id, textContent: unit.name }));
		// A limit is offered only when there is something to choose between.
		this.limitField.hidden = grantable.academicUnits.length === 0;
		this.limitHint.hidden = !grantable.moreAcademicUnits;
		this.setWorking(false);
	}

	private academicUnitId(): string | undefined {
		return this.limit.value === NO_LIMIT ? undefined : this.limit.value;
	}

	/** Scopes that cannot apply where the token is limited are unticked and unavailable. */
	private applyLimit(): void {
		const unit = this.academicUnitId();
		for (const entry of this.scopes) {
			const grantable = scopeGrantable(entry.scope, unit);
			if (!grantable) entry.input.checked = false;
			entry.input.disabled = this.working || !grantable;
		}
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
		this._register(addDisposableListener(this.limit, 'change', () => this.applyLimit()));
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
		return this.scopes.filter((entry) => entry.input.checked).map((entry) => entry.scope.name);
	}

	private selectedScopeTitles(): string[] {
		return this.scopes.filter((entry) => entry.input.checked).map((entry) => entry.scope.title);
	}

	private async submit(): Promise<void> {
		if (this.working || this.grantable === undefined || this.scopes.length === 0) return;
		const scopes = this.selectedScopes();
		const errors = validateTokenDraft({ name: this.nameValue, scopes });
		this.name.setState({
			value: this.nameValue,
			required: true,
			...(errors.name === undefined ? {} : { error: this.format.text(errors.name) })
		});
		this.scopeError.hidden = errors.scopes === undefined;
		this.scopeError.textContent =
			errors.scopes === undefined ? '' : this.format.text(errors.scopes);
		if (errors.name !== undefined) {
			this.name.input.focus();
			return;
		}
		if (errors.scopes !== undefined) {
			this.scopes.find((entry) => !entry.input.disabled)?.input.focus();
			return;
		}
		const academicUnitId = this.academicUnitId();
		const days = Number(this.expiry.value) as TokenExpiryPreset;
		await this.send({
			kind: 'createToken',
			description: this.nameValue.trim(),
			scopes,
			...(academicUnitId === undefined ? {} : { academicUnitId }),
			expiresAt: tokenExpiry(days, this.format.now())
		});
	}

	/**
	 * Sends the request. When the institution wants a recent sign-in first, the form steps aside
	 * for Confirm it's you and the same request is sent again once confirmed; nothing was created
	 * by the refused attempt.
	 */
	private async send(intent: Extract<AccountIntent, { kind: 'createToken' }>): Promise<void> {
		this.setWorking(true);
		this.feedback.set(this.format.text('tokenCreating'), 'loading');
		const result = await this.account.change(intent);
		if (this._store.isDisposed) return;
		this.setWorking(false);
		if (result !== 'busy' && result.kind === 'tokenCreated') {
			this.dispose();
			this.onDidCreate(result.token, result.credential);
			return;
		}
		if (
			result !== 'busy' &&
			result.kind === 'error' &&
			result.reason === 'reauthenticationRequired' &&
			!this.confirming
		) {
			this.confirm(intent);
			return;
		}
		this.feedback.set(
			result === 'busy'
				? this.format.text('busy')
				: result.kind === 'error'
					? this.format.failure(result.reason)
					: this.format.failure('invalid'),
			'error'
		);
		this.create.focus();
	}

	private confirm(intent: Extract<AccountIntent, { kind: 'createToken' }>): void {
		this.confirming = true;
		this.feedback.set();
		this.dialog.element.close();
		const summary = [
			intent.description,
			this.selectedScopeTitles().join(', '),
			this.expiry.selectedOptions[0]?.textContent ?? ''
		].filter((line) => line !== '');
		this.confirmation.value = this.instantiationService.createInstance(
			ConfirmItsYouDialog,
			summary,
			(confirmed) => {
				if (this._store.isDisposed) return;
				this.dialog.show(this.create.element);
				if (confirmed) void this.send(intent).finally(() => (this.confirming = false));
				else this.confirming = false;
			}
		);
	}

	private setWorking(working: boolean): void {
		this.working = working;
		this.name.setState({ value: this.nameValue, required: true, disabled: working });
		this.applyLimit();
		this.limit.disabled = working;
		this.expiry.disabled = working;
		this.cancel.setState({
			label: this.format.text('cancel'),
			icon: CANCEL_ICON,
			disabled: working
		});
		this.create.setState({
			label: this.format.text('createToken'),
			icon: CREATE_ICON,
			busy: working,
			disabled: !working && this.scopes.length === 0
		});
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
	private readonly copy: ButtonControl;
	/** Restores the Copy label after it has said Copied. */
	private readonly copiedReset = this._register(new MutableDisposable());
	private readonly done: ButtonControl;
	private credential: string | undefined;

	constructor(
		credential: string,
		private readonly onDidClose: () => void,
		@IAccountFormatService private readonly format: IAccountFormatService,
		@IAccountPaneContext private readonly pane: IAccountPaneContext,
		@IClipboardService private readonly clipboard: IClipboardService
	) {
		super();
		this.credential = credential;
		const document = this.pane.document;
		const $ = createElementFactory(document);
		this.dialog = this._register(
			new AccountDialog(
				document,
				this.pane.overlays,
				{
					title: this.format.text('tokenCreatedTitle'),
					description: this.format.text('tokenCreatedBody'),
					size: 'medium'
				},
				this.pane.focusPage
			)
		);
		this.value = $('span.prctr-account-token-credential__value', {
			tabIndex: 0,
			textContent: credential,
			attrs: {
				role: 'textbox',
				'aria-readonly': 'true',
				'aria-label': this.format.text('tokenCredentialLabel')
			}
		});
		const row = $('div.prctr-account-token-credential', {}, this.value);
		this.dialog.body.append(row);
		this.copy = this._register(
			new ButtonControl(row, {
				variant: 'secondary',
				size: 'small',
				label: this.format.text('copy'),
				icon: proctorIconFactory('action.copy', 14)
			})
		);
		this._register(this.copy.onDidRequest(() => void this.copyCredential()));
		this.feedback = this._register(new AccountFeedback(this.dialog.body));
		this.done = this._register(
			new ButtonControl(this.dialog.actions, {
				variant: 'brand',
				label: this.format.text('done'),
				icon: proctorIconFactory('action.confirm')
			})
		);
		this._register(this.done.onDidRequest(() => this.dispose()));
		this._register(this.dialog.onDidRequestCancel(() => this.dispose()));
		this._register(addDisposableListener(this.value, 'focus', () => this.selectCredential()));
		this.dialog.show(this.copy?.element ?? this.value);
	}

	private selectCredential(): void {
		const selection = this.pane.document.getSelection();
		if (selection === null) return;
		selection.selectAllChildren(this.value);
	}

	private async copyCredential(): Promise<void> {
		const credential = this.credential;
		if (credential === undefined) return;
		try {
			await this.clipboard.writeText(credential);
			if (!this._store.isDisposed) this.showCopied();
		} catch {
			if (!this._store.isDisposed) this.feedback.set(this.format.text('copyFailed'), 'error');
		}
	}

	/** The button itself confirms the copy for a moment, keeping its width; nothing appears below. */
	private showCopied(): void {
		const button = this.copy;
		if (button === undefined) return;
		const element = button.element;
		element.style.minInlineSize = `${element.getBoundingClientRect().width}px`;
		button.setState({
			label: this.format.text('copiedButton'),
			icon: proctorIconFactory('action.confirm', 14)
		});
		element.dataset.copied = 'true';
		this.feedback.set();
		status(this.format.text('copied'));
		const timer = setTimeout(() => this.copiedReset.clear(), COPIED_MS);
		this.copiedReset.value = toDisposable(() => {
			clearTimeout(timer);
			if (this._store.isDisposed) return;
			delete element.dataset.copied;
			button.setState({
				label: this.format.text('copy'),
				icon: proctorIconFactory('action.copy', 14)
			});
		});
	}

	override dispose(): void {
		if (this._store.isDisposed) return;
		this.credential = undefined;
		this.value.textContent = '';
		this.pane.document.getSelection()?.removeAllRanges();
		super.dispose();
		this.onDidClose();
	}
}
