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
import { renderDetails } from '../../../browser/authenticated/pages/pageDetails.js';
import type { PageView } from '../../../browser/authenticated/pages/pagePane.js';
import {
	IPagePaneContext,
	type PageHeading
} from '../../../browser/authenticated/pages/pagePaneContext.js';
import type { PageRead } from '../../../browser/authenticated/pages/pageRead.js';
import { PageSection } from '../../../browser/authenticated/pages/pageSection.js';
import { PageStats, type PageStat } from '../../../browser/authenticated/pages/pageStats.js';
import { PageSteps } from '../../../browser/authenticated/pages/pageSteps.js';
import { PageTable } from '../../../browser/authenticated/pages/pageTable.js';
import { IAdministrationService } from '../../../services/administration/common/administration.js';
import { IAuthenticatedNavigationService } from '../../../services/authenticatedNavigation/common/authenticatedNavigation.js';
import { IAdministrationFormatService, type AdministrationText } from '../administrationFormat.js';
import { AdminChanges, AdminConfirmation } from '../widgets/adminChanges.js';
import { adminRead } from '../widgets/adminReads.js';
import { IMPORT_MODE_TEXT, IMPORT_STATE_TEXT } from './importText.js';
import { UploadImportDialog } from './uploadImportDialog.js';

type Import = AdministrationValue<'onboardingImport'>;
type Row = Import['rows'][number];

/** While the server works through a file, the page reads it again this often. */
const WORKING_REFRESH_MS = 2_000;
const ROWS_PAGE = 10;
const UNREADABLE = 'onboarding_import.file_invalid';

/** Where an import stands: 0 uploading, 1 checked and waiting for review, 2 importing, 3 done. */
function stepOf(data: Import): number {
	switch (data.state) {
		case 'uploading':
			return 0;
		case 'parsing':
		case 'preview_ready':
		case 'canceled':
			return 1;
		case 'executing':
			return 2;
		case 'completed':
		case 'completed_with_errors':
			return 3;
		case 'failed':
			return data.failureCode === UNREADABLE ? 0 : 2;
	}
}

/**
 * One uploaded file, as its boards draw each stage: checking, the review before anything
 * changes, importing, the result, or a file that couldn't be read. While the server is still
 * working the page reads the import again every two seconds.
 */
export class ImportPage extends Disposable implements PageView {
	private readonly read: PageRead<Import, AdministrationFailure, AdministrationResponse>;
	private readonly banner: BannerControl;
	private readonly bannerAction: ButtonControl;
	private readonly steps: PageSteps;
	private readonly stats: PageStats;
	private readonly look: PageSection;
	private readonly lookTable: PageTable<Row>;
	private readonly failedRows: PageSection;
	private readonly failedTable: PageTable<Row>;
	private readonly expects: PageSection;
	private readonly commit: ButtonControl;
	private readonly cancel: ButtonControl;
	private readonly upload: ButtonControl;
	private readonly changes: AdminChanges;
	private readonly dialog = this._register(new MutableDisposable<IDisposable>());
	private readonly poll = this._register(new MutableDisposable());
	private visible = false;

	constructor(
		body: HTMLElement,
		headerActions: HTMLElement,
		importId: string,
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
				variant: 'ghost',
				label: format.text('importCancel')
			})
		);
		this.upload = this._register(
			new ButtonControl(headerActions, {
				variant: 'brand',
				label: format.text('importNewFile'),
				icon: proctorIconFactory('action.upload')
			})
		);
		this.commit = this._register(
			new ButtonControl(headerActions, {
				variant: 'brand',
				label: format.text('importCommitPeople', { count: 0 }),
				icon: proctorIconFactory('action.confirm')
			})
		);
		this._register(this.commit.onDidRequest(() => this.confirmCommit()));
		this._register(this.cancel.onDidRequest(() => this.confirmCancel()));
		this._register(this.upload.onDidRequest(() => this.openUpload()));

		this.banner = this._register(new BannerControl(body));
		this.bannerAction = this._register(
			new ButtonControl(this.banner.actions, {
				variant: 'secondary',
				size: 'small',
				label: format.text('importNewFile'),
				icon: proctorIconFactory('action.upload', 14)
			})
		);
		this._register(this.bannerAction.onDidRequest(() => this.openUpload()));
		this.steps = this._register(
			new PageSteps(body, format.text('importSteps'), [
				format.text('importStepUpload'),
				format.text('importStepReview'),
				format.text('importStepImport')
			])
		);
		this.stats = this._register(new PageStats(body));
		const showing = (first: number, last: number, total: number): string =>
			format.text('listShowing', {
				range: format.pagerLabels('').range(first, last, total, false)
			});
		const labels = {
			previous: format.text('pagerPrevious'),
			next: format.text('pagerNext'),
			showing
		};
		const rowColumn = {
			label: format.text('importColumnRow'),
			width: '56px',
			align: 'end' as const,
			cell: (row: Row) => ({ kind: 'text' as const, primary: String(row.row), mono: true })
		};
		this.look = this._register(
			instantiationService.createInstance(PageSection, body, {
				title: format.text('importLookTitle'),
				description: format.text('importLookDescription'),
				plain: true
			})
		);
		this.lookTable = this._register(
			new PageTable<Row>(this.look.content, {
				label: format.text('importLookTitle'),
				rowId: (row) => String(row.row),
				pageSize: ROWS_PAGE,
				labels,
				columns: [
					rowColumn,
					{
						label: format.text('importColumnPerson'),
						width: '240px',
						cell: (row) => ({ kind: 'text', primary: row.reference, strong: true })
					},
					{
						label: format.text('importColumnFound'),
						cell: (row) => ({ kind: 'text', primary: this.found(row), wrap: true })
					},
					{
						label: format.text('importColumnOutcome'),
						width: '84px',
						cell: (row) =>
							row.status === 'invalid' || row.status === 'failed'
								? {
										kind: 'word',
										text: format.text('importOutcomeLeftOut'),
										tone: 'failure'
									}
								: {
										kind: 'word',
										text: format.text('importOutcomeSkipped'),
										tone: 'neutral'
									}
					}
				]
			})
		);
		this.failedRows = this._register(
			instantiationService.createInstance(PageSection, body, {
				title: format.text('importFailedTitle'),
				plain: true
			})
		);
		this.failedTable = this._register(
			new PageTable<Row>(this.failedRows.content, {
				label: format.text('importFailedTitle'),
				rowId: (row) => String(row.row),
				pageSize: ROWS_PAGE,
				labels,
				columns: [
					rowColumn,
					{
						label: format.text('importColumnPerson'),
						width: '260px',
						cell: (row) => ({ kind: 'text', primary: row.reference, strong: true })
					},
					{
						label: format.text('importColumnWhy'),
						cell: (row) => ({ kind: 'text', primary: this.found(row), wrap: true })
					}
				]
			})
		);
		this.expects = this._register(
			instantiationService.createInstance(PageSection, body, {
				title: format.text('importExpectsTitle')
			})
		);
		this.expects.setState({ kind: 'ready' }, false);
		renderDetails(this.expects.content, [
			{
				label: format.text('importExpectsFormat'),
				value: format.text('importExpectsFormatValue')
			},
			{
				label: format.text('importExpectsFirstRow'),
				value: format.text('importExpectsFirstRowValue')
			},
			{
				label: format.text('importExpectsEachRow'),
				value: format.text('importExpectsEachRowValue')
			}
		]);
		this.read = this._register(
			adminRead(administration, { kind: 'onboardingImport', id: importId })
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

	/** What Proctor found in a row, in words. */
	private found(row: Row): string {
		if (row.code !== undefined) return this.format.code('problem', row.code);
		return this.format.text(
			row.status === 'no_op' || row.status === 'skipped' || row.status === 'duplicate'
				? 'importFoundAlready'
				: 'importFoundUnknown'
		);
	}

	private render(): void {
		const data = this.read.data;
		const state = this.read.state;
		this.schedule();
		const trail = [
			{
				label: this.format.text('importTrail'),
				open: () => this.navigation.selectAdministrationPage('imports')
			}
		];
		const showAll = (shown: boolean): void => {
			this.steps.element.hidden = !shown;
			this.stats.element.hidden = !shown;
		};
		if (data === undefined) {
			this.pane.setHeading({
				title: this.format.text('importTitle'),
				description: '',
				trail
			});
			this.look.setState(state, false, () => void this.read.refresh());
			this.failedRows.element.hidden = true;
			this.expects.element.hidden = true;
			this.banner.hide();
			showAll(false);
			this.setButtons(undefined);
			return;
		}
		showAll(true);
		this.pane.setHeading(this.heading(data, trail));
		this.steps.set(stepOf(data));
		this.stats.set(this.figures(data));
		this.renderBanner(data);
		const unreadable = data.state === 'failed' && data.failureCode === UNREADABLE;
		this.stats.element.hidden = unreadable;
		this.expects.element.hidden = !unreadable;

		const finished = data.state === 'completed' || data.state === 'completed_with_errors';
		const leftOutFirst = (row: Row): number =>
			row.status === 'invalid' || row.status === 'failed' ? 0 : 1;
		const lookRows = [...data.rows]
			.filter(
				(row) =>
					row.status === 'invalid' ||
					row.status === 'duplicate' ||
					row.status === 'skipped' ||
					row.status === 'no_op'
			)
			.sort((a, b) => leftOutFirst(a) - leftOutFirst(b) || a.row - b.row);
		this.look.element.hidden =
			finished || unreadable || data.state === 'executing' || lookRows.length === 0;
		this.look.setState({ kind: 'ready' }, false);
		this.lookTable.setItems(lookRows);
		const failed = data.rows.filter((row) => row.status === 'failed');
		this.failedRows.element.hidden = !finished || failed.length === 0;
		this.failedRows.setState({ kind: 'ready' }, false);
		this.failedTable.setItems(failed);
		this.setButtons(data);
	}

	private heading(data: Import, trail: PageHeading['trail']): PageHeading {
		const finished = data.state === 'completed' || data.state === 'completed_with_errors';
		const missed = data.invalidRows + data.failedRows;
		const status: PageHeading['status'] = (() => {
			switch (data.state) {
				case 'preview_ready':
					return { text: this.text(data.state), tone: 'attention' };
				case 'uploading':
				case 'parsing':
				case 'executing':
					return { text: this.text(data.state), tone: 'progress' };
				case 'completed':
				case 'completed_with_errors':
					return missed === 0
						? { text: this.format.text('importStateCompleted'), tone: 'neutral' }
						: {
								text: this.format.text('importsImportedMissed', {
									count: this.format.count(missed)
								}),
								tone: 'attention'
							};
				case 'failed':
					return {
						text:
							data.failureCode === UNREADABLE
								? this.format.text('importsUnreadable')
								: this.text(data.state),
						tone: 'failure'
					};
				case 'canceled':
					return { text: this.text(data.state), tone: 'neutral' };
			}
		})();
		const record = [this.format.text(IMPORT_MODE_TEXT[data.mode])];
		if (data.state === 'executing')
			record.push(
				this.format.counted('importRecordPeople', data.validRows, {
					count: this.format.count(data.validRows)
				}),
				this.format.text('importRecordStarted', {
					when: this.format.relative(data.updatedAt)
				})
			);
		else {
			if (!(data.state === 'failed' && data.totalRows === 0))
				record.push(
					this.format.counted('importRecordRows', data.totalRows, {
						count: this.format.count(data.totalRows)
					})
				);
			record.push(
				finished
					? this.format.text('importRecordFinished', {
							when: this.format.relative(data.updatedAt)
						})
					: this.format.text('importRecordUploaded', {
							when: this.format.relative(data.createdAt)
						})
			);
		}
		return {
			title: data.fileName ?? this.format.text(IMPORT_MODE_TEXT[data.mode]),
			description: '',
			trail,
			status,
			record
		};
	}

	private figures(data: Import): PageStat[] {
		const stat = (
			id: string,
			label: AdministrationText,
			value: number,
			note: AdministrationText,
			tone?: 'attention' | 'failure',
			values: Readonly<Record<string, string>> = {}
		): PageStat => ({
			id,
			label: this.format.text(label),
			value: this.format.count(value),
			note: this.format.text(note, values),
			...(tone === undefined ? {} : { tone })
		});
		const skipped = data.skippedRows + data.noOpRows;
		switch (data.state) {
			case 'uploading':
			case 'parsing':
				return [
					stat(
						'checked',
						'importStatChecked',
						data.validRows + data.invalidRows,
						'importStatOf',
						undefined,
						{
							total: this.format.count(data.totalRows)
						}
					),
					stat('ready', 'importStatReadySoFar', data.validRows, 'importStatNew'),
					stat(
						'look',
						'importStatNeedLook',
						data.invalidRows,
						'importStatSoFar',
						data.invalidRows > 0 ? 'attention' : undefined
					)
				];
			case 'executing':
				return [
					stat('imported', 'importStatImported', data.succeededRows, 'importStatSoFar'),
					stat(
						'waiting',
						'importStatWaiting',
						Math.max(0, data.validRows - data.succeededRows - data.failedRows),
						'importStatInOrder'
					),
					stat(
						'failed',
						'importStatDidnt',
						data.failedRows,
						'importStatYet',
						data.failedRows > 0 ? 'failure' : undefined
					)
				];
			case 'completed':
			case 'completed_with_errors':
				return [
					stat('imported', 'importStatImported', data.succeededRows, 'importStatNew'),
					stat('skipped', 'importStatSkipped', skipped, 'importStatAlready'),
					stat(
						'leftOut',
						'importStatLeftOutReview',
						data.invalidRows,
						'importStatInReport',
						data.invalidRows > 0 ? 'failure' : undefined
					),
					stat(
						'failed',
						'importStatFailedImporting',
						data.failedRows,
						'importStatListedBelow',
						data.failedRows > 0 ? 'failure' : undefined
					)
				];
			default:
				return [
					stat('ready', 'importStatReady', data.validRows, 'importStatAsWritten'),
					stat('skipped', 'importStatSkipped', skipped, 'importStatAlready'),
					stat(
						'leftOut',
						'importStatLeftOut',
						data.invalidRows,
						'importStatFixUpload',
						data.invalidRows > 0 ? 'failure' : undefined
					)
				];
		}
	}

	private renderBanner(data: Import): void {
		const show = (
			tone: 'info' | 'warning' | 'failure',
			text: string,
			icon: 'status.busy' | 'status.attention',
			upload: boolean
		): void => {
			this.banner.show({ tone, text, icon: proctorIconFactory(icon, 18) });
			this.bannerAction.element.hidden = !upload;
		};
		const missed = data.invalidRows + data.failedRows;
		switch (data.state) {
			case 'uploading':
			case 'parsing':
				show('info', this.format.text('importCheckingBanner'), 'status.busy', false);
				return;
			case 'executing':
				show(
					'info',
					this.format.text('importImportingBanner', {
						done: this.format.count(data.succeededRows),
						total: this.format.count(data.validRows)
					}),
					'status.busy',
					false
				);
				return;
			case 'preview_ready':
				if (data.invalidRows > 0)
					show(
						'warning',
						this.format.counted('importLeftOutBanner', data.invalidRows, {
							count: this.format.count(data.invalidRows)
						}),
						'status.attention',
						true
					);
				else this.banner.hide();
				return;
			case 'completed':
			case 'completed_with_errors':
				if (missed > 0)
					show(
						'warning',
						this.format.text('importDoneBanner', {
							imported: this.format.count(data.succeededRows),
							missed: this.format.count(missed),
							left: this.format.count(data.invalidRows),
							failed: this.format.count(data.failedRows)
						}),
						'status.attention',
						true
					);
				else this.banner.hide();
				return;
			case 'failed':
				show(
					'failure',
					this.format.text(
						data.failureCode === UNREADABLE
							? 'importUnreadableBanner'
							: 'importFailedBanner'
					),
					'status.attention',
					false
				);
				return;
			case 'canceled':
				this.banner.hide();
				return;
		}
	}

	private setButtons(data: Import | undefined): void {
		const ready = data?.state === 'preview_ready' && data.validRows > 0;
		const count = data?.validRows ?? 0;
		this.commit.setState({
			label: this.format.counted('importCommitPeople', count, {
				count: this.format.count(count)
			}),
			icon: proctorIconFactory('action.confirm'),
			disabled: !ready
		});
		this.commit.element.hidden = data?.state !== 'preview_ready';
		this.cancel.element.hidden = data?.state !== 'parsing' && data?.state !== 'uploading';
		this.upload.element.hidden = data?.state !== 'failed';
	}

	private text(state: Import['state']): string {
		return this.format.text(IMPORT_STATE_TEXT[state]);
	}

	private openUpload(): void {
		this.dialog.value = this.instantiationService.createInstance(UploadImportDialog);
	}

	private confirmCommit(): void {
		const data = this.read.data;
		if (data === undefined || data.previewDigest === undefined) return;
		const digest = data.previewDigest;
		const policy = data.invalidRows > 0 ? 'valid_rows_only' : 'require_all_valid';
		const label = this.commit.element.textContent ?? '';
		this.dialog.value = this.instantiationService.createInstance(
			AdminConfirmation,
			{
				title: this.format.text('importCommitTitle'),
				message: this.format.text('importCommitBody'),
				confirmLabel: label,
				confirmIcon: 'action.confirm',
				destructive: false,
				run: () =>
					this.changes.send(
						{
							kind: 'commitImport',
							id: data.id,
							expectedRevision: data.revision,
							policy,
							previewDigest: digest
						},
						[label]
					),
				onDidComplete: (result) => {
					this.pane.toast(
						result.kind === 'error'
							? this.format.failure(result.reason)
							: this.format.text('importStarted')
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
				title: this.format.text('importCancelTitle'),
				message: this.format.text('importCancelBody'),
				confirmLabel: this.format.text('importCancelConfirm'),
				confirmIcon: 'action.end',
				destructive: true,
				run: () =>
					this.changes.send({ kind: 'cancelImport', id: data.id }, [
						this.format.text('importCancelConfirm')
					]),
				onDidComplete: (result) => {
					this.pane.toast(
						result.kind === 'error'
							? this.format.failure(result.reason)
							: this.format.text('importCancelled')
					);
					void this.read.refresh();
				}
			},
			() => this.pane.focusPage()
		);
	}
}
