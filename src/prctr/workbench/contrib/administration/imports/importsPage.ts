/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { ButtonControl } from '../../../../base/browser/ui/button/buttonControl.js';
import { Disposable, MutableDisposable } from '../../../../base/common/lifecycle.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { proctorIconFactory } from '../../../../platform/theme/browser/proctorIcon.js';
import type { PageView } from '../../../browser/authenticated/pages/pagePane.js';
import { IAuthenticatedNavigationService } from '../../../services/authenticatedNavigation/common/authenticatedNavigation.js';
import { IAdministrationFormatService, type AdministrationText } from '../administrationFormat.js';
import { IMPORT_MODE_TEXT, IMPORT_STATE_TEXT } from './importText.js';
import { AdminList, type AdminListItem, type AdminTone } from '../widgets/adminList.js';
import { PageFilters } from '../../../browser/authenticated/pages/pageFilters.js';
import type { importStates } from '../../../../platform/administration/common/administrationProtocol.js';
import { UploadImportDialog } from './uploadImportDialog.js';

type State = (typeof importStates)[number];
type Item = AdminListItem<'onboardingImports'>;

const ANY = 'any';
/** The status filter's words, each standing for the states it covers. */
const STATUS_GROUPS = {
	preview_ready: ['preview_ready'],
	checking: ['uploading', 'parsing'],
	executing: ['executing'],
	completed: ['completed', 'completed_with_errors'],
	failed: ['failed'],
	canceled: ['canceled']
} as const satisfies Record<string, readonly State[]>;
type StatusGroup = keyof typeof STATUS_GROUPS;
const STATUS_GROUP_TEXT: Readonly<Record<StatusGroup, AdministrationText>> = {
	preview_ready: 'importStateReady',
	checking: 'importStateParsing',
	executing: 'importStateExecuting',
	completed: 'importStateCompleted',
	failed: 'importStateFailed',
	canceled: 'importStateCanceled'
};

/**
 * Every import file the server keeps: what it adds, how many rows, when it was uploaded and
 * where it stands, with Review on the one waiting for a decision. Uploading opens a dialog.
 */
export class ImportsPage extends Disposable implements PageView {
	private readonly recent: AdminList<'onboardingImports'>;
	private readonly dialog = this._register(new MutableDisposable<UploadImportDialog>());

	constructor(
		body: HTMLElement,
		headerActions: HTMLElement,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@IAdministrationFormatService private readonly format: IAdministrationFormatService,
		@IAuthenticatedNavigationService navigation: IAuthenticatedNavigationService
	) {
		super();
		const start = this._register(
			new ButtonControl(headerActions, {
				variant: 'brand',
				label: format.text('importsUpload'),
				icon: proctorIconFactory('action.upload')
			})
		);
		this._register(start.onDidRequest(() => this.openUpload()));
		const filters = this._register(new PageFilters(body));
		filters.addSelect<StatusGroup | typeof ANY>(
			format.text('importsStatus'),
			'status.success',
			[
				{ value: ANY, label: format.text('importsAny') },
				...(Object.keys(STATUS_GROUPS) as StatusGroup[]).map((group) => ({
					value: group,
					label: format.text(STATUS_GROUP_TEXT[group])
				}))
			],
			ANY,
			(group) =>
				this.recent.setQuery(group === ANY ? {} : { state: [...STATUS_GROUPS[group]] })
		);
		const open = (item: Item): void => navigation.selectAdministrationPage('import', item.id);
		this.recent = this._register(
			instantiationService.createInstance(
				AdminList<'onboardingImports'>,
				body,
				'onboardingImports',
				{},
				{
					description: format.text('importsKept'),
					label: format.text('importsRecentTable'),
					filters,
					fixedPageSize: true,
					columns: [
						{
							label: format.text('importsColumnFile'),
							min: 220,
							cell: (item) => ({
								kind: 'text',
								primary: item.fileName ?? format.text('importsUnnamed'),
								secondary: format.text(IMPORT_MODE_TEXT[item.mode]),
								strong: true
							})
						},
						{
							label: format.text('importsColumnRows'),
							width: '72px',
							align: 'end',
							priority: 3,
							foldLabel: true,
							// A file that couldn't be read has no rows to count.
							cell: (item) =>
								item.state === 'failed' && item.totalRows === 0
									? { kind: 'text', primary: '—', mono: true, quiet: true }
									: {
											kind: 'text',
											primary: format.count(item.totalRows),
											mono: true
										}
						},
						{
							label: format.text('importsColumnUploaded'),
							width: '120px',
							align: 'end',
							priority: 2,
							sort: { key: 'uploaded', first: 'desc' },
							cell: (item) => ({
								kind: 'text',
								primary: this.when(item.createdAt),
								mono: true
							})
						},
						{
							label: format.text('importsColumnStatus'),
							width: '160px',
							cell: (item) => this.status(item)
						},
						{
							label: '',
							width: '96px',
							align: 'end',
							cell: (item) =>
								item.state === 'preview_ready'
									? {
											kind: 'button',
											label: format.text('importsReview'),
											icon: 'action.continue',
											run: () => open(item)
										}
									: { kind: 'empty' }
						}
					],
					rowId: (item) => item.id,
					sorting: {
						initial: { key: 'uploaded', dir: 'desc' },
						params: (sort) => ({ order: sort.dir })
					},
					rowName: (item) => item.fileName ?? format.text('importsUnnamed'),
					open,
					icon: 'object.csv',
					filteredEmpty: format.text('importsNoMatch'),
					empty: {
						title: format.text('importsRecentEmpty'),
						text: format.text('importsRecentEmptyText'),
						action: {
							label: format.text('importsUpload'),
							icon: 'action.upload',
							run: () => this.openUpload()
						}
					}
				}
			)
		);
		// An empty list offers Upload itself, so the heading doesn't repeat it.
		this._register(
			this.recent.onDidLoad((items) => {
				start.element.hidden = items.length === 0;
			})
		);
	}

	setVisible(visible: boolean): void {
		this.recent.setActive(visible);
	}

	/** "Today, 09:20" or "Yesterday, 17:20", then the day alone further back. */
	private when(time: number): string {
		const standalone = this.format.relativeStandalone(time);
		return standalone === this.format.shortDate(time) || standalone === this.format.date(time)
			? this.format.shortDate(time)
			: standalone;
	}

	/** Where the import stands, as one word in its tone. */
	private status(item: Item): { kind: 'status'; text: string; tone: AdminTone } {
		const missed = item.invalidRows + item.failedRows;
		switch (item.state) {
			case 'preview_ready':
				return { kind: 'status', text: this.text(item.state), tone: 'attention' };
			case 'uploading':
			case 'parsing':
			case 'executing':
				return { kind: 'status', text: this.text(item.state), tone: 'progress' };
			case 'completed':
			case 'completed_with_errors':
				return missed === 0
					? {
							kind: 'status',
							text: this.format.text('importStateCompleted'),
							tone: 'neutral'
						}
					: {
							kind: 'status',
							text: this.format.text('importsImportedMissed', {
								count: this.format.count(missed)
							}),
							tone: 'attention'
						};
			case 'failed':
				return {
					kind: 'status',
					text:
						item.failureCode === 'onboarding_import.file_invalid'
							? this.format.text('importsUnreadable')
							: this.text(item.state),
					tone: 'failure'
				};
			case 'canceled':
				return { kind: 'status', text: this.text(item.state), tone: 'neutral' };
		}
	}

	private text(state: State): string {
		return this.format.text(IMPORT_STATE_TEXT[state]);
	}

	private openUpload(): void {
		this.dialog.value = this.instantiationService.createInstance(UploadImportDialog);
	}
}
