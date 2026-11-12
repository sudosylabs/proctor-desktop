/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { ButtonControl } from '../../../../base/browser/ui/button/buttonControl.js';
import {
	Disposable,
	MutableDisposable,
	type IDisposable
} from '../../../../base/common/lifecycle.js';
import type {
	AdministrationFailure,
	AdministrationResponse,
	AdministrationValue
} from '../../../../platform/administration/common/administrationProtocol.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { proctorIconFactory } from '../../../../platform/theme/browser/proctorIcon.js';
import type { PageView } from '../../../browser/authenticated/pages/pagePane.js';
import { IPagePaneContext } from '../../../browser/authenticated/pages/pagePaneContext.js';
import type { PageRead } from '../../../browser/authenticated/pages/pageRead.js';
import type { PageRowAction } from '../../../browser/authenticated/pages/pageSection.js';
import { IAdministrationService } from '../../../services/administration/common/administration.js';
import { IAuthenticatedNavigationService } from '../../../services/authenticatedNavigation/common/authenticatedNavigation.js';
import { IAdministrationFormatService } from '../administrationFormat.js';
import { InviteDialog } from '../invitations/inviteDialog.js';
import { AdminChanges, AdminConfirmation } from '../widgets/adminChanges.js';
import { AdminFilters } from '../widgets/adminFilters.js';
import { AdminFormDialog } from '../widgets/adminFormDialog.js';
import { AdminList, type AdminListItem } from '../widgets/adminList.js';
import { AdminMenuButton } from '../widgets/adminMenuButton.js';
import { adminRead, readOnce, readPages } from '../widgets/adminReads.js';

type Member = AdminListItem<'classMembers'>;
type Klass = AdministrationValue<'class'>;

/**
 * One class and the people enrolled in it: enrolling an existing account, inviting students,
 * and ending an enrolment. Members are listed by id, so their names are read once each.
 */
export class ClassPage extends Disposable implements PageView {
	private readonly klass: PageRead<Klass, AdministrationFailure, AdministrationResponse>;
	private readonly members: AdminList<'classMembers'>;
	private readonly changes: AdminChanges;
	private readonly dialog = this._register(new MutableDisposable<IDisposable>());
	private readonly names = new Map<string, string>();
	private periodName = '';

	constructor(
		body: HTMLElement,
		headerActions: HTMLElement,
		private readonly classId: string,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@IAdministrationService private readonly administration: IAdministrationService,
		@IAdministrationFormatService private readonly format: IAdministrationFormatService,
		@IAuthenticatedNavigationService
		private readonly navigation: IAuthenticatedNavigationService,
		@IPagePaneContext private readonly pane: IPagePaneContext
	) {
		super();
		this.changes = this._register(instantiationService.createInstance(AdminChanges));
		const enroll = this._register(
			new ButtonControl(headerActions, {
				variant: 'secondary',
				label: format.text('classEnroll'),
				icon: proctorIconFactory('action.invite')
			})
		);
		this._register(enroll.onDidRequest(() => this.enroll()));
		const invite = this._register(
			new ButtonControl(headerActions, {
				variant: 'brand',
				label: format.text('classInvite'),
				icon: proctorIconFactory('admin.invitations')
			})
		);
		this._register(
			invite.onDidRequest(() => {
				this.dialog.value = instantiationService.createInstance(InviteDialog);
			})
		);
		this._register(
			new AdminMenuButton(headerActions, format.text('classMore'), () => this.menu(), pane)
		);

		const filters = this._register(new AdminFilters(body));
		filters.addSelect<'current' | 'history'>(
			format.text('classEnrollment'),
			'status.success',
			[
				{ value: 'current', label: format.text('classCurrent') },
				{ value: 'history', label: format.text('classHistory') }
			],
			'current',
			(choice) =>
				this.members.setQuery({
					classId,
					...(choice === 'history' ? { history: true } : {})
				})
		);
		this.klass = this._register(adminRead(administration, { kind: 'class', id: classId }));
		this._register(this.klass.onDidChange(() => this.renderHeading()));
		this.members = this._register(
			instantiationService.createInstance(
				AdminList<'classMembers'>,
				body,
				'classMembers',
				{ classId },
				{
					label: format.text('classStudents'),
					columns: [
						{
							label: format.text('classStudentColumn'),
							width: '46%',
							cell: (member) => ({
								kind: 'person',
								name: this.names.get(member.userId) ?? format.text('inviteLoading')
							})
						},
						{
							label: format.text('classEnrolledColumn'),
							width: '22%',
							cell: (member) => ({
								kind: 'text',
								primary: format.date(member.startAt),
								mono: true
							})
						},
						{
							label: format.text('classStatusColumn'),
							cell: (member) =>
								member.endAt !== undefined && member.endAt <= format.now()
									? {
											kind: 'status',
											text: format.text('classEnded', {
												date: format.date(member.endAt)
											}),
											tone: 'neutral'
										}
									: {
											kind: 'status',
											text: format.text('classEnrolled'),
											tone: 'neutral'
										}
						}
					],
					rowId: (member) => member.id,
					rowName: (member) => this.names.get(member.userId) ?? '',
					open: (member) => navigation.selectAdministrationPage('user', member.userId),
					actions: (member) => this.memberActions(member),
					empty: format.text('classStudentsEmpty')
				}
			)
		);
		this._register(this.members.onDidLoad((members) => void this.loadNames(members)));
		this.renderHeading();
	}

	setVisible(visible: boolean): void {
		this.klass.setActive(visible);
		this.members.setActive(visible);
	}

	private renderHeading(): void {
		const klass = this.klass.data;
		const trail = [
			{
				label: this.format.text('classTrail'),
				open: () => this.navigation.selectAdministrationPage('structure')
			}
		];
		if (klass === undefined) {
			this.pane.setHeading({ title: this.format.text('classTitle'), description: '', trail });
			return;
		}
		if (this.periodName === '') void this.loadPeriod(klass.academicPeriodId);
		this.pane.setHeading({
			title: klass.displayName,
			description: this.periodName,
			trail
		});
	}

	private async loadPeriod(periodId: string): Promise<void> {
		const periods = await readPages(this.administration, 'academicPeriods', {}, 100);
		if (this._store.isDisposed || periods.kind === 'failure') return;
		this.periodName =
			periods.value.items.find((period) => period.id === periodId)?.displayName ?? '';
		if (this.periodName !== '') this.renderHeading();
	}

	private async loadNames(members: readonly Member[]): Promise<void> {
		const missing = [...new Set(members.map((member) => member.userId))].filter(
			(id) => !this.names.has(id)
		);
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
		this.members.redraw();
	}

	private memberActions(member: Member): readonly PageRowAction[] {
		const actions: PageRowAction[] = [
			{
				label: this.format.text('userOpen'),
				icon: 'action.openExternal',
				run: () => this.navigation.selectAdministrationPage('user', member.userId)
			}
		];
		if (member.endAt === undefined || member.endAt > this.format.now())
			actions.push({
				label: this.format.text('classEnd'),
				icon: 'action.end',
				destructive: true,
				run: () => this.end(member)
			});
		return actions;
	}

	private menu(): readonly PageRowAction[] {
		const klass = this.klass.data;
		if (klass === undefined) return [];
		return [
			{
				label: this.format.text('classEdit'),
				icon: 'action.edit',
				run: () => this.edit(klass)
			}
		];
	}

	private edit(klass: Klass): void {
		this.dialog.value = this.instantiationService.createInstance(AdminFormDialog, {
			title: this.format.text('classEditTitle', { name: klass.displayName }),
			confirmLabel: this.format.text('structureSave'),
			confirmIcon: 'action.confirm',
			fields: [
				{
					kind: 'text',
					id: 'displayName',
					label: this.format.text('structureDisplayName'),
					value: klass.displayName,
					required: true
				},
				{
					kind: 'text',
					id: 'name',
					label: this.format.text('structureName'),
					value: klass.name,
					required: true
				},
				{
					kind: 'longText',
					id: 'description',
					label: this.format.text('structureDescriptionField'),
					value: klass.description
				}
			],
			submit: (values) => ({
				kind: 'updateClass',
				id: klass.id,
				expectedRevision: klass.revision,
				name: values.name as string,
				displayName: values.displayName as string,
				...(values.description === undefined
					? {}
					: { description: values.description as string })
			}),
			summary: () => [klass.displayName],
			onDidComplete: (result) => {
				this.pane.toast(
					result.kind === 'error'
						? this.format.failure(result.reason)
						: this.format.text('structureSaved', { name: klass.displayName })
				);
				void this.klass.refresh();
			}
		});
	}

	private enroll(): void {
		const name = this.klass.data?.displayName ?? '';
		this.dialog.value = this.instantiationService.createInstance(AdminFormDialog, {
			title: this.format.text('classEnrollTitle', { name }),
			description: this.format.text('classEnrollBody'),
			confirmLabel: this.format.text('classEnrollConfirm'),
			confirmIcon: 'action.invite',
			fields: [
				{
					kind: 'text',
					id: 'person',
					label: this.format.text('classPerson'),
					required: true
				}
			],
			// The person is looked up when Enroll is chosen, so the dialog can say no one matched.
			submit: async (values) => {
				const text = String(values.person);
				const users = await readOnce(this.administration, {
					kind: 'users',
					q: text,
					limit: 10
				});
				const key = text.toLowerCase();
				const match =
					users.kind === 'data'
						? users.value.items.find(
								(user) =>
									user.username.toLowerCase() === key ||
									user.email?.toLowerCase() === key
							)
						: undefined;
				if (match === undefined)
					return { field: 'person', error: this.format.text('classPersonNotFound') };
				this.lastFound = match.displayName;
				return { kind: 'enrollClassMember', classId: this.classId, userId: match.id };
			},
			summary: (values) => [String(values.person), name],
			onDidComplete: (result) => {
				this.pane.toast(
					result.kind === 'error'
						? this.format.failure(result.reason)
						: this.format.text('classEnrolledToast', { name: this.lastFound })
				);
				void this.members.refresh();
			}
		});
	}

	/** The person the enrol dialog last found, named in its result. */
	private lastFound = '';

	private end(member: Member): void {
		const name = this.names.get(member.userId) ?? '';
		this.dialog.value = this.instantiationService.createInstance(
			AdminConfirmation,
			{
				title: this.format.text('classEndTitle', { name }),
				message: this.format.text('classEndBody'),
				confirmLabel: this.format.text('classEndConfirm'),
				confirmIcon: 'action.end',
				destructive: true,
				run: () => this.changes.send({ kind: 'endClassMember', id: member.id }, [name]),
				onDidComplete: (result) => {
					this.pane.toast(
						result.kind === 'error'
							? this.format.failure(result.reason)
							: this.format.text('classEndedToast', { name })
					);
					void this.members.refresh();
				}
			},
			() => this.members.focusRow(member.id)
		);
	}
}
