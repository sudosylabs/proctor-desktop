/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { createElementFactory } from '../../../../base/browser/documentElements.js';
import { ButtonControl } from '../../../../base/browser/ui/button/buttonControl.js';
import {
	Disposable,
	MutableDisposable,
	type IDisposable
} from '../../../../base/common/lifecycle.js';
import type {
	AdministrationChangeIntent,
	AdministrationValue
} from '../../../../platform/administration/common/administrationProtocol.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { proctorIconFactory } from '../../../../platform/theme/browser/proctorIcon.js';
import type { PageView } from '../../../browser/authenticated/pages/pagePane.js';
import { IPagePaneContext } from '../../../browser/authenticated/pages/pagePaneContext.js';
import {
	PageSection,
	type PageRowAction,
	type PageRowModel
} from '../../../browser/authenticated/pages/pageSection.js';
import { IAdministrationService } from '../../../services/administration/common/administration.js';
import { IAuthenticatedNavigationService } from '../../../services/authenticatedNavigation/common/authenticatedNavigation.js';
import { IAdministrationFormatService } from '../administrationFormat.js';
import { AdminChanges, AdminConfirmation } from '../widgets/adminChanges.js';
import { renderDetails } from '../widgets/adminDetails.js';
import {
	AdminFormDialog,
	type AdminFormField,
	type AdminFormValues
} from '../widgets/adminFormDialog.js';
import { AdminList } from '../widgets/adminList.js';
import { AdminMenuButton } from '../widgets/adminMenuButton.js';
import { readPages } from '../widgets/adminReads.js';
import { UnitTree, type AdminUnit } from './unitTree.js';
import './media/structurePage.css';

type Programme = AdministrationValue<'unitProgrammes'>['items'][number];
type Level = AdministrationValue<'programmeLevels'>['items'][number];

/** A short name is an identifier-like label; the server checks it, this only trims it. */
function naming(values: AdminFormValues): {
	readonly name: string;
	readonly displayName: string;
	readonly description?: string;
} {
	const description = values.description as string | undefined;
	return {
		name: values.name as string,
		displayName: values.displayName as string,
		...(description === undefined ? {} : { description })
	};
}

/**
 * How the institution is organised: academic units as a tree, and for the chosen unit its
 * details, programmes with their levels, and its classes. Creating, renaming and archiving each
 * is one change the server may refuse; archiving refuses while something remains inside.
 */
export class StructurePage extends Disposable implements PageView {
	private readonly tree: UnitTree;
	private readonly treeNote: HTMLElement;
	private readonly details: PageSection;
	private readonly programmes: PageSection;
	private readonly levels: PageSection;
	private readonly classes = this._register(new MutableDisposable<AdminList<'unitClasses'>>());
	private readonly classesHost: HTMLElement;
	private readonly classAction = this._register(new MutableDisposable());
	private readonly menu: AdminMenuButton;
	private readonly changes: AdminChanges;
	private readonly dialog = this._register(new MutableDisposable<IDisposable>());
	private unit: AdminUnit | undefined;
	private programmeList: readonly Programme[] = [];
	private programme: Programme | undefined;
	private levelsByProgramme = new Map<string, readonly Level[]>();
	private periodNames = new Map<string, string>();
	private periodChoices: readonly { readonly value: string; readonly label: string }[] = [];
	private visible = false;
	private sequence = 0;

	constructor(
		body: HTMLElement,
		headerActions: HTMLElement,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@IAdministrationService private readonly administration: IAdministrationService,
		@IAdministrationFormatService private readonly format: IAdministrationFormatService,
		@IAuthenticatedNavigationService
		private readonly navigation: IAuthenticatedNavigationService,
		@IPagePaneContext private readonly pane: IPagePaneContext
	) {
		super();
		this.changes = this._register(instantiationService.createInstance(AdminChanges));
		const periods = this._register(
			new ButtonControl(headerActions, {
				variant: 'secondary',
				label: format.text('structurePeriods'),
				icon: proctorIconFactory('admin.periods')
			})
		);
		this._register(periods.onDidRequest(() => navigation.selectAdministrationPage('periods')));
		this.menu = this._register(
			new AdminMenuButton(
				headerActions,
				format.text('classMore'),
				() => this.unitActions(),
				pane
			)
		);
		this.menu.element.hidden = true;

		const $ = createElementFactory(body.ownerDocument);
		const aside = $('aside.prctr-admin-structure__aside', {
			attrs: { 'aria-label': format.text('structureUnits') }
		});
		const asideHeader = $(
			'div.prctr-admin-structure__aside-header',
			{},
			$('span.prctr-admin-structure__aside-title', {
				textContent: format.text('structureUnits')
			})
		);
		aside.append(asideHeader);
		const newUnit = this._register(
			new ButtonControl(asideHeader, {
				variant: 'ghost',
				size: 'small',
				label: format.text('structureNewUnit'),
				icon: proctorIconFactory('action.add', 14)
			})
		);
		this._register(newUnit.onDidRequest(() => this.createUnit(undefined)));
		this.tree = this._register(
			new UnitTree(aside, format.text('structureUnits'), administration)
		);
		this.treeNote = $('p.prctr-admin-structure__aside-note', { hidden: true });
		aside.append(this.treeNote);
		const main = $('div.prctr-admin-structure__main');
		body.append($('div.prctr-admin-structure', {}, aside, main));

		this.details = this._register(
			instantiationService.createInstance(PageSection, main, {
				title: format.text('structureChooseUnit'),
				action: { label: format.text('structureAddSubUnit'), icon: 'action.add' }
			})
		);
		this.details.setState({ kind: 'ready' }, false);
		this._register(
			this.details.onDidRequestAction(
				() => this.unit !== undefined && this.createUnit(this.unit)
			)
		);
		this.programmes = this._register(
			instantiationService.createInstance(PageSection, main, {
				title: format.text('structureProgrammes'),
				action: { label: format.text('structureNewProgramme'), icon: 'action.add' }
			})
		);
		this._register(this.programmes.onDidRequestAction(() => this.createProgramme()));
		this.levels = this._register(
			instantiationService.createInstance(PageSection, main, {
				title: '',
				action: { label: format.text('structureNewLevel'), icon: 'action.add' }
			})
		);
		this._register(this.levels.onDidRequestAction(() => this.createLevel()));
		this.classesHost = $('div');
		main.append(this.classesHost);
		this._register(this.tree.onDidSelect((unit) => void this.showUnit(unit)));
		void this.showUnit(undefined);
	}

	setVisible(visible: boolean): void {
		const first = visible && !this.visible;
		this.visible = visible;
		this.classes.value?.setActive(visible);
		if (first) void this.loadTree();
	}

	private async loadTree(): Promise<void> {
		this.treeNote.hidden = true;
		const [result, periods] = await Promise.all([
			this.tree.load(),
			readPages(this.administration, 'academicPeriods', {}, 100)
		]);
		if (this._store.isDisposed) return;
		if (periods.kind === 'data') {
			const live = periods.value.items.filter((period) => period.archivedAt === undefined);
			this.periodNames = new Map(
				periods.value.items.map((period) => [period.id, period.displayName])
			);
			this.periodChoices = live.map((period) => ({
				value: period.id,
				label: period.displayName
			}));
		}
		if (result === 'empty') this.note(this.format.text('structureNoUnits'));
		else if (result !== 'ready') this.note(this.format.failure(result.failure));
		else if (this.unit === undefined) {
			const first = this.tree.element.querySelector<HTMLElement>('[role="treeitem"]');
			if (first?.dataset.unitId !== undefined) this.tree.select(first.dataset.unitId);
		}
	}

	private note(text: string): void {
		this.treeNote.textContent = text;
		this.treeNote.hidden = false;
	}

	// #region The chosen unit

	private async showUnit(unit: AdminUnit | undefined): Promise<void> {
		const serial = ++this.sequence;
		this.unit = unit;
		this.programme = undefined;
		const chosen = unit !== undefined;
		this.programmes.hidden = !chosen;
		this.levels.hidden = true;
		this.classesHost.hidden = !chosen;
		this.details.setAction(chosen);
		this.menu.element.hidden = !chosen;
		if (unit === undefined) {
			this.details.setHeading(this.format.text('structureChooseUnit'));
			this.details.content.replaceChildren();
			this.classes.clear();
			return;
		}
		this.details.setHeading(unit.displayName, unit.description || undefined);
		renderDetails(this.details.content, [
			{ label: this.format.text('structureKind'), value: unit.name },
			{
				label: this.format.text('structurePartOf'),
				value:
					unit.parentId === undefined
						? this.format.text('structureTopLevel')
						: (this.tree.element.querySelector<HTMLElement>(
								`[data-unit-id="${CSS.escape(unit.parentId)}"]`
							)?.textContent ?? this.format.text('userScopeUnit'))
			}
		]);
		this.classes.value = this.instantiationService.createInstance(
			AdminList<'unitClasses'>,
			this.classesHost,
			'unitClasses',
			{ unitId: unit.id },
			{
				title: this.format.text('structureClasses'),
				label: this.format.text('structureClasses'),
				action: { label: this.format.text('structureNewClass'), icon: 'action.add' },
				columns: [
					{
						label: this.format.text('structureClassColumn'),
						width: '40%',
						cell: (klass) => ({
							kind: 'text',
							primary: klass.displayName,
							secondary: klass.name,
							strong: true
						})
					},
					{
						label: this.format.text('structureLevelColumn'),
						width: '30%',
						cell: (klass) => ({ kind: 'text', primary: this.levelName(klass.levelId) })
					},
					{
						label: this.format.text('structurePeriodColumn'),
						cell: (klass) => ({
							kind: 'text',
							primary: this.periodNames.get(klass.academicPeriodId) ?? ''
						})
					}
				],
				rowId: (klass) => klass.id,
				rowName: (klass) => klass.displayName,
				open: (klass) => this.navigation.selectAdministrationPage('class', klass.id),
				actions: (klass) => [
					{
						label: this.format.text('userOpen'),
						icon: 'action.openExternal',
						run: () => this.navigation.selectAdministrationPage('class', klass.id)
					},
					{
						label: this.format.text('structureArchive'),
						icon: 'action.delete',
						destructive: true,
						run: () =>
							this.archive(
								klass.displayName,
								{
									kind: 'archiveClass',
									id: klass.id,
									expectedRevision: klass.revision
								},
								() => void this.classes.value?.refresh()
							)
					}
				],
				empty: this.format.text('structureClassesEmpty')
			}
		);
		this.classAction.value = this.classes.value.onDidRequestAction(() => this.createClass());
		this.classes.value.setActive(this.visible);
		await this.loadProgrammes(serial);
	}

	/** The chosen unit's less common actions, in the page header's menu. */
	private unitActions(): readonly PageRowAction[] {
		const unit = this.unit;
		if (unit === undefined) return [];
		return [
			{
				label: this.format.text('structureEdit'),
				icon: 'action.edit',
				run: () => this.editUnit(unit)
			},
			{
				label: this.format.text('structureArchiveUnit'),
				icon: 'action.delete',
				destructive: true,
				run: () =>
					this.archive(
						unit.displayName,
						{ kind: 'archiveUnit', id: unit.id, expectedRevision: unit.revision },
						() => {
							void this.tree.reloadChildren(unit.parentId);
							void this.showUnit(undefined);
						}
					)
			}
		];
	}

	private async loadProgrammes(serial = this.sequence): Promise<void> {
		const unit = this.unit;
		if (unit === undefined) return;
		this.programmes.setState({ kind: 'loading' }, false);
		const programmes = await readPages(
			this.administration,
			'unitProgrammes',
			{ unitId: unit.id },
			100
		);
		if (this._store.isDisposed || serial !== this.sequence) return;
		if (programmes.kind === 'failure') {
			this.programmes.setState(
				{ kind: 'failed', reason: programmes.reason },
				false,
				() => void this.loadProgrammes()
			);
			return;
		}
		this.programmeList = programmes.value.items.filter(
			(programme) => programme.archivedAt === undefined
		);
		const levels = await Promise.all(
			this.programmeList.map((programme) =>
				readPages(
					this.administration,
					'programmeLevels',
					{ programmeId: programme.id },
					100
				)
			)
		);
		if (this._store.isDisposed || serial !== this.sequence) return;
		this.levelsByProgramme = new Map(
			this.programmeList.map((programme, index) => {
				const result = levels[index]!;
				return [
					programme.id,
					result.kind === 'data'
						? result.value.items.filter((level) => level.archivedAt === undefined)
						: []
				];
			})
		);
		this.renderProgrammes();
		void this.classes.value?.refresh();
	}

	private renderProgrammes(): void {
		this.programmes.setState(
			{ kind: 'ready' },
			this.programmeList.length === 0 ? this.format.text('structureProgrammesEmpty') : false
		);
		this.programmes.setRows(
			this.programmeList.map((programme): PageRowModel => {
				const levels = this.levelsByProgramme.get(programme.id) ?? [];
				return {
					id: programme.id,
					glyph: 'object.class',
					title: programme.displayName,
					detail:
						levels.length === 0
							? this.format.text('structureNoLevels')
							: this.format.text('structureLevelsOf', {
									levels: levels.map((level) => level.displayName).join(', ')
								}),
					button: {
						label: this.format.text('structureLevels'),
						icon: 'action.forward',
						run: () => this.showLevels(programme)
					},
					actions: [
						{
							label: this.format.text('structureRename'),
							icon: 'action.edit',
							run: () => this.rename(programme, 'updateProgramme')
						},
						{
							label: this.format.text('structureArchive'),
							icon: 'action.delete',
							destructive: true,
							run: () =>
								this.archive(
									programme.displayName,
									{
										kind: 'archiveProgramme',
										id: programme.id,
										expectedRevision: programme.revision
									},
									() => void this.loadProgrammes()
								)
						}
					]
				};
			})
		);
		if (this.programme !== undefined)
			this.showLevels(this.programmeList.find((p) => p.id === this.programme!.id));
	}

	private showLevels(programme: Programme | undefined): void {
		this.programme = programme;
		this.levels.hidden = programme === undefined;
		if (programme === undefined) return;
		const levels = this.levelsByProgramme.get(programme.id) ?? [];
		this.levels.setHeading(
			this.format.text('structureLevelsTitle', { programme: programme.displayName })
		);
		this.levels.setAction(true);
		this.levels.setState(
			{ kind: 'ready' },
			levels.length === 0 ? this.format.text('structureLevelsEmpty') : false
		);
		this.levels.setRows(
			levels.map((level): PageRowModel => ({
				id: level.id,
				glyph: 'admin.structure',
				title: level.displayName,
				detail: level.description || level.name,
				actions: [
					{
						label: this.format.text('structureRename'),
						icon: 'action.edit',
						run: () => this.rename(level, 'updateLevel')
					},
					{
						label: this.format.text('structureArchive'),
						icon: 'action.delete',
						destructive: true,
						run: () =>
							this.archive(
								level.displayName,
								{
									kind: 'archiveLevel',
									id: level.id,
									expectedRevision: level.revision
								},
								() => void this.loadProgrammes()
							)
					}
				]
			}))
		);
		this.levels.focusHeading();
	}

	private levelName(levelId: string): string {
		for (const [programmeId, levels] of this.levelsByProgramme) {
			const level = levels.find((candidate) => candidate.id === levelId);
			if (level !== undefined) {
				const programme = this.programmeList.find(
					(candidate) => candidate.id === programmeId
				);
				return programme === undefined
					? level.displayName
					: this.format.join(programme.displayName, level.displayName);
			}
		}
		return '';
	}

	// #endregion

	// #region Changes

	private namingFields(current?: {
		readonly name: string;
		readonly displayName: string;
		readonly description: string;
	}): AdminFormField[] {
		return [
			{
				kind: 'text',
				id: 'displayName',
				label: this.format.text('structureDisplayName'),
				value: current?.displayName ?? '',
				required: true
			},
			{
				kind: 'text',
				id: 'name',
				label: this.format.text('structureName'),
				value: current?.name ?? '',
				required: true
			},
			{
				kind: 'longText',
				id: 'description',
				label: this.format.text('structureDescriptionField'),
				value: current?.description ?? ''
			}
		];
	}

	private form(
		title: string,
		confirm: 'structureCreate' | 'structureSave',
		fields: readonly AdminFormField[],
		submit: (values: AdminFormValues) => AdministrationChangeIntent,
		after: () => void
	): void {
		this.dialog.value = this.instantiationService.createInstance(AdminFormDialog, {
			title,
			fields,
			confirmLabel: this.format.text(confirm),
			confirmIcon: confirm === 'structureCreate' ? 'action.add' : 'action.confirm',
			submit,
			summary: (values) => [String(values.displayName ?? title)],
			onDidComplete: (result) => {
				this.pane.toast(
					result.kind === 'error'
						? this.format.failure(result.reason)
						: this.format.text('structureSaved', { name: title })
				);
				after();
			}
		});
	}

	private createUnit(parent: AdminUnit | undefined): void {
		this.form(
			parent === undefined
				? this.format.text('structureNewUnitTitle')
				: this.format.text('structureSubUnitTitle', { name: parent.displayName }),
			'structureCreate',
			this.namingFields(),
			(values) =>
				parent === undefined
					? { kind: 'createRootUnit', ...naming(values) }
					: { kind: 'createChildUnit', parentId: parent.id, ...naming(values) },
			() => void this.tree.reloadChildren(parent?.id)
		);
	}

	private editUnit(unit: AdminUnit): void {
		this.form(
			this.format.text('structureEditUnitTitle', { name: unit.displayName }),
			'structureSave',
			this.namingFields(unit),
			(values) => ({
				kind: 'updateUnit',
				id: unit.id,
				expectedRevision: unit.revision,
				...naming(values)
			}),
			() => void this.tree.reloadChildren(unit.parentId).then(() => this.tree.select(unit.id))
		);
	}

	private createProgramme(): void {
		const unit = this.unit;
		if (unit === undefined) return;
		this.form(
			this.format.text('structureNewProgrammeTitle', { name: unit.displayName }),
			'structureCreate',
			this.namingFields(),
			(values) => ({ kind: 'createProgramme', unitId: unit.id, ...naming(values) }),
			() => void this.loadProgrammes()
		);
	}

	private createLevel(): void {
		const programme = this.programme;
		if (programme === undefined) return;
		this.form(
			this.format.text('structureNewLevelTitle', { name: programme.displayName }),
			'structureCreate',
			this.namingFields(),
			(values) => ({ kind: 'createLevel', programmeId: programme.id, ...naming(values) }),
			() => void this.loadProgrammes()
		);
	}

	private rename(record: Programme | Level, kind: 'updateProgramme' | 'updateLevel'): void {
		this.form(
			this.format.text('structureRenameTitle', { name: record.displayName }),
			'structureSave',
			this.namingFields(record),
			(values) => ({
				kind,
				id: record.id,
				expectedRevision: record.revision,
				...naming(values)
			}),
			() => void this.loadProgrammes()
		);
	}

	private createClass(): void {
		const unit = this.unit;
		if (unit === undefined) return;
		const levels = this.programmeList.flatMap((programme) =>
			(this.levelsByProgramme.get(programme.id) ?? []).map((level) => ({
				value: level.id,
				label: this.format.join(programme.displayName, level.displayName)
			}))
		);
		if (levels.length === 0 || this.periodChoices.length === 0) {
			this.pane.toast(this.format.text('structureNeedsLevel'));
			return;
		}
		this.form(
			this.format.text('structureNewClassTitle', { name: unit.displayName }),
			'structureCreate',
			[
				...this.namingFields(),
				{
					kind: 'select',
					id: 'levelId',
					label: this.format.text('structureLevel'),
					choices: levels,
					value: levels[0]!.value
				},
				{
					kind: 'select',
					id: 'academicPeriodId',
					label: this.format.text('structurePeriod'),
					choices: this.periodChoices,
					value: this.periodChoices[0]!.value
				}
			],
			(values) => ({
				kind: 'createClass',
				levelId: values.levelId as string,
				academicPeriodId: values.academicPeriodId as string,
				...naming(values)
			}),
			() => void this.classes.value?.refresh()
		);
	}

	private archive(name: string, intent: AdministrationChangeIntent, after: () => void): void {
		this.dialog.value = this.instantiationService.createInstance(
			AdminConfirmation,
			{
				title: this.format.text('structureArchiveTitle', { name }),
				message: this.format.text('structureArchiveBody'),
				confirmLabel: this.format.text('structureArchiveConfirm'),
				confirmIcon: 'action.delete',
				destructive: true,
				run: () => this.changes.send(intent, [name]),
				onDidComplete: (result) => {
					this.pane.toast(
						result.kind === 'error'
							? this.format.failure(result.reason)
							: this.format.text('structureArchived', { name })
					);
					after();
				}
			},
			() => this.pane.focusPage()
		);
	}

	// #endregion
}
