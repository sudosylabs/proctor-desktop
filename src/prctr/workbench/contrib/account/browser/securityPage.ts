/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { createElementFactory } from '../../../../base/browser/documentElements.js';
import { ButtonControl } from '../../../../base/browser/ui/button/buttonControl.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import type { AccountSecurity } from '../../../../platform/account/common/accountProtocol.js';
import {
	createProctorIcon,
	proctorIconFactory
} from '../../../../platform/theme/browser/proctorIcon.js';
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
				label: services.text('openSecurity'),
				icon: proctorIconFactory('action.openExternal')
			})
		);
		this.openFeedback = this._register(new AccountFeedback(body));
		this.ways = this._register(
			new AccountSection(body, services, {
				title: services.text('waysToSignIn')
			})
		);
		this.twoStep = this._register(
			new AccountSection(body, services, {
				title: services.text('twoStep')
			})
		);
		const lock = this._register(createProctorIcon(document, { id: 'status.locked', size: 16 }));
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
			glyph: 'object.institution',
			title: provider.name,
			detail: this.services.text(
				providerKind(provider.type) === 'singleSignOn' ? 'singleSignOn' : 'otherProvider'
			),
			status: {
				text: this.services.text('statusLinked'),
				icon: 'action.confirm',
				tone: 'success'
			}
		}));
		const changed = security.mfa?.passwordChangedAt;
		rows.push({
			id: 'password',
			glyph: 'object.password',
			title: this.services.text('password'),
			detail: !security.password
				? this.services.text('passwordNotSet')
				: changed === undefined
					? this.services.text('passwordSet')
					: this.services.text('passwordChangedOn', {
							date: this.services.date(changed)
						}),
			status: security.password
				? { text: this.services.text('statusSet'), icon: 'action.confirm', tone: 'success' }
				: { text: this.services.text('statusNotSet'), icon: 'action.close', tone: 'quiet' }
		});
		return rows;
	}

	private twoStepDetail(security: AccountSecurity, status: TwoStepStatus): string {
		const mfa = security.mfa;
		if (status !== 'on' || mfa?.method !== 'authenticatorApp')
			return this.services.text(twoStepMessages[status]);
		return mfa.enabledAt === undefined
			? this.services.text('twoStepApp')
			: this.services.text('twoStepAppSince', { date: this.services.date(mfa.enabledAt) });
	}

	private twoStepRows(security: AccountSecurity): AccountRowModel[] {
		const presentation = twoStepPresentation(security.mfa);
		const status: AccountRowModel['status'] =
			presentation.status === 'on'
				? { text: this.services.text('statusOn'), icon: 'status.success', tone: 'success' }
				: presentation.status === 'off'
					? { text: this.services.text('statusOff'), icon: 'action.close', tone: 'quiet' }
					: presentation.status === 'notOffered'
						? undefined
						: {
								text: this.services.text('statusNeedsAttention'),
								icon: 'status.warning',
								tone: 'warning'
							};
		const rows: AccountRowModel[] = [
			{
				id: 'two-step',
				glyph: 'account.security',
				title: this.services.text('twoStep'),
				detail: this.twoStepDetail(security, presentation.status),
				...(status === undefined ? {} : { status })
			}
		];
		const recovery = presentation.recovery;
		const mfa = security.mfa;
		if (recovery !== undefined)
			rows.push({
				id: 'recovery-codes',
				glyph: 'object.key',
				title: this.services.text('recoveryCodes'),
				detail:
					mfa?.recoveryCodesGeneratedAt === undefined
						? this.services.text('recoveryCodesOnce')
						: this.services.text('recoveryCodesIssued', {
								date: this.services.date(mfa.recoveryCodesGeneratedAt)
							}),
				status: {
					text:
						recovery.total > 0
							? this.services.text('recoveryCodesLeftOf', {
									count: recovery.remaining,
									total: recovery.total
								})
							: this.services.text('recoveryCodesLeft', {
									count: recovery.remaining
								}),
					icon: recovery.low ? 'status.warning' : 'status.info',
					tone: recovery.low ? 'warning' : 'quiet'
				}
			});
		return rows;
	}

	private async openSecurityPage(): Promise<void> {
		const icon = proctorIconFactory('action.openExternal');
		this.open.setState({ label: this.services.text('openSecurity'), busy: true, icon });
		const result = await this.services.request({ kind: 'openSecurity' });
		if (this._store.isDisposed) return;
		this.open.setState({ label: this.services.text('openSecurity'), icon });
		if (result.kind === 'error')
			this.openFeedback.set(this.services.failure(result.reason), 'error');
		else this.openFeedback.set(this.services.text('securityOpened'), 'success');
	}
}
