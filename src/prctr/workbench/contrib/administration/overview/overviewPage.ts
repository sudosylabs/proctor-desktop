/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import type { PageView } from '../../../browser/authenticated/pages/pagePane.js';
import {
	PageSection,
	type PageRowModel
} from '../../../browser/authenticated/pages/pageSection.js';
import { PageStats, type PageStat } from '../../../browser/authenticated/pages/pageStats.js';
import { IAdministrationService } from '../../../services/administration/common/administration.js';
import { IAuthenticatedNavigationService } from '../../../services/authenticatedNavigation/common/authenticatedNavigation.js';
import { IAdministrationFormatService } from '../administrationFormat.js';
import { readOnce, readPages } from '../widgets/adminReads.js';

const RECENT_CHANGES = 5;
const DAY = 24 * 60 * 60 * 1000;
const WEEK = 7 * DAY;

/**
 * What needs an administrator now: four figures, then what waits for a decision (an import to
 * review, failed jobs, undelivered mail, paused cleanup), then the latest changes. A figure or
 * item the person may not read is left out rather than shown as an error.
 */
export class OverviewPage extends Disposable implements PageView {
	private readonly stats: PageStats;
	private readonly attention: PageSection;
	private readonly recent: PageSection;
	private sequence = 0;

	constructor(
		body: HTMLElement,
		_headerActions: HTMLElement,
		@IInstantiationService instantiationService: IInstantiationService,
		@IAdministrationService private readonly administration: IAdministrationService,
		@IAdministrationFormatService private readonly format: IAdministrationFormatService,
		@IAuthenticatedNavigationService
		private readonly navigation: IAuthenticatedNavigationService
	) {
		super();
		this.stats = this._register(new PageStats(body));
		this.stats.set(this.pendingStats());
		this.attention = this._register(
			instantiationService.createInstance(PageSection, body, {
				title: format.text('overviewAttention')
			})
		);
		this.recent = this._register(
			instantiationService.createInstance(PageSection, body, {
				title: format.text('overviewRecentChanges'),
				action: { label: format.text('overviewOpenAudits'), icon: 'action.continue' }
			})
		);
		this.recent.setAction(true);
		this._register(
			this.recent.onDidRequestAction(() => navigation.selectAdministrationPage('audits'))
		);
	}

	setVisible(visible: boolean): void {
		if (!visible) return;
		void this.loadStats();
		void this.load();
		void this.loadRecent();
	}

	/** The four figures before they are read: names only, the values drawn as placeholders. */
	private pendingStats(): PageStat[] {
		return [
			{ id: 'people', label: this.format.text('overviewPeople'), value: '' },
			{ id: 'invitations', label: this.format.text('overviewPending'), value: '' },
			{ id: 'jobs', label: this.format.text('overviewFailedJobsStat'), value: '' },
			{ id: 'mail', label: this.format.text('overviewBounced'), value: '' }
		];
	}

	private async loadStats(): Promise<void> {
		const now = this.format.now();
		const [everyone, students, staff, counts, pending, failed, bounced] = await Promise.all([
			readOnce(this.administration, { kind: 'users', limit: 10, includeDisabled: true }),
			readOnce(this.administration, { kind: 'users', limit: 10, affiliation: ['student'] }),
			readOnce(this.administration, { kind: 'users', limit: 10, affiliation: ['staff'] }),
			readOnce(this.administration, { kind: 'counts' }),
			readPages(this.administration, 'invitations', { state: 'pending' }, 50),
			readPages(this.administration, 'jobs', { status: ['failed'] }, 50),
			readOnce(this.administration, {
				kind: 'mailDeliveries',
				limit: 10,
				state: ['failed'],
				createdAfter: now - DAY
			})
		]);
		if (this._store.isDisposed) return;
		const stats: PageStat[] = [];
		if (everyone.kind === 'data' && everyone.value.total !== undefined) {
			const studentCount = students.kind === 'data' ? students.value.total : undefined;
			const staffCount = staff.kind === 'data' ? staff.value.total : undefined;
			stats.push({
				id: 'people',
				label: this.format.text('overviewPeople'),
				value: this.format.count(everyone.value.total),
				...(studentCount === undefined || staffCount === undefined
					? {}
					: {
							note: this.format.text(
								studentCount + staffCount > everyone.value.total
									? 'overviewPeopleSplitBoth'
									: 'overviewPeopleSplit',
								{
									students: this.format.count(studentCount),
									staff: this.format.count(staffCount)
								}
							)
						})
			});
		}
		const pendingCount = counts.kind === 'data' ? counts.value.pendingInvitations : undefined;
		if (pendingCount !== undefined) {
			const soon =
				pending.kind === 'data'
					? pending.value.items.filter((invitation) => invitation.expiresAt < now + WEEK)
							.length
					: 0;
			stats.push({
				id: 'invitations',
				label: this.format.text('overviewPending'),
				value: this.format.count(pendingCount.count) + (pendingCount.atLeast ? '+' : ''),
				...(soon === 0
					? {}
					: {
							note:
								soon === 1
									? this.format.text('overviewExpireWeekOne')
									: this.format.text('overviewExpireWeek', {
											count: this.format.count(soon)
										}),
							tone: 'attention' as const
						})
			});
		}
		const failedCount = counts.kind === 'data' ? counts.value.failedJobs : undefined;
		if (failedCount !== undefined) {
			const first =
				failed.kind === 'data' && failed.value.items.length > 0
					? Math.min(...failed.value.items.map((job) => job.updatedAt))
					: undefined;
			stats.push({
				id: 'jobs',
				label: this.format.text('overviewFailedJobsStat'),
				value: this.format.count(failedCount.count) + (failedCount.atLeast ? '+' : ''),
				...(first === undefined || failedCount.count === 0
					? {}
					: { note: this.since(first, now), tone: 'failure' as const })
			});
		}
		if (bounced.kind === 'data') {
			const count = bounced.value.total ?? bounced.value.items.length;
			stats.push({
				id: 'mail',
				label: this.format.text('overviewBounced'),
				value: this.format.count(count),
				note: this.format.text('overviewLastDay'),
				...(count > 0 ? { tone: 'failure' as const } : {})
			});
		}
		this.stats.set(stats);
		this.stats.element.hidden = stats.length === 0;
	}

	/** "Today, 08:40", "Yesterday, 17:20", or "28 Oct, 16:02" further back. */
	private when(time: number): string {
		const standalone = this.format.relativeStandalone(time);
		return standalone === this.format.shortDate(time) || standalone === this.format.date(time)
			? this.format.text('overviewDayTime', {
					date: this.format.shortDate(time),
					time: this.format.time(time)
				})
			: standalone;
	}

	/** "Since 09:12 today", or "Since 3 Nov" for an earlier day. */
	private since(time: number, now: number): string {
		const today = new Date(time).toDateString() === new Date(now).toDateString();
		return today
			? this.format.text('overviewSinceToday', { time: this.format.time(time) })
			: this.format.text('overviewSince', { date: this.format.shortDate(time) });
	}

	/** The latest changes, leaving out the reads the audit log also records. */
	private async loadRecent(): Promise<void> {
		if (this.recent.element.dataset.state !== 'ready')
			this.recent.setState({ kind: 'loading' }, false);
		const audits = await readPages(
			this.administration,
			'audits',
			{ auditKind: 'change' },
			RECENT_CHANGES
		);
		if (this._store.isDisposed) return;
		if (audits.kind === 'failure') {
			this.recent.setState(
				{ kind: 'failed', reason: audits.reason },
				false,
				audits.reason === 'noAccess' || audits.reason === 'denied'
					? undefined
					: () => void this.loadRecent()
			);
			return;
		}
		const changes = audits.value.items.slice(0, RECENT_CHANGES);
		this.recent.setState(
			{ kind: 'ready' },
			changes.length === 0 ? this.format.text('overviewRecentEmpty') : false
		);
		this.recent.setRows(
			changes.map((audit): PageRowModel => ({
				id: audit.id,
				title: audit.summary,
				...(audit.reason === undefined ? {} : { detail: audit.reason }),
				trailing: this.when(audit.createdAt)
			}))
		);
	}

	private async load(): Promise<void> {
		const serial = ++this.sequence;
		if (this.attention.element.dataset.state !== 'ready')
			this.attention.setState({ kind: 'loading' }, false);
		const many = this.format.text('overviewMany');
		const [imports, jobs, mail, control] = await Promise.all([
			readOnce(this.administration, {
				kind: 'onboardingImports',
				limit: 10,
				state: ['preview_ready']
			}),
			readOnce(this.administration, { kind: 'jobs', limit: 10, status: ['failed'] }),
			readOnce(this.administration, { kind: 'mailDeliveries', limit: 10, state: ['failed'] }),
			readOnce(this.administration, { kind: 'retentionControl' })
		]);
		if (this._store.isDisposed || serial !== this.sequence) return;
		const rows: PageRowModel[] = [];
		if (imports.kind === 'data')
			for (const item of imports.value.items)
				rows.push({
					id: `import-${item.id}`,
					glyph: 'admin.imports',
					glyphTone: 'attention',
					title: this.format.text('overviewImportReady', {
						name: item.fileName ?? this.format.text('importTitle')
					}),
					detail: this.format.text('overviewImportDetail', {
						rows: this.format.count(item.totalRows),
						when: this.format.relative(item.createdAt)
					}),
					button: {
						label: this.format.text('overviewReviewImport'),
						icon: 'action.continue',
						run: () => this.navigation.selectAdministrationPage('import', item.id)
					}
				});
		if (jobs.kind === 'data' && jobs.value.items.length > 0) {
			const count = jobs.value.items.length;
			const latest = Math.max(...jobs.value.items.map((job) => job.updatedAt));
			rows.push({
				id: 'jobs',
				glyph: 'status.failed',
				glyphTone: 'failure',
				title:
					jobs.value.cursor === undefined
						? this.format.counted('overviewJobsFailed', count)
						: this.format.text('overviewJobsFailed', { count: many }),
				detail: this.format.text('overviewJobsDetail', {
					when: this.format.relative(latest)
				}),
				button: {
					label: this.format.text('overviewOpenJobs'),
					icon: 'action.continue',
					run: () => this.open('jobs')
				}
			});
		}
		if (mail.kind === 'data' && mail.value.items.length > 0) {
			const count = mail.value.items.length;
			rows.push({
				id: 'mail',
				glyph: 'action.sendEmail',
				glyphTone: 'failure',
				title:
					mail.value.cursor === undefined
						? this.format.counted('overviewMailFailed', count)
						: this.format.text('overviewMailFailed', { count: many }),
				detail: this.format.text('overviewMailDetail', {
					recipient: mail.value.items[0]!.recipient
				}),
				button: {
					label: this.format.text('overviewOpenMail'),
					icon: 'action.continue',
					run: () => this.open('mail')
				}
			});
		}
		if (control.kind === 'data' && control.value.state === 'paused')
			rows.push({
				id: 'retention',
				glyph: 'action.disable',
				glyphTone: 'attention',
				title: this.format.text('overviewCleanupPaused'),
				detail: this.format.text('overviewCleanupDetail'),
				button: {
					label: this.format.text('overviewOpenRetention'),
					icon: 'action.continue',
					run: () => this.open('retention')
				}
			});
		this.attention.setState({ kind: 'ready' }, { text: this.format.text('overviewAllClear') });
		this.attention.setRows(rows);
		if (rows.length > 0) this.attention.setState({ kind: 'ready' }, false);
	}

	private open(page: 'jobs' | 'mail' | 'retention'): void {
		this.navigation.selectAdministrationPage(page);
	}
}
