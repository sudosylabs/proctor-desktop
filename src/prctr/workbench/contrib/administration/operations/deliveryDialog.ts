/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { createElementFactory } from '../../../../base/browser/documentElements.js';
import { ButtonControl } from '../../../../base/browser/ui/button/buttonControl.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import type {
	AdministrationChangeIntent,
	AdministrationValue
} from '../../../../platform/administration/common/administrationProtocol.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { proctorIconFactory } from '../../../../platform/theme/browser/proctorIcon.js';
import { PageDialog } from '../../../browser/authenticated/pages/pageDialog.js';
import { PageFeedback } from '../../../browser/authenticated/pages/pageFeedback.js';
import { IPagePaneContext } from '../../../browser/authenticated/pages/pagePaneContext.js';
import { IAdministrationService } from '../../../services/administration/common/administration.js';
import { IAdministrationFormatService, type AdministrationText } from '../administrationFormat.js';
import { AdminChanges } from '../widgets/adminChanges.js';
import { renderDetails } from '../widgets/adminDetails.js';
import { readOnce } from '../widgets/adminReads.js';

type Delivery = AdministrationValue<'mailDelivery'>;

/**
 * One email Proctor sent or tried to send: who it was for, what kind, each step's time and why
 * it failed, with Retry or Cancel. The recipient's address stays partly hidden.
 */
export class DeliveryDialog extends Disposable {
	private readonly dialog: PageDialog;
	private readonly details: HTMLElement;
	private readonly feedback: PageFeedback;
	private readonly close: ButtonControl;
	private readonly action: ButtonControl;
	private readonly changes: AdminChanges;
	private delivery: Delivery | undefined;
	private working = false;

	constructor(
		deliveryId: string,
		private readonly stateText: (state: Delivery['state']) => AdministrationText,
		/** Called once the delivery changed, so the owner reads its list again. */
		private readonly onDidChange: () => void,
		@IAdministrationService private readonly administration: IAdministrationService,
		@IAdministrationFormatService private readonly format: IAdministrationFormatService,
		@IPagePaneContext private readonly pane: IPagePaneContext,
		@IInstantiationService instantiationService: IInstantiationService
	) {
		super();
		this.changes = this._register(instantiationService.createInstance(AdminChanges));
		this.dialog = this._register(
			new PageDialog(pane, {
				title: format.text('deliveryLoading'),
				size: 'medium'
			})
		);
		this.dialog.setFootnote(format.text('deliveryHidden'));
		const $ = createElementFactory(this.dialog.element.ownerDocument);
		this.details = $('div');
		this.dialog.body.append(this.details);
		this.feedback = this._register(new PageFeedback(this.dialog.body));
		this.close = this._register(
			new ButtonControl(this.dialog.actions, {
				variant: 'secondary',
				label: format.text('deliveryClose'),
				icon: proctorIconFactory('action.close')
			})
		);
		this.action = this._register(
			new ButtonControl(this.dialog.actions, {
				variant: 'brand',
				label: format.text('deliveryRetry'),
				icon: proctorIconFactory('action.retry')
			})
		);
		this.action.element.hidden = true;
		this._register(this.close.onDidRequest(() => this.dismiss()));
		this._register(this.dialog.onDidRequestCancel(() => this.dismiss()));
		this._register(this.action.onDidRequest(() => void this.run()));
		this.dialog.show(this.close.element);
		void this.load(deliveryId);
	}

	private async load(id: string): Promise<void> {
		const result = await readOnce(this.administration, { kind: 'mailDelivery', id });
		if (this._store.isDisposed) return;
		if (result.kind === 'failure') {
			this.feedback.set(this.format.failure(result.reason), 'error');
			return;
		}
		const delivery = result.value;
		this.delivery = delivery;
		const kind = this.format.code('mailKind', delivery.template);
		this.dialog.setHeading(
			this.format.text('deliveryTitle', { kind, recipient: delivery.recipient }),
			delivery.failureCode === undefined
				? this.format.text('deliveryNoProblem')
				: this.format.code('problem', delivery.failureCode)
		);
		const user =
			delivery.targetUserId === undefined
				? undefined
				: await readOnce(this.administration, { kind: 'user', id: delivery.targetUserId });
		if (this._store.isDisposed) return;
		const state = this.format.text(this.stateText(delivery.state));
		renderDetails(this.details, [
			...(user?.kind === 'data'
				? [{ label: this.format.text('deliveryFor'), value: user.value.displayName }]
				: []),
			{ label: this.format.text('deliveryKind'), value: kind },
			{
				label: this.format.text('deliveryStatus'),
				value:
					delivery.attempts === 1
						? this.format.text('deliveryStatusAttemptOne', { state })
						: this.format.text('deliveryStatusAttempts', {
								state,
								count: this.format.count(delivery.attempts)
							})
			},
			{
				label: this.format.text('deliveryQueued'),
				value: this.format.relativeStandalone(delivery.createdAt)
			},
			{
				label: this.format.text('deliveryLastAttempt'),
				value: this.format.relativeStandalone(delivery.updatedAt)
			},
			...(delivery.acceptedAt === undefined
				? [
						{
							label: this.format.text('deliveryDeadline'),
							value: this.format.relativeStandalone(delivery.deadline)
						}
					]
				: [
						{
							label: this.format.text('deliveryDelivered'),
							value: this.format.relativeStandalone(delivery.acceptedAt)
						}
					]),
			{ label: this.format.text('deliveryMessageId'), value: delivery.messageId }
		]);
		this.renderAction();
	}

	private intent(): AdministrationChangeIntent | undefined {
		const delivery = this.delivery;
		if (delivery === undefined) return undefined;
		if (delivery.state === 'failed' || delivery.state === 'canceled')
			return { kind: 'retryMailDelivery', id: delivery.id };
		if (delivery.state === 'queued') return { kind: 'cancelMailDelivery', id: delivery.id };
		return undefined;
	}

	private renderAction(): void {
		const intent = this.intent();
		const retry = intent?.kind === 'retryMailDelivery';
		this.action.element.hidden = intent === undefined;
		this.action.setState({
			label: this.format.text(retry ? 'deliveryRetry' : 'deliveryCancel'),
			icon: proctorIconFactory(retry ? 'action.retry' : 'action.end'),
			busy: this.working
		});
	}

	private async run(): Promise<void> {
		const intent = this.intent();
		if (intent === undefined || this.working) return;
		this.working = true;
		this.feedback.set();
		this.renderAction();
		const result = await this.changes.send(intent, [this.action.element.textContent ?? '']);
		if (this._store.isDisposed) return;
		this.working = false;
		this.renderAction();
		if (result !== 'busy' && result.kind !== 'error') {
			this.pane.toast(
				this.format.text(
					intent.kind === 'retryMailDelivery' ? 'mailRetried' : 'mailCancelled'
				)
			);
			this.onDidChange();
			this.dispose();
			return;
		}
		if (result !== 'busy' && result.reason === 'cancelled') return;
		this.feedback.set(this.changes.describe(result), 'error');
	}

	private dismiss(): void {
		if (this.working) return;
		this.dispose();
	}
}
