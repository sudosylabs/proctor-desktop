/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { IAccountService } from '../../../services/account/common/account.js';
import { IAccountFormatService } from '../accountFormat.js';
import { IPagePaneContext } from '../../../browser/authenticated/pages/pagePaneContext.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { ConfirmItsYouDialog } from '../../../browser/authenticated/pages/confirmItsYouDialog.js';
import { accountReauthentication } from '../widgets/accountReauthentication.js';
import { ButtonControl } from '../../../../base/browser/ui/button/buttonControl.js';
import { Disposable, MutableDisposable } from '../../../../base/common/lifecycle.js';
import type {
	AccountIntent,
	AccountResponse,
	AccountToken
} from '../../../../platform/account/common/accountProtocol.js';
import {
	failureNeedsRead,
	groupTokens,
	scopeTitle,
	tokenActions,
	tokenState,
	type TokenAction,
	type TokenState
} from '../common/accountPresentation.js';
import { proctorIconFactory } from '../../../../platform/theme/browser/proctorIcon.js';
import type { ProctorIconId } from '../../../../platform/theme/common/proctorIcons.js';
import { AccountConfirmation } from '../widgets/accountConfirmation.js';
import type { AccountMessage } from '../accountMessages.js';
import type { PageView } from '../../../browser/authenticated/pages/pagePane.js';
import { AccountRead } from '../widgets/accountRead.js';
import {
	PageSection,
	type PageRowAction,
	type PageRowModel
} from '../../../browser/authenticated/pages/pageSection.js';
import { NewTokenDialog, TokenCreatedDialog } from './tokenDialogs.js';

const actionLabels: Readonly<Record<TokenAction, AccountMessage>> = Object.freeze({
	disable: 'disableToken',
	enable: 'enableToken',
	revoke: 'revokeTokenEllipsis'
});

const actionIcons: Readonly<Record<TokenAction, ProctorIconId>> = Object.freeze({
	disable: 'action.disable',
	enable: 'action.enable',
	revoke: 'action.delete'
});

/**
 * Access tokens: the person's Personal Access Tokens, split into those that work
 * now and those that are disabled, expired or revoked. Disabling and enabling
 * apply at once; revoking is permanent and confirmed first.
 */
export class TokensPage extends Disposable implements PageView {
	private readonly tokens: AccountRead<'tokens'>;
	/** Names scopes and Academic Units; tokens still show when it cannot be read. */
	private readonly grantable: AccountRead<'grantableScopes'>;
	private readonly active: PageSection;
	private readonly inactive: PageSection;
	private readonly create: ButtonControl;
	private readonly dialog = this._register(new MutableDisposable());
	private readonly unconfirmed = new Set<string>();

	constructor(
		body: HTMLElement,
		headerActions: HTMLElement,
		@IAccountService private readonly account: IAccountService,
		@IAccountFormatService private readonly format: IAccountFormatService,
		@IPagePaneContext private readonly pane: IPagePaneContext,
		@IInstantiationService private readonly instantiationService: IInstantiationService
	) {
		super();
		this.tokens = this._register(
			this.instantiationService.createInstance(AccountRead<'tokens'>, 'tokens')
		);
		this.grantable = this._register(
			this.instantiationService.createInstance(
				AccountRead<'grantableScopes'>,
				'grantableScopes'
			)
		);
		this.create = this._register(
			new ButtonControl(headerActions, {
				variant: 'brand',
				label: this.format.text('newToken'),
				icon: proctorIconFactory('action.add')
			})
		);
		this.active = this._register(
			this.instantiationService.createInstance(PageSection, body, {
				title: this.format.text('activeTokens'),
				description: this.format.text('activeTokensDescription')
			})
		);
		this.inactive = this._register(
			this.instantiationService.createInstance(PageSection, body, {
				title: this.format.text('inactiveTokens'),
				description: this.format.text('inactiveTokensDescription')
			})
		);
		this._register(this.tokens.onDidChange(() => this.render()));
		this._register(this.grantable.onDidChange(() => this.render()));
		this._register(this.tokens.onDidRead(() => this.onRead()));
		this._register(this.create.onDidRequest(() => this.openNewToken()));
		this.render();
	}

	setVisible(visible: boolean): void {
		this.tokens.setActive(visible);
		this.grantable.setActive(visible);
	}

	private onRead(): void {
		if (this.unconfirmed.size === 0) return;
		this.unconfirmed.clear();
		this.render();
	}

	private render(): void {
		const state = this.tokens.state;
		const data = this.tokens.data;
		const groups = groupTokens(data?.tokens ?? [], this.format.now());
		const retry = (): void => void this.tokens.refresh();
		// With no tokens at all the page is one section that says so and offers the first token.
		const none = data !== undefined && groups.active.length + groups.inactive.length === 0;
		// When the empty Active section offers the first or next token, the header does not repeat it.
		this.create.element.hidden = none || (data !== undefined && groups.active.length === 0);
		if (none) this.active.setHeading(this.format.text('yourTokens'));
		else
			this.active.setHeading(
				this.format.text('activeTokens'),
				this.format.text('activeTokensDescription')
			);
		this.active.setState(
			state,
			none
				? {
						title: this.format.text('noTokensTitle'),
						text: this.format.text('noTokensBody'),
						action: {
							label: this.format.text('newToken'),
							icon: 'action.add',
							run: () => this.openNewToken()
						}
					}
				: data !== undefined && groups.active.length === 0
					? {
							title: this.format.text('noActiveTokens'),
							text: this.format.text('noActiveTokensBody'),
							action: {
								label: this.format.text('newToken'),
								icon: 'action.add',
								run: () => this.openNewToken()
							}
						}
					: false,
			retry
		);
		// One read serves both sections, so its loading or failure is shown once, in the first.
		// A section with nothing in it is left out rather than saying so.
		this.inactive.hidden = data === undefined || groups.inactive.length === 0;
		this.inactive.setState(data === undefined ? { kind: 'ready' } : state, false, retry);
		this.active.setRows(groups.active.map((token) => this.row(token)));
		this.inactive.setRows(groups.inactive.map((token) => this.row(token)));
	}

	private row(token: AccountToken): PageRowModel {
		const state = tokenState(token, this.format.now());
		const section = state === 'active' ? this.active : this.inactive;
		const actions: PageRowAction[] = tokenActions(state).map((action) => ({
			label: this.format.text(actionLabels[action]),
			icon: actionIcons[action],
			destructive: action === 'revoke',
			enabled: !this.unconfirmed.has(token.id),
			run: () => this.runAction(action, token, section)
		}));
		const status: PageRowModel['status'] =
			state === 'disabled'
				? {
						text: this.format.text('tokenDisabledStatus'),
						tone: 'neutral'
					}
				: state === 'expired'
					? {
							text: this.format.text('tokenExpiredStatus'),
							tone: 'neutral'
						}
					: state === 'revoked'
						? {
								text: this.format.text('tokenRevokedStatus'),
								tone: 'neutral'
							}
						: token.academicUnitId === undefined
							? undefined
							: {
									text: this.unitTag(token.academicUnitId),
									tone: 'neutral'
								};
		return {
			id: token.id,
			glyph:
				state === 'disabled'
					? 'action.disable'
					: state === 'active'
						? 'object.key'
						: 'status.time',
			title: token.description,
			chips: token.scopes.map((scope) => scopeTitle(scope, this.grantable.data?.grantable)),
			detail: this.detail(token, state),
			...(status === undefined ? {} : { status }),
			actions
		};
	}

	private unitTag(id: string): string {
		const unit = this.grantable.data?.grantable.academicUnits.find((entry) => entry.id === id);
		return unit === undefined
			? this.format.text('tokenUnitTag')
			: this.format.text('tokenUnitNamedTag', { unit: unit.name });
	}

	private detail(token: AccountToken, state: TokenState): string {
		const date = (time: number): string => this.format.date(time);
		let lifetime: string;
		if (state === 'revoked')
			lifetime = this.format.text('tokenRevokedOn', {
				date: date(token.revokedAt ?? token.expiresAt)
			});
		else if (state === 'expired')
			lifetime = this.format.text('tokenExpired', { date: date(token.expiresAt) });
		else if (state === 'disabled')
			lifetime = this.format.join(
				this.format.text('tokenDisabledOn', {
					date: date(token.disabledAt ?? token.createdAt)
				}),
				this.format.text('tokenExpires', { date: date(token.expiresAt) })
			);
		else lifetime = this.format.text('tokenExpiresFirst', { date: date(token.expiresAt) });
		const used =
			token.lastUsedAt === undefined
				? this.format.text('tokenNeverUsed')
				: this.format.text('tokenUsed', {
						when: this.format.relative(token.lastUsedAt)
					});
		return this.format.join(lifetime, used);
	}

	private runAction(action: TokenAction, token: AccountToken, section: PageSection): void {
		if (action === 'revoke') {
			this.dialog.value = this.instantiationService.createInstance(
				AccountConfirmation,
				{
					title: this.format.text('confirmRevokeTitle', { name: token.description }),
					message: this.format.text('confirmRevokeBody'),
					confirmLabel: this.format.text('confirmRevokeAction'),
					confirmIcon: 'action.delete',
					run: () => this.account.change({ kind: 'revokeToken', id: token.id }),
					onDidComplete: (result) =>
						this.onChangeComplete(result, token, section, 'tokenRevoked')
				},
				() => undefined
			);
			return;
		}
		const intent: AccountIntent = {
			kind: action === 'disable' ? 'disableToken' : 'enableToken',
			id: token.id
		};
		this.sendToggle(intent, action, token, section, false);
	}

	/** Turning a token back on may need a recent sign-in: Confirm it's you, then the same request again. */
	private sendToggle(
		intent: AccountIntent,
		action: TokenAction,
		token: AccountToken,
		section: PageSection,
		confirmed: boolean
	): void {
		void this.account.change(intent).then((result) => {
			if (this._store.isDisposed) return;
			if (result === 'busy') {
				section.feedback.set(this.format.text('busy'), 'error');
				return;
			}
			if (
				!confirmed &&
				result.kind === 'error' &&
				result.reason === 'reauthenticationRequired'
			) {
				this.dialog.value = this.instantiationService.createInstance(
					ConfirmItsYouDialog,
					[token.description, this.format.text('tokenEnableSummary')],
					(ok) => {
						if (this._store.isDisposed) return;
						if (ok) this.sendToggle(intent, action, token, section, true);
						else section.focusRow(token.id);
					},
					accountReauthentication(this.account, this.format)
				);
				return;
			}
			this.onChangeComplete(
				result,
				token,
				section,
				action === 'disable' ? 'tokenDisabled' : 'tokenEnabled'
			);
		});
	}

	private onChangeComplete(
		result: AccountResponse,
		token: AccountToken,
		section: PageSection,
		success: AccountMessage
	): void {
		if (result.kind === 'error') {
			if (failureNeedsRead(result.reason)) {
				this.unconfirmed.add(token.id);
				this.render();
			}
			section.feedback.set(this.format.failure(result.reason), 'error');
			if (!failureNeedsRead(result.reason)) {
				section.focusRow(token.id);
				return;
			}
		} else this.pane.toast(this.format.text(success));
		section.focusHeading();
		void this.tokens.refresh();
	}

	private openNewToken(): void {
		this.dialog.value = this.instantiationService.createInstance(
			NewTokenDialog,
			(token, credential) => this.showCredential(token, credential),
			() => undefined
		);
	}

	/** The credential passes straight into its dialog; this page never keeps it. */
	private showCredential(token: AccountToken, credential: string): void {
		this.dialog.value = this.instantiationService.createInstance(
			TokenCreatedDialog,
			credential,
			() => {
				if (this._store.isDisposed) return;
				this.pane.toast(this.format.text('tokenCreated'));
				if (!this.active.focusRow(token.id)) this.create.focus();
			}
		);
		void this.tokens.refresh();
	}
}
