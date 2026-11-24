/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

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
	jobAttemptStates
} from '../../../../platform/administration/common/administrationProtocol.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { proctorIconFactory } from '../../../../platform/theme/browser/proctorIcon.js';
import type { PageView } from '../../../browser/authenticated/pages/pagePane.js';
import { IPagePaneContext } from '../../../browser/authenticated/pages/pagePaneContext.js';
import type { PageRead } from '../../../browser/authenticated/pages/pageRead.js';
import { PageSection } from '../../../browser/authenticated/pages/pageSection.js';
import { IAdministrationService } from '../../../services/administration/common/administration.js';
import { IAuthenticatedNavigationService } from '../../../services/authenticatedNavigation/common/authenticatedNavigation.js';
import { IAdministrationFormatService, type AdministrationText } from '../administrationFormat.js';
import { AdminChanges, AdminConfirmation } from '../widgets/adminChanges.js';
import { renderDetails } from '../../../browser/authenticated/pages/pageDetails.js';
import { AdminList, type AdminTone } from '../widgets/adminList.js';
import { adminRead } from '../widgets/adminReads.js';
import { JOB_STATE } from './jobsPage.js';

type Job = AdministrationValue<'job'>;
type AttemptState = (typeof jobAttemptStates)[number];

/** While a job is queued or running, its page reads it again this often. */
const WORKING_REFRESH_MS = 3_000;

const ATTEMPT_STATE: Readonly<
	Record<AttemptState, { readonly text: AdministrationText; readonly tone: AdminTone }>
> = {
	running: { text: 'attemptRunning', tone: 'neutral' },
	succeeded: { text: 'attemptSucceeded', tone: 'neutral' },
	failed: { text: 'attemptFailed', tone: 'failure' },
	canceled: { text: 'attemptCanceled', tone: 'neutral' },
	lease_expired: { text: 'attemptLeaseExpired', tone: 'attention' },
	incompatible: { text: 'attemptIncompatible', tone: 'attention' }
};

/**
 * One background job: what it is, who started it, how far it got and each attempt the workers
 * made, with Retry or Cancel. While it runs the page follows it.
 */
export class JobPage extends Disposable implements PageView {
	private readonly read: PageRead<Job, AdministrationFailure, AdministrationResponse>;
	private readonly details: PageSection;
	private readonly attempts: AdminList<'jobAttempts'>;
	private readonly retry: ButtonControl;
	private readonly cancel: ButtonControl;
	private readonly changes: AdminChanges;
	private readonly dialog = this._register(new MutableDisposable<IDisposable>());
	private readonly poll = this._register(new MutableDisposable());
	private visible = false;

	constructor(
		body: HTMLElement,
		headerActions: HTMLElement,
		jobId: string,
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
				label: format.text('jobsCancelShort')
			})
		);
		this.retry = this._register(
			new ButtonControl(headerActions, {
				variant: 'brand',
				label: format.text('jobRetry'),
				icon: proctorIconFactory('action.retry')
			})
		);
		this.cancel.element.hidden = true;
		this.retry.element.hidden = true;
		this._register(this.retry.onDidRequest(() => void this.sendRetry()));
		this._register(this.cancel.onDidRequest(() => this.confirmCancel()));
		this.details = this._register(
			instantiationService.createInstance(PageSection, body, {
				title: format.text('jobDetails')
			})
		);
		this.attempts = this._register(
			instantiationService.createInstance(
				AdminList<'jobAttempts'>,
				body,
				'jobAttempts',
				{ jobId },
				{
					title: format.text('jobAttempts'),
					description: format.text('jobAttemptsDescription'),
					label: format.text('jobAttempts'),
					columns: [
						{
							label: format.text('jobAttemptNumber'),
							width: '84px',
							align: 'end',
							cell: (attempt) => ({
								kind: 'text',
								primary: format.count(attempt.number),
								mono: true
							})
						},
						{
							label: format.text('jobAttemptStarted'),
							width: '120px',
							align: 'end',
							cell: (attempt) => ({
								kind: 'text',
								primary: format.relativeStandalone(attempt.startedAt),
								mono: true
							})
						},
						{
							label: format.text('jobAttemptEnded'),
							width: '120px',
							align: 'end',
							priority: 2,
							cell: (attempt) => ({
								kind: 'text',
								primary:
									attempt.completedAt === undefined
										? ''
										: format.relativeStandalone(attempt.completedAt),
								mono: true
							})
						},
						{
							label: format.text('jobAttemptOutcome'),
							width: '120px',
							cell: (attempt) => ({
								kind: 'status',
								text: format.text(ATTEMPT_STATE[attempt.status].text),
								tone: ATTEMPT_STATE[attempt.status].tone
							})
						},
						{
							label: format.text('jobAttemptError'),
							min: 200,
							priority: 3,
							wrap: true,
							cell: (attempt) => ({
								kind: 'text',
								primary:
									attempt.errorCode === undefined
										? ''
										: format.code('problem', attempt.errorCode),
								quiet: true
							})
						}
					],
					rowId: (attempt) => attempt.id,
					rowName: (attempt) => format.count(attempt.number),
					empty: format.text('jobAttemptsEmpty')
				}
			)
		);
		this.read = this._register(adminRead(administration, { kind: 'job', id: jobId }));
		this._register(this.read.onDidChange(() => this.render()));
		this.render();
	}

	setVisible(visible: boolean): void {
		this.visible = visible;
		this.read.setActive(visible);
		this.attempts.setActive(visible);
		this.schedule();
	}

	private schedule(): void {
		const status = this.read.data?.status;
		const working =
			status === 'queued' || status === 'running' || status === 'cancel_requested';
		if (!this.visible || !working) {
			this.poll.clear();
			return;
		}
		if (this.poll.value !== undefined) return;
		const timer = setInterval(() => {
			void this.read.refresh();
			void this.attempts.refresh();
		}, WORKING_REFRESH_MS);
		this.poll.value = toDisposable(() => clearInterval(timer));
	}

	private render(): void {
		const job = this.read.data;
		this.details.setState(this.read.state, false, () => void this.read.refresh());
		this.schedule();
		const trail = [
			{
				label: this.format.text('jobTrail'),
				open: () => this.navigation.selectAdministrationPage('jobs')
			}
		];
		if (job === undefined) {
			this.pane.setHeading({ title: this.format.text('jobTitle'), description: '', trail });
			this.retry.element.hidden = true;
			this.cancel.element.hidden = true;
			return;
		}
		const state = JOB_STATE[job.status];
		const attempts = this.format.text('jobAttemptsUsed', {
			attempt: job.attempts,
			maximum: job.maximumAttempts
		});
		const when = this.format.relative(job.startedAt ?? job.createdAt);
		this.pane.setHeading({
			title: this.format.code('jobType', job.type),
			description:
				job.createdByName === undefined
					? this.format.text('jobDescription', { when, attempts })
					: this.format.text('jobDescriptionBy', {
							name: job.createdByName,
							when,
							attempts
						}),
			trail,
			status: {
				text: this.format.text(state.text),
				tone: state.tone
			}
		});
		const none = this.format.text('jobNone');
		renderDetails(this.details.content, [
			{ label: this.format.text('jobKind'), value: this.format.code('jobType', job.type) },
			...(job.subject === undefined
				? []
				: [{ label: this.format.text('jobAbout'), value: job.subject }]),
			{
				label: this.format.text('jobStartedAt'),
				value:
					job.startedAt === undefined
						? this.format.text('jobsNotStarted')
						: this.format.relativeStandalone(job.startedAt)
			},
			{
				label: this.format.text('jobUpdatedAt'),
				value: this.format.relativeStandalone(job.updatedAt)
			},
			{
				label: this.format.text('jobProgressLabel'),
				value:
					job.progress === undefined
						? none
						: this.format.text('jobsStage', {
								stage: this.format.code('jobStage', job.progress.stage),
								current: this.format.count(job.progress.current),
								total: this.format.count(job.progress.total)
							}),
				empty: job.progress === undefined
			},
			{
				label: this.format.text('jobLastError'),
				value:
					job.errorCode === undefined ? none : this.format.code('problem', job.errorCode),
				empty: job.errorCode === undefined
			}
		]);
		this.retry.element.hidden = job.status !== 'failed' && job.status !== 'canceled';
		this.cancel.element.hidden = job.status !== 'queued' && job.status !== 'running';
	}

	private async sendRetry(): Promise<void> {
		const job = this.read.data;
		if (job === undefined) return;
		const result = await this.changes.send({ kind: 'retryJob', id: job.id }, [
			this.format.code('jobType', job.type)
		]);
		if (this._store.isDisposed) return;
		if (result !== 'busy' && result.kind !== 'error')
			this.pane.toast(this.format.text('jobRetried'));
		else if (result === 'busy' || result.reason !== 'cancelled')
			this.pane.toast(this.changes.describe(result), { retry: () => void this.sendRetry() });
		void this.read.refresh();
		void this.attempts.refresh();
	}

	private confirmCancel(): void {
		const job = this.read.data;
		if (job === undefined) return;
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
					void this.read.refresh();
				}
			},
			() => this.cancel.focus()
		);
	}
}
