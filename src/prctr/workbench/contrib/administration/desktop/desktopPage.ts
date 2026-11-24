/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { ButtonControl } from '../../../../base/browser/ui/button/buttonControl.js';
import {
	Disposable,
	MutableDisposable,
	type IDisposable
} from '../../../../base/common/lifecycle.js';
import type { AdministrationValue } from '../../../../platform/administration/common/administrationProtocol.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { proctorIconFactory } from '../../../../platform/theme/browser/proctorIcon.js';
import { renderDetails } from '../../../browser/authenticated/pages/pageDetails.js';
import type { PageView } from '../../../browser/authenticated/pages/pagePane.js';
import { IPagePaneContext } from '../../../browser/authenticated/pages/pagePaneContext.js';
import type { ServerRead } from '../../../browser/authenticated/pages/serverRead.js';
import { PageSection } from '../../../browser/authenticated/pages/pageSection.js';
import { PageTable } from '../../../browser/authenticated/pages/pageTable.js';
import { IServerDataService } from '../../../services/serverData/common/serverData.js';
import { IAdministrationFormatService } from '../administrationFormat.js';
import { AdminFormDialog } from '../widgets/adminFormDialog.js';
import { administrationRead } from '../widgets/adminReads.js';

type Desktop = AdministrationValue<'desktopCompatibility'>;
type Build = Desktop['revokedBuilds'][number];

/**
 * Which releases of Proctor Desktop may connect, and whether exams are open on Desktop: its
 * availability, the oldest release allowed, and the builds blocked with the reason each was.
 */
export class DesktopPage extends Disposable implements PageView {
	private readonly desktop: ServerRead<'administration', Desktop>;
	private readonly availability: PageSection;
	private readonly releases: PageSection;
	private readonly blocked: PageSection;
	private readonly builds: PageTable<Build>;
	private readonly change: ButtonControl;
	private readonly dialog = this._register(new MutableDisposable<IDisposable>());

	constructor(
		body: HTMLElement,
		headerActions: HTMLElement,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@IServerDataService serverData: IServerDataService,
		@IAdministrationFormatService private readonly format: IAdministrationFormatService,
		@IPagePaneContext private readonly pane: IPagePaneContext
	) {
		super();
		this.change = this._register(
			new ButtonControl(headerActions, {
				variant: 'secondary',
				label: format.text('policyDesktopEdit'),
				icon: proctorIconFactory('action.edit')
			})
		);
		this._register(this.change.onDidRequest(() => this.edit()));
		const section = (title: string, description?: string, plain = false) =>
			this._register(
				instantiationService.createInstance(PageSection, body, {
					title,
					...(description === undefined ? {} : { description }),
					plain
				})
			);
		this.availability = section(format.text('desktopAvailability'));
		this.releases = section(format.text('desktopReleases'));
		this.blocked = section(
			format.text('desktopBlocked'),
			format.text('desktopBlockedNote'),
			true
		);
		this.builds = this._register(
			new PageTable<Build>(this.blocked.content, {
				label: format.text('desktopBlocked'),
				rowId: (build) => build.buildId,
				pageSize: 20,
				labels: {
					previous: format.text('pagerPrevious'),
					next: format.text('pagerNext'),
					showing: (first, last, total) =>
						format.text('listShowing', {
							range: format.pagerLabels('').range(first, last, total, false)
						})
				},
				columns: [
					{
						label: format.text('desktopBuild'),
						cell: (build) => ({
							kind: 'text',
							primary: build.buildId,
							strong: true,
							mono: true
						})
					},
					{
						label: format.text('desktopWhy'),
						width: '280px',
						cell: (build) => ({ kind: 'text', primary: build.reason, wrap: true })
					}
				]
			})
		);
		this.desktop = this._register(
			administrationRead(serverData, { kind: 'desktopCompatibility' })
		);
		this._register(this.desktop.onDidChange(() => this.render()));
		this.render();
	}

	setVisible(visible: boolean): void {
		this.desktop.setActive(visible);
	}

	private render(): void {
		const desktop = this.desktop.data;
		const retry = () => void this.desktop.refresh();
		this.availability.setState(this.desktop.state, false, retry);
		this.releases.setState(this.desktop.state, false, retry);
		this.change.element.hidden = desktop === undefined;
		this.blocked.element.hidden = desktop === undefined;
		if (desktop === undefined) return;
		const none = this.format.text('policyNone');
		const maintenance = desktop.availability === 'maintenance';
		renderDetails(this.availability.content, [
			{
				label: this.format.text('desktopExams'),
				value: this.format.text(maintenance ? 'policyMaintenance' : 'desktopOpen'),
				...(maintenance
					? {
							note: {
								text: this.format.text('desktopNoNewExams'),
								tone: 'attention' as const
							}
						}
					: {})
			},
			...(maintenance
				? [
						{
							label: this.format.text('desktopMessage'),
							value: desktop.message || none,
							empty: desktop.message === ''
						}
					]
				: [])
		]);
		renderDetails(this.releases.content, [
			{
				label: this.format.text('desktopOldest'),
				value: desktop.minimumRelease || this.format.text('desktopAnyRelease'),
				empty: desktop.minimumRelease === ''
			}
		]);
		this.blocked.setState(
			{ kind: 'ready' },
			desktop.revokedBuilds.length === 0 ? this.format.text('desktopNoneBlocked') : false
		);
		this.builds.setItems(desktop.revokedBuilds);
		this.builds.element.hidden = desktop.revokedBuilds.length === 0;
	}

	private edit(): void {
		const desktop = this.desktop.data;
		if (desktop === undefined) return;
		this.dialog.value = this.instantiationService.createInstance(AdminFormDialog, {
			title: this.format.text('policyDesktopEditTitle'),
			confirmLabel: this.format.text('structureSave'),
			confirmIcon: 'action.confirm',
			fields: [
				{
					kind: 'select',
					id: 'availability',
					label: this.format.text('policyAvailability'),
					value: desktop.availability,
					choices: [
						{ value: 'ready', label: this.format.text('policyAvailable') },
						{ value: 'maintenance', label: this.format.text('policyMaintenance') }
					]
				},
				{
					kind: 'text',
					id: 'minimumRelease',
					label: this.format.text('policyMinimum'),
					value: desktop.minimumRelease,
					required: true
				},
				{
					kind: 'longText',
					id: 'message',
					label: this.format.text('policyMessage'),
					value: desktop.message
				},
				{
					kind: 'longText',
					id: 'revoked',
					label: this.format.text('policyRevoked'),
					value: desktop.revokedBuilds.map((build) => build.buildId).join('\n'),
					hint: this.format.text('policyRevokedHint')
				},
				{
					kind: 'text',
					id: 'revokedReason',
					label: this.format.text('policyRevokedReason'),
					hint: this.format.text('policyRevokedReasonHint')
				}
			],
			submit: (values) => {
				// A build already blocked keeps its reason; the reason field covers new ones.
				const kept = new Map(
					desktop.revokedBuilds.map((build) => [build.buildId, build.reason])
				);
				const reason = values.revokedReason as string | undefined;
				const ids = [
					...new Set(
						String(values.revoked ?? '')
							.split(/\s+/u)
							.filter((build) => build !== '')
					)
				];
				if (reason === undefined && ids.some((id) => !kept.has(id)))
					return {
						field: 'revokedReason',
						error: this.format.text('policyRevokedReasonRequired')
					};
				return {
					kind: 'replaceDesktopCompatibility',
					expectedRevision: desktop.revision,
					availability: values.availability === 'maintenance' ? 'maintenance' : 'ready',
					minimumRelease: values.minimumRelease as string,
					message: (values.message as string | undefined) ?? '',
					revokedBuilds: ids.map((buildId) => ({
						buildId,
						reason: kept.get(buildId) ?? reason ?? ''
					}))
				};
			},
			summary: () => [this.format.text('policyDesktopEditTitle')],
			onDidComplete: (result) => {
				this.pane.toast(
					result.kind === 'error'
						? this.format.failure(result.reason)
						: this.format.text('policyDesktopSaved')
				);
				void this.desktop.refresh();
			}
		});
	}
}
