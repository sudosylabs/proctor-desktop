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
import { IAuthenticatedNavigationService } from '../../../services/authenticatedNavigation/common/authenticatedNavigation.js';
import { IAdministrationFormatService, type AdministrationText } from '../administrationFormat.js';
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
	cancel_requested: { text: 'jobCancelRequested', tone: 'neutral' },
	succeeded: { text: 'jobSucceeded', tone: 'neutral' },
	failed: { text: 'jobFailed', tone: 'failure' },
	canceled: { text: 'jobCanceled', tone: 'neutral' }
};
const ANY = 'any';

/** A short duration, as in "48 s", "4 min" or "2 h". */
export function duration(format: IAdministrationFormatService, ms: number): string {
	const seconds = Math.max(0, Math.round(ms / 1000));
	if (seconds < 60) return format.text('durationSeconds', { count: format.count(seconds) });
	const minutes = Math.round(seconds / 60);
	if (minutes < 120) return format.text('durationMinutes', { count: format.count(minutes) });
	return format.text('durationHours', { count: format.count(Math.round(minutes / 60)) });
}

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
		@IPagePaneContext private readonly pane: IPagePaneContext,
		@IAuthenticatedNavigationService navigation: IAuthenticatedNavigationService
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
							min: 220,
							cell: (job) => ({
								kind: 'text',
								primary: format.code('jobType', job.type),
								secondary:
									job.subject ??
									(job.createdByName === undefined
										? ''
										: format.text('jobsStartedBy', {
												name: job.createdByName
											})),
								strong: true
							})
						},
						{
							label: format.text('jobsStarted'),
							width: '140px',
							align: 'end',
							priority: 2,
							cell: (job) => ({
								kind: 'text',
								primary:
									job.startedAt === undefined
										? format.text('jobsNotStarted')
										: format.relativeStandalone(job.startedAt),
								mono: true
							})
						},
						{
							label: format.text('jobsTook'),
							width: '80px',
							align: 'end',
							priority: 3,
							cell: (job) => ({
								kind: 'text',
								primary:
									job.startedAt === undefined
										? ''
										: job.completedAt === undefined
											? format.text('jobsStillRunning')
											: duration(format, job.completedAt - job.startedAt),
								mono: true
							})
						},
						{
							label: format.text('jobsAttemptsColumn'),
							width: '90px',
							align: 'end',
							priority: 3,
							cell: (job) => ({
								kind: 'text',
								primary: format.text('jobsAttemptsOf', {
									attempt: job.attempts,
									maximum: job.maximumAttempts
								}),
								mono: true
							})
						},
						{
							label: format.text('jobsStatusColumn'),
							width: '170px',
							cell: (job) => ({
								kind: 'status',
								text: format.text(JOB_STATE[job.status].text),
								tone: JOB_STATE[job.status].tone
							})
						},
						{
							label: '',
							width: '112px',
							align: 'end',
							cell: (job) =>
								job.status === 'failed' || job.status === 'canceled'
									? {
											kind: 'button',
											label: format.text('jobRetry'),
											icon: 'action.retry',
											run: () => void this.retry(job)
										}
									: job.status === 'queued' || job.status === 'running'
										? {
												kind: 'button',
												label: format.text('jobsCancelShort'),
												icon: 'action.close',
												run: () => this.cancel(job)
											}
										: { kind: 'empty' }
						}
					],
					open: (job) => navigation.selectAdministrationPage('job', job.id),
					rowId: (job) => job.id,
					rowName: (job) => format.code('jobType', job.type),
					icon: 'admin.jobs',
					empty: {
						title: format.text('jobsEmpty'),
						text: format.text('jobsEmptyText')
					},
					filteredEmpty: format.text('jobsNoMatch')
				}
			)
		);
	}

	setVisible(visible: boolean): void {
		this.list.setActive(visible);
	}

	private async retry(job: Job): Promise<void> {
		const result = await this.changes.send({ kind: 'retryJob', id: job.id }, [
			this.format.code('jobType', job.type)
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
					this.changes.send({ kind: 'cancelJob', id: job.id }, [
						this.format.code('jobType', job.type)
					]),
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
