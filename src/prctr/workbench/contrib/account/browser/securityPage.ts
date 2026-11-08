/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { createElementFactory } from '../../../../base/browser/documentElements.js';
import { ButtonControl } from '../../../../base/browser/ui/button/buttonControl.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import type { AccountSecurity } from '../../../../platform/account/common/accountProtocol.js';
import { createSemanticIcon } from '../../../../platform/theme/browser/semanticIcon.js';
import {
	providerKind,
	twoStepPresentation,
	type TwoStepStatus
} from '../common/accountPresentation.js';
import { AccountFeedback } from './accountFeedback.js';
import type { AccountMessage } from './accountMessages.js';
import type { AccountPageServices, AccountPageView } from './accountPageServices.js';
import { AccountRead } from './accountRead.js';
import { AccountSection, type AccountRowModel } from './accountSection.js';

const twoStepMessages: Readonly<Record<TwoStepStatus, AccountMessage>> = Object.freeze({
	notOffered: 'twoStepNotOffered',
	serviceUnavailable: 'twoStepServiceUnavailable',
	recoveryRequired: 'twoStepRecoveryRequired',
	pending: 'twoStepPending',
	on: 'twoStepOn',
	off: 'twoStepOff'
});

/**
 * Sign-in and security: how the person signs in and what protects the account.
 * Every change happens on the institution's hosted security page in the browser;
 * this window only opens it and never handles a password.
 */
export class SecurityPage extends Disposable implements AccountPageView {
	private readonly security: AccountRead<'security'>;
	private readonly ways: AccountSection;
	private readonly twoStep: AccountSection;
	private readonly open: ButtonControl;
	private readonly openFeedback: AccountFeedback;

	constructor(
		body: HTMLElement,
		headerActions: HTMLElement,
		private readonly services: AccountPageServices
	) {
		super();
		const document = body.ownerDocument;
		const $ = createElementFactory(document);
		this.security = this._register(new AccountRead(services, 'security'));
		this.open = this._register(
			new ButtonControl(headerActions, {
				variant: 'secondary',
				label: services.text('openSecurity')
			})
		);
		this.openFeedback = this._register(new AccountFeedback(body));
		this.ways = this._register(
			new AccountSection(body, services, {
				title: services.text('waysToSignIn'),
				description: services.institutionText('waysDescription', 'waysDescriptionGeneric')
			})
		);
		this.twoStep = this._register(
			new AccountSection(body, services, {
				title: services.text('twoStep'),
				description: services.text('twoStepDescription')
			})
		);
		const lock = this._register(
			createSemanticIcon(document, { id: 'security.locked', size: 16 })
		);
		body.append(
			$(
				'div.prctr-account-footnote',
				{},
				lock.element,
				$('p.prctr-account-footnote__text', {
					textContent: services.institutionText(
						'securityFootnote',
						'securityFootnoteGeneric'
					)
				})
			)
		);
		this._register(this.security.onDidChange(() => this.render()));
		this._register(this.open.onDidRequest(() => void this.openSecurityPage()));
		this.render();
	}

	setVisible(visible: boolean): void {
		this.security.setActive(visible);
	}

	private render(): void {
		const state = this.security.state;
		const retry = (): void => void this.security.refresh();
		const security = this.security.data?.security;
		// The password row is always listed, so this section is never empty.
		this.ways.setState(state, false, retry);
		this.twoStep.setState(state, false, retry);
		this.ways.setRows(security === undefined ? [] : this.wayRows(security));
		this.twoStep.setRows(security === undefined ? [] : this.twoStepRows(security));
	}

	private wayRows(security: AccountSecurity): AccountRowModel[] {
		const rows: AccountRowModel[] = security.providers.map((provider, index) => ({
			id: `provider-${index}`,
			title: provider.name,
			detail: this.services.text(
				providerKind(provider.type) === 'singleSignOn' ? 'singleSignOn' : 'otherProvider'
			),
			shape: 'active'
		}));
		rows.push({
			id: 'password',
			title: this.services.text('password'),
			detail: this.passwordDetail(security),
			shape: security.password ? 'active' : 'off'
		});
		return rows;
	}

	private passwordDetail(security: AccountSecurity): string {
		if (!security.password) return this.services.text('passwordNotSet');
		const changed = security.mfa?.passwordChangedAt;
		return changed === undefined
			? this.services.text('passwordSet')
			: this.services.text('passwordChanged', { date: this.services.date(changed) });
	}

	private twoStepDetail(security: AccountSecurity, status: TwoStepStatus): string {
		const mfa = security.mfa;
		if (status !== 'on' || mfa?.method !== 'authenticatorApp')
			return this.services.text(twoStepMessages[status]);
		return mfa.enabledAt === undefined
			? this.services.text('twoStepOnApp')
			: this.services.text('twoStepOnSince', { date: this.services.date(mfa.enabledAt) });
	}

	private twoStepRows(security: AccountSecurity): AccountRowModel[] {
		const presentation = twoStepPresentation(security.mfa);
		const rows: AccountRowModel[] = [
			{
				id: 'two-step',
				title: this.services.text('twoStep'),
				detail: this.twoStepDetail(security, presentation.status),
				shape: presentation.shape
			}
		];
		const recovery = presentation.recovery;
		if (recovery !== undefined)
			rows.push({
				id: 'recovery-codes',
				title: this.services.text('recoveryCodes'),
				detail:
					recovery.total > 0
						? this.services.text(
								recovery.low ? 'recoveryCodesLowOf' : 'recoveryCodesLeftOf',
								{
									count: recovery.remaining,
									total: recovery.total
								}
							)
						: this.services.text(
								recovery.low ? 'recoveryCodesLow' : 'recoveryCodesLeft',
								{
									count: recovery.remaining
								}
							),
				shape: recovery.low ? 'attention' : 'active'
			});
		return rows;
	}

	private async openSecurityPage(): Promise<void> {
		this.open.setState({ label: this.services.text('openSecurity'), busy: true });
		const result = await this.services.request({ kind: 'openSecurity' });
		if (this._store.isDisposed) return;
		this.open.setState({ label: this.services.text('openSecurity') });
		if (result.kind === 'error')
			this.openFeedback.set(this.services.failure(result.reason), 'error');
		else this.openFeedback.set(this.services.text('securityOpened'), 'success');
	}
}
