/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { ButtonControl } from '../../../../base/browser/ui/button/buttonControl.js';
import { Disposable, MutableDisposable } from '../../../../base/common/lifecycle.js';
import type { importStates } from '../../../../platform/administration/common/administrationProtocol.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { proctorIconFactory } from '../../../../platform/theme/browser/proctorIcon.js';
import type { PageView } from '../../../browser/authenticated/pages/pagePane.js';
import { IAuthenticatedNavigationService } from '../../../services/authenticatedNavigation/common/authenticatedNavigation.js';
import { IAdministrationFormatService, type AdministrationText } from '../administrationFormat.js';
import { AdminList, type AdminListItem, type AdminTone } from '../widgets/adminList.js';
import { NewProgressionDialog } from './newProgressionDialog.js';

type Progression = AdminListItem<'studentProgressions'>;
type State = (typeof importStates)[number];

export const PROGRESSION_STATE: Readonly<
	Record<
		State,
		{
			readonly text: AdministrationText;
			readonly tone: AdminTone;
		}
	>
> = {
	uploading: { text: 'stateChecking', tone: 'neutral' },
	parsing: { text: 'stateChecking', tone: 'neutral' },
	preview_ready: { text: 'stateReady', tone: 'attention' },
	executing: { text: 'stateMoving', tone: 'neutral' },
	completed: { text: 'stateMoved', tone: 'neutral' },
	completed_with_errors: { text: 'stateMovedWithProblems', tone: 'failure' },
	canceled: { text: 'stateCancelled', tone: 'neutral' },
	failed: { text: 'stateFailed', tone: 'failure' }
};

/** "Programming 1 → Programming 2", from the names the server gives. */
export function progressionName(
	format: IAdministrationFormatService,
	progression: {
		readonly sourceClassName?: string;
		readonly destinationClassName?: string;
	}
): string {
	const unknown = format.text('progressionUnknownClass');
	return format.text('progressionPair', {
		source: progression.sourceClassName ?? unknown,
		destination: progression.destinationClassName ?? unknown
	});
}

/** Every progression: the classes it moves students between, when, and where it stands. */
export class ProgressionPage extends Disposable implements PageView {
	private readonly list: AdminList<'studentProgressions'>;
	private readonly dialog = this._register(new MutableDisposable<NewProgressionDialog>());

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
				label: format.text('progressionNew'),
				icon: proctorIconFactory('action.add')
			})
		);
		this._register(start.onDidRequest(() => this.openNew()));
		const review = (progression: Progression): void =>
			navigation.selectAdministrationPage('progressionReview', progression.id);
		this.list = this._register(
			instantiationService.createInstance(
				AdminList<'studentProgressions'>,
				body,
				'studentProgressions',
				{},
				{
					label: format.text('progressionTable'),
					columns: [
						{
							label: format.text('progressionMove'),
							min: 260,
							cell: (progression) => ({
								kind: 'text',
								primary: progressionName(format, progression),
								secondary: format.text('progressionChecked', {
									when: format.relative(progression.createdAt)
								}),
								strong: true
							})
						},
						{
							label: format.text('progressionMovesOn'),
							width: '120px',
							align: 'end',
							priority: 2,
							cell: (progression) => ({
								kind: 'text',
								primary:
									progression.effectiveAt === undefined
										? ''
										: format.date(progression.effectiveAt),
								mono: true
							})
						},
						{
							label: format.text('progressionStudents'),
							width: '96px',
							align: 'end',
							priority: 3,
							cell: (progression) => ({
								kind: 'text',
								primary: format.count(progression.totalRows),
								mono: true
							})
						},
						{
							label: format.text('progressionStatus'),
							width: '170px',
							cell: (progression) => {
								const state = PROGRESSION_STATE[progression.state];
								return {
									kind: 'status',
									text: format.text(state.text),
									tone: state.tone
								};
							}
						},
						{
							label: '',
							width: '104px',
							align: 'end',
							cell: (progression) =>
								progression.state === 'preview_ready'
									? {
											kind: 'button',
											label: format.text('progressionReview'),
											icon: 'action.continue',
											run: () => review(progression)
										}
									: { kind: 'empty' }
						}
					],
					rowId: (progression) => progression.id,
					rowName: (progression) => progressionName(format, progression),
					open: review,
					icon: 'admin.progression',
					empty: {
						title: format.text('progressionEmpty'),
						text: format.text('progressionEmptyText'),
						action: {
							label: format.text('progressionNew'),
							icon: 'action.continue',
							run: () => this.openNew()
						}
					}
				}
			)
		);
	}

	setVisible(visible: boolean): void {
		this.list.setActive(visible);
	}

	private openNew(): void {
		this.dialog.value = this.instantiationService.createInstance(NewProgressionDialog);
	}
}
