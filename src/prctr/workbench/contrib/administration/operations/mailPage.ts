/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { BannerControl } from '../../../../base/browser/ui/banner/bannerControl.js';
import { ButtonControl } from '../../../../base/browser/ui/button/buttonControl.js';
import {
	Disposable,
	MutableDisposable,
	type IDisposable
} from '../../../../base/common/lifecycle.js';
import {
	mailDeliveryStates,
	type AdministrationFailure,
	type AdministrationResponse,
	type AdministrationValue
} from '../../../../platform/administration/common/administrationProtocol.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { proctorIconFactory } from '../../../../platform/theme/browser/proctorIcon.js';
import type { PageView } from '../../../browser/authenticated/pages/pagePane.js';
import { IPagePaneContext } from '../../../browser/authenticated/pages/pagePaneContext.js';
import type { PageRead } from '../../../browser/authenticated/pages/pageRead.js';
import {
	PageSection,
	type PageRowAction,
	type PageRowModel
} from '../../../browser/authenticated/pages/pageSection.js';
import { IAdministrationService } from '../../../services/administration/common/administration.js';
import { IAdministrationFormatService, type AdministrationText } from '../administrationFormat.js';
import { readableCode } from '../common/administrationPresentation.js';
import { AdminChanges, AdminConfirmation } from '../widgets/adminChanges.js';
import { AdminFilters } from '../widgets/adminFilters.js';
import { DeliveryDialog } from './deliveryDialog.js';
import { AdminList, type AdminListItem, type AdminTone } from '../widgets/adminList.js';
import { adminRead, readOnce } from '../widgets/adminReads.js';

type Delivery = AdminListItem<'mailDeliveries'>;
type State = (typeof mailDeliveryStates)[number];
type Metrics = AdministrationValue<'mailMetrics'>;

const STATE: Readonly<
	Record<State, { readonly text: AdministrationText; readonly tone: AdminTone }>
> = {
	queued: { text: 'mailQueued', tone: 'neutral' },
	sending: { text: 'mailSending', tone: 'neutral' },
	accepted: { text: 'mailAccepted', tone: 'neutral' },
	failed: { text: 'mailFailedState', tone: 'failure' },
	suppressed: { text: 'mailSuppressed', tone: 'attention' },
	canceled: { text: 'mailCanceledState', tone: 'neutral' }
};
const ANY = 'any';

/**
 * Whether the institution's mail is delivered: its health, the deliveries with retry and
 * cancel, a test message to oneself, and the keys protecting stored mail and two-step secrets.
 * Keys need a sign-in with two-step verification; without one the section says so.
 */
export class MailPage extends Disposable implements PageView {
	private readonly metrics: PageRead<Metrics, AdministrationFailure, AdministrationResponse>;
	private readonly banner: BannerControl;
	private readonly health: PageSection;
	private readonly list: AdminList<'mailDeliveries'>;
	private readonly keys: PageSection;
	private readonly changes: AdminChanges;
	private readonly dialog = this._register(new MutableDisposable<IDisposable>());
	private keysLoaded = false;

	constructor(
		body: HTMLElement,
		headerActions: HTMLElement,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@IAdministrationService private readonly administration: IAdministrationService,
		@IAdministrationFormatService private readonly format: IAdministrationFormatService,
		@IPagePaneContext private readonly pane: IPagePaneContext
	) {
		super();
		this.changes = this._register(instantiationService.createInstance(AdminChanges));
		const test = this._register(
			new ButtonControl(headerActions, {
				variant: 'secondary',
				label: format.text('mailSendTest'),
				icon: proctorIconFactory('admin.mail')
			})
		);
		this._register(test.onDidRequest(() => void this.sendTest(test)));
		this.banner = this._register(new BannerControl(body));
		this.health = this._register(
			instantiationService.createInstance(PageSection, body, {
				title: format.text('mailHealth')
			})
		);
		const filters = this._register(new AdminFilters(body));
		filters.addSelect<State | typeof ANY>(
			format.text('mailState'),
			'status.success',
			[
				{ value: ANY, label: format.text('mailAny') },
				...mailDeliveryStates.map((state) => ({
					value: state,
					label: format.text(STATE[state].text)
				}))
			],
			ANY,
			(state) => this.list.setQuery(state === ANY ? {} : { state: [state] })
		);
		this.list = this._register(
			instantiationService.createInstance(
				AdminList<'mailDeliveries'>,
				body,
				'mailDeliveries',
				{},
				{
					label: format.text('mailDeliveries'),
					columns: [
						{
							label: format.text('mailColumnTo'),
							min: 220,
							cell: (delivery) => ({
								kind: 'text',
								primary: delivery.recipient,
								secondary:
									delivery.failureCode === undefined
										? ''
										: format.code('problem', delivery.failureCode),
								...(delivery.failureCode === undefined
									? {}
									: { secondaryTone: 'fail' as const }),
								strong: true
							})
						},
						{
							label: format.text('mailColumnKind'),
							width: '20%',
							priority: 2,
							cell: (delivery) => ({
								kind: 'text',
								primary: format.code('mailKind', delivery.template),
								quiet: true
							})
						},
						{
							label: format.text('mailStatus'),
							width: '130px',
							cell: (delivery) => ({
								kind: 'status',
								text: format.text(STATE[delivery.state].text),
								tone: STATE[delivery.state].tone
							})
						},
						{
							label: format.text('mailUpdated'),
							width: '130px',
							align: 'end',
							cell: (delivery) => ({
								kind: 'text',
								primary: format.relativeStandalone(delivery.updatedAt),
								mono: true,
								quiet: true
							})
						}
					],
					open: (delivery) => this.openDelivery(delivery),
					rowId: (delivery) => delivery.id,
					rowName: (delivery) => delivery.recipient,
					actions: (delivery) => this.actions(delivery),
					icon: 'admin.mail',
					empty: {
						title: format.text('mailEmpty'),
						text: format.text('mailEmptyText'),
						action: {
							label: format.text('mailSendTest'),
							icon: 'admin.mail',
							run: () => void this.sendTest(test)
						}
					},
					filteredEmpty: format.text('mailNoMatch')
				}
			)
		);
		this.keys = this._register(
			instantiationService.createInstance(PageSection, body, {
				title: format.text('mailKeys'),
				description: format.text('mailKeysDescription')
			})
		);
		this.metrics = this._register(adminRead(administration, { kind: 'mailMetrics' }));
		this._register(this.metrics.onDidChange(() => this.renderHealth()));
		this.renderHealth();
	}

	setVisible(visible: boolean): void {
		this.metrics.setActive(visible);
		this.list.setActive(visible);
		if (visible && !this.keysLoaded) {
			this.keysLoaded = true;
			void this.loadKeys();
		}
	}

	private renderHealth(): void {
		const metrics = this.metrics.data;
		this.health.setState(this.metrics.state, false, () => void this.metrics.refresh());
		if (metrics === undefined) return;
		const health: Readonly<
			Record<
				Metrics['health'],
				{
					readonly text: AdministrationText;
					readonly tone: 'neutral' | 'warning' | 'failure';
				}
			>
		> = {
			'': { text: 'mailUnknown', tone: 'neutral' },
			'mail.healthy': { text: 'mailHealthy', tone: 'neutral' },
			'mail.disabled': { text: 'mailDisabled', tone: 'warning' },
			'mail.smtp_outage': { text: 'mailOutage', tone: 'failure' },
			'mail.queue_delayed': { text: 'mailDelayed', tone: 'warning' }
		};
		const current = health[metrics.health];
		this.banner.show({
			tone: current.tone,
			icon: proctorIconFactory(
				current.tone === 'neutral' ? 'status.success' : 'status.attention',
				18
			),
			text: this.format.text(current.text)
		});
		this.health.setRows(
			metrics.queues
				.filter((queue) => queue.count > 0)
				.map((queue): PageRowModel => ({
					id: queue.state,
					glyph: 'admin.mail',
					title: this.format.text('mailQueue', {
						state: this.format.text(STATE[queue.state].text),
						count: this.format.count(queue.count)
					}),
					detail: readableCode(queue.health || 'mail.healthy')
				}))
		);
		this.health.hidden = metrics.queues.every((queue) => queue.count === 0);
	}

	private openDelivery(delivery: Delivery): void {
		this.dialog.value = this.instantiationService.createInstance(
			DeliveryDialog,
			delivery.id,
			(state) => STATE[state].text,
			() => void this.list.refresh()
		);
	}

	private actions(delivery: Delivery): readonly PageRowAction[] {
		const open: PageRowAction = {
			label: this.format.text('mailOpen'),
			icon: 'action.openExternal',
			run: () => this.openDelivery(delivery)
		};
		return [open, ...this.changeActions(delivery)];
	}

	private changeActions(delivery: Delivery): readonly PageRowAction[] {
		if (delivery.state === 'failed' || delivery.state === 'canceled')
			return [
				{
					label: this.format.text('mailRetry'),
					icon: 'action.retry',
					run: () =>
						void this.change(
							{ kind: 'retryMailDelivery', id: delivery.id },
							delivery,
							'mailRetried'
						)
				}
			];
		if (delivery.state === 'queued')
			return [
				{
					label: this.format.text('mailCancel'),
					icon: 'action.end',
					destructive: true,
					run: () =>
						void this.change(
							{ kind: 'cancelMailDelivery', id: delivery.id },
							delivery,
							'mailCancelled'
						)
				}
			];
		return [];
	}

	private async change(
		intent: { readonly kind: 'retryMailDelivery' | 'cancelMailDelivery'; readonly id: string },
		delivery: Delivery,
		success: AdministrationText
	): Promise<void> {
		const result = await this.changes.send(intent, [delivery.recipient]);
		if (this._store.isDisposed) return;
		if (result !== 'busy' && result.kind !== 'error')
			this.pane.toast(this.format.text(success));
		else if (result === 'busy' || result.reason !== 'cancelled')
			this.pane.toast(this.changes.describe(result));
		void this.list.refresh();
		void this.metrics.refresh();
	}

	private async sendTest(button: ButtonControl): Promise<void> {
		const state = {
			label: this.format.text('mailSendTest'),
			icon: proctorIconFactory('admin.mail')
		};
		button.setState({ ...state, busy: true });
		const result = await this.changes.send({ kind: 'sendTestMail' }, [
			this.format.text('mailSendTest')
		]);
		if (this._store.isDisposed) return;
		button.setState(state);
		if (result !== 'busy' && result.kind !== 'error')
			this.pane.toast(this.format.text('mailTestSent'));
		else if (result === 'busy' || result.reason !== 'cancelled')
			this.pane.toast(this.changes.describe(result));
		void this.list.refresh();
	}

	private async loadKeys(): Promise<void> {
		this.keys.setState({ kind: 'loading' }, false);
		const [mail, mfa] = await Promise.all([
			readOnce(this.administration, { kind: 'mailKeys' }),
			readOnce(this.administration, { kind: 'mfaKeys' })
		]);
		if (this._store.isDisposed) return;
		if (mail.kind === 'failure' && mfa.kind === 'failure') {
			const strong =
				mail.reason === 'strongRequired' || mail.reason === 'reauthenticationRequired';
			this.keys.setState(
				{ kind: 'failed', reason: mail.reason },
				false,
				strong || mail.reason === 'noAccess' ? undefined : () => void this.loadKeys()
			);
			if (strong)
				this.keys.setHeading(
					this.format.text('mailKeys'),
					this.format.text('mailKeysStrong')
				);
			return;
		}
		const rows: PageRowModel[] = [];
		if (mail.kind === 'data')
			for (const key of mail.value.keys)
				rows.push(
					this.keyRow(
						key.keyId,
						key.references,
						key.keyId === mail.value.primaryKeyId,
						'mailKeyMail',
						'startMailRekey'
					)
				);
		if (mfa.kind === 'data')
			for (const key of mfa.value.keys)
				rows.push(
					this.keyRow(
						key.keyId,
						key.credentials,
						key.keyId === mfa.value.primaryKeyId,
						'mailKeyMfa',
						'startMfaRekey'
					)
				);
		this.keys.setState({ kind: 'ready' }, false);
		this.keys.setRows(rows);
	}

	private keyRow(
		keyId: string,
		uses: number,
		primary: boolean,
		title: AdministrationText,
		kind: 'startMailRekey' | 'startMfaRekey'
	): PageRowModel {
		const short = keyId.slice(0, 8);
		return {
			id: `${kind}:${keyId}`,
			glyph: 'object.key',
			title: this.format.text(title, { key: short }),
			detail: this.format.text('mailKeyUses', { count: this.format.count(uses) }),
			...(primary
				? {
						status: {
							text: this.format.text('mailKeyPrimary'),
							tone: 'neutral' as const
						}
					}
				: {}),
			actions: primary
				? []
				: [
						{
							label: this.format.text('mailKeyRetire'),
							icon: 'action.delete',
							destructive: true,
							run: () =>
								this.retire(kind, keyId, this.format.text(title, { key: short }))
						}
					]
		};
	}

	private retire(
		kind: 'startMailRekey' | 'startMfaRekey',
		retiringKeyId: string,
		name: string
	): void {
		this.dialog.value = this.instantiationService.createInstance(
			AdminConfirmation,
			{
				title: this.format.text('mailKeyRetireTitle'),
				message: this.format.text('mailKeyRetireBody'),
				confirmLabel: this.format.text('mailKeyRetireConfirm'),
				confirmIcon: 'action.delete',
				destructive: true,
				run: () => this.changes.send({ kind, retiringKeyId }, [name]),
				onDidComplete: (result) => {
					this.pane.toast(
						result.kind === 'error'
							? this.format.failure(result.reason)
							: this.format.text('mailKeyRetiring')
					);
					void this.loadKeys();
				}
			},
			() => this.pane.focusPage()
		);
	}
}
