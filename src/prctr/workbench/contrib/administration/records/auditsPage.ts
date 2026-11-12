/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import type { PageView } from '../../../browser/authenticated/pages/pagePane.js';
import { IAdministrationService } from '../../../services/administration/common/administration.js';
import { IAuthenticatedNavigationService } from '../../../services/authenticatedNavigation/common/authenticatedNavigation.js';
import { IAdministrationFormatService } from '../administrationFormat.js';
import { isReadAction, readableCode } from '../common/administrationPresentation.js';
import { AdminFilters } from '../widgets/adminFilters.js';
import { AdminList, type AdminListItem, type AdminListQuery } from '../widgets/adminList.js';
import { readOnce } from '../widgets/adminReads.js';

type Audit = AdminListItem<'audits'>;
type Period = 'day' | 'week' | 'month' | 'any';
const DAY = 24 * 60 * 60 * 1000;

/** The audit query for events in the chosen period up to now. */
function since(period: Period, now: number): AdminListQuery<'audits'> {
	if (period === 'any') return {};
	const days = period === 'day' ? 1 : period === 'week' ? 7 : 30;
	return { createdAfter: now - days * DAY };
}

/**
 * Everything that happened at the institution, newest first: who did what to which record and
 * whether the server allowed it. Reads are recorded too; they can be hidden, and
 * a page holding only reads says so rather than looking empty.
 */
export class AuditsPage extends Disposable implements PageView {
	private readonly list: AdminList<'audits'>;
	private readonly names = new Map<string, string>();
	private readonly filters: AdminFilters;
	private query: AdminListQuery<'audits'>;
	private everything = true;

	constructor(
		body: HTMLElement,
		_headerActions: HTMLElement,
		@IInstantiationService instantiationService: IInstantiationService,
		@IAdministrationService private readonly administration: IAdministrationService,
		@IAdministrationFormatService private readonly format: IAdministrationFormatService,
		@IAuthenticatedNavigationService navigation: IAuthenticatedNavigationService
	) {
		super();
		this.query = since('week', format.now());
		this.filters = this._register(new AdminFilters(body));
		this.filters.addSelect<Period>(
			format.text('auditsPeriod'),
			'object.calendar',
			[
				{ value: 'week', label: format.text('auditsPeriodWeek') },
				{ value: 'day', label: format.text('auditsPeriodDay') },
				{ value: 'month', label: format.text('auditsPeriodMonth') },
				{ value: 'any', label: format.text('auditsPeriodAny') }
			],
			'week',
			(period) => {
				this.query = since(period, format.now());
				this.list.setQuery(this.query);
			}
		);
		this.filters.addSelect<'changes' | 'everything'>(
			format.text('auditsShow'),
			'action.filter',
			[
				{ value: 'everything', label: format.text('auditsEverything') },
				{ value: 'changes', label: format.text('auditsChanges') }
			],
			'everything',
			(choice) => {
				this.everything = choice === 'everything';
				this.list.redraw();
				this.updateNote();
			}
		);
		this.list = this._register(
			instantiationService.createInstance(AdminList<'audits'>, body, 'audits', this.query, {
				label: format.text('auditsTable'),
				columns: [
					{
						label: format.text('auditsEvent'),
						min: 240,
						cell: (audit) => ({
							kind: 'text',
							primary: readableCode(audit.action),
							secondary:
								audit.reason === undefined
									? readableCode(audit.resourceType)
									: format.text('auditsReason', { reason: audit.reason }),
							strong: true
						})
					},
					{
						label: format.text('auditsActor'),
						width: '20%',
						foldLabel: true,
						cell: (audit) => ({
							kind: 'text',
							primary:
								audit.actorId === undefined
									? format.text('auditsSystem')
									: (this.names.get(audit.actorId) ??
										format.text('inviteLoading'))
						})
					},
					{
						label: format.text('auditsWhere'),
						width: '22%',
						priority: 3,
						cell: (audit) => ({
							kind: 'text',
							primary: this.client(audit.client),
							secondary: audit.ipAddress ?? '',
							quiet: true
						})
					},
					{
						label: format.text('auditsOutcome'),
						width: '120px',
						priority: 2,
						cell: (audit) =>
							audit.status === 'success' || audit.status === 'succeeded'
								? {
										kind: 'status',
										text: format.text('overviewSucceeded'),
										tone: 'neutral'
									}
								: {
										kind: 'status',
										text: format.text('overviewRefused'),
										tone: 'failure'
									}
					},
					{
						label: format.text('auditsWhen'),
						width: '140px',
						align: 'end',
						cell: (audit) => ({
							kind: 'text',
							primary: format.relativeStandalone(audit.createdAt),
							mono: true
						})
					}
				],
				rowId: (audit) => audit.id,
				rowName: (audit) => readableCode(audit.action),
				hidden: (audit) => !this.everything && isReadAction(audit.action),
				actions: (audit) =>
					audit.actorId === undefined
						? []
						: [
								{
									label: format.text('userOpen'),
									icon: 'action.openExternal',
									run: () =>
										navigation.selectAdministrationPage('user', audit.actorId!)
								}
							],
				icon: 'admin.audits',
				empty: {
					title: format.text('auditsEmpty'),
					text: format.text('auditsEmptyText')
				},
				filteredEmpty: {
					title: format.text('auditsNoMatch'),
					text: format.text('auditsNoMatchText')
				}
			})
		);
		this._register(
			this.list.onDidLoad((audits) => {
				this.updateNote();
				void this.loadNames(audits);
			})
		);
	}

	private client(client: string | undefined): string {
		switch (client) {
			case 'desktop':
				return this.format.text('clientDesktop');
			case 'web':
				return this.format.text('clientBrowser');
			case 'cli':
				return this.format.text('clientCommandLine');
			default:
				return client === undefined ? '' : readableCode(client);
		}
	}

	setVisible(visible: boolean): void {
		this.list.setActive(visible);
	}

	private updateNote(): void {
		const rows = this.list.rows;
		const onlyReads =
			!this.everything &&
			rows.length > 0 &&
			rows.every((audit) => isReadAction(audit.action));
		this.filters.setNote(onlyReads ? this.format.text('auditsPageReads') : '');
	}

	private async loadNames(audits: readonly Audit[]): Promise<void> {
		const missing = [
			...new Set(
				audits.flatMap((audit) => (audit.actorId === undefined ? [] : [audit.actorId]))
			)
		].filter((id) => !this.names.has(id));
		if (missing.length === 0) return;
		const users = await Promise.all(
			missing.map((id) => readOnce(this.administration, { kind: 'user', id }))
		);
		if (this._store.isDisposed) return;
		missing.forEach((id, index) => {
			const user = users[index]!;
			this.names.set(
				id,
				user.kind === 'data'
					? user.value.displayName
					: this.format.text('classUnknownPerson')
			);
		});
		this.list.redraw();
	}
}
