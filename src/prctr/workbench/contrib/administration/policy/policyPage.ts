/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { createElementFactory } from '../../../../base/browser/documentElements.js';
import { BannerControl } from '../../../../base/browser/ui/banner/bannerControl.js';
import { ButtonControl } from '../../../../base/browser/ui/button/buttonControl.js';
import { SelectControl } from '../../../../base/browser/ui/select/selectControl.js';
import { SwitchControl } from '../../../../base/browser/ui/switch/switchControl.js';
import {
	Disposable,
	DisposableStore,
	MutableDisposable,
	type IDisposable
} from '../../../../base/common/lifecycle.js';
import {
	providerAdmissionModes,
	type AdministrationFailure,
	type AdministrationIntentOf,
	type AdministrationResponse,
	type AdministrationValue
} from '../../../../platform/administration/common/administrationProtocol.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { proctorIconFactory } from '../../../../platform/theme/browser/proctorIcon.js';
import type { PageView } from '../../../browser/authenticated/pages/pagePane.js';
import { IPagePaneContext } from '../../../browser/authenticated/pages/pagePaneContext.js';
import type { PageRead } from '../../../browser/authenticated/pages/pageRead.js';
import { PageSection } from '../../../browser/authenticated/pages/pageSection.js';
import { IAdministrationService } from '../../../services/administration/common/administration.js';
import { IAdministrationFormatService, type AdministrationText } from '../administrationFormat.js';
import { readableCode } from '../common/administrationPresentation.js';
import { AdminChanges, AdminConfirmation } from '../widgets/adminChanges.js';
import { renderDetails } from '../widgets/adminDetails.js';
import { AdminFormDialog } from '../widgets/adminFormDialog.js';
import { adminRead } from '../widgets/adminReads.js';
import './media/policyPage.css';

type Policy = AdministrationValue<'accessPolicy'>;
type Desktop = AdministrationValue<'desktopCompatibility'>;
type Mode = (typeof providerAdmissionModes)[number];
type Flag =
	| 'localLogin'
	| 'publicRegistration'
	| 'invitationAdmission'
	| 'invitationLocalCredential'
	| 'desktopAuthorization';

interface Draft {
	localLogin: boolean;
	publicRegistration: boolean;
	invitationAdmission: boolean;
	invitationLocalCredential: boolean;
	desktopAuthorization: boolean;
	admissions: Map<string, Mode>;
	roleHolderMfaRequired: boolean;
	/** Undefined keeps the deployment's default. */
	sessionIdleMinutes: number | undefined;
	sessionAbsoluteMinutes: number | undefined;
	revokeExistingSessions: boolean;
}

const DEFAULT = 'default';
const IDLE_MINUTES = [15, 30, 60, 120, 240, 480, 720] as const;
const ABSOLUTE_MINUTES = [240, 480, 720, 1440, 4320, 10080, 43200] as const;

const FLAGS: readonly {
	readonly flag: Flag;
	readonly title: AdministrationText;
	readonly description: AdministrationText;
}[] = [
	{ flag: 'localLogin', title: 'policyLocalLogin', description: 'policyLocalLoginDescription' },
	{
		flag: 'publicRegistration',
		title: 'policyRegistration',
		description: 'policyRegistrationDescription'
	},
	{
		flag: 'invitationAdmission',
		title: 'policyInvitations',
		description: 'policyInvitationsDescription'
	},
	{
		flag: 'invitationLocalCredential',
		title: 'policyInvitationPassword',
		description: 'policyInvitationPasswordDescription'
	},
	{
		flag: 'desktopAuthorization',
		title: 'policyDesktop',
		description: 'policyDesktopDescription'
	}
];

const MODE_TEXT: Readonly<Record<Mode, AdministrationText>> = {
	linked_only: 'policyLinkedOnly',
	invitation_required: 'policyInvitationRequired',
	auto_provision: 'policyAutoProvision'
};

/**
 * Who can sign in and how. Changes are a draft until applied; applying first asks the server
 * what the change would break and shows that instead of sending a change it would refuse.
 */
export class PolicyPage extends Disposable implements PageView {
	private readonly policy: PageRead<Policy, AdministrationFailure, AdministrationResponse>;
	private readonly desktop: PageRead<Desktop, AdministrationFailure, AdministrationResponse>;
	private readonly banner: BannerControl;
	private readonly signIn: PageSection;
	private readonly providers: PageSection;
	private readonly after: PageSection;
	private readonly history: PageSection;
	private readonly desktopSection: PageSection;
	private readonly apply: ButtonControl;
	private readonly discard: ButtonControl;
	private readonly changes: AdminChanges;
	private readonly controls = this._register(new DisposableStore());
	private readonly dialog = this._register(new MutableDisposable<IDisposable>());
	private draft: Draft | undefined;
	private working = false;

	constructor(
		body: HTMLElement,
		headerActions: HTMLElement,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@IAdministrationService administration: IAdministrationService,
		@IAdministrationFormatService private readonly format: IAdministrationFormatService,
		@IPagePaneContext private readonly pane: IPagePaneContext
	) {
		super();
		this.changes = this._register(instantiationService.createInstance(AdminChanges));
		this.discard = this._register(
			new ButtonControl(headerActions, {
				variant: 'secondary',
				label: format.text('policyDiscard'),
				icon: proctorIconFactory('action.close'),
				disabled: true
			})
		);
		this.apply = this._register(
			new ButtonControl(headerActions, {
				variant: 'brand',
				label: format.text('policyApply'),
				icon: proctorIconFactory('action.confirm'),
				disabled: true
			})
		);
		this._register(this.discard.onDidRequest(() => this.reset()));
		this._register(this.apply.onDidRequest(() => void this.applyDraft()));
		this.banner = this._register(new BannerControl(body));
		const section = (
			title: AdministrationText,
			action?: { label: string; icon: 'action.edit' }
		) =>
			this._register(
				instantiationService.createInstance(PageSection, body, {
					title: format.text(title),
					...(action === undefined ? {} : { action })
				})
			);
		this.signIn = section('policySignIn');
		this.providers = section('policyProviders');
		this.after = section('policyAfterApply');
		this.history = section('policyHistory');
		this.desktopSection = section('policyDesktopSection', {
			label: format.text('policyDesktopEdit'),
			icon: 'action.edit'
		});
		this._register(this.desktopSection.onDidRequestAction(() => this.editDesktop()));
		this.policy = this._register(adminRead(administration, { kind: 'accessPolicy' }));
		this.desktop = this._register(adminRead(administration, { kind: 'desktopCompatibility' }));
		this._register(this.policy.onDidChange(() => this.renderPolicy()));
		this._register(this.desktop.onDidChange(() => this.renderDesktop()));
		this.renderPolicy();
		this.renderDesktop();
	}

	setVisible(visible: boolean): void {
		this.policy.setActive(visible);
		this.desktop.setActive(visible);
	}

	private fresh(policy: Policy): Draft {
		return {
			localLogin: policy.localLogin,
			publicRegistration: policy.publicRegistration,
			invitationAdmission: policy.invitationAdmission,
			invitationLocalCredential: policy.invitationLocalCredential,
			desktopAuthorization: policy.desktopAuthorization,
			admissions: new Map(
				policy.providerAdmissions.map((admission) => [admission.providerId, admission.mode])
			),
			roleHolderMfaRequired: policy.roleHolderMfaRequired,
			sessionIdleMinutes: policy.sessionIdleMinutes,
			sessionAbsoluteMinutes: policy.sessionAbsoluteMinutes,
			revokeExistingSessions: false
		};
	}

	private changed(): boolean {
		const policy = this.policy.data;
		const draft = this.draft;
		if (policy === undefined || draft === undefined) return false;
		if (FLAGS.some(({ flag }) => draft[flag] !== policy[flag])) return true;
		if (
			draft.roleHolderMfaRequired !== policy.roleHolderMfaRequired ||
			draft.sessionIdleMinutes !== policy.sessionIdleMinutes ||
			draft.sessionAbsoluteMinutes !== policy.sessionAbsoluteMinutes
		)
			return true;
		const current = new Map(
			policy.providerAdmissions.map((admission) => [admission.providerId, admission.mode])
		);
		return [...draft.admissions].some(([id, mode]) => current.get(id) !== mode);
	}

	private reset(): void {
		this.draft = undefined;
		this.banner.hide();
		this.renderPolicy();
	}

	private renderPolicy(): void {
		const policy = this.policy.data;
		const state = this.policy.state;
		for (const section of [this.signIn, this.providers, this.after, this.history])
			section.setState(state, false, () => void this.policy.refresh());
		this.controls.clear();
		if (policy === undefined) {
			this.updateButtons();
			return;
		}
		// A refreshed policy replaces an unchanged draft, never one the person is editing.
		if (this.draft === undefined || !this.changed()) this.draft = this.fresh(policy);
		const draft = this.draft;
		const $ = createElementFactory(this.signIn.content.ownerDocument);
		const row = (
			title: string,
			description: string,
			control: (host: HTMLElement) => void
		): HTMLElement => {
			const host = $('div.prctr-admin-policy__control');
			const element = $(
				'div.prctr-admin-policy__row',
				{},
				$(
					'div.prctr-admin-policy__text',
					{},
					$('span.prctr-admin-policy__title', { textContent: title }),
					$('span.prctr-admin-policy__description', { textContent: description })
				),
				host
			);
			control(host);
			return element;
		};
		this.signIn.content.replaceChildren(
			$(
				'div.prctr-admin-policy',
				{},
				...FLAGS.map(({ flag, title, description }) =>
					row(this.format.text(title), this.format.text(description), (host) => {
						const toggle = this.controls.add(
							new SwitchControl(host, {
								label: this.format.text(title),
								on: draft[flag],
								disabled: this.working
							})
						);
						this.controls.add(
							toggle.onDidChange((on) => {
								draft[flag] = on;
								this.updateButtons();
							})
						);
					})
				),
				row(
					this.format.text('policyStaffMfa'),
					policy.roleHolderMfaRequired && !policy.roleHolderMfaEnforced
						? this.format.text('policyStaffMfaWaiting')
						: this.format.text('policyStaffMfaDescription'),
					(host) => {
						const toggle = this.controls.add(
							new SwitchControl(host, {
								label: this.format.text('policyStaffMfa'),
								on: draft.roleHolderMfaRequired,
								disabled: this.working
							})
						);
						this.controls.add(
							toggle.onDidChange((on) => {
								draft.roleHolderMfaRequired = on;
								this.updateButtons();
							})
						);
					}
				),
				this.lengthRow(
					row,
					'policySessionIdle',
					'policySessionIdleDescription',
					IDLE_MINUTES,
					policy.sessionIdleDefault,
					policy.sessionIdleMaximum,
					() => draft.sessionIdleMinutes,
					(minutes) => (draft.sessionIdleMinutes = minutes)
				),
				this.lengthRow(
					row,
					'policySessionAbsolute',
					'policySessionAbsoluteDescription',
					ABSOLUTE_MINUTES,
					policy.sessionAbsoluteDefault,
					policy.sessionAbsoluteMaximum,
					() => draft.sessionAbsoluteMinutes,
					(minutes) => (draft.sessionAbsoluteMinutes = minutes)
				)
			)
		);
		this.providers.setState(
			state,
			policy.providers.length === 0 ? this.format.text('policyProvidersEmpty') : false
		);
		this.providers.content.replaceChildren(
			$(
				'div.prctr-admin-policy',
				{},
				...policy.providers.map((provider) =>
					row(provider.displayName, readableCode(provider.type), (host) => {
						const select = this.controls.add(
							new SelectControl<Mode>(host, {
								label: provider.displayName,
								value: draft.admissions.get(provider.id) ?? 'linked_only',
								caret: proctorIconFactory('action.expand', 14),
								choices: providerAdmissionModes.map((mode) => ({
									value: mode,
									label: this.format.text(MODE_TEXT[mode])
								})),
								disabled: this.working
							})
						);
						this.controls.add(
							select.onDidChange((mode) => {
								draft.admissions.set(provider.id, mode);
								this.updateButtons();
							})
						);
					})
				)
			)
		);
		this.after.content.replaceChildren(
			$(
				'div.prctr-admin-policy',
				{},
				row(this.format.text('policyRevoke'), '', (host) => {
					const toggle = this.controls.add(
						new SwitchControl(host, {
							label: this.format.text('policyRevoke'),
							on: draft.revokeExistingSessions,
							disabled: this.working
						})
					);
					this.controls.add(
						toggle.onDidChange((on) => (draft.revokeExistingSessions = on))
					);
				})
			)
		);
		this.history.setState(
			state,
			policy.history.length === 0 ? this.format.text('policyHistoryEmpty') : false
		);
		this.history.setRows(
			[...policy.history]
				.reverse()
				.slice(0, 10)
				.map((change) => ({
					id: String(change.toRevision),
					glyph: 'admin.audits',
					title: this.format.text('policyHistoryRow', { revision: change.toRevision }),
					detail: this.format.text('policyHistoryDetail', {
						fields: change.changedFields.map(readableCode).join(', '),
						when: this.format.relative(change.changedAt)
					})
				}))
		);
		this.updateButtons();
	}

	/** A session length chosen from presets up to the server's maximum, or its default. */
	private lengthRow(
		row: (
			title: string,
			description: string,
			control: (host: HTMLElement) => void
		) => HTMLElement,
		title: AdministrationText,
		description: AdministrationText,
		presets: readonly number[],
		fallback: number,
		maximum: number,
		value: () => number | undefined,
		set: (minutes: number | undefined) => void
	): HTMLElement {
		const current = value();
		const lengths = [
			...new Set([
				...presets.filter((minutes) => minutes <= maximum),
				...(current ? [current] : [])
			])
		].sort((a, b) => a - b);
		return row(this.format.text(title), this.format.text(description), (host) => {
			const select = this.controls.add(
				new SelectControl<string>(host, {
					label: this.format.text(title),
					value: current === undefined ? DEFAULT : String(current),
					caret: proctorIconFactory('action.expand', 14),
					choices: [
						{
							value: DEFAULT,
							label: this.format.text('policySessionDefault', {
								length: this.length(fallback)
							})
						},
						...lengths.map((minutes) => ({
							value: String(minutes),
							label: this.length(minutes)
						}))
					],
					disabled: this.working
				})
			);
			this.controls.add(
				select.onDidChange((choice) => {
					set(choice === DEFAULT ? undefined : Number(choice));
					this.updateButtons();
				})
			);
		});
	}

	/** "30 minutes", "12 hours", "7 days". */
	private length(minutes: number): string {
		if (minutes % 1440 === 0)
			return minutes === 1440
				? this.format.text('policyDayOne')
				: this.format.text('policyDays', { count: this.format.count(minutes / 1440) });
		if (minutes % 60 === 0)
			return minutes === 60
				? this.format.text('policyHourOne')
				: this.format.text('policyHours', { count: this.format.count(minutes / 60) });
		return this.format.text('policyMinutes', { count: this.format.count(minutes) });
	}

	private updateButtons(): void {
		const changed = this.changed();
		if (changed && !this.working)
			this.banner.show({
				tone: 'info',
				icon: proctorIconFactory('status.info', 18),
				text: this.format.text('policyPreviewing')
			});
		else if (!changed) this.banner.hide();
		this.apply.setState({
			label: this.format.text('policyApply'),
			icon: proctorIconFactory('action.confirm'),
			disabled: !changed,
			busy: this.working
		});
		this.discard.setState({
			label: this.format.text('policyDiscard'),
			icon: proctorIconFactory('action.close'),
			disabled: !changed || this.working
		});
	}

	private intent(): Omit<AdministrationIntentOf<'replaceAccessPolicy'>, 'kind'> | undefined {
		const policy = this.policy.data;
		const draft = this.draft;
		if (policy === undefined || draft === undefined) return undefined;
		return {
			expectedRevision: policy.revision,
			localLogin: draft.localLogin,
			publicRegistration: draft.publicRegistration,
			invitationAdmission: draft.invitationAdmission,
			invitationLocalCredential: draft.invitationLocalCredential,
			desktopAuthorization: draft.desktopAuthorization,
			providerAdmissions: [...draft.admissions].map(([providerId, mode]) => ({
				providerId,
				mode
			})),
			roleHolderMfaRequired: draft.roleHolderMfaRequired,
			...(draft.sessionIdleMinutes === undefined
				? {}
				: { sessionIdleMinutes: draft.sessionIdleMinutes }),
			...(draft.sessionAbsoluteMinutes === undefined
				? {}
				: { sessionAbsoluteMinutes: draft.sessionAbsoluteMinutes }),
			revokeExistingSessions: draft.revokeExistingSessions
		};
	}

	private async applyDraft(): Promise<void> {
		const settings = this.intent();
		if (settings === undefined || this.working) return;
		this.working = true;
		this.updateButtons();
		this.banner.show({
			tone: 'info',
			icon: proctorIconFactory('status.busy', 18),
			text: this.format.text('policyChecking')
		});
		const summary = [this.format.text('policyApply')];
		const check = await this.changes.send(
			{ kind: 'preflightAccessPolicy', ...settings },
			summary
		);
		if (this._store.isDisposed) return;
		if (
			check !== 'busy' &&
			check.kind === 'data' &&
			check.data.resource === 'accessPolicyPreflight' &&
			check.data.value.blockers.length > 0
		) {
			this.finish();
			this.banner.show({
				tone: 'failure',
				icon: proctorIconFactory('status.attention', 18),
				text: this.format.text('policyBlocked', {
					reasons: check.data.value.blockers
						.map((blocker) => this.blocker(blocker.code, blocker.providerId))
						.join('; ')
				})
			});
			return;
		}
		if (check === 'busy' || check.kind === 'error') {
			this.finish();
			if (check === 'busy' || check.reason !== 'cancelled')
				this.banner.show({
					tone: 'failure',
					icon: proctorIconFactory('status.attention', 18),
					text: this.changes.describe(check)
				});
			return;
		}
		const effects = this.effects(
			check.kind === 'data' && check.data.resource === 'accessPolicyPreflight'
				? check.data.value
				: undefined
		);
		if (effects.length > 0) {
			this.finish();
			this.dialog.value = this.instantiationService.createInstance(
				AdminConfirmation,
				{
					title: this.format.text('policyEffectTitle'),
					message: effects.join(' '),
					confirmLabel: this.format.text('policyEffectConfirm'),
					confirmIcon: 'action.confirm',
					destructive: false,
					run: () =>
						this.changes.send({ kind: 'replaceAccessPolicy', ...settings }, summary),
					onDidComplete: (result) => this.applied(result)
				},
				() => this.apply.focus()
			);
			return;
		}
		const result = await this.changes.send(
			{ kind: 'replaceAccessPolicy', ...settings },
			summary
		);
		if (this._store.isDisposed) return;
		this.finish();
		this.applied(result);
	}

	/** What the change does to people, in sentences, from the server's preflight. */
	private effects(preflight: AdministrationValue<'accessPolicyPreflight'> | undefined): string[] {
		const policy = this.policy.data;
		const draft = this.draft;
		if (preflight === undefined || policy === undefined || draft === undefined) return [];
		const effects: string[] = [];
		if (draft.roleHolderMfaRequired && !policy.roleHolderMfaRequired) {
			if (preflight.roleHoldersWithoutMfa > 0)
				effects.push(
					this.format.text('policyEffectStaff', {
						count: this.format.count(preflight.roleHoldersWithoutMfa)
					})
				);
			if (preflight.singleFactorSessions > 0)
				effects.push(
					this.format.text('policyEffectSessions', {
						count: this.format.count(preflight.singleFactorSessions)
					})
				);
		}
		const shorter = (next: number | undefined, now: number | undefined, fallback: number) =>
			(next ?? fallback) < (now ?? fallback);
		if (
			shorter(
				draft.sessionIdleMinutes,
				policy.sessionIdleMinutes,
				policy.sessionIdleDefault
			) ||
			shorter(
				draft.sessionAbsoluteMinutes,
				policy.sessionAbsoluteMinutes,
				policy.sessionAbsoluteDefault
			)
		)
			effects.push(this.format.text('policyEffectShorter'));
		return effects;
	}

	private applied(result: AdministrationResponse | 'busy'): void {
		if (result !== 'busy' && result.kind !== 'error') {
			this.draft = undefined;
			this.pane.toast(this.format.text('policyApplied'));
			void this.policy.refresh();
			return;
		}
		if (result === 'busy' || result.reason !== 'cancelled')
			this.banner.show({
				tone: 'failure',
				icon: proctorIconFactory('status.attention', 18),
				text: this.changes.describe(result)
			});
		if (result !== 'busy' && result.reason === 'conflict') void this.policy.refresh();
	}

	private finish(): void {
		this.working = false;
		this.renderPolicy();
	}

	private blocker(code: string, providerId: string | undefined): string {
		const provider =
			this.policy.data?.providers.find((candidate) => candidate.id === providerId)
				?.displayName ??
			providerId ??
			'';
		if (code === 'provider_unavailable')
			return this.format.text('policyBlockerProvider', { provider });
		if (code === 'provider_admission_unsupported')
			return this.format.text('policyBlockerAdmission', { provider });
		if (code === 'invitation_delivery_unavailable')
			return this.format.text('policyBlockerMail');
		if (code === 'mfa_unavailable') return this.format.text('policyBlockerMfa');
		if (code === 'last_system_administrator_path')
			return this.format.text('policyBlockerAdmin');
		return this.format.text('policyBlockerOther', { code: readableCode(code) });
	}

	private renderDesktop(): void {
		const desktop = this.desktop.data;
		this.desktopSection.setState(this.desktop.state, false, () => void this.desktop.refresh());
		this.desktopSection.setAction(desktop !== undefined);
		if (desktop === undefined) return;
		const none = this.format.text('policyNone');
		renderDetails(this.desktopSection.content, [
			{
				label: this.format.text('policyAvailability'),
				value: this.format.text(
					desktop.availability === 'ready' ? 'policyAvailable' : 'policyMaintenance'
				)
			},
			{
				label: this.format.text('policyMinimum'),
				value: desktop.minimumRelease || none,
				empty: desktop.minimumRelease === ''
			},
			{
				label: this.format.text('policyRevoked'),
				value:
					desktop.revokedBuildIds.length === 0
						? none
						: desktop.revokedBuildIds.join(', '),
				empty: desktop.revokedBuildIds.length === 0
			},
			{
				label: this.format.text('policyMessage'),
				value: desktop.message || none,
				empty: desktop.message === ''
			}
		]);
	}

	private editDesktop(): void {
		const desktop = this.desktop.data;
		if (desktop === undefined) return;
		this.dialog.value = this.instantiationService.createInstance(AdminFormDialog, {
			title: this.format.text('policyDesktopEditTitle'),
			confirmLabel: this.format.text('structureSave'),
			confirmIcon: 'action.confirm',
			fields: [
				{
					kind: 'select',
					id: 'availability',
					label: this.format.text('policyAvailability'),
					value: desktop.availability,
					choices: [
						{ value: 'ready', label: this.format.text('policyAvailable') },
						{ value: 'maintenance', label: this.format.text('policyMaintenance') }
					]
				},
				{
					kind: 'text',
					id: 'minimumRelease',
					label: this.format.text('policyMinimum'),
					value: desktop.minimumRelease,
					required: true
				},
				{
					kind: 'longText',
					id: 'message',
					label: this.format.text('policyMessage'),
					value: desktop.message
				},
				{
					kind: 'longText',
					id: 'revoked',
					label: this.format.text('policyRevoked'),
					value: desktop.revokedBuildIds.join('\n'),
					hint: this.format.text('policyRevokedHint')
				}
			],
			submit: (values) => ({
				kind: 'replaceDesktopCompatibility',
				expectedRevision: desktop.revision,
				availability: values.availability === 'maintenance' ? 'maintenance' : 'ready',
				minimumRelease: values.minimumRelease as string,
				message: (values.message as string | undefined) ?? '',
				revokedBuildIds: String(values.revoked ?? '')
					.split(/\s+/u)
					.filter((build) => build !== '')
			}),
			summary: () => [this.format.text('policyDesktopEditTitle')],
			onDidComplete: (result) => {
				this.pane.toast(
					result.kind === 'error'
						? this.format.failure(result.reason)
						: this.format.text('policyDesktopSaved')
				);
				void this.desktop.refresh();
			}
		});
	}
}
