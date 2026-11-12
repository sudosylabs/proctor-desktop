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
import { IAdministrationService } from '../../../services/administration/common/administration.js';
import { IAuthenticatedNavigationService } from '../../../services/authenticatedNavigation/common/authenticatedNavigation.js';
import { IAdministrationFormatService } from '../administrationFormat.js';
import { isReadAction } from '../common/administrationPresentation.js';
import { readOnce, readPages } from '../widgets/adminReads.js';

const RECENT_CHANGES = 5;

/**
 * What needs an administrator now: failed jobs, undelivered mail, invitations waiting and
 * paused cleanup, each from a read the server already offers, then the latest changes. An item
 * the person may not read is left out rather than shown as an error.
 */
export class OverviewPage extends Disposable implements PageView {
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
		this.attention = this._register(
			instantiationService.createInstance(PageSection, body, {
				title: format.text('overviewAttention')
			})
		);
		this.recent = this._register(
			instantiationService.createInstance(PageSection, body, {
				title: format.text('overviewRecent'),
				action: { label: format.text('overviewOpenAudits'), icon: 'action.forward' }
			})
		);
		this.recent.setAction(true);
		this._register(
			this.recent.onDidRequestAction(() => navigation.selectAdministrationPage('audits'))
		);
	}

	setVisible(visible: boolean): void {
		if (visible) {
			void this.load();
			void this.loadRecent();
		}
	}

	/** The latest changes, leaving out the reads the audit log also records. */
	private async loadRecent(): Promise<void> {
		if (this.recent.element.dataset.state !== 'ready')
			this.recent.setState({ kind: 'loading' }, false);
		const audits = await readPages(this.administration, 'audits', {}, 50);
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
		const changes = audits.value.items
			.filter((audit) => !isReadAction(audit.action))
			.slice(0, RECENT_CHANGES);
		this.recent.setState(
			{ kind: 'ready' },
			changes.length === 0 ? this.format.text('overviewRecentEmpty') : false
		);
		this.recent.setRows(
			changes.map((audit): PageRowModel => ({
				id: audit.id,
				glyph: 'admin.audits',
				title: audit.summary,
				detail: this.format.relative(audit.createdAt),
				status:
					audit.status === 'success' || audit.status === 'succeeded'
						? {
								text: this.format.text('overviewSucceeded'),
								tone: 'neutral'
							}
						: {
								text: this.format.text('overviewRefused'),
								tone: 'failure'
							}
			}))
		);
	}

	private async load(): Promise<void> {
		const serial = ++this.sequence;
		if (this.attention.element.dataset.state !== 'ready')
			this.attention.setState({ kind: 'loading' }, false);
		const many = this.format.text('overviewMany');
		const [jobs, mail, invitations, control] = await Promise.all([
			readOnce(this.administration, { kind: 'jobs', limit: 10, status: ['failed'] }),
			readOnce(this.administration, { kind: 'mailDeliveries', limit: 10, state: ['failed'] }),
			readOnce(this.administration, { kind: 'invitations', limit: 10, state: 'pending' }),
			readOnce(this.administration, { kind: 'retentionControl' })
		]);
		if (this._store.isDisposed || serial !== this.sequence) return;
		const rows: PageRowModel[] = [];
		if (jobs.kind === 'data' && jobs.value.items.length > 0) {
			const count = jobs.value.items.length;
			const latest = Math.max(...jobs.value.items.map((job) => job.updatedAt));
			rows.push({
				id: 'jobs',
				glyph: 'status.failed',
				title:
					count === 1 && jobs.value.cursor === undefined
						? this.format.text('overviewJobsFailedOne')
						: this.format.text('overviewJobsFailed', {
								count: jobs.value.cursor === undefined ? String(count) : many
							}),
				detail: this.format.text('overviewJobsDetail', {
					when: this.format.relative(latest)
				}),
				button: {
					label: this.format.text('overviewOpenJobs'),
					icon: 'action.forward',
					run: () => this.open('jobs')
				}
			});
		}
		if (mail.kind === 'data' && mail.value.items.length > 0) {
			const count = mail.value.items.length;
			rows.push({
				id: 'mail',
				glyph: 'action.sendEmail',
				title:
					count === 1 && mail.value.cursor === undefined
						? this.format.text('overviewMailFailedOne')
						: this.format.text('overviewMailFailed', {
								count: mail.value.cursor === undefined ? String(count) : many
							}),
				detail: this.format.text('overviewMailDetail', {
					recipient: mail.value.items[0]!.recipient
				}),
				button: {
					label: this.format.text('overviewOpenMail'),
					icon: 'action.forward',
					run: () => this.open('mail')
				}
			});
		}
		if (invitations.kind === 'data' && invitations.value.items.length > 0) {
			const count = invitations.value.items.length;
			const next = Math.min(
				...invitations.value.items.map((invitation) => invitation.expiresAt)
			);
			rows.push({
				id: 'invitations',
				glyph: 'admin.invitations',
				title:
					count === 1 && invitations.value.cursor === undefined
						? this.format.text('overviewInvitationsOne')
						: this.format.text('overviewInvitations', {
								count: invitations.value.cursor === undefined ? String(count) : many
							}),
				detail: this.format.text('overviewInvitationsDetail', {
					when: this.format.relative(next)
				}),
				button: {
					label: this.format.text('overviewOpenInvitations'),
					icon: 'action.forward',
					run: () => this.open('invitations')
				}
			});
		}
		if (control.kind === 'data' && control.value.state === 'paused')
			rows.push({
				id: 'retention',
				glyph: 'action.disable',
				title: this.format.text('overviewCleanupPaused'),
				detail: this.format.text('overviewCleanupDetail'),
				button: {
					label: this.format.text('overviewOpenRetention'),
					icon: 'action.forward',
					run: () => this.open('retention')
				}
			});
		this.attention.setState({ kind: 'ready' }, { text: this.format.text('overviewAllClear') });
		this.attention.setRows(rows);
		if (rows.length > 0) this.attention.setState({ kind: 'ready' }, false);
	}

	private open(page: 'jobs' | 'mail' | 'invitations' | 'retention'): void {
		this.navigation.selectAdministrationPage(page);
	}
}
