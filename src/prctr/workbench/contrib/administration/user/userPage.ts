/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { ButtonControl } from '../../../../base/browser/ui/button/buttonControl.js';
import {
	Disposable,
	MutableDisposable,
	type IDisposable
} from '../../../../base/common/lifecycle.js';
import {
	affiliationKinds,
	type AdministrationFailure,
	type AdministrationResponse,
	type AdministrationValue
} from '../../../../platform/administration/common/administrationProtocol.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { proctorIconFactory } from '../../../../platform/theme/browser/proctorIcon.js';
import type { PageView } from '../../../browser/authenticated/pages/pagePane.js';
import { IPagePaneContext } from '../../../browser/authenticated/pages/pagePaneContext.js';
import type { PageRead } from '../../../browser/authenticated/pages/pageRead.js';
import {
	PageSection,
	type PageRowAction,
	type PageRowModel
} from '../../../browser/authenticated/pages/pageSection.js';
import { IAdministrationService } from '../../../services/administration/common/administration.js';
import { IAuthenticatedNavigationService } from '../../../services/authenticatedNavigation/common/authenticatedNavigation.js';
import { IAdministrationFormatService, type AdministrationText } from '../administrationFormat.js';
import { UserActions, type AdminUser } from '../users/userActions.js';
import { AdminChanges, AdminConfirmation } from '../widgets/adminChanges.js';
import { renderDetails } from '../widgets/adminDetails.js';
import { AdminFormDialog, type AdminFormOptions } from '../widgets/adminFormDialog.js';
import { initialsOf } from '../widgets/adminList.js';
import { AdminMenuButton } from '../widgets/adminMenuButton.js';
import { adminRead, readPages, readUnitTree } from '../widgets/adminReads.js';

type Read<K extends 'user' | 'affiliations' | 'roleBindings' | 'userSessions'> = PageRead<
	AdministrationValue<K>,
	AdministrationFailure,
	AdministrationResponse
>;

const AFFILIATION_TEXT: Readonly<Record<(typeof affiliationKinds)[number], AdministrationText>> = {
	student: 'userAffiliationStudent',
	teacher: 'userAffiliationTeacher',
	staff: 'userAffiliationStaff',
	external: 'userAffiliationExternal'
};

const EMAIL = /^[^\s@]{1,64}@[^\s@]+\.[^\s@]+$/u;

/**
 * One person: their profile, affiliations, roles and sessions, and what an administrator may
 * do about each. Every change is the server's to allow; a refusal reads as a calm state.
 */
export class UserPage extends Disposable implements PageView {
	private readonly user: Read<'user'>;
	private readonly affiliations: Read<'affiliations'>;
	private readonly bindings: Read<'roleBindings'>;
	private readonly sessions: Read<'userSessions'>;
	private readonly profileSection: PageSection;
	private readonly affiliationSection: PageSection;
	private readonly roleSection: PageSection;
	private readonly sessionSection: PageSection;
	private readonly actions: UserActions;
	private readonly changes: AdminChanges;
	private readonly dialog = this._register(new MutableDisposable<IDisposable>());
	private readonly resetButton: ButtonControl;
	private roleNames = new Map<string, string>();
	private roleChoices: readonly { readonly value: string; readonly label: string }[] = [];
	private unitNames = new Map<string, string>();
	private institutionId: string | undefined;

	constructor(
		body: HTMLElement,
		headerActions: HTMLElement,
		private readonly userId: string,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@IAdministrationService private readonly administration: IAdministrationService,
		@IAdministrationFormatService private readonly format: IAdministrationFormatService,
		@IAuthenticatedNavigationService
		private readonly navigation: IAuthenticatedNavigationService,
		@IPagePaneContext private readonly pane: IPagePaneContext
	) {
		super();
		this.changes = this._register(instantiationService.createInstance(AdminChanges));
		this.actions = this._register(
			instantiationService.createInstance(
				UserActions,
				() => void this.refreshAll(),
				() => this.pane.focusPage()
			)
		);
		this.resetButton = this._register(
			new ButtonControl(headerActions, {
				variant: 'secondary',
				label: format.text('userResetTwoStep'),
				icon: proctorIconFactory('account.security'),
				disabled: true
			})
		);
		this._register(this.resetButton.onDidRequest(() => this.resetTwoStep()));
		this._register(
			new AdminMenuButton(
				headerActions,
				format.text('userMore'),
				() => this.menuActions(),
				pane
			)
		);

		this.user = this._register(adminRead(administration, { kind: 'user', id: userId }));
		this.affiliations = this._register(
			adminRead(administration, { kind: 'affiliations', userId, limit: 10 })
		);
		this.bindings = this._register(
			adminRead(administration, { kind: 'roleBindings', userId, limit: 10 })
		);
		this.sessions = this._register(
			adminRead(administration, { kind: 'userSessions', userId, limit: 10 })
		);

		this.profileSection = this.section(body, 'userProfile', {
			label: format.text('userEdit'),
			icon: 'action.edit'
		});
		this.affiliationSection = this.section(body, 'userAffiliations', {
			label: format.text('userAddAffiliation'),
			icon: 'action.add'
		});
		this.roleSection = this.section(body, 'userRoles', {
			label: format.text('userGrantRole'),
			icon: 'action.add'
		});
		this.sessionSection = this.section(body, 'userSessions', {
			label: format.text('userSignOutEverywhere'),
			icon: 'action.signOut',
			destructive: true
		});
		this._register(this.profileSection.onDidRequestAction(() => this.edit()));
		this._register(this.affiliationSection.onDidRequestAction(() => this.addAffiliation()));
		this._register(this.roleSection.onDidRequestAction(() => this.grantRole()));
		this._register(
			this.sessionSection.onDidRequestAction(() => {
				const user = this.user.data;
				if (user !== undefined) this.actions.signOutEverywhere(user);
			})
		);

		this._register(this.user.onDidChange(() => this.renderUser()));
		this._register(this.affiliations.onDidChange(() => this.renderAffiliations()));
		this._register(this.bindings.onDidChange(() => this.renderRoles()));
		this._register(this.sessions.onDidChange(() => this.renderSessions()));
		this.renderUser();
		void this.loadNames();
	}

	private section(
		body: HTMLElement,
		title: AdministrationText,
		action: {
			readonly label: string;
			readonly icon: 'action.edit' | 'action.add' | 'action.signOut';
			readonly destructive?: boolean;
		}
	): PageSection {
		const section = this._register(
			this.instantiationService.createInstance(PageSection, body, {
				title: this.format.text(title),
				action
			})
		);
		section.setAction(false);
		return section;
	}

	setVisible(visible: boolean): void {
		for (const read of [this.user, this.affiliations, this.bindings, this.sessions])
			read.setActive(visible);
	}

	private async refreshAll(): Promise<void> {
		await Promise.all([
			this.user.refresh(),
			this.affiliations.refresh(),
			this.bindings.refresh(),
			this.sessions.refresh()
		]);
	}

	/** Role and unit names for the Roles section and the Grant role dialog. */
	private async loadNames(): Promise<void> {
		const [roles, units, institution] = await Promise.all([
			readPages(this.administration, 'roles', {}),
			readUnitTree(this.administration),
			this.administration.request({ kind: 'institution' })
		]);
		if (this._store.isDisposed) return;
		if (roles.kind === 'data') {
			this.roleNames = new Map(roles.value.items.map((role) => [role.id, role.displayName]));
			this.roleChoices = roles.value.items
				.filter((role) => role.archivedAt === undefined)
				.map((role) => ({ value: role.id, label: role.displayName }));
		}
		if (units.kind === 'data')
			this.unitNames = new Map(units.value.map((unit) => [unit.id, unit.name]));
		if (institution.kind === 'data' && institution.data.resource === 'institution')
			this.institutionId = institution.data.value.id;
		this.renderRoles();
	}

	// #region Rendering

	private renderUser(): void {
		const user = this.user.data;
		const state = this.user.state;
		this.profileSection.setState(state, false, () => void this.user.refresh());
		const ready = user !== undefined;
		this.resetButton.setState({
			label: this.format.text('userResetTwoStep'),
			icon: proctorIconFactory('account.security'),
			disabled: !ready
		});
		for (const section of [this.profileSection, this.affiliationSection, this.roleSection])
			section.setAction(ready);
		this.sessionSection.setAction(ready && user.disabledAt === undefined);
		if (user === undefined) {
			this.pane.setHeading({
				title: this.format.text('userTitle'),
				description: '',
				trail: [this.usersStep()]
			});
			return;
		}
		const since = this.format.date(user.createdAt);
		this.pane.setHeading({
			title: user.displayName,
			description:
				user.email === undefined
					? this.format.text('userDescriptionNoEmail', {
							username: user.username,
							date: since
						})
					: this.format.text('userDescription', {
							email: user.email,
							username: user.username,
							date: since
						}),
			trail: [this.usersStep()],
			initials: initialsOf(user.displayName),
			status:
				user.disabledAt === undefined
					? { text: this.format.text('userActive'), tone: 'ok' }
					: { text: this.format.text('userDisabled'), tone: 'neutral' }
		});
		const none = this.format.text('userNone');
		const value = (text: string | undefined) =>
			text === undefined || text === '' ? { value: none, empty: true } : { value: text };
		renderDetails(this.profileSection.content, [
			{ label: this.format.text('userFirstName'), ...value(user.firstName) },
			{ label: this.format.text('userLastName'), ...value(user.lastName) },
			{ label: this.format.text('userDisplayName'), ...value(user.displayName) },
			{ label: this.format.text('userUsername'), value: user.username },
			{
				label: this.format.text('userEmail'),
				...value(user.email),
				...(user.email === undefined
					? {}
					: {
							note:
								user.emailVerified === true
									? {
											text: this.format.text('userEmailVerified'),
											tone: 'ok' as const
										}
									: {
											text: this.format.text('userEmailUnverified'),
											tone: 'warn' as const
										}
						})
			},
			{
				label: this.format.text('userLanguage'),
				...value(
					user.locale === undefined ? undefined : this.format.languageName(user.locale)
				)
			},
			{
				label: this.format.text('userTimezone'),
				...value(user.timezone?.replaceAll('_', ' '))
			},
			{
				label: this.format.text('userLastSignIn'),
				value:
					user.lastLoginAt === undefined
						? this.format.text('userNever')
						: this.format.relativeStandalone(user.lastLoginAt)
			}
		]);
	}

	private usersStep(): { readonly label: string; open(): void } {
		return {
			label: this.format.text('userTrailUsers'),
			open: () => this.navigation.selectAdministrationPage('users')
		};
	}

	private renderAffiliations(): void {
		const data = this.affiliations.data;
		this.affiliationSection.setState(
			this.affiliations.state,
			data !== undefined && data.items.length > 0
				? false
				: this.format.text('userAffiliationsEmpty'),
			() => void this.affiliations.refresh()
		);
		if (data === undefined) return;
		const now = this.format.now();
		this.affiliationSection.setRows(
			data.items.map((affiliation): PageRowModel => {
				const ended = affiliation.endAt !== undefined && affiliation.endAt <= now;
				return {
					id: affiliation.id,
					glyph: 'object.institution',
					title: this.format.text(AFFILIATION_TEXT[affiliation.kind]),
					detail: this.period(affiliation.startAt, affiliation.endAt),
					status: this.periodStatus(affiliation.startAt, affiliation.endAt),
					actions: ended
						? []
						: [
								{
									label: this.format.text('userEndAffiliation'),
									icon: 'action.end',
									destructive: true,
									run: () =>
										this.confirmEnd(
											this.affiliationSection,
											affiliation.id,
											{
												title: this.format.text('userEndAffiliationTitle'),
												message: this.format.text('userEndAffiliationBody'),
												confirmLabel: this.format.text(
													'userEndAffiliationConfirm'
												),
												toast: this.format.text('userAffiliationEnded')
											},
											() =>
												this.changes.send(
													{ kind: 'endAffiliation', id: affiliation.id },
													[
														this.format.text(
															AFFILIATION_TEXT[affiliation.kind]
														)
													]
												),
											() => void this.affiliations.refresh()
										)
								}
							]
				};
			})
		);
	}

	private renderRoles(): void {
		const data = this.bindings.data;
		this.roleSection.setState(
			this.bindings.state,
			data !== undefined && data.items.length > 0
				? false
				: this.format.text('userRolesEmpty'),
			() => void this.bindings.refresh()
		);
		if (data === undefined) return;
		const now = this.format.now();
		this.roleSection.setRows(
			data.items.map((binding): PageRowModel => {
				const role =
					this.roleNames.get(binding.roleId) ?? this.format.text('userUnknownRole');
				const ended = binding.endAt !== undefined && binding.endAt <= now;
				const actions: PageRowAction[] = ended
					? []
					: [
							{
								label: this.format.text('userEndRole'),
								icon: 'action.end',
								destructive: true,
								run: () =>
									this.confirmEnd(
										this.roleSection,
										binding.id,
										{
											title: this.format.text('userEndRoleTitle', { role }),
											message: this.format.text('userEndRoleBody'),
											confirmLabel: this.format.text('userEndRoleConfirm'),
											toast: this.format.text('userRoleEnded')
										},
										() =>
											this.changes.send(
												{ kind: 'endRoleBinding', id: binding.id },
												[role]
											),
										() => void this.bindings.refresh()
									)
							}
						];
				return {
					id: binding.id,
					glyph: 'object.role',
					title: role,
					detail: this.format.join(
						this.scopeName(binding.scopeType, binding.scopeId),
						this.period(binding.startAt, binding.endAt)
					),
					status: this.periodStatus(binding.startAt, binding.endAt),
					actions
				};
			})
		);
	}

	private renderSessions(): void {
		const data = this.sessions.data;
		this.sessionSection.setState(
			this.sessions.state,
			data !== undefined && data.items.some((session) => session.revokedAt === undefined)
				? false
				: this.format.text('userSessionsEmpty'),
			() => void this.sessions.refresh()
		);
		if (data === undefined) return;
		const open = data.items.filter((session) => session.revokedAt === undefined);
		this.sessionSection.setRows(
			open.map((session): PageRowModel => {
				const desktop = session.client === 'desktop';
				const title =
					session.deviceName ??
					this.format.text(
						desktop
							? 'userSessionDesktop'
							: session.client === 'web'
								? 'userSessionWeb'
								: session.client === 'cli'
									? 'userSessionCli'
									: 'userSessionOther'
					);
				return {
					id: session.id,
					glyph: desktop
						? 'device.desktop'
						: session.client === 'cli'
							? 'device.cli'
							: 'device.browser',
					title,
					detail: this.format.text('userSessionDetail', {
						signedIn: this.format.relative(session.createdAt),
						active: this.format.relative(session.lastActivityAt)
					}),
					button: {
						label: this.format.text('userEndSession'),
						icon: 'action.signOut',
						run: () => void this.endSession(session.id, title)
					}
				};
			})
		);
		if (open.length === 0 && this.sessions.state.kind === 'ready')
			this.sessionSection.setState(
				this.sessions.state,
				this.format.text('userSessionsEmpty')
			);
	}

	private period(start: number, end: number | undefined): string {
		const from = this.format.date(start);
		return end === undefined
			? this.format.text('userPeriodOpen', { start: from })
			: this.format.text('userPeriod', { start: from, end: this.format.date(end) });
	}

	private periodStatus(start: number, end: number | undefined): PageRowModel['status'] {
		const now = this.format.now();
		if (end !== undefined && end <= now)
			return { text: this.format.text('userEnded'), icon: 'status.time', tone: 'quiet' };
		if (start > now)
			return { text: this.format.text('userUpcoming'), icon: 'status.time', tone: 'quiet' };
		return { text: this.format.text('userCurrent'), icon: 'status.success', tone: 'success' };
	}

	private scopeName(type: string, id: string): string {
		if (type === 'institution') return this.format.text('userScopeInstitution');
		if (type === 'academic_unit')
			return this.unitNames.get(id) ?? this.format.text('userScopeUnit');
		return this.format.text('userScopeClass');
	}

	// #endregion

	// #region Changes

	private menuActions(): readonly PageRowAction[] {
		const user = this.user.data;
		if (user === undefined) return [];
		const actions: PageRowAction[] = [
			{
				label: this.format.text('userChangeEmail'),
				icon: 'action.sendEmail',
				run: () => this.changeEmail(user)
			}
		];
		if (user.email !== undefined && user.emailVerified !== true)
			actions.push({
				label: this.format.text('userMarkVerified'),
				icon: 'status.verified',
				run: () => void this.markVerified(user)
			});
		actions.push({
			label: this.format.text('userReplacePhoto'),
			icon: 'object.image',
			run: () => this.actions.replacePhoto(user)
		});
		if (user.photoKind === 'custom')
			actions.push({
				label: this.format.text('userRemovePhoto'),
				icon: 'action.delete',
				run: () => this.actions.removePhoto(user)
			});
		actions.push(...this.actions.for(user, false));
		return actions;
	}

	private openForm(
		options: Omit<AdminFormOptions, 'onDidComplete'> & {
			readonly toast: string;
			readonly after: () => void;
		}
	): void {
		this.dialog.value = this.instantiationService.createInstance(AdminFormDialog, {
			...options,
			onDidComplete: (result) => {
				if (result.kind === 'error') this.pane.toast(this.format.failure(result.reason));
				else this.pane.toast(options.toast);
				options.after();
			}
		});
	}

	private edit(): void {
		const user = this.user.data;
		if (user === undefined) return;
		const name = user.displayName;
		this.openForm({
			title: this.format.text('userEditTitle', { name }),
			confirmLabel: this.format.text('userEditSave'),
			confirmIcon: 'action.confirm',
			fields: [
				{
					kind: 'text',
					id: 'firstName',
					label: this.format.text('userFirstName'),
					value: user.firstName
				},
				{
					kind: 'text',
					id: 'lastName',
					label: this.format.text('userLastName'),
					value: user.lastName
				},
				{
					kind: 'text',
					id: 'displayName',
					label: this.format.text('userDisplayName'),
					value: user.displayName,
					required: true
				},
				{
					kind: 'text',
					id: 'username',
					label: this.format.text('userUsername'),
					value: user.username,
					required: true
				},
				{
					kind: 'text',
					id: 'locale',
					label: this.format.text('userLanguage'),
					value: user.locale ?? '',
					hint: this.format.text('userLanguageHint')
				},
				{
					kind: 'text',
					id: 'timezone',
					label: this.format.text('userTimezone'),
					value: user.timezone ?? '',
					hint: this.format.text('userTimezoneHint')
				}
			],
			submit: (values) => {
				const text = (key: string) => values[key] as string | undefined;
				return {
					kind: 'updateUser',
					id: user.id,
					...changed('firstName', text('firstName'), user.firstName),
					...changed('lastName', text('lastName'), user.lastName),
					...changed('displayName', text('displayName'), user.displayName),
					...changed('username', text('username'), user.username),
					...changed('locale', text('locale'), user.locale),
					...changed('timezone', text('timezone'), user.timezone)
				};
			},
			summary: () => [name],
			toast: this.format.text('userSaved', { name }),
			after: () => void this.user.refresh()
		});
	}

	private addAffiliation(): void {
		const user = this.user.data;
		if (user === undefined) return;
		this.openForm({
			title: this.format.text('userAddAffiliation'),
			confirmLabel: this.format.text('userAddAffiliationSave'),
			confirmIcon: 'action.add',
			fields: [
				{
					kind: 'select',
					id: 'affiliation',
					label: this.format.text('userAffiliationKind'),
					value: 'student',
					choices: affiliationKinds.map((kind) => ({
						value: kind,
						label: this.format.text(AFFILIATION_TEXT[kind])
					}))
				},
				{
					kind: 'date',
					id: 'startAt',
					label: this.format.text('userStarts'),
					hint: this.format.text('userStartsHint')
				},
				{
					kind: 'date',
					id: 'endAt',
					label: this.format.text('userEnds'),
					hint: this.format.text('userEndsHint')
				}
			],
			submit: (values) => {
				const period = this.periodOf(values);
				if ('field' in period) return period;
				return {
					kind: 'createAffiliation',
					userId: user.id,
					affiliation: values.affiliation as (typeof affiliationKinds)[number],
					...period
				};
			},
			summary: () => [user.displayName],
			toast: this.format.text('userAffiliationAdded'),
			after: () => void this.affiliations.refresh()
		});
	}

	private grantRole(): void {
		const user = this.user.data;
		if (user === undefined) return;
		const institution = this.institutionId;
		const places = [
			...(institution === undefined
				? []
				: [
						{
							value: `institution:${institution}`,
							label: this.format.text('userWhereInstitution')
						}
					]),
			...[...this.unitNames].map(([id, name]) => ({
				value: `academic_unit:${id}`,
				label: name
			}))
		];
		this.openForm({
			title: this.format.text('userGrantRole'),
			confirmLabel: this.format.text('userGrantRoleSave'),
			confirmIcon: 'action.add',
			fields: [
				{
					kind: 'select',
					id: 'roleId',
					label: this.format.text('userRole'),
					value: this.roleChoices[0]?.value ?? '',
					choices: this.roleChoices
				},
				{
					kind: 'select',
					id: 'where',
					label: this.format.text('userWhere'),
					value: places[0]?.value ?? '',
					choices: places
				},
				{
					kind: 'date',
					id: 'startAt',
					label: this.format.text('userStarts'),
					hint: this.format.text('userStartsHint')
				},
				{
					kind: 'date',
					id: 'endAt',
					label: this.format.text('userEnds'),
					hint: this.format.text('userEndsHint')
				}
			],
			submit: (values) => {
				const period = this.periodOf(values);
				if ('field' in period) return period;
				const [scopeType, scopeId] = String(values.where ?? '').split(':');
				if (values.roleId === undefined)
					return { field: 'roleId', error: this.format.text('fieldRequired') };
				if (scopeType === undefined || scopeId === undefined || scopeId === '')
					return { field: 'where', error: this.format.text('fieldRequired') };
				return {
					kind: 'createRoleBinding',
					userId: user.id,
					roleId: values.roleId as string,
					scopeType,
					scopeId,
					...period
				};
			},
			summary: (values) => [
				user.displayName,
				this.roleNames.get(String(values.roleId)) ?? ''
			],
			toast: this.format.text('userRoleGranted'),
			after: () => void this.bindings.refresh()
		});
	}

	private resetTwoStep(): void {
		const user = this.user.data;
		if (user === undefined) return;
		const name = user.displayName;
		this.openForm({
			title: this.format.text('userResetTwoStepTitle', { name }),
			description: this.format.text('userResetTwoStepBody'),
			confirmLabel: this.format.text('userResetConfirm'),
			confirmIcon: 'action.reset',
			destructive: true,
			fields: [
				{
					kind: 'check',
					id: 'identityVerified',
					label: this.format.text('userIdentityVerified')
				},
				{
					kind: 'text',
					id: 'reason',
					label: this.format.text('userResetReason'),
					required: true
				},
				{
					kind: 'text',
					id: 'verificationReference',
					label: this.format.text('userResetReference'),
					required: true
				}
			],
			submit: (values) =>
				values.identityVerified !== true
					? { field: 'identityVerified', error: this.format.text('userIdentityRequired') }
					: {
							kind: 'resetUserMfa',
							userId: user.id,
							identityVerified: true,
							reason: values.reason as string,
							verificationReference: values.verificationReference as string
						},
			summary: () => [name, this.format.text('userResetConfirm')],
			toast: this.format.text('userTwoStepReset', { name }),
			after: () => void this.user.refresh()
		});
	}

	private changeEmail(user: AdminUser): void {
		const name = user.displayName;
		this.openForm({
			title: this.format.text('userChangeEmailTitle', { name }),
			description: this.format.text('userChangeEmailBody'),
			confirmLabel: this.format.text('userChangeEmailConfirm'),
			confirmIcon: 'action.sendEmail',
			fields: [
				{
					kind: 'text',
					id: 'email',
					label: this.format.text('userNewEmail'),
					value: user.email ?? '',
					required: true,
					inputMode: 'email'
				}
			],
			submit: (values) =>
				EMAIL.test(String(values.email))
					? { kind: 'changeUserEmail', userId: user.id, email: values.email as string }
					: { field: 'email', error: this.format.text('userEmailInvalid') },
			summary: (values) => [name, String(values.email ?? '')],
			toast: this.format.text('userEmailChanged'),
			after: () => void this.user.refresh()
		});
	}

	private async markVerified(user: AdminUser): Promise<void> {
		const result = await this.changes.send({ kind: 'verifyUserEmail', userId: user.id }, [
			user.displayName
		]);
		if (this._store.isDisposed) return;
		if (result !== 'busy' && result.kind !== 'error')
			this.pane.toast(this.format.text('userEmailMarked', { name: user.displayName }));
		else if (result === 'busy' || result.reason !== 'cancelled')
			this.pane.toast(this.changes.describe(result), {
				retry: () => void this.markVerified(user)
			});
		void this.user.refresh();
	}

	private async endSession(sessionId: string, title: string): Promise<void> {
		const result = await this.changes.send(
			{ kind: 'revokeUserSession', userId: this.userId, sessionId },
			[title]
		);
		if (this._store.isDisposed) return;
		if (result !== 'busy' && result.kind !== 'error')
			this.pane.toast(this.format.text('userSessionEnded'));
		else if (result === 'busy' || result.reason !== 'cancelled')
			this.pane.toast(this.changes.describe(result));
		void this.sessions.refresh();
	}

	private confirmEnd(
		section: PageSection,
		rowId: string,
		text: {
			readonly title: string;
			readonly message: string;
			readonly confirmLabel: string;
			readonly toast: string;
		},
		run: () => ReturnType<AdminChanges['send']>,
		after: () => void
	): void {
		this.dialog.value = this.instantiationService.createInstance(
			AdminConfirmation,
			{
				title: text.title,
				message: text.message,
				confirmLabel: text.confirmLabel,
				confirmIcon: 'action.end',
				destructive: true,
				run,
				onDidComplete: (result) => {
					if (result.kind === 'error')
						this.pane.toast(this.format.failure(result.reason));
					else this.pane.toast(text.toast);
					after();
				}
			},
			() => {
				if (!section.focusRow(rowId)) section.focusHeading();
			}
		);
	}

	private periodOf(
		values: Readonly<Record<string, unknown>>
	):
		| { readonly startAt?: number; readonly endAt?: number }
		| { readonly field: string; readonly error: string } {
		const startAt = values.startAt as number | undefined;
		const endAt = values.endAt as number | undefined;
		if (startAt !== undefined && endAt !== undefined && endAt <= startAt)
			return { field: 'endAt', error: this.format.text('userEndsBeforeStart') };
		return {
			...(startAt === undefined ? {} : { startAt }),
			...(endAt === undefined ? {} : { endAt })
		};
	}

	// #endregion
}

/** Only fields the person changed are sent. */
function changed<K extends string>(
	key: K,
	next: string | undefined,
	current: string | undefined
): Partial<Record<K, string>> {
	if (next === undefined || next === (current ?? '')) return {};
	return { [key]: next } as Partial<Record<K, string>>;
}
