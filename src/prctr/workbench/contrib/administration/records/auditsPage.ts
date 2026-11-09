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
const ACTION = /^[A-Za-z0-9][A-Za-z0-9_.:/-]{0,127}$/u;

/**
 * Everything that happened at the institution, newest first: who did what to which record and
 * whether the server allowed it. Reads are recorded too; they are hidden unless asked for, and
 * a page holding only reads says so rather than looking empty.
 */
export class AuditsPage extends Disposable implements PageView {
	private readonly list: AdminList<'audits'>;
	private readonly names = new Map<string, string>();
	private readonly filters: AdminFilters;
	private query: AdminListQuery<'audits'> = {};
	private everything = false;

	constructor(
		body: HTMLElement,
		_headerActions: HTMLElement,
		@IInstantiationService instantiationService: IInstantiationService,
		@IAdministrationService private readonly administration: IAdministrationService,
		@IAdministrationFormatService private readonly format: IAdministrationFormatService,
		@IAuthenticatedNavigationService navigation: IAuthenticatedNavigationService
	) {
		super();
		this.filters = this._register(new AdminFilters(body));
		this.filters.addSearch(format.text('auditsFind'), (action) => {
			this.query = action !== undefined && ACTION.test(action) ? { action } : {};
			this.list.setQuery(this.query);
		});
		this.filters.addSelect<'changes' | 'everything'>(
			format.text('auditsShow'),
			'action.filter',
			[
				{ value: 'changes', label: format.text('auditsChanges') },
				{ value: 'everything', label: format.text('auditsEverything') }
			],
			'changes',
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
						width: '40%',
						cell: (audit) => ({
							kind: 'text',
							primary: readableCode(audit.action),
							secondary: readableCode(audit.resourceType),
							strong: true
						})
					},
					{
						label: format.text('auditsActor'),
						width: '26%',
						cell: (audit) => ({
							kind: 'text',
							primary:
								audit.actorId === undefined
									? format.text('auditsSystem')
									: (this.names.get(audit.actorId) ??
										format.text('inviteLoading')),
							...(audit.ipAddress === undefined ? {} : { secondary: audit.ipAddress })
						})
					},
					{
						label: format.text('auditsOutcome'),
						width: '14%',
						cell: (audit) =>
							audit.status === 'success' || audit.status === 'succeeded'
								? {
										kind: 'status',
										text: format.text('overviewSucceeded'),
										tone: 'ok'
									}
								: {
										kind: 'status',
										text: format.text('overviewRefused'),
										tone: 'warn'
									}
					},
					{
						label: format.text('auditsWhen'),
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
				empty: format.text('auditsEmpty'),
				filteredEmpty: format.text('auditsNoMatch')
			})
		);
		this._register(
			this.list.onDidLoad((audits) => {
				this.updateNote();
				void this.loadNames(audits);
			})
		);
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
