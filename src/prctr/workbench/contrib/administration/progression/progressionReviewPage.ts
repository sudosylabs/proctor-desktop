/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { BannerControl } from '../../../../base/browser/ui/banner/bannerControl.js';
import { ButtonControl } from '../../../../base/browser/ui/button/buttonControl.js';
import {
	Disposable,
	MutableDisposable,
	toDisposable,
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
import { IAuthenticatedNavigationService } from '../../../services/authenticatedNavigation/common/authenticatedNavigation.js';
import { IAdministrationFormatService } from '../administrationFormat.js';
import { AdminChanges, AdminConfirmation } from '../widgets/adminChanges.js';
import { renderDetails } from '../widgets/adminDetails.js';
import { adminRead } from '../widgets/adminReads.js';
import { PROGRESSION_STATE, progressionName } from './progressionPage.js';

type Progression = AdministrationValue<'studentProgression'>;

/** While the server checks or moves students, the page reads the progression again this often. */
const WORKING_REFRESH_MS = 2_000;

/**
 * One progression: who moves and who stays, then moving them or cancelling. While the server
 * is still checking or moving, the page follows it.
 */
export class ProgressionReviewPage extends Disposable implements PageView {
	private readonly read: PageRead<Progression, AdministrationFailure, AdministrationResponse>;
	private readonly summary: PageSection;
	private readonly rows: PageSection;
	private readonly banner: BannerControl;
	private readonly commit: ButtonControl;
	private readonly cancel: ButtonControl;
	private readonly changes: AdminChanges;
	private readonly dialog = this._register(new MutableDisposable<IDisposable>());
	private readonly poll = this._register(new MutableDisposable());
	private visible = false;

	constructor(
		body: HTMLElement,
		headerActions: HTMLElement,
		progressionId: string,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@IAdministrationService administration: IAdministrationService,
		@IAdministrationFormatService private readonly format: IAdministrationFormatService,
		@IAuthenticatedNavigationService
		private readonly navigation: IAuthenticatedNavigationService,
		@IPagePaneContext private readonly pane: IPagePaneContext
	) {
		super();
		this.changes = this._register(instantiationService.createInstance(AdminChanges));
		this.cancel = this._register(
			new ButtonControl(headerActions, {
				variant: 'secondary',
				label: format.text('reviewCancel'),
				icon: proctorIconFactory('action.end')
			})
		);
		this.commit = this._register(
			new ButtonControl(headerActions, {
				variant: 'brand',
				label: format.text('reviewCommit', { count: 0 }),
				icon: proctorIconFactory('action.continue'),
				disabled: true
			})
		);
		this.cancel.element.hidden = true;
		this.commit.element.hidden = true;
		this._register(this.commit.onDidRequest(() => this.confirmCommit()));
		this._register(this.cancel.onDidRequest(() => this.confirmCancel()));
		this.banner = this._register(new BannerControl(body));
		this.summary = this._register(
			instantiationService.createInstance(PageSection, body, {
				title: format.text('reviewSummary')
			})
		);
		this.rows = this._register(
			instantiationService.createInstance(PageSection, body, {
				title: format.text('reviewRows'),
				description: format.text('reviewRowsDescription')
			})
		);
		this.read = this._register(
			adminRead(administration, { kind: 'studentProgression', id: progressionId })
		);
		this._register(this.read.onDidChange(() => this.render()));
		this.render();
	}

	setVisible(visible: boolean): void {
		this.visible = visible;
		this.read.setActive(visible);
		this.schedule();
	}

	private schedule(): void {
		const state = this.read.data?.state;
		const working = state === 'uploading' || state === 'parsing' || state === 'executing';
		if (!this.visible || !working) {
			this.poll.clear();
			return;
		}
		if (this.poll.value !== undefined) return;
		const timer = setInterval(() => void this.read.refresh(), WORKING_REFRESH_MS);
		this.poll.value = toDisposable(() => clearInterval(timer));
	}

	private render(): void {
		const data = this.read.data;
		const state = this.read.state;
		this.summary.setState(state, false, () => void this.read.refresh());
		this.rows.setState(state, false, () => void this.read.refresh());
		this.schedule();
		const trail = [
			{
				label: this.format.text('reviewTrail'),
				open: () => this.navigation.selectAdministrationPage('progression')
			}
		];
		if (data === undefined) {
			this.pane.setHeading({
				title: this.format.text('reviewTitle'),
				description: '',
				trail
			});
			this.setButtons(undefined);
			return;
		}
		const shown = PROGRESSION_STATE[data.state];
		this.pane.setHeading({
			title: progressionName(this.format, data),
			description: this.format.text('reviewDescription', {
				date:
					data.effectiveAt === undefined
						? this.format.text('jobNone')
						: this.format.date(data.effectiveAt),
				when: this.format.relative(data.createdAt)
			}),
			trail,
			status: {
				text: this.format.text(shown.text),
				tone: shown.tone
			}
		});
		const done =
			data.state === 'completed' ||
			data.state === 'completed_with_errors' ||
			data.state === 'executing';
		const staying = data.invalidRows + data.skippedRows + data.noOpRows;
		renderDetails(
			this.summary.content,
			done
				? [
						{
							label: this.format.text('reviewMoved'),
							value: this.format.count(data.succeededRows)
						},
						{
							label: this.format.text('reviewNotMoved'),
							value: this.format.count(data.failedRows + data.skippedRows)
						}
					]
				: [
						{
							label: this.format.text('reviewMoving'),
							value: this.format.count(data.validRows)
						},
						{
							label: this.format.text('reviewStaying'),
							value: this.format.count(staying),
							...(staying > 0
								? {
										note: {
											text: this.format.text('reviewLeftOut'),
											tone: 'neutral' as const
										}
									}
								: {})
						}
					]
		);
		const working = data.state === 'uploading' || data.state === 'parsing';
		if (working)
			this.banner.show({
				tone: 'info',
				text: this.format.text('reviewChecking'),
				icon: proctorIconFactory('status.busy', 18)
			});
		else if (data.state === 'executing')
			this.banner.show({
				tone: 'info',
				text: this.format.text('reviewMovingBanner'),
				icon: proctorIconFactory('status.busy', 18)
			});
		else if (data.state === 'preview_ready' && data.invalidRows > 0)
			this.banner.show({
				tone: 'warning',
				text: this.format.text('reviewStayBanner', {
					count: this.format.count(data.invalidRows)
				}),
				icon: proctorIconFactory('status.attention', 18)
			});
		else this.banner.hide();
		const problems = data.rows
			.filter(
				(row) =>
					row.status !== 'valid' && row.status !== 'pending' && row.status !== 'succeeded'
			)
			.sort((a, b) => a.row - b.row);
		this.rows.setRows(
			problems.map((row): PageRowModel => {
				const failed =
					row.status === 'invalid' ||
					row.status === 'failed' ||
					row.status === 'duplicate';
				return {
					id: String(row.row),
					glyph: 'object.student',
					title: this.format.text('reviewStudentRow', {
						row: row.row,
						reference: row.reference
					}),
					detail: row.code === undefined ? '' : this.format.code('problem', row.code),
					status: {
						text: this.format.text(failed ? 'reviewLeftOut' : 'reviewSkipped'),
						tone: failed ? 'failure' : 'neutral'
					}
				};
			})
		);
		if (problems.length === 0 && state.kind === 'ready')
			this.rows.setState(state, this.format.text('reviewRowsNone'));
		this.setButtons(data);
	}

	private setButtons(data: Progression | undefined): void {
		const ready = data?.state === 'preview_ready' && data.validRows > 0;
		// A move that takes effect later is scheduled, not made now; the button says when.
		const later =
			data?.effectiveAt !== undefined && data.effectiveAt > this.format.now()
				? data.effectiveAt
				: undefined;
		this.commit.setState({
			label:
				later === undefined
					? this.format.text('reviewCommit', {
							count: this.format.count(data?.validRows ?? 0)
						})
					: this.format.text('reviewSchedule', { date: this.format.date(later) }),
			icon: proctorIconFactory('action.continue'),
			disabled: !ready
		});
		this.commit.element.hidden = data?.state !== 'preview_ready';
		const cancellable = data?.state === 'preview_ready' || data?.state === 'parsing';
		this.cancel.element.hidden = !cancellable;
	}

	private confirmCommit(): void {
		const data = this.read.data;
		if (data === undefined || data.previewDigest === undefined) return;
		const digest = data.previewDigest;
		const label = this.commit.element.textContent ?? '';
		this.dialog.value = this.instantiationService.createInstance(
			AdminConfirmation,
			{
				title: this.format.text('reviewCommitTitle'),
				message: this.format.text('reviewCommitBody'),
				confirmLabel: label,
				confirmIcon: 'action.continue',
				destructive: false,
				run: () =>
					this.changes.send(
						{
							kind: 'commitProgression',
							id: data.id,
							expectedRevision: data.revision,
							previewDigest: digest
						},
						[progressionName(this.format, data), label]
					),
				onDidComplete: (result) => {
					this.pane.toast(
						result.kind === 'error'
							? this.format.failure(result.reason)
							: this.format.text('reviewStarted')
					);
					void this.read.refresh();
				}
			},
			() => this.commit.focus()
		);
	}

	private confirmCancel(): void {
		const data = this.read.data;
		if (data === undefined) return;
		this.dialog.value = this.instantiationService.createInstance(
			AdminConfirmation,
			{
				title: this.format.text('reviewCancelTitle'),
				message: this.format.text('reviewCancelBody'),
				confirmLabel: this.format.text('reviewCancel'),
				confirmIcon: 'action.end',
				destructive: true,
				run: () =>
					this.changes.send({ kind: 'cancelProgression', id: data.id }, [
						progressionName(this.format, data)
					]),
				onDidComplete: (result) => {
					this.pane.toast(
						result.kind === 'error'
							? this.format.failure(result.reason)
							: this.format.text('reviewCancelled')
					);
					void this.read.refresh();
				}
			},
			() => this.pane.focusPage()
		);
	}
}
