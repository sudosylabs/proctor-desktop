/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import {
	Disposable,
	MutableDisposable,
	type IDisposable
} from '../../../../base/common/lifecycle.js';
import { jobStates } from '../../../../platform/administration/common/administrationProtocol.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import type { PageView } from '../../../browser/authenticated/pages/pagePane.js';
import { IPagePaneContext } from '../../../browser/authenticated/pages/pagePaneContext.js';
import type { PageRowAction } from '../../../browser/authenticated/pages/pageSection.js';
import { IAdministrationFormatService, type AdministrationText } from '../administrationFormat.js';
import { readableCode } from '../common/administrationPresentation.js';
import { AdminChanges, AdminConfirmation } from '../widgets/adminChanges.js';
import { AdminFilters } from '../widgets/adminFilters.js';
import { AdminList, type AdminListItem, type AdminTone } from '../widgets/adminList.js';

type Job = AdminListItem<'jobs'>;
type State = (typeof jobStates)[number];

export const JOB_STATE: Readonly<
	Record<State, { readonly text: AdministrationText; readonly tone: AdminTone }>
> = {
	queued: { text: 'jobQueued', tone: 'neutral' },
	running: { text: 'jobRunning', tone: 'neutral' },
	cancel_requested: { text: 'jobCancelRequested', tone: 'warn' },
	succeeded: { text: 'jobSucceeded', tone: 'ok' },
	failed: { text: 'jobFailed', tone: 'fail' },
	canceled: { text: 'jobCanceled', tone: 'neutral' }
};
const ANY = 'any';

/** Background work such as imports, previews and key rotation: following it, retrying, cancelling. */
export class JobsPage extends Disposable implements PageView {
	private readonly list: AdminList<'jobs'>;
	private readonly changes: AdminChanges;
	private readonly dialog = this._register(new MutableDisposable<IDisposable>());

	constructor(
		body: HTMLElement,
		_headerActions: HTMLElement,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@IAdministrationFormatService private readonly format: IAdministrationFormatService,
		@IPagePaneContext private readonly pane: IPagePaneContext
	) {
		super();
		this.changes = this._register(instantiationService.createInstance(AdminChanges));
		const filters = this._register(new AdminFilters(body));
		filters.addSelect<State | typeof ANY>(
			format.text('jobsStatus'),
			'status.success',
			[
				{ value: ANY, label: format.text('jobsAny') },
				...jobStates.map((state) => ({
					value: state,
					label: format.text(JOB_STATE[state].text)
				}))
			],
			ANY,
			(state) => this.list.setQuery(state === ANY ? {} : { status: [state] })
		);
		this.list = this._register(
			instantiationService.createInstance(
				AdminList<'jobs'>,
				body,
				'jobs',
				{},
				{
					label: format.text('jobsTable'),
					columns: [
						{
							label: format.text('jobsJob'),
							width: '34%',
							cell: (job) => ({
								kind: 'text',
								primary: readableCode(job.type),
								secondary: this.format.text('jobsAttempts', {
									attempt: job.attempts,
									maximum: job.maximumAttempts
								}),
								strong: true
							})
						},
						{
							label: format.text('jobsProgress'),
							width: '28%',
							cell: (job) => ({
								kind: 'text',
								primary:
									job.progress === undefined
										? job.errorCode === undefined
											? ''
											: readableCode(job.errorCode)
										: this.format.text('jobsStage', {
												stage: readableCode(job.progress.stage),
												current: this.format.count(job.progress.current),
												total: this.format.count(job.progress.total)
											})
							})
						},
						{
							label: format.text('jobsUpdated'),
							width: '18%',
							cell: (job) => ({
								kind: 'text',
								primary: format.relativeStandalone(job.updatedAt),
								mono: true
							})
						},
						{
							label: format.text('jobsStatusColumn'),
							cell: (job) => ({
								kind: 'status',
								text: format.text(JOB_STATE[job.status].text),
								tone: JOB_STATE[job.status].tone
							})
						}
					],
					rowId: (job) => job.id,
					rowName: (job) => readableCode(job.type),
					actions: (job) => this.actions(job),
					empty: format.text('jobsEmpty'),
					filteredEmpty: format.text('jobsNoMatch')
				}
			)
		);
	}

	setVisible(visible: boolean): void {
		this.list.setActive(visible);
	}

	private actions(job: Job): readonly PageRowAction[] {
		const actions: PageRowAction[] = [];
		if (job.status === 'failed' || job.status === 'canceled')
			actions.push({
				label: this.format.text('jobRetry'),
				icon: 'action.retry',
				run: () => void this.retry(job)
			});
		if (job.status === 'queued' || job.status === 'running')
			actions.push({
				label: this.format.text('jobCancel'),
				icon: 'action.end',
				destructive: true,
				run: () => this.cancel(job)
			});
		return actions;
	}

	private async retry(job: Job): Promise<void> {
		const result = await this.changes.send({ kind: 'retryJob', id: job.id }, [
			readableCode(job.type)
		]);
		if (this._store.isDisposed) return;
		if (result !== 'busy' && result.kind !== 'error')
			this.pane.toast(this.format.text('jobRetried'));
		else if (result === 'busy' || result.reason !== 'cancelled')
			this.pane.toast(this.changes.describe(result), { retry: () => void this.retry(job) });
		void this.list.refresh();
	}

	private cancel(job: Job): void {
		this.dialog.value = this.instantiationService.createInstance(
			AdminConfirmation,
			{
				title: this.format.text('jobCancelTitle'),
				message: this.format.text('jobCancelBody'),
				confirmLabel: this.format.text('jobCancelConfirm'),
				confirmIcon: 'action.end',
				destructive: true,
				run: () =>
					this.changes.send({ kind: 'cancelJob', id: job.id }, [readableCode(job.type)]),
				onDidComplete: (result) => {
					this.pane.toast(
						result.kind === 'error'
							? this.format.failure(result.reason)
							: this.format.text('jobCancelled')
					);
					void this.list.refresh();
				}
			},
			() => this.list.focusRow(job.id)
		);
	}
}
