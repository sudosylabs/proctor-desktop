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
	AdministrationValue,
	importRowStates
} from '../../../../platform/administration/common/administrationProtocol.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { proctorIconFactory } from '../../../../platform/theme/browser/proctorIcon.js';
import type { PageView } from '../../../browser/authenticated/pages/pagePane.js';
import { IPagePaneContext } from '../../../browser/authenticated/pages/pagePaneContext.js';
import type { PageRead } from '../../../browser/authenticated/pages/pageRead.js';
import {
	PageSection,
	type PageRowModel,
	type PageRowStatus
} from '../../../browser/authenticated/pages/pageSection.js';
import { IAdministrationService } from '../../../services/administration/common/administration.js';
import { IAuthenticatedNavigationService } from '../../../services/authenticatedNavigation/common/authenticatedNavigation.js';
import { IAdministrationFormatService, type AdministrationText } from '../administrationFormat.js';
import { AdminChanges, AdminConfirmation } from '../widgets/adminChanges.js';
import { renderDetails } from '../../../browser/authenticated/pages/pageDetails.js';
import { adminRead } from '../widgets/adminReads.js';
import { IMPORT_MODE_TEXT, IMPORT_STATE_TEXT } from './importText.js';

type Import = AdministrationValue<'onboardingImport'>;
type RowState = (typeof importRowStates)[number];

/** While the server works through a file, the page reads it again this often. */
const WORKING_REFRESH_MS = 2_000;

const ROW_STATUS: Readonly<
	Record<RowState, { readonly text: AdministrationText; readonly tone: PageRowStatus['tone'] }>
> = {
	valid: { text: 'importRowValid', tone: 'neutral' },
	invalid: { text: 'importRowInvalid', tone: 'failure' },
	duplicate: { text: 'importRowDuplicate', tone: 'attention' },
	pending: { text: 'importRowValid', tone: 'neutral' },
	succeeded: { text: 'importRowDone', tone: 'neutral' },
	no_op: { text: 'importRowSkipped', tone: 'neutral' },
	failed: { text: 'importRowFailed', tone: 'failure' },
	skipped: { text: 'importRowSkipped', tone: 'neutral' },
	canceled: { text: 'importRowSkipped', tone: 'neutral' }
};

/**
 * One uploaded file: what the server found in its rows, and importing or cancelling it. While
 * the server is still checking or importing, the page reads it again every two seconds.
 */
export class ImportPage extends Disposable implements PageView {
	private readonly read: PageRead<Import, AdministrationFailure, AdministrationResponse>;
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
				variant: 'secondary',
				label: format.text('importCancel'),
				icon: proctorIconFactory('action.end'),
				disabled: true
			})
		);
		this.commit = this._register(
			new ButtonControl(headerActions, {
				variant: 'brand',
				label: format.text('importCommitAll', { count: 0 }),
				icon: proctorIconFactory('action.confirm'),
				disabled: true
			})
		);
		this._register(this.commit.onDidRequest(() => this.confirmCommit()));
		this._register(this.cancel.onDidRequest(() => this.confirmCancel()));
		this.banner = this._register(new BannerControl(body));
		this.summary = this._register(
			instantiationService.createInstance(PageSection, body, {
				title: format.text('importSummary')
			})
		);
		this.rows = this._register(
			instantiationService.createInstance(PageSection, body, {
				title: format.text('importRows'),
				description: format.text('importRowsDescription')
			})
		);
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

	private render(): void {
		const data = this.read.data;
		const state = this.read.state;
		this.summary.setState(state, false, () => void this.read.refresh());
		// The rows' empty state is set once the problem rows are known, below.
		this.rows.setState(state, false, () => void this.read.refresh());
		this.schedule();
		const trail = [
			{
				label: this.format.text('importTrail'),
				open: () => this.navigation.selectAdministrationPage('imports')
			}
		];
		if (data === undefined) {
			this.pane.setHeading({
				title: this.format.text('importTitle'),
				description: '',
				trail
			});
			this.setButtons(undefined);
			return;
		}
		this.pane.setHeading({
			title: data.fileName ?? this.format.text(IMPORT_MODE_TEXT[data.mode]),
			description: this.format.text('importDescription', {
				rows: this.format.count(data.totalRows),
				when: this.format.relative(data.createdAt)
			}),
			trail,
			status: {
				text: this.format.text(IMPORT_STATE_TEXT[data.state]),
				tone:
					data.state === 'failed' || data.state === 'completed_with_errors'
						? 'failure'
						: data.state === 'preview_ready'
							? 'attention'
							: 'neutral'
			}
		});
		const done =
			data.state === 'completed' ||
			data.state === 'completed_with_errors' ||
			data.state === 'executing';
		renderDetails(this.summary.content, [
			{ label: this.format.text('importTotal'), value: this.format.count(data.totalRows) },
			...(done
				? [
						{
							label: this.format.text('importSucceeded'),
							value: this.format.count(data.succeededRows)
						},
						{
							label: this.format.text('importFailed'),
							value: this.format.count(data.failedRows)
						},
						{
							label: this.format.text('importSkipped'),
							value: this.format.count(data.skippedRows + data.noOpRows)
						}
					]
				: [
						{
							label: this.format.text('importReady'),
							value: this.format.count(data.validRows)
						},
						{
							label: this.format.text('importErrors'),
							value: this.format.count(data.invalidRows)
						}
					])
		]);
		const working =
			data.state === 'uploading' || data.state === 'parsing' || data.state === 'executing';
		if (working)
			this.banner.show({
				tone: 'info',
				text: this.format.text(
					data.state === 'executing' ? 'importImporting' : 'importChecking'
				),
				icon: proctorIconFactory('status.busy', 18)
			});
		else if (data.state === 'preview_ready' && data.invalidRows > 0)
			this.banner.show({
				tone: 'warning',
				text: this.format.text('importLeftOut', {
					count: this.format.count(data.invalidRows)
				}),
				icon: proctorIconFactory('status.attention', 18)
			});
		else this.banner.hide();
		const order = (row: Import['rows'][number]) =>
			row.status === 'invalid' || row.status === 'failed'
				? 0
				: row.status === 'valid' || row.status === 'succeeded'
					? 2
					: 1;
		const problems = [...data.rows]
			.filter(
				(row) =>
					row.status !== 'valid' && row.status !== 'pending' && row.status !== 'succeeded'
			)
			.sort((a, b) => order(a) - order(b) || a.row - b.row);
		this.rows.setRows(
			problems.map((row): PageRowModel => {
				const status = ROW_STATUS[row.status];
				return {
					id: String(row.row),
					glyph: 'object.file',
					title: this.format.text('importRow', {
						row: row.row,
						reference: row.reference
					}),
					detail: row.code ?? row.operation,
					status: {
						text: this.format.text(status.text),
						tone: status.tone
					}
				};
			})
		);
		if (problems.length === 0 && state.kind === 'ready')
			this.rows.setState(state, this.format.text('importRowsNone'));
		this.setButtons(data);
	}

	private setButtons(data: Import | undefined): void {
		const ready = data?.state === 'preview_ready' && data.validRows > 0;
		const count = data === undefined ? 0 : data.validRows;
		this.commit.setState({
			label:
				data !== undefined && data.invalidRows > 0
					? this.format.text('importCommitValid', { count: this.format.count(count) })
					: this.format.text('importCommitAll', { count: this.format.count(count) }),
			icon: proctorIconFactory('action.confirm'),
			disabled: !ready
		});
		this.commit.element.hidden = data !== undefined && data.state !== 'preview_ready';
		const cancellable =
			data?.state === 'preview_ready' ||
			data?.state === 'parsing' ||
			data?.state === 'executing';
		this.cancel.setState({
			label: this.format.text('importCancel'),
			icon: proctorIconFactory('action.end'),
			disabled: !cancellable
		});
		this.cancel.element.hidden = data !== undefined && !cancellable;
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
