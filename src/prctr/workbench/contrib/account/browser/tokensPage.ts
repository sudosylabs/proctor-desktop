/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

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
import { AccountConfirmation } from './accountConfirmation.js';
import type { AccountMessage } from './accountMessages.js';
import type { AccountPageServices, AccountPageView } from './accountPageServices.js';
import { AccountRead } from './accountRead.js';
import { AccountSection, type AccountRowAction, type AccountRowModel } from './accountSection.js';
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
export class TokensPage extends Disposable implements AccountPageView {
	private readonly tokens: AccountRead<'tokens'>;
	/** Names scopes and Academic Units; tokens still show when it cannot be read. */
	private readonly grantable: AccountRead<'grantableScopes'>;
	private readonly active: AccountSection;
	private readonly inactive: AccountSection;
	private readonly create: ButtonControl;
	private readonly dialog = this._register(new MutableDisposable());
	private readonly unconfirmed = new Set<string>();

	constructor(
		body: HTMLElement,
		headerActions: HTMLElement,
		private readonly services: AccountPageServices
	) {
		super();
		this.tokens = this._register(new AccountRead(services, 'tokens'));
		this.grantable = this._register(new AccountRead(services, 'grantableScopes'));
		this.create = this._register(
			new ButtonControl(headerActions, {
				variant: 'brand',
				label: services.text('newToken'),
				icon: proctorIconFactory('action.add')
			})
		);
		this.active = this._register(
			new AccountSection(body, services, {
				title: services.text('activeTokens'),
				description: services.text('activeTokensDescription')
			})
		);
		this.inactive = this._register(
			new AccountSection(body, services, {
				title: services.text('inactiveTokens'),
				description: services.text('inactiveTokensDescription')
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
		const groups = groupTokens(data?.tokens ?? [], this.services.now());
		const retry = (): void => void this.tokens.refresh();
		// With no tokens at all the page is one section that says so and offers the first token.
		const none = data !== undefined && groups.active.length + groups.inactive.length === 0;
		this.create.element.hidden = none;
		if (none) this.active.setHeading(this.services.text('yourTokens'));
		else
			this.active.setHeading(
				this.services.text('activeTokens'),
				this.services.text('activeTokensDescription')
			);
		this.active.setState(
			state,
			none
				? {
						title: this.services.text('noTokensTitle'),
						text: this.services.text('noTokensBody'),
						action: {
							label: this.services.text('newToken'),
							icon: 'action.add',
							run: () => this.openNewToken()
						}
					}
				: data !== undefined && groups.active.length === 0
					? this.services.text('noActiveTokens')
					: false,
			retry
		);
		// One read serves both sections, so its loading or failure is shown once, in the first.
		this.inactive.hidden = data === undefined || none;
		this.inactive.setState(
			data === undefined ? { kind: 'ready' } : state,
			groups.inactive.length === 0 ? this.services.text('noInactiveTokens') : false,
			retry
		);
		this.active.setRows(groups.active.map((token) => this.row(token)));
		this.inactive.setRows(groups.inactive.map((token) => this.row(token)));
	}

	private row(token: AccountToken): AccountRowModel {
		const state = tokenState(token, this.services.now());
		const section = state === 'active' ? this.active : this.inactive;
		const actions: AccountRowAction[] = tokenActions(state).map((action) => ({
			label: this.services.text(actionLabels[action]),
			icon: actionIcons[action],
			destructive: action === 'revoke',
			enabled: !this.unconfirmed.has(token.id),
			run: () => this.runAction(action, token, section)
		}));
		const status: AccountRowModel['status'] =
			state === 'disabled'
				? {
						text: this.services.text('tokenDisabledStatus'),
						icon: 'action.disable',
						tone: 'quiet'
					}
				: state === 'expired'
					? {
							text: this.services.text('tokenExpiredStatus'),
							icon: 'status.time',
							tone: 'quiet'
						}
					: state === 'revoked'
						? {
								text: this.services.text('tokenRevokedStatus'),
								icon: 'action.close',
								tone: 'quiet'
							}
						: token.academicUnitId === undefined
							? undefined
							: {
									text: this.unitTag(token.academicUnitId),
									icon: 'object.institution',
									tone: 'quiet'
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
			detail: this.detail(token, state),
			...(status === undefined ? {} : { status }),
			actions
		};
	}

	private unitTag(id: string): string {
		const unit = this.grantable.data?.grantable.academicUnits.find((entry) => entry.id === id);
		return unit === undefined
			? this.services.text('tokenUnitTag')
			: this.services.text('tokenUnitNamedTag', { unit: unit.name });
	}

	private detail(token: AccountToken, state: TokenState): string {
		const grantable = this.grantable.data?.grantable;
		const scopes = token.scopes.map((scope) => scopeTitle(scope, grantable)).join(', ');
		const date = (time: number): string => this.services.date(time);
		let lifetime: string;
		if (state === 'revoked')
			lifetime = this.services.text('tokenRevokedOn', {
				date: date(token.revokedAt ?? token.expiresAt)
			});
		else if (state === 'expired')
			lifetime = this.services.text('tokenExpired', { date: date(token.expiresAt) });
		else if (state === 'disabled')
			lifetime = this.services.join(
				this.services.text('tokenDisabledOn', {
					date: date(token.disabledAt ?? token.createdAt)
				}),
				this.services.text('tokenExpires', { date: date(token.expiresAt) })
			);
		else lifetime = this.services.text('tokenExpires', { date: date(token.expiresAt) });
		const used =
			token.lastUsedAt === undefined
				? this.services.text('tokenNeverUsed')
				: this.services.text('tokenUsed', {
						when: this.services.relative(token.lastUsedAt)
					});
		return this.services.join(this.services.join(scopes, lifetime), used);
	}

	private runAction(action: TokenAction, token: AccountToken, section: AccountSection): void {
		if (action === 'revoke') {
			this.dialog.value = new AccountConfirmation(
				this.services,
				{
					title: this.services.text('confirmRevokeTitle', { name: token.description }),
					message: this.services.text('confirmRevokeBody'),
					confirmLabel: this.services.text('confirmRevokeAction'),
					confirmIcon: 'action.delete',
					run: () => this.services.change({ kind: 'revokeToken', id: token.id }),
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
		void this.services.change(intent).then((result) => {
			if (this._store.isDisposed) return;
			if (result === 'busy') {
				section.feedback.set(this.services.text('busy'), 'error');
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
		section: AccountSection,
		success: AccountMessage
	): void {
		if (result.kind === 'error') {
			if (failureNeedsRead(result.reason)) {
				this.unconfirmed.add(token.id);
				this.render();
			}
			section.feedback.set(this.services.failure(result.reason), 'error');
			if (!failureNeedsRead(result.reason)) {
				section.focusRow(token.id);
				return;
			}
		} else this.services.toast(this.services.text(success));
		section.focusHeading();
		void this.tokens.refresh();
	}

	private openNewToken(): void {
		this.dialog.value = new NewTokenDialog(
			this.services,
			(token, credential) => this.showCredential(token, credential),
			() => undefined
		);
	}

	/** The credential passes straight into its dialog; this page never keeps it. */
	private showCredential(token: AccountToken, credential: string): void {
		this.dialog.value = new TokenCreatedDialog(this.services, credential, () => {
			if (this._store.isDisposed) return;
			this.services.toast(this.services.text('tokenCreated'));
			if (!this.active.focusRow(token.id)) this.create.focus();
		});
		void this.tokens.refresh();
	}
}
