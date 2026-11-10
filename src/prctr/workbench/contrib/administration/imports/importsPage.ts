/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { ButtonControl } from '../../../../base/browser/ui/button/buttonControl.js';
import { Disposable, MutableDisposable } from '../../../../base/common/lifecycle.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { proctorIconFactory } from '../../../../platform/theme/browser/proctorIcon.js';
import type { PageView } from '../../../browser/authenticated/pages/pagePane.js';
import { IAuthenticatedNavigationService } from '../../../services/authenticatedNavigation/common/authenticatedNavigation.js';
import { IAdministrationFormatService } from '../administrationFormat.js';
import { IMPORT_MODE_TEXT, IMPORT_STATE_TEXT } from './importText.js';
import { AdminList } from '../widgets/adminList.js';
import { UploadImportDialog } from './uploadImportDialog.js';

/** Every import file: what it adds, how many rows, and where it stands. Uploading opens a dialog. */
export class ImportsPage extends Disposable implements PageView {
	private readonly recent: AdminList<'onboardingImports'>;
	private readonly dialog = this._register(new MutableDisposable<UploadImportDialog>());

	constructor(
		body: HTMLElement,
		headerActions: HTMLElement,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@IAdministrationFormatService format: IAdministrationFormatService,
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
		this.recent = this._register(
			instantiationService.createInstance(
				AdminList<'onboardingImports'>,
				body,
				'onboardingImports',
				{},
				{
					title: format.text('importsRecent'),
					label: format.text('importsRecentTable'),
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
							width: '80px',
							align: 'end',
							priority: 3,
							foldLabel: true,
							cell: (item) => ({
								kind: 'text',
								primary: format.count(item.totalRows),
								mono: true
							})
						},
						{
							label: format.text('importsColumnUploaded'),
							width: '130px',
							align: 'end',
							priority: 2,
							cell: (item) => ({
								kind: 'text',
								primary: format.relativeStandalone(item.createdAt),
								mono: true,
								quiet: true
							})
						},
						{
							label: format.text('importsColumnStatus'),
							width: '170px',
							cell: (item) => ({
								kind: 'status',
								text: format.text(IMPORT_STATE_TEXT[item.state]),
								tone:
									item.state === 'failed' ||
									item.state === 'completed_with_errors'
										? 'fail'
										: item.state === 'completed'
											? 'ok'
											: item.state === 'preview_ready'
												? 'warn'
												: item.state === 'canceled'
													? 'neutral'
													: 'busy'
							})
						}
					],
					rowId: (item) => item.id,
					rowName: (item) => item.fileName ?? format.text('importsUnnamed'),
					open: (item) => navigation.selectAdministrationPage('import', item.id),
					icon: 'object.csv',
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
	}

	setVisible(visible: boolean): void {
		this.recent.setActive(visible);
	}

	private openUpload(): void {
		this.dialog.value = this.instantiationService.createInstance(UploadImportDialog);
	}
}
