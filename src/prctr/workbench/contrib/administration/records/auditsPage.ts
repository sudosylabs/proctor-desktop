/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import type { PageView } from '../../../browser/authenticated/pages/pagePane.js';
import { IAuthenticatedNavigationService } from '../../../services/authenticatedNavigation/common/authenticatedNavigation.js';
import { IAdministrationFormatService } from '../administrationFormat.js';
import { readableCode } from '../common/administrationPresentation.js';
import { PageFilters } from '../../../browser/authenticated/pages/pageFilters.js';
import { AdminList, type AdminListQuery } from '../widgets/adminList.js';
import { AdminPersonFilter } from '../widgets/adminPersonFilter.js';
import { auditEventActions, auditEventKinds, type AuditEventKind } from '../common/auditEvents.js';
import type { AdministrationText } from '../administrationFormat.js';

const EVENT_TEXT: Readonly<Record<AuditEventKind, AdministrationText>> = {
	signIn: 'auditsEventSignIn',
	people: 'auditsEventPeople',
	access: 'auditsEventAccess',
	structure: 'auditsEventStructure',
	exams: 'auditsEventExams',
	records: 'auditsEventRecords'
};

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
 * whether the server allowed it. Reads are recorded too; the page starts with changes only.
 */
export class AuditsPage extends Disposable implements PageView {
	private readonly list: AdminList<'audits'>;
	private readonly filters: PageFilters;
	private query: AdminListQuery<'audits'>;

	constructor(
		body: HTMLElement,
		_headerActions: HTMLElement,
		@IInstantiationService instantiationService: IInstantiationService,
		@IAdministrationFormatService private readonly format: IAdministrationFormatService,
		@IAuthenticatedNavigationService navigation: IAuthenticatedNavigationService
	) {
		super();
		this.query = { ...since('week', format.now()), auditKind: 'change' };
		this.filters = this._register(new PageFilters(body));
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
				// Only the period changes; the other filters stay.
				const { createdAfter: _after, ...rest } = this.query;
				this.query = { ...rest, ...since(period, format.now()) };
				this.list.setQuery(this.query);
			}
		);
		this.filters.addSelect<'changes' | 'everything'>(
			format.text('auditsShow'),
			'action.filter',
			[
				{ value: 'changes', label: format.text('auditsChanges') },
				{ value: 'everything', label: format.text('auditsEverything') }
			],
			'changes',
			(choice) => {
				const { auditKind: _kind, ...rest } = this.query;
				this.query = choice === 'everything' ? rest : { ...rest, auditKind: 'change' };
				this.list.setQuery(this.query);
			}
		);
		// Event narrows to one kind of change, By to who did it, About to whom it happened.
		this.filters.addSelect<AuditEventKind | 'any'>(
			format.text('auditsEventFilter'),
			'action.filter',
			[
				{ value: 'any', label: format.text('auditsEventAny') },
				...auditEventKinds.map((kind) => ({
					value: kind,
					label: format.text(EVENT_TEXT[kind])
				}))
			],
			'any',
			(kind) => {
				const { actions: _actions, ...rest } = this.query;
				this.query =
					kind === 'any' ? rest : { ...rest, actions: [...auditEventActions[kind]] };
				this.list.setQuery(this.query);
			}
		);
		this._register(
			instantiationService.createInstance(AdminPersonFilter, this.filters.addSlot(), {
				label: format.text('auditsBy'),
				anyone: format.text('auditsAnyone'),
				icon: 'admin.users',
				onChange: (person) => {
					const { actorId: _actorId, ...rest } = this.query;
					this.query = person === undefined ? rest : { ...rest, actorId: person.id };
					this.list.setQuery(this.query);
				}
			})
		);
		this._register(
			instantiationService.createInstance(AdminPersonFilter, this.filters.addSlot(), {
				label: format.text('auditsAbout'),
				anyone: format.text('auditsAnyone'),
				icon: 'object.student',
				onChange: (person) => {
					const { subjectUserId: _subject, ...rest } = this.query;
					this.query =
						person === undefined ? rest : { ...rest, subjectUserId: person.id };
					this.list.setQuery(this.query);
				}
			})
		);
		this.filters.addSelect<'any' | 'success' | 'fail'>(
			format.text('auditsOutcome'),
			'status.success',
			[
				{ value: 'any', label: format.text('auditsOutcomeAny') },
				{ value: 'success', label: format.text('overviewSucceeded') },
				{ value: 'fail', label: format.text('overviewRefused') }
			],
			'any',
			(outcome) => {
				const { status: _status, ...rest } = this.query;
				this.query = outcome === 'any' ? rest : { ...rest, status: outcome };
				this.list.setQuery(this.query);
			}
		);
		this.list = this._register(
			instantiationService.createInstance(AdminList<'audits'>, body, 'audits', this.query, {
				label: format.text('auditsTable'),
				filters: this.filters,
				columns: [
					{
						label: format.text('auditsEvent'),
						min: 240,
						wrap: true,
						// The server writes each event as a sentence naming who did what; the line
						// under it is the reason they gave, red when the attempt failed.
						cell: (audit) => {
							const failed =
								audit.status !== 'success' && audit.status !== 'succeeded';
							return {
								kind: 'text',
								primary: audit.summary,
								secondary: audit.reason ?? '',
								strong: true,
								...(failed ? { secondaryTone: 'fail' as const } : {})
							};
						}
					},
					{
						label: format.text('auditsWhere'),
						width: '160px',
						priority: 3,
						cell: (audit) => ({
							kind: 'text',
							primary: this.client(audit.client),
							secondary: audit.ipAddress ?? '',
							quiet: true
						})
					},
					{
						label: format.text('auditsWhen'),
						width: '120px',
						align: 'end',
						sort: { key: 'when', first: 'desc' },
						cell: (audit) => ({
							kind: 'text',
							primary: this.when(audit.createdAt),
							mono: true
						})
					}
				],
				description: format.text('auditsNote'),
				rowId: (audit) => audit.id,
				rowName: (audit) => audit.summary,
				sorting: {
					initial: { key: 'when', dir: 'desc' },
					params: (sort) => ({ order: sort.dir })
				},
				dateJump: (endOfDay) => ({ createdBefore: endOfDay }),
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
	}

	/** "Today, 08:40", "Yesterday, 17:02", or "5 Nov, 10:05" further back. */
	private when(time: number): string {
		const standalone = this.format.relativeStandalone(time);
		return standalone === this.format.shortDate(time) || standalone === this.format.date(time)
			? this.format.text('overviewDayTime', {
					date: this.format.shortDate(time),
					time: this.format.time(time)
				})
			: standalone;
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
}
