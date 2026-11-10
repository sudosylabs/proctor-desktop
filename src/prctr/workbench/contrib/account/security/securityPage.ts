/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { IAccountService } from '../../../services/account/common/account.js';
import { IAccountFormatService } from '../accountFormat.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
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
import { PageFeedback } from '../../../browser/authenticated/pages/pageFeedback.js';
import type { AccountMessage } from '../accountMessages.js';
import type { PageView } from '../../../browser/authenticated/pages/pagePane.js';
import { AccountRead } from '../widgets/accountRead.js';
import {
	PageSection,
	type PageRowModel
} from '../../../browser/authenticated/pages/pageSection.js';

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
export class SecurityPage extends Disposable implements PageView {
	private readonly security: AccountRead<'security'>;
	private readonly ways: PageSection;
	private readonly twoStep: PageSection;
	private readonly open: ButtonControl;
	private readonly openFeedback: PageFeedback;

	constructor(
		body: HTMLElement,
		headerActions: HTMLElement,
		@IAccountService private readonly account: IAccountService,
		@IAccountFormatService private readonly format: IAccountFormatService,
		@IInstantiationService private readonly instantiationService: IInstantiationService
	) {
		super();
		const document = body.ownerDocument;
		const $ = createElementFactory(document);
		this.security = this._register(
			this.instantiationService.createInstance(AccountRead<'security'>, 'security')
		);
		this.open = this._register(
			new ButtonControl(headerActions, {
				variant: 'secondary',
				label: this.format.text('openSecurity'),
				icon: proctorIconFactory('action.openExternal')
			})
		);
		this.openFeedback = this._register(new PageFeedback(body));
		this.ways = this._register(
			this.instantiationService.createInstance(PageSection, body, {
				title: this.format.text('waysToSignIn')
			})
		);
		this.twoStep = this._register(
			this.instantiationService.createInstance(PageSection, body, {
				title: this.format.text('twoStep')
			})
		);
		const lock = this._register(createProctorIcon(document, { id: 'status.locked', size: 16 }));
		body.append(
			$(
				'div.prctr-account-footnote',
				{},
				lock.element,
				$('p.prctr-account-footnote__text', {
					textContent: this.format.institutionText(
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

	private wayRows(security: AccountSecurity): PageRowModel[] {
		const rows: PageRowModel[] = security.providers.map((provider, index) => ({
			id: `provider-${index}`,
			glyph: 'object.institution',
			title: provider.name,
			detail: this.format.text(
				providerKind(provider.type) === 'singleSignOn' ? 'singleSignOn' : 'otherProvider'
			),
			status: {
				text: this.format.text('statusLinked'),
				tone: 'success'
			}
		}));
		const changed = security.mfa?.passwordChangedAt;
		rows.push({
			id: 'password',
			glyph: 'object.password',
			title: this.format.text('password'),
			detail: !security.password
				? this.format.text('passwordNotSet')
				: changed === undefined
					? this.format.text('passwordSet')
					: this.format.text('passwordChangedOn', {
							date: this.format.date(changed)
						}),
			status: security.password
				? { text: this.format.text('statusSet'), tone: 'success' }
				: { text: this.format.text('statusNotSet'), tone: 'quiet' }
		});
		return rows;
	}

	private twoStepDetail(security: AccountSecurity, status: TwoStepStatus): string {
		const mfa = security.mfa;
		if (status !== 'on' || mfa?.method !== 'authenticatorApp')
			return this.format.text(twoStepMessages[status]);
		return mfa.enabledAt === undefined
			? this.format.text('twoStepApp')
			: this.format.text('twoStepAppSince', { date: this.format.date(mfa.enabledAt) });
	}

	private twoStepRows(security: AccountSecurity): PageRowModel[] {
		const presentation = twoStepPresentation(security.mfa);
		const status: PageRowModel['status'] =
			presentation.status === 'on'
				? { text: this.format.text('statusOn'), tone: 'success' }
				: presentation.status === 'off'
					? { text: this.format.text('statusOff'), tone: 'failure' }
					: presentation.status === 'notOffered'
						? undefined
						: {
								text: this.format.text('statusNeedsAttention'),
								tone: 'warning'
							};
		const rows: PageRowModel[] = [
			{
				id: 'two-step',
				glyph: 'account.security',
				title: this.format.text('twoStep'),
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
				title: this.format.text('recoveryCodes'),
				detail:
					mfa?.recoveryCodesGeneratedAt === undefined
						? this.format.text('recoveryCodesOnce')
						: this.format.text('recoveryCodesIssued', {
								date: this.format.date(mfa.recoveryCodesGeneratedAt)
							}),
				status: {
					text:
						recovery.total > 0
							? this.format.text('recoveryCodesLeftOf', {
									count: recovery.remaining,
									total: recovery.total
								})
							: this.format.text('recoveryCodesLeft', {
									count: recovery.remaining
								}),
					tone: recovery.low ? 'warning' : 'quiet'
				}
			});
		return rows;
	}

	private async openSecurityPage(): Promise<void> {
		const icon = proctorIconFactory('action.openExternal');
		this.open.setState({ label: this.format.text('openSecurity'), busy: true, icon });
		const result = await this.account.request({ kind: 'openSecurity' });
		if (this._store.isDisposed) return;
		this.open.setState({ label: this.format.text('openSecurity'), icon });
		if (result.kind === 'error')
			this.openFeedback.set(this.format.failure(result.reason), 'error');
		else this.openFeedback.set(this.format.text('securityOpened'), 'success');
	}
}
