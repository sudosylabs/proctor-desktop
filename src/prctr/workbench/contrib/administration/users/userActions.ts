/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { Disposable, MutableDisposable } from '../../../../base/common/lifecycle.js';
import type {
	AdministrationResponse,
	AdministrationValue
} from '../../../../platform/administration/common/administrationProtocol.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import type { PageRowAction } from '../../../browser/authenticated/pages/pageSection.js';
import { IPagePaneContext } from '../../../browser/authenticated/pages/pagePaneContext.js';
import { IAuthenticatedNavigationService } from '../../../services/authenticatedNavigation/common/authenticatedNavigation.js';
import { IAdministrationFormatService } from '../administrationFormat.js';
import { AdminChanges, AdminConfirmation } from '../widgets/adminChanges.js';

export type AdminUser = AdministrationValue<'user'>;

/**
 * What can be done to one user from a list row or their own page: open their page, disable
 * or enable the account, and sign them out everywhere. Each consequential change is confirmed
 * first, and its result is shown as a toast.
 */
export class UserActions extends Disposable {
	private readonly dialog = this._register(new MutableDisposable<AdminConfirmation>());
	private readonly changes: AdminChanges;

	constructor(
		/** Called after a change, so the owner reads the user again. */
		private readonly onDidChange: (userId: string, result: AdministrationResponse) => void,
		/** Where focus returns once a dialog closes. */
		private readonly restoreFocus: (userId: string) => void,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@IAdministrationFormatService private readonly format: IAdministrationFormatService,
		@IAuthenticatedNavigationService
		private readonly navigation: IAuthenticatedNavigationService,
		@IPagePaneContext private readonly pane: IPagePaneContext
	) {
		super();
		this.changes = this._register(instantiationService.createInstance(AdminChanges));
	}

	/** The row actions for `user`; `open` adds the action that opens their page. */
	for(user: AdminUser, open: boolean): readonly PageRowAction[] {
		const actions: PageRowAction[] = [];
		if (open)
			actions.push({
				label: this.format.text('userOpen'),
				icon: 'action.openExternal',
				run: () => this.navigation.selectAdministrationPage('user', user.id)
			});
		if (user.disabledAt === undefined) {
			actions.push({
				label: this.format.text('userSignOutEverywhere'),
				icon: 'action.signOut',
				run: () => this.signOutEverywhere(user)
			});
			actions.push({
				label: this.format.text('userDisable'),
				icon: 'action.end',
				destructive: true,
				run: () => this.disable(user)
			});
		} else
			actions.push({
				label: this.format.text('userEnable'),
				icon: 'action.enable',
				run: () => void this.enable(user)
			});
		return actions;
	}

	disable(user: AdminUser): void {
		const name = user.displayName;
		this.confirm(user, {
			title: this.format.text('userDisableTitle', { name }),
			message: this.format.text('userDisableBody'),
			confirmLabel: this.format.text('userDisableConfirm'),
			confirmIcon: 'action.end',
			destructive: true,
			run: () => this.changes.send({ kind: 'disableUser', id: user.id }, [name]),
			toast: this.format.text('userDisabledToast', { name })
		});
	}

	signOutEverywhere(user: AdminUser): void {
		const name = user.displayName;
		this.confirm(user, {
			title: this.format.text('userSignOutTitle', { name }),
			message: this.format.text('userSignOutBody'),
			confirmLabel: this.format.text('userSignOutConfirm'),
			confirmIcon: 'action.signOut',
			destructive: true,
			run: () => this.changes.send({ kind: 'revokeUserSessions', userId: user.id }, [name]),
			toast: this.format.text('userSignedOutToast', { name })
		});
	}

	async enable(user: AdminUser): Promise<void> {
		const result = await this.changes.send({ kind: 'enableUser', id: user.id }, [
			user.displayName
		]);
		if (this._store.isDisposed) return;
		if (result !== 'busy' && result.kind !== 'error')
			this.pane.toast(this.format.text('userEnabledToast', { name: user.displayName }));
		else if (result === 'busy' || result.reason !== 'cancelled')
			this.pane.toast(this.changes.describe(result), { retry: () => void this.enable(user) });
		if (result !== 'busy') this.onDidChange(user.id, result);
	}

	private confirm(
		user: AdminUser,
		options: {
			readonly title: string;
			readonly message: string;
			readonly confirmLabel: string;
			readonly confirmIcon: 'action.end' | 'action.signOut';
			readonly destructive: boolean;
			readonly run: () => ReturnType<AdminChanges['send']>;
			readonly toast: string;
		}
	): void {
		this.dialog.value = this.instantiationService.createInstance(
			AdminConfirmation,
			{
				...options,
				onDidComplete: (result) => {
					if (result.kind !== 'error') this.pane.toast(options.toast);
					else this.pane.toast(this.format.failure(result.reason));
					this.onDidChange(user.id, result);
				}
			},
			() => this.restoreFocus(user.id)
		);
	}
}
