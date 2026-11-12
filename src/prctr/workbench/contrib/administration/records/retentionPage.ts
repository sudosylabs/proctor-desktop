/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { createElementFactory } from '../../../../base/browser/documentElements.js';
import { ButtonControl } from '../../../../base/browser/ui/button/buttonControl.js';
import {
	Disposable,
	MutableDisposable,
	type IDisposable
} from '../../../../base/common/lifecycle.js';
import type {
	AdministrationFailure,
	AdministrationResponse,
	AdministrationValue
} from '../../../../platform/administration/common/administrationProtocol.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { proctorIconFactory } from '../../../../platform/theme/browser/proctorIcon.js';
import type { PageView } from '../../../browser/authenticated/pages/pagePane.js';
import { IPagePaneContext } from '../../../browser/authenticated/pages/pagePaneContext.js';
import type { PageRead } from '../../../browser/authenticated/pages/pageRead.js';
import {
	PageSection,
	type PageRowModel
} from '../../../browser/authenticated/pages/pageSection.js';
import { IAdministrationService } from '../../../services/administration/common/administration.js';
import { IAdministrationFormatService, type AdministrationText } from '../administrationFormat.js';
import { readableCode } from '../common/administrationPresentation.js';
import { AdminChanges, AdminConfirmation } from '../widgets/adminChanges.js';
import { renderDetails } from '../widgets/adminDetails.js';
import { AdminFormDialog, type AdminFormValues } from '../widgets/adminFormDialog.js';
import { AdminList } from '../widgets/adminList.js';
import { adminRead, readOnce } from '../widgets/adminReads.js';
import './media/retentionPage.css';

type Policy = AdministrationValue<'retentionPolicy'>;
type Control = AdministrationValue<'retentionControl'>;
type Preview = AdministrationValue<'retentionPreview'>;
type DaysField =
	| 'submissionDays'
	| 'integrityDays'
	| 'browserActivityDays'
	| 'securityOperationalDays'
	| 'auditDays'
	| 'exportDays'
	| 'deletionGraceDays';

const PERIODS: readonly { readonly field: DaysField; readonly label: AdministrationText }[] = [
	{ field: 'submissionDays', label: 'retentionSubmissions' },
	{ field: 'integrityDays', label: 'retentionIntegrity' },
	{ field: 'browserActivityDays', label: 'retentionBrowser' },
	{ field: 'securityOperationalDays', label: 'retentionSecurity' },
	{ field: 'auditDays', label: 'retentionAudit' },
	{ field: 'exportDays', label: 'retentionExports' },
	{ field: 'deletionGraceDays', label: 'retentionGrace' }
];

const PREVIEW_CATEGORIES: readonly {
	readonly key:
		'work' | 'integrity' | 'browserActivity' | 'securityOperational' | 'audit' | 'receipts';
	readonly label: AdministrationText;
}[] = [
	{ key: 'work', label: 'retentionWork' },
	{ key: 'integrity', label: 'retentionIntegrity' },
	{ key: 'browserActivity', label: 'retentionBrowser' },
	{ key: 'securityOperational', label: 'retentionSecurity' },
	{ key: 'audit', label: 'retentionAudit' },
	{ key: 'receipts', label: 'retentionReceipts' }
];

const STATE_TEXT: Readonly<Record<Control['state'], AdministrationText>> = {
	disabled: 'retentionStateDisabled',
	enabled: 'retentionStateEnabled',
	paused: 'retentionStatePaused'
};

/**
 * How long exam records are kept and whether eligible ones are deleted. Turning cleanup on
 * always goes through a fresh preview of what it would delete, which the server requires.
 */
export class RetentionPage extends Disposable implements PageView {
	private readonly policy: PageRead<Policy, AdministrationFailure, AdministrationResponse>;
	private readonly control: PageRead<Control, AdministrationFailure, AdministrationResponse>;
	private readonly policySection: PageSection;
	private readonly cleanupSection: PageSection;
	private readonly previewSection: PageSection;
	private readonly records: AdminList<'retentionRecords'>;
	private readonly previewButton: ButtonControl;
	private readonly enableButton: ButtonControl;
	private readonly pauseButton: ButtonControl;
	private readonly changes: AdminChanges;
	private readonly dialog = this._register(new MutableDisposable<IDisposable>());
	private preview: Preview | undefined;

	constructor(
		body: HTMLElement,
		_headerActions: HTMLElement,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@IAdministrationService private readonly administration: IAdministrationService,
		@IAdministrationFormatService private readonly format: IAdministrationFormatService,
		@IPagePaneContext private readonly pane: IPagePaneContext
	) {
		super();
		this.changes = this._register(instantiationService.createInstance(AdminChanges));
		this.policySection = this._register(
			instantiationService.createInstance(PageSection, body, {
				title: format.text('retentionPolicy'),
				action: { label: format.text('retentionEdit'), icon: 'action.edit' }
			})
		);
		this._register(this.policySection.onDidRequestAction(() => this.edit()));
		this.cleanupSection = this._register(
			instantiationService.createInstance(PageSection, body, {
				title: format.text('retentionCleanup')
			})
		);
		const buttons = createElementFactory(body.ownerDocument)(
			'div.prctr-admin-retention-actions'
		);
		this.cleanupSection.footer.append(buttons);
		this.previewButton = this._register(
			new ButtonControl(buttons, {
				variant: 'secondary',
				size: 'small',
				label: format.text('retentionPreview'),
				icon: proctorIconFactory('action.search', 14)
			})
		);
		this.pauseButton = this._register(
			new ButtonControl(buttons, {
				variant: 'secondary',
				size: 'small',
				label: format.text('retentionPause'),
				icon: proctorIconFactory('action.disable', 14)
			})
		);
		this._register(this.previewButton.onDidRequest(() => void this.createPreview()));
		this._register(this.pauseButton.onDidRequest(() => void this.setCleanup('paused')));
		this.previewSection = this._register(
			instantiationService.createInstance(PageSection, body, {
				title: format.text('retentionPreviewTitle')
			})
		);
		this.previewSection.hidden = true;
		const enable = createElementFactory(body.ownerDocument)(
			'div.prctr-admin-retention-actions'
		);
		this.previewSection.footer.append(enable);
		this.enableButton = this._register(
			new ButtonControl(enable, {
				variant: 'danger',
				size: 'small',
				label: format.text('retentionEnable'),
				icon: proctorIconFactory('action.enable', 14)
			})
		);
		this._register(this.enableButton.onDidRequest(() => this.confirmEnable()));
		this.records = this._register(
			instantiationService.createInstance(
				AdminList<'retentionRecords'>,
				body,
				'retentionRecords',
				{},
				{
					title: format.text('retentionRecords'),
					label: format.text('retentionRecords'),
					columns: [
						{
							label: format.text('retentionSubmission'),
							width: '34%',
							cell: (record) => ({
								kind: 'text',
								primary: record.submissionId,
								mono: true
							})
						},
						{
							label: format.text('retentionCategory'),
							width: '26%',
							cell: (record) => ({
								kind: 'text',
								primary: readableCode(record.category)
							})
						},
						{
							label: format.text('retentionStatus'),
							cell: (record) =>
								record.retiredAt !== undefined
									? {
											kind: 'status',
											text: format.text('retentionRetired', {
												date: format.date(record.retiredAt)
											}),
											tone: 'neutral'
										}
									: record.held
										? {
												kind: 'status',
												text: format.text('retentionHeld'),
												tone: 'neutral'
											}
										: record.eligibleAt !== undefined
											? {
													kind: 'status',
													text: format.text('retentionEligibleOn', {
														date: format.date(record.eligibleAt)
													}),
													tone: 'neutral'
												}
											: {
													kind: 'status',
													text:
														record.blocker === ''
															? format.text('retentionKept')
															: readableCode(record.blocker),
													tone: 'neutral'
												}
						}
					],
					rowId: (record) => `${record.submissionId}:${record.category}`,
					rowName: (record) => record.submissionId,
					icon: 'admin.retention',
					empty: format.text('retentionRecordsEmpty')
				}
			)
		);
		this.policy = this._register(adminRead(administration, { kind: 'retentionPolicy' }));
		this.control = this._register(adminRead(administration, { kind: 'retentionControl' }));
		this._register(this.policy.onDidChange(() => this.renderPolicy()));
		this._register(this.control.onDidChange(() => this.renderControl()));
		this.renderPolicy();
		this.renderControl();
	}

	setVisible(visible: boolean): void {
		this.policy.setActive(visible);
		this.control.setActive(visible);
		this.records.setActive(visible);
	}

	private days(value: number): string {
		return value === 0
			? this.format.text('retentionNever')
			: this.format.text('retentionDays', { count: this.format.count(value) });
	}

	private renderPolicy(): void {
		const policy = this.policy.data;
		this.policySection.setState(this.policy.state, false, () => void this.policy.refresh());
		this.policySection.setAction(policy !== undefined);
		if (policy === undefined) return;
		renderDetails(this.policySection.content, [
			...PERIODS.map(({ field, label }) => ({
				label: this.format.text(label),
				value: this.days(policy[field])
			})),
			{
				label: this.format.text('retentionNotices'),
				value: this.format.text(policy.candidateNotices ? 'retentionOn' : 'retentionOff')
			}
		]);
	}

	private renderControl(): void {
		const control = this.control.data;
		this.cleanupSection.setState(this.control.state, false, () => void this.control.refresh());
		this.previewButton.element.hidden = control === undefined;
		this.pauseButton.element.hidden = control?.state !== 'enabled';
		if (control === undefined) return;
		this.cleanupSection.setHeading(
			this.format.text('retentionCleanup'),
			control.state === 'enabled' ? undefined : this.format.text('retentionNeedsPreview')
		);
		renderDetails(this.cleanupSection.content, [
			{
				label: this.format.text('retentionState'),
				value: this.format.text(STATE_TEXT[control.state])
			}
		]);
	}

	private edit(): void {
		const policy = this.policy.data;
		if (policy === undefined) return;
		const parse = (values: AdminFormValues, field: DaysField): number | undefined => {
			const text = String(values[field] ?? '');
			const value = Number(text);
			return /^\d{1,5}$/u.test(text) && value <= 36500 ? value : undefined;
		};
		this.dialog.value = this.instantiationService.createInstance(AdminFormDialog, {
			title: this.format.text('retentionEditTitle'),
			confirmLabel: this.format.text('structureSave'),
			confirmIcon: 'action.confirm',
			fields: [
				...PERIODS.map(({ field, label }) => ({
					kind: 'text' as const,
					id: field,
					label: this.format.text(label),
					value: String(policy[field]),
					hint: this.format.text('retentionDaysHint'),
					inputMode: 'numeric' as const,
					required: true
				})),
				{
					kind: 'check',
					id: 'candidateNotices',
					label: this.format.text('retentionNotices'),
					value: policy.candidateNotices
				}
			],
			submit: (values) => {
				const parsed: Partial<Record<DaysField, number>> = {};
				for (const { field } of PERIODS) {
					const value = parse(values, field);
					if (value === undefined)
						return { field, error: this.format.text('retentionDaysInvalid') };
					parsed[field] = value;
				}
				return {
					kind: 'replaceRetentionPolicy',
					expectedRevision: policy.revision,
					submissionDays: parsed.submissionDays!,
					integrityDays: parsed.integrityDays!,
					browserActivityDays: parsed.browserActivityDays!,
					securityOperationalDays: parsed.securityOperationalDays!,
					auditDays: parsed.auditDays!,
					exportDays: parsed.exportDays!,
					deletionGraceDays: parsed.deletionGraceDays!,
					candidateNotices: values.candidateNotices === true
				};
			},
			summary: () => [this.format.text('retentionEditTitle')],
			onDidComplete: (result) => {
				this.pane.toast(
					result.kind === 'error'
						? this.format.failure(result.reason)
						: this.format.text('retentionSaved')
				);
				void this.policy.refresh();
				void this.control.refresh();
			}
		});
	}

	private async createPreview(): Promise<void> {
		const policy = this.policy.data;
		if (policy === undefined) return;
		this.previewButton.setState({
			label: this.format.text('retentionPreview'),
			icon: proctorIconFactory('action.search', 14),
			busy: true
		});
		const created = await this.changes.send(
			{ kind: 'createRetentionPreview', expectedRevision: policy.revision },
			[this.format.text('retentionPreview')]
		);
		if (this._store.isDisposed) return;
		this.previewButton.setState({
			label: this.format.text('retentionPreview'),
			icon: proctorIconFactory('action.search', 14)
		});
		if (created === 'busy' || created.kind !== 'created') {
			if (created === 'busy' || created.kind !== 'error' || created.reason !== 'cancelled')
				this.pane.toast(this.changes.describe(created) || this.format.failure('invalid'));
			return;
		}
		const preview = await readOnce(this.administration, {
			kind: 'retentionPreview',
			id: created.id
		});
		if (this._store.isDisposed) return;
		if (preview.kind === 'failure') {
			this.pane.toast(this.format.failure(preview.reason));
			return;
		}
		this.preview = preview.value;
		this.renderPreview();
	}

	private renderPreview(): void {
		const preview = this.preview;
		this.previewSection.hidden = preview === undefined;
		if (preview === undefined) return;
		this.previewSection.setHeading(
			this.format.text('retentionPreviewTitle'),
			this.format.text('retentionPreviewExpires', {
				when: this.format.relative(preview.expiresAt)
			})
		);
		this.previewSection.setState({ kind: 'ready' }, false);
		this.previewSection.setRows(
			PREVIEW_CATEGORIES.map(({ key, label }): PageRowModel => {
				const counts = preview[key];
				return {
					id: key,
					glyph: 'admin.retention',
					title: this.format.text(label),
					detail: this.format.text('retentionEligible', {
						eligible: this.format.count(counts.eligible),
						total: this.format.count(counts.total),
						held: this.format.count(counts.held)
					})
				};
			})
		);
		this.enableButton.element.hidden = this.control.data?.state === 'enabled';
		this.previewSection.focusHeading();
	}

	private confirmEnable(): void {
		const preview = this.preview;
		if (preview === undefined) return;
		this.dialog.value = this.instantiationService.createInstance(
			AdminConfirmation,
			{
				title: this.format.text('retentionEnableTitle'),
				message: this.format.text('retentionEnableBody'),
				confirmLabel: this.format.text('retentionEnableConfirm'),
				confirmIcon: 'action.enable',
				destructive: true,
				run: () => this.cleanupChange('enabled', preview.id),
				onDidComplete: (result) => this.afterCleanup(result, 'enabled')
			},
			() => this.enableButton.focus()
		);
	}

	private async setCleanup(state: 'paused'): Promise<void> {
		const result = await this.cleanupChange(state, undefined);
		if (this._store.isDisposed || result === 'busy') return;
		this.afterCleanup(result, state);
	}

	private cleanupChange(state: 'enabled' | 'paused', previewId: string | undefined) {
		const control = this.control.data;
		const policy = this.policy.data;
		if (control === undefined || policy === undefined)
			return Promise.resolve<AdministrationResponse>({ kind: 'error', reason: 'invalid' });
		return this.changes.send(
			{
				kind: 'changeRetentionControl',
				expectedRevision: control.revision,
				expectedPolicyRevision: policy.revision,
				state,
				...(previewId === undefined ? {} : { previewId })
			},
			[this.format.text(state === 'enabled' ? 'retentionEnableConfirm' : 'retentionPause')]
		);
	}

	private afterCleanup(result: AdministrationResponse, state: 'enabled' | 'paused'): void {
		if (result.kind === 'error') {
			if (result.reason !== 'cancelled') this.pane.toast(this.format.failure(result.reason));
		} else {
			this.pane.toast(
				this.format.text('retentionChanged', {
					state: this.format.text(STATE_TEXT[state]).toLocaleLowerCase()
				})
			);
			this.preview = undefined;
			this.renderPreview();
		}
		void this.control.refresh();
	}
}
