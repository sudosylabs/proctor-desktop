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
import { PageMenuButton } from '../../../browser/authenticated/pages/rowMenuButton.js';
import { AdminTabs } from '../widgets/adminTabs.js';
import { createElementFactory } from '../../../../base/browser/documentElements.js';

type ClassTab = 'students' | 'teachers' | 'invitations';
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
	private readonly teachers: AdminList<'roleBindings'>;
	private readonly invitations: AdminList<'invitations'>;
	private readonly tabs: AdminTabs<ClassTab>;
	private readonly hosts: Readonly<Record<ClassTab, HTMLElement>>;
	private readonly roleNames = new Map<string, string>();
	private rolesLoaded = false;
	private visible = false;
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
			new PageMenuButton(headerActions, format.text('classMore'), () => this.menu(), pane)
		);

		// Students, Teachers and Invitations are tabs, each its own list with its count.
		const $ = createElementFactory(body.ownerDocument);
		this.tabs = this._register(
			new AdminTabs<ClassTab>(
				body,
				format.text('classViews'),
				[
					{ id: 'students', label: format.text('classTabStudents') },
					{ id: 'teachers', label: format.text('classTabTeachers') },
					{ id: 'invitations', label: format.text('classTabInvitations') }
				],
				'students'
			)
		);
		const studentsHost = $('div');
		const teachersHost = $('div');
		const invitationsHost = $('div');
		body.append(studentsHost, teachersHost, invitationsHost);
		this.hosts = {
			students: studentsHost,
			teachers: teachersHost,
			invitations: invitationsHost
		};
		for (const [id, host] of Object.entries(this.hosts))
			this.tabs.setPanel(id as ClassTab, host);
		this._register(this.tabs.onDidChange(() => this.showTab()));
		const filters = this._register(new AdminFilters(studentsHost));
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
				studentsHost,
				'classMembers',
				{ classId },
				{
					label: format.text('classStudents'),
					columns: [
						{
							label: format.text('classStudentColumn'),
							width: '46%',
							sort: { key: 'name', first: 'asc' },
							cell: (member) => ({
								kind: 'person',
								name: this.names.get(member.userId) ?? format.text('inviteLoading')
							})
						},
						{
							label: format.text('classEnrolledColumn'),
							width: '22%',
							sort: { key: 'enrolled', first: 'asc' },
							cell: (member) => ({
								kind: 'text',
								primary: format.date(member.startAt),
								mono: true
							})
						},
						{
							label: format.text('classStatusColumn'),
							width: '150px',
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
					sorting: {
						initial: { key: 'enrolled', dir: 'asc' },
						params: (sort) => ({ sort: sort.key as 'enrolled' | 'name', dir: sort.dir })
					},
					open: (member) => navigation.selectAdministrationPage('user', member.userId),
					actions: (member) => this.memberActions(member),
					empty: format.text('classStudentsEmpty')
				}
			)
		);
		this._register(
			this.members.onDidLoad((members) => {
				this.count('students', this.members);
				void this.loadNames(members);
			})
		);
		this.teachers = this._register(
			instantiationService.createInstance(
				AdminList<'roleBindings'>,
				teachersHost,
				'roleBindings',
				{ scopeType: 'class', scopeId: classId },
				{
					label: format.text('classTeachers'),
					columns: [
						{
							label: format.text('classTeacherColumn'),
							width: '46%',
							cell: (binding) => ({
								kind: 'person',
								name: this.names.get(binding.userId) ?? format.text('inviteLoading')
							})
						},
						{
							label: format.text('classRoleColumn'),
							width: '30%',
							cell: (binding) => ({
								kind: 'text',
								primary: this.roleNames.get(binding.roleId) ?? '',
								quiet: true
							})
						},
						{
							label: format.text('classSinceColumn'),
							align: 'end',
							cell: (binding) => ({
								kind: 'text',
								primary: format.date(binding.startAt),
								mono: true,
								quiet: true
							})
						}
					],
					rowId: (binding) => binding.id,
					rowName: (binding) => this.names.get(binding.userId) ?? '',
					open: (binding) => navigation.selectAdministrationPage('user', binding.userId),
					empty: format.text('classTeachersEmpty')
				}
			)
		);
		this._register(
			this.teachers.onDidLoad((bindings) => {
				this.count('teachers', this.teachers);
				void this.loadNames(bindings);
				void this.loadRoles();
			})
		);
		this.invitations = this._register(
			instantiationService.createInstance(
				AdminList<'invitations'>,
				invitationsHost,
				'invitations',
				{ targetId: classId, state: 'pending' },
				{
					label: format.text('classInvitations'),
					columns: [
						{
							label: format.text('classInviteeColumn'),
							width: '56%',
							cell: (invitation) => ({
								kind: 'text',
								primary: invitation.email,
								strong: true
							})
						},
						{
							label: format.text('classExpiresColumn'),
							align: 'end',
							cell: (invitation) => ({
								kind: 'text',
								primary: format.date(invitation.expiresAt),
								mono: true,
								quiet: true
							})
						}
					],
					rowId: (invitation) => invitation.id,
					rowName: (invitation) => invitation.email,
					empty: format.text('classInvitationsEmpty')
				}
			)
		);
		this._register(
			this.invitations.onDidLoad(() => this.count('invitations', this.invitations))
		);
		this.showTab();
		this.renderHeading();
	}

	setVisible(visible: boolean): void {
		this.visible = visible;
		this.klass.setActive(visible);
		this.showTab();
	}

	private showTab(): void {
		const tab = this.tabs.value;
		for (const [id, host] of Object.entries(this.hosts)) host.hidden = id !== tab;
		this.members.setActive(this.visible && tab === 'students');
		this.teachers.setActive(this.visible && tab === 'teachers');
		this.invitations.setActive(this.visible && tab === 'invitations');
	}

	private count(
		tab: ClassTab,
		list: {
			readonly totalCount: { readonly count: number; readonly atLeast: boolean } | undefined;
		}
	): void {
		const total = list.totalCount;
		this.tabs.setCount(
			tab,
			total === undefined
				? undefined
				: this.format.count(total.count) + (total.atLeast ? '+' : '')
		);
	}

	private async loadRoles(): Promise<void> {
		if (this.rolesLoaded) return;
		this.rolesLoaded = true;
		const roles = await readPages(this.administration, 'roles', {});
		if (this._store.isDisposed || roles.kind !== 'data') return;
		for (const role of roles.value.items) this.roleNames.set(role.id, role.displayName);
		this.teachers.redraw();
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

	private async loadNames(members: readonly { readonly userId: string }[]): Promise<void> {
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
		this.teachers.redraw();
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
