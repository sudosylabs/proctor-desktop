/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { ButtonControl } from '../../../../base/browser/ui/button/buttonControl.js';
import {
	Disposable,
	MutableDisposable,
	type IDisposable
} from '../../../../base/common/lifecycle.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { proctorIconFactory } from '../../../../platform/theme/browser/proctorIcon.js';
import type { PageView } from '../../../browser/authenticated/pages/pagePane.js';
import { IPagePaneContext } from '../../../browser/authenticated/pages/pagePaneContext.js';
import { IAdministrationService } from '../../../services/administration/common/administration.js';
import { IAdministrationFormatService } from '../administrationFormat.js';
import { AdminChanges, AdminConfirmation } from '../widgets/adminChanges.js';
import { AdminFilters } from '../widgets/adminFilters.js';
import { AdminFormDialog, type AdminFormValues } from '../widgets/adminFormDialog.js';
import { AdminList, type AdminListItem, type AdminTone } from '../widgets/adminList.js';
import { readOnce, readUnitTree, unitLabel } from '../widgets/adminReads.js';

type Period = AdminListItem<'academicPeriods'>;

/** The terms and years classes belong to: found by name, created, edited and archived. */
export class PeriodsPage extends Disposable implements PageView {
	private readonly list: AdminList<'academicPeriods'>;
	private readonly changes: AdminChanges;
	private readonly dialog = this._register(new MutableDisposable<IDisposable>());
	private readonly unitNames = new Map<string, string>();

	constructor(
		body: HTMLElement,
		headerActions: HTMLElement,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@IAdministrationService private readonly administration: IAdministrationService,
		@IAdministrationFormatService private readonly format: IAdministrationFormatService,
		@IPagePaneContext private readonly pane: IPagePaneContext
	) {
		super();
		this.changes = this._register(instantiationService.createInstance(AdminChanges));
		const create = this._register(
			new ButtonControl(headerActions, {
				variant: 'brand',
				label: format.text('periodsNew'),
				icon: proctorIconFactory('action.add')
			})
		);
		this._register(create.onDidRequest(() => void this.edit(undefined)));
		const filters = this._register(new AdminFilters(body));
		filters.addSearch(format.text('periodsFind'), (q) =>
			this.list.setQuery(q === undefined ? {} : { q })
		);
		this.list = this._register(
			instantiationService.createInstance(
				AdminList<'academicPeriods'>,
				body,
				'academicPeriods',
				{},
				{
					label: format.text('periodsTable'),
					columns: [
						{
							label: format.text('periodsName'),
							width: '32%',
							cell: (period) => ({
								kind: 'text',
								primary: period.displayName,
								strong: true
							})
						},
						{
							label: format.text('periodsOwner'),
							width: '24%',
							cell: (period) => ({
								kind: 'text',
								primary:
									period.ownerType === 'institution'
										? format.text('periodsInstitution')
										: (this.unitNames.get(period.ownerId) ??
											format.text('userScopeUnit'))
							})
						},
						{
							label: format.text('periodsDates'),
							width: '26%',
							cell: (period) => ({
								kind: 'text',
								mono: true,
								primary: format.text('periodsDateRange', {
									start: format.date(period.startAt),
									end: format.date(period.endAt)
								})
							})
						},
						{
							label: format.text('periodsStatus'),
							cell: (period) => this.status(period)
						}
					],
					rowId: (period) => period.id,
					rowName: (period) => period.displayName,
					actions: (period) =>
						period.archivedAt !== undefined
							? []
							: [
									{
										label: this.format.text('structureEdit'),
										icon: 'action.edit',
										run: () => void this.edit(period)
									},
									{
										label: this.format.text('structureArchive'),
										icon: 'action.delete',
										destructive: true,
										run: () => this.archive(period)
									}
								],
					icon: 'admin.periods',
					empty: {
						title: format.text('periodsEmpty'),
						text: format.text('periodsEmptyText'),
						action: {
							label: format.text('periodsNew'),
							icon: 'action.add',
							run: () => void this.edit(undefined)
						}
					},
					filteredEmpty: format.text('periodsNoMatch')
				}
			)
		);
		void this.loadUnits();
	}

	setVisible(visible: boolean): void {
		this.list.setActive(visible);
	}

	private async loadUnits(): Promise<void> {
		const units = await readUnitTree(this.administration);
		if (this._store.isDisposed || units.kind === 'failure') return;
		for (const unit of units.value) this.unitNames.set(unit.id, unit.name);
		this.list.redraw();
	}

	private status(period: Period): { kind: 'status'; text: string; tone: AdminTone } {
		const now = this.format.now();
		if (period.archivedAt !== undefined)
			return {
				kind: 'status',
				text: this.format.text('periodsArchivedState'),
				tone: 'neutral'
			};
		if (period.startAt > now)
			return { kind: 'status', text: this.format.text('periodsUpcoming'), tone: 'neutral' };
		if (period.endAt < now)
			return { kind: 'status', text: this.format.text('periodsPast'), tone: 'neutral' };
		return { kind: 'status', text: this.format.text('periodsCurrent'), tone: 'neutral' };
	}

	private async edit(period: Period | undefined): Promise<void> {
		const [units, institution] = await Promise.all([
			readUnitTree(this.administration),
			readOnce(this.administration, { kind: 'institution' })
		]);
		if (this._store.isDisposed) return;
		const owners = [
			...(institution.kind === 'data'
				? [
						{
							value: `institution:${institution.value.id}`,
							label: this.format.text('periodsInstitution')
						}
					]
				: []),
			...(units.kind === 'data'
				? units.value.map((unit) => ({
						value: `academic_unit:${unit.id}`,
						label: unitLabel(unit)
					}))
				: [])
		];
		const dates = (values: AdminFormValues) => {
			const startAt = values.startAt as number | undefined;
			const endAt = values.endAt as number | undefined;
			return startAt !== undefined && endAt !== undefined && endAt <= startAt
				? undefined
				: { startAt, endAt };
		};
		const name = period?.displayName ?? '';
		this.dialog.value = this.instantiationService.createInstance(AdminFormDialog, {
			title:
				period === undefined
					? this.format.text('periodsNewTitle')
					: this.format.text('periodsEditTitle', { name }),
			confirmLabel: this.format.text(
				period === undefined ? 'structureCreate' : 'structureSave'
			),
			confirmIcon: period === undefined ? 'action.add' : 'action.confirm',
			fields: [
				{
					kind: 'text',
					id: 'displayName',
					label: this.format.text('structureDisplayName'),
					value: period?.displayName ?? '',
					required: true
				},
				{
					kind: 'text',
					id: 'name',
					label: this.format.text('structureName'),
					value: period?.name ?? '',
					required: true
				},
				...(period === undefined
					? [
							{
								kind: 'select' as const,
								id: 'owner',
								label: this.format.text('periodsOwnerField'),
								choices: owners,
								value: owners[0]?.value ?? ''
							}
						]
					: []),
				{
					kind: 'date',
					id: 'startAt',
					label: this.format.text('periodsStart'),
					required: true,
					...(period === undefined ? {} : { value: period.startAt })
				},
				{
					kind: 'date',
					id: 'endAt',
					label: this.format.text('periodsEnd'),
					required: true,
					...(period === undefined ? {} : { value: period.endAt })
				},
				{
					kind: 'longText',
					id: 'description',
					label: this.format.text('structureDescriptionField'),
					value: period?.description ?? ''
				}
			],
			submit: (values) => {
				const range = dates(values);
				if (range === undefined)
					return { field: 'endAt', error: this.format.text('userEndsBeforeStart') };
				const description = values.description as string | undefined;
				const naming = {
					name: values.name as string,
					displayName: values.displayName as string,
					...(description === undefined ? {} : { description })
				};
				if (period !== undefined)
					return {
						kind: 'updateAcademicPeriod',
						id: period.id,
						expectedRevision: period.revision,
						...naming,
						...(range.startAt === undefined ? {} : { startAt: range.startAt }),
						...(range.endAt === undefined ? {} : { endAt: range.endAt })
					};
				const [ownerType, ownerId] = String(values.owner ?? '').split(':');
				if (
					(ownerType !== 'institution' && ownerType !== 'academic_unit') ||
					ownerId === undefined
				)
					return { field: 'owner', error: this.format.text('fieldRequired') };
				return {
					kind: 'createAcademicPeriod',
					ownerType,
					ownerId,
					startAt: range.startAt!,
					endAt: range.endAt!,
					...naming
				};
			},
			summary: (values) => [String(values.displayName ?? '')],
			onDidComplete: (result) => {
				this.pane.toast(
					result.kind === 'error'
						? this.format.failure(result.reason)
						: this.format.text('structureSaved', {
								name: name || this.format.text('periodsTable')
							})
				);
				void this.list.refresh();
			}
		});
	}

	private archive(period: Period): void {
		const name = period.displayName;
		this.dialog.value = this.instantiationService.createInstance(
			AdminConfirmation,
			{
				title: this.format.text('structureArchiveTitle', { name }),
				message: this.format.text('structureArchiveBody'),
				confirmLabel: this.format.text('structureArchiveConfirm'),
				confirmIcon: 'action.delete',
				destructive: true,
				run: () =>
					this.changes.send(
						{
							kind: 'archiveAcademicPeriod',
							id: period.id,
							expectedRevision: period.revision
						},
						[name]
					),
				onDidComplete: (result) => {
					this.pane.toast(
						result.kind === 'error'
							? this.format.failure(result.reason)
							: this.format.text('structureArchived', { name })
					);
					void this.list.refresh();
				}
			},
			() => this.list.focusRow(period.id)
		);
	}
}
