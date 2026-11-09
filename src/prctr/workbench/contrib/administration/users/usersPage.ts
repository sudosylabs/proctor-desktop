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
import { InviteDialog } from '../invitations/inviteDialog.js';
import { AdminFilters } from '../widgets/adminFilters.js';
import { AdminList, type AdminListQuery } from '../widgets/adminList.js';
import { UserActions } from './userActions.js';

type Status = 'active' | 'any';

/** Everyone with an account, found by name, email or username, ten at a time. */
export class UsersPage extends Disposable implements PageView {
	private readonly list: AdminList<'users'>;
	private readonly invite = this._register(new MutableDisposable<InviteDialog>());
	private query: AdminListQuery<'users'> = {};

	constructor(
		body: HTMLElement,
		headerActions: HTMLElement,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@IAdministrationFormatService format: IAdministrationFormatService,
		@IAuthenticatedNavigationService navigation: IAuthenticatedNavigationService
	) {
		super();
		const importButton = this._register(
			new ButtonControl(headerActions, {
				variant: 'secondary',
				label: format.text('usersImport'),
				icon: proctorIconFactory('action.upload')
			})
		);
		this._register(
			importButton.onDidRequest(() => navigation.selectAdministrationPage('imports'))
		);
		const inviteButton = this._register(
			new ButtonControl(headerActions, {
				variant: 'brand',
				label: format.text('usersInvite'),
				icon: proctorIconFactory('action.invite')
			})
		);
		this._register(inviteButton.onDidRequest(() => this.openInvite()));

		const filters = this._register(new AdminFilters(body));
		filters.addSearch(format.text('usersFind'), (q) => this.setQuery({ q }));
		filters.addSelect<Status>(
			format.text('usersStatus'),
			'status.success',
			[
				{ value: 'active', label: format.text('usersStatusActive') },
				{ value: 'any', label: format.text('usersStatusAny') }
			],
			'active',
			(status) => this.setQuery({ includeDisabled: status === 'any' ? true : undefined })
		);
		const actions = this._register(
			instantiationService.createInstance(
				UserActions,
				() => void this.list.refresh(),
				(id) => this.list.focusRow(id)
			)
		);
		this.list = this._register(
			instantiationService.createInstance(AdminList<'users'>, body, 'users', this.query, {
				label: format.text('usersTable'),
				columns: [
					{
						label: format.text('usersColumnPerson'),
						width: '40%',
						cell: (user) => ({
							kind: 'person',
							name: user.displayName,
							detail: user.email ?? user.username
						})
					},
					{
						label: format.text('usersColumnUsername'),
						width: '22%',
						cell: (user) => ({ kind: 'text', primary: user.username })
					},
					{
						label: format.text('usersColumnLastActive'),
						width: '18%',
						cell: (user) => ({
							kind: 'text',
							mono: true,
							primary:
								user.lastActivityAt === undefined
									? format.text('usersNeverActive')
									: format.relativeStandalone(user.lastActivityAt)
						})
					},
					{
						label: format.text('usersColumnStatus'),
						cell: (user) =>
							user.disabledAt === undefined
								? { kind: 'status', text: format.text('userActive'), tone: 'ok' }
								: {
										kind: 'status',
										text: format.text('userDisabled'),
										tone: 'neutral'
									}
					}
				],
				rowId: (user) => user.id,
				rowName: (user) => user.displayName,
				open: (user) => navigation.selectAdministrationPage('user', user.id),
				actions: (user) => actions.for(user, true),
				empty: format.text('usersEmpty'),
				filteredEmpty: format.text('usersNoMatch')
			})
		);
	}

	private setQuery(change: Partial<AdminListQuery<'users'>>): void {
		const next: Record<string, unknown> = { ...this.query, ...change };
		for (const key of Object.keys(next)) if (next[key] === undefined) delete next[key];
		this.query = next as AdminListQuery<'users'>;
		this.list.setQuery(this.query);
	}

	private openInvite(): void {
		this.invite.value = this.instantiationService.createInstance(InviteDialog);
	}

	setVisible(visible: boolean): void {
		this.list.setActive(visible);
	}
}
