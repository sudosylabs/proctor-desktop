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
	off: 'twoStepOffPassword'
});

/**
 * Sign-in and security: how the person signs in and what protects the account.
 * Every change happens on the institution's hosted security page in the browser;
 * this window only opens it and never handles a password.
 */
export class SecurityPage extends Disposable implements PageView {
	private readonly security: AccountRead<'security'>;
	/** Names the address single sign-on uses; the page reads well without it. */
	private readonly profile: AccountRead<'profile'>;
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
				title: this.format.text('extraProtection')
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
		this.profile = this._register(
			this.instantiationService.createInstance(AccountRead<'profile'>, 'profile')
		);
		this._register(this.security.onDidChange(() => this.render()));
		this._register(this.profile.onDidChange(() => this.render()));
		this._register(this.open.onDidRequest(() => void this.openSecurityPage()));
		this.render();
	}

	setVisible(visible: boolean): void {
		this.security.setActive(visible);
		this.profile.setActive(visible);
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

	/**
	 * The two ways to sign in read as two methods, named from the linked provider: "Northbridge
	 * Microsoft account · Single sign-on with ⟨email⟩" and "Proctor password · For signing in
	 * without Northbridge Microsoft account".
	 */
	private wayRows(security: AccountSecurity): PageRowModel[] {
		const email = this.profile.data?.profile.email;
		const rows: PageRowModel[] = security.providers.map((provider, index) => ({
			id: `provider-${index}`,
			glyph: 'object.institution',
			title: provider.name,
			detail:
				providerKind(provider.type) === 'singleSignOn'
					? email === undefined
						? this.format.text('singleSignOn')
						: this.format.text('singleSignOnWith', { email })
					: this.format.text('statusLinked'),
			status: { text: this.format.text('statusLinked'), tone: 'safeguard' }
		}));
		const changed = security.mfa?.passwordChangedAt;
		const provider = security.providers[0]?.name;
		const parts: string[] = [];
		if (security.password && provider !== undefined)
			parts.push(this.format.text('passwordWithout', { provider }));
		if (!security.password) parts.push(this.format.text('passwordNotSet'));
		else if (changed !== undefined)
			parts.push(this.format.text('passwordChangedOn', { date: this.format.date(changed) }));
		rows.push({
			id: 'password',
			glyph: 'object.password',
			title: this.format.text('proctorPassword'),
			detail:
				parts.length === 0
					? this.format.text('statusSet')
					: parts.reduce((first, second) => this.format.join(first, second)),
			status: security.password
				? { text: this.format.text('statusSet'), tone: 'safeguard' }
				: { text: this.format.text('statusNotSet'), tone: 'neutral' }
		});
		return rows;
	}

	private twoStepDetail(security: AccountSecurity, status: TwoStepStatus): string {
		const mfa = security.mfa;
		if (status === 'off')
			return this.format.text(security.password ? 'twoStepOffPassword' : 'twoStepOffOnly');
		if (status !== 'on' || mfa?.method !== 'authenticatorApp')
			return this.format.text(twoStepMessages[status]);
		return mfa.enabledAt === undefined
			? this.format.text('twoStepApp')
			: this.format.text('twoStepAppSince', { date: this.format.date(mfa.enabledAt) });
	}

	private twoStepRows(security: AccountSecurity): PageRowModel[] {
		const presentation = twoStepPresentation(security.mfa);
		const off = presentation.status === 'off';
		// Off stays red: it is the one setting here that leaves the account exposed.
		const status: PageRowModel['status'] =
			presentation.status === 'on'
				? { text: this.format.text('statusOn'), tone: 'safeguard' }
				: off
					? { text: this.format.text('statusOff'), tone: 'failure' }
					: presentation.status === 'notOffered'
						? undefined
						: {
								text: this.format.text('statusNeedsAttention'),
								tone: 'attention'
							};
		const rows: PageRowModel[] = [
			{
				id: 'two-step',
				glyph: 'account.security',
				title: this.format.text('twoStep'),
				detail: this.twoStepDetail(security, presentation.status),
				...(status === undefined ? {} : { status }),
				...(off
					? {
							button: {
								label: this.format.text('turnOnTwoStep'),
								icon: 'action.openExternal' as const,
								run: () => void this.openSecurityPage()
							}
						}
					: {})
			}
		];
		const recovery = presentation.recovery;
		const mfa = security.mfa;
		if (off)
			rows.push({
				id: 'recovery-codes',
				glyph: 'object.key',
				title: this.format.text('recoveryCodes'),
				detail: this.format.text('recoveryCodesWithTwoStep')
			});
		else if (recovery !== undefined)
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
					tone: recovery.low ? 'attention' : 'neutral'
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
